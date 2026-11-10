import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Megaphone, Pencil, Plus, RefreshCw, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createPartnerAd, fetchPartnerAds, updatePartnerAd, type PartnerAd } from "@/lib/owner-listings";

type ListingOption = { id?: number; wpId?: number; title: string; slug?: string };

type Props = {
  email: string;
  identityToken?: string;
  listings: ListingOption[];
  isAdministrator?: boolean;
};

const POSITIONS = [
  ["homepage_top", "Homepage top"],
  ["listing_loop_between", "Explore — after listings"],
  ["sidebar_top", "Sidebar top"],
  ["sidebar_bottom", "Sidebar bottom"],
  ["sidebar_map_top", "Map sidebar top"],
] as const;

const emptyForm = {
  title: "",
  image_url: "",
  target_url: "",
  position: "homepage_top" as string,
  listing_id: "",
  start_date: "",
  end_date: "",
  max_views: "",
  max_clicks: "",
};

export function PartnerAdsManager({ email, identityToken, listings, isAdministrator = false }: Props) {
  const [ads, setAds] = useState<PartnerAd[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState(emptyForm);

  const listingMap = useMemo(() => new Map(
    listings.map((item) => [Number(item.id ?? item.wpId), item.title]),
  ), [listings]);

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

  useEffect(() => { void loadAds(); }, [email, identityToken]);

  function resetForm() {
    setEditingId(null);
    setForm(emptyForm);
  }

  function editAd(ad: PartnerAd) {
    if (ad.post_status === "publish" && !isAdministrator) {
      toast.error("Published advertisements require an admin-reviewed revision.");
      return;
    }
    setEditingId(ad.id);
    setForm({
      title: ad.title,
      image_url: ad.image_url,
      target_url: ad.target_url,
      position: ad.position,
      listing_id: ad.listing_id ? String(ad.listing_id) : "",
      start_date: ad.start_date,
      end_date: ad.end_date,
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
    setSaving(true);
    try {
      const payload = {
        email,
        ...(identityToken ? { identityToken } : {}),
        title: form.title.trim(),
        image_url: form.image_url.trim(),
        target_url: form.target_url.trim() || undefined,
        position: form.position as "homepage_top" | "listing_loop_between" | "sidebar_top" | "sidebar_bottom" | "sidebar_map_top",
        listing_id: form.listing_id ? Number(form.listing_id) : undefined,
        start_date: form.start_date || undefined,
        end_date: form.end_date || undefined,
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
            <label className="text-sm font-medium">Creative image URL<input required type="url" value={form.image_url} onChange={(e) => setForm((f) => ({ ...f, image_url: e.target.value }))} placeholder="https://…" className="mt-1.5 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm font-normal" /></label>
            <label className="text-sm font-medium">Destination URL<input type="url" value={form.target_url} onChange={(e) => setForm((f) => ({ ...f, target_url: e.target.value }))} placeholder="https://…" className="mt-1.5 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm font-normal" /></label>
            <label className="text-sm font-medium">Placement<select value={form.position} onChange={(e) => setForm((f) => ({ ...f, position: e.target.value }))} className="mt-1.5 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm font-normal">{POSITIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className="text-sm font-medium">Linked listing<select value={form.listing_id} onChange={(e) => setForm((f) => ({ ...f, listing_id: e.target.value }))} className="mt-1.5 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm font-normal"><option value="">No linked listing</option>{listings.map((item) => { const id = Number(item.id ?? item.wpId); return <option key={id} value={id}>{item.title}</option>; })}</select></label>
            <label className="text-sm font-medium">Start date<input type="datetime-local" value={form.start_date} onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))} className="mt-1.5 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm font-normal" /></label>
            <label className="text-sm font-medium">End date<input type="datetime-local" value={form.end_date} onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))} className="mt-1.5 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm font-normal" /></label>
            <label className="text-sm font-medium">Maximum impressions<input type="number" min="0" value={form.max_views} onChange={(e) => setForm((f) => ({ ...f, max_views: e.target.value }))} placeholder="0 = unlimited" className="mt-1.5 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm font-normal" /></label>
            <label className="text-sm font-medium">Maximum clicks<input type="number" min="0" value={form.max_clicks} onChange={(e) => setForm((f) => ({ ...f, max_clicks: e.target.value }))} placeholder="0 = unlimited" className="mt-1.5 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm font-normal" /></label>
          </div>
          <div className="mt-4 flex flex-wrap gap-2"><Button type="submit" disabled={saving}>{saving ? "Saving…" : editingId ? <><Save className="mr-2 size-4" />Save changes</> : <><Plus className="mr-2 size-4" />Submit for review</>}</Button></div>
        </form>
      </div>

      <div className="rounded-3xl bg-card p-4 ring-1 ring-border/70 sm:p-6">
        <div className="flex items-center justify-between gap-3"><div><h3 className="font-display text-xl font-semibold">Your campaigns</h3><p className="mt-1 text-sm text-muted-foreground">Views, clicks and CTR are read from the WordPress XP Ads tracker.</p></div><span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">{ads.length} campaign{ads.length === 1 ? "" : "s"}</span></div>
        {loading ? <p className="mt-5 text-sm text-muted-foreground">Loading XP Ads…</p> : ads.length === 0 ? <div className="mt-5 rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No campaigns yet. Create your first advertisement above.</div> : <div className="mt-4 space-y-3">{ads.map((ad) => <article key={ad.id} className="rounded-2xl border border-border/70 bg-background p-4"><div className="flex flex-col gap-4 lg:flex-row lg:items-center"><img src={ad.image_url} alt="" className="h-20 w-36 shrink-0 rounded-lg border border-border object-cover bg-muted" /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h4 className="font-semibold">{ad.title}</h4><span className="rounded-full bg-muted px-2 py-1 text-[11px] font-semibold uppercase">{ad.post_status || ad.status || "unknown"}</span></div><p className="mt-1 text-xs text-muted-foreground">{POSITIONS.find(([value]) => value === ad.position)?.[1] ?? ad.position}{ad.listing_id ? ` · ${listingMap.get(ad.listing_id) ?? `Listing #${ad.listing_id}`}` : ""}</p><div className="mt-3 grid grid-cols-3 gap-3 sm:max-w-md"><div><p className="text-[11px] text-muted-foreground">Impressions</p><p className="font-bold tabular-nums">{ad.views.toLocaleString("en-IN")}</p></div><div><p className="text-[11px] text-muted-foreground">Clicks</p><p className="font-bold tabular-nums">{ad.clicks.toLocaleString("en-IN")}</p></div><div><p className="text-[11px] text-muted-foreground">CTR</p><p className="font-bold tabular-nums">{Number(ad.ctr ?? 0).toFixed(2)}%</p></div></div></div><Button type="button" variant="outline" size="sm" onClick={() => editAd(ad)} disabled={ad.post_status === "publish" && !isAdministrator}><Pencil className="mr-2 size-4" />Edit</Button></div></article>)}</div>}
      </div>
    </section>
  );
}
