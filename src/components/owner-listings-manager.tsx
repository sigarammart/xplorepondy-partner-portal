import { useEffect, useState, type FormEvent } from "react";
import { MapPin, LoaderCircle, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { resolvePlace, searchGooglePlacesOnly, type PlaceSuggestion } from "@/lib/places";
import { CheckCircle2, ClipboardList, ExternalLink, FilePlus2, Pencil, RefreshCw, Store, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createOwnerListingSubmission, fetchAdminListingDetail, fetchAdminListings, fetchOwnerListingFormSchema, fetchOwnerListings, submitOwnerListingEdit, uploadOwnerListingImage } from "@/lib/owner-listings";

type OwnerManagedListing = {
  id: number; title: string; description?: string; status: string; url?: string; owner_email?: string; author_email?: string; email?: string; owner?: { email?: string }; author?: { email?: string };
  modified_gmt?: string; featured_image?: string | null;
  fields?: Record<string, unknown>;
  categories?: Record<string, Array<{ id: number; name: string; slug: string }>>;
};
type OwnerSubmission = {
  id: number; title: string; status: string; kind: string; target_listing_id: number;
  created_gmt?: string; review_note?: string; submitted_fields?: string[];
};
type ListingsResponse = { items: OwnerManagedListing[]; submissions: OwnerSubmission[] };
type FormSchema = {
  fields: Array<{ id: string; label: string; type: string }>;
  taxonomies: Record<string, Array<{ id: number; name: string; slug: string; parent: number }>>;
};

async function fileToBase64(file: File): Promise<string> { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(new Error("Could not read image file.")); reader.onload = () => { const result = String(reader.result ?? ""); resolve(result.slice(result.indexOf(",") + 1)); }; reader.readAsDataURL(file); }); }

const EDITABLE_FIELDS = [
  { key: "phone", label: "Contact phone", placeholder: "Business phone number" },
  { key: "website", label: "Website", placeholder: "https://example.com" },
  { key: "email", label: "Business email", placeholder: "contact@example.com" },
  { key: "facebook", label: "Facebook page", placeholder: "https://facebook.com/yourbusiness" },
  { key: "instagram", label: "Instagram profile", placeholder: "https://instagram.com/yourbusiness" },
  { key: "price_min", label: "Minimum price", placeholder: "e.g. 100" },
  { key: "price_max", label: "Maximum price", placeholder: "e.g. 1000" },
  { key: "listing_tagline", label: "Short tagline", placeholder: "A short introduction" },
  { key: "features_must_try", label: "Highlights / known for", placeholder: "Popular items, features, or highlights" },
  { key: "friendly_address", label: "Business address (short)", placeholder: "e.g. Heritage Town, Puducherry" },
];

const OPENING_HOURS = [
  { day: "Monday", key: "monday" },
  { day: "Tuesday", key: "tuesday" },
  { day: "Wednesday", key: "wednesday" },
  { day: "Thursday", key: "thursday" },
  { day: "Friday", key: "friday" },
  { day: "Saturday", key: "saturday" },
  { day: "Sunday", key: "sunday" },
];

const LOCATION_FIELD_KEYS = ["address", "friendly_address", "place_id", "geolocation_lat", "geolocation_long"];
const OPENING_HOUR_KEYS = OPENING_HOURS.flatMap(({ key }) => [`${key}_opening_hour`, `${key}_closing_hour`]);
type DayIntervals = Array<{ open: string; close: string }>;
function emptyOpeningHours(): Record<string, DayIntervals> {
  return Object.fromEntries(OPENING_HOURS.map(({ key }) => [key, [{ open: "", close: "" }]]));
}
function readIntervals(fields: Record<string, unknown>, key: string): DayIntervals {
  const opens = Array.isArray(fields[`${key}_opening_hour`]) ? fields[`${key}_opening_hour`] as unknown[] : [fields[`${key}_opening_hour`]];
  const closes = Array.isArray(fields[`${key}_closing_hour`]) ? fields[`${key}_closing_hour`] as unknown[] : [fields[`${key}_closing_hour`]];
  const length = Math.max(opens.length, closes.length, 1);
  return Array.from({ length }, (_, i) => ({ open: opens[i] == null ? "" : String(opens[i]), close: closes[i] == null ? "" : String(closes[i]) }));
}
function emptyListingFields() {
  return Object.fromEntries([...LOCATION_FIELD_KEYS, ...EDITABLE_FIELDS.map((field) => field.key), ...OPENING_HOUR_KEYS].map((key) => [key, ""])) as Record<string, string>;
}

