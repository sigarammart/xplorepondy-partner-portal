import { createFileRoute, Link } from "@tanstack/react-router";
import { CalendarDays, Download, LoaderCircle, MapPin, Printer, QrCode, TicketCheck, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { QrCodeDisplay } from "@/components/qr-code-display";
import { useAppLoggedIn } from "@/lib/app-session";
import { useSession } from "@/store/session";
import { fetchMyEventBookings, fetchMyEventTicket, type EventAccountItem, type BookingTicket } from "@/lib/events-api";

export const Route = createFileRoute("/my-event-bookings")({ component: MyEventBookingsPage });

function MyEventBookingsPage() {
  const { loggedIn, wpUser, grokUser } = useAppLoggedIn();
  const identityToken = useSession((state) => state.wpIdentityToken);
  const sessionEmail = useSession((state) => state.user?.email ?? "");
  const email = (grokUser?.primaryEmail || wpUser?.email || sessionEmail).trim().toLowerCase();
  const [items, setItems] = useState<EventAccountItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [ticket, setTicket] = useState<BookingTicket | null>(null);
  const [ticketLoadingId, setTicketLoadingId] = useState(0);
  const [ticketError, setTicketError] = useState("");
  useEffect(() => {
    let active = true;
    if (!loggedIn || !email) { setLoading(false); return; }
    fetchMyEventBookings({ data: { email, identityToken: identityToken ?? undefined } })
      .then((result) => { if (active) setItems(result.items ?? []); })
      .catch((e) => { if (active) setError(e instanceof Error ? e.message : "Could not load your bookings."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [loggedIn, email, identityToken]);
  return <div className="mx-auto max-w-4xl py-5 sm:py-8">
    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Your tickets</p><h1 className="mt-1 font-display text-3xl font-semibold">My Event Bookings</h1><p className="mt-2 text-sm text-muted-foreground">Review your event registrations, ticket quantities and booking references.</p>
    {!loggedIn ? <div className="mt-6 rounded-2xl border p-8 text-center"><TicketCheck className="mx-auto size-8 text-primary"/><h2 className="mt-3 font-semibold">Sign in to view your bookings</h2><Button className="mt-4" asChild><Link to="/login">Sign in</Link></Button></div>
    : loading ? <div className="mt-8 flex justify-center p-8 text-muted-foreground"><LoaderCircle className="mr-2 size-5 animate-spin"/>Loading bookings…</div>
    : error ? <div className="mt-6 rounded-xl border border-destructive/40 p-5 text-sm">{error}</div>
    : items.length === 0 ? <div className="mt-6 rounded-2xl border border-dashed p-8 text-center"><TicketCheck className="mx-auto size-8 text-muted-foreground"/><h2 className="mt-3 font-semibold">No event bookings yet</h2><p className="mt-1 text-sm text-muted-foreground">Your confirmed free event registrations will appear here.</p><Button className="mt-4" asChild><Link to="/my-events">Manage events</Link></Button></div>
    : <div className="mt-6 space-y-3">{items.map((item) => <article key={item.id} className="rounded-2xl border border-border bg-card p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 className="font-semibold">{item.event_title}</h2><p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground"><CalendarDays className="size-4"/>{item.start_datetime || "Date to be announced"}</p>{item.venue_name && <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground"><MapPin className="size-4"/>{item.venue_name}</p>}</div><span className={`rounded-full px-3 py-1 text-xs font-semibold ${item.status === "confirmed" ? "bg-emerald-500/10 text-emerald-600" : "bg-muted text-muted-foreground"}`}>{item.status === "confirmed" ? "Confirmed" : item.status || "Unknown"}</span></div><div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-3"><div className="text-sm"><p><span className="text-muted-foreground">Booking ID:</span> <strong className="font-mono">#{item.id}</strong></p><p className="mt-1 text-muted-foreground">{item.ticket_type} · {item.quantity} ticket(s)</p></div><div className="flex flex-wrap gap-2">{item.status === "confirmed" && <Button size="sm" variant="outline" disabled={ticketLoadingId === item.id} onClick={() => { setTicketLoadingId(item.id); setTicketError(""); void fetchMyEventTicket({data:{email,identityToken:identityToken ?? undefined,bookingId:item.id}}).then(setTicket).catch((reason) => setTicketError(reason instanceof Error ? reason.message : "Could not load ticket.")).finally(() => setTicketLoadingId(0)); }}>{ticketLoadingId === item.id ? <LoaderCircle className="mr-2 size-4 animate-spin"/> : <QrCode className="mr-2 size-4"/>}View ticket</Button>}{item.event_url && <Button variant="ghost" size="sm" asChild><a href={item.event_url}>Event details</a></Button>}</div></div></article>)}</div>}
    {ticketError && <div role="alert" className="mt-4 rounded-xl border border-destructive/30 p-3 text-sm text-destructive">{ticketError}</div>}
    {ticket && <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/70 p-3 sm:p-6" role="dialog" aria-modal="true" aria-label="Booking ticket">
      <style>{`@media print { body * { visibility: hidden !important; } #xplore-ticket-print, #xplore-ticket-print * { visibility: visible !important; } #xplore-ticket-print { position: absolute !important; inset: 0 auto auto 0 !important; width: 100% !important; max-width: none !important; box-shadow: none !important; border: 0 !important; } .ticket-no-print { display: none !important; } }`}</style>
      <section id="xplore-ticket-print" className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-2xl">
        <div className="ticket-no-print flex items-center justify-between"><span className="text-xs font-semibold uppercase tracking-widest text-primary">Xplore Pondy · Digital ticket</span><button type="button" aria-label="Close ticket" onClick={() => setTicket(null)} className="rounded-lg p-2 hover:bg-muted"><X className="size-4"/></button></div>
        <h2 className="mt-3 font-display text-2xl font-semibold">{ticket.title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{ticket.date}{ticket.time ? ` · ${ticket.time}` : ""}</p>
        {ticket.venue && <p className="mt-1 text-sm text-muted-foreground">{ticket.venue}</p>}
        <div className="my-4 flex justify-center"><QrCodeDisplay value={ticket.token} size={240}/></div>
        <div className="space-y-1 text-sm"><p><span className="text-muted-foreground">Booking ID:</span> <strong className="font-mono">#{ticket.booking_id}</strong></p><p><span className="text-muted-foreground">Attendee:</span> {ticket.attendee}</p><p><span className="text-muted-foreground">Ticket:</span> {ticket.ticket_type || "General"} · {ticket.quantity} participant(s)</p><p><span className="text-muted-foreground">Payment:</span> {(ticket.payment_status || "not_required").replace(/_/g, " ")}</p></div>
        <p className="mt-4 rounded-lg bg-muted p-3 text-xs text-muted-foreground">{ticket.checked_in ? `Already checked in at ${ticket.checked_in_at}` : "Show this QR code to the event owner at entry. One scan checks in the entire booking."}</p>
        <div className="ticket-no-print mt-4 flex gap-2"><Button className="flex-1" onClick={() => window.print()}><Download className="mr-2 size-4"/>Download PDF / Print</Button><Button variant="outline" onClick={() => setTicket(null)}>Close</Button></div>
      </section>
    </div>}
  </div>;
}
