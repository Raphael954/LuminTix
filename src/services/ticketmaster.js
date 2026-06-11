import crypto from "node:crypto";

import { readInt } from "../config.js";

const PROVIDER = "ticketmaster";
const API_BASE = "https://app.ticketmaster.com/discovery/v2";

function pickImage(images = []) {
  return [...images].sort((a, b) => (b.width || 0) - (a.width || 0))[0]?.url || "";
}

function mapTicketmasterEvent(item) {
  const venue = item?._embedded?.venues?.[0] || {};
  const classification = item?.classifications?.[0];
  const category =
    classification?.segment?.name || classification?.genre?.name || classification?.subGenre?.name || "Entertainment";
  const dateStatus = item?.dates?.status?.code;

  return {
    id: `${PROVIDER}-${item.id}`,
    external_event_id: String(item.id),
    title: item.name || "Untitled event",
    slug: `external-${PROVIDER}-${item.id}`,
    summary: `${category} event at ${venue.name || "a partner venue"}.`,
    description: item.info || item.pleaseNote || `Tickets for ${item.name || "this event"}.`,
    category_name: category,
    venue_name: venue.name || "Partner venue",
    city: venue.city?.name || "",
    state: venue.state?.stateCode || venue.state?.name || "",
    country: venue.country?.name || "",
    address: venue.address?.line1 || "",
    starts_at: item.dates?.start?.dateTime || item.dates?.start?.localDate,
    status: dateStatus === "cancelled" ? "cancelled" : "published",
    availability_status: dateStatus === "cancelled" ? "cancelled" : "available",
    image_url: pickImage(item.images),
    hero_image_url: pickImage(item.images),
    external_url: item.url || "",
    source: PROVIDER,
    is_external: true
  };
}

function normalizeQuery({ keyword = "", city = "", size = 6 } = {}) {
  return {
    keyword: keyword.trim().toLowerCase(),
    city: city.trim().toLowerCase(),
    size: Math.max(1, Math.min(Number(size) || 6, 100))
  };
}

function queryKey(filters) {
  return crypto.createHash("sha256").update(JSON.stringify(normalizeQuery(filters))).digest("hex");
}

