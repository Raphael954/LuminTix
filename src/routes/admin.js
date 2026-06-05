import express from "express";
import { loginLimiter } from "../middleware/security.js";

function setFlash(req, type, message) {
  req.session.flash = { type, message };
}

function requireAdmin(req, res, next) {
  if (req.session.admin) return next();
  setFlash(req, "warning", "Sign in to continue.");
  return res.redirect("/admin/login");
}

function parseTags(value = "") {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function parseTicketOptions(value = "") {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, price_label, description, availability_label] = line.split("|").map((part) => part?.trim() || "");
      return {
        name,
        price_label,
        description,
        availability_label: availability_label || "Request only"
      };
    })
    .filter((option) => option.name);
}

function assertRequired(body, fields) {
  const missing = fields.filter((field) => !body[field]);
  if (missing.length) {
    const error = new Error(`Missing required fields: ${missing.join(", ")}.`);
    error.status = 400;
    throw error;
  }
}

function ticketOptionsToText(options = []) {
  return options
    .map((option) =>
      [option.name, option.price_label, option.description, option.availability_label].filter(Boolean).join(" | ")
    )
    .join("\n");
}

function eventPayload(body) {
  return {
    title: body.title,
    slug: body.slug,
    summary: body.summary,
    description: body.description,
    category_id: body.category_id,
    venue_id: body.venue_id,
    starts_at: body.starts_at,
    ends_at: body.ends_at,
    status: body.status,
    availability_status: body.availability_status,
    image_url: body.image_url,
    hero_image_url: body.hero_image_url,
    tags: parseTags(body.tags),
    is_featured: body.is_featured === "on",
    external_url: body.external_url,
    ticket_options: parseTicketOptions(body.ticket_options)
  };
}

