import type { Category } from "@/lib/types";
import { decodeEntities } from "@/lib/utils";

export const WP_PARENT_ARCHIVES: Array<{
  slug: string;
  category: Category;
  label: string;
}> = [
  { slug: "tourist-attractions", category: "places", label: "Places to visit" },
  { slug: "activities", category: "activities", label: "Things to do" },
  { slug: "food-beverage", category: "food", label: "Eat & drink" },
  { slug: "accommodation", category: "stay", label: "Stay" },
  { slug: "rentals", category: "rentals", label: "Rentals" },
  { slug: "services", category: "services", label: "Services" },
];

/** Extra parent archives are kept here only for compatibility with direct
 * archive routing; Rentals is now a primary Explore category. */
export const WP_EXTRA_ARCHIVES: Array<{ slug: string; category: Category }> = [];

const PARENT_TO_APP: Record<string, Category> = {
  "tourist-attractions": "places",
  activities: "activities",
  rentals: "rentals",
  services: "services",
  "transport-mobility": "services",
  "health-medical": "services",
  "emergency-safety": "services",
  "events-photography": "services",
  "money-finance": "services",
  "professional-legal": "services",
  "travel-tourist-services": "services",
  "traveller-essentials": "services",
  "pet-services": "services",
  events: "activities",
  "food-beverage": "food",
  accommodation: "stay",
};

const CHILD_TO_PARENT: Record<string, string> = {
  beaches: "tourist-attractions",
  "spiritual-places": "tourist-attractions",
  "point-of-interest": "tourist-attractions",
  museum: "tourist-attractions",
  "historical-site": "tourist-attractions",
  "monuments-and-statues": "tourist-attractions",
  "parks-gardens": "tourist-attractions",
  "art-galleries": "tourist-attractions",
  "archaeological-sites": "tourist-attractions",
  "backwaters-mangroves": "tourist-attractions",
  "caves-rock-formations": "tourist-attractions",
  "cemeteries-memorials": "tourist-attractions",
  "cultural-centres": "tourist-attractions",
  "heritage-sites": "tourist-attractions",
  "heritage-streets": "tourist-attractions",
  "lakes-water-bodies": "tourist-attractions",
  "libraries-literary-places": "tourist-attractions",
  lighthouses: "tourist-attractions",
  "markets-bazaars": "tourist-attractions",
  "nature-eco-spots": "tourist-attractions",
  "offbeat-experiences": "tourist-attractions",
  "scenic-spots": "tourist-attractions",
  "water-bodies": "tourist-attractions",
  temples: "tourist-attractions",
  churches: "tourist-attractions",
  ashrams: "tourist-attractions",
  "shopping-bazaars": "activities",
  "adventure-sports": "activities",
  photography: "events-photography",
  "classes-workshops": "activities",
  "nightlife-experiences": "activities",
  "art-craft-workshops": "activities",
  "bird-watching": "activities",
  "boat-rides": "activities",
  "cooking-classes": "activities",
  "cultural-experiences": "activities",
  cycling: "activities",
  "dance-music": "activities",
  "family-activities": "activities",
  fishing: "activities",
  "guided-tours": "activities",
  "horse-riding": "activities",
  kayaking: "activities",
  "kids-activities": "activities",
  "land-activities": "activities",
  "scuba-diving": "activities",
  "shopping-experiences": "activities",
  snorkelling: "activities",
  surfing: "activities",
  "tours-sightseeing": "activities",
  "trekking-hiking": "activities",
  "water-activities": "activities",
  "wellness-experiences": "activities",
  "yoga-meditation": "activities",
  "bike-rental": "rentals",
  "car-rental": "rentals",
  "resto-pubs": "food-beverage",
  cafes: "food-beverage",
  restaurants: "food-beverage",
  "resto-bars": "food-beverage",
  "mess-home-foods": "food-beverage",
  "food-cart": "food-beverage",
  pizzeria: "food-beverage",
  bakeries: "food-beverage",
  "cloud-kitchens": "food-beverage",
  "dessert-ice-cream": "food-beverage",
  lounges: "food-beverage",
  "street-food": "food-beverage",
  hotels: "accommodation",
  resort: "accommodation",
  "guest-house": "accommodation",
  hostels: "accommodation",
  homestay: "accommodation",
  villas: "accommodation",
  "bed-breakfasts": "accommodation",
  "boutique-hotels": "accommodation",
  campsites: "accommodation",
  cottages: "accommodation",
  "farm-stays": "accommodation",
  "serviced-apartments": "accommodation",
  "saloon-spa": "services",
  "support-services": "services",
  "health-medical": "services",
  "medical-services": "health-medical",
  "emergency-safety": "services",
  "emergency-services": "emergency-safety",
  "police-services": "emergency-safety",
  "legal-services": "professional-legal",
  "insurance-services": "professional-legal",
  "translation-services": "professional-legal",
  "professional-legal": "services",
  "banks-atms": "money-finance",
  "money-finance": "services",
  "currency-exchange": "money-finance",
  "money-transfer": "money-finance",
  clinics: "health-medical",
  "dental-services": "health-medical",
  hospitals: "health-medical",
  pharmacies: "health-medical",
  "events-photography": "services",
  "event-services": "events-photography",
  "wedding-services": "events-photography",
  "laundry-dry-cleaning": "traveller-essentials",
  "courier-services": "traveller-essentials",
  "supermarkets-grocery": "traveller-essentials",
  "traveller-essentials": "services",
  "pet-services": "services",
  "pet-boarding": "pet-services",
  "pet-grooming": "pet-services",
  "veterinary-services": "pet-services",
  "photography-services": "events-photography",
  "repair-maintenance": "services",
  "transport-mobility": "services",
  "airport-transfers": "transport-mobility",
  "bike-scooter-repair": "transport-mobility",
  "car-repair-service": "transport-mobility",
  "ev-charging": "transport-mobility",
  "fuel-stations": "transport-mobility",
  "taxi-cab-services": "transport-mobility",
  "tour-operator": "travel-tourist-services",
  "tourist-information-centres": "travel-tourist-services",
  "tourist-support-services": "travel-tourist-services",
  "transportation-services": "services",
  "travel-agencies": "travel-tourist-services",
  "travel-tourist-services": "services",
};

