import slugify from "slugify";
import bcrypt from "bcryptjs";

import { isProduction } from "./config.js";
import * as db from "./db.js";
import seed from "./data/seed.js";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeSlug(value) {
  return slugify(value || "item", {
    lower: true,
    strict: true,
    trim: true
  });
}

function uniqueSlug(baseSlug, records, currentId) {
  let slug = baseSlug || "item";
  let index = 2;

  while (records.some((record) => record.slug === slug && Number(record.id) !== Number(currentId))) {
    slug = `${baseSlug}-${index}`;
    index += 1;
  }

  return slug;
}

function nextId(records) {
  return records.reduce((max, item) => Math.max(max, Number(item.id)), 0) + 1;
}

function normalizeEventRow(row) {
  if (!row) return null;
  const startingPriceUsdCents = Number(row.starting_price_usd_cents || 0);
  return {
    ...row,
    starting_price_usd_cents: startingPriceUsdCents || null,
    price_label: startingPriceUsdCents ? `From $${(startingPriceUsdCents / 100).toLocaleString("en-US")}` : null,
    category: row.category_name
      ? {
          id: row.category_id,
          name: row.category_name,
          slug: row.category_slug,
          icon: row.category_icon,
          accent_color: row.category_accent_color
        }
      : null,
    venue: row.venue_name
      ? {
          id: row.venue_id,
          name: row.venue_name,
          slug: row.venue_slug,
          city: row.city,
          state: row.state,
          country: row.country,
          address: row.address
        }
      : null
  };
}

function matchesDateFilter(eventDate, filter) {
  if (!filter) return true;
  const startsAt = new Date(eventDate);
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(dayStart);
  tomorrow.setDate(dayStart.getDate() + 1);
  const weekEnd = new Date(dayStart);
  weekEnd.setDate(dayStart.getDate() + 7);
  const monthEnd = new Date(dayStart);
  monthEnd.setMonth(dayStart.getMonth() + 1);

  if (filter === "today") {
    return startsAt >= dayStart && startsAt < tomorrow;
  }

  if (filter === "week") {
    return startsAt >= dayStart && startsAt < weekEnd;
  }

  if (filter === "month") {
    return startsAt >= dayStart && startsAt < monthEnd;
  }

  return true;
}

function normalizeTicketOption(option) {
  if (!option) return null;
  const cents = Number(option.price_usd_cents || 0);
  return {
    ...option,
    price_usd_cents: cents,
    price_label: `$${(cents / 100).toLocaleString("en-US")}`,
    availability_label: option.availability_label || "Available"
  };
}

