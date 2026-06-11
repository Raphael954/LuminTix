import express from "express";

import { paymentLimiter } from "../middleware/security.js";
import { buildTicketZip } from "../services/tickets.js";

function getFilters(query) {
  return {
    q: query.q || "",
    category: query.category || "",
    city: query.city || "",
    date: query.date || "",
    availability: query.availability || ""
  };
}

function required(body, fields) {
  const missing = fields.filter((field) => !String(body[field] || "").trim());
  if (missing.length) {
    const error = new Error(`Missing required fields: ${missing.join(", ")}.`);
    error.status = 400;
    throw error;
  }
}

function validateQuantity(value) {
  const quantity = Number(value);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
    const error = new Error("Quantity must be a whole number between 1 and 20.");
    error.status = 400;
    throw error;
  }
  return quantity;
}

function customerDetails(body) {
  const customer = {
    customer_name: String(body.customer_name).trim(),
    customer_email: String(body.customer_email).trim(),
    customer_phone: String(body.customer_phone).trim()
  };
  if (customer.customer_name.length > 120 || customer.customer_phone.length > 40) {
    throw Object.assign(new Error("Customer name or phone is too long."), { status: 400 });
  }
  if (customer.customer_email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.customer_email)) {
    throw Object.assign(new Error("Enter a valid email address."), { status: 400 });
  }
  return customer;
}

function snapshot(event) {
  return {
    title: event.title,
    summary: event.summary || "",
    starts_at: event.starts_at,
    venue_name: event.venue_name || event.venue?.name || "Venue to be announced",
    city: event.city || event.venue?.city || "",
    state: event.state || event.venue?.state || "",
    country: event.country || event.venue?.country || "",
    image_url: event.image_url || event.hero_image_url || "",
    category_name: event.category_name || event.category?.name || "Entertainment",
    provider: event.source || "local",
    provider_event_id: event.external_event_id || null
  };
}

