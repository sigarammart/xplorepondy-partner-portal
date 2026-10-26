import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { fetchListingIdentityBySlug, fetchTableReservationOwnerSettings, saveTableReservationOwnerSettings, type TableReservationOwnerSettings } from "@/lib/wp-api";
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

  useEffect(() => {
    if (!listingId || !email) { setLoading(false); return; }
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

  if (!listingId) return <div className="mx-auto max-w-3xl px-4 py-10"><p>Select a listing first.</p><Button asChild variant="outline" className="mt-4"><Link to="/dashboard">Back to Listing Owner</Link></Button></div>;

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

  return <div className="mx-auto max-w-4xl px-4 py-8">
    <Link to="/dashboard" className="inline-flex items-center gap-2 text-sm text-muted-foreground"><ArrowLeft className="size-4" /> Listing Owner</Link>
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="font-display text-3xl font-semibold">Setup Reservation</h1>
        {settings ? (
          <a href={`https://xplorepondy.com/listing/${settings.listingSlug}/`} target="_blank" rel="noreferrer" className="mt-1 inline-flex text-sm font-medium text-primary hover:underline">
            {settings.listingTitle}
          </a>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">Listing #{listingId}</p>
        )}
      </div>
      <Button onClick={() => void save()} disabled={!settings || loading || saving}><Save /> {saving ? "Saving…" : "Save Settings"}</Button>
    </div>
    {loading ? <p className="mt-8 text-sm text-muted-foreground">Loading…</p> : !settings ? <p className="mt-8 text-sm text-destructive">Unable to load settings.</p> : <div className="mt-6 space-y-5">
      <section className="rounded-2xl bg-card p-5 ring-1 ring-border/70">
        <div className="flex items-center justify-between"><div><h2 className="font-semibold">Reservations</h2><p className="text-sm text-muted-foreground">Enable table reservations.</p></div><input type="checkbox" checked={settings.enabled} onChange={e=>setSettings({...settings,enabled:e.target.checked})} className="size-5" /></div>
      </section>
      <section className="rounded-2xl bg-card p-5 ring-1 ring-border/70">
        <h2 className="font-semibold">Booking rules</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {([["durationMinutes","Duration (minutes)",15,480],["advanceDays","Advance days",0,30],["cutoffMinutes","Cutoff (minutes)",0,1440],["minGuests","Minimum guests",1,100],["maxGuests","Maximum guests",1,100]] as const).map(([key,label,min,max])=><label key={key} className="text-sm">{label}<input type="number" min={min} max={max} value={settings[key]} onChange={e=>setSettings({...settings,[key]:Number(e.target.value)})} className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3" /></label>)}
          <label className="text-sm">Timezone<select value={settings.timezone} onChange={e=>setSettings({...settings,timezone:e.target.value})} className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3"><option>Asia/Kolkata</option><option>Asia/Dubai</option><option>Asia/Singapore</option><option>Europe/London</option><option>America/New_York</option></select></label>
        </div>
        <label className="mt-4 flex items-center gap-2 text-sm"><input type="checkbox" checked={settings.autoConfirm} onChange={e=>setSettings({...settings,autoConfirm:e.target.checked})} /> Automatically confirm reservations</label>
      </section>
      <section className="rounded-2xl bg-card p-5 ring-1 ring-border/70">
        <h2 className="font-semibold">Opening hours & table capacity</h2>
        <div className="mt-4 space-y-3">{settings.days.map(day=><div key={day.day} className="rounded-xl border border-border/70 p-3"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6"><div className="font-medium">{day.name}</div><label className="text-sm"><input type="checkbox" checked={day.active} onChange={e=>setSettings({...settings,days:settings.days.map(d=>d.day===day.day?{...d,active:e.target.checked}:d)})} /> Open</label><label className="text-sm">From<input type="time" disabled={!day.active} value={day.open} onChange={e=>setSettings({...settings,days:settings.days.map(d=>d.day===day.day?{...d,open:e.target.value}:d)})} className="mt-1 h-9 w-full rounded-lg border border-border bg-background px-2" /></label><label className="text-sm">To<input type="time" disabled={!day.active} value={day.close} onChange={e=>setSettings({...settings,days:settings.days.map(d=>d.day===day.day?{...d,close:e.target.value}:d)})} className="mt-1 h-9 w-full rounded-lg border border-border bg-background px-2" /></label><label className="text-sm">Interval<input type="number" min={5} max={240} disabled={!day.active} value={day.interval} onChange={e=>setSettings({...settings,days:settings.days.map(d=>d.day===day.day?{...d,interval:Number(e.target.value)}:d)})} className="mt-1 h-9 w-full rounded-lg border border-border bg-background px-2" /></label><label className="text-sm">Capacity<input type="number" min={1} max={1000} disabled={!day.active} value={day.capacity} onChange={e=>setSettings({...settings,days:settings.days.map(d=>d.day===day.day?{...d,capacity:Number(e.target.value)}:d)})} className="mt-1 h-9 w-full rounded-lg border border-border bg-background px-2" /></label></div></div>)}</div>
    </section>
      <div className="flex justify-end pt-1 pb-2">
        <Button onClick={() => void save()} disabled={!settings || loading || saving}>
          <Save /> {saving ? "Saving…" : "Save Settings"}
        </Button>
      </div>
    </div>}
  </div>;
}