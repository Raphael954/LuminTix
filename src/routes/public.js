import express from "express";
import { bookingLimiter } from "../middleware/security.js";
import { fetchExternalEvents } from "../services/ticketmaster.js";

function getFilters(query) {
  return {
    q: query.q || "",
    category: query.category || "",
    city: query.city || "",
    date: query.date || "",
    availability: query.availability || ""
  };
}

async function safeExternalEvents(filters, size = 6) {
  if (!size) return [];

  try {
    return await fetchExternalEvents({
      keyword: filters.q || "",
      city: filters.city || "",
      size
    });
  } catch (error) {
    console.warn(`[ticketmaster] ${error.message}`);
    return [];
  }
}

export default function publicRoutes(store) {
  const router = express.Router();

  router.get("/", async (req, res, next) => {
    try {
      const [categories, venues, featuredEvents, upcomingEvents, externalEvents] = await Promise.all([
        store.listCategories(),
        store.listVenues(),
        store.listEvents({ featured: true, limit: 6 }),
        store.listEvents({ limit: 8 }),
        safeExternalEvents({}, 4)
      ]);

      const cities = [...new Set(venues.map((venue) => venue.city).filter(Boolean))].slice(0, 6);

      res.render("home", {
        title: "Discover entertainment worth dressing up for",
        categories,
        featuredEvents,
        upcomingEvents,
        externalEvents,
        cities
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
        safeExternalEvents(filters, filters.q ? 6 : 0)
      ]);

      const cities = [...new Set(venues.map((venue) => venue.city).filter(Boolean))];

      res.render("events/index", {
        title: filters.q ? `Search results for ${filters.q}` : "Explore events",
        events,
        categories,
        category: null,
        cities,
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

      const [events, categories, venues] = await Promise.all([
        store.listEvents({ category: category.slug }),
        store.listCategories(),
        store.listVenues()
      ]);

      res.render("events/index", {
        title: `${category.name} events`,
        eyebrow: "Category",
        category,
        events,
        categories,
        cities: [...new Set(venues.map((venue) => venue.city).filter(Boolean))],
        filters: { category: category.slug },
        externalEvents: []
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
      const venueEvents = events.filter((event) => Number(event.venue_id) === Number(venue.id));

      res.render("venue", {
        title: venue.name,
        venue,
        events: venueEvents
      });
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

  router.get("/request/:eventId", async (req, res, next) => {
    try {
      const event = await store.getEventById(req.params.eventId);
      if (!event) return next({ status: 404, message: "Event not found." });

      const ticketOptions = await store.listTicketOptions(event.id);

      res.render("request", {
        title: `Request tickets for ${event.title}`,
        event,
        ticketOptions,
        selectedTicketId: req.query.ticket || ""
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/booking-requests", bookingLimiter, async (req, res, next) => {
    try {
      const event = await store.getEventById(req.body.event_id);
      if (!event) {
        return res.status(404).json({ error: "Event not found." });
      }

      if (["sold_out", "cancelled"].includes(event.availability_status) || event.status === "cancelled") {
        return res.status(400).json({ error: "This event is not accepting requests right now." });
      }

      const required = ["customer_name", "customer_phone", "quantity"];
      const missing = required.filter((field) => !req.body[field]);
      if (missing.length) {
        return res.status(400).json({ error: `Missing required fields: ${missing.join(", ")}` });
      }

      const quantity = Number(req.body.quantity);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
        return res.status(400).json({ error: "Quantity must be between 1 and 20." });
      }

      const booking = await store.createBookingRequest({
        event_id: req.body.event_id,
        ticket_option_id: req.body.ticket_option_id,
        quantity,
        customer_name: req.body.customer_name,
        customer_phone: req.body.customer_phone,
        customer_email: req.body.customer_email,
        note: req.body.note
      });

      if (req.accepts("html") && !req.xhr) {
        return res.redirect(booking.whatsapp_url);
      }

      return res.status(201).json(booking);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
