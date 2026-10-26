import { useEffect, useState } from "react";
import { MapPin, Search } from "lucide-react";
import { searchGooglePlacesOnly, resolvePlace, type PlaceSuggestion } from "@/lib/places";
import { fetchWpCatalogPage } from "@/lib/wp-api";
import type { Listing } from "@/lib/types";
import type { FormEvent } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, CheckCircle2, ChevronLeft, ChevronRight, LoaderCircle, Save, ShieldCheck, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAppLoggedIn } from "@/lib/app-session";
import { fetchExperienceCategories, fetchExperienceLocations, fetchExperienceForEdit, submitExperienceFromApp, updateExperienceFromApp, type ExperienceDraft, type ExperienceTerm } from "@/lib/experiences-account-api";
import { useSession } from "@/store/session";

type Props = { mode: "create" | "edit"; experienceId?: number };
type Fields = Record<string, string>;
type ItineraryStop = Record<string, unknown>;
type AvailabilitySession = { time: string; capacity: string; price: string };
type AvailabilityDay = { date: string; sessions: AvailabilitySession[] };
const blankStop = (): ItineraryStop => ({ title: "", duration: "", description: "", address: "", lat: "", lng: "" });
const blankSession = (): AvailabilitySession => ({ time: "09:00", capacity: "10", price: "" });
function parseItinerary(value: unknown): ItineraryStop[] {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value || "[]") : value;
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item === "object" && !Array.isArray(item)) as ItineraryStop[] : [];
  } catch { return []; }
}
function parseAvailability(value: unknown): AvailabilityDay[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([date, rawSessions]) => {
    if (!Array.isArray(rawSessions)) return [];
    return [{ date, sessions: rawSessions.filter((session) => session && typeof session === "object").map((session) => {
      const item = session as Record<string, unknown>;
      return { time: String(item.time ?? "09:00"), capacity: String(item.capacity ?? 10), price: item.price == null ? "" : String(item.price) };
    }) }];
  });
}
function formatAvailability(days: AvailabilityDay[]) {
  return Object.fromEntries(days.filter((day) => day.date).map((day) => [day.date, day.sessions.map((session) => ({
    time: session.time,
    capacity: Math.max(1, Number(session.capacity) || 1),
    ...(session.price.trim() !== "" ? { price: Math.max(0, Number(session.price) || 0) } : {}),
  }))]));
}
const blankFields = (): Fields => ({
  provider_name: "", provider_email: "", price: "0", currency: "INR", pricing_model: "per_person", duration: "",
  min_participants: "1", max_participants: "", languages: "", booking_type: "request", pickup_included: "no",
  private_group: "no", reserve_pay_later: "no", cancellation_hours: "", highlights: "", includes: "", excludes: "",
  important_info: "", faqs: "", meeting_point_name: "", meeting_point_address: "", meeting_point_lat: "",
  meeting_point_lng: "", itinerary_json: "[]", cancellation_policy: "", refund_policy: "", provider_details: "",
});
const inputClass = "mt-1.5 w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary";
const labelClass = "block text-sm font-medium";
const steps = ["Experience details", "Provider & pricing", "Meeting point & itinerary", "Availability & policies"];
function readImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Could not read the selected image."));
    reader.onerror = () => reject(new Error("Could not read the selected image."));
    reader.readAsDataURL(file);
  });
}
function stringField(fields: Record<string, unknown>, key: string, fallback = "") {
  const value = fields[key];
  return value == null ? fallback : typeof value === "string" ? value : String(value);
}

