import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Bell, CalendarDays, Camera, CheckCircle2, ClipboardList, ExternalLink, FilePlus2, LoaderCircle, QrCode, Settings2, Store, Ticket, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { checkInOwnerTableReservationTicket, fetchTableReservationOwnerDashboard, fetchWpAuthorContent, fetchWpOwnerExperienceBookingRequests, updateWpOwnerExperienceBookingRequestStatus, updateTableReservationOwnerStatus, type ExperienceBookingRequest, type TableReservationOwnerDashboard } from "@/lib/wp-api";
import { useAppLoggedIn } from "@/lib/app-session";
import { checkInOwnerEventTicket, fetchMyEvents, fetchMyOwnedEventBookings, updateMyOwnedEventBookingStatus, type EventAccountItem, type EventOwnerBookingItem } from "@/lib/events-api";
import { checkInOwnerExperienceTicket, fetchMyExperiences, type ExperienceAccountItem } from "@/lib/experiences-account-api";
import { useSession } from "@/store/session";
import { formatDisplayDate, formatDisplayTime, formatDisplayDateTime } from "@/lib/date-time-format";
import { fetchTableReservationNotifications, type TableReservationNotification } from "@/lib/wp-api";
import { fetchEventInbox, type EventInboxItem } from "@/lib/events-api";

export const Route = createFileRoute("/dashboard")({
  validateSearch: (search: Record<string, unknown>): { view?: "bookings" | "listings" | "events" | "experiences" | "notifications"; bookingType?: "table" | "events" | "experiences"; bookingId?: number; listingId?: number } => ({
    view: ["bookings", "listings", "events", "experiences", "notifications"].includes(String(search.view))
      ? search.view as "bookings" | "listings" | "events" | "experiences" | "notifications"
      : undefined,
    bookingType: ["table", "events", "experiences"].includes(String(search.bookingType))
      ? search.bookingType as "table" | "events" | "experiences"
      : undefined,
    bookingId: Number.isInteger(Number(search.bookingId)) && Number(search.bookingId) > 0 ? Number(search.bookingId) : undefined,
    listingId: Number.isInteger(Number(search.listingId)) && Number(search.listingId) > 0 ? Number(search.listingId) : undefined,
  }),
  component: ListingOwnerDashboardPage,
});

