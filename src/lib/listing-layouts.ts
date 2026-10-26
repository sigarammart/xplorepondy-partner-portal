import type { Category, ListingMetaGroup } from "@/lib/types";

/** Elementor Theme Builder singles used on xplorepondy.com */
export const ELEMENTOR_LISTING_TEMPLATES = {
  places: { postId: 15493, wpCategories: [210], label: "Tourist Attractions" },
  activities: { postId: 15325, wpCategories: [87], label: "Activities" },
  food: { postId: 22311, wpCategories: [26, 480], label: "Restaurants, cafes, pubs" },
} as const;

const FOOD_SECTIONS = [
  "cafe type",
  "restaurant type",
  "pub type",
  "resto bar",
  "cuisine",
  "cafe amenities",
  "restaurant amenities",
  "pub amenities",
  "amenities",
  "cafe features",
  "restaurant features",
  "features",
  "cafe atmosphere",
  "cafe atmoshphere",
  "atmosphere",
  "accessibility",
  "service options",
  "dining options",
  "crowd",
  "entertainment",
  "drinks & food",
  "best time to visit",
];

const PLACE_SECTIONS = [
  "attraction type",
  "type",
  "amenities",
  "beach amenities",
  "facilities",
  "atmosphere",
  "beach atmosphere",
  "activities",
  "beach activities",
  "accessibility",
  "timings",
  "beach timing",
  "best time to visit",
  "crowd",
  "shopping",
];

const ACTIVITY_SECTIONS = [
  "activity price range",
  "activity duration",
  "activity difficulty",
  "activity type",
  "activity location",
  "activity includes",
  "activity highlights",
  "activity tags",
  "activity available days",
  "activity timings",
  "activity slots limit",
  "activity age limit / groups",
  "activity best time",
  "activity skill level",
  "activity languages",
  "activity featured video",
  "activity amenities",
  "activity age group",
  "activity group size",
  "activity safety level",
];

const STAY_SECTIONS = [
  "property type",
  "property category",
  "hotel amenities",
  "amenities",
  "facilities",
  "accessibility",
  "crowd",
  "best time to visit",
];

const SERVICES_SECTIONS = [
  "services",
  "amenities",
  "facilities",
  "accessibility",
];

const SECTION_ORDER: Record<Category, string[]> = {
  food: FOOD_SECTIONS,
  places: PLACE_SECTIONS,
  activities: ACTIVITY_SECTIONS,
  stay: STAY_SECTIONS,
  services: SERVICES_SECTIONS,
};

export function normalizeGroupTitle(title: string) {
  return title.replace(/\s+/g, " ").replace(/atmoshphere/i, "Atmosphere").trim();
}

export function orderListingGroupsBySavedOrder(category: Category, groups: ListingMetaGroup[], savedOrder?: string[]): ListingMetaGroup[] {
  const fallback = orderListingGroups(category, groups);
  if (!savedOrder?.length) return fallback;
  const normalize = (value: string) => value.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "").trim();
  const ranks = new Map(savedOrder.map((label, index) => [normalize(label), index]));
  return fallback.map((group, index) => ({ group, index, rank: ranks.get(normalize(group.title)) }))
    .sort((a, b) => {
      if (a.rank != null && b.rank != null) return a.rank - b.rank || a.index - b.index;
      if (a.rank != null) return -1;
      if (b.rank != null) return 1;
      return a.index - b.index;
    }).map(({ group }) => group);
}

export function orderListingGroups(category: Category, groups: ListingMetaGroup[]): ListingMetaGroup[] {
  const order = SECTION_ORDER[category] ?? [];
  const rank = (title: string) => {
    const key = title.toLowerCase().replace(/atmoshphere/g, "atmosphere");
    const exact = order.indexOf(key);
    if (exact >= 0) return exact;
    return order.findIndex((s) => key.includes(s) || s.includes(key));
  };
  return [...groups]
    .map((g) => ({ ...g, title: normalizeGroupTitle(g.title) }))
    .sort((a, b) => {
      const ar = rank(a.title);
      const br = rank(b.title);
      const av = ar < 0 ? 1000 : ar;
      const bv = br < 0 ? 1000 : br;
      return av - bv;
    });
}

