import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, CheckCircle2, Clock3, LoaderCircle, QrCode, Ticket } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { OwnerTicketScanner } from "@/routes/dashboard";
import { useAppLoggedIn } from "@/lib/app-session";
import { fetchTableReservationOwnerDashboard, fetchWpOwnerExperienceBookingRequests, type TableReservationOwnerDashboard, type ExperienceBookingRequest } from "@/lib/wp-api";
import { fetchMyOwnedEventBookings, type EventOwnerBookingItem } from "@/lib/events-api";
import { useSession } from "@/store/session";
import { formatDisplayDate, formatDisplayTime, formatDisplayDateTime } from "@/lib/date-time-format";

export const Route = createFileRoute("/qr-scan")({ component: OwnerQrScanPage });

type CheckInRecord = {
  key: string;
  type: "Table reservation" | "Event booking" | "Experience booking";
  id: number;
  title: string;
  attendee: string;
  dateTime: string;
  checkedAt: string;
  quantity: number;
};

function OwnerQrScanPage() {
  const { loggedIn, wpUser, grokUser } = useAppLoggedIn();
  const sessionUser = useSession((s) => s.user);
  const identityToken = useSession((s) => s.wpIdentityToken);
  const email = (grokUser?.primaryEmail || wpUser?.email || sessionUser?.email || "").trim().toLowerCase();
  const userId = sessionUser?.id;
  const [dashboard, setDashboard] = useState<TableReservationOwnerDashboard | null>(null);
  const [eventBookings, setEventBookings] = useState<EventOwnerBookingItem[]>([]);
  const [experienceBookings, setExperienceBookings] = useState<ExperienceBookingRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [cameraRequest, setCameraRequest] = useState(true);

  const refreshCheckIns = useCallback(async () => {
    if (!loggedIn || !email) {
      setDashboard(null);
      setEventBookings([]);
      setExperienceBookings([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    const results = await Promise.allSettled([
      fetchTableReservationOwnerDashboard({ data: { email, ...(userId ? { userId } : {}) } }),
      fetchMyOwnedEventBookings({ data: { email, identityToken: identityToken ?? undefined } }),
      fetchWpOwnerExperienceBookingRequests({ data: { email, identityToken: identityToken ?? undefined } }),
    ]);
    const failures: string[] = [];
    if (results[0].status === "fulfilled") setDashboard(results[0].value);
    else { setDashboard(null); failures.push("table reservations"); }
    if (results[1].status === "fulfilled") setEventBookings(results[1].value.items ?? []);
    else { setEventBookings([]); failures.push("event bookings"); }
    if (results[2].status === "fulfilled") setExperienceBookings(results[2].value);
    else { setExperienceBookings([]); failures.push("experience bookings"); }
    if (failures.length) setError("Some check-in records could not be loaded: " + failures.join(", ") + ".");
    setLoading(false);
  }, [loggedIn, email, identityToken, userId]);

  useEffect(() => { void refreshCheckIns(); }, [refreshCheckIns]);

  const records: CheckInRecord[] = [
    ...(dashboard?.reservations ?? []).filter((item) => item.checkedIn).map((item) => ({
      key: "table-" + item.id,
      type: "Table reservation" as const,
      id: item.bookingId ?? item.id,
      title: dashboard?.listings.find((listing) => listing.id === item.listingId)?.title || "Table reservation",
      attendee: item.guestName || "Guest",
      dateTime: [formatDisplayDate(item.reservationDate), formatDisplayTime(item.startTime)].filter(Boolean).join(" · "),
      checkedAt: item.checkedInAt || "",
      quantity: item.guests,
    })),
    ...eventBookings.filter((item) => item.checked_in).map((item) => ({
      key: "event-" + item.id,
      type: "Event booking" as const,
      id: item.id,
      title: item.event_title || "Event booking",
      attendee: item.customer_name || item.customer_email || "Attendee",
      dateTime: item.start_datetime ? formatDisplayDateTime(item.start_datetime) : "",
      checkedAt: item.checked_in_at || "",
      quantity: Number(item.quantity ?? 1),
    })),
    ...experienceBookings.filter((item) => item.checked_in).map((item) => ({
      key: "experience-" + item.id,
      type: "Experience booking" as const,
      id: item.id,
      title: item.experience_title || "Experience booking",
      attendee: item.name || item.email || "Attendee",
      dateTime: [formatDisplayDate(item.date), formatDisplayTime(item.time)].filter(Boolean).join(" · "),
      checkedAt: item.checked_in_at || "",
      quantity: item.participants,
    })),
  ].sort((a, b) => new Date(b.checkedAt).getTime() - new Date(a.checkedAt).getTime());

  return (
    <main className="mx-auto w-full max-w-4xl px-3 pb-28 pt-4 sm:px-5 sm:pb-8 sm:pt-6">
      <Link to="/dashboard" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Owner Dashboard</Link>
      <section className="mt-3 rounded-2xl bg-card p-4 ring-1 ring-border/70 sm:p-6">
        <div className="flex items-start gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><QrCode className="size-6" /></div>
          <div><h1 className="font-display text-2xl font-semibold">QR ticket scanner</h1><p className="mt-1 text-sm text-muted-foreground">Scan confirmed table reservations, event tickets and experience bookings. One successful scan checks in the entire booking.</p></div>
        </div>
        {!loggedIn ? <p className="mt-4 rounded-xl border border-border p-4 text-sm text-muted-foreground">Please <Link to="/login" className="text-primary underline">sign in</Link> with your owner account to scan tickets and view check-in history.</p> : (
          <>
            <OwnerTicketScanner email={email} identityToken={identityToken ?? undefined} cameraRequest={cameraRequest} onCameraRequestHandled={() => setCameraRequest(false)} onCheckedIn={() => { void refreshCheckIns(); }} />
            <section className="mt-6">
              <div className="flex items-center justify-between gap-3"><div><h2 className="font-display text-xl font-semibold">Checked-in bookings</h2><p className="text-sm text-muted-foreground">Reservations and bookings successfully scanned by an owner.</p></div><span className="rounded-md bg-primary/10 px-2.5 py-1 text-sm font-semibold text-primary">{records.length}</span></div>
              {loading ? <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" /> Loading check-in history…</p>
                : error ? <p role="alert" className="mt-4 rounded-xl border border-destructive/30 p-3 text-sm text-destructive">{error}</p>
                : records.length === 0 ? <div className="mt-4 rounded-xl border border-dashed border-border p-6 text-center"><Ticket className="mx-auto size-7 text-muted-foreground" /><h3 className="mt-2 font-semibold">No check-ins yet</h3><p className="mt-1 text-sm text-muted-foreground">Successfully scanned bookings will appear here.</p></div>
                : <div className="mt-3 space-y-2">{records.map((item) => <article key={item.key} className="rounded-xl border border-border/70 p-3 sm:p-4"><div className="flex items-start gap-3"><CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-500" /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{item.title}</h3><span className="rounded-md bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-600">Checked in</span></div><p className="mt-1 text-sm text-muted-foreground">{item.type} · Booking ID: #{item.id}</p><p className="mt-1 text-sm">{item.attendee} · {item.quantity} participant(s)</p>{item.dateTime && <p className="mt-1 text-xs text-muted-foreground">Booking: {item.dateTime}</p>}<p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><Clock3 className="size-3.5" /> Scanned: {item.checkedAt ? formatDisplayDateTime(item.checkedAt) : "Time unavailable"}</p></div></div></article>)}</div>}
            </section>
          </>
        )}
      </section>
    </main>
  );
}
