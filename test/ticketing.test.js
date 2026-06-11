import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import ejs from "ejs";
import JSZip from "jszip";

import { getMigrationFiles } from "../scripts/migrations.js";
import { getAppUrl, normalizeAppUrl } from "../src/config.js";
import { connectionStringForPool } from "../src/db.js";
import createStore from "../src/store.js";
import { BREVO_EMAIL_URL, createEmailService } from "../src/services/email.js";
import { createPaystackService } from "../src/services/paystack.js";
import { createTicketmasterService, mapTicketmasterEvent, parseRetryAfter, queryKey } from "../src/services/ticketmaster.js";
import { buildTicketZip } from "../src/services/tickets.js";
import helpers from "../src/utils/view-helpers.js";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(testDir, "..");

function response(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json", ...headers } });
}

function fakeExternalStore() {
  const events = new Map();
  const queries = new Map();
  let apiState = null;
  return {
    expireQueries() {
      for (const value of queries.values()) value.fresh = false;
    },
    async assignExternalEventPrices(provider, ids) {
      return ids.map((id) => ({
        provider,
        provider_event_id: id,
        price_usd: 1000,
        ticket_type: "Standard Plus",
        stored_on_display: "10/06/2026"
      }));
    },
    async getExternalApiState() {
      return apiState;
    },
    async saveExternalApiState(provider, value) {
      apiState = { provider, ...value };
    },
    async getExternalEventCache(provider, id) {
      return events.get(`${provider}:${id}`) || null;
    },
    async saveExternalEvents(provider, list) {
      for (const event of list) events.set(`${provider}:${event.external_event_id}`, { payload: event, fresh: true, stale: true });
    },
    async getExternalQueryCache(provider, key) {
      return queries.get(`${provider}:${key}`) || null;
    },
    async saveExternalQueryCache(provider, key, input, payload) {
      queries.set(`${provider}:${key}`, { payload, fresh: true, stale: true });
    }
  };
}

const ticketmasterPayload = {
  id: "tm-1",
  name: "Midnight Live",
  dates: { start: { dateTime: "2026-08-01T19:00:00Z" }, status: { code: "onsale" } },
  classifications: [{ segment: { name: "Music" } }],
  images: [{ url: "https://example.com/event.jpg", width: 1200 }],
  _embedded: { venues: [{ name: "Main Hall", city: { name: "Lagos" }, country: { name: "Nigeria" } }] }
};

test("maps Ticketmaster events without Ticketmaster pricing", () => {
  const mapped = mapTicketmasterEvent({ ...ticketmasterPayload, priceRanges: [{ min: 10, max: 99 }] });
  assert.equal(mapped.external_event_id, "tm-1");
  assert.equal(mapped.venue_name, "Main Hall");
  assert.equal(mapped.priceRanges, undefined);
  assert.equal(mapped.price_label, undefined);
});

test("seeded local events expose USD starting prices and cards display price only", async () => {
  const store = createStore();
  const [event] = await store.listEvents({ limit: 1 });
  assert.equal(event.starting_price_usd_cents, 50000);
  assert.equal(event.price_label, "From $500");

  const html = await ejs.renderFile(path.join(projectRoot, "views", "partials", "event-card.ejs"), {
    event,
    helpers
  });
  assert.match(html, /class="price-pill">From \$500</);
  assert.doesNotMatch(html, /status-pill/);
  assert.doesNotMatch(html, />Available</);
});