export const ARCHIVE_SLUGS = [
  ...WP_PARENT_ARCHIVES.map((row) => row.slug),
  ...WP_EXTRA_ARCHIVES.map((row) => row.slug),
  "hotels",
  "guest-house",
  "resort",
  "hostels",
  "homestay",
  "cafes",
  "restaurants",
  "resto-pubs",
  "resto-bars",
  "beaches",
  "spiritual-places",
  "saloon-spa",
  "bike-rental",
];

export const DEEP_ARCHIVE_SLUGS = new Set([
  ...WP_PARENT_ARCHIVES.map((row) => row.slug),
  ...WP_EXTRA_ARCHIVES.map((row) => row.slug),
]);

export function archiveCategory(slug: string): Category | undefined {
  let current = slug;
  const seen = new Set<string>();
  while (current && !seen.has(current)) {
    seen.add(current);
    const mapped = PARENT_TO_APP[current];
    if (mapped) return mapped;
    current = CHILD_TO_PARENT[current];
  }
  return PARENT_TO_APP[slug];
}

export function isSecondaryCategorySlug(slug: string, category?: Category | "all"): boolean {
  if (!slug || TYPE_PARENT_SLUGS.has(slug)) return false;
  const appCategory = archiveCategory(slug);
  if (!appCategory) return false;
  return category === undefined || category === "all" || appCategory === category;
}

const TYPE_PARENT_SLUGS = new Set([
  ...WP_PARENT_ARCHIVES.map((row) => row.slug),
  ...WP_EXTRA_ARCHIVES.map((row) => row.slug),
  "transport-mobility",
  "health-medical",
  "emergency-safety",
  "events-photography",
  "money-finance",
  "professional-legal",
  "travel-tourist-services",
  "traveller-essentials",
  "pet-services",
  "events",
  "listing",
]);

export function categoryFromKindName(kind: string): Category | undefined {
  const slug = decodeEntities(kind)
    .toLowerCase()
    .replace(/&/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) return undefined;
  return archiveCategory(slug);
}

