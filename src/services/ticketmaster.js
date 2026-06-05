const DISCOVERY_URL = "https://app.ticketmaster.com/discovery/v2/events.json";

function pickImage(images = []) {
  const sorted = [...images].sort((a, b) => (b.width || 0) - (a.width || 0));
  return sorted[0]?.url || "";
}

function mapExternalEvent(item) {
  const venue = item._embedded?.venues?.[0] || {};
  const classification = item.classifications?.[0]?.segment?.name || "Entertainment";

  return {
    id: `tm-${item.id}`,
    title: item.name,
    slug: `external-${item.id}`,
    summary: `${classification} event at ${venue.name || "a partner venue"}.`,
    description: item.info || item.pleaseNote || "",
    category_name: classification,
    venue_name: venue.name || "Partner venue",
    city: venue.city?.name || "",
    state: venue.state?.stateCode || venue.state?.name || "",
    starts_at: item.dates?.start?.dateTime || item.dates?.start?.localDate,
    status: "published",
    availability_status: "external",
    image_url: pickImage(item.images),
    external_url: item.url,
    source: "ticketmaster"
  };
}

async function fetchExternalEvents({ keyword = "", city = "", size = 6 } = {}) {
  const apiKey = process.env.TICKETMASTER_API_KEY;
  if (!apiKey) return [];

  const params = new URLSearchParams({
    apikey: apiKey,
    countryCode: process.env.TICKETMASTER_COUNTRY_CODE || "US",
    size: String(size),
    sort: "date,asc"
  });

  if (keyword) params.set("keyword", keyword);
  if (city) params.set("city", city);

  const response = await fetch(`${DISCOVERY_URL}?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Ticketmaster Discovery API returned ${response.status}.`);
  }

  const payload = await response.json();
  return (payload._embedded?.events || []).map(mapExternalEvent);
}

export { fetchExternalEvents };
