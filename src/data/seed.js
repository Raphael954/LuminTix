const categories = [
  {
    id: 1,
    name: "Music",
    slug: "music",
    description: "Live performances, album nights, listening rooms, and artist showcases.",
    accent_color: "#0db39e",
    icon: "music",
    image_url: "https://images.unsplash.com/photo-1511379938547-c1f69419868d?auto=format&fit=crop&w=900&q=80",
    sort_order: 1
  },
  {
    id: 2,
    name: "Movies",
    slug: "movies",
    description: "Premieres, outdoor screenings, cinema clubs, and film festivals.",
    accent_color: "#ff6b5f",
    icon: "clapperboard",
    image_url: "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=900&q=80",
    sort_order: 2
  },
  {
    id: 3,
    name: "Sports",
    slug: "sports",
    description: "Match days, tournaments, watch parties, and arena experiences.",
    accent_color: "#f2b705",
    icon: "trophy",
    image_url: "https://images.unsplash.com/photo-1461896836934-ffe607ba8211?auto=format&fit=crop&w=900&q=80",
    sort_order: 3
  },
  {
    id: 4,
    name: "Concerts",
    slug: "concerts",
    description: "Big-stage nights, tours, intimate sessions, and festival lineups.",
    accent_color: "#8b5cf6",
    icon: "mic-2",
    image_url: "https://images.unsplash.com/photo-1506157786151-b8491531f063?auto=format&fit=crop&w=900&q=80",
    sort_order: 4
  },
  {
    id: 5,
    name: "Nightlife",
    slug: "nightlife",
    description: "Rooftop parties, lounges, club nights, and curated social scenes.",
    accent_color: "#ef476f",
    icon: "sparkles",
    image_url: "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?auto=format&fit=crop&w=900&q=80",
    sort_order: 5
  }
];

const venues = [
  {
    id: 1,
    name: "Aurora Hall",
    slug: "aurora-hall-lagos",
    city: "Lagos",
    state: "Lagos",
    country: "Nigeria",
    address: "12 Marina Crescent, Victoria Island",
    description: "A refined indoor hall built for premium live shows and cultural nights.",
    image_url: "https://images.unsplash.com/photo-1540039155733-5bb30b53aa14?auto=format&fit=crop&w=900&q=80"
  },
  {
    id: 2,
    name: "Meridian Arena",
    slug: "meridian-arena-abuja",
    city: "Abuja",
    state: "FCT",
    country: "Nigeria",
    address: "8 Constitution Avenue, Wuse",
    description: "A flexible arena for sports, concerts, expo nights, and festivals.",
    image_url: "https://images.unsplash.com/photo-1519751138087-5bf79df62d5b?auto=format&fit=crop&w=900&q=80"
  },
  {
    id: 3,
    name: "The Velvet Rooftop",
    slug: "the-velvet-rooftop",
    city: "Lagos",
    state: "Lagos",
    country: "Nigeria",
    address: "31 Admiralty Way, Lekki Phase 1",
    description: "Open-air skyline venue for nightlife, private tables, and DJ-led events.",
    image_url: "https://images.unsplash.com/photo-1533174072545-7a4b6ad7a6c3?auto=format&fit=crop&w=900&q=80"
  },
  {
    id: 4,
    name: "Eko Cinema House",
    slug: "eko-cinema-house",
    city: "Lagos",
    state: "Lagos",
    country: "Nigeria",
    address: "4 Filmhouse Lane, Surulere",
    description: "A premium cinema venue for premieres, screenings, and film clubs.",
    image_url: "https://images.unsplash.com/photo-1517604931442-7e0c8ed2963c?auto=format&fit=crop&w=900&q=80"
  },
  {
    id: 5,
    name: "Harbor Field",
    slug: "harbor-field-port-harcourt",
    city: "Port Harcourt",
    state: "Rivers",
    country: "Nigeria",
    address: "22 Stadium Road, Old GRA",
    description: "Community-scale field for tournaments, finals, and match-day festivals.",
    image_url: "https://images.unsplash.com/photo-1560272564-c83b66b1ad12?auto=format&fit=crop&w=900&q=80"
  }
];