function createMemoryStore() {
  const data = clone(seed);

  function replaceMemoryTicketOptions(eventId, options) {
    data.ticketOptions = data.ticketOptions.filter((item) => Number(item.event_id) !== Number(eventId));
    options.forEach((option, index) => {
      if (!option.name) return;
      data.ticketOptions.push({
        id: nextId(data.ticketOptions),
        event_id: Number(eventId),
        name: option.name,
        price_usd_cents: Number(option.price_usd_cents),
        description: option.description || "",
        availability_label: option.availability_label || "Available",
        sort_order: index + 1
      });
    });
  }

  function decorateEvent(event) {
    if (!event) return null;
    const category = data.categories.find((item) => Number(item.id) === Number(event.category_id));
    const venue = data.venues.find((item) => Number(item.id) === Number(event.venue_id));
    const startingPriceUsdCents = data.ticketOptions
      .filter((item) => Number(item.event_id) === Number(event.id))
      .reduce((lowest, item) => Math.min(lowest, Number(item.price_usd_cents)), Number.POSITIVE_INFINITY);
    const hasStartingPrice = Number.isFinite(startingPriceUsdCents);

    return {
      ...event,
      starting_price_usd_cents: hasStartingPrice ? startingPriceUsdCents : null,
      price_label: hasStartingPrice ? `From $${(startingPriceUsdCents / 100).toLocaleString("en-US")}` : null,
      category,
      venue,
      category_name: category?.name,
      category_slug: category?.slug,
      category_icon: category?.icon,
      category_accent_color: category?.accent_color,
      venue_name: venue?.name,
      venue_slug: venue?.slug,
      city: venue?.city,
      state: venue?.state,
      country: venue?.country,
      address: venue?.address
    };
  }

  function listEvents(filters = {}) {
    const q = (filters.q || "").toLowerCase();
    let events = data.events
      .filter((event) => filters.includeDrafts || event.status !== "draft")
      .map(decorateEvent);

    if (q) {
      events = events.filter((event) => {
        const haystack = [
          event.title,
          event.summary,
          event.description,
          event.category_name,
          event.venue_name,
          event.city,
          ...(event.tags || [])
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(q);
      });
    }

    if (filters.category) {
      events = events.filter((event) => event.category_slug === filters.category);
    }

    if (filters.city) {
      const city = filters.city.toLowerCase();
      events = events.filter((event) => (event.city || "").toLowerCase().includes(city));
    }

    if (filters.availability) {
      events = events.filter((event) => event.availability_status === filters.availability);
    }

    if (filters.date) {
      events = events.filter((event) => matchesDateFilter(event.starts_at, filters.date));
    }

    events = events.sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));

    if (filters.featured) {
      events = events.filter((event) => event.is_featured);
    }

    if (filters.limit) {
      events = events.slice(0, Number(filters.limit));
    }

    return events;
  }

  return {
    listCategories: async () => [...data.categories].sort((a, b) => a.sort_order - b.sort_order),
    getCategoryBySlug: async (slug) => data.categories.find((item) => item.slug === slug),
    getCategoryById: async (id) => data.categories.find((item) => Number(item.id) === Number(id)),
    createCategory: async (payload) => {
      const category = {
        id: nextId(data.categories),
        name: payload.name,
        slug: uniqueSlug(makeSlug(payload.slug || payload.name), data.categories),
        description: payload.description || "",
        accent_color: payload.accent_color || "#7928f5",
        icon: payload.icon || "ticket",
        image_url: payload.image_url || "",
        sort_order: Number(payload.sort_order || data.categories.length + 1)
      };
      data.categories.push(category);
      return category;
    },
    updateCategory: async (id, payload) => {
      const category = data.categories.find((item) => Number(item.id) === Number(id));
      if (!category) return null;
      Object.assign(category, {
        name: payload.name,
        slug: uniqueSlug(makeSlug(payload.slug || payload.name), data.categories, id),
        description: payload.description || "",
        accent_color: payload.accent_color || "#7928f5",
        icon: payload.icon || "ticket",
        image_url: payload.image_url || "",
        sort_order: Number(payload.sort_order || category.sort_order || 1)
      });
      return category;
    },
    deleteCategory: async (id) => {
      const index = data.categories.findIndex((item) => Number(item.id) === Number(id));
      if (index >= 0) data.categories.splice(index, 1);
    },

    listVenues: async () => [...data.venues].sort((a, b) => a.name.localeCompare(b.name)),
    getVenueBySlug: async (slug) => data.venues.find((item) => item.slug === slug),
    getVenueById: async (id) => data.venues.find((item) => Number(item.id) === Number(id)),
    createVenue: async (payload) => {
      const venue = {
        id: nextId(data.venues),
        name: payload.name,
        slug: uniqueSlug(makeSlug(payload.slug || `${payload.name}-${payload.city}`), data.venues),
        city: payload.city,
        state: payload.state || "",
        country: payload.country || "Nigeria",
        address: payload.address || "",
        description: payload.description || "",
        image_url: payload.image_url || ""
      };
      data.venues.push(venue);
      return venue;
    },
    updateVenue: async (id, payload) => {
      const venue = data.venues.find((item) => Number(item.id) === Number(id));
      if (!venue) return null;
      Object.assign(venue, {
        name: payload.name,
        slug: uniqueSlug(makeSlug(payload.slug || `${payload.name}-${payload.city}`), data.venues, id),
        city: payload.city,
        state: payload.state || "",
        country: payload.country || "Nigeria",
        address: payload.address || "",
        description: payload.description || "",
        image_url: payload.image_url || ""
      });
      return venue;
    },
    deleteVenue: async (id) => {
      const index = data.venues.findIndex((item) => Number(item.id) === Number(id));
      if (index >= 0) data.venues.splice(index, 1);
    },

    listEvents: async (filters) => listEvents(filters),
    getEventBySlug: async (slug) => decorateEvent(data.events.find((item) => item.slug === slug)),
    getEventById: async (id) => decorateEvent(data.events.find((item) => Number(item.id) === Number(id))),
    createEvent: async (payload) => {
      const event = {
        id: nextId(data.events),
        title: payload.title,
        slug: uniqueSlug(makeSlug(payload.slug || payload.title), data.events),
        summary: payload.summary || "",
        description: payload.description || "",
        category_id: Number(payload.category_id),
        venue_id: Number(payload.venue_id),
        starts_at: payload.starts_at,
        ends_at: payload.ends_at || null,
        status: payload.status || "published",
        availability_status: payload.availability_status || "available",
        image_url: payload.image_url || "",
        hero_image_url: payload.hero_image_url || payload.image_url || "",
        tags: payload.tags || [],
        is_featured: Boolean(payload.is_featured),
        external_url: payload.external_url || "",
        source: "local"
      };
      data.events.push(event);
      replaceMemoryTicketOptions(event.id, payload.ticket_options || []);
      return decorateEvent(event);
    },
    updateEvent: async (id, payload) => {
      const event = data.events.find((item) => Number(item.id) === Number(id));
      if (!event) return null;
      Object.assign(event, {
        title: payload.title,
        slug: uniqueSlug(makeSlug(payload.slug || payload.title), data.events, id),
        summary: payload.summary || "",
        description: payload.description || "",
        category_id: Number(payload.category_id),
        venue_id: Number(payload.venue_id),
        starts_at: payload.starts_at,
        ends_at: payload.ends_at || null,
        status: payload.status || "published",
        availability_status: payload.availability_status || "available",
        image_url: payload.image_url || "",
        hero_image_url: payload.hero_image_url || payload.image_url || "",
        tags: payload.tags || [],
        is_featured: Boolean(payload.is_featured),
        external_url: payload.external_url || "",
        source: "local"
      });
      replaceMemoryTicketOptions(event.id, payload.ticket_options || []);
      return decorateEvent(event);
    },
    deleteEvent: async (id) => {
      const eventIndex = data.events.findIndex((item) => Number(item.id) === Number(id));
      if (eventIndex >= 0) data.events.splice(eventIndex, 1);
      data.ticketOptions = data.ticketOptions.filter((item) => Number(item.event_id) !== Number(id));
    },
    listTicketOptions: async (eventId) =>
      data.ticketOptions
        .filter((item) => Number(item.event_id) === Number(eventId))
        .sort((a, b) => a.sort_order - b.sort_order)
        .map(normalizeTicketOption),
    replaceTicketOptions: async (eventId, options) => replaceMemoryTicketOptions(eventId, options),

    getStats: async () => ({
      events: data.events.length,
      categories: data.categories.length,
      venues: data.venues.length
    }),
    verifyAdmin: async (email, password) => {
      const adminEmail = process.env.ADMIN_EMAIL || "admin@lumin.local";
      const adminPassword = process.env.ADMIN_PASSWORD || "admin123";
      if (email !== adminEmail || password !== adminPassword) return null;
      return { id: "env-admin", name: process.env.ADMIN_NAME || "Site Admin", email: adminEmail };
    }
  };
}