test("ordered migrations include the Ticketmaster commerce schema", () => {
  const migrations = getMigrationFiles();
  assert.deepEqual(migrations, ["001_init.sql", "002_ticketmaster_payments.sql", "003_brevo_email.sql"]);

  const commerceMigration = fs.readFileSync(path.join(projectRoot, "migrations", "002_ticketmaster_payments.sql"), "utf8");
  for (const table of ["external_event_prices", "orders", "tickets", "payment_webhook_events", "email_deliveries"]) {
    assert.match(commerceMigration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }

  const brevoMigration = fs.readFileSync(path.join(projectRoot, "migrations", "003_brevo_email.sql"), "utf8");
  assert.match(brevoMigration, /WHERE provider = 'resend'\s+AND status <> 'sent'/);
  assert.match(brevoMigration, /ALTER COLUMN provider SET DEFAULT 'brevo'/);
});

test("Ticketmaster query hashing and Retry-After parsing are stable", () => {
  assert.equal(queryKey({ keyword: " Music ", city: "LAGOS" }), queryKey({ keyword: "music", city: "lagos" }));
  assert.equal(parseRetryAfter(new Headers({ "retry-after": "4" }), 1000), 4000);
});

test("Ticketmaster uses cache and attaches authoritative pricing", async () => {
  process.env.TICKETMASTER_API_KEY = "test-key";
  const store = fakeExternalStore();
  let calls = 0;
  const service = createTicketmasterService({
    store,
    fetchImpl: async () => {
      calls += 1;
      return response({ _embedded: { events: [ticketmasterPayload] } });
    }
  });
  const first = await service.fetchEvents({ keyword: "music", size: 1 });
  const second = await service.fetchEvents({ keyword: "music", size: 1 });
  assert.equal(calls, 1);
  assert.deepEqual(second, first);
  assert.equal(first[0].price_label, "$1,000");
  assert.equal(first[0].ticket_type, "Standard Plus");
});

test("Ticketmaster retries transient throttling inline", async () => {
  process.env.TICKETMASTER_API_KEY = "test-key";
  process.env.TICKETMASTER_MAX_RETRIES = "1";
  const waits = [];
  let calls = 0;
  const service = createTicketmasterService({
    store: fakeExternalStore(),
    sleep: async (ms) => waits.push(ms),
    fetchImpl: async () => {
      calls += 1;
      return calls === 1 ? response({}, 429, { "retry-after": "1" }) : response({ _embedded: { events: [] } });
    }
  });
  await service.fetchEvents({ keyword: "retry", size: 1 });
  assert.equal(calls, 2);
  assert.deepEqual(waits, [1000]);
});

test("remote database connections enforce verify-full TLS", () => {
  assert.match(connectionStringForPool("postgresql://user:pass@example.com/db?sslmode=require"), /sslmode=verify-full/);
  assert.equal(connectionStringForPool("postgresql://user:pass@localhost/db"), "postgresql://user:pass@localhost/db");
});

test("app URL resolution follows explicit, Vercel production, preview, and local contexts", () => {
  const names = ["APP_URL", "VERCEL_ENV", "VERCEL_URL", "VERCEL_PROJECT_PRODUCTION_URL"];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    process.env.APP_URL = "https://custom.example/some-path/";
    process.env.VERCEL_ENV = "preview";
    process.env.VERCEL_URL = "preview-lumintix.vercel.app";
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "lumintix.vercel.app";
    assert.equal(getAppUrl(), "https://custom.example");
    assert.equal(normalizeAppUrl("lumintix.vercel.app"), "https://lumintix.vercel.app");

    delete process.env.APP_URL;
    process.env.VERCEL_ENV = "production";
    assert.equal(getAppUrl(), "https://lumintix.vercel.app");

    process.env.VERCEL_ENV = "preview";
    assert.equal(getAppUrl(), "https://preview-lumintix.vercel.app");

    delete process.env.VERCEL_URL;
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
    assert.equal(getAppUrl({ port: 4321 }), "http://localhost:4321");
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
});

test("Paystack initializes USD card-only checkout and validates exact payment", async () => {
  process.env.PAYSTACK_SECRET_KEY = "sk_test_value";
  process.env.APP_URL = "https://tickets.example";
  let requestBody;
  const paystack = createPaystackService({
    fetchImpl: async (url, options) => {
      requestBody = JSON.parse(options.body);
      return response({ status: true, data: { authorization_url: "https://checkout.paystack.com/test" } });
    }
  });
  const order = {
    customer_email: "guest@example.com",
    amount_usd_cents: 200000,
    paystack_reference: "PAY-1",
    order_code: "LT-1",
    public_token: "token",
    customer_name: "Guest",
    ticket_type: "Standard Plus",
    quantity: 2
  };
  await paystack.initialize(order);
  assert.equal(requestBody.currency, "USD");
  assert.deepEqual(requestBody.channels, ["card"]);
  assert.equal(requestBody.amount, "200000");
  assert.equal(requestBody.callback_url, "https://tickets.example/payments/paystack/callback");
  assert.equal(paystack.assertVerifiedPayment(order, { reference: "PAY-1", status: "success", currency: "USD", amount: 200000 }), true);
  assert.throws(() => paystack.assertVerifiedPayment(order, { reference: "PAY-1", status: "success", currency: "EUR", amount: 200000 }));
});

test("Paystack webhook signatures use the configured secret", () => {
  process.env.PAYSTACK_SECRET_KEY = "webhook-secret";
  const raw = Buffer.from('{"event":"charge.success"}');
  const signature = crypto.createHmac("sha512", process.env.PAYSTACK_SECRET_KEY).update(raw).digest("hex");
  assert.equal(createPaystackService().verifyWebhookSignature(raw, signature), true);
});

test("Brevo sends ticket ZIPs from an unmonitored sender without replyTo", async () => {
  process.env.APP_URL = "https://tickets.example";
  process.env.BREVO_API_KEY = "brevo-test-key";
  process.env.BREVO_SENDER_NAME = "LuminTix Tickets (No Reply)";
  process.env.BREVO_SENDER_EMAIL = "no-reply@example.com";
  let request;
  let deliveryUpdate;
  const service = createEmailService({
    commerceStore: {
      async updateEmailDelivery(id, payload) {
        deliveryUpdate = { id, ...payload };
      }
    },
    buildZip: async () => Buffer.from("ticket-zip"),
    fetchImpl: async (url, options) => {
      request = { url, options, body: JSON.parse(options.body) };
      return response({ messageId: "<brevo-message-id>" }, 201);
    }
  });
  const order = {
    public_token: "public-token",
    order_code: "LT-BREVO",
    customer_name: "Ada Guest",
    customer_email: "ada@example.com",
    quantity: 2,
    event_snapshot: { title: "Midnight Live" }
  };

  await service.sendOrderTickets(order, { id: 42 });

  assert.equal(service.enabled, true);
  assert.equal(request.url, BREVO_EMAIL_URL);
  assert.equal(request.options.headers["api-key"], "brevo-test-key");
  assert.deepEqual(request.body.sender, {
    name: "LuminTix Tickets (No Reply)",
    email: "no-reply@example.com"
  });
  assert.deepEqual(request.body.to, [{ name: "Ada Guest", email: "ada@example.com" }]);
  assert.equal(request.body.replyTo, undefined);
  assert.match(request.body.htmlContent, /unmonitored mailbox/);
  assert.match(request.body.textContent, /Replies are not read/);
  assert.deepEqual(request.body.attachment, [
    { name: "lumintix-LT-BREVO-tickets.zip", content: Buffer.from("ticket-zip").toString("base64") }
  ]);
  assert.deepEqual(deliveryUpdate, { id: 42, status: "sent", provider_id: "<brevo-message-id>" });
});

test("Brevo queue records API failures for later retry", async () => {
  process.env.BREVO_API_KEY = "brevo-test-key";
  process.env.BREVO_SENDER_EMAIL = "no-reply@example.com";
  let deliveryUpdate;
  const service = createEmailService({
    commerceStore: {
      async getPendingEmailDeliveries() {
        return [{ id: 7, order_id: 9 }];
      },
      async getOrderWithTickets() {
        return {
          status: "paid",
          public_token: "token",
          order_code: "LT-FAIL",
          customer_name: "Guest",
          customer_email: "guest@example.com",
          quantity: 1,
          event_snapshot: { title: "Test Event" }
        };
      },
      async updateEmailDelivery(id, payload) {
        deliveryUpdate = { id, ...payload };
      }
    },
    buildZip: async () => Buffer.from("zip"),
    fetchImpl: async () => response({ message: "Too many requests" }, 429)
  });

  await service.processPending();

  assert.equal(deliveryUpdate.id, 7);
  assert.equal(deliveryUpdate.status, "failed");
  assert.match(deliveryUpdate.last_error, /Brevo ticket delivery failed \(429\)/);
});

test("Brevo queue records network timeouts and never sends unpaid orders", async () => {
  process.env.BREVO_API_KEY = "brevo-test-key";
  process.env.BREVO_SENDER_EMAIL = "no-reply@example.com";
  let fetchCalls = 0;
  const updates = [];
  const service = createEmailService({
    commerceStore: {
      async getPendingEmailDeliveries() {
        return [
          { id: 8, order_id: 10 },
          { id: 9, order_id: 11 }
        ];
      },
      async getOrderWithTickets(id) {
        if (id === 10) return { status: "pending" };
        return {
          status: "paid",
          public_token: "token",
          order_code: "LT-TIMEOUT",
          customer_name: "Guest",
          customer_email: "guest@example.com",
          quantity: 1,
          event_snapshot: { title: "Test Event" }
        };
      },
      async updateEmailDelivery(id, payload) {
        updates.push({ id, ...payload });
      }
    },
    buildZip: async () => Buffer.from("zip"),
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new DOMException("The operation was aborted", "TimeoutError");
    }
  });

  await service.processPending();

  assert.equal(fetchCalls, 1);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].id, 9);
  assert.equal(updates[0].status, "failed");
  assert.match(updates[0].last_error, /operation was aborted/);
});

