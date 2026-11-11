import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ImagePlus, Megaphone, Pencil, Plus, RefreshCw, Save, Search, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createPartnerAd, fetchPartnerAdListings, fetchPartnerAds, updatePartnerAd, uploadPartnerAdImage, type PartnerAd } from "@/lib/owner-listings";

type ListingOption = { id?: number; wpId?: number; title: string; slug?: string };

type Props = {
  email: string;
  identityToken?: string;
  listings: ListingOption[];
  isAdministrator?: boolean;
};

const POSITIONS = [
  ["homepage_top", "Homepage Top", "1200 × 240 px", "3 slots · 1 displayed at a time · rotation"],
  ["explore_top", "Explore Top", "800 × 200 px", "3 slots · 1 displayed at a time · rotation"],
  ["listing_loop_between", "Between Listings", "1000 × 250 px", "1 slot per archive page"],
  ["sidebar_top", "Sidebar Top", "300 × 250 px", "6 slots · 2 displayed at a time · 4 in rotation"],
  ["sidebar_bottom", "Sidebar Bottom", "300 × 250 px", "1 slot"],
  ["sidebar_map_top", "Sidebar Map Top", "300 × 180 px", "5 slots · 1 displayed at a time · rotation"],
] as const;

const AD_TYPES = [
  ["", "Choose"],
  ["banner", "Banner"],
  ["image", "Image"],
] as const;

const LINK_TYPES = [
  ["", "Choose"],
  ["listing", "Listing"],
  ["custom_url", "Custom URL"],
] as const;

const STATUS_OPTIONS = [
  ["pending", "Pending"],
  ["publish", "Active"],
  ["draft", "Draft"],
] as const;

const emptyForm = {
  title: "",
  image_url: "",
  target_url: "",
  ad_type: "",
  link_type: "",
  custom_url: "",
  position: "homepage_top" as string,
  listing_ids: [] as string[],
  start_date: "",
  end_date: "",
  status: "pending",
  sponsored_ad: false,
  sponsored_ad_expiry: "",
  max_views: "",
  max_clicks: "",
};