type PlaceAutocompleteProps = {
  value: string;
  onSelect: (place: PlaceSuggestion) => void;
  placeholder?: string;
  label?: string;
};
function PlaceAutocomplete({ value, onSelect, placeholder = "Search Google Maps for a place or address…", label = "Search Google Maps" }: PlaceAutocompleteProps) {
  const [query, setQuery] = useState(value);
  const [results, setResults] = useState<PlaceSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => { setQuery(value); }, [value]);
  useEffect(() => {
    const text = query.trim();
    if (text.length < 3 || text === value.trim()) { setResults([]); setOpen(false); setSearching(false); return; }
    let active = true;
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const hits = await searchGooglePlacesOnly(text);
        if (active) { setResults(hits); setOpen(true); }
      } catch {
        if (active) { setResults([]); setOpen(false); }
      } finally { if (active) setSearching(false); }
    }, 300);
    return () => { active = false; window.clearTimeout(timer); };
  }, [query, value]);
  async function choose(hit: PlaceSuggestion) {
    setResolving(true);
    try {
      const resolved = await resolvePlace(hit);
      onSelect(resolved);
      setQuery(resolved.label || hit.label);
      setOpen(false);
      setResults([]);
    } finally { setResolving(false); }
  }
  return <div className="relative">
    <label className={labelClass}>{label}</label>
    <div className="relative mt-1.5">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <input className={inputClass + " pl-9"} type="search" autoComplete="off" value={query} onFocus={() => { if (results.length) setOpen(true); }} onChange={(event) => setQuery(event.target.value)} placeholder={placeholder} />
      {(searching || resolving) && <LoaderCircle className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
    </div>
    {open && results.length > 0 && <div className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-border bg-card p-1 shadow-lg" role="listbox">{results.map((hit) => <button key={hit.id} type="button" className="flex w-full items-start gap-2 rounded-lg px-3 py-2.5 text-left text-sm hover:bg-muted" onMouseDown={(event) => event.preventDefault()} onClick={() => void choose(hit)}><MapPin className="mt-0.5 size-4 shrink-0 text-primary" /><span>{hit.label}</span></button>)}</div>}
    {open && !searching && query.trim().length >= 3 && results.length === 0 && <div className="absolute z-30 mt-1 w-full rounded-xl border border-border bg-card p-3 text-sm text-muted-foreground">Google Places returned no suggestions. Check that the Places API is enabled and the API key allows app.xplorepondy.com, or enter the address manually.</div>}
    <p className="mt-1 text-xs text-muted-foreground">Choose a suggestion to fill the address and coordinates automatically.</p>
  </div>;
}

export function ExperienceEditor({ mode, experienceId }: Props) {
  const navigate = useNavigate();
  const { loggedIn, wpUser, grokUser } = useAppLoggedIn();
  const identityToken = useSession((state) => state.wpIdentityToken);
  const sessionEmail = useSession((state) => state.user?.email ?? "");
  const email = (grokUser?.primaryEmail || wpUser?.email || sessionEmail).trim().toLowerCase();
  const displayName = String(grokUser?.displayName || wpUser?.name || "");
  const [step, setStep] = useState(1);
  const [categories, setCategories] = useState<ExperienceTerm[]>([]);
  const [locations, setLocations] = useState<ExperienceTerm[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [existing, setExisting] = useState<ExperienceDraft | null>(null);
  const [title, setTitle] = useState("");
  const [excerpt, setExcerpt] = useState("");
  const [content, setContent] = useState("");
  const [categoryId, setCategoryId] = useState(0);
  const [locationId, setLocationId] = useState(0);
  const [fields, setFields] = useState<Fields>(() => blankFields());
  const [availabilityDays, setAvailabilityDays] = useState<AvailabilityDay[]>([]);
  const [itineraryStops, setItineraryStops] = useState<ItineraryStop[]>([]);
  const [listingQuery, setListingQuery] = useState("");
  const [listingResults, setListingResults] = useState<Listing[]>([]);
  const [listingSearchBusy, setListingSearchBusy] = useState(false);
  const [listingSearchError, setListingSearchError] = useState("");
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [galleryFiles, setGalleryFiles] = useState<File[]>([]);
  const [consent, setConsent] = useState(false);


  useEffect(() => {
    const query = listingQuery.trim();
    if (query.length < 2) {
      setListingResults([]);
      setListingSearchBusy(false);
      setListingSearchError("");
      return;
    }
    let active = true;
    const timer = window.setTimeout(async () => {
      setListingSearchBusy(true);
      setListingSearchError("");
      try {
        // WordPress search can match post content/address before the title.
        // Query the phrase and its individual words, merge candidates, then
        // explicitly rank title matches before tags and descriptive content.
        const words = [...new Set(query.toLocaleLowerCase().split(/\s+/).filter(Boolean))].slice(0, 4);
        const searches = [...new Set([query, ...words])].slice(0, 5);
        const pages = await Promise.allSettled(searches.map((term) =>
          fetchWpCatalogPage({ data: { page: 1, perPage: 100, search: term } })
        ));
        const byId = new Map<number, Listing>();
        for (const page of pages) {
          if (page.status !== "fulfilled") continue;
          for (const listing of page.value.listings) {
            if (Number.isInteger(listing.wpId) && (listing.wpId ?? 0) > 0) byId.set(listing.wpId!, listing);
          }
        }
        const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase();
        const terms = words.map(normalize);
        const hasTitleMatch = [...byId.values()].some((listing) => {
          const title = normalize(listing.name || "");
          return terms.length > 0 && terms.some((term) => title.includes(term));
        });
        // WordPress REST search may match post content but miss a title result
        // for a short word. If so, scan catalog pages and rank locally.
        if (!hasTitleMatch) {
          try {
            const firstPage = await fetchWpCatalogPage({ data: { page: 1, perPage: 100 } });
            for (const listing of firstPage.listings) if (listing.wpId) byId.set(listing.wpId, listing);
            const pageNumbers = Array.from({ length: Math.max(0, firstPage.pages - 1) }, (_, index) => index + 2);
            const rest = await Promise.allSettled(pageNumbers.map((page) =>
              fetchWpCatalogPage({ data: { page, perPage: 100 } })
            ));
            for (const page of rest) {
              if (page.status !== "fulfilled") continue;
              for (const listing of page.value.listings) if (listing.wpId) byId.set(listing.wpId, listing);
            }
          } catch {
            // Keep and rank whatever WordPress search returned if the full scan fails.
          }
        }
        const score = (listing: Listing) => {
          const title = normalize(listing.name || "");
          const tags = normalize([...(listing.tags || []), ...(listing.taxonomies || []).flatMap((group) => group.terms || []).map((term) => typeof term === "string" ? term : String((term as { name?: string }).name || ""))].join(" "));
          const content = normalize([listing.description || "", listing.location || "", listing.address || "", listing.friendlyAddress || ""].join(" "));
          const titleAll = terms.length > 0 && terms.every((term) => title.includes(term));
          const titleAny = terms.some((term) => title.includes(term));
          const tagsAll = terms.length > 0 && terms.every((term) => tags.includes(term));
          const tagsAny = terms.some((term) => tags.includes(term));
          const contentAll = terms.length > 0 && terms.every((term) => content.includes(term));
          const contentAny = terms.some((term) => content.includes(term));
          if (titleAll) return 1000 + (title.includes(normalize(query)) ? 50 : 0);
          if (titleAny) return 900;
          if (tagsAll) return 800;
          if (tagsAny) return 700;
          if (contentAll) return 600;
          if (contentAny) return 500;
          return 0;
        };
        const ranked = [...byId.values()]
          .map((listing) => ({ listing, score: score(listing) }))
          .filter((item) => item.score > 0)
          .sort((a, b) => b.score - a.score || a.listing.name.localeCompare(b.listing.name))
          .slice(0, 12)
          .map((item) => item.listing);
        if (active) {
          setListingResults(ranked);
          setListingSearchError(ranked.length ? "" : "No matching Places found in the Xplore Pondy directory.");
        }
      } catch {
        if (active) {
          setListingResults([]);
          setListingSearchError("Could not search the Places directory. Please try again.");
        }
      } finally {
        if (active) setListingSearchBusy(false);
      }
    }, 300);
    return () => { active = false; window.clearTimeout(timer); };
  }, [listingQuery]);

  function addExistingListing(listing: Listing) {
    const listingId = listing.wpId;
    if (!listingId) return;
    setItineraryStops((items) => {
      if (items.some((item) => Number(item.listing_id) === listingId)) return items;
      return [...items, {
        title: listing.name,
        description: "",
        address: listing.address || listing.friendlyAddress || listing.location || "",
        duration: "",
        lat: listing.lat == null ? "" : String(listing.lat),
        lng: listing.lng == null ? "" : String(listing.lng),
        listing_id: listingId,
        listing_url: listing.siteUrl,
        listing_slug: listing.slug,
      }];
    });
    setListingQuery("");
    setListingResults([]);
    setListingSearchError("");
  }

  useEffect(() => {
    let active = true;
    if (!loggedIn || !email) { setLoading(false); return; }
    setLoading(true);
    setError("");
    // Load the experience independently from supporting dropdown data. A
    // category/location endpoint hiccup must not prevent an owner opening an
    // existing experience for editing.
    const supportingData = Promise.all([
      fetchExperienceCategories({ data: { email, identityToken: identityToken ?? undefined } }).catch(() => [] as ExperienceTerm[]),
      fetchExperienceLocations({ data: { email, identityToken: identityToken ?? undefined } }).catch(() => [] as ExperienceTerm[]),
    ]);
    const experienceData = mode === "edit" && experienceId
      ? fetchExperienceForEdit({ data: { email, identityToken: identityToken ?? undefined, id: experienceId } })
      : Promise.resolve(null);
    Promise.all([supportingData, experienceData]).then(([[cats, locs], loaded]) => {
      if (!active) return;
      setCategories(cats); setLocations(locs);
      if (mode === "edit" && !loaded) {
        throw new Error("The experience details could not be loaded for editing. Please refresh and try again.");
      }
      if (loaded) {
        setExisting(loaded);
        setTitle(loaded.title); setExcerpt(loaded.excerpt || ""); setContent(loaded.content);
        setCategoryId(loaded.category_id || 0); setLocationId(loaded.location_id || 0);
        const next = blankFields();
        for (const key of Object.keys(next)) next[key] = stringField(loaded.fields, key, next[key]);
        next.provider_name = next.provider_name || displayName;
        next.provider_email = next.provider_email || email;
        setFields(next);
        setItineraryStops(parseItinerary(next.itinerary_json));
        setAvailabilityDays(parseAvailability(loaded.availability));
      } else {
        setFields((current) => ({ ...current, provider_name: current.provider_name || displayName, provider_email: current.provider_email || email }));
      }
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : "Could not load experience details.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [loggedIn, email, identityToken, mode, experienceId, displayName]);

  const setField = (key: string, value: string) => setFields((current) => ({ ...current, [key]: value }));
  const currentImage = existing?.featured_image || "";
  const currentGallery = existing?.gallery_images ?? [];
  const stepValid = (target: number) => {
    if (target === 1 && (!title.trim() || !content.trim())) { setError("Enter an experience title and full description before continuing."); return false; }
    if (target === 2 && fields.provider_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.provider_email)) { setError("Enter a valid provider contact email."); return false; }
    if (target === 3 && itineraryStops.some((stop) => !String(stop.title ?? "").trim())) {
      setError("Add a title to each itinerary stop, or remove any empty stops.");
      return false;
    }
    setError(""); return true;
  };
  const updateFieldLines = (key: string, value: string) => setField(key, value);
  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!loggedIn || !email) { setError("Please sign in to manage experiences."); return; }
    if (!consent) { setError("Please confirm the details are accurate and agree to review."); setStep(4); return; }
    if (![1, 2, 3].every(stepValid)) return;
    const availability = formatAvailability(availabilityDays);
    if (availabilityDays.some((day) => !day.date || day.sessions.length === 0 || day.sessions.some((session) =>
      !session.time || !Number.isInteger(Number(session.capacity)) || Number(session.capacity) < 1 ||
      (session.price.trim() !== "" && (!Number.isFinite(Number(session.price)) || Number(session.price) < 0))
    ))) {
      setError("Choose a date and add at least one valid session for each availability date.");
      setStep(4);
      return;
    }
    if (new Set(availabilityDays.map((day) => day.date)).size !== availabilityDays.length) {
      setError("Each availability date must be unique. Add multiple sessions under the same date instead.");
      setStep(4);
      return;
    }
    setSaving(true); setError(""); setSuccess("");
    try {
      const image = coverFile ? await readImage(coverFile) : undefined;
      const gallery = galleryFiles.length ? await Promise.all(galleryFiles.slice(0, 8).map(async (file) => ({ data: await readImage(file), name: file.name }))) : undefined;
      const payload = {
        title: title.trim(), excerpt, content, category_id: categoryId, location_id: locationId,
        fields: { ...fields, itinerary_json: JSON.stringify(itineraryStops), min_participants: fields.min_participants || "1", pickup_included: fields.pickup_included || "no", private_group: fields.private_group || "no", reserve_pay_later: fields.reserve_pay_later || "no" },
        availability,
        ...(image ? { cover_image_data: image, cover_image_name: coverFile?.name } : {}),
        ...(gallery ? { gallery_images: gallery } : {}),
      };
      const result = mode === "edit" && experienceId
        ? await updateExperienceFromApp({ data: { id: experienceId, email, identityToken: identityToken ?? undefined, experience: payload } })
        : await submitExperienceFromApp({ data: { email, identityToken: identityToken ?? undefined, experience: payload } });
      setSuccess(result.message || "Experience submitted for review.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save this experience.");
    } finally { setSaving(false); }
  }

  if (!loggedIn) return <section className="mx-auto my-10 max-w-3xl rounded-2xl border border-border bg-card p-6"><h1 className="font-display text-2xl font-semibold">Sign in to continue</h1><p className="mt-2 text-sm text-muted-foreground">Sign in to submit and manage your experiences.</p><Button className="mt-4" asChild><Link to="/login">Sign in</Link></Button></section>;
  if (success) return <section className="mx-auto my-10 max-w-3xl rounded-2xl border border-emerald-500/30 bg-card p-6 sm:p-8"><CheckCircle2 className="size-10 text-emerald-600" /><h1 className="mt-3 font-display text-2xl font-semibold">{mode === "edit" ? "Changes submitted for review" : "Experience submitted successfully"}</h1><p className="mt-2 text-sm text-muted-foreground">{success}</p><div className="mt-5 flex flex-wrap gap-3"><Button asChild><Link to="/my-experiences">View My Experiences</Link></Button><Button variant="outline" onClick={() => navigate({ to: "/my-experiences" })}>Explore experiences</Button></div></section>;

  return <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
    <Link to="/my-experiences" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Back to My Experiences</Link>
    <div className="mt-5"><p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Experience dashboard</p><h1 className="mt-1 font-display text-3xl font-semibold">{mode === "edit" ? "Edit experience" : "Submit an experience"}</h1><p className="mt-2 text-sm text-muted-foreground">Share authentic Pondicherry experiences with travellers. Submissions and edits are reviewed before publication.</p></div>
    {loading && <div className="mt-6 flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" /> Loading experience details…</div>}
    {error && <div role="alert" className="mt-5 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm">{error}{mode === "edit" && <div className="mt-3"><Button type="button" variant="outline" onClick={() => window.location.reload()}>Retry loading experience</Button></div>}</div>}
    {!loading && !error && <><div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4">{steps.map((label, index) => { const n=index+1; return <button key={label} type="button" onClick={() => { if (n < step || stepValid(step)) setStep(n); }} className={`rounded-xl border px-3 py-3 text-left text-xs transition sm:text-sm ${step===n ? "border-primary bg-primary/5 text-primary" : step>n ? "border-emerald-500/40 bg-emerald-500/5" : "border-border text-muted-foreground"}`}><span className="mb-1 block font-semibold">{n}. {label}</span></button>; })}</div>
    <form onSubmit={handleSubmit} className="mt-4 space-y-5 rounded-2xl border border-border bg-card p-4 shadow-soft sm:p-6">
      {step===1 && <section className="space-y-4"><h2 className="font-display text-xl font-semibold">Experience details</h2>
        <div><label className={labelClass}>Experience title *</label><input className={inputClass} required maxLength={180} value={title} onChange={(e)=>setTitle(e.target.value)} /></div>
        <div><label className={labelClass}>Short summary</label><textarea className={inputClass} rows={2} maxLength={500} value={excerpt} onChange={(e)=>setExcerpt(e.target.value)} /></div>
        <div><label className={labelClass}>Full description *</label><textarea className={inputClass} rows={6} required value={content} onChange={(e)=>setContent(e.target.value)} /></div>
        <div className="grid gap-4 sm:grid-cols-2"><div><label className={labelClass}>Category</label><select className={inputClass} value={categoryId} onChange={(e)=>setCategoryId(Number(e.target.value))}><option value={0}>Choose a category</option>{categories.map((term)=><option key={term.id} value={term.id}>{term.name}</option>)}</select></div><div><label className={labelClass}>Location</label><select className={inputClass} value={locationId} onChange={(e)=>setLocationId(Number(e.target.value))}><option value={0}>Choose a location</option>{locations.map((term)=><option key={term.id} value={term.id}>{term.name}</option>)}</select></div></div>
        {currentImage && <div><p className={labelClass}>Current cover image</p><img src={currentImage} alt="Current experience cover" className="mt-2 max-h-48 w-full rounded-xl object-cover" /></div>}
        <div><label className={labelClass}>Cover image {currentImage ? "(optional replacement)" : ""}</label><input className={inputClass} type="file" accept="image/jpeg,image/png,image/webp" onChange={(e)=>setCoverFile(e.target.files?.[0] ?? null)} /><p className="mt-1 text-xs text-muted-foreground">JPG, PNG or WebP; up to 3 MB.</p></div>
        {currentGallery.length>0 && <div><p className={labelClass}>Existing gallery images</p><div className="mt-2 flex flex-wrap gap-2">{currentGallery.map((img)=><img key={img.id} src={img.thumbnail || img.url} alt={img.alt || "Gallery image"} className="size-16 rounded-lg object-cover" />)}</div></div>}
        <div><label className={labelClass}>Add gallery images</label><input className={inputClass} type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={(e)=>setGalleryFiles(Array.from(e.target.files ?? []).slice(0,8))} /><p className="mt-1 text-xs text-muted-foreground">Select up to 8 new images; existing gallery is preserved if none are selected.</p></div>
        <div className="flex justify-end"><Button type="button" onClick={()=>{if(stepValid(1))setStep(2)}}>Next: Provider & pricing <ChevronRight className="ml-2 size-4" /></Button></div>
      </section>}
      {step===2 && <section className="space-y-4"><h2 className="font-display text-xl font-semibold">Provider and pricing</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><label className={labelClass}>Activity provider</label><input className={inputClass} value={fields.provider_name} onChange={(e)=>setField("provider_name",e.target.value)} /></div>
          <div><label className={labelClass}>Provider contact email</label><input type="email" className={inputClass} value={fields.provider_email} onChange={(e)=>setField("provider_email",e.target.value)} /></div>
          <div><label className={labelClass}>Price per participant</label><input type="number" min={0} step="0.01" className={inputClass} value={fields.price} onChange={(e)=>setField("price",e.target.value)} /></div>
          <div><label className={labelClass}>Currency</label><select className={inputClass} value={fields.currency} onChange={(e)=>setField("currency",e.target.value)}><option>INR</option><option>USD</option><option>EUR</option></select></div>
          <div><label className={labelClass}>Pricing model</label><select className={inputClass} value={fields.pricing_model} onChange={(e)=>setField("pricing_model",e.target.value)}><option value="per_person">Per person</option><option value="per_group">Per group</option><option value="fixed">Fixed price</option><option value="free">Free</option><option value="contact">Contact for price</option></select></div>
          <div><label className={labelClass}>Duration</label><input className={inputClass} placeholder="e.g. 2 hours" value={fields.duration} onChange={(e)=>setField("duration",e.target.value)} /></div>
          <div><label className={labelClass}>Minimum participants</label><input type="number" min={1} className={inputClass} value={fields.min_participants} onChange={(e)=>setField("min_participants",e.target.value)} /></div>
          <div><label className={labelClass}>Maximum participants</label><input type="number" min={1} className={inputClass} value={fields.max_participants} onChange={(e)=>setField("max_participants",e.target.value)} /></div>
          <div><label className={labelClass}>Languages</label><input className={inputClass} placeholder="English, Tamil" value={fields.languages} onChange={(e)=>setField("languages",e.target.value)} /></div>
          <div><label className={labelClass}>Booking type</label><select className={inputClass} value={fields.booking_type} onChange={(e)=>setField("booking_type",e.target.value)}><option value="request">Request / enquiry</option><option value="scheduled">Scheduled session</option><option value="instant">Instant booking (subject to review)</option></select></div>
        </div>
        <div className="flex flex-wrap gap-4">{[["pickup_included","Pickup included"],["private_group","Private group available"],["reserve_pay_later","Reserve now, pay later"]].map(([key,label])=><label key={key} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={fields[key]==="yes"} onChange={(e)=>setField(key,e.target.checked?"yes":"no")} />{label}</label>)}</div>
        <div className="flex justify-between gap-3"><Button type="button" variant="outline" onClick={()=>setStep(1)}><ChevronLeft className="mr-2 size-4" />Back</Button><Button type="button" onClick={()=>{if(stepValid(2))setStep(3)}}>Next: Itinerary <ChevronRight className="ml-2 size-4" /></Button></div>
      </section>}
      {step===3 && <section className="space-y-4"><h2 className="font-display text-xl font-semibold">Meeting point and itinerary</h2>
        <PlaceAutocomplete
          label="Find meeting point on Google Maps"
          value={fields.meeting_point_address || fields.meeting_point_name}
          onSelect={(place) => {
            const name = place.label.split(",")[0]?.trim() || place.label;
            setFields((current) => ({ ...current, meeting_point_name: name, meeting_point_address: place.label, meeting_point_lat: place.lat == null ? current.meeting_point_lat : String(place.lat), meeting_point_lng: place.lng == null ? current.meeting_point_lng : String(place.lng) }));
          }}
        />
        <div className="grid gap-4 sm:grid-cols-2"><div><label className={labelClass}>Meeting point name</label><input className={inputClass} value={fields.meeting_point_name} onChange={(e)=>setField("meeting_point_name",e.target.value)} /></div><div><label className={labelClass}>Meeting point address</label><textarea className={inputClass} rows={2} value={fields.meeting_point_address} onChange={(e)=>setField("meeting_point_address",e.target.value)} /></div><div><label className={labelClass}>Latitude</label><input type="number" step="any" min={-90} max={90} className={inputClass} value={fields.meeting_point_lat} onChange={(e)=>setField("meeting_point_lat",e.target.value)} /></div><div><label className={labelClass}>Longitude</label><input type="number" step="any" min={-180} max={180} className={inputClass} value={fields.meeting_point_lng} onChange={(e)=>setField("meeting_point_lng",e.target.value)} /></div></div>
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2"><div><label className={labelClass}>Your itinerary</label><p className="mt-1 text-xs text-muted-foreground">Add the stops travellers will experience, in order. Existing linked Place details are retained.</p></div><Button type="button" variant="outline" onClick={() => setItineraryStops((items) => [...items, blankStop()])}><span className="mr-2">+</span>Add stop</Button></div>

          <div className="space-y-2 rounded-xl border border-border bg-background/40 p-3">
            <label className={labelClass} htmlFor="experience-existing-place-search">Search existing Places</label>
            <p className="text-xs text-muted-foreground">Search the live Xplore Pondy directory and add a published Place as an itinerary stop. Its listing ID and canonical link are saved for internal linking.</p>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input id="experience-existing-place-search" className={inputClass + " pl-9"} type="search" autoComplete="off" value={listingQuery} onChange={(event) => setListingQuery(event.target.value)} placeholder="Search listings by name…" />
              {listingSearchBusy && <LoaderCircle className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
            </div>
            {listingResults.length > 0 && <div className="max-h-72 space-y-1 overflow-y-auto rounded-lg border border-border p-1">{listingResults.map((listing) => {
              const alreadyAdded = itineraryStops.some((stop) => Number(stop.listing_id) === listing.wpId);
              return <div key={listing.wpId} className="flex items-center gap-3 rounded-lg p-2 hover:bg-muted/60">
                {listing.image && <img src={listing.image} alt="" className="size-12 shrink-0 rounded-md object-cover" />}
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{listing.name}</p><p className="truncate text-xs text-muted-foreground">{listing.address || listing.friendlyAddress || listing.location || listing.category}</p><p className="text-xs text-muted-foreground">Listing ID {listing.wpId}</p></div>
                <Button type="button" size="sm" variant="outline" disabled={alreadyAdded} onClick={() => addExistingListing(listing)}>{alreadyAdded ? "Added" : "Add stop"}</Button>
              </div>;
            })}</div>}
            {listingSearchError && listingQuery.trim().length >= 2 && <p className="text-sm text-muted-foreground" role="status">{listingSearchError}</p>}
          </div>
          {itineraryStops.length === 0 && <div className="rounded-xl border border-dashed border-border p-5 text-center"><p className="text-sm font-medium">No itinerary stops added</p><p className="mt-1 text-xs text-muted-foreground">For example, add a meeting point, heritage walk, or a break at a local café.</p><Button type="button" className="mt-3" variant="outline" onClick={() => setItineraryStops([blankStop()])}>Add your first stop</Button></div>}
          {itineraryStops.map((stop, index) => <div key={index} className="space-y-3 rounded-xl border border-border bg-background/50 p-4">
            <div className="flex items-center justify-between gap-3"><h3 className="font-semibold">Stop {index + 1}{stop.listing_id ? <span className="ml-2 rounded-full border border-primary/30 px-2 py-0.5 text-xs text-primary">Linked Place</span> : null}</h3><div className="flex gap-1"><Button type="button" size="sm" variant="ghost" disabled={index===0} onClick={() => setItineraryStops((items) => { const next=[...items]; [next[index-1],next[index]]=[next[index],next[index-1]]; return next; })} aria-label="Move stop up">↑</Button><Button type="button" size="sm" variant="ghost" disabled={index===itineraryStops.length-1} onClick={() => setItineraryStops((items) => { const next=[...items]; [next[index+1],next[index]]=[next[index],next[index+1]]; return next; })} aria-label="Move stop down">↓</Button><Button type="button" size="sm" variant="ghost" onClick={() => setItineraryStops((items) => items.filter((_,i)=>i!==index))}>Remove</Button></div></div>
            <div className="grid gap-3 sm:grid-cols-2"><div><label className={labelClass}>Stop name *</label><input className={inputClass} value={String(stop.title ?? "")} onChange={(e)=>setItineraryStops((items)=>items.map((item,i)=>i===index?{...item,title:e.target.value}:item))} placeholder="e.g. French Quarter Heritage Walk" /></div><div><label className={labelClass}>Duration</label><input className={inputClass} value={String(stop.duration ?? "")} onChange={(e)=>setItineraryStops((items)=>items.map((item,i)=>i===index?{...item,duration:e.target.value}:item))} placeholder="e.g. 90 minutes" /></div></div>
            <div><label className={labelClass}>What happens at this stop?</label><textarea className={inputClass} rows={2} value={String(stop.description ?? "")} onChange={(e)=>setItineraryStops((items)=>items.map((item,i)=>i===index?{...item,description:e.target.value}:item))} placeholder="Describe the activity or what guests will see." /></div>
            <PlaceAutocomplete
              label="Find this stop on Google Maps"
              value={String(stop.address ?? "")}
              onSelect={(place) => setItineraryStops((items)=>items.map((item,i)=>i===index?{...item,title:String(item.title || place.label.split(",")[0]?.trim() || place.label),address:place.label,lat:place.lat == null ? item.lat : String(place.lat),lng:place.lng == null ? item.lng : String(place.lng)}:item))}
            />
            <div className="grid gap-3 sm:grid-cols-2"><div><label className={labelClass}>Place or address</label><input className={inputClass} value={String(stop.address ?? "")} onChange={(e)=>setItineraryStops((items)=>items.map((item,i)=>i===index?{...item,address:e.target.value}:item))} placeholder="Selected address or enter manually" /></div><div><label className={labelClass}>Coordinates</label><input className={inputClass} readOnly value={stop.lat != null && stop.lng != null ? `${String(stop.lat)}, ${String(stop.lng)}` : ""} placeholder="Filled when you choose a map result" /></div></div>
            {stop.listing_id ? <p className="text-xs text-muted-foreground">Linked Place ID: {String(stop.listing_id)} · Existing link is preserved.</p> : null}
          </div>)}
          <div className="flex justify-start pt-1">
            <Button type="button" variant="outline" onClick={() => setItineraryStops((items) => [...items, blankStop()])}>
              <span className="mr-2">+</span>Add stop
            </Button>
          </div>
        </div>
        <div className="flex justify-between gap-3"><Button type="button" variant="outline" onClick={()=>setStep(2)}><ChevronLeft className="mr-2 size-4" />Back</Button><Button type="button" onClick={()=>{if(stepValid(3))setStep(4)}}>Next: Availability & policies <ChevronRight className="ml-2 size-4" /></Button></div>
      </section>}
      {step===4 && <section className="space-y-4"><h2 className="font-display text-xl font-semibold">Availability, information and policies</h2>
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2"><div><label className={labelClass}>Available dates and sessions</label><p className="mt-1 text-xs text-muted-foreground">Choose the dates you run this experience, then add one or more start times.</p></div><Button type="button" variant="outline" onClick={() => setAvailabilityDays((days)=>[...days,{date:"",sessions:[blankSession()]}])}><span className="mr-2">+</span>Add date</Button></div>
          {availabilityDays.length===0 && <div className="rounded-xl border border-dashed border-border p-5 text-center"><p className="text-sm font-medium">No scheduled sessions</p><p className="mt-1 text-xs text-muted-foreground">For request-only experiences, leave this empty. Travellers can contact you to arrange a time.</p><Button type="button" variant="outline" className="mt-3" onClick={() => setAvailabilityDays([{date:"",sessions:[blankSession()]}])}>Add an available date</Button></div>}
          {availabilityDays.map((day, dayIndex)=><div key={dayIndex} className="space-y-3 rounded-xl border border-border bg-background/50 p-4">
            <div className="flex flex-wrap items-end justify-between gap-3"><div className="min-w-[200px] flex-1"><label className={labelClass}>Available date</label><input type="date" className={inputClass} value={day.date} onChange={(e)=>setAvailabilityDays((days)=>days.map((item,i)=>i===dayIndex?{...item,date:e.target.value}:item))} /></div><Button type="button" variant="ghost" onClick={()=>setAvailabilityDays((days)=>days.filter((_,i)=>i!==dayIndex))}>Remove date</Button></div>
            <div className="space-y-2">{day.sessions.map((session, sessionIndex)=><div key={sessionIndex} className="grid gap-3 rounded-lg border border-border/70 p-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
              <div><label className={labelClass}>Start time</label><input type="time" className={inputClass} value={session.time} onChange={(e)=>setAvailabilityDays((days)=>days.map((item,i)=>i===dayIndex?{...item,sessions:item.sessions.map((slot,j)=>j===sessionIndex?{...slot,time:e.target.value}:slot)}:item))} /></div>
              <div><label className={labelClass}>Places available</label><input type="number" min={1} step={1} className={inputClass} value={session.capacity} onChange={(e)=>setAvailabilityDays((days)=>days.map((item,i)=>i===dayIndex?{...item,sessions:item.sessions.map((slot,j)=>j===sessionIndex?{...slot,capacity:e.target.value}:slot)}:item))} /></div>
              <div><label className={labelClass}>Price override (optional)</label><input type="number" min={0} step="0.01" className={inputClass} value={session.price} onChange={(e)=>setAvailabilityDays((days)=>days.map((item,i)=>i===dayIndex?{...item,sessions:item.sessions.map((slot,j)=>j===sessionIndex?{...slot,price:e.target.value}:slot)}:item))} placeholder="Use base price" /></div>
              <Button type="button" size="sm" variant="ghost" disabled={day.sessions.length===1} onClick={()=>setAvailabilityDays((days)=>days.map((item,i)=>i===dayIndex?{...item,sessions:item.sessions.filter((_,j)=>j!==sessionIndex)}:item))}>Remove</Button>
            </div>)}</div>
            <Button type="button" size="sm" variant="outline" onClick={()=>setAvailabilityDays((days)=>days.map((item,i)=>i===dayIndex?{...item,sessions:[...item.sessions,blankSession()]}:item))}><span className="mr-2">+</span>Add another session on this date</Button>
          </div>)}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">{[["highlights","Highlights"],["includes","What's included"],["excludes","What's not included"],["important_info","Important information"],["faqs","FAQs"]].map(([key,label])=><div key={key}><label className={labelClass}>{label} (one per line)</label><textarea className={inputClass} rows={4} value={fields[key]} onChange={(e)=>updateFieldLines(key,e.target.value)} /></div>)}</div>
        <div className="grid gap-4 sm:grid-cols-2"><div><label className={labelClass}>Free cancellation deadline (hours)</label><input type="number" min={0} className={inputClass} value={fields.cancellation_hours} onChange={(e)=>setField("cancellation_hours",e.target.value)} /></div><div><label className={labelClass}>Cancellation policy</label><textarea className={inputClass} rows={3} value={fields.cancellation_policy} onChange={(e)=>setField("cancellation_policy",e.target.value)} /></div><div><label className={labelClass}>Refund policy</label><textarea className={inputClass} rows={3} value={fields.refund_policy} onChange={(e)=>setField("refund_policy",e.target.value)} /></div><div><label className={labelClass}>About the provider</label><textarea className={inputClass} rows={3} value={fields.provider_details} onChange={(e)=>setField("provider_details",e.target.value)} /></div></div>
        <label className="flex items-start gap-2 rounded-xl border border-border p-3 text-sm"><input type="checkbox" className="mt-1" checked={consent} onChange={(e)=>setConsent(e.target.checked)} /><span>I confirm these details are accurate and agree to Xplore Pondy reviewing this submission before publication.</span></label>
        <div className="rounded-xl border border-border bg-muted/40 p-4 text-sm text-muted-foreground"><ShieldCheck className="mr-2 inline size-4" />Your experience will be saved as Pending review. The team must approve it before it appears publicly.</div>
        <div className="flex flex-wrap justify-between gap-3"><Button type="button" variant="outline" onClick={()=>setStep(3)}><ChevronLeft className="mr-2 size-4" />Back</Button><Button type="submit" disabled={saving || loading}>{saving?<LoaderCircle className="mr-2 size-4 animate-spin" />:mode==="edit"?<Save className="mr-2 size-4" />:<Upload className="mr-2 size-4" />}{saving?"Saving…":mode==="edit"?"Submit changes for review":"Submit experience for review"}</Button></div>
      </section>}
    </form></>}
  </main>;
}