export default function publicRoutes({ store, commerceStore, ticketmaster, paystack, emailService }) {
  const router = express.Router();

  async function safeExternalEvents(filters, size = 6) {
    if (!size || !ticketmaster.enabled) return [];
    try {
      return await ticketmaster.fetchEvents({ keyword: filters.q || "", city: filters.city || "", size });
    } catch (error) {
      console.warn(`[ticketmaster] ${error.message}`);
      return [];
    }
  }

  async function resolveCheckout(body) {
    if (!["local", "ticketmaster"].includes(body.source)) {
      throw Object.assign(new Error("Choose a valid event source."), { status: 400 });
    }
    if (body.source === "ticketmaster") {
      const event = await ticketmaster.getEventById(body.external_event_id);
      if (!event || event.status === "cancelled") throw Object.assign(new Error("Event is unavailable."), { status: 404 });
      return {
        source: "ticketmaster",
        external_provider: "ticketmaster",
        external_event_id: event.external_event_id,
        event_snapshot: snapshot(event),
        ticket_type: event.ticket_type,
        unit_price_usd_cents: event.unit_price_usd_cents
      };
    }

    const event = await store.getEventById(body.event_id);
    if (!event || ["sold_out", "cancelled"].includes(event.availability_status) || event.status === "cancelled") {
      throw Object.assign(new Error("Event is unavailable."), { status: 404 });
    }
    const options = await store.listTicketOptions(event.id);
    const option = options.find((item) => String(item.id) === String(body.ticket_option_id));
    if (!option) throw Object.assign(new Error("Choose a valid ticket type."), { status: 400 });
    return {
      source: "local",
      event_id: event.id,
      event_snapshot: snapshot(event),
      ticket_type: option.name,
      unit_price_usd_cents: Number(option.price_usd_cents)
    };
  }

  async function verifyAndFulfill(reference) {
    const order = await commerceStore.getOrderByReference(reference);
    if (!order) throw Object.assign(new Error("Order not found."), { status: 404 });
    const transaction = await paystack.verify(reference);
    paystack.assertVerifiedPayment(order, transaction);
    const paidOrder = await commerceStore.fulfillOrder(reference);
    void emailService.processPending();
    return paidOrder;
  }

  router.get("/", async (req, res, next) => {
    try {
      const [categories, venues, featuredEvents, upcomingEvents, externalEvents] = await Promise.all([
        store.listCategories(),
        store.listVenues(),
        store.listEvents({ featured: true, limit: 6 }),
        store.listEvents({ limit: 8 }),
        safeExternalEvents({}, 4)
      ]);
      res.render("home", {
        title: "Discover entertainment worth showing up for",
        categories,
        featuredEvents,
        upcomingEvents,
        externalEvents,
        cities: [...new Set(venues.map((venue) => venue.city).filter(Boolean))].slice(0, 6)
      });
    } catch (error) {
      next(error);
    }
  });

  router.get(["/events", "/search"], async (req, res, next) => {
    try {
      const filters = getFilters(req.query);
      const [events, categories, venues, externalEvents] = await Promise.all([
        store.listEvents(filters),
        store.listCategories(),
        store.listVenues(),
        safeExternalEvents(filters, filters.q || filters.city ? 8 : 4)
      ]);
      res.render("events/index", {
        title: filters.q ? `Search results for ${filters.q}` : "Explore events",
        events,
        categories,
        category: null,
        cities: [...new Set(venues.map((venue) => venue.city).filter(Boolean))],
        filters,
        externalEvents
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/category/:slug", async (req, res, next) => {
    try {
      const category = await store.getCategoryBySlug(req.params.slug);
      if (!category) return next({ status: 404, message: "Category not found." });
      const [events, categories, venues, externalEvents] = await Promise.all([
        store.listEvents({ category: category.slug }),
        store.listCategories(),
        store.listVenues(),
        safeExternalEvents({ q: category.name }, 6)
      ]);
      res.render("events/index", {
        title: `${category.name} events`,
        eyebrow: "Category",
        category,
        events,
        categories,
        cities: [...new Set(venues.map((venue) => venue.city).filter(Boolean))],
        filters: { category: category.slug },
        externalEvents
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/venues/:slug", async (req, res, next) => {
    try {
      const venue = await store.getVenueBySlug(req.params.slug);
      if (!venue) return next({ status: 404, message: "Venue not found." });
      const events = await store.listEvents({ city: venue.city });
      res.render("venue", {
        title: venue.name,
        venue,
        events: events.filter((event) => Number(event.venue_id) === Number(venue.id))
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/events/ticketmaster/:eventId", async (req, res, next) => {
    try {
      const event = await ticketmaster.getEventById(req.params.eventId);
      if (!event) return next({ status: 404, message: "Ticketmaster event not found." });
      res.render("events/external", { title: event.title, event });
    } catch (error) {
      next(error);
    }
  });

  router.get("/events/:slug", async (req, res, next) => {
    try {
      const event = await store.getEventBySlug(req.params.slug);
      if (!event) return next({ status: 404, message: "Event not found." });
      const [ticketOptions, relatedEvents] = await Promise.all([
        store.listTicketOptions(event.id),
        store.listEvents({ category: event.category_slug, limit: 4 })
      ]);
      res.render("events/show", {
        title: event.title,
        event,
        ticketOptions,
        relatedEvents: relatedEvents.filter((item) => Number(item.id) !== Number(event.id))
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/checkout/local/:eventId", async (req, res, next) => {
    try {
      const event = await store.getEventById(req.params.eventId);
      if (!event) return next({ status: 404, message: "Event not found." });
      const ticketOptions = await store.listTicketOptions(event.id);
      res.render("checkout", {
        title: `Checkout for ${event.title}`,
        event,
        source: "local",
        ticketOptions,
        selectedTicketId: req.query.ticket || ""
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/checkout/ticketmaster/:eventId", async (req, res, next) => {
    try {
      const event = await ticketmaster.getEventById(req.params.eventId);
      if (!event) return next({ status: 404, message: "Ticketmaster event not found." });
      res.render("checkout", {
        title: `Checkout for ${event.title}`,
        event,
        source: "ticketmaster",
        ticketOptions: [],
        selectedTicketId: ""
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/payments/initialize", paymentLimiter, async (req, res, next) => {
    try {
      required(req.body, ["source", "customer_name", "customer_email", "customer_phone", "quantity"]);
      const trusted = await resolveCheckout(req.body);
      const order = await commerceStore.createOrder({
        ...trusted,
        quantity: validateQuantity(req.body.quantity),
        ...customerDetails(req.body)
      });
      try {
        const transaction = await paystack.initialize(order);
        return res.redirect(transaction.authorization_url);
      } catch (error) {
        await commerceStore.markOrderFailed(order.paystack_reference);
        const paymentError = new Error("USD card checkout is temporarily unavailable. Please contact support.");
        paymentError.status = 502;
        paymentError.expose = true;
        paymentError.cause = error;
        throw paymentError;
      }
    } catch (error) {
      next(error);
    }
  });

  router.get("/payments/paystack/callback", async (req, res, next) => {
    const reference = req.query.reference || req.query.trxref;
    try {
      if (!reference) throw Object.assign(new Error("Payment reference is missing."), { status: 400 });
      const order = await verifyAndFulfill(reference);
      res.redirect(`/orders/${order.public_token}/success`);
    } catch (error) {
      if (reference) await commerceStore.markOrderFailed(reference).catch(() => {});
      next(error);
    }
  });

  router.post("/webhooks/paystack", async (req, res, next) => {
    try {
      if (!paystack.verifyWebhookSignature(req.rawBody, req.get("x-paystack-signature"))) {
        return res.status(401).json({ error: "Invalid webhook signature." });
      }
      const payload = req.body;
      const reference = payload?.data?.reference;
      const eventKey = `${payload?.event || "unknown"}:${payload?.data?.id || reference || "unknown"}`;
      await commerceStore.recordWebhook(eventKey, payload?.event || "unknown", reference, payload);
      if (payload?.event === "charge.success" && reference) await verifyAndFulfill(reference);
      return res.sendStatus(200);
    } catch (error) {
      next(error);
    }
  });

  router.get("/orders/:publicToken/success", async (req, res, next) => {
    try {
      const order = await commerceStore.getOrderByPublicToken(req.params.publicToken);
      if (!order || order.status !== "paid") return next({ status: 404, message: "Paid order not found." });
      res.render("order-success", { title: "Your tickets are ready", order });
    } catch (error) {
      next(error);
    }
  });

  router.get("/orders/:publicToken/tickets.zip", async (req, res, next) => {
    try {
      const order = await commerceStore.getOrderByPublicToken(req.params.publicToken);
      if (!order || order.status !== "paid") return next({ status: 404, message: "Paid order not found." });
      const orderWithTickets = await commerceStore.getOrderWithTickets(order.id);
      const zip = await buildTicketZip(orderWithTickets);
      res.attachment(`lumintix-${order.order_code}-tickets.zip`).type("application/zip").send(zip);
    } catch (error) {
      next(error);
    }
  });

  router.get("/tickets/check-in/:validationToken", async (req, res, next) => {
    try {
      const result = await commerceStore.consumeTicket(req.params.validationToken);
      if (!result) return next({ status: 404, message: "Ticket not found." });
      res.render("check-in", {
        title: result.newly_used ? "Ticket checked in" : "Ticket already used",
        result
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