export function PartnerAdsManager({ email, identityToken, listings, isAdministrator = false }: Props) {
  const [ads, setAds] = useState<PartnerAd[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [imageSource, setImageSource] = useState<"url" | "upload">("url");
  const [listingSearch, setListingSearch] = useState("");
  const [adminListingOptions, setAdminListingOptions] = useState<ListingOption[]>([]);
  const [listingSearchLoading, setListingSearchLoading] = useState(false);
  const [positionFilter, setPositionFilter] = useState<string>("all");

  const availableListings = useMemo(() => {
    const merged = new Map<string, ListingOption>();
    listings.forEach((item) => {
      const id = Number(item.id ?? item.wpId);
      if (id > 0) merged.set(String(id), item);
    });
    adminListingOptions.forEach((item) => {
      const id = Number(item.id ?? item.wpId);
      if (id > 0) merged.set(String(id), item);
    });
    return Array.from(merged.values());
  }, [listings, adminListingOptions]);

  const filteredListings = useMemo(() => {
    const term = listingSearch.trim().toLowerCase();
    if (!term) return availableListings;
    return availableListings.filter((item) => item.title.toLowerCase().includes(term));
  }, [availableListings, listingSearch]);

  const listingMap = useMemo(() => new Map(
    availableListings.map((item) => [Number(item.id ?? item.wpId), item.title]),
  ), [availableListings]);

  const positionInventory = useMemo(() => POSITIONS.map(([value, label, dimensions, slotDescription]) => {
    const total = Number(slotDescription.match(/^(\d+)/)?.[1] ?? 1);
    const assignedAds = ads.filter((ad) => {
      const positions = ad.positions?.length ? ad.positions : [ad.position];
      return positions.includes(value);
    });
    const active = assignedAds.filter((ad) => ad.post_status === "publish" || ad.status === "active").length;
    const pending = assignedAds.filter((ad) => ad.post_status === "pending" || ad.status === "pending").length;
    const occupied = active + pending;
    return {
      value,
      label,
      dimensions,
      total,
      active,
      pending,
      occupied,
      available: Math.max(0, total - occupied),
    };
  }), [ads]);

  const filteredAds = useMemo(() => {
    if (positionFilter === "all") return ads;
    return ads.filter((ad) => {
      const positions = ad.positions?.length ? ad.positions : [ad.position];
      return positions.includes(positionFilter);
    });
  }, [ads, positionFilter]);

  async function loadAds() {
    setLoading(true);
    try {
      const result = await fetchPartnerAds({ data: { email, ...(identityToken ? { identityToken } : {}), page: 1, perPage: 50 } }) as { items?: PartnerAd[] };
      setAds(result.items ?? []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load XP Ads.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAds();
  }, [email, identityToken]);

  useEffect(() => {
    if (!isAdministrator) return;
    const timer = window.setTimeout(async () => {
      setListingSearchLoading(true);
      try {
        const result = await fetchPartnerAdListings({
          data: {
            email,
            ...(identityToken ? { identityToken } : {}),
            search: listingSearch.trim(),
            page: 1,
            perPage: 30,
          },
        }) as { items?: ListingOption[] };
        setAdminListingOptions((result.items ?? []).map((item) => ({
          id: Number(item.id ?? item.wpId),
          title: item.title,
          slug: item.slug,
        })));
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not search listings.");
      } finally {
        setListingSearchLoading(false);
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [email, identityToken, isAdministrator, listingSearch]);


  function resetForm() {
    setEditingId(null);
    setForm(emptyForm);
    setImageSource("url");
    setListingSearch("");
  }

  async function uploadCreative(file: File) {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      toast.error("Use JPG, PNG or WebP for ad creatives.");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      toast.error("Ad creatives must be 8 MB or smaller.");
      return;
    }

    setUploadingImage(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const value = String(reader.result ?? "");
          const comma = value.indexOf(",");
          resolve(comma >= 0 ? value.slice(comma + 1) : value);
        };
        reader.onerror = () => reject(new Error("Could not read the image file."));
        reader.readAsDataURL(file);
      });

      const result = await uploadPartnerAdImage({
        data: {
          email,
          ...(identityToken ? { identityToken } : {}),
          fileName: file.name,
          mimeType: file.type as "image/jpeg" | "image/png" | "image/webp",
          base64,
        },
      }) as { url?: string };

      if (!result.url) throw new Error("WordPress did not return an uploaded image URL.");
      setForm((current) => ({ ...current, image_url: result.url! }));
      toast.success("Creative uploaded.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not upload creative.");
    } finally {
      setUploadingImage(false);
    }
  }

  function editAd(ad: PartnerAd) {
    if (ad.post_status === "publish" && !isAdministrator) {
      toast.error("Published advertisements require an admin-reviewed revision.");
      return;
    }
    setEditingId(ad.id);
    setImageSource("url");
    if (ad.listing_titles?.length) {
      setAdminListingOptions((current) => {
        const merged = new Map(current.map((item) => [String(Number(item.id ?? item.wpId)), item]));
        ad.listing_titles!.forEach((item) => merged.set(String(item.id), { id: item.id, title: item.title }));
        return Array.from(merged.values());
      });
    }
    setForm({
      title: ad.title,
      image_url: ad.image_url,
      target_url: ad.target_url,
      ad_type: ad.ad_type ?? "",
      link_type: ad.link_type ?? "",
      custom_url: ad.custom_url ?? "",
      position: ad.position || ad.positions?.[0] || "homepage_top",
      listing_ids: ad.listing_ids?.length ? ad.listing_ids.map(String) : (ad.listing_id ? [String(ad.listing_id)] : []),
      start_date: ad.start_date,
      end_date: ad.end_date,
      status: ad.post_status === "publish" ? "publish" : (ad.status || "pending"),
      sponsored_ad: Boolean(ad.sponsored_ad),
      sponsored_ad_expiry: ad.sponsored_ad_expiry ?? "",
      max_views: ad.max_views ? String(ad.max_views) : "",
      max_clicks: ad.max_clicks ? String(ad.max_clicks) : "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.title.trim() || !form.image_url.trim()) {
      toast.error("Campaign title and creative image URL are required.");
      return;
    }
    if (form.link_type === "custom_url" && !form.custom_url.trim()) {
      toast.error("Enter a custom URL for this link type.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        email,
        ...(identityToken ? { identityToken } : {}),
        title: form.title.trim(),
        image_url: form.image_url.trim(),
        target_url: (form.link_type === "custom_url" ? form.custom_url : form.target_url).trim() || undefined,
        ad_type: form.ad_type || undefined,
        link_type: form.link_type || undefined,
        custom_url: form.custom_url.trim() || undefined,
        position: form.position as "homepage_top" | "explore_top" | "listing_loop_between" | "sidebar_top" | "sidebar_bottom" | "sidebar_map_top",
        positions: [form.position] as Array<"homepage_top" | "explore_top" | "listing_loop_between" | "sidebar_top" | "sidebar_bottom" | "sidebar_map_top">,
        listing_id: form.listing_ids[0] ? Number(form.listing_ids[0]) : undefined,
        listing_ids: form.listing_ids.map(Number),
        start_date: form.start_date || undefined,
        end_date: form.end_date || undefined,
        status: isAdministrator ? (form.status as "publish" | "draft" | "pending") : "pending",
        sponsored_ad: form.sponsored_ad,
        sponsored_ad_expiry: form.sponsored_ad_expiry || undefined,
        max_views: form.max_views ? Number(form.max_views) : 0,
        max_clicks: form.max_clicks ? Number(form.max_clicks) : 0,
      };

      if (editingId) {
        await updatePartnerAd({ data: { id: editingId, ...payload } });
        toast.success("XP Ad updated.");
      } else {
        await createPartnerAd({ data: payload });
        toast.success("XP Ad submitted for review.");
      }
      resetForm();
      await loadAds();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save XP Ad.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mt-5 space-y-5">
      <div className="rounded-3xl bg-card p-4 ring-1 ring-border/70 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Megaphone className="size-6" /></div>
            <div>
              <h2 className="font-display text-2xl font-semibold">XP Ads</h2>
              <p className="mt-1 text-sm text-muted-foreground">Create sponsored campaigns and track how they perform across Xplore Pondy.</p>
            </div>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => void loadAds()} disabled={loading}><RefreshCw className={`mr-2 size-4 ${loading ? "animate-spin" : ""}`} />Refresh</Button>
        </div>

        <form onSubmit={submit} className="mt-6 rounded-2xl border border-border/70 bg-background p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <div><h3 className="font-semibold">{editingId ? "Edit advertisement" : "Create an advertisement"}</h3><p className="mt-1 text-xs text-muted-foreground">{editingId ? "Update the campaign details." : "New campaigns are submitted as pending for review."}</p></div>
            {editingId && <Button type="button" variant="ghost" size="sm" onClick={resetForm}>Cancel</Button>}
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="text-sm font-medium">Campaign title<input required value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="Weekend brunch promotion" className="mt-1.5 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm font-normal" /></label>
            <div className="text-sm font-medium">
              <div className="flex items-center justify-between gap-3">
                <span>Creative image</span>
                <div className="flex rounded-lg border border-border p-0.5 text-xs font-normal">
                  <button type="button" onClick={() => setImageSource("url")} className={`rounded-md px-2.5 py-1.5 ${imageSource === "url" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>Image URL</button>
                  <button type="button" onClick={() => setImageSource("upload")} className={`rounded-md px-2.5 py-1.5 ${imageSource === "upload" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>Upload</button>
                </div>
              </div>
              {imageSource === "url" ? (
                <input required type="url" value={form.image_url} onChange={(e) => setForm((f) => ({ ...f, image_url: e.target.value }))} placeholder="https://…" className="mt-1.5 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm font-normal" />
              ) : (
                <label className="mt-1.5 flex h-10 cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-background px-3 text-sm font-normal hover:bg-muted/50">
                  <Upload className="size-4" />
                  {uploadingImage ? "Uploading…" : "Choose JPG, PNG or WebP"}
                  <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={uploadingImage} onChange={(e) => { const file = e.target.files?.[0]; if (file) void uploadCreative(file); e.currentTarget.value = ""; }} />
                </label>
              )}
              {form.image_url ? (
                <div className="mt-2 flex items-center gap-3 rounded-lg border border-border bg-background p-2">
                  <img src={form.image_url} alt="" className="h-14 w-24 rounded object-cover bg-muted" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-muted-foreground">Creative ready</p>
                    <p className="truncate text-[11px] text-muted-foreground">{form.image_url}</p>
                  </div>
                  <ImagePlus className="size-4 text-primary" />
                </div>
              ) : null}
            </div>
            <label className="text-sm font-medium">Destination URL<input type="url" value={form.target_url} onChange={(e) => setForm((f) => ({ ...f, target_url: e.target.value }))} placeholder="https://…" className="mt-1.5 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm font-normal" /></label>
            <label className="text-sm font-medium">Placement<select value={form.position} onChange={(e) => setForm((f) => ({ ...f, position: e.target.value }))} className="mt-1.5 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm font-normal">{POSITIONS.map(([value, label, dimensions]) => <option key={value} value={value}>{label} — {dimensions}</option>)}</select></label>
            <div className="text-sm font-medium">
              <div className="flex items-center justify-between gap-2">
                <span>XP Ad Target Listings</span>
                {isAdministrator && <span className="text-[11px] font-normal text-muted-foreground">Admin: search all listings</span>}
              </div>
              {isAdministrator && (
                <div className="relative mt-1.5">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="search"
                    value={listingSearch}
                    onChange={(e) => setListingSearch(e.target.value)}
                    placeholder="Search all listings…"
                    className="h-10 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-sm font-normal"
                  />
                </div>
              )}
              <div className="mt-1.5 max-h-48 overflow-auto rounded-lg border border-border bg-background p-2">
                {listingSearchLoading ? (
                  <p className="px-2 py-3 text-xs text-muted-foreground">Searching listings…</p>
                ) : filteredListings.length ? (
                  filteredListings.map((item) => {
                    const id = String(Number(item.id ?? item.wpId));
                    return (
                      <label key={id} className="flex items-center gap-2 px-2 py-1.5 text-xs font-normal">
                        <input
                          type="checkbox"
                          checked={form.listing_ids.includes(id)}
                          onChange={(e) => setForm((f) => ({
                            ...f,
                            listing_ids: e.target.checked
                              ? Array.from(new Set([...f.listing_ids, id]))
                              : f.listing_ids.filter((value) => value !== id),
                          }))}
                        />
                        <span className="truncate">{item.title}</span>
                      </label>
                    );
                  })
                ) : (
                  <p className="px-2 py-3 text-xs text-muted-foreground">
                    {isAdministrator ? "No listings match your search." : "No listings available."}
                  </p>
                )}
              </div>
              {form.listing_ids.length > 0 && (
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  {form.listing_ids.length} listing{form.listing_ids.length === 1 ? "" : "s"} selected
                </p>
              )}
            </div>
            <label className="text-sm font-medium">Start date<input type="datetime-local" value={form.start_date} onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))} className="mt-1.5 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm font-normal" /></label>
            <label className="text-sm font-medium">End date<input type="datetime-local" value={form.end_date} onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))} className="mt-1.5 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm font-normal" /></label>
            <label className="text-sm font-medium">Maximum impressions<input type="number" min="0" value={form.max_views} onChange={(e) => setForm((f) => ({ ...f, max_views: e.target.value }))} placeholder="0 = unlimited" className="mt-1.5 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm font-normal" /></label>
            <label className="text-sm font-medium">Maximum clicks<input type="number" min="0" value={form.max_clicks} onChange={(e) => setForm((f) => ({ ...f, max_clicks: e.target.value }))} placeholder="0 = unlimited" className="mt-1.5 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm font-normal" /></label>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="text-sm font-medium">Ad type<select value={form.ad_type} onChange={(e) => setForm((f) => ({ ...f, ad_type: e.target.value }))} className="mt-1.5 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm font-normal">{AD_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className="text-sm font-medium">Link type<select value={form.link_type} onChange={(e) => setForm((f) => ({ ...f, link_type: e.target.value }))} className="mt-1.5 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm font-normal">{LINK_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className="text-sm font-medium">Custom URL<input type="url" value={form.custom_url} disabled={form.link_type !== "custom_url"} onChange={(e) => setForm((f) => ({ ...f, custom_url: e.target.value }))} placeholder="https://…" className="mt-1.5 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm font-normal disabled:opacity-50" /></label>
            <div className="text-sm font-medium">
              <span>Assigned user</span>
              <div className="mt-1.5 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs font-normal text-muted-foreground">WordPress user #{editingId ? (ads.find((item) => item.id === editingId)?.user_id || "—") : "assigned on submit"} · {editingId ? (ads.find((item) => item.id === editingId)?.user_email || "Email unavailable") : email}</div>
            </div>
            <label className="text-sm font-medium">Ad status<select value={form.status} disabled={!isAdministrator} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))} className="mt-1.5 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm font-normal disabled:opacity-50">{STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className="flex items-center gap-2 self-end pb-2 text-sm font-medium"><input type="checkbox" checked={form.sponsored_ad} onChange={(e) => setForm((f) => ({ ...f, sponsored_ad: e.target.checked }))} /> Sponsored Ad</label>
            <label className="text-sm font-medium">Sponsored Ad expiry<input type="datetime-local" value={form.sponsored_ad_expiry} onChange={(e) => setForm((f) => ({ ...f, sponsored_ad_expiry: e.target.value }))} className="mt-1.5 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm font-normal" /></label>
          </div>
          <div className="mt-4 rounded-xl border border-primary/20 bg-primary/5 p-3">
            <div className="flex items-start gap-2">
              <ImagePlus className="mt-0.5 size-4 shrink-0 text-primary" />
              <div className="min-w-0">
                <p className="text-xs font-semibold">Ad inventory & creative sizes</p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {POSITIONS.map(([value, label, dimensions, slots]) => (
                    <div key={value} className="rounded-lg border border-border/70 bg-background/60 px-3 py-2">
                      <p className="text-[11px] font-semibold">{label}</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">{slots} · {dimensions}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2"><Button type="submit" disabled={saving}>{saving ? "Saving…" : editingId ? <><Save className="mr-2 size-4" />Save changes</> : <><Plus className="mr-2 size-4" />Submit for review</>}</Button></div>
        </form>
      </div>

      <div className="rounded-3xl bg-card p-4 ring-1 ring-border/70 sm:p-6">
        <div className="flex items-center justify-between gap-3"><div><h3 className="font-display text-xl font-semibold">Your campaigns</h3><p className="mt-1 text-sm text-muted-foreground">Views, clicks and CTR are read from the WordPress XP Ads tracker.</p></div><span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">{ads.length} campaign{ads.length === 1 ? "" : "s"}</span></div>
        <div className="mt-5 rounded-2xl border border-border/70 bg-background p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-primary">Ad position filter</p>
              <p className="mt-1 text-xs text-muted-foreground">Filter campaigns by placement and see the remaining inventory.</p>
            </div>
            <select value={positionFilter} onChange={(e) => setPositionFilter(e.target.value)} className="h-10 min-w-64 rounded-lg border border-border bg-background px-3 text-sm">
              <option value="all">All positions · {ads.length} campaigns</option>
              {positionInventory.map((item) => <option key={item.value} value={item.value}>{item.label} · {item.active}/{item.total} active · {item.pending} pending · {item.available} available</option>)}
            </select>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
            {positionInventory.map((item) => (
              <button key={item.value} type="button" onClick={() => setPositionFilter(item.value)} className={`rounded-xl border p-3 text-left transition ${positionFilter === item.value ? "border-primary bg-primary/10" : "border-border hover:border-primary/50"}`}>
                <div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold">{item.label}</span><span className="text-[10px] text-muted-foreground">{item.dimensions}</span></div>
                <div className="mt-2 flex items-end justify-between"><span className="text-lg font-bold tabular-nums">{item.available}</span><span className="text-[10px] text-muted-foreground">available / {item.total}</span></div>
                <div className="mt-1 flex flex-wrap gap-x-2 text-[10px] text-muted-foreground">
                  <span>{item.active} active</span>
                  {item.pending > 0 && <span>{item.pending} pending</span>}
                  <span>{item.occupied}/{item.total} occupied</span>
                </div>
              </button>
            ))}
          </div>
        </div>
        {loading ? <p className="mt-5 text-sm text-muted-foreground">Loading XP Ads…</p> : ads.length === 0 ? <div className="mt-5 rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No campaigns yet. Create your first advertisement above.</div> : filteredAds.length === 0 ? <div className="mt-5 rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No campaigns are assigned to this ad position.</div> : <div className="mt-4 space-y-3"><div className="text-xs text-muted-foreground">Showing {filteredAds.length} of {ads.length} campaigns</div>{filteredAds.map((ad) => <article key={ad.id} className="rounded-2xl border border-border/70 bg-background p-4"><div className="flex flex-col gap-4 lg:flex-row lg:items-center"><img src={ad.image_url} alt="" className="h-20 w-36 shrink-0 rounded-lg border border-border object-cover bg-muted" /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h4 className="font-semibold">{ad.title}</h4><span className="rounded-full bg-muted px-2 py-1 text-[11px] font-semibold uppercase">{ad.post_status || ad.status || "unknown"}</span></div><p className="mt-1 text-xs text-muted-foreground">{POSITIONS.find(([value]) => value === ad.position)?.[1] ?? ad.position}{ad.listing_id ? ` · ${listingMap.get(ad.listing_id) ?? `Listing #${ad.listing_id}`}` : ""} · Ad #{ad.id}</p><div className="mt-3 grid grid-cols-3 gap-3 sm:max-w-md"><div><p className="text-[11px] text-muted-foreground">Impressions</p><p className="font-bold tabular-nums">{ad.views.toLocaleString("en-IN")}</p></div><div><p className="text-[11px] text-muted-foreground">Clicks</p><p className="font-bold tabular-nums">{ad.clicks.toLocaleString("en-IN")}</p></div><div><p className="text-[11px] text-muted-foreground">CTR</p><p className="font-bold tabular-nums">{Number(ad.ctr ?? 0).toFixed(2)}%</p></div></div></div><Button type="button" variant="outline" size="sm" onClick={() => editAd(ad)} disabled={ad.post_status === "publish" && !isAdministrator}><Pencil className="mr-2 size-4" />Edit</Button></div></article>)}</div>}
      </div>
    </section>
  );
}