export type ListingCategoryTerm = {
  id: number;
  slug: string;
  name: string;
  parent: number;
  count: number;
  categoryPosition?: number | null;
  image?: string;
  imageId?: number;
};

export type SubcategoryOption = {
  slug: string;
  name: string;
  count: number;
  categoryPosition?: number | null;
};

/** Snapshot of populated listing_category leaves so chips render on first paint
 * even before the live WordPress taxonomy request returns. */
export const FALLBACK_SUBCATEGORIES: Array<SubcategoryOption & { category: Category }> = [
  { slug: "spiritual-places", name: "Spiritual Places", count: 32, categoryPosition: 2, category: "places" },
  { slug: "beaches", name: "Beaches", count: 14, categoryPosition: 1, category: "places" },
  { slug: "point-of-interest", name: "Point of Interest", count: 11, categoryPosition: 4, category: "places" },
  { slug: "museum", name: "Museum", count: 5, category: "places" },
  { slug: "parks-gardens", name: "Parks & Gardens", count: 4, category: "places" },
  { slug: "historical-site", name: "Historical Site", count: 3, categoryPosition: 5, category: "places" },
  { slug: "monuments-and-statues", name: "Monuments and Statues", count: 3, categoryPosition: 3, category: "places" },
  { slug: "art-galleries", name: "Art Galleries", count: 2, category: "places" },
  { slug: "water-bodies", name: "Water Bodies", count: 1, category: "places" },
  { slug: "classes-workshops", name: "Classes & Workshops", count: 38, categoryPosition: 4, category: "activities" },
  { slug: "adventure-sports", name: "Adventure Sports", count: 32, categoryPosition: 1, category: "activities" },
  { slug: "shopping-bazaars", name: "Shopping & Bazaars", count: 25, categoryPosition: 7, category: "activities" },
  { slug: "boat-rides", name: "Boat Rides", count: 21, categoryPosition: 5, category: "activities" },
  { slug: "water-activities", name: "Water Activities", count: 17, categoryPosition: 2, category: "activities" },
  { slug: "dance-music", name: "Dance & Music", count: 11, category: "activities" },
  { slug: "kayaking", name: "Kayaking", count: 7, categoryPosition: 6, category: "activities" },
  { slug: "cooking-classes", name: "Cooking Classes", count: 6, category: "activities" },
  { slug: "scuba-diving", name: "Scuba Diving", count: 6, categoryPosition: 3, category: "activities" },
  { slug: "bird-watching", name: "Bird Watching", count: 5, category: "activities" },
  { slug: "cultural-experiences", name: "Cultural Experiences", count: 5, category: "activities" },
  { slug: "snorkelling", name: "Snorkelling", count: 5, categoryPosition: 8, category: "activities" },
  { slug: "nightlife-experiences", name: "Nightlife Experiences", count: 4, category: "activities" },
  { slug: "horse-riding", name: "Horse Riding", count: 3, category: "activities" },
  { slug: "cycling", name: "Cycling", count: 2, category: "activities" },
  { slug: "restaurants", name: "Restaurants", count: 131, categoryPosition: 1, category: "food" },
  { slug: "cafes", name: "Cafes", count: 47, categoryPosition: 2, category: "food" },
  { slug: "resto-pubs", name: "Resto Pubs", count: 39, categoryPosition: 3, category: "food" },
  { slug: "pizzeria", name: "Pizzeria", count: 35, categoryPosition: 5, category: "food" },
  { slug: "dessert-ice-cream", name: "Dessert & Ice Cream", count: 27, categoryPosition: 7, category: "food" },
  { slug: "bakeries", name: "Bakeries", count: 26, categoryPosition: 8, category: "food" },
  { slug: "resto-bars", name: "Resto Bars", count: 20, categoryPosition: 4, category: "food" },
  { slug: "mess-home-foods", name: "Mess & Home Foods", count: 17, categoryPosition: 9, category: "food" },
  { slug: "street-food", name: "Street Food", count: 16, categoryPosition: 6, category: "food" },
  { slug: "food-cart", name: "Food Cart", count: 13, categoryPosition: 6, category: "food" },
  { slug: "bike-rental", name: "Bike Rental", count: 12, category: "rentals" },
  { slug: "car-rental", name: "Car Rental", count: 5, category: "rentals" },
  { slug: "hotels", name: "Hotels", count: 20, category: "stay" },
  { slug: "resort", name: "Resort", count: 15, category: "stay" },
  { slug: "guest-house", name: "Guest House", count: 13, category: "stay" },
  { slug: "hostels", name: "Hostels", count: 6, category: "stay" },
  { slug: "villas", name: "Villas", count: 6, category: "stay" },
  { slug: "homestay", name: "Homestay", count: 2, category: "stay" },
  { slug: "pharmacies", name: "Pharmacies", count: 53, category: "services" },
  { slug: "fuel-stations", name: "Fuel Stations", count: 40, category: "services" },
  { slug: "saloon-spa", name: "Saloon & Spa", count: 33, category: "services" },
  { slug: "banks-atms", name: "Banks & ATMs", count: 30, category: "services" },
  { slug: "hospitals", name: "Hospitals", count: 29, category: "services" },
  { slug: "ev-charging", name: "EV Charging", count: 25, category: "services" },
  { slug: "clinics", name: "Clinics", count: 15, category: "services" },
  { slug: "photography", name: "Photography", count: 11, category: "services" },
  { slug: "medical-services", name: "Medical Services", count: 4, category: "services" },
  { slug: "emergency-services", name: "Emergency Services", count: 3, category: "services" },
  { slug: "legal-services", name: "Legal Services", count: 1, category: "services" },
];