/** Single-listing field sets. Only these CMB2/Jet keys are parsed and shown. */
export type ListingFieldProfile =
  | "dining"
  | "cafe"
  | "restaurant"
  | "restopub"
  | "restobar"
  | "attraction"
  | "beach"
  | "activity"
  | "stay"
  | "rental"
  | "service";

const COMMON_KEYS = [
  "listing-package",
  "xp_rating",
  "offer1_details",
  "offer2_details",
  "listing_tagline",
  "features_must_try",
] as const;

const DINING_KEYS = [
  "dining_menu_images",
  "accessibility",
  "service_options",
  "dining_options",
  "crowd",
  "peak_hours",
  "price_for_two",
] as const;

const CAFE_KEYS = [
  "cafe_type",
  "cafe_amenities",
  "cafe_features",
  "cafe_atmosphere",
] as const;

const RESTAURANT_KEYS = [
  "restaurant_service_options",
  "restaurant_amenities",
  "price_for_two",
  "dine_in_experience",
] as const;

const RESTOPUB_KEYS = [
  "pub_drinks_amp_food",
  "pub_entertainment",
  "pub_sports_and_media",
  "pub_outdoor_spaces",
  "pub_seating_and_vibe",
  "pub_other_amenities",
] as const;

const RESTOBAR_KEYS = [
  "food_amp_dining",
  "bar_amp_drinks",
  "entertainment_amp_atmosphere",
  "outdoor_amp_space",
  "other_amenities",
] as const;

const ATTRACTION_KEYS = [
  "spot_best_time_to_visit",
  "visit_duration",
  "entry_type",
  "entry_fee",
  "online_booking",
  "booking_url",
  "parking_availability",
  "wheelchair_accessible",
  "best_spot_for",
  "spot_known_for",
] as const;

const BEACH_KEYS = [
  "beach_amenities",
  "beach_amenities_details",
  "beach_atmosphere",
  "beach_activities",
  "beach_activity_details",
  "beach_shopping",
  "beach_timing_infos",
  "best_time_to_visit",
] as const;

const ACTIVITY_KEYS = [
  "_activity_price_range",
  "_activity_duration",
  "activity_difficulty",
  "_activity_type",
  "_activity_location",
  "_activity_includes",
  "_activity_highlights",
  "_activity_tags",
  "_activity_available_days",
  "_activity_timings",
  "_activity_slots_limit",
  "_activity_age_limit",
  "activity_best_time",
  "_activity_skill_level",
  "_activity_languages",
  "activity_featured_video",
  "_activity_amenities",
  "_activity_age_group",
  "_activity_group_size",
  "_activity_safety_level",
] as const;

const STAY_KEYS = [
  "property_type",
  "property_category",
  "hotel_facilities",
  "hotel_amenities",
  "amenities",
  "facilities",
  "accessibility",
  "crowd",
  "best_time_to_visit",
] as const;

const RENTAL_KEYS = [
  "rental_type",
  "rental_duration",
  "rental_price",
  "rental_price_range",
  "bike_models",
  "car_models",
  "vehicle_models",
  "vehicle_type",
  "vehicle_features",
  "rental_features",
  "rental_includes",
  "safety_features",
  "helmet",
  "insurance",
  "pickup_dropoff",
  "available_days",
  "timings",
  "accessibility",
] as const;

const SERVICE_KEYS = [
  "service_type",
  "service_category",
  "service_options",
  "services",
  "amenities",
  "facilities",
  "accessibility",
  "available_days",
  "timings",
  "crowd",
  "best_time_to_visit",
] as const;