export default function adminRoutes(store) {
  const router = express.Router();

  router.get("/login", (req, res) => {
    if (req.session.admin) return res.redirect("/admin");
    return res.render("admin/login", {
      title: "Admin sign in",
      adminEmailHint: process.env.NODE_ENV === "production" ? "" : process.env.ADMIN_EMAIL || "admin@lumin.local"
    });
  });

  router.post("/login", loginLimiter, async (req, res, next) => {
    try {
      assertRequired(req.body, ["email", "password"]);
      const admin = await store.verifyAdmin(req.body.email, req.body.password);
      if (!admin) {
        setFlash(req, "danger", "Invalid email or password.");
        return res.redirect("/admin/login");
      }

      req.session.admin = admin;
      setFlash(req, "success", `Welcome back, ${admin.name}.`);
      return res.redirect("/admin");
    } catch (error) {
      next(error);
    }
  });

  router.post("/logout", (req, res) => {
    req.session.destroy(() => res.redirect("/"));
  });

  router.use(requireAdmin);

  router.get("/", async (req, res, next) => {
    try {
      const [stats, events, requests] = await Promise.all([
        store.getStats(),
        store.listEvents({ includeDrafts: true, limit: 5 }),
        store.listBookingRequests()
      ]);

      res.render("admin/dashboard", {
        title: "Admin dashboard",
        stats,
        events,
        requests: requests.slice(0, 6)
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/events", async (req, res, next) => {
    try {
      res.render("admin/events", {
        title: "Manage events",
        events: await store.listEvents({ includeDrafts: true })
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/events/new", async (req, res, next) => {
    try {
      const [categories, venues] = await Promise.all([store.listCategories(), store.listVenues()]);
      res.render("admin/event-form", {
        title: "Create event",
        event: {},
        categories,
        venues,
        ticketOptionsText: ""
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/events", async (req, res, next) => {
    try {
      assertRequired(req.body, ["title", "category_id", "venue_id", "starts_at"]);
      const event = await store.createEvent(eventPayload(req.body));
      setFlash(req, "success", "Event created.");
      res.redirect(`/admin/events/${event.id}/edit`);
    } catch (error) {
      next(error);
    }
  });

  router.get("/events/:id/edit", async (req, res, next) => {
    try {
      const [event, categories, venues, ticketOptions] = await Promise.all([
        store.getEventById(req.params.id),
        store.listCategories(),
        store.listVenues(),
        store.listTicketOptions(req.params.id)
      ]);
      if (!event) return next({ status: 404, message: "Event not found." });

      res.render("admin/event-form", {
        title: `Edit ${event.title}`,
        event,
        categories,
        venues,
        ticketOptionsText: ticketOptionsToText(ticketOptions)
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/events/:id", async (req, res, next) => {
    try {
      assertRequired(req.body, ["title", "category_id", "venue_id", "starts_at"]);
      await store.updateEvent(req.params.id, eventPayload(req.body));
      setFlash(req, "success", "Event updated.");
      res.redirect(`/admin/events/${req.params.id}/edit`);
    } catch (error) {
      next(error);
    }
  });

  router.post("/events/:id/delete", async (req, res, next) => {
    try {
      await store.deleteEvent(req.params.id);
      setFlash(req, "success", "Event deleted.");
      res.redirect("/admin/events");
    } catch (error) {
      next(error);
    }
  });

  router.get("/categories", async (req, res, next) => {
    try {
      res.render("admin/categories", {
        title: "Manage categories",
        categories: await store.listCategories(),
        category: {}
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/categories", async (req, res, next) => {
    try {
      assertRequired(req.body, ["name"]);
      await store.createCategory(req.body);
      setFlash(req, "success", "Category created.");
      res.redirect("/admin/categories");
    } catch (error) {
      next(error);
    }
  });

  router.get("/categories/:id/edit", async (req, res, next) => {
    try {
      const category = await store.getCategoryById(req.params.id);
      if (!category) return next({ status: 404, message: "Category not found." });
      res.render("admin/categories", {
        title: "Edit category",
        categories: await store.listCategories(),
        category
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/categories/:id", async (req, res, next) => {
    try {
      assertRequired(req.body, ["name"]);
      await store.updateCategory(req.params.id, req.body);
      setFlash(req, "success", "Category updated.");
      res.redirect("/admin/categories");
    } catch (error) {
      next(error);
    }
  });

  router.post("/categories/:id/delete", async (req, res, next) => {
    try {
      await store.deleteCategory(req.params.id);
      setFlash(req, "success", "Category deleted.");
      res.redirect("/admin/categories");
    } catch (error) {
      next(error);
    }
  });

  router.get("/venues", async (req, res, next) => {
    try {
      res.render("admin/venues", {
        title: "Manage venues",
        venues: await store.listVenues(),
        venue: {}
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/venues", async (req, res, next) => {
    try {
      assertRequired(req.body, ["name", "city"]);
      await store.createVenue(req.body);
      setFlash(req, "success", "Venue created.");
      res.redirect("/admin/venues");
    } catch (error) {
      next(error);
    }
  });

  router.get("/venues/:id/edit", async (req, res, next) => {
    try {
      const venue = await store.getVenueById(req.params.id);
      if (!venue) return next({ status: 404, message: "Venue not found." });
      res.render("admin/venues", {
        title: "Edit venue",
        venues: await store.listVenues(),
        venue
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/venues/:id", async (req, res, next) => {
    try {
      assertRequired(req.body, ["name", "city"]);
      await store.updateVenue(req.params.id, req.body);
      setFlash(req, "success", "Venue updated.");
      res.redirect("/admin/venues");
    } catch (error) {
      next(error);
    }
  });

  router.post("/venues/:id/delete", async (req, res, next) => {
    try {
      await store.deleteVenue(req.params.id);
      setFlash(req, "success", "Venue deleted.");
      res.redirect("/admin/venues");
    } catch (error) {
      next(error);
    }
  });

  router.get("/requests", async (req, res, next) => {
    try {
      res.render("admin/requests", {
        title: "Booking requests",
        requests: await store.listBookingRequests()
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/requests/:id/status", async (req, res, next) => {
    try {
      await store.updateBookingStatus(req.params.id, req.body.status);
      setFlash(req, "success", "Request status updated.");
      res.redirect("/admin/requests");
    } catch (error) {
      next(error);
    }
  });

  return router;
}
