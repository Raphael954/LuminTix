import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import JSZip from "jszip";

import { connectionStringForPool } from "../src/db.js";
import { createPaystackService } from "../src/services/paystack.js";
import { createTicketmasterService, mapTicketmasterEvent, parseRetryAfter, queryKey } from "../src/services/ticketmaster.js";
import { buildTicketZip } from "../src/services/tickets.js";

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
  assert.equal(paystack.assertVerifiedPayment(order, { reference: "PAY-1", status: "success", currency: "USD", amount: 200000 }), true);
  assert.throws(() => paystack.assertVerifiedPayment(order, { reference: "PAY-1", status: "success", currency: "EUR", amount: 200000 }));
});

test("Paystack webhook signatures use the configured secret", () => {
  process.env.PAYSTACK_SECRET_KEY = "webhook-secret";
  const raw = Buffer.from('{"event":"charge.success"}');
  const signature = crypto.createHmac("sha512", process.env.PAYSTACK_SECRET_KEY).update(raw).digest("hex");
  assert.equal(createPaystackService().verifyWebhookSignature(raw, signature), true);
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