const PROFILE_KEYS: Record<ListingFieldProfile, readonly string[]> = {
  dining: [...COMMON_KEYS, ...DINING_KEYS],
  cafe: [...COMMON_KEYS, ...DINING_KEYS, ...CAFE_KEYS],
  restaurant: [...COMMON_KEYS, ...DINING_KEYS, ...RESTAURANT_KEYS],
  restopub: [...COMMON_KEYS, ...DINING_KEYS, ...RESTOPUB_KEYS],
  restobar: [...COMMON_KEYS, ...DINING_KEYS, ...RESTOBAR_KEYS],
  attraction: [...COMMON_KEYS, ...ATTRACTION_KEYS],
  beach: [...COMMON_KEYS, ...ATTRACTION_KEYS, ...BEACH_KEYS],
  activity: [...COMMON_KEYS, ...ACTIVITY_KEYS],
  stay: [...COMMON_KEYS, ...STAY_KEYS],
  rental: [...COMMON_KEYS, ...RENTAL_KEYS],
  service: [...COMMON_KEYS, ...SERVICE_KEYS],
};
const KEY_ALIASES: Record<string, string[]> = {
  price_range_filter: ["price range", "price range filter"],
  listing_tagline: ["tagline", "listing tagline"],
  features_must_try: ["must try", "features must try", "features known for", "well known for"],
  cafe_type: ["cafe type"],
  cafe_amenities: ["cafe amenities"],
  cafe_features: ["cafe features"],
  cafe_atmosphere: ["cafe atmosphere", "cafe atmoshphere"],
  restaurant_service_options: ["restaurant service options"],
  restaurant_amenities: ["restaurant amenities"],
  dine_in_experience: ["dine in experience", "dine-in experience"],
  accessibility: ["accessibility"],
  service_options: ["service options"],
  dining_options: ["dining options"],
  crowd: ["crowd"],
  peak_hours: ["peak hours"],
  price_for_two: ["price for two"],
  _editor_note: ["editor note", "editor's note", "editors note"],
  pub_drinks_amp_food: ["drinks & food", "drinks and food", "pub drinks & food"],
  pub_entertainment: ["pub entertainment", "entertainment"],
  pub_sports_and_media: ["sports and media", "sports & media", "pub sports", "pub sports and media"],
  pub_outdoor_spaces: ["outdoor spaces", "pub outdoor", "pub outdoor spaces"],
  pub_seating_and_vibe: ["seating and vibe", "seating & vibe", "pub seating and vibe"],
  pub_other_amenities: ["pub other amenities"],
  food_amp_dining: ["food & dining", "food and dining"],
  bar_amp_drinks: ["bar & drinks", "bar and drinks"],
  entertainment_amp_atmosphere: ["entertainment & atmosphere", "entertainment and atmosphere"],
  outdoor_amp_space: ["outdoor & space", "outdoor and space"],
  other_amenities: ["other amenities"],
  spot_best_time_to_visit: ["spot best time to visit", "best time to visit"],
  visit_duration: ["visit duration", "duration", "time needed"],
  entry_type: ["entry type", "entry"],
  online_booking: ["online booking"],
  parking_availability: ["parking availability", "parking"],
  wheelchair_accessible: ["wheelchair accessible", "wheelchair", "accessibility"],
  best_spot_for: ["best spot for", "best for"],
  spot_known_for: ["spot known for", "known for"],
  beach_amenities: ["beach amenities"],
  beach_amenities_details: ["beach amenities details", "amenity details"],
  beach_atmosphere: ["beach atmosphere"],
  beach_activities: ["beach activities"],
  beach_activity_details: ["beach activity details", "activity details"],
  beach_shopping: ["beach shopping", "shopping"],
  beach_timing_infos: ["beach timing", "timings", "timing"],
  _activity_duration: ["activity duration", "duration"],
  activity_difficulty: ["activity difficulty", "difficulty"],
  _activity_type: ["activity type"],
  _activity_location: ["activity location", "location"],
  _activity_price_range: ["activity price range", "price range"],
  _activity_includes: ["activity includes", "includes", "what's included"],
  _activity_highlights: ["activity highlights", "highlights"],
  _activity_tags: ["activity tags", "tags"],
  _activity_available_days: ["activity available days", "available days"],
  _activity_timings: ["activity timings", "timings", "timing"],
  _activity_slots_limit: ["activity slots limit", "slots limit"],
  _activity_age_limit: ["activity age limit / groups", "activity age limit", "age limit / groups", "age limit"],
  activity_best_time: ["activity best time", "best time"],
  _activity_skill_level: ["activity skill level", "skill level"],
  _activity_languages: ["activity languages", "languages"],
  activity_featured_video: ["activity featured video", "featured video"],
  _activity_amenities: ["activity amenities", "amenities"],
  _activity_age_group: ["activity age group", "age group"],
  _activity_group_size: ["activity group size", "group size"],
  _activity_safety_level: ["activity safety level", "safety level"],
};