const events = [
  {
    id: 1,
    title: "Afrobeats Under The Stars",
    slug: "afrobeats-under-the-stars",
    summary: "A polished open-air concert night with emerging Afrobeats artists, DJs, and VIP table service.",
    description: "Afrobeats Under The Stars brings a curated lineup of new-wave artists to a skyline setting. Expect warm lights, premium sound, reserved lounges, and a crowd built for singing every hook back.",
    category_id: 4,
    venue_id: 3,
    starts_at: "2026-07-18T19:00:00+01:00",
    ends_at: "2026-07-19T01:00:00+01:00",
    status: "published",
    availability_status: "request_only",
    image_url: "https://images.unsplash.com/photo-1501386761578-eac5c94b800a?auto=format&fit=crop&w=900&q=80",
    hero_image_url: "https://images.unsplash.com/photo-1501386761578-eac5c94b800a?auto=format&fit=crop&w=1800&q=80",
    tags: ["Afrobeats", "Outdoor", "VIP"],
    is_featured: true,
    external_url: "",
    source: "local"
  },
  {
    id: 2,
    title: "Noir City Jazz Night",
    slug: "noir-city-jazz-night",
    summary: "A late evening of jazz, soul, wine pairings, and candlelit table reservations.",
    description: "Noir City Jazz Night is an intimate music room experience for listeners who want detail, warmth, and room to talk after the final set. Seating is table-first and reservation-led.",
    category_id: 1,
    venue_id: 1,
    starts_at: "2026-07-25T20:30:00+01:00",
    ends_at: "2026-07-25T23:30:00+01:00",
    status: "published",
    availability_status: "limited",
    image_url: "https://images.unsplash.com/photo-1415201364774-f6f0bb35f28f?auto=format&fit=crop&w=900&q=80",
    hero_image_url: "https://images.unsplash.com/photo-1415201364774-f6f0bb35f28f?auto=format&fit=crop&w=1800&q=80",
    tags: ["Jazz", "Tables", "Soul"],
    is_featured: true,
    external_url: "",
    source: "local"
  },
  {
    id: 3,
    title: "Solaris 9 Premiere Night",
    slug: "solaris-9-premiere-night",
    summary: "A red-carpet sci-fi premiere with cast conversation, photo moments, and reserved cinema seats.",
    description: "Solaris 9 Premiere Night gives film fans an elevated cinema evening: early access, cast Q&A, reserved seating, and an after-screening lounge moment.",
    category_id: 2,
    venue_id: 4,
    starts_at: "2026-08-02T18:00:00+01:00",
    ends_at: "2026-08-02T22:00:00+01:00",
    status: "published",
    availability_status: "request_only",
    image_url: "https://images.unsplash.com/photo-1440404653325-ab127d49abc1?auto=format&fit=crop&w=900&q=80",
    hero_image_url: "https://images.unsplash.com/photo-1440404653325-ab127d49abc1?auto=format&fit=crop&w=1800&q=80",
    tags: ["Premiere", "Cinema", "Q&A"],
    is_featured: false,
    external_url: "",
    source: "local"
  },
  {
    id: 4,
    title: "Grand Derby Watch Fest",
    slug: "grand-derby-watch-fest",
    summary: "A match-day arena watch party with giant screens, fan zones, food courts, and premium lounges.",
    description: "Grand Derby Watch Fest turns a high-stakes fixture into a full entertainment day with fan zones, analyst panels, food courts, and group tables for supporters.",
    category_id: 3,
    venue_id: 2,
    starts_at: "2026-08-09T15:00:00+01:00",
    ends_at: "2026-08-09T21:00:00+01:00",
    status: "published",
    availability_status: "available",
    image_url: "https://images.unsplash.com/photo-1511886929837-354d827aae26?auto=format&fit=crop&w=900&q=80",
    hero_image_url: "https://images.unsplash.com/photo-1511886929837-354d827aae26?auto=format&fit=crop&w=1800&q=80",
    tags: ["Football", "Watch Party", "Fan Zone"],
    is_featured: true,
    external_url: "",
    source: "local"
  },
  {
    id: 5,
    title: "Alte Cruise Rooftop",
    slug: "alte-cruise-rooftop",
    summary: "A stylish nightlife session with alternative sounds, guest DJs, and reserved table requests.",
    description: "Alte Cruise Rooftop is designed for a softer but still electric night out: alternative Afrobeats, deep house pockets, curated tables, and a skyline view.",
    category_id: 5,
    venue_id: 3,
    starts_at: "2026-08-14T21:00:00+01:00",
    ends_at: "2026-08-15T03:00:00+01:00",
    status: "published",
    availability_status: "request_only",
    image_url: "https://images.unsplash.com/photo-1527529482837-4698179dc6ce?auto=format&fit=crop&w=900&q=80",
    hero_image_url: "https://images.unsplash.com/photo-1527529482837-4698179dc6ce?auto=format&fit=crop&w=1800&q=80",
    tags: ["Rooftop", "DJs", "Tables"],
    is_featured: false,
    external_url: "",
    source: "local"
  },
  {
    id: 6,
    title: "Legends Basketball Classic",
    slug: "legends-basketball-classic",
    summary: "A nostalgia-heavy basketball exhibition with halftime performances and family seating.",
    description: "Legends Basketball Classic pairs retired local stars with new-school talent for an arena day with halftime performances, family rows, and sponsor activations.",
    category_id: 3,
    venue_id: 2,
    starts_at: "2026-08-22T16:00:00+01:00",
    ends_at: "2026-08-22T20:00:00+01:00",
    status: "published",
    availability_status: "limited",
    image_url: "https://images.unsplash.com/photo-1519861531473-9200262188bf?auto=format&fit=crop&w=900&q=80",
    hero_image_url: "https://images.unsplash.com/photo-1519861531473-9200262188bf?auto=format&fit=crop&w=1800&q=80",
    tags: ["Basketball", "Family", "Arena"],
    is_featured: false,
    external_url: "",
    source: "local"
  }
];