export function OwnerTicketScanner({ email, identityToken, cameraRequest = false, onCameraRequestHandled, onTableCheckedIn, onCheckedIn }: { email: string; identityToken?: string; cameraRequest?: boolean; onCameraRequestHandled?: () => void; onTableCheckedIn?: (id: number, checkedAt: string) => void; onCheckedIn?: () => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [token, setToken] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ type?: string; booking_id?: number; title: string; attendee: string; reference: string; quantity: number; checked_in_at: string } | null>(null);
  useEffect(() => {
    if (!cameraRequest) return;
    setError("");
    setCameraOn(true);
    onCameraRequestHandled?.();
  }, [cameraRequest, onCameraRequestHandled]);
  useEffect(() => {
    if (!cameraOn) return;
    let stopped = false; let frame = 0;
    const stop = () => { stopped = true; if (frame) cancelAnimationFrame(frame); streamRef.current?.getTracks().forEach((track) => track.stop()); streamRef.current = null; };
    const start = async () => {
      try {
        const Detector = (window as Window & { BarcodeDetector?: new (options?: { formats?: string[] }) => { detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue: string }>> } }).BarcodeDetector;
        if (!Detector) throw new Error("Camera QR scanning is not supported in this browser. Paste the ticket QR text below instead.");
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera access requires HTTPS and browser permission.");
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
        if (stopped) { stream.getTracks().forEach((track) => track.stop()); return; }
        streamRef.current = stream; const video = videoRef.current; if (!video) return;
        video.srcObject = stream; await video.play(); const detector = new Detector({ formats: ["qr_code"] });
        const scan = async () => {
          if (stopped || !videoRef.current) return;
          try { const codes = await detector.detect(videoRef.current); if (codes[0]?.rawValue) { setToken(codes[0].rawValue); setCameraOn(false); setError(""); stop(); return; } } catch { /* Try the next frame. */ }
          frame = requestAnimationFrame(() => { void scan(); });
        };
        void scan();
      } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not start the camera scanner."); setCameraOn(false); }
    };
    void start(); return stop;
  }, [cameraOn]);
  async function verifyTicket() {
    const clean = token.trim();
    if (!clean) { setError("Scan a QR code or paste the ticket code first."); return; }
    setChecking(true); setError(""); setResult(null);
    try {
      const response = clean.startsWith("XPEV|")
        ? await checkInOwnerEventTicket({ data: { email, identityToken, token: clean } })
        : clean.startsWith("XPE|")
          ? await checkInOwnerExperienceTicket({ data: { email, identityToken, token: clean } })
          : clean.startsWith("XPT|")
            ? await checkInOwnerTableReservationTicket({ data: { email, identityToken, token: clean } })
            : (() => { throw new Error("Unrecognized ticket format. Use an Xplore Pondy event, experience, or table reservation QR ticket."); })();
      setResult(response);
      if (response.type === "table" && response.booking_id) onTableCheckedIn?.(response.booking_id, response.checked_in_at);
      onCheckedIn?.();
      toast.success("Booking checked in successfully");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Ticket could not be verified."); }
    finally { setChecking(false); }
  }
  return <section className="mt-3 rounded-2xl border border-border/70 bg-background p-2 sm:mt-4 sm:p-4">
    <div className="flex items-start gap-3"><div className="rounded-xl bg-primary/10 p-2 text-primary"><QrCode className="size-5"/></div><div className="min-w-0 flex-1"><h3 className="font-semibold">Scan booking tickets</h3><p className="mt-1 text-sm text-muted-foreground">Scan a confirmed table reservation, event, or experience booking. One successful scan checks in the entire booking.</p></div></div>
    {cameraOn && <div className="mt-3 overflow-hidden rounded-xl bg-black"><video ref={videoRef} className="max-h-72 w-full object-contain" muted playsInline/><p className="p-2 text-center text-xs text-white">Hold the QR code steady inside the camera view.</p></div>}
    <div className="mt-3 flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={() => { setError(""); setCameraOn((on) => !on); }}>{cameraOn ? <XCircle className="mr-2 size-4"/> : <Camera className="mr-2 size-4"/>}{cameraOn ? "Stop camera" : "Open camera"}</Button></div>
    <label className="mt-3 block text-sm font-medium">Ticket QR text / code<input value={token} onChange={(event) => setToken(event.target.value)} placeholder="Scan a QR or paste XPT|… / XPEV|… / XPE|…" className="mt-1.5 h-11 w-full rounded-xl border border-border bg-card px-3 text-sm"/></label>
    <Button className="mt-3" disabled={checking || !token.trim()} onClick={() => void verifyTicket()}>{checking ? <LoaderCircle className="mr-2 size-4 animate-spin"/> : <CheckCircle2 className="mr-2 size-4"/>}Verify & check in</Button>
    {error && <p role="alert" className="mt-3 rounded-lg border border-destructive/30 p-3 text-sm text-destructive">{error}</p>}
    {result && <div className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3"><div className="flex items-center gap-2 font-semibold text-emerald-600"><CheckCircle2 className="size-5"/>Check-in successful</div><p className="mt-2 font-medium">{result.title}</p><p className="text-sm">{result.attendee} · {result.quantity} participant(s)</p><p className="mt-1 text-xs text-muted-foreground">Booking ID: <span className="font-mono">#{result.type === "table" ? formatReservationId(result.booking_id ?? 0) : result.booking_id ?? "—"}</span> · {result.checked_in_at}</p></div>}
  </section>;
}

function formatReservationId(id: number) {
  return String(999 + id).padStart(4, "0");
}

function formatReservationTime(time: string) {
  const [hourText, minuteText] = time.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return time;
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"}`;
}

function OwnerBookings({
  dashboard,
  email,
  selectedListing,
  targetReservationId,
  onUpdated,
}: {
  dashboard: TableReservationOwnerDashboard;
  email: string;
  selectedListing: number;
  targetReservationId?: number;
  onUpdated: (id: number, status: string) => void;
}) {
  const [listingFilter, setListingFilter] = useState(selectedListing);
  const [statusFilter, setStatusFilter] = useState("");
  const [updatingId, setUpdatingId] = useState(0);
  const listingMap = new Map(dashboard.listings.map((listing) => [listing.id, listing]));
  const rows = dashboard.reservations.filter((r) =>
    (!targetReservationId || r.id === targetReservationId) &&
    (!listingFilter || r.listingId === listingFilter) &&
    (!statusFilter || r.status === statusFilter)
  );
  const statuses = ["pending", "confirmed", "cancelled", "completed", "no-show"];

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-2">
        <select value={listingFilter} onChange={(e) => setListingFilter(Number(e.target.value))} className="h-10 max-w-full rounded-lg border border-border bg-card px-3 text-sm">
          <option value={0}>All my listings</option>
          {dashboard.listings.map((listing) => <option key={listing.id} value={listing.id}>{listing.title}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-10 rounded-lg border border-border bg-card px-3 text-sm">
          <option value="">All statuses</option>
          {statuses.map((status) => <option key={status} value={status}>{status.replace("-", " ")}</option>)}
        </select>
      </div>

      {rows.length === 0 ? (
        <div className="mt-3 rounded-xl bg-card p-4 text-center ring-1 ring-border/70">
          <Store className="mx-auto size-7 text-primary" />
          <p className="mt-3 text-sm text-muted-foreground">No reservations found.</p>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          {rows.map((reservation) => {
            const listing = listingMap.get(reservation.listingId);
            return (
              <div key={reservation.id} id={`booking-table-${reservation.id}`} className={`scroll-mt-24 rounded-xl border border-border/70 bg-background p-3 ${targetReservationId === reservation.id ? "ring-2 ring-primary" : ""}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-semibold">{listing?.title ?? `Listing #${reservation.listingId}`}</h3>
                    <p className="mt-1 text-xs text-muted-foreground">Booking ID: <span className="font-mono">#{formatReservationId(reservation.id)}</span>{reservation.createdAt ? ` · Booked on ${formatDisplayDate(reservation.createdAt)} ${formatDisplayTime(reservation.createdAt.slice(11, 16))}` : ""}</p>
                    <p className="mt-2 text-sm text-foreground">Reservation Date: {formatDisplayDate(reservation.reservationDate)}</p>
                    <p className="text-sm text-foreground">Time: {formatDisplayTime(reservation.startTime)}–{formatDisplayTime(reservation.endTime)}</p>
                    <p className="text-sm text-foreground">No. of Guests: {reservation.guests}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${reservation.checkedIn ? "bg-emerald-500/10 text-emerald-600" : "bg-muted text-foreground"}`}>
                    {reservation.checkedIn ? "Checked in" : reservation.status.replace("-", " ")}
                  </span>
                </div>
                <div className="mt-2 grid gap-1.5 text-sm sm:grid-cols-3">
                  <span><strong>{reservation.guestName}</strong> · {reservation.guests} {reservation.guests === 1 ? "guest" : "guests"}</span>
                  <span>{reservation.guestPhone || "No phone"}</span>
                  <span className="truncate">{reservation.guestEmail}</span>
                </div>
                {reservation.notes?.trim() && <div className="mt-3 rounded-lg bg-muted/60 p-3 text-sm"><p className="mb-1 text-xs font-semibold text-muted-foreground">Customer notes</p><p className="whitespace-pre-wrap break-words">{reservation.notes}</p></div>}
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-2">
                  <span className="text-xs text-muted-foreground">Booking ID: <span className="font-mono">#{formatReservationId(reservation.id)}</span>{reservation.checkedIn && <span className="ml-2 font-medium text-emerald-600">Checked in {reservation.checkedInAt || ""}</span>}</span>
                  <select
                    value={reservation.status}
                    disabled={updatingId === reservation.id}
                    onChange={(e) => {
                      const status = e.target.value as "pending" | "confirmed" | "cancelled" | "completed" | "no-show";
                      setUpdatingId(reservation.id);
                      void updateTableReservationOwnerStatus({ data: { email, reservationId: reservation.id, status } })
                        .then(() => {
                          onUpdated(reservation.id, status);
                          toast.success("Reservation status updated");
                        })
                        .catch((reason) => toast.error(reason instanceof Error ? reason.message : "Could not update reservation."))
                        .finally(() => setUpdatingId(0));
                    }}
                    className="h-9 rounded-lg border border-border bg-background px-2 text-sm"
                  >
                    {statuses.map((status) => <option key={status} value={status}>{status.replace("-", " ")}</option>)}
                  </select>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function EventOwnerBookingCard({
  booking,
  email,
  identityToken,
  targetBookingId,
  onUpdated,
}: {
  booking: EventOwnerBookingItem;
  email: string;
  identityToken?: string;
  targetBookingId?: number;
  onUpdated: (id: number, status: NonNullable<EventOwnerBookingItem["status"]>) => void;
}) {
  const [updating, setUpdating] = useState(false);
  const statuses = [
    { value: "pending_payment", label: "Pending payment" },
    { value: "confirmed", label: "Confirmed" },
    { value: "cancelled", label: "Cancelled" },
  ] as const;
  const eventSlug = booking.event_slug || booking.event_url?.split("?")[0].split("/").filter(Boolean).pop() || "";

  return (
    <article id={`booking-events-${booking.id}`} className={`scroll-mt-24 rounded-xl border border-border/70 bg-background p-3 ${targetBookingId === booking.id ? "ring-2 ring-primary" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold">{booking.event_title || "Event"}</h3>
          <p className="text-xs text-muted-foreground">Booking ID: <span className="font-mono">#{booking.id}</span>{booking.created_at ? ` · Booked on ${formatDisplayDate(booking.created_at)} ${formatDisplayTime(booking.created_at.slice(11, 16))}` : ""}</p>
          {booking.start_datetime && <p className="mt-1 flex items-center gap-1.5 text-sm font-medium text-foreground"><CalendarDays className="size-3.5 shrink-0" /> Event date: {formatDisplayDate(booking.start_datetime)} {formatDisplayTime(booking.start_datetime.slice(11, 16))}{booking.venue_name ? ` · ${booking.venue_name}` : ""}</p>}
        </div>
        <span className={`rounded-full px-2 py-1 text-xs capitalize ${booking.checked_in ? "bg-emerald-500/10 text-emerald-600" : "bg-muted"}`}>{booking.checked_in ? "Checked in" : (booking.status || "unknown").replace(/_/g, " ")}</span>
      </div>
      <div className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
        <span><strong>{booking.customer_name || "Customer"}</strong></span>
        <span>{booking.customer_email || "No email"}</span>
        <span>{booking.ticket_type || "Ticket"} · {booking.quantity ?? 1} ticket(s)</span>
        <span>{booking.payment_status ? `Payment: ${booking.payment_status.replace(/_/g, " ")}` : ""}</span>{booking.checked_in && <span className="font-medium text-emerald-600">Checked in {booking.checked_in_at || ""}</span>}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3">
        {eventSlug && booking.event_url ? (
          <a href={booking.event_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
            View event <ExternalLink className="size-3.5" />
          </a>
        ) : <span className="text-xs text-muted-foreground">Event page unavailable</span>}
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Update status
          <select
            value={statuses.some((item) => item.value === booking.status) ? booking.status : "pending_payment"}
            disabled={updating}
            onChange={(event) => {
              const status = event.target.value as typeof statuses[number]["value"];
              setUpdating(true);
              void updateMyOwnedEventBookingStatus({ data: { email, identityToken, bookingId: booking.id, status } })
                .then(() => {
                  onUpdated(booking.id, status);
                  toast.success("Event booking status updated");
                })
                .catch((reason) => toast.error(reason instanceof Error ? reason.message : "Could not update event booking status."))
                .finally(() => setUpdating(false));
            }}
            className="h-9 rounded-lg border border-border bg-background px-2 text-sm text-foreground"
          >
            {statuses.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
          </select>
        </label>
      </div>
    </article>
  );
}

function ExperienceOwnerBookingCard({
  booking,
  email,
  identityToken,
  targetBookingId,
  onUpdated,
}: {
  booking: ExperienceBookingRequest;
  email: string;
  identityToken?: string;
  targetBookingId?: number;
  onUpdated: (id: number, status: ExperienceBookingRequest["status"]) => void;
}) {
  const [updating, setUpdating] = useState(false);
  const statuses = [
    { value: "pending_review", label: "Pending review" },
    { value: "accepted", label: "Accepted for follow-up" },
    { value: "confirmed", label: "Confirmed" },
    { value: "rejected", label: "Rejected" },
    { value: "completed", label: "Completed" },
  ] as const;

  const experienceSlug = booking.experience_slug || booking.experience_url?.split("?")[0].split("/").filter(Boolean).pop() || "";

  return (
    <article id={`booking-experiences-${booking.id}`} className={`scroll-mt-24 rounded-xl border border-border/70 bg-background p-3 ${targetBookingId === booking.id ? "ring-2 ring-primary" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold">{booking.experience_title}</h3>
          <p className="text-xs text-muted-foreground">Booking ID: <span className="font-mono">#{booking.id}</span>{booking.submitted_at ? ` · Submitted ${formatDisplayDate(booking.submitted_at)} ${formatDisplayTime(booking.submitted_at.slice(11, 16))}` : ""}</p>
          <p className="mt-2 text-sm font-medium text-foreground">Tour Date: {formatDisplayDate(booking.date)} · {formatDisplayTime(booking.time)} · {booking.participants} participant(s)</p>
        </div>
        <span className={`rounded-full px-2 py-1 text-xs capitalize ${booking.checked_in ? "bg-emerald-500/10 text-emerald-600" : "bg-muted"}`}>{booking.checked_in ? "Checked in" : booking.status.replace(/_/g, " ")}</span>
      </div>
      <div className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
        <span><strong>{booking.name || "Customer"}</strong></span>
        <span>{booking.email || "No email"}{booking.phone ? ` · ${booking.phone}` : ""}</span>
        <span>Submitted {booking.submitted_at ? formatDisplayDate(booking.submitted_at) : "date unavailable"}</span>{booking.checked_in && <span className="font-medium text-emerald-600">Checked in {booking.checked_in_at ? `${formatDisplayDate(booking.checked_in_at)} ${formatDisplayTime(booking.checked_in_at.slice(11, 16))}` : ""}</span>}
      </div>
      {booking.notes?.trim() && <div className="mt-3 rounded-lg bg-muted/60 p-3 text-sm"><p className="mb-1 text-xs font-semibold text-muted-foreground">Notes from customer</p><p className="whitespace-pre-wrap break-words">{booking.notes}</p></div>}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3">
        {experienceSlug && booking.experience_url ? (
          <a href={booking.experience_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
            View experience <ExternalLink className="size-3.5" />
          </a>
        ) : <span className="text-xs text-muted-foreground">Experience page unavailable</span>}
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Update status
          <select
            value={booking.status}
            disabled={updating}
            onChange={(event) => {
              const status = event.target.value as ExperienceBookingRequest["status"];
              setUpdating(true);
              void updateWpOwnerExperienceBookingRequestStatus({ data: { email, identityToken, bookingId: booking.id, status: status as "pending_review" | "accepted" | "confirmed" | "rejected" | "completed" } })
                .then((result) => {
                  // The WordPress status endpoint only resolves successfully after it
                  // confirms the requested value. Do not compare it with the owner-list
                  // endpoint here: that list can lag behind the authoritative write.
                  onUpdated(booking.id, result.status);
                  toast.success("Experience request status saved");
                })
                .catch((reason) => toast.error(reason instanceof Error ? reason.message : "Could not update experience request status."))
                .finally(() => setUpdating(false));
            }}
            className="h-9 rounded-lg border border-border bg-background px-2 text-sm text-foreground"
          >
            {statuses.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
          </select>
        </label>
      </div>
    </article>
  );
}

function ListingOwnerDashboardPage() {
  const { loggedIn, wpUser, grokUser } = useAppLoggedIn();
  const sessionUser = useSession((s) => s.user);
  const sessionListings = useSession((s) => s.myListings);
  const email = (grokUser?.primaryEmail || wpUser?.email || sessionUser?.email || "").trim().toLowerCase();
  const userId = sessionUser?.id;
  const { view: searchView, bookingType: searchBookingType, bookingId: searchBookingId, listingId: searchListingId } = Route.useSearch();
  const [dashboard, setDashboard] = useState<TableReservationOwnerDashboard | null>(null);
  const [selectedListing, setSelectedListing] = useState(searchListingId ?? 0);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"menu" | "bookings" | "listings" | "events" | "experiences" | "notifications">(searchView ?? "menu");
  const [cameraRequest, setCameraRequest] = useState(false);
  const identityToken = useSession((s) => s.wpIdentityToken);
  const [ownerListings, setOwnerListings] = useState<Array<{ id?: number; wpId?: number; slug: string; title: string; url?: string }>>([]);
  const [ownerContentLoading, setOwnerContentLoading] = useState(false);
  const [ownerContentError, setOwnerContentError] = useState("");
  const [events, setEvents] = useState<EventAccountItem[]>([]);
  const [experiences, setExperiences] = useState<ExperienceAccountItem[]>([]);
  const [eventBookings, setEventBookings] = useState<EventOwnerBookingItem[]>([]);
  const [experienceBookings, setExperienceBookings] = useState<ExperienceBookingRequest[]>([]);
  const [bookingType, setBookingType] = useState<"table" | "events" | "experiences">(searchBookingType ?? "table");
  const [eventBookingError, setEventBookingError] = useState("");
  const [experienceBookingError, setExperienceBookingError] = useState("");
  const [eventsLoading, setEventsLoading] = useState(false);
  const [experiencesLoading, setExperiencesLoading] = useState(false);
  const [eventBookingsLoading, setEventBookingsLoading] = useState(false);
  const [experienceBookingsLoading, setExperienceBookingsLoading] = useState(false);
  const [ownerNotifications, setOwnerNotifications] = useState<TableReservationNotification[]>([]);
  const [ownerEventNotifications, setOwnerEventNotifications] = useState<EventInboxItem[]>([]);
  const [ownerNotificationsLoading, setOwnerNotificationsLoading] = useState(false);
  const [ownerNotificationsError, setOwnerNotificationsError] = useState("");

  useEffect(() => {
    setView(searchView ?? "menu");
    setBookingType(searchBookingType ?? "table");
    if (searchListingId) setSelectedListing(searchListingId);
  }, [searchView, searchBookingType, searchListingId]);

  useEffect(() => {
    if (searchView !== "bookings" || !searchBookingId || !searchBookingType) return;
    const ready = searchBookingType === "table" ? !loading
      : searchBookingType === "events" ? !eventBookingsLoading
      : !experienceBookingsLoading;
    if (!ready) return;

    // The dashboard may already be mounted when an owner clicks a notification.
    // Wait for the selected booking tab and its card to render before scrolling.
    let attempts = 0;
    let timer = 0;
    let cancelled = false;
    const targetId = `booking-${searchBookingType}-${searchBookingId}`;
    const scrollToTarget = () => {
      if (cancelled) return;
      const target = document.getElementById(targetId);
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
      attempts += 1;
      if (attempts < 20) timer = window.setTimeout(scrollToTarget, 100);
    };
    timer = window.setTimeout(scrollToTarget, 100);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [searchView, searchBookingType, searchBookingId, view, loading, eventBookingsLoading, experienceBookingsLoading, dashboard, eventBookings, experienceBookings]);

  useEffect(() => {
    if (!loggedIn || !email) return;
    let cancelled = false;
    setEventsLoading(true);
    void fetchMyEvents({ data: { email, identityToken: identityToken ?? undefined } })
      .then((result) => { if (!cancelled) setEvents(result.items ?? []); })
      .catch(() => { if (!cancelled) setEvents([]); })
      .finally(() => { if (!cancelled) setEventsLoading(false); });
    setExperiencesLoading(true);
    void fetchMyExperiences({ data: { email, identityToken: identityToken ?? undefined } })
      .then((result) => { if (!cancelled) setExperiences(result); })
      .catch(() => { if (!cancelled) setExperiences([]); })
      .finally(() => { if (!cancelled) setExperiencesLoading(false); });
    setEventBookingsLoading(true);
    setEventBookingError("");
    void fetchMyOwnedEventBookings({ data: { email, identityToken: identityToken ?? undefined } })
      .then((result) => { if (!cancelled) setEventBookings(result.items ?? []); })
      .catch((reason) => { if (!cancelled) { setEventBookings([]); setEventBookingError(reason instanceof Error ? reason.message : "Could not load event bookings."); } })
      .finally(() => { if (!cancelled) setEventBookingsLoading(false); });
    setExperienceBookingsLoading(true);
    setExperienceBookingError("");
    void fetchWpOwnerExperienceBookingRequests({ data: { email, identityToken: identityToken ?? undefined } })
      .then((result) => { if (!cancelled) setExperienceBookings(result); })
      .catch((reason) => { if (!cancelled) { setExperienceBookings([]); setExperienceBookingError(reason instanceof Error ? reason.message : "Could not load experience bookings."); } })
      .finally(() => { if (!cancelled) setExperienceBookingsLoading(false); });
    return () => { cancelled = true; };
  }, [loggedIn, email, identityToken]);

  useEffect(() => {
    if (!loggedIn || !email) {
      setOwnerNotifications([]);
      setOwnerEventNotifications([]);
      return;
    }
    let cancelled = false;
    setOwnerNotificationsLoading(true);
    setOwnerNotificationsError("");
    void Promise.all([
      fetchTableReservationNotifications({ data: { email, identityToken: identityToken ?? undefined } }),
      fetchEventInbox({ data: { email, identityToken: identityToken ?? undefined } }).catch(() => ({ items: [], unread: 0 })),
    ]).then(([reservationResult, eventResult]) => {
      if (cancelled) return;
      // The inbox endpoints are identity-scoped, not necessarily owner-scoped:
      // a user may also have notifications for experiences/events they booked.
      // Only show items tied to content this account actually owns.
      const normalize = (value: unknown) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      const ownedListingNames = [
        ...(dashboard?.listings ?? []).map((item) => item.title),
        ...ownerListings.map((item) => item.title),
        ...sessionListings.map((item) => item.name),
      ].map(normalize).filter(Boolean);
      const ownedExperienceNames = experiences.map((item) => item.title).map(normalize).filter(Boolean);
      const ownedEventIds = new Set(events.map((item) => Number(item.id ?? item.event_id)).filter((id) => Number.isFinite(id) && id > 0));
      const ownedEventNames = events.map((item) => item.title ?? item.event_title ?? "").map(normalize).filter(Boolean);
      const ownerTable = (reservationResult.items ?? []).filter((item) => {
        const text = normalize(`${item.title ?? ""} ${item.body ?? ""}`);
        const type = String(item.notification_type ?? "").toLowerCase().replace(/_/g, "-");
        const isExperience = type.includes("experience") || /new request received|experience booking/.test(text);
        if (isExperience) return ownedExperienceNames.some((name) => name && text.includes(name));
        // Table reservation alerts must mention a listing this account owns.
        return ownedListingNames.some((name) => name && text.includes(name)) &&
          (type.includes("reservation") || /table reservation|reservation/.test(text));
      });
      const ownerEvents = (eventResult.items ?? []).filter((item) => {
        const text = normalize(`${item.title ?? ""} ${item.body ?? ""}`);
        const eventId = Number(item.event_id);
        const belongsToOwnedEvent = (Number.isFinite(eventId) && ownedEventIds.has(eventId)) ||
          ownedEventNames.some((name) => name && text.includes(name));
        return belongsToOwnedEvent;
      });
      setOwnerNotifications(ownerTable);
      setOwnerEventNotifications(ownerEvents);
    }).catch((reason) => {
      if (!cancelled) setOwnerNotificationsError(reason instanceof Error ? reason.message : "Could not load owner notifications.");
    }).finally(() => { if (!cancelled) setOwnerNotificationsLoading(false); });
    return () => { cancelled = true; };
  }, [loggedIn, email, identityToken, dashboard, ownerListings, sessionListings, experiences, events]);

  useEffect(() => {
    if (!sessionUser?.id) return;
    let cancelled = false;
    setOwnerContentLoading(true);
    setOwnerContentError("");
    void fetchWpAuthorContent({ data: { authorId: sessionUser.id } })
      .then((result) => {
        if (cancelled) return;
        setOwnerListings((result.myListings ?? []).map((item) => ({ id: item.wpId, wpId: item.wpId, slug: item.slug, title: item.title, url: item.url })));
      })
      .catch((reason) => { if (!cancelled) setOwnerContentError(reason instanceof Error ? reason.message : "Could not load owner listings."); })
      .finally(() => { if (!cancelled) setOwnerContentLoading(false); });
    return () => { cancelled = true; };
  }, [sessionUser?.id]);

  useEffect(() => {
    if (!email) { setLoading(false); return; }
    let cancelled = false;
    void fetchTableReservationOwnerDashboard({ data: { email, ...(userId ? { userId } : {}) } })
      .then((result) => {
        if (cancelled) return;
        setDashboard(result);
      })
      .catch(() => { if (!cancelled) setDashboard({ listings: [], reservations: [] }); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [email, userId]);

  const listing = dashboard?.listings.find((item) => item.id === selectedListing);
  const visibleOwnerListings = ownerListings.length ? ownerListings : sessionListings.map((item) => ({
    id: item.wpId, wpId: item.wpId, slug: item.slug, title: item.name, url: item.siteUrl,
  }));

  return (
    <div className="mx-auto max-w-4xl px-0 py-0 sm:px-4 sm:py-6">
      <Link to="/dashboard" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Owner Dashboard
      </Link>

      <div className="mt-1 rounded-none bg-card p-0 sm:mt-3 sm:rounded-2xl sm:p-6 ring-0 sm:ring-1 sm:ring-border/70">
        <div className="flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary"><Store className="size-6" /></div>
          <div>
            <h1 className="font-display text-xl font-semibold sm:text-2xl">Owner Dashboard</h1>
            <p className="text-sm text-muted-foreground">Manage listings, events, experiences, bookings and notifications in one place.</p>
          </div>
        </div>

        {loading && <p className="mt-4 text-sm text-muted-foreground">Loading reservation data…</p>}
        {!loggedIn ? (
          <div className="mt-4 rounded-xl border border-border/70 p-5 text-sm text-muted-foreground">
            Sign in to view owner content and booking details. <Link to="/login" className="font-medium text-primary underline">Sign in</Link>
          </div>
        ) : (
          <div className="mt-5">
            {view === "menu" && (
              <>
                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-cols-4">
                  {[
                    { label: "Listings", count: visibleOwnerListings.length || dashboard?.listings.length || 0, hint: "Manage your directory listings", icon: Store, to: "/my-listings" },
                    { label: "Events", count: events.length, hint: "Track publication status and registrations", icon: CalendarDays, to: "/my-events/" },
                    { label: "Experiences", count: experiences.length, hint: "Manage experiences and booking requests", icon: Ticket, to: "/my-experiences" },
                    { label: "Bookings", count: (dashboard?.reservations.length ?? 0) + eventBookings.length + experienceBookings.length, hint: "Review customer bookings across all three services", icon: ClipboardList, to: "/dashboard" },
                  ].map((card) => (
                    <Link key={card.label} to={card.to as never} {...(card.to === "/dashboard" ? { search: { view: "bookings" as const } } : {})} className="min-w-0 rounded-2xl border border-border/70 bg-background p-3 transition hover:border-primary/50 hover:bg-muted sm:p-4">
                      <card.icon className="size-5 text-primary sm:size-6" />
                      <div className="mt-2 text-xl font-semibold sm:mt-3 sm:text-2xl">{card.count}</div>
                      <div className="font-semibold">{card.label}</div>
                      <p className="mt-1 text-xs text-muted-foreground">{card.hint}</p>
                    </Link>
                  ))}
                </div>
                <section className="mt-4 rounded-2xl border border-border/70 bg-background p-4 sm:p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Bell className="size-5" /></div>
                      <div><h2 className="font-display text-lg font-semibold">Owner notifications</h2><p className="mt-1 text-sm text-muted-foreground">Listing reservations, event bookings and experience requests.</p></div>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => window.location.reload()}>Refresh</Button>
                  </div>
                  {ownerNotificationsLoading ? <p className="mt-4 text-sm text-muted-foreground">Loading owner notifications…</p>
                    : ownerNotificationsError ? <p role="alert" className="mt-4 text-sm text-destructive">{ownerNotificationsError}</p>
                    : ownerNotifications.length + ownerEventNotifications.length === 0 ? <p className="mt-4 rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">No owner notifications found.</p>
                    : <div className="mt-3 space-y-2">
                      {ownerEventNotifications.map((item) => {
                        const targetBookingId = Number(item.booking_id ?? 0) || Number(item.body.match(/(?:booking|request|reservation)\s*#?([0-9]+)/i)?.[1] ?? 0) || undefined;
                        return <Link key={`event-notice-${item.id}`} to="/dashboard" search={{ view: "bookings", bookingType: "events", ...(targetBookingId ? { bookingId: targetBookingId } : {}) }} className={`flex items-start gap-3 rounded-xl border p-3 transition hover:border-primary/50 ${item.read_at ? "border-border" : "border-primary/40 bg-primary/5"}`}>
                        <Bell className="mt-0.5 size-4 shrink-0 text-primary" /><span className="min-w-0 flex-1"><span className="block font-semibold">{item.title}</span><span className="mt-1 block text-sm text-muted-foreground">{item.body}</span><span className="mt-1 block text-xs text-muted-foreground">Notification: {formatDisplayDateTime(item.created_at)}</span></span>
                      </Link> })}
                      {ownerNotifications.map((item) => {
                        const notificationText = `${item.title ?? ""} ${item.body ?? ""}`;
                        const targetBookingId = Number(item.reservation_id ?? 0) || Number((item as TableReservationNotification & { booking_id?: number | null }).booking_id ?? 0) || Number(notificationText.match(/(?:booking|request|reservation)\s*#?([0-9]+)/i)?.[1] ?? 0) || undefined;
                        const isExperienceNotice = String(item.notification_type ?? "").toLowerCase().includes("experience") || /experience|request/i.test(notificationText);
                        return <Link key={`owner-notice-${item.id}`} to="/dashboard" search={{ view: "bookings", bookingType: isExperienceNotice ? "experiences" : "table", ...(targetBookingId ? { bookingId: targetBookingId } : {}) }} className={`flex items-start gap-3 rounded-xl border p-3 transition hover:border-primary/50 ${item.read_at ? "border-border" : "border-primary/40 bg-primary/5"}`}>
                        <Bell className="mt-0.5 size-4 shrink-0 text-primary" /><span className="min-w-0 flex-1"><span className="block font-semibold">{item.title}</span><span className="mt-1 block text-sm text-muted-foreground">{item.body}</span>{item.reservation_date && <span className="mt-1 block text-xs text-muted-foreground">Reservation: {formatDisplayDate(item.reservation_date)}{item.reservation_start_time ? ` · ${formatDisplayTime(item.reservation_start_time)}` : ""}</span>}<span className="mt-1 block text-xs text-muted-foreground">Notification: {formatDisplayDateTime(item.created_at)}</span></span>
                      </Link>;
                      })}
                    </div>}
                  <Link to="/dashboard" search={{ view: "notifications" }} className="mt-3 inline-block text-sm font-medium text-primary hover:underline">Open full notification inbox →</Link>
                </section>
              </>
            )}

            {view === "bookings" && (
              <section className="mt-5">
                <div className="hidden md:block"><OwnerTicketScanner email={email} identityToken={identityToken ?? undefined} cameraRequest={cameraRequest} onCameraRequestHandled={() => setCameraRequest(false)} onTableCheckedIn={(id, checkedAt) => setDashboard((current) => current ? { ...current, reservations: current.reservations.map((reservation) => reservation.id === id ? { ...reservation, checkedIn: true, checkedInAt: checkedAt } : reservation) } : current)} /></div>
                <div className="mt-2 grid grid-cols-3 gap-1.5 sm:mt-3 sm:gap-2">
                  {[
                    { key: "table", label: "Table reservations", count: dashboard?.reservations.length ?? 0 },
                    { key: "events", label: "Event bookings", count: eventBookings.length },
                    { key: "experiences", label: "Experience bookings", count: experienceBookings.length },
                  ].map((item) => (
                    <button key={item.key} type="button" onClick={() => setBookingType(item.key as "table" | "events" | "experiences")} className={`rounded-md border px-2 py-2 text-left transition sm:rounded-xl sm:p-3 ${bookingType === item.key ? "border-primary bg-primary/10" : "border-border/70 bg-background hover:bg-muted"}`}>
                      <span className="block text-xs text-muted-foreground">{item.label}</span>
                      <span className="mt-1 block text-xl font-semibold">{item.count}</span>
                    </button>
                  ))}
                </div>
                {bookingType === "table" && (
                  dashboard ? <OwnerBookings dashboard={dashboard} email={email} selectedListing={selectedListing} targetReservationId={searchBookingType === "table" ? searchBookingId : undefined} onUpdated={(id, status) => setDashboard((current) => current ? { ...current, reservations: current.reservations.map((reservation) => reservation.id === id ? { ...reservation, status } : reservation) } : current)} /> : <p className="mt-4 text-sm text-muted-foreground">Loading table reservations…</p>
                )}
                {bookingType === "events" && (
                  <div className="mt-3 space-y-2">
                    {eventBookingsLoading ? <p className="text-sm text-muted-foreground">Loading event bookings…</p> : eventBookingError ? <p className="rounded-xl border border-destructive/30 p-3 text-sm text-destructive">{eventBookingError}</p> : eventBookings.length === 0 ? <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">No customer bookings found for your events.</p> : eventBookings.map((booking) => (
                      <EventOwnerBookingCard
                        key={booking.id}
                        booking={booking}
                        email={email}
                        identityToken={identityToken ?? undefined}
                        targetBookingId={searchBookingType === "events" ? searchBookingId : undefined}
                        onUpdated={(id, status) => setEventBookings((current) => current.map((item) => item.id === id ? { ...item, status } : item))}
                      />
                    ))}
                  </div>
                )}
                {bookingType === "experiences" && (
                  <div className="mt-3 space-y-2">
                    {experienceBookingsLoading ? <p className="text-sm text-muted-foreground">Loading experience bookings…</p> : experienceBookingError ? <p className="rounded-xl border border-destructive/30 p-3 text-sm text-destructive">{experienceBookingError}</p> : experienceBookings.length === 0 ? <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">No customer requests found for your experiences.</p> : experienceBookings.map((booking) => (
                      <ExperienceOwnerBookingCard key={booking.id} booking={booking} email={email} identityToken={identityToken ?? undefined} targetBookingId={searchBookingType === "experiences" ? searchBookingId : undefined} onUpdated={(id, status) => setExperienceBookings((current) => current.map((item) => item.id === id ? { ...item, status } : item))} />
                    ))}
                  </div>
                )}
              </section>
            )}

            {view === "listings" && (
              <section className="mt-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="font-display text-xl font-semibold">Listing Owner</h2>
                    <p className="text-sm text-muted-foreground">Choose a listing to manage its table bookings and reservation setup.</p>
                  </div>
                  <Button asChild size="sm"><Link to="/dashboard" search={{ view: "listings" }}>Manage listings</Link></Button>
                </div>
                {dashboard?.listings.length ? (
                  <>
                    <label className="mt-4 block text-sm font-medium">
                      Select listing
                      <select value={selectedListing} onChange={(e) => setSelectedListing(Number(e.target.value))} className="mt-2 h-11 w-full rounded-xl border border-border bg-background px-3">
                        <option value={0}>All listings</option>
                        {dashboard.listings.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
                      </select>
                    </label>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <Link
                        to="/dashboard"
                        search={{ view: "bookings" }}
                        onClick={() => setBookingType("table")}
                        className="group rounded-3xl border border-border/70 bg-background p-5 transition hover:border-primary/50 hover:bg-muted"
                      >
                        <CalendarDays className="size-6 text-primary" />
                        <h3 className="mt-3 font-display text-lg font-semibold">View Bookings</h3>
                        <p className="mt-1 text-sm text-muted-foreground">View and manage reservations for {listing?.title || "all your listings"}.</p>
                        <span className="mt-4 inline-block text-sm font-medium text-primary group-hover:underline">Open bookings →</span>
                      </Link>
                      {selectedListing ? (
                        <Link
                          to="/reservation-setup"
                          search={{ listingId: selectedListing, listingTitle: listing?.title, listingSlug: listing?.slug }}
                          className="group rounded-3xl border border-border/70 bg-background p-5 transition hover:border-primary/50 hover:bg-muted"
                        >
                          <Settings2 className="size-6 text-primary" />
                          <h3 className="mt-3 font-display text-lg font-semibold">Setup Reservations</h3>
                          <p className="mt-1 text-sm text-muted-foreground">Configure opening hours, slots, capacity and booking rules for {listing?.title || "this listing"}.</p>
                          <span className="mt-4 inline-block text-sm font-medium text-primary group-hover:underline">Open setup →</span>
                        </Link>
                      ) : (
                        <div aria-disabled="true" className="cursor-not-allowed rounded-3xl border border-border/50 bg-background/60 p-5 opacity-70">
                          <Settings2 className="size-6 text-muted-foreground" />
                          <h3 className="mt-3 font-display text-lg font-semibold">Setup Reservations</h3>
                          <p className="mt-1 text-sm text-muted-foreground">Select one specific listing above to configure its opening hours, slots, capacity and booking rules.</p>
                        </div>
                      )}
                    </div>
                    <p className="mt-3 text-xs text-muted-foreground">{selectedListing ? `Selected listing: ${listing?.title || "Loading listing…"}.` : "All listings selected. Table bookings will include every listing; choose one listing above to manage its reservation setup."}</p>
                  </>
                ) : (
                  <div className="mt-4 rounded-xl border border-dashed p-5 text-sm text-muted-foreground">
                    {loading ? "Loading your reservation-enabled listings…" : "No listings are linked to this account yet. Check that the signed-in WordPress account owns the listing or has been linked to it."}
                  </div>
                )}
                <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="font-semibold">Your directory listings</h3>
                    <p className="text-sm text-muted-foreground">Listings associated with your WordPress account.</p>
                  </div>
                  <Button asChild size="sm" variant="outline"><Link to="/dashboard" search={{ view: "listings" }}>Manage listings</Link></Button>
                </div>
                {ownerContentLoading ? (
                  <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin"/>Loading directory listings…</p>
                ) : ownerContentError ? (
                  <p className="mt-3 text-sm text-destructive">{ownerContentError}</p>
                ) : visibleOwnerListings.length === 0 ? (
                  <p className="mt-3 rounded-xl border border-dashed p-4 text-sm text-muted-foreground">No WordPress-author listings were returned for this account. Reservation management above uses the listing-owner bridge.</p>
                ) : (
                  <div className="mt-3 space-y-2">
                    {visibleOwnerListings.slice(0, 20).map((item) => (
                      <div key={item.id ?? item.slug} className="flex items-center justify-between gap-3 rounded-xl border border-border/70 p-3">
                        <div className="min-w-0"><p className="truncate font-medium">{item.title}</p><p className="truncate text-xs text-muted-foreground">{item.slug}</p></div>
                        {item.url && <a href={item.url} target="_blank" rel="noreferrer" className="shrink-0 text-sm font-medium text-primary">View <ExternalLink className="ml-1 inline size-3.5"/></a>}
                      </div>
                    ))}
                    {visibleOwnerListings.length > 20 && <p className="text-xs text-muted-foreground">Showing 20 of {visibleOwnerListings.length} directory listings.</p>}
                  </div>
                )}
              </section>
            )}

            {view === "events" && (
              <section className="mt-5">
                <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-display text-xl font-semibold">Your events</h2><p className="text-sm text-muted-foreground">Publication status and registrations.</p></div><Button asChild size="sm"><Link to="/my-events">Manage events</Link></Button></div>
                {eventsLoading ? <p className="mt-4 text-sm text-muted-foreground">Loading events…</p> : events.length === 0 ? <div className="mt-4 rounded-xl border border-dashed p-5 text-sm text-muted-foreground">No events found yet.</div> : <div className="mt-3 space-y-2">{events.slice(0, 8).map((event) => <div key={event.id} className="flex flex-col gap-3 rounded-xl border border-border/70 p-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0 flex-1"><p className="truncate font-medium">{event.title}</p><p className="mt-1 text-xs text-muted-foreground">{event.start_datetime || "Date to be announced"} · {event.booking_count ?? 0} registrations</p></div><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-muted px-2 py-1 text-xs">{event.status || "Unknown"}</span><Button asChild size="sm" variant="outline"><Link to="/my-events/$eventId/edit" params={{ eventId: String(event.id) }}>Edit event</Link></Button>{event.url && event.status === "publish" && <Button asChild size="sm" variant="ghost"><a href={event.url} target="_blank" rel="noreferrer">View event <ExternalLink className="ml-1 size-3.5" /></a></Button>}</div></div>)}</div>}
                <Button asChild variant="outline" size="sm" className="mt-3"><Link to="/submit-event"><FilePlus2 className="mr-2 size-4"/>Submit an event</Link></Button>
              </section>
            )}

            {view === "experiences" && (
              <section className="mt-5">
                <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-display text-xl font-semibold">Your experiences</h2><p className="text-sm text-muted-foreground">Review provider content and edit submitted experiences.</p></div><Button asChild size="sm"><Link to="/my-experiences">Manage experiences</Link></Button></div>
                {experiencesLoading ? <p className="mt-4 text-sm text-muted-foreground">Loading experiences…</p> : experiences.length === 0 ? <div className="mt-4 rounded-xl border border-dashed p-5 text-sm text-muted-foreground">No experiences found yet.</div> : <div className="mt-3 space-y-2">{experiences.slice(0, 8).map((experience) => <div key={experience.id} className="flex flex-col gap-3 rounded-xl border border-border/70 p-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0 flex-1"><p className="truncate font-medium">{experience.title}</p><p className="mt-1 text-xs text-muted-foreground">{experience.status} · Updated {experience.modified || "—"}</p></div><div className="flex flex-wrap items-center gap-2"><Button asChild variant="outline" size="sm"><Link to="/my-experiences/$experienceId/edit" params={{ experienceId: String(experience.id) }}>Edit experience</Link></Button>{experience.status === "publish" && experience.url && <Button asChild variant="ghost" size="sm"><a href={experience.url} target="_blank" rel="noreferrer">View experience <ExternalLink className="ml-1 size-3.5" /></a></Button>}</div></div>)}</div>}
                <Button asChild variant="outline" size="sm" className="mt-3"><Link to="/submit-experiences" search={{}}><FilePlus2 className="mr-2 size-4"/>Submit an experience</Link></Button>
              </section>
            )}

            {view === "notifications" && (
              <section className="mt-5 rounded-xl border border-border/70 p-5">
                <Bell className="size-7 text-primary"/>
                <h2 className="mt-2 font-display text-xl font-semibold">Notifications</h2>
                <p className="mt-1 text-sm text-muted-foreground">New event registrations, experience booking requests and table reservation updates are collected in your inbox.</p>
                <Button asChild className="mt-3"><Link to="/dashboard" search={{ view: "notifications" }}>Open notification inbox</Link></Button>
              </section>
            )}
          </div>
        )}
      </div>
      <nav aria-label="Owner dashboard navigation" className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] shadow-lg backdrop-blur-md md:hidden">
        <ul className="grid grid-cols-5">
          {[
            { key: "listings", label: "Listings", icon: Store, count: visibleOwnerListings.length || dashboard?.listings.length || 0 },
            { key: "events", label: "Events", icon: CalendarDays, count: events.length },
            { key: "experiences", label: "Experiences", icon: Ticket, count: experiences.length },
            { key: "bookings", label: "Bookings", icon: ClipboardList, count: (dashboard?.reservations.length ?? 0) + eventBookings.length + experienceBookings.length },
          ].map((item) => (
            <li key={item.key}>
              <Link
                to="/dashboard"
                search={{ view: item.key as "listings" | "events" | "experiences" | "bookings" }}
                aria-current={view === item.key ? "page" : undefined}
                className={`relative flex h-14 flex-col items-center justify-center gap-0.5 px-1 text-center text-[10px] font-medium transition-colors ${view === item.key ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`}
              >
                <item.icon className="size-5" />
                <span>{item.label}</span>
                <span className="absolute right-[14%] top-1.5 min-w-4 rounded-full bg-primary px-1 text-center text-[10px] leading-4 text-primary-foreground tabular-nums">{item.count}</span>
              </Link>
            </li>
          ))}
          <li>
            <Link to="/qr-scan" aria-label="Open QR code scanner" className="flex h-14 w-full flex-col items-center justify-center gap-0.5 px-1 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary">
              <QrCode className="size-5" />
              <span>Scan QR</span>
            </Link>
          </li>
        </ul>
      </nav>
    </div>
  );
}