function createDbStore(memoryStore) {
  const eventSelect = `
    SELECT e.*,
      c.name AS category_name, c.slug AS category_slug, c.icon AS category_icon, c.accent_color AS category_accent_color,
      v.name AS venue_name, v.slug AS venue_slug, v.city, v.state, v.country, v.address,
      pricing.starting_price_usd_cents
    FROM events e
    LEFT JOIN categories c ON c.id = e.category_id
    LEFT JOIN venues v ON v.id = e.venue_id
    LEFT JOIN LATERAL (
      SELECT MIN(t.price_usd_cents) AS starting_price_usd_cents
      FROM ticket_options t
      WHERE t.event_id = e.id
    ) pricing ON true
  `;

  async function fallback(name, operation, memoryOperation) {
    if (!db.isConfigured()) return memoryOperation();

    try {
      return await operation();
    } catch (error) {
      if (isProduction) {
        throw error;
      }

      console.warn(`[store] ${name} used local fallback: ${error.message}`);
      return memoryOperation();
    }
  }

  async function dbUniqueSlug(table, baseSlug, currentId) {
    let slug = baseSlug || "item";
    let index = 2;

    while (true) {
      const params = [slug];
      let sql = `SELECT id FROM ${table} WHERE slug = $1`;
      if (currentId) {
        params.push(currentId);
        sql += ` AND id <> $2`;
      }

      const result = await db.query(sql, params);
      if (!result.rows.length) return slug;
      slug = `${baseSlug}-${index}`;
      index += 1;
    }
  }

  function buildEventFilters(filters = {}) {
    const clauses = [];
    const params = [];

    if (!filters.includeDrafts) {
      clauses.push(`e.status <> 'draft'`);
    }

    if (filters.q) {
      params.push(`%${filters.q}%`);
      clauses.push(`(
        e.title ILIKE $${params.length}
        OR e.summary ILIKE $${params.length}
        OR e.description ILIKE $${params.length}
        OR c.name ILIKE $${params.length}
        OR v.name ILIKE $${params.length}
        OR v.city ILIKE $${params.length}
      )`);
    }

    if (filters.category) {
      params.push(filters.category);
      clauses.push(`c.slug = $${params.length}`);
    }

    if (filters.city) {
      params.push(`%${filters.city}%`);
      clauses.push(`v.city ILIKE $${params.length}`);
    }

    if (filters.availability) {
      params.push(filters.availability);
      clauses.push(`e.availability_status = $${params.length}`);
    }

    if (filters.featured) {
      clauses.push(`e.is_featured = true`);
    }

    if (filters.date === "today") {
      clauses.push(`e.starts_at >= CURRENT_DATE AND e.starts_at < CURRENT_DATE + INTERVAL '1 day'`);
    }

    if (filters.date === "week") {
      clauses.push(`e.starts_at >= CURRENT_DATE AND e.starts_at < CURRENT_DATE + INTERVAL '7 days'`);
    }

    if (filters.date === "month") {
      clauses.push(`e.starts_at >= CURRENT_DATE AND e.starts_at < CURRENT_DATE + INTERVAL '1 month'`);
    }

    return {
      where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
      params
    };
  }

  const store = {
    isDatabaseConfigured: () => db.isConfigured(),
    listCategories: () =>
      fallback(
        "listCategories",
        async () => (await db.query("SELECT * FROM categories ORDER BY sort_order ASC, name ASC")).rows,
        memoryStore.listCategories
      ),
    getCategoryBySlug: (slug) =>
      fallback(
        "getCategoryBySlug",
        async () => (await db.query("SELECT * FROM categories WHERE slug = $1", [slug])).rows[0],
        () => memoryStore.getCategoryBySlug(slug)
      ),
    getCategoryById: (id) =>
      fallback(
        "getCategoryById",
        async () => (await db.query("SELECT * FROM categories WHERE id = $1", [id])).rows[0],
        () => memoryStore.getCategoryById(id)
      ),
    createCategory: (payload) =>
      fallback(
        "createCategory",
        async () => {
          const slug = await dbUniqueSlug("categories", makeSlug(payload.slug || payload.name));
          const result = await db.query(
            `INSERT INTO categories (name, slug, description, accent_color, icon, image_url, sort_order)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING *`,
            [
              payload.name,
              slug,
              payload.description || "",
              payload.accent_color || "#7928f5",
              payload.icon || "ticket",
              payload.image_url || "",
              Number(payload.sort_order || 1)
            ]
          );
          return result.rows[0];
        },
        () => memoryStore.createCategory(payload)
      ),
    updateCategory: (id, payload) =>
      fallback(
        "updateCategory",
        async () => {
          const slug = await dbUniqueSlug("categories", makeSlug(payload.slug || payload.name), id);
          const result = await db.query(
            `UPDATE categories
             SET name = $1, slug = $2, description = $3, accent_color = $4, icon = $5, image_url = $6, sort_order = $7
             WHERE id = $8
             RETURNING *`,
            [
              payload.name,
              slug,
              payload.description || "",
              payload.accent_color || "#7928f5",
              payload.icon || "ticket",
              payload.image_url || "",
              Number(payload.sort_order || 1),
              id
            ]
          );
          return result.rows[0];
        },
        () => memoryStore.updateCategory(id, payload)
      ),
    deleteCategory: (id) =>
      fallback(
        "deleteCategory",
        async () => db.query("DELETE FROM categories WHERE id = $1", [id]),
        () => memoryStore.deleteCategory(id)
      ),

    listVenues: () =>
      fallback(
        "listVenues",
        async () => (await db.query("SELECT * FROM venues ORDER BY name ASC")).rows,
        memoryStore.listVenues
      ),
    getVenueBySlug: (slug) =>
      fallback(
        "getVenueBySlug",
        async () => (await db.query("SELECT * FROM venues WHERE slug = $1", [slug])).rows[0],
        () => memoryStore.getVenueBySlug(slug)
      ),
    getVenueById: (id) =>
      fallback(
        "getVenueById",
        async () => (await db.query("SELECT * FROM venues WHERE id = $1", [id])).rows[0],
        () => memoryStore.getVenueById(id)
      ),
    createVenue: (payload) =>
      fallback(
        "createVenue",
        async () => {
          const slug = await dbUniqueSlug("venues", makeSlug(payload.slug || `${payload.name}-${payload.city}`));
          const result = await db.query(
            `INSERT INTO venues (name, slug, city, state, country, address, description, image_url)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING *`,
            [
              payload.name,
              slug,
              payload.city,
              payload.state || "",
              payload.country || "Nigeria",
              payload.address || "",
              payload.description || "",
              payload.image_url || ""
            ]
          );
          return result.rows[0];
        },
        () => memoryStore.createVenue(payload)
      ),
    updateVenue: (id, payload) =>
      fallback(
        "updateVenue",
        async () => {
          const slug = await dbUniqueSlug("venues", makeSlug(payload.slug || `${payload.name}-${payload.city}`), id);
          const result = await db.query(
            `UPDATE venues
             SET name = $1, slug = $2, city = $3, state = $4, country = $5, address = $6, description = $7, image_url = $8
             WHERE id = $9
             RETURNING *`,
            [
              payload.name,
              slug,
              payload.city,
              payload.state || "",
              payload.country || "Nigeria",
              payload.address || "",
              payload.description || "",
              payload.image_url || "",
              id
            ]
          );
          return result.rows[0];
        },
        () => memoryStore.updateVenue(id, payload)
      ),
    deleteVenue: (id) =>
      fallback(
        "deleteVenue",
        async () => db.query("DELETE FROM venues WHERE id = $1", [id]),
        () => memoryStore.deleteVenue(id)
      ),

    listEvents: (filters = {}) =>
      fallback(
        "listEvents",
        async () => {
          const built = buildEventFilters(filters);
          const params = [...built.params];
          let sql = `${eventSelect} ${built.where} ORDER BY e.starts_at ASC`;
          if (filters.limit) {
            params.push(Number(filters.limit));
            sql += ` LIMIT $${params.length}`;
          }
          const result = await db.query(sql, params);
          return result.rows.map(normalizeEventRow);
        },
        () => memoryStore.listEvents(filters)
      ),
    getEventBySlug: (slug) =>
      fallback(
        "getEventBySlug",
        async () => {
          const result = await db.query(`${eventSelect} WHERE e.slug = $1`, [slug]);
          return normalizeEventRow(result.rows[0]);
        },
        () => memoryStore.getEventBySlug(slug)
      ),
    getEventById: (id) =>
      fallback(
        "getEventById",
        async () => {
          const result = await db.query(`${eventSelect} WHERE e.id = $1`, [id]);
          return normalizeEventRow(result.rows[0]);
        },
        () => memoryStore.getEventById(id)
      ),
    createEvent: (payload) =>
      fallback(
        "createEvent",
        async () => {
          const slug = await dbUniqueSlug("events", makeSlug(payload.slug || payload.title));
          const result = await db.query(
            `INSERT INTO events
              (title, slug, summary, description, category_id, venue_id, starts_at, ends_at, status,
               availability_status, image_url, hero_image_url, tags, is_featured, external_url, source)
             VALUES ($1, $2, $3, $4, $5, $6, $7, NULLIF($8, '')::timestamptz, $9, $10, $11, $12, $13, $14, $15, 'local')
             RETURNING *`,
            [
              payload.title,
              slug,
              payload.summary || "",
              payload.description || "",
              Number(payload.category_id),
              Number(payload.venue_id),
              payload.starts_at,
              payload.ends_at || "",
              payload.status || "published",
              payload.availability_status || "available",
              payload.image_url || "",
              payload.hero_image_url || payload.image_url || "",
              payload.tags || [],
              Boolean(payload.is_featured),
              payload.external_url || ""
            ]
          );
          await store.replaceTicketOptions(result.rows[0].id, payload.ticket_options || []);
          return store.getEventById(result.rows[0].id);
        },
        () => memoryStore.createEvent(payload)
      ),
    updateEvent: (id, payload) =>
      fallback(
        "updateEvent",
        async () => {
          const slug = await dbUniqueSlug("events", makeSlug(payload.slug || payload.title), id);
          const result = await db.query(
            `UPDATE events
             SET title = $1, slug = $2, summary = $3, description = $4, category_id = $5, venue_id = $6,
                 starts_at = $7, ends_at = NULLIF($8, '')::timestamptz, status = $9, availability_status = $10,
                 image_url = $11, hero_image_url = $12, tags = $13, is_featured = $14, external_url = $15,
                 updated_at = NOW()
             WHERE id = $16
             RETURNING *`,
            [
              payload.title,
              slug,
              payload.summary || "",
              payload.description || "",
              Number(payload.category_id),
              Number(payload.venue_id),
              payload.starts_at,
              payload.ends_at || "",
              payload.status || "published",
              payload.availability_status || "available",
              payload.image_url || "",
              payload.hero_image_url || payload.image_url || "",
              payload.tags || [],
              Boolean(payload.is_featured),
              payload.external_url || "",
              id
            ]
          );
          await store.replaceTicketOptions(id, payload.ticket_options || []);
          return store.getEventById(id);
        },
        () => memoryStore.updateEvent(id, payload)
      ),
    deleteEvent: (id) =>
      fallback(
        "deleteEvent",
        async () => db.query("DELETE FROM events WHERE id = $1", [id]),
        () => memoryStore.deleteEvent(id)
      ),
    listTicketOptions: (eventId) =>
      fallback(
        "listTicketOptions",
        async () =>
          (
            await db.query("SELECT * FROM ticket_options WHERE event_id = $1 ORDER BY sort_order ASC", [eventId])
          ).rows.map(normalizeTicketOption),
        () => memoryStore.listTicketOptions(eventId)
      ),
    replaceTicketOptions: (eventId, options) =>
      fallback(
        "replaceTicketOptions",
        async () => {
          await db.query("DELETE FROM ticket_options WHERE event_id = $1", [eventId]);
          for (const [index, option] of options.entries()) {
            if (!option.name) continue;
            await db.query(
              `INSERT INTO ticket_options
                (event_id, name, price_label, price_usd_cents, description, availability_label, sort_order)
               VALUES ($1, $2, $3, $4, $5, $6, $7)`,
              [
                eventId,
                option.name,
                `$${(Number(option.price_usd_cents) / 100).toLocaleString("en-US")}`,
                Number(option.price_usd_cents),
                option.description || "",
                option.availability_label || "Available",
                index + 1
              ]
            );
          }
        },
        () => memoryStore.replaceTicketOptions(eventId, options)
      ),

    getStats: () =>
      fallback(
        "getStats",
        async () => {
          const [events, categories, venues] = await Promise.all([
            db.query("SELECT COUNT(*)::int AS count FROM events"),
            db.query("SELECT COUNT(*)::int AS count FROM categories"),
            db.query("SELECT COUNT(*)::int AS count FROM venues")
          ]);
          return {
            events: events.rows[0].count,
            categories: categories.rows[0].count,
            venues: venues.rows[0].count
          };
        },
        memoryStore.getStats
      ),
    verifyAdmin: (email, password) =>
      fallback(
        "verifyAdmin",
        async () => {
          const result = await db.query("SELECT * FROM admins WHERE email = $1", [email]);
          const admin = result.rows[0];
          if (admin && (await bcrypt.compare(password, admin.password_hash))) {
            return { id: admin.id, name: admin.name, email: admin.email };
          }

          return memoryStore.verifyAdmin(email, password);
        },
        () => memoryStore.verifyAdmin(email, password)
      )
  };

  return store;
}

export default function createStore() {
  const memoryStore = createMemoryStore();
  const store = createDbStore(memoryStore);
  store.isDatabaseConfigured = () => db.isConfigured();
  return store;
}