test("Brevo email service is disabled without required credentials", () => {
  const apiKey = process.env.BREVO_API_KEY;
  const senderEmail = process.env.BREVO_SENDER_EMAIL;
  delete process.env.BREVO_API_KEY;
  delete process.env.BREVO_SENDER_EMAIL;
  assert.equal(createEmailService({ commerceStore: {} }).enabled, false);
  process.env.BREVO_API_KEY = apiKey;
  process.env.BREVO_SENDER_EMAIL = senderEmail;
});

test("ticket ZIP contains one unique PDF per purchased quantity", async () => {
  process.env.APP_URL = "https://tickets.example";
  const order = {
    order_code: "LT-TEST",
    ticket_type: "Premium",
    event_snapshot: {
      title: "Test Event",
      venue_name: "Main Hall",
      city: "Lagos",
      starts_at: "2026-08-01T19:00:00Z"
    },
    tickets: [
      { ticket_code: "TKT-ONE", validation_token: "one" },
      { ticket_code: "TKT-TWO", validation_token: "two" }
    ]
  };
  const zip = await JSZip.loadAsync(await buildTicketZip(order));
  const names = Object.keys(zip.files).sort();
  assert.deepEqual(names, ["TKT-ONE.pdf", "TKT-TWO.pdf"]);
  for (const name of names) {
    const pdf = await zip.file(name).async("nodebuffer");
    assert.equal(pdf.subarray(0, 4).toString(), "%PDF");
  }
});