function keyLabel(key: string) {
  return key
    .replace(/^_/, "")
    .replace(/_amp_/g, " & ")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function aliasesFor(key: string) {
  return KEY_ALIASES[key] ?? [key.replace(/^_/, "").replace(/_amp_/g, " & ").replace(/_/g, " ")];
}

function titleKey(title: string) {
  return title
    .toLowerCase()
    .replace(/atmoshphere/g, "atmosphere")
    .replace(/&/g, "&")
    .replace(/['’]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[:\s]+$/g, "");
}

export function profileKeys(profile: ListingFieldProfile) {
  return PROFILE_KEYS[profile];
}

/** Children of listing_category 210 (tourist-attractions), including the parent. */
const ATTRACTION_SLUGS = new Set([
  "tourist-attractions",
  "archaeological-sites",
  "art-galleries",
  "backwaters-mangroves",
  "beaches",
  "caves-rock-formations",
  "cemeteries-memorials",
  "cultural-centres",
  "heritage-sites",
  "heritage-streets",
  "historical-site",
  "lakes-water-bodies",
  "libraries-literary-places",
  "lighthouses",
  "markets-bazaars",
  "monuments-and-statues",
  "museum",
  "nature-eco-spots",
  "offbeat-experiences",
  "parks-gardens",
  "point-of-interest",
  "scenic-spots",
  "spiritual-places",
]);

export function profileFromSlugs(slugs: string[]): ListingFieldProfile | null {
  const parts = slugs.map((s) => s.toLowerCase().trim()).filter(Boolean);
  const blob = parts.join(" ");

  // Eat & Drink: Dining is the shared base, with the listing subtype adding
  // its own JetEngine fields.
  if (/\bresto-?bars?\b|\brestobars?\b/.test(blob)) return "restobar";
  if (/\bresto-?pubs?\b|\brestopubs?\b/.test(blob)) return "restopub";
  if (/\bcafes?\b/.test(blob)) return "cafe";
  if (/\brestaurants?\b/.test(blob)) return "restaurant";

  // Places to Visit: every attraction gets the attraction fields; beaches
  // additionally receive the beach-specific fields.
  if (/\bbeaches?\b/.test(blob)) return "beach";
  if (parts.some((s) => ATTRACTION_SLUGS.has(s) || s === "attractions")) return "attraction";

  if (parts.includes("activities")) return "activity";
  if (
    parts.includes("accommodation") ||
    parts.some((s) =>
      ["hotels", "resort", "guest-house", "hostels", "homestay", "bed-breakfasts", "boutique-hotels", "campsites", "cottages", "farm-stays", "serviced-apartments"].includes(s),
    )
  ) return "stay";
  if (parts.includes("rentals") || parts.some((s) => ["bike-rental", "car-rental"].includes(s))) return "rental";
  if (
    parts.includes("services") ||
    parts.some((s) =>
      s.endsWith("-services") ||
      ["saloon-spa", "clinics", "hospitals", "pharmacies", "banks-atms", "currency-exchange"].includes(s),
    )
  ) return "service";

  return null;
}
export function headingMatchesProfile(profile: ListingFieldProfile | null, title: string) {
  if (!profile) return true;
  const key = titleKey(title);
  return profileKeys(profile).some((meta) => aliasesFor(meta).some((alias) => titleKey(alias) === key));
}

export function filterListingGroups(profile: ListingFieldProfile | null, groups: ListingMetaGroup[]) {
  if (!profile) return groups;
  const keys = profileKeys(profile);
  const rank = (title: string) => {
    const key = titleKey(title);
    const byAlias = keys.findIndex((meta) => aliasesFor(meta).some((alias) => titleKey(alias) === key));
    if (byAlias >= 0) return byAlias;
    return keys.findIndex((meta) => keyLabel(meta).toLowerCase() === key);
  };
  return groups
    .filter((g) => headingMatchesProfile(profile, g.title))
    .map((g) => {
      const meta = keys.find((key) => aliasesFor(key).some((alias) => titleKey(alias) === titleKey(g.title)));
      return meta ? { ...g, title: keyLabel(meta) } : g;
    })
    .sort((a, b) => (rank(a.title) < 0 ? 99 : rank(a.title)) - (rank(b.title) < 0 ? 99 : rank(b.title)));
}