function statusLabel(status: string) {
  if (status === "publish") return "Published";
  return status.replace(/-/g, " ");
}
function statusClass(status: string) {
  return status === "publish" || status === "approved"
    ? "bg-emerald-500/10 text-emerald-700"
    : status === "rejected"
      ? "bg-destructive/10 text-destructive"
      : "bg-amber-500/10 text-amber-700";
}

export function OwnerListingsManager({ loggedIn, isAdministrator, allowedListingIds, listingsResolved, email, identityToken }: { loggedIn: boolean; isAdministrator: boolean; allowedListingIds: number[]; listingsResolved: boolean; email?: string; identityToken?: string }) {
  const ownerIdentity = { email, identityToken };
  const [items, setItems] = useState<OwnerManagedListing[]>([]);
  const [listingPage, setListingPage] = useState(1);
  const [listingPageCount, setListingPageCount] = useState(1);
  const [listingSearch, setListingSearch] = useState("");
  const listingsPerPage = 10;
  const [submissions, setSubmissions] = useState<OwnerSubmission[]>([]);
  const [schema, setSchema] = useState<FormSchema | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<OwnerManagedListing | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [fields, setFields] = useState<Record<string, string>>(() => emptyListingFields());
  const [openingHours, setOpeningHours] = useState<Record<string, DayIntervals>>(() => emptyOpeningHours());
  const [addressQuery, setAddressQuery] = useState("");
  const [galleryUploads, setGalleryUploads] = useState<Array<{ id: number; url: string; name: string }>>([]);
  const [featuredUpload, setFeaturedUpload] = useState<{ id: number; url: string; name: string } | null>(null);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [enableReservation, setEnableReservation] = useState(false);
  const [addressHits, setAddressHits] = useState<PlaceSuggestion[]>([]);
  const [addressBusy, setAddressBusy] = useState(false);
  const [taxonomies, setTaxonomies] = useState<Record<string, number[]>>({});
  const [taxonomySearch, setTaxonomySearch] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  // The owner dashboard selector is the canonical source of listing ownership.
  // Do not display or offer edits for posts returned by the secondary API unless
  // their IDs are also present in that verified owner-scoped list.
  const allowedIds = new Set(allowedListingIds);
  const visibleItems = listingsResolved ? (isAdministrator ? items : items.filter((item) => allowedIds.has(item.id))) : [];
  const normalizedListingSearch = listingSearch.trim().toLocaleLowerCase();
  const filteredItems = visibleItems.filter((item) =>
    item.title.toLocaleLowerCase().includes(normalizedListingSearch) ||
    String(item.id).includes(normalizedListingSearch) ||
    item.status.toLocaleLowerCase().includes(normalizedListingSearch)
  );
  const totalListingPages = isAdministrator ? listingPageCount : Math.max(1, Math.ceil(filteredItems.length / listingsPerPage));
  const paginatedItems = isAdministrator ? filteredItems : filteredItems.slice((listingPage - 1) * listingsPerPage, listingPage * listingsPerPage);

  useEffect(() => {
    const query = addressQuery.trim();
    if (query.length < 2 || !formOpen) { setAddressHits([]); return; }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setAddressBusy(true);
      void searchGooglePlacesOnly(query).then((hits) => {
        if (!cancelled) setAddressHits(hits);
      }).catch(() => {
        if (!cancelled) setAddressHits([]);
      }).finally(() => { if (!cancelled) setAddressBusy(false); });
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [addressQuery, formOpen]);

  async function loadListingsAndSubmissions(page = 1) {
    const ownerResult = await fetchOwnerListings({ data: ownerIdentity }) as ListingsResponse;
    if (isAdministrator) {
      const response = await fetchAdminListings({ data: { ...ownerIdentity, page, perPage: listingsPerPage } }) as {
        items?: Array<Omit<Partial<OwnerManagedListing>, "title"> & { id: number; title?: string | { rendered?: string } }>;
        total_pages?: number;
        total?: number;
      };
      const listingItems: OwnerManagedListing[] = (response.items ?? []).map((item) => ({
        ...item,
        id: Number(item.id),
        title: typeof item.title === "string" ? item.title : item.title?.rendered ?? `Listing #${item.id}`,
        status: String(item.status ?? "publish"),
        owner_email: typeof item.owner_email === "string" ? item.owner_email : typeof item.author_email === "string" ? item.author_email : typeof item.email === "string" ? item.email : typeof item.owner?.email === "string" ? item.owner.email : typeof item.author?.email === "string" ? item.author.email : "",
      }));
      return { ...ownerResult, items: listingItems, totalPages: Math.max(1, Number(response.total_pages) || 1) };
    }
    const listingItems = Array.isArray(ownerResult.items) ? ownerResult.items : [];
    return { ...ownerResult, items: listingItems, totalPages: Math.max(1, Math.ceil(listingItems.length / listingsPerPage)) };
  }

  async function loadAdminListingPage(page: number) {
    if (!isAdministrator) { setListingPage(page); return; }
    setLoading(true);
    setError("");
    try {
      const response = await fetchAdminListings({ data: { ...ownerIdentity, page, perPage: listingsPerPage } }) as {
        items?: Array<Omit<Partial<OwnerManagedListing>, "title"> & { id: number; title?: string | { rendered?: string } }>;
        total_pages?: number;
      };
      const listingItems: OwnerManagedListing[] = (response.items ?? []).map((item) => ({
        ...item,
        id: Number(item.id),
        title: typeof item.title === "string" ? item.title : item.title?.rendered ?? `Listing #${item.id}`,
        status: String(item.status ?? "publish"),
        owner_email: typeof item.owner_email === "string" ? item.owner_email : typeof item.author_email === "string" ? item.author_email : typeof item.email === "string" ? item.email : typeof item.owner?.email === "string" ? item.owner.email : typeof item.author?.email === "string" ? item.author.email : "",
      }));
      setItems(listingItems);
      setListingPage(page);
      setListingPageCount(Math.max(1, Number(response.total_pages) || listingPageCount));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load this listing page.");
    } finally {
      setLoading(false);
    }
  }

  async function refresh() {
    setLoading(true); setError("");
    try {
      const result = await loadListingsAndSubmissions();
      setItems(result.items);
      setListingPage(1);
      setListingPageCount(result.totalPages);
      setSubmissions(Array.isArray(result.submissions) ? result.submissions : []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load owner listings.");
    } finally { setLoading(false); }
  }

  useEffect(() => {
    if (!loggedIn) { setItems([]); setSubmissions([]); return; }
    let cancelled = false;
    setLoading(true); setError("");
    void Promise.all([loadListingsAndSubmissions(), fetchOwnerListingFormSchema({ data: ownerIdentity })])
      .then(([listingsResult, schemaResult]) => {
        if (cancelled) return;
        setItems(listingsResult.items);
        setListingPage(1);
        setListingPageCount(listingsResult.totalPages);
        setSubmissions(Array.isArray(listingsResult.submissions) ? listingsResult.submissions : []);
        setSchema(schemaResult as FormSchema);
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not load owner listing management.");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [loggedIn, isAdministrator, email, identityToken]);

  function startNew() {
    setEditing(null); setTitle(""); setDescription(""); setFields(emptyListingFields()); setOpeningHours(emptyOpeningHours()); setGalleryUploads([]); setFeaturedUpload(null); setEnableReservation(false); setAddressQuery(""); setAddressHits([]); setTaxonomies({}); setTaxonomySearch({}); setFormError(""); setFormOpen(true);
  }
  async function startEdit(item: OwnerManagedListing) {
    setFormError("");
    let source = item;
    // The administrator directory endpoint is intentionally compact. Fetch the
    // full WordPress REST record before opening the editor, otherwise only title
    // and listing ID are present and every editable field appears blank.
    if (isAdministrator && (!item.fields || Object.keys(item.fields).length === 0)) {
      try {
        const raw = await fetchAdminListingDetail({ data: { listingId: item.id, ...ownerIdentity } }) as {
          id?: number;
          title?: string | { rendered?: string };
          content?: string | { rendered?: string };
          excerpt?: string | { rendered?: string };
          link?: string;
          meta?: Record<string, unknown>;
          _embedded?: Record<string, Array<Array<{ id: number; name: string; slug: string; taxonomy?: string }>>>;
        };
        const meta = raw.meta ?? {};
        const valueFor = (key: string): unknown => meta[key] ?? meta[`_${key}`] ?? meta[key.replace(/^_/, "")] ?? "";
        const fields: Record<string, unknown> = { ...(item.fields ?? {}) };
        for (const key of Object.keys(emptyListingFields())) fields[key] = valueFor(key);
        const taxonomyTerms: Record<string, Array<{ id: number; name: string; slug: string }>> = {};
        // WordPress _embedded contains several shapes (authors, featured
        // media, terms, etc.). Only wp:term is a nested array; iterating every
        // embedded property as term groups throws "t is not iterable".
        const embeddedTerms = raw._embedded?.["wp:term"];
        if (Array.isArray(embeddedTerms)) {
          for (const group of embeddedTerms) {
            if (!Array.isArray(group)) continue;
            for (const term of group) {
              if (!term || typeof term !== "object" || !term.taxonomy || !Number.isFinite(Number(term.id))) continue;
              (taxonomyTerms[term.taxonomy] ??= []).push({ id: Number(term.id), name: String(term.name ?? ""), slug: String(term.slug ?? "") });
            }
          }
        }
        const titleValue = typeof raw.title === "string" ? raw.title : raw.title?.rendered;
        const descriptionValue = typeof raw.content === "string" ? raw.content : raw.content?.rendered;
        source = {
          ...item,
          title: titleValue ? titleValue.replace(/&#8217;/g, "’").replace(/&#038;/g, "&").replace(/&#8211;/g, "–").replace(/&#8212;/g, "—").replace(/&amp;/g, "&").replace(/<[^>]*>/g, "").trim() : item.title,
          description: descriptionValue ? descriptionValue.replace(/<br\s*\/?\s*>/gi, "\n").replace(/<\/p>/gi, "\n\n").replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#8217;/g, "’").trim() : item.description,
          url: raw.link ?? item.url,
          fields,
          categories: Object.keys(taxonomyTerms).length ? taxonomyTerms : item.categories,
        };
      } catch (reason) {
        toast.error(reason instanceof Error ? reason.message : "Could not load the full listing details.");
        return;
      }
    }
    const nextFields: Record<string, string> = emptyListingFields();
    for (const key of Object.keys(nextFields)) {
      const value = source.fields?.[key];
      nextFields[key] = Array.isArray(value) ? value.join(", ") : value == null ? "" : String(value);
    }
    setOpeningHours(Object.fromEntries(OPENING_HOURS.map(({ key }) => [key, readIntervals(source.fields ?? {}, key)])));
    for (const field of EDITABLE_FIELDS) {
      const value = source.fields?.[field.key];
      nextFields[field.key] = Array.isArray(value) ? value.join(", ") : value == null ? "" : String(value);
    }
    const nextTaxonomies: Record<string, number[]> = {};
    for (const [taxonomy, terms] of Object.entries(source.categories ?? {})) nextTaxonomies[taxonomy] = terms.map((term) => term.id);
    setEditing(source); setTitle(source.title); setDescription(source.description ?? ""); setEnableReservation(false);
    setFields(nextFields); setAddressQuery(nextFields.friendly_address || nextFields.address || ""); setAddressHits([]); setTaxonomies(nextTaxonomies); setTaxonomySearch({}); setFormError(""); setFormOpen(true);
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setFormError("");
    const intervalFields: Record<string, unknown> = { ...fields };
    for (const { key } of OPENING_HOURS) {
      const intervals = openingHours[key] ?? [{ open: "", close: "" }];
      intervalFields[`${key}_opening_hour`] = intervals.map((item) => item.open).filter(Boolean);
      intervalFields[`${key}_closing_hour`] = intervals.map((item) => item.close).filter(Boolean);
    }
    intervalFields.gallery = galleryUploads.map((item) => item.id);
    intervalFields.screenshot = featuredUpload?.id ?? 0;
    const payload = { title: title.trim(), description, fields: intervalFields, taxonomies };
    try {
      let savedListingId = editing?.id ?? 0;
      if (editing) {
        await submitOwnerListingEdit({ data: { ...payload, listingId: editing.id, ...ownerIdentity } });
        toast.success("Edit submitted for administrator review");
      } else {
        const result = await createOwnerListingSubmission({ data: { ...payload, ...ownerIdentity } }) as { id?: number; listing_id?: number; listingId?: number; submission_id?: number; title?: string; slug?: string };
        savedListingId = Number(result.listing_id ?? result.listingId ?? result.id ?? result.submission_id ?? 0);
        toast.success("New listing submitted for administrator review");
      }
      setFormOpen(false);
      await refresh();
      if (enableReservation && savedListingId > 0) {
        const params = new URLSearchParams({ listingId: String(savedListingId), listingTitle: title.trim(), listingSlug: String((payload as any).slug ?? "") });
        window.location.assign(`/reservation-setup?${params.toString()}`);
      } else if (enableReservation) {
        toast.error("Listing was submitted, but its ID was not returned. Open My Listings and choose the listing to set up reservations.");
      }
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : "Could not submit this listing.");
    } finally { setSaving(false); }
  }

  return <section className="mt-5 rounded-3xl bg-card p-4 ring-1 ring-border/70 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="font-display text-xl font-semibold">Manage directory listings</h2><p className="mt-1 text-sm text-muted-foreground">Add listings and propose edits. Changes are reviewed before affecting the public directory.</p></div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={loading} onClick={() => void refresh()}><RefreshCw className={`mr-2 size-4 ${loading ? "animate-spin" : ""}`}/>Refresh</Button>
        <Button size="sm" onClick={startNew}><FilePlus2 className="mr-2 size-4"/>Add listing</Button>
      </div>
    </div>
    {!loading && !error && visibleItems.length > 0 && <div className="relative mt-4">
      <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <input
        type="search"
        value={listingSearch}
        onChange={(event) => { setListingSearch(event.target.value); if (isAdministrator) void loadAdminListingPage(1); else setListingPage(1); }}
        placeholder="Search your listings by name, ID, or status..."
        aria-label="Search managed directory listings"
        className="h-11 w-full rounded-xl border border-border bg-background pl-9 pr-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
      />
    </div>}
    {loading && <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin"/>Loading owner listing records…</p>}
    {error && <div role="alert" className="mt-4 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"><p className="font-medium">Owner listing service unavailable</p><p className="mt-1">{error}</p><p className="mt-1 text-xs">The latest plugin must be installed on WordPress and the server-side bridge secret configured before submissions can be sent.</p></div>}
    {!loading && !error && items.length === 0 && <div className="mt-4 rounded-2xl border border-dashed border-border p-5 text-center"><Store className="mx-auto size-7 text-muted-foreground"/><p className="mt-2 font-medium">No owner-managed listings found</p><p className="mt-1 text-sm text-muted-foreground">Submit a new directory listing for administrator review.</p><Button className="mt-3" onClick={startNew}><FilePlus2 className="mr-2 size-4"/>Add your first listing</Button></div>}
    {filteredItems.length > 0 && <><div className="mt-4 space-y-2">{paginatedItems.map((item) => <article key={item.id} className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-background p-3 sm:flex-row sm:items-center">
      {item.featured_image ? <img src={item.featured_image} alt="" className="size-16 shrink-0 rounded-xl object-cover"/> : <div className="flex size-16 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Store className="size-6"/></div>}
      <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{item.title}</h3><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusClass(item.status)}`}>{statusLabel(item.status)}</span></div><p className="mt-1 text-xs text-muted-foreground">Listing ID: {item.id}{item.modified_gmt ? ` · Updated ${new Date(item.modified_gmt).toLocaleDateString()}` : ""}</p>{item.owner_email && <p className="mt-1 text-xs text-muted-foreground">Owner email: <a href={`mailto:${item.owner_email}`} className="font-medium text-foreground hover:text-primary hover:underline">{item.owner_email}</a></p>}{item.url && item.status === "publish" && <a href={item.url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm font-medium text-primary hover:underline">View listing <ExternalLink className="ml-1 inline size-3.5"/></a>}</div>
      <Button size="sm" variant="outline" onClick={() => startEdit(item)}><Pencil className="mr-2 size-4"/>Propose edit</Button>
    </article>)}</div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-3">
        <p className="text-xs text-muted-foreground">Showing {((listingPage - 1) * listingsPerPage) + 1}–{Math.min(listingPage * listingsPerPage, filteredItems.length)} of {filteredItems.length} listings</p>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" disabled={listingPage <= 1} onClick={() => void loadAdminListingPage(Math.max(1, listingPage - 1))}><ChevronLeft className="mr-1 size-4"/>Previous</Button>
          <span className="min-w-16 text-center text-xs tabular-nums text-muted-foreground">Page {listingPage} of {totalListingPages}</span>
          <Button size="sm" variant="outline" disabled={listingPage >= totalListingPages} onClick={() => void loadAdminListingPage(Math.min(totalListingPages, listingPage + 1))}>Next<ChevronRight className="ml-1 size-4"/></Button>
        </div>
      </div>
    </>}
    {!loading && !error && visibleItems.length > 0 && filteredItems.length === 0 && <p className="mt-4 rounded-xl border border-dashed border-border p-5 text-center text-sm text-muted-foreground">No listings match “{listingSearch.trim()}”. Try a different search.</p>}
    {submissions.length > 0 && <div className="mt-6"><div className="flex items-center gap-2"><ClipboardList className="size-5 text-primary"/><h3 className="font-semibold">Submission history</h3></div><div className="mt-3 space-y-2">{submissions.map((submission) => <article key={submission.id} className="rounded-xl border border-border/70 p-3"><div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><p className="font-medium">{submission.title}</p><p className="mt-1 text-xs text-muted-foreground">{submission.kind === "edit" ? `Edit request for listing #${submission.target_listing_id}` : "New listing request"}{submission.created_gmt ? ` · ${new Date(submission.created_gmt).toLocaleDateString()}` : ""}</p></div><span className={`rounded-full px-2 py-1 text-xs font-medium ${statusClass(submission.status)}`}>{statusLabel(submission.status)}</span></div>{submission.review_note && <p className="mt-2 rounded-lg bg-muted/60 p-2 text-sm"><strong>Admin note:</strong> {submission.review_note}</p>}</article>)}</div></div>}
    {formOpen && <div className="fixed inset-0 z-[100] flex items-end justify-center overflow-y-auto bg-black/60 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={editing ? "Propose listing edits" : "Submit a new listing"}>
      <form onSubmit={(event) => void submit(event)} className="max-h-[96dvh] w-full max-w-none overflow-y-auto rounded-t-3xl bg-card p-4 shadow-2xl sm:rounded-3xl sm:p-6 md:w-[min(100%,96vw)] lg:w-[min(100%,98vw)]">
        <div className="flex items-start justify-between gap-3"><div><h2 className="font-display text-xl font-semibold">{editing ? "Propose listing edits" : "Add a directory listing"}</h2><p className="mt-1 text-sm text-muted-foreground">{editing ? "Your changes are reviewed before the live listing changes." : "Your listing stays unpublished until an administrator reviews it."}</p></div><button type="button" aria-label="Close form" onClick={() => setFormOpen(false)} className="rounded-lg p-2 hover:bg-muted"><X className="size-5"/></button></div>
        {formError && <p role="alert" className="mt-4 rounded-xl border border-destructive/30 p-3 text-sm text-destructive">{formError}</p>}
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-medium sm:col-span-2">Listing name <span className="text-destructive">*</span><input required maxLength={180} value={title} onChange={(event) => setTitle(event.target.value)} className="mt-1.5 h-11 w-full rounded-xl border border-border bg-background px-3 font-normal" placeholder="Business or place name"/></label>
          <label className="block text-sm font-medium sm:col-span-2">Description<textarea rows={4} maxLength={12000} value={description} onChange={(event) => setDescription(event.target.value)} className="mt-1.5 w-full rounded-xl border border-border bg-background p-3 font-normal" placeholder="Describe the place or service"/></label>
          <div className="relative block text-sm font-medium sm:col-span-2">
            Business address
            <div className="relative mt-1.5">
              <input type="text" autoComplete="off" value={addressQuery} onChange={(event) => {
                const value = event.target.value;
                setAddressQuery(value);
                setFields((current) => ({ ...current, address: value, place_id: "", geolocation_lat: "", geolocation_long: "" }));
              }} placeholder="Search Google for the business address or place name" className="h-11 w-full rounded-xl border border-border bg-background px-3 pr-10 font-normal"/>
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">{addressBusy ? <LoaderCircle className="size-4 animate-spin"/> : <MapPin className="size-4"/>}</span>
            </div>
            {addressHits.length > 0 && <div className="absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-border bg-card p-1 shadow-xl">{addressHits.map((hit) => <button type="button" key={hit.id} onClick={() => {
              setAddressBusy(true);
              void resolvePlace(hit).then((resolved) => {
                const label = resolved.label || hit.label;
                setAddressQuery(label);
                setAddressHits([]);
                setFields((current) => ({ ...current, address: label, place_id: hit.id, geolocation_lat: resolved.lat == null ? "" : String(resolved.lat), geolocation_long: resolved.lng == null ? "" : String(resolved.lng) }));
              }).catch(() => setFormError("Could not resolve that Google Place. Please select another result.")).finally(() => setAddressBusy(false));
            }} className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-muted">{hit.label}</button>)}</div>}
            <p className="mt-1 text-xs text-muted-foreground">Search for the existing place (for example, “Auro Mithra Heritage Stay”) and select its Google suggestion. This saves the full formatted address, Place ID and map coordinates. Set the short Business address separately for listing cards.</p>
            {fields.geolocation_lat && fields.geolocation_long && <p className="mt-1 text-xs tabular-nums text-muted-foreground">Coordinates: {Number(fields.geolocation_lat).toFixed(6)}, {Number(fields.geolocation_long).toFixed(6)} · Place ID {fields.place_id ? "saved" : "missing"}</p>}
          </div>
          {EDITABLE_FIELDS.map((field) => <label key={field.key} className="block text-sm font-medium">{field.label}<input type={["website", "facebook", "instagram"].includes(field.key) ? "url" : field.key === "email" ? "email" : field.key.startsWith("price_") ? "number" : "text"} value={fields[field.key] ?? ""} onChange={(event) => setFields((current) => ({ ...current, [field.key]: event.target.value }))} placeholder={field.placeholder} className="mt-1.5 h-11 w-full rounded-xl border border-border bg-background px-3 font-normal"/></label>)}

        </div>
        {schema && Object.entries(schema.taxonomies).map(([taxonomy, terms]) => {
          const query = (taxonomySearch[taxonomy] ?? "").trim().toLowerCase();
          const selectedIds = taxonomies[taxonomy] ?? [];
          const visibleTerms = terms.filter((term) => selectedIds.includes(term.id) || (query.length > 0 && term.name.toLowerCase().includes(query))).slice(0, 40);
          return <fieldset key={taxonomy} className="mt-5 rounded-xl border border-border/70 p-3">
            <legend className="px-1 text-sm font-semibold">{taxonomy.replace(/_/g, " ").replace(/^./, (char) => char.toUpperCase())}</legend>
            <input type="search" value={taxonomySearch[taxonomy] ?? ""} onChange={(event) => setTaxonomySearch((current) => ({ ...current, [taxonomy]: event.target.value }))} placeholder={`Search ${taxonomy.replace(/_/g, " ")}…`} className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm"/>
            <div className="mt-2 flex flex-wrap gap-1.5">{terms.filter((term) => selectedIds.includes(term.id)).map((term) => <span key={term.id} className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-1 text-xs text-primary">{term.name}<button type="button" aria-label={`Remove ${term.name}`} onClick={() => setTaxonomies((current) => ({ ...current, [taxonomy]: (current[taxonomy] ?? []).filter((id) => id !== term.id) }))}><X className="size-3"/></button></span>)}</div>
            {visibleTerms.length > 0 ? <div className="mt-2 max-h-44 overflow-y-auto rounded-lg border border-border/60 p-2">{visibleTerms.map((term) => <label key={term.id} className="flex items-center gap-2 py-1.5 text-sm"><input type="checkbox" checked={selectedIds.includes(term.id)} onChange={(event) => setTaxonomies((current) => ({ ...current, [taxonomy]: event.target.checked ? [...(current[taxonomy] ?? []), term.id] : (current[taxonomy] ?? []).filter((id) => id !== term.id) }))} className="size-4 rounded border-border"/><span>{term.name}</span></label>)}</div> : <p className="mt-2 text-xs text-muted-foreground">{query ? "No matching terms. Try another search." : "Search to find categories and features."}</p>}
            {query && terms.filter((term) => term.name.toLowerCase().includes(query)).length > 40 && <p className="mt-1 text-xs text-muted-foreground">Showing the first 40 matches. Refine your search for more specific results.</p>}
          </fieldset>;
        })}
        {!schema && <p className="mt-4 text-xs text-muted-foreground">Category choices will appear when the WordPress form schema is available.</p>}
          <fieldset className="rounded-xl border border-border/70 p-3 sm:col-span-2">
            <legend className="px-1 text-sm font-semibold">Opening hours</legend>
            <p className="mb-3 text-xs text-muted-foreground">Enter local business times in 24-hour format. Leave both times blank for days when hours are not supplied.</p>
            <div className="divide-y divide-border/70">
              {OPENING_HOURS.map(({ day, key }) => <div key={key} className="grid gap-3 py-4 sm:grid-cols-[minmax(120px,0.7fr)_2fr]">
                <div className="space-y-1">
                  <div className="rounded-md bg-neutral-800 px-3 py-1.5 text-center text-sm font-semibold text-white">{day}</div>
                  <button type="button" onClick={() => setOpeningHours((current) => ({ ...current, [key]: [{ open: "", close: "" }] }))} className="w-full rounded-md bg-muted px-2 py-1.5 text-xs hover:bg-muted/70">Clear Time</button>
                  <button type="button" onClick={() => setOpeningHours((current) => ({ ...current, [key]: [...(current[key] ?? [{ open: "", close: "" }]), { open: "", close: "" }] }))} className="w-full rounded-md bg-emerald-100 px-2 py-1.5 text-xs text-emerald-900 hover:bg-emerald-200">Add More</button>
                </div>
                <div className="space-y-2">
                  {(openingHours[key] ?? [{ open: "", close: "" }]).map((interval, index) => <div key={index} className="grid grid-cols-2 gap-2">
                    <label className="text-xs text-muted-foreground">Opening Time<input type="time" value={interval.open} onChange={(event) => setOpeningHours((current) => ({ ...current, [key]: (current[key] ?? []).map((entry, i) => i === index ? { ...entry, open: event.target.value } : entry) }))} className="mt-1 h-11 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground"/></label>
                    <label className="text-xs text-muted-foreground">Closing Time<input type="time" value={interval.close} onChange={(event) => setOpeningHours((current) => ({ ...current, [key]: (current[key] ?? []).map((entry, i) => i === index ? { ...entry, close: event.target.value } : entry) }))} className="mt-1 h-11 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground"/></label>
                  </div>)}
                </div>
              </div>)}
            </div>
          </fieldset>
                <section className="rounded-xl border border-border/70 p-4 sm:col-span-2 space-y-4">
          <div><h3 className="font-semibold">Photos</h3><p className="text-xs text-muted-foreground">Upload a cover photo and gallery images directly from your device. JPG, PNG, or WebP; max 8 MB each.</p></div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2"><label className="block text-sm font-medium">Featured image / screenshot</label>
              {featuredUpload ? <div className="flex items-center gap-3 rounded-lg border p-2"><img src={featuredUpload.url} alt={featuredUpload.name} className="h-16 w-16 rounded-md object-cover"/><div className="min-w-0 flex-1 text-sm">{featuredUpload.name}</div><button type="button" onClick={() => setFeaturedUpload(null)} className="text-sm text-red-600">Remove</button></div> : null}
              <input type="file" accept="image/jpeg,image/png,image/webp" disabled={uploadingMedia} onChange={async (event) => { const file = event.target.files?.[0]; if (!file) return; if (file.size > 8*1024*1024) { setFormError("Each image must be 8 MB or smaller."); event.currentTarget.value = ""; return; } setUploadingMedia(true); setFormError(""); try { const uploaded = await uploadOwnerListingImage({ data: { fileName: file.name, mimeType: file.type as "image/jpeg" | "image/png" | "image/webp", base64: await fileToBase64(file), ...ownerIdentity } }); setFeaturedUpload(uploaded as {id:number;url:string;name:string}); } catch (error) { setFormError(error instanceof Error ? error.message : "Image upload failed."); } finally { setUploadingMedia(false); event.currentTarget.value = ""; } }} className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-2"/>
            </div>
            <div className="space-y-2"><label className="block text-sm font-medium">Gallery images</label>
              <input type="file" multiple accept="image/jpeg,image/png,image/webp" disabled={uploadingMedia || galleryUploads.length >= 30} onChange={async (event) => { const files = Array.from(event.target.files ?? []); if (galleryUploads.length + files.length > 30) { setFormError("You can upload up to 30 gallery images."); event.currentTarget.value = ""; return; } if (files.some((file) => file.size > 8*1024*1024)) { setFormError("Each image must be 8 MB or smaller."); event.currentTarget.value = ""; return; } setUploadingMedia(true); setFormError(""); try { const uploaded: Array<{id:number;url:string;name:string}> = []; for (const file of files) uploaded.push(await uploadOwnerListingImage({ data: { fileName: file.name, mimeType: file.type as "image/jpeg" | "image/png" | "image/webp", base64: await fileToBase64(file), ...ownerIdentity } }) as {id:number;url:string;name:string}); setGalleryUploads((current) => [...current, ...uploaded]); } catch (error) { setFormError(error instanceof Error ? error.message : "Gallery upload failed."); } finally { setUploadingMedia(false); event.currentTarget.value = ""; } }} className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-2"/>
              {galleryUploads.length ? <div className="grid grid-cols-3 gap-2">{galleryUploads.map((item) => <div key={item.id} className="relative"><img src={item.url} alt={item.name} className="h-20 w-full rounded-md object-cover"/><button type="button" onClick={() => setGalleryUploads((current) => current.filter((entry) => entry.id !== item.id))} aria-label={"Remove "+item.name} className="absolute right-1 top-1 rounded-full bg-black/70 px-2 text-white">×</button></div>)}</div> : <p className="text-xs text-muted-foreground">No gallery photos uploaded yet.</p>}
            </div>
          </div>
          {uploadingMedia ? <p className="text-sm text-muted-foreground">Uploading image…</p> : null}
        </section>
        {!editing && <fieldset className="mt-5 rounded-xl border border-border/70 p-4 sm:col-span-2">
          <legend className="px-1 text-sm font-semibold">Reservations</legend>
          <label className="flex cursor-pointer items-start gap-3 text-sm"><input type="checkbox" checked={enableReservation} onChange={(event) => setEnableReservation(event.target.checked)} className="mt-1 size-4 rounded border-border"/><span><span className="font-medium">Enable reservation</span><span className="mt-1 block text-xs text-muted-foreground">After submitting this listing for review, continue to reservation setup to configure opening hours, slots, capacity, and booking rules.</span></span></label>
        </fieldset>}
        <p className="mt-4 rounded-xl bg-muted/60 p-3 text-xs text-muted-foreground"><CheckCircle2 className="mr-1 inline size-4"/>New listings and proposed edits require administrator review.</p>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button type="button" variant="outline" onClick={() => setFormOpen(false)} disabled={saving}>Cancel</Button><Button type="submit" disabled={saving || !title.trim()}>{saving && <LoaderCircle className="mr-2 size-4 animate-spin"/>}{saving ? "Saving…" : enableReservation && !editing ? "Save and Setup Reservation" : "Save"}</Button></div>
      </form>
    </div>}
  </section>;
}