const ticketOptions = [
  { id: 1, event_id: 1, name: "Regular Access", price_label: "From NGN 20,000", description: "Entry access with standing-room energy.", availability_label: "Request only", sort_order: 1 },
  { id: 2, event_id: 1, name: "VIP Table", price_label: "From NGN 450,000", description: "Reserved table for groups with premium placement.", availability_label: "Request only", sort_order: 2 },
  { id: 3, event_id: 2, name: "Table for Two", price_label: "From NGN 75,000", description: "Reserved candlelit seating for two guests.", availability_label: "Limited", sort_order: 1 },
  { id: 4, event_id: 2, name: "Listening Room Seat", price_label: "From NGN 25,000", description: "Single reserved seat in the listening room.", availability_label: "Limited", sort_order: 2 },
  { id: 5, event_id: 3, name: "Premiere Seat", price_label: "From NGN 18,000", description: "Reserved cinema seat and premiere access.", availability_label: "Request only", sort_order: 1 },
  { id: 6, event_id: 3, name: "Red Carpet Bundle", price_label: "From NGN 50,000", description: "Photo access, preferred seating, and lounge access.", availability_label: "Request only", sort_order: 2 },
  { id: 7, event_id: 4, name: "Fan Zone Pass", price_label: "From NGN 12,000", description: "General access to screen zones and food court.", availability_label: "Available", sort_order: 1 },
  { id: 8, event_id: 4, name: "Premium Lounge", price_label: "From NGN 95,000", description: "Comfort seating, lounge access, and table service.", availability_label: "Request only", sort_order: 2 },
  { id: 9, event_id: 5, name: "Rooftop Access", price_label: "From NGN 30,000", description: "Entry access to the rooftop party.", availability_label: "Request only", sort_order: 1 },
  { id: 10, event_id: 5, name: "Group Table", price_label: "From NGN 380,000", description: "Reserved group table with host support.", availability_label: "Request only", sort_order: 2 },
  { id: 11, event_id: 6, name: "Courtside Request", price_label: "From NGN 120,000", description: "Premium close-view seating request.", availability_label: "Limited", sort_order: 1 },
  { id: 12, event_id: 6, name: "Family Row", price_label: "From NGN 60,000", description: "Grouped seating request for family attendance.", availability_label: "Limited", sort_order: 2 }
];

export default {
  categories,
  venues,
  events,
  ticketOptions,
  bookingRequests: []
};