function parseRetryAfter(headers, now = Date.now()) {
  const retryAfter = headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) return Math.max(0, date - now);
  }
  return null;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createTicketmasterService({ store, fetchImpl = fetch, sleep = delay, now = () => Date.now() }) {
  const options = {
    freshSeconds: readInt("TICKETMASTER_CACHE_FRESH_SECONDS", 3600, { min: 60 }),
    staleSeconds: readInt("TICKETMASTER_CACHE_STALE_SECONDS", 86400, { min: 300 }),
    maxRetries: readInt("TICKETMASTER_MAX_RETRIES", 3, { min: 0, max: 5 }),
    maxInlineRetryMs: readInt("TICKETMASTER_MAX_INLINE_RETRY_MS", 5000, { min: 0, max: 30000 }),
    timeoutMs: readInt("TICKETMASTER_REQUEST_TIMEOUT_MS", 10000, { min: 1000, max: 60000 })
  };

  const enabled = Boolean(process.env.TICKETMASTER_API_KEY);

  async function apiRequest(path, params = {}) {
    const state = await store.getExternalApiState(PROVIDER);
    if (state?.cooldown_until && new Date(state.cooldown_until).getTime() > now()) {
      const error = new Error("Ticketmaster API is in a shared cooldown period.");
      error.code = "TICKETMASTER_COOLDOWN";
      throw error;
    }

    const url = new URL(`${API_BASE}/${path}`);
    url.searchParams.set("apikey", process.env.TICKETMASTER_API_KEY);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
    }

    for (let attempt = 0; attempt <= options.maxRetries; attempt += 1) {
      let response;
      try {
        response = await fetchImpl(url, { signal: AbortSignal.timeout(options.timeoutMs) });
      } catch (error) {
        if (attempt === options.maxRetries) throw error;
        const retryDelay = Math.min(1000 * 2 ** attempt + Math.floor(Math.random() * 250), 30000);
        await store.saveExternalApiState(PROVIDER, {
          cooldown_until: new Date(now() + retryDelay).toISOString()
        });
        if (retryDelay > options.maxInlineRetryMs) {
          error.code = "TICKETMASTER_COOLDOWN";
          throw error;
        }
        await sleep(retryDelay);
        continue;
      }
      const observed = {
        limit: response.headers.get("x-rate-limit") || response.headers.get("rate-limit"),
        remaining: response.headers.get("x-rate-limit-available") || response.headers.get("rate-limit-available"),
        reset_at: response.headers.get("x-rate-limit-over") || response.headers.get("rate-limit-over")
      };

      if (response.ok) {
        await store.saveExternalApiState(PROVIDER, { cooldown_until: null, ...observed });
        return response.json();
      }

      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt === options.maxRetries) {
        throw new Error(`Ticketmaster Discovery API returned ${response.status}.`);
      }

      const retryDelay =
        parseRetryAfter(response.headers, now()) ??
        Math.min(1000 * 2 ** attempt + Math.floor(Math.random() * 250), 30000);
      await store.saveExternalApiState(PROVIDER, {
        cooldown_until: new Date(now() + retryDelay).toISOString(),
        ...observed
      });
      if (retryDelay > options.maxInlineRetryMs) {
        const error = new Error("Ticketmaster requested a delayed retry.");
        error.code = "TICKETMASTER_COOLDOWN";
        throw error;
      }
      await sleep(retryDelay);
    }

    throw new Error("Ticketmaster request exhausted retries.");
  }

  async function attachPrices(events) {
    if (!events.length) return [];
    const prices = await store.assignExternalEventPrices(
      PROVIDER,
      events.map((event) => event.external_event_id)
    );
    const byId = new Map(prices.map((price) => [String(price.provider_event_id), price]));
    return events.map((event) => {
      const price = byId.get(String(event.external_event_id));
      return {
        ...event,
        price_usd: price.price_usd,
        unit_price_usd_cents: price.price_usd * 100,
        price_label: `$${Number(price.price_usd).toLocaleString("en-US")}`,
        ticket_type: price.ticket_type,
        price_stored_on: price.stored_on_display
      };
    });
  }

  async function fetchEvents(filters = {}) {
    if (!enabled) return [];
    const normalized = normalizeQuery(filters);
    const cacheKey = queryKey(normalized);
    const cached = await store.getExternalQueryCache(PROVIDER, cacheKey);
    if (cached?.fresh) return attachPrices(cached.payload || []);

    try {
      const payload = await apiRequest("events.json", {
        keyword: normalized.keyword,
        city: normalized.city,
        countryCode: process.env.TICKETMASTER_COUNTRY_CODE || "",
        size: normalized.size,
        sort: "date,asc"
      });
      const events = (payload?._embedded?.events || []).map(mapTicketmasterEvent);
      await Promise.all([
        store.saveExternalEvents(PROVIDER, events, options),
        store.saveExternalQueryCache(PROVIDER, cacheKey, normalized, events, options)
      ]);
      return attachPrices(events);
    } catch (error) {
      if (cached?.stale) return attachPrices(cached.payload || []);
      throw error;
    }
  }

  async function getEventById(eventId) {
    if (!enabled) return null;
    const cached = await store.getExternalEventCache(PROVIDER, String(eventId));
    if (cached?.fresh) return (await attachPrices([cached.payload]))[0] || null;

    try {
      const payload = await apiRequest(`events/${encodeURIComponent(eventId)}.json`);
      const event = mapTicketmasterEvent(payload);
      await store.saveExternalEvents(PROVIDER, [event], options);
      return (await attachPrices([event]))[0] || null;
    } catch (error) {
      if (cached?.stale) return (await attachPrices([cached.payload]))[0] || null;
      throw error;
    }
  }

  return { enabled, fetchEvents, getEventById };
}

export { createTicketmasterService, mapTicketmasterEvent, normalizeQuery, parseRetryAfter, queryKey };
