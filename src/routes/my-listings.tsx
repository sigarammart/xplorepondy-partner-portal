import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, CalendarDays, Eye, LoaderCircle, Settings2, Store } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAppLoggedIn } from "@/lib/app-session";
import { fetchTableReservationOwnerDashboard, fetchWpAuthorContent, fetchWpListingViewStats, type ListingViewStats } from "@/lib/wp-api";
import { useSession } from "@/store/session";
import { OwnerListingsManager } from "@/components/owner-listings-manager";

export const Route = createFileRoute("/my-listings")({ component: MyListingsPage });

type OwnerListing = { id: number; slug: string; title: string; url?: string };

function MyListingsPage() {
  const { loggedIn, wpUser, grokUser } = useAppLoggedIn();
  const sessionUser = useSession((state) => state.user);
  const sessionListings = useSession((state) => state.myListings);
  const wpIdentityToken = useSession((state) => state.wpIdentityToken);
  const email = (grokUser?.primaryEmail || wpUser?.email || sessionUser?.email || "").trim().toLowerCase();
  const [items, setItems] = useState<OwnerListing[]>([]);
  const [selectedId, setSelectedId] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [viewStats, setViewStats] = useState<Record<number, ListingViewStats>>({});
  const [viewStatsLoading, setViewStatsLoading] = useState(false);
  const [viewRange, setViewRange] = useState<7 | 30 | 90>(7);
  const authorId = sessionUser?.id ?? wpUser?.id;

  useEffect(() => {
    let cancelled = false;
    if (!loggedIn) {
      setItems([]);
      setLoading(false);
      return () => { cancelled = true; };
    }
    setLoading(true);
    setError("");
    const cachedListings = sessionListings.map((item) => ({
      id: item.wpId,
      slug: item.slug,
      title: item.name || "Untitled listing",
      url: item.siteUrl,
    }));
    const loadListings = async () => {
      // Use the same owner bridge as the dashboard summary: it resolves
      // listings associated with the signed-in account/email, not just posts
      // whose WordPress author ID matches the app session ID.
      let bridgeListings: OwnerListing[] = [];
      if (email) {
        try {
          const owner = await fetchTableReservationOwnerDashboard({
            data: { email, ...(authorId ? { userId: authorId } : {}) },
          });
          bridgeListings = (owner.listings ?? []).map((item) => ({
            id: item.id,
            slug: item.slug,
            title: item.title || "Untitled listing",
            url: item.slug ? `https://xplorepondy.com/listing/${item.slug}/` : undefined,
          }));
        } catch {
          // Continue to the author/session sources below.
        }
      }
      if (cancelled) return;
      if (bridgeListings.length > 0) {
        setItems(bridgeListings);
        return;
      }
      if (authorId) {
        try {
          const result = await fetchWpAuthorContent({ data: { authorId } });
          if (cancelled) return;
          const authored = (result.myListings ?? []).map((item) => ({
            id: item.wpId,
            slug: item.slug,
            title: item.title || "Untitled listing",
            url: item.url,
          }));
          if (authored.length > 0) {
            setItems(authored);
            return;
          }
        } catch {
          // Session data remains a fallback.
        }
      }
      if (!cancelled) setItems(cachedListings);
    };
    void loadListings()
      .catch((reason) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : "Could not load your listings.");
          setItems(cachedListings);
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [loggedIn, authorId, email, sessionListings]);

  useEffect(() => {
    if (selectedId !== "all" && items.length && !items.some((item) => String(item.id) === selectedId)) {
      setSelectedId("all");
    }
  }, [items, selectedId]);

  useEffect(() => {
    let cancelled = false;
    if (loading || items.length === 0) {
      setViewStats({});
      return () => { cancelled = true; };
    }
    setViewStatsLoading(true);
    void fetchWpListingViewStats({ data: { ids: items.map((item) => item.id) } })
      .then((stats) => { if (!cancelled) setViewStats(stats); })
      .catch(() => { if (!cancelled) setViewStats({}); })
      .finally(() => { if (!cancelled) setViewStatsLoading(false); });
    return () => { cancelled = true; };
  }, [items, loading]);

  const selected = useMemo(
    () => selectedId === "all" ? undefined : items.find((item) => String(item.id) === selectedId),
    [items, selectedId],
  );
  const allListingsSelected = selectedId === "all";

  if (!loggedIn) {
    return <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6"><h1 className="font-display text-3xl font-semibold">My Listings</h1><p className="mt-2 text-muted-foreground">Sign in to manage your directory listings and reservations.</p><Button asChild className="mt-4"><Link to="/login">Sign in</Link></Button></main>;
  }

  return <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
    <Link to="/dashboard" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Owner Dashboard</Link>
    <section className="mt-4 rounded-3xl bg-card p-4 ring-1 ring-border/70 sm:p-6">
      <div className="flex items-center gap-3">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Store className="size-6" /></div>
        <div><h1 className="font-display text-2xl font-semibold">Listing Owner</h1><p className="text-sm text-muted-foreground">Manage your directory listings and reservations.</p></div>
      </div>

      <OwnerListingsManager loggedIn={loggedIn} allowedListingIds={items.map((item) => item.id)} listingsResolved={!loading} email={email} identityToken={wpIdentityToken ?? undefined} />

      {loading && <p className="mt-5 flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />Loading your listings…</p>}
      {error && <p role="alert" className="mt-4 rounded-xl border border-destructive/30 p-3 text-sm text-destructive">{error}</p>}
      {!loading && items.length === 0 && <div className="mt-5 rounded-2xl border border-dashed border-border p-6 text-center"><Store className="mx-auto size-8 text-muted-foreground" /><h2 className="mt-3 font-semibold">No listings found</h2><p className="mt-1 text-sm text-muted-foreground">No directory listings are currently attached to this account.</p><Button asChild variant="outline" className="mt-4"><Link to="/dashboard">Back to Owner Dashboard</Link></Button></div>}

      {!loading && items.length > 0 && <>
        <label htmlFor="owner-listing-select" className="mt-6 block text-sm font-medium">Select listing</label>
        <select id="owner-listing-select" value={selectedId} onChange={(event) => setSelectedId(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-border bg-background px-3 text-sm">
          <option value="all">All listings</option>
          {items.map((item) => <option key={item.id} value={String(item.id)}>{item.title}</option>)}
        </select>

        <section aria-label="Listing views" className="mt-5 rounded-2xl border border-border/70 bg-background p-4 sm:p-5">
          <div className="flex items-center gap-2">
            <Eye className="size-5 text-primary" />
            <h2 className="font-display text-lg font-semibold">Listing views</h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {allListingsSelected ? "Combined views across your listings." : `Views for ${selected!.title}.`}
          </p>
          {(() => {
            const visibleStats = (allListingsSelected ? items : selected ? [selected] : [])
              .map((item) => viewStats[item.id])
              .filter((stats): stats is ListingViewStats => Boolean(stats));
            const total = visibleStats.reduce((sum, stats) => sum + stats.total_views, 0);
            const website = visibleStats.reduce((sum, stats) => sum + stats.website_views, 0);
            const app = visibleStats.reduce((sum, stats) => sum + stats.app_views, 0);
            const sidepanel = visibleStats.reduce((sum, stats) => sum + stats.app_sidepanel_views, 0);
            const dailyTotals = new Map<string, { app: number; sidepanel: number; detail: number }>();
            for (const stats of visibleStats) {
              for (const [day, row] of Object.entries(stats.daily_app_views ?? {})) {
                const existing = dailyTotals.get(day) ?? { app: 0, sidepanel: 0, detail: 0 };
                existing.app += row.app_views;
                existing.sidepanel += row.sidepanel_views;
                existing.detail += row.detail_views;
                dailyTotals.set(day, existing);
              }
            }
            const today = new Date();
            const days = Array.from({ length: viewRange }, (_, index) => {
              const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (viewRange - 1 - index));
              const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
              return { key, label: date.toLocaleDateString(undefined, { month: "short", day: "numeric" }), ...(dailyTotals.get(key) ?? { app: 0, sidepanel: 0, detail: 0 }) };
            });
            const rangeApp = days.reduce((sum, day) => sum + day.app, 0);
            const rangeSidepanel = days.reduce((sum, day) => sum + day.sidepanel, 0);
            const rangeDetail = days.reduce((sum, day) => sum + day.detail, 0);
            const maxDaily = Math.max(1, ...days.map((day) => day.app));
            return <>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-xl bg-muted/60 p-3"><p className="text-xs text-muted-foreground">All-time total</p><p className="mt-1 text-2xl font-semibold tabular-nums">{viewStatsLoading ? "…" : total.toLocaleString()}</p></div>
                <div className="rounded-xl bg-muted/60 p-3"><p className="text-xs text-muted-foreground">Website · all time</p><p className="mt-1 text-xl font-semibold tabular-nums">{viewStatsLoading ? "…" : website.toLocaleString()}</p></div>
                <div className="rounded-xl bg-muted/60 p-3"><p className="text-xs text-muted-foreground">App · all time</p><p className="mt-1 text-xl font-semibold tabular-nums">{viewStatsLoading ? "…" : app.toLocaleString()}</p></div>
                <div className="rounded-xl bg-muted/60 p-3"><p className="text-xs text-muted-foreground">App sidepanel · all time</p><p className="mt-1 text-xl font-semibold tabular-nums">{viewStatsLoading ? "…" : sidepanel.toLocaleString()}</p></div>
              </div>
              <div className="mt-5 rounded-xl border border-border/70 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div><h3 className="font-semibold">Recent app views</h3><p className="text-xs text-muted-foreground">Daily tracking starts when this update is deployed; older daily history is unavailable.</p></div>
                  <select aria-label="View date range" value={String(viewRange)} onChange={(event) => setViewRange(Number(event.target.value) as 7 | 30 | 90)} className="h-9 rounded-lg border border-border bg-background px-3 text-sm">
                    <option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option>
                  </select>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2">
                  <div className="rounded-lg bg-muted/60 p-3"><p className="text-xs text-muted-foreground">App views</p><p className="mt-1 text-xl font-semibold tabular-nums">{viewStatsLoading ? "…" : rangeApp.toLocaleString()}</p></div>
                  <div className="rounded-lg bg-muted/60 p-3"><p className="text-xs text-muted-foreground">Sidepanel</p><p className="mt-1 text-xl font-semibold tabular-nums">{viewStatsLoading ? "…" : rangeSidepanel.toLocaleString()}</p></div>
                  <div className="rounded-lg bg-muted/60 p-3"><p className="text-xs text-muted-foreground">Detail page</p><p className="mt-1 text-xl font-semibold tabular-nums">{viewStatsLoading ? "…" : rangeDetail.toLocaleString()}</p></div>
                </div>
                <div className="mt-4 space-y-2">
                  {days.map((day) => <div key={day.key} className="grid grid-cols-[4.5rem_minmax(0,1fr)_2.5rem] items-center gap-2 text-xs">
                    <span className="text-muted-foreground">{day.label}</span>
                    <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${(day.app / maxDaily) * 100}%` }} /></div>
                    <span className="text-right font-medium tabular-nums">{day.app}</span>
                  </div>)}
                </div>
              </div>
            </>;
          })()}
        </section>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <Link to="/dashboard" search={allListingsSelected ? { view: "bookings" } : { view: "bookings", listingId: selected!.id }} className="group rounded-2xl border border-border/70 bg-background p-5 transition hover:border-primary/50 hover:bg-muted">
            <CalendarDays className="size-6 text-primary" />
            <h2 className="mt-3 font-display text-lg font-semibold">View Bookings</h2>
            <p className="mt-1 text-sm text-muted-foreground">{allListingsSelected ? "View and manage reservations across all your listings." : `View and manage reservations for ${selected!.title}.`}</p>
            <span className="mt-4 inline-block text-sm font-medium text-primary group-hover:underline">Open bookings →</span>
          </Link>
          {selected ? <Link to="/reservation-setup" search={{ listingId: selected.id, listingTitle: selected.title, listingSlug: selected.slug }} className="group rounded-2xl border border-border/70 bg-background p-5 transition hover:border-primary/50 hover:bg-muted">
            <Settings2 className="size-6 text-primary" />
            <h2 className="mt-3 font-display text-lg font-semibold">Setup Reservations</h2>
            <p className="mt-1 text-sm text-muted-foreground">Configure opening hours, slots, capacity and booking rules.</p>
            <span className="mt-4 inline-block text-sm font-medium text-primary group-hover:underline">Open setup →</span>
          </Link> : <div className="rounded-2xl border border-dashed border-border/70 bg-background/60 p-5">
            <Settings2 className="size-6 text-muted-foreground" />
            <h2 className="mt-3 font-display text-lg font-semibold">Setup Reservations</h2>
            <p className="mt-1 text-sm text-muted-foreground">Select a specific listing above to configure its opening hours, slots, capacity and booking rules.</p>
          </div>}
        </div>
        <div className="mt-4 text-sm">{selected?.url && <a href={selected.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">View listing ↗</a>}</div>
      </>}
    </section>
  </main>;
}
