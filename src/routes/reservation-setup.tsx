import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Bell, CalendarDays, ChartNoAxesCombined, ChevronDown, ClipboardList, QrCode, Save, Settings2, Store, Ticket } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { fetchListingIdentityBySlug, fetchTableReservationOwnerSettings, saveTableReservationOwnerSettings, type TableReservationOwnerSettings } from "@/lib/wp-api";
import { fetchOwnerListings } from "@/lib/owner-listings";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { HeaderAuth } from "@/components/header-auth";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { useSession } from "@/store/session";

export const Route = createFileRoute("/reservation-setup")({
  validateSearch: (search: Record<string, unknown>) => ({
    listingId: Number.isInteger(Number(search.listingId)) && Number(search.listingId) > 0 ? Number(search.listingId) : undefined,
    listingTitle: typeof search.listingTitle === "string" ? search.listingTitle : undefined,
    listingSlug: typeof search.listingSlug === "string" ? search.listingSlug : undefined,
  }),
  component: ReservationSetupPage,
});

function ReservationSetupPage() {
  const { listingId, listingTitle: routeListingTitle, listingSlug: routeListingSlug } = Route.useSearch();
  const { user: googleUser } = useCurrentUserState();
  const wpUser = useSession((s) => s.user);
  const email = googleUser?.primaryEmail ?? wpUser?.email ?? "";
  const userId = wpUser?.id;
  const [settings, setSettings] = useState<TableReservationOwnerSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [ownerListings, setOwnerListings] = useState<Array<{id:number;title:string;slug:string}>>([]);
  const [listingsLoading, setListingsLoading] = useState(true);
  const [listingSearch, setListingSearch] = useState("");
  const [listingDropdownOpen, setListingDropdownOpen] = useState(false);
  const identityToken = useSession((s) => s.identityToken);

  useEffect(() => {
    if (!email) { setListingsLoading(false); return; }
    let cancelled = false;
    void fetchOwnerListings({ data: { email, ...(identityToken ? { identityToken } : {}) } })
      .then((raw) => { const result = raw as { items?: Array<{id:number;title?:string;slug?:string}> }; if (!cancelled) setOwnerListings((result.items ?? []).map((item) => ({ id:item.id, title:item.title || ("Listing #" + item.id), slug:item.slug || String(item.id) }))); })
      .catch((error) => { if (!cancelled) toast.error(error instanceof Error ? error.message : "Could not load your listings."); })
      .finally(() => { if (!cancelled) setListingsLoading(false); });
    return () => { cancelled = true; };
  }, [email, identityToken]);

  const filteredListings = useMemo(() => ownerListings.filter((item) => (item.title + " " + item.slug).toLowerCase().includes(listingSearch.trim().toLowerCase())), [ownerListings, listingSearch]);

  useEffect(() => {
    if (!listingId || !email) { setLoading(false); setSettings(null); return; }
    setLoading(true);
    let cancelled = false;
    void fetchTableReservationOwnerSettings({ data: { email, userId, listingId } })
      .then(async (value) => {
        const titleIsPlaceholder = /^Listing #\d+$/i.test(String(value.listingTitle ?? "").trim());
        const identity = titleIsPlaceholder
          ? await fetchListingIdentityBySlug({ data: { slug: value.listingSlug || routeListingSlug || "" } }).catch(() => ({ title: "", slug: "" }))
          : { title: "", slug: "" };
        if (!cancelled) {
          setSettings({
            ...value,
            listingTitle: titleIsPlaceholder
              ? (routeListingTitle || identity.title || value.listingTitle || `Listing #${listingId}`)
              : value.listingTitle,
            listingSlug: value.listingSlug || routeListingSlug || identity.slug || "",
          });
        }
      })
      .catch((e) => { if (!cancelled) toast.error(e instanceof Error ? e.message : "Could not load reservation settings."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [listingId, email, userId, routeListingTitle, routeListingSlug]);

  const save = async () => {
    if (!settings || !email) return;
    setSaving(true);
    try {
      const daysToSave = settings.days.map((day) => ({ ...day }));
      await saveTableReservationOwnerSettings({
        data: {
          email, userId, listingId,
          enabled: settings.enabled, durationMinutes: settings.durationMinutes,
          advanceDays: settings.advanceDays, minGuests: settings.minGuests,
          maxGuests: settings.maxGuests, cutoffMinutes: settings.cutoffMinutes,
          autoConfirm: settings.autoConfirm, timezone: settings.timezone, days: daysToSave,
        },
      });

      // Do not replace the just-entered hours with a potentially stale/intermediate
      // representation returned by a cached WordPress layer. The POST succeeded,
      // so keep the exact values that were submitted in local state.
      setSettings((current) => current ? { ...current, days: daysToSave } : current);
      toast.success("Reservation settings saved.");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not save reservation settings."); }
    finally { setSaving(false); }
  };

  return <div className="xp-partner-shell">
    <header className="xp-partner-header"><Link to="/dashboard" search={{}} className="xp-partner-brand"><Logo /><span className="xp-partner-brand-label">PARTNER</span></Link><div className="xp-partner-header-right"><a href="https://xplorepondy.com" target="_blank" rel="noreferrer" className="xp-partner-site-link">View website ↗</a><ThemeToggle /><HeaderAuth /></div></header>
    <div className="xp-partner-app-layout">
      <aside className="xp-partner-sidebar"><div className="xp-partner-sidebar-label">WORKSPACE</div><nav aria-label="Partner portal navigation">{shellNav.map((item) => <Link key={item.label} to={item.to as any} search={{}} className="xp-partner-nav-link"><item.icon className="size-4"/><span>{item.label}</span></Link>)}<Link to="/reservation-setup" search={{}} className="xp-partner-nav-link" aria-current="page"><Settings2 className="size-4"/><span>Reservation setup</span></Link></nav><div className="xp-partner-sidebar-footer"><div className="xp-partner-online-dot"/> Connected to Xplore Pondy</div></aside>
      <main className="xp-partner-main">
        <div className="xp-partner-page-heading"><div><div className="xp-partner-eyebrow">PARTNER WORKSPACE</div><h1>Setup Reservation</h1><p>Select a listing and manage its table reservation availability.</p></div></div>
        <section className="mb-6 max-w-3xl rounded-2xl border border-border/70 bg-card p-5"><label className="mb-2 block text-sm font-medium">Select listing</label><div className="relative">
          <button type="button" aria-expanded={listingDropdownOpen} onClick={() => setListingDropdownOpen((open) => !open)} className="flex h-11 w-full items-center justify-between rounded-xl border border-border bg-background px-4 text-left text-sm"><span className={selectedListing ? "text-foreground" : "text-muted-foreground"}>{selectedListing?.title ?? (listingsLoading ? "Loading listings…" : "Choose a listing")}</span><ChevronDown className="size-4"/></button>
          {listingDropdownOpen && <div className="absolute z-50 mt-2 w-full overflow-hidden rounded-xl border border-border bg-card shadow-xl"><div className="border-b border-border p-2"><input autoFocus value={listingSearch} onChange={(e) => setListingSearch(e.target.value)} placeholder="Search listings…" className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary"/></div><div className="max-h-64 overflow-y-auto p-1">{listingsLoading ? <p className="p-3 text-sm text-muted-foreground">Loading listings…</p> : filteredListings.length ? filteredListings.map((item) => <Link key={item.id} to="/reservation-setup" search={{ listingId:item.id, listingTitle:item.title, listingSlug:item.slug }} onClick={() => { setListingDropdownOpen(false); setListingSearch(""); }} className={"block rounded-lg px-3 py-2.5 text-sm hover:bg-primary/10 " + (item.id === listingId ? "bg-primary/10 text-primary" : "")}>{item.title}</Link>) : <p className="p-3 text-sm text-muted-foreground">No listings found.</p>}</div></div>}
        </div></section>
        {listingId ? <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-display text-2xl font-semibold">{settings?.listingTitle || routeListingTitle || selectedListing?.title || ("Listing #" + listingId)}</h2>{settings?.listingSlug && <a href={"https://xplorepondy.com/listing/" + settings.listingSlug + "/"} target="_blank" rel="noreferrer" className="text-sm text-primary hover:underline">View listing ↗</a>}</div><Button onClick={() => void save()} disabled={!settings || loading || saving}><Save /> {saving ? "Saving…" : "Save Settings"}</Button></div> : <p className="text-sm text-muted-foreground">Choose one of your listings above to configure its reservation settings.</p>}


}