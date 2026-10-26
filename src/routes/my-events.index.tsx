import { createFileRoute, Link } from "@tanstack/react-router";
import { CalendarDays, ExternalLink, LoaderCircle, MapPin, PlusCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAppLoggedIn } from "@/lib/app-session";
import { useSession } from "@/store/session";
import { fetchMyEvents, type EventAccountItem } from "@/lib/events-api";

export const Route = createFileRoute("/my-events/")({ component: MyEventsPage });

function MyEventsPage() {
  const { loggedIn, wpUser, grokUser } = useAppLoggedIn();
  const identityToken = useSession((state) => state.wpIdentityToken);
  const sessionEmail = useSession((state) => state.user?.email ?? "");
  const email = (grokUser?.primaryEmail || wpUser?.email || sessionEmail).trim().toLowerCase();
  const [items, setItems] = useState<EventAccountItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    if (!loggedIn || !email) { setLoading(false); return; }
    fetchMyEvents({ data: { email, identityToken: identityToken ?? undefined } })
      .then((result) => { if (active) setItems(result.items ?? []); })
      .catch((e) => { if (active) setError(e instanceof Error ? e.message : "Could not load your events."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [loggedIn, email, identityToken]);
  const statusLabel = (status?: string) => ({ publish: "Published", pending: "Pending review", draft: "Draft", future: "Scheduled", private: "Private" } as Record<string, string>)[status ?? ""] ?? status ?? "Unknown";
  return <div className="mx-auto max-w-4xl py-5 sm:py-8">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Event dashboard</p><h1 className="mt-1 font-display text-3xl font-semibold">My Events</h1><p className="mt-2 text-sm text-muted-foreground">Manage events you have submitted and keep track of registrations.</p></div>
      <Button asChild variant="outline"><Link to="/submit-event"><PlusCircle className="mr-2 size-4"/>Submit an event</Link></Button>
    </div>
    {!loggedIn ? <div className="mt-6 rounded-2xl border p-8 text-center"><CalendarDays className="mx-auto size-8 text-primary"/><h2 className="mt-3 font-semibold">Sign in to view your events</h2><Button className="mt-4" asChild><Link to="/login">Sign in</Link></Button></div>
    : loading ? <div className="mt-8 flex justify-center p-8 text-muted-foreground"><LoaderCircle className="mr-2 size-5 animate-spin"/>Loading your events…</div>
    : error ? <div className="mt-6 rounded-xl border border-destructive/40 p-5 text-sm">{error}</div>
    : items.length === 0 ? <div className="mt-6 rounded-2xl border border-dashed p-8 text-center"><CalendarDays className="mx-auto size-8 text-muted-foreground"/><h2 className="mt-3 font-semibold">No events yet</h2><p className="mt-1 text-sm text-muted-foreground">Events you submit will appear here with their review status.</p><Button className="mt-4" asChild><Link to="/submit-event">Submit your first event</Link></Button></div>
    : <div className="mt-6 space-y-3">{items.map((item) => <article key={item.id} className="rounded-2xl border border-border bg-card p-4 transition hover:border-primary/40 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h2 className="font-semibold">{item.title}</h2><p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground"><CalendarDays className="size-4"/>{item.start_datetime || "Date to be announced"}</p>{item.venue_name && <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground"><MapPin className="size-4"/>{item.venue_name}</p>}</div><span className="rounded-full bg-muted px-3 py-1 text-xs font-medium">{statusLabel(item.status)}</span></div><div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-3"><span className="text-sm text-muted-foreground">{item.booking_count ?? 0} registered attendee(s)</span><div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" asChild><Link to="/my-events/$eventId/edit" params={{eventId:String(item.id)}}>Edit event</Link></Button>{item.slug && <Button variant="outline" size="sm" asChild><Link to="/events/$slug" params={{slug:item.slug}}>View event <ExternalLink className="ml-2 size-3.5"/></Link></Button>}</div></div></article>)}</div>}
  </div>;
}