function appCategoryFromTerm(
  term: ListingCategoryTerm,
  byId: Map<number, ListingCategoryTerm>,
): Category | undefined {
  let current: ListingCategoryTerm | undefined = term;
  const seen = new Set<number>();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    const mapped = PARENT_TO_APP[current.slug] ?? archiveCategory(current.slug);
    if (mapped) return mapped;
    current = byId.get(current.parent);
  }
  return archiveCategory(term.slug);
}

export function subcategoryOptions(
  terms: ListingCategoryTerm[],
  category: Category | "all",
): SubcategoryOption[] {
  if (category === "all") return [];
  const byId = new Map(terms.map((term) => [term.id, term]));
  const parentSlug = WP_PARENT_ARCHIVES.find((row) => row.category === category)?.slug;
  const out = new Map<string, SubcategoryOption>();

  for (const term of terms) {
    if (!term.slug || TYPE_PARENT_SLUGS.has(term.slug) || (term.count ?? 0) <= 0) continue;
    if (parentSlug && term.slug === parentSlug) continue;
    const app = appCategoryFromTerm(term, byId);
    if (app !== category) continue;
    out.set(term.slug, {
      slug: term.slug,
      name: decodeEntities(term.name || term.slug.replace(/-/g, " ")),
      count: term.count,
      categoryPosition: term.categoryPosition,
    });
  }

  if (out.size === 0) {
    for (const row of FALLBACK_SUBCATEGORIES) {
      if (row.category !== category) continue;
      out.set(row.slug, {
        slug: row.slug,
        name: row.name,
        count: row.count,
        categoryPosition: row.categoryPosition,
      });
    }
  }

  // Sort terms with an explicit WordPress category_position first.
  // Terms without a position stay in their original WordPress/API order.
  return [...out.values()]
    .map((option, index) => ({ option, index }))
    .sort((a, b) => {
      const aPosition = Number.isFinite(a.option.categoryPosition) && Number(a.option.categoryPosition) > 0
        ? Number(a.option.categoryPosition)
        : null;
      const bPosition = Number.isFinite(b.option.categoryPosition) && Number(b.option.categoryPosition) > 0
        ? Number(b.option.categoryPosition)
        : null;

      if (aPosition !== null && bPosition !== null) {
        return aPosition - bPosition || a.index - b.index;
      }
      if (aPosition !== null) return -1;
      if (bPosition !== null) return 1;
      return a.index - b.index;
    })
    .map(({ option }) => option);
}
