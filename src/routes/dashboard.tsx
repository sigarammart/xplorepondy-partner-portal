import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Bell, CalendarDays, Camera, ChartNoAxesCombined, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, ClipboardList, ExternalLink, FilePlus2, LoaderCircle, Menu, QrCode, Settings2, Store, Ticket, X, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { checkInOwnerTableReservationTicket, fetchTableReservationOwnerDashboard, fetchWpOwnerExperienceBookingRequests, updateWpOwnerExperienceBookingRequestStatus, updateTableReservationOwnerStatus, type ExperienceBookingRequest, type TableReservationOwnerDashboard } from "@/lib/wp-api";
import { assignAdminListing, fetchAdminListings, fetchOwnerListings } from "@/lib/owner-listings";
import { useAppLoggedIn } from "@/lib/app-session";
import { checkInOwnerEventTicket, fetchMyEvents, fetchMyOwnedEventBookings, updateMyOwnedEventBookingStatus, type EventAccountItem, type EventOwnerBookingItem } from "@/lib/events-api";
import { checkInOwnerExperienceTicket, fetchMyExperiences, type ExperienceAccountItem } from "@/lib/experiences-account-api";
import { useSession } from "@/store/session";
import { formatDisplayDate, formatDisplayTime, formatDisplayDateTime } from "@/lib/date-time-format";
import { fetchTableReservationNotifications, fetchWpDailyListingViewStats, type DailyListingViewStats, type TableReservationNotification } from "@/lib/wp-api";
import { fetchEventInbox, type EventInboxItem } from "@/lib/events-api";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { HeaderAuth } from "@/components/header-auth";
import { OwnerListingsManager } from "@/components/owner-listings-manager";
import { authEnabled, signOut } from "@/lib/auth/client";

export const Route = createFileRoute("/dashboard")({
  validateSearch: (search: Record<string, unknown>): { view?: "bookings" | "listings" | "events" | "experiences" | "notifications" | "admin-listings" | "statistics"; bookingType?: "table" | "events" | "experiences"; bookingId?: number; listingId?: number } => ({
    view: ["bookings", "listings", "events", "experiences", "notifications", "admin-listings", "statistics"].includes(String(search.view))
      ? search.view as "bookings" | "listings" | "events" | "experiences" | "notifications" | "admin-listings" | "statistics"
      : undefined,
    bookingType: ["table", "events", "experiences"].includes(String(search.bookingType))
      ? search.bookingType as "table" | "events" | "experiences"
      : undefined,
    bookingId: Number.isInteger(Number(search.bookingId)) && Number(search.bookingId) > 0 ? Number(search.bookingId) : undefined,
    listingId: Number.isInteger(Number(search.listingId)) && Number(search.listingId) > 0 ? Number(search.listingId) : undefined,
  }),
  component: ListingOwnerDashboardPage,
});

function StatisticsSkeleton() {
  return (
    <div className="mt-5 space-y-5" role="status" aria-live="polite" aria-label="Loading statistics">
      <span className="sr-only">Loading content statistics…</span>
      <section className="rounded-2xl border border-border/70 bg-card p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex-1 space-y-3">
            <div className="xp-skeleton h-3 w-36 rounded" />
            <div className="xp-skeleton h-6 w-52 max-w-full rounded" />
            <div className="xp-skeleton h-4 w-80 max-w-full rounded" />
          </div>
          <div className="xp-skeleton h-6 w-28 rounded-full" />
        </div>
        <div className="mt-5 flex flex-wrap items-end gap-4 rounded-xl bg-muted/40 p-3">
          <div className="space-y-2"><div className="xp-skeleton h-3 w-20 rounded" /><div className="xp-skeleton h-10 w-40 max-w-full rounded-xl" /></div>
          <div className="space-y-2"><div className="xp-skeleton h-3 w-28 rounded" /><div className="xp-skeleton h-10 w-64 max-w-full rounded-xl" /></div>
          <div className="xp-skeleton h-3 w-72 max-w-full rounded" />
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <article key={index} className="rounded-xl border border-border/70 bg-background p-4">
              <div className="flex items-center gap-2"><div className="xp-skeleton size-8 shrink-0 rounded-lg" /><div className="xp-skeleton h-4 w-32 max-w-full rounded" /></div>
              <div className="xp-skeleton mt-4 h-8 w-16 rounded" />
              <div className="xp-skeleton mt-2 h-3 w-28 rounded" />
            </article>
          ))}
        </div>
      </section>
      <div className="grid gap-5 xl:grid-cols-2">
        <section className="rounded-2xl border border-border/70 bg-card p-4 sm:p-5">
          <div className="xp-skeleton h-5 w-48 rounded" /><div className="xp-skeleton mt-2 h-3 w-64 max-w-full rounded" />
          <div className="mt-5 space-y-5">
            {Array.from({ length: 5 }, (_, index) => <div key={index} className="space-y-2"><div className="flex justify-between gap-3"><div className="xp-skeleton h-4 w-40 max-w-[70%] rounded" /><div className="xp-skeleton h-4 w-12 rounded" /></div><div className="xp-skeleton h-2 w-full rounded-full" /><div className="xp-skeleton h-3 w-52 max-w-full rounded" /></div>)}
          </div>
        </section>
        <section className="rounded-2xl border border-border/70 bg-card p-4 sm:p-5">
          <div className="xp-skeleton h-5 w-52 rounded" /><div className="xp-skeleton mt-2 h-3 w-64 max-w-full rounded" />
          <div className="mt-5 space-y-4">{Array.from({ length: 3 }, (_, index) => <div key={index} className="rounded-xl border border-border/70 bg-background p-3"><div className="xp-skeleton h-4 w-40 rounded" /><div className="mt-4 grid grid-cols-2 gap-3"><div><div className="xp-skeleton h-3 w-28 rounded" /><div className="xp-skeleton mt-2 h-6 w-14 rounded" /></div><div><div className="xp-skeleton h-3 w-28 rounded" /><div className="xp-skeleton mt-2 h-6 w-14 rounded" /></div></div></div>)}</div>
        </section>
      </div>
      <section className="rounded-2xl border border-border/70 bg-card p-4 sm:p-5">
        <div className="flex flex-wrap justify-between gap-3"><div className="space-y-2"><div className="xp-skeleton h-5 w-52 rounded" /><div className="xp-skeleton h-3 w-44 rounded" /></div><div className="xp-skeleton h-9 w-44 rounded-lg" /></div>
        <div className="mt-5 space-y-3">{Array.from({ length: 5 }, (_, index) => <div key={index} className="grid grid-cols-4 gap-3 border-t border-border/70 py-3"><div className="xp-skeleton h-4 w-full rounded" /><div className="xp-skeleton h-4 w-16 rounded" /><div className="xp-skeleton h-4 w-16 rounded" /><div className="xp-skeleton h-4 w-16 rounded" /></div>)}</div>
      </section>
    </div>
  );
}

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
  listings,
  email,
  selectedListing,
  targetReservationId,
  onUpdated,
}: {
  dashboard: TableReservationOwnerDashboard;
  listings: Array<{ id: number; title: string }>;
  email: string;
  selectedListing: number;
  targetReservationId?: number;
  onUpdated: (id: number, status: string) => void;
}) {
  const [listingFilter, setListingFilter] = useState(selectedListing);
  const [listingSearch, setListingSearch] = useState("");
  const [listingDropdownOpen, setListingDropdownOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState("");
  const [updatingId, setUpdatingId] = useState(0);
  const listingMap = new Map([...dashboard.listings, ...listings].map((listing) => [listing.id, listing]));
  const rows = dashboard.reservations.filter((r) =>
    (!targetReservationId || r.id === targetReservationId) &&
    (!listingFilter || r.listingId === listingFilter) &&
    (!statusFilter || (statusFilter === "checked-in" ? Boolean(r.checkedIn) : r.status === statusFilter))
  );
  const statuses = ["pending", "confirmed", "cancelled", "completed", "no-show", "checked-in"];

  return (
    <div className="mt-4">
      <div className="mb-3 grid grid-cols-3 gap-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6" aria-label="Filter reservations by status">
        {[
          { label: "Owner Pending", status: "pending", tone: "text-amber-500", active: "border-amber-500 bg-amber-500/15 ring-1 ring-amber-500/30" },
          { label: "Confirmed", status: "confirmed", tone: "text-sky-500", active: "border-sky-500 bg-sky-500/15 ring-1 ring-sky-500/30" },
          { label: "Cancelled", status: "cancelled", tone: "text-rose-500", active: "border-rose-500 bg-rose-500/15 ring-1 ring-rose-500/30" },
          { label: "Completed", status: "completed", tone: "text-emerald-500", active: "border-emerald-500 bg-emerald-500/15 ring-1 ring-emerald-500/30" },
          { label: "No Show", status: "no-show", tone: "text-muted-foreground", active: "border-slate-500 bg-slate-500/15 ring-1 ring-slate-500/30" },
          { label: "Checked in", status: "checked-in", tone: "text-emerald-500", active: "border-emerald-500 bg-emerald-500/15 ring-1 ring-emerald-500/30" },
        ].map((item) => {
          const count = dashboard.reservations.filter((reservation) => item.status === "checked-in" ? Boolean(reservation.checkedIn) : reservation.status === item.status).length;
          const active = statusFilter === item.status;
          return (
            <button
              key={item.status}
              type="button"
              aria-pressed={active}
              onClick={() => setStatusFilter((current) => current === item.status ? "" : item.status)}
              className={"rounded-xl border px-3 py-3 text-left transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:px-4 " + (active ? item.active : "border-border/70 bg-card hover:border-border")}
            >
              <span className="block text-xs font-medium text-muted-foreground sm:text-sm">{item.label}</span>
              <span className={"mt-1 block text-2xl font-bold tabular-nums " + item.tone}>{count}</span>
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-full sm:w-[min(100%,28rem)]">
          <button type="button" aria-haspopup="listbox" aria-expanded={listingDropdownOpen} onClick={() => { setListingDropdownOpen((open) => !open); setListingSearch(""); }} className="flex h-10 w-full items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 text-left text-sm">
            <span className="truncate">{listingFilter === 0 ? "All my listings" : listings.find((listing) => listing.id === listingFilter)?.title ?? dashboard.listings.find((listing) => listing.id === listingFilter)?.title ?? "Select listing"}</span>
            <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
          </button>
          {listingDropdownOpen && <div className="absolute left-0 top-full z-30 mt-1 w-full overflow-hidden rounded-xl border border-border bg-card shadow-xl">
            <div className="border-b border-border p-2">
              <input autoFocus type="search" value={listingSearch} onChange={(event) => setListingSearch(event.target.value)} placeholder="Search listings..." aria-label="Search listings" className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
            </div>
            <div role="listbox" aria-label="Filter reservations by listing" className="max-h-64 overflow-y-auto p-1">
              <button type="button" role="option" aria-selected={listingFilter === 0} onClick={() => { setListingFilter(0); setListingDropdownOpen(false); setListingSearch(""); }} className={`w-full rounded-lg px-3 py-2.5 text-left text-sm hover:bg-muted ${listingFilter === 0 ? "bg-primary/10 text-primary" : ""}`}>All my listings</button>
              {listings.filter((listing) => listing.title.toLowerCase().includes(listingSearch.trim().toLowerCase()) || String(listing.id).includes(listingSearch.trim())).map((listing) => <button key={listing.id} type="button" role="option" aria-selected={listingFilter === listing.id} onClick={() => { setListingFilter(listing.id); setListingDropdownOpen(false); setListingSearch(""); }} className={`block w-full rounded-lg px-3 py-2.5 text-left text-sm hover:bg-muted ${listingFilter === listing.id ? "bg-primary/10 text-primary" : ""}`}>{listing.title}</button>)}
              {listings.filter((listing) => listing.title.toLowerCase().includes(listingSearch.trim().toLowerCase()) || String(listing.id).includes(listingSearch.trim())).length === 0 && <p className="px-3 py-4 text-sm text-muted-foreground">No listings found.</p>}
            </div>
          </div>}
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-10 rounded-lg border border-border bg-card px-3 text-sm">
          <option value="">All statuses</option>
          {statuses.map((status) => <option key={status} value={status}>{status === "checked-in" ? "Checked in" : status.replace("-", " ")}</option>)}
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
              <div key={reservation.id} id={`booking-table-${reservation.id}`} className={`scroll-mt-24 rounded-xl border p-3 transition-colors ${
                reservation.checkedIn
                  ? "border-emerald-500/35 bg-emerald-500/[0.07]"
                  : reservation.status === "cancelled"
                    ? "border-rose-500/35 bg-rose-500/[0.07]"
                    : reservation.status === "pending"
                      ? "border-amber-500/35 bg-amber-500/[0.07]"
                      : reservation.status === "no-show"
                        ? "border-slate-500/35 bg-slate-500/[0.07]"
                        : reservation.status === "confirmed"
                          ? "border-sky-500/25 bg-sky-500/[0.04]"
                          : reservation.status === "completed"
                            ? "border-violet-500/30 bg-violet-500/[0.06]"
                            : "border-border/70 bg-background"
              } ${targetReservationId === reservation.id ? "ring-2 ring-primary" : ""}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-semibold">{listing?.title ?? `Listing #${reservation.listingId}`}</h3>
                    <p className="mt-1 text-xs text-muted-foreground">Booking ID: <span className="font-mono">#{formatReservationId(reservation.id)}</span>{reservation.createdAt ? ` · Booked on ${formatDisplayDate(reservation.createdAt)} ${formatDisplayTime(reservation.createdAt.slice(11, 16))}` : ""}</p>
                    <p className="mt-2 text-sm text-foreground">Reservation Date: {formatDisplayDate(reservation.reservationDate)}</p>
                    <p className="text-sm text-foreground">Time: {formatDisplayTime(reservation.startTime)}–{formatDisplayTime(reservation.endTime)}</p>
                    <p className="text-sm text-foreground">No. of Guests: {reservation.guests}</p>
                  </div>
                  <span className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold capitalize ${
                    reservation.checkedIn
                      ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-500"
                      : reservation.status === "cancelled"
                        ? "border-rose-500/30 bg-rose-500/15 text-rose-500"
                        : reservation.status === "pending"
                          ? "border-amber-500/30 bg-amber-500/15 text-amber-500"
                          : reservation.status === "no-show"
                            ? "border-slate-500/30 bg-slate-500/15 text-slate-400"
                            : reservation.status === "confirmed"
                              ? "border-sky-500/30 bg-sky-500/15 text-sky-500"
                              : reservation.status === "completed"
                                ? "border-violet-500/30 bg-violet-500/15 text-violet-500"
                                : "border-border bg-muted text-foreground"
                  }`}>
                    {reservation.checkedIn ? "Checked in" : reservation.status.replace("-", " ")}
                  </span>
                </div>
                <div className="mt-2 grid gap-1.5 text-sm sm:grid-cols-3">
                  <span><strong>{reservation.guestName}</strong> · {reservation.guests} {reservation.guests === 1 ? "guest" : "guests"}</span>
                  <span>{reservation.guestPhone || "No phone"}</span>
                  <span className="truncate">{reservation.guestEmail}</span>
                </div>
                {reservation.checkedIn && <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-600">
                  <span className="font-semibold">Checked in</span>
                  {reservation.checkedInAt ? <span>{formatDisplayDate(reservation.checkedInAt)} at {formatDisplayTime(reservation.checkedInAt.slice(11, 16))}</span> : <span>Check-in recorded</span>}
                </div>}
                {reservation.notes?.trim() && <div className="mt-3 p-3 text-sm"><p className="mb-1 text-xs font-semibold text-muted-foreground">Customer notes</p><p className="whitespace-pre-wrap break-words">{reservation.notes}</p></div>}
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-2">
                  <span className="text-sm font-semibold text-foreground">Booking ID: <span className="font-mono text-base font-bold tracking-wide">#{formatReservationId(reservation.id)}</span>{reservation.checkedIn && <span className="ml-2 font-medium text-emerald-600">Checked in {reservation.checkedInAt || ""}</span>}</span>
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
        <div className="min-w-0">
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
  const isAdministrator = sessionUser?.roles?.includes("administrator") === true || email === "paranjothi2004@gmail.com";
  const { view: searchView, bookingType: searchBookingType, bookingId: searchBookingId, listingId: searchListingId } = Route.useSearch();
  const [dashboard, setDashboard] = useState<TableReservationOwnerDashboard | null>(null);
  const [selectedListing, setSelectedListing] = useState(searchListingId ?? 0);
  const [dashboardListingSearch, setDashboardListingSearch] = useState("");
  const [dashboardListingDropdownOpen, setDashboardListingDropdownOpen] = useState(false);
  const [listingManagementDropdownOpen, setListingManagementDropdownOpen] = useState(false);
  const [listingManagementSearch, setListingManagementSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [view, setView] = useState<"menu" | "bookings" | "listings" | "events" | "experiences" | "notifications" | "admin-listings" | "statistics">(searchView ?? "menu");
  const [statisticsListingFilter, setStatisticsListingFilter] = useState("all");
  const [statisticsListingSearch, setStatisticsListingSearch] = useState("");
  const [statisticsListingDropdownOpen, setStatisticsListingDropdownOpen] = useState(false);
  const [statisticsTimeRange, setStatisticsTimeRange] = useState("all");
  const [dailyListingStats, setDailyListingStats] = useState<Record<number, DailyListingViewStats>>({});
  const [dailyListingStatsLoading, setDailyListingStatsLoading] = useState(false);
  const [dailyListingStatsError, setDailyListingStatsError] = useState("");
  const [cameraRequest, setCameraRequest] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const identityToken = useSession((s) => s.wpIdentityToken);
  const [ownerListings, setOwnerListings] = useState<Array<{ id?: number; wpId?: number; slug: string; title: string; url?: string; siteViewCount?: number; appViewCount?: number }>>([]);
  const [ownerViewsSort, setOwnerViewsSort] = useState<"total-desc" | "site-desc" | "app-desc" | "name-asc">("total-desc");
  const [ownerViewsPage, setOwnerViewsPage] = useState(1);
  const OWNER_VIEWS_PAGE_SIZE = 10;
  const [statisticsReady, setStatisticsReady] = useState(false);
  const [ownerContentLoading, setOwnerContentLoading] = useState(false);
  const [ownerContentError, setOwnerContentError] = useState("");
  const [adminListings, setAdminListings] = useState<Array<{ id: number; title: string; slug: string; url: string; status: string; owner_email: string; owner_name: string; site_view_count: number; app_view_count: number; claim_status: string; package_status: string; table_reservation_enabled?: boolean; reservation_enabled?: boolean; booking_enabled?: boolean; has_table_reservations?: boolean }>>([]);
  const [adminAllListings, setAdminAllListings] = useState<Array<{ id: number; title: string; slug: string; url: string; status: string; owner_email: string; owner_name: string; site_view_count: number; app_view_count: number; claim_status: string; package_status: string; table_reservation_enabled?: boolean; reservation_enabled?: boolean; booking_enabled?: boolean; has_table_reservations?: boolean }>>([]);
  const [adminAllListingsLoaded, setAdminAllListingsLoaded] = useState(false);
  const [adminAllListingsLoading, setAdminAllListingsLoading] = useState(false);
  const [adminAllListingsError, setAdminAllListingsError] = useState("");
  const [adminListingsPage, setAdminListingsPage] = useState(1);
  const [adminListingsTotalPages, setAdminListingsTotalPages] = useState(1);
  const [adminListingsTotalCount, setAdminListingsTotalCount] = useState(0);
  const ADMIN_LISTINGS_PAGE_SIZE = 10;
  const [adminListingSearch, setAdminListingSearch] = useState("");
  const [adminReservationEnabledOnly, setAdminReservationEnabledOnly] = useState(false);
  const [adminAssignmentEmails, setAdminAssignmentEmails] = useState<Record<number, string>>({});
  const [adminListingsLoading, setAdminListingsLoading] = useState(false);
  const [adminListingsError, setAdminListingsError] = useState("");
  const [adminReservationSettingsError, setAdminReservationSettingsError] = useState("");
  const [adminAssigningId, setAdminAssigningId] = useState<number | null>(null);

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
    setStatisticsReady(false);
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
  }, [loggedIn, email, identityToken, refreshKey]);

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
  }, [loggedIn, email, identityToken, dashboard, ownerListings, sessionListings, experiences, events, refreshKey]);

  useEffect(() => {
    if (!loggedIn || !isAdministrator || !email) {
      setAdminListings([]);
      setAdminListingsTotalPages(1);
      setAdminListingsTotalCount(0);
      return;
    }
    let cancelled = false;
    setAdminListingsLoading(true);
    setAdminListingsError("");
    void (async () => {
      setAdminReservationSettingsError("");
      const response = await fetchAdminListings({
        data: { email, ...(identityToken ? { identityToken } : {}), page: adminListingsPage, perPage: ADMIN_LISTINGS_PAGE_SIZE },
      }) as { items?: typeof adminListings; total_pages?: number; total?: number; table_reservation_error?: string };
      if (cancelled) return;
      setAdminListings(response.items ?? []);
      setAdminListingsTotalPages(Math.max(1, Number(response.total_pages) || 1));
      setAdminListingsTotalCount(Number(response.total) || (Number(response.total_pages) || 1) * ADMIN_LISTINGS_PAGE_SIZE);
      if (response.table_reservation_error) setAdminReservationSettingsError(response.table_reservation_error);
    })().catch((reason) => {
      if (!cancelled) setAdminListingsError(reason instanceof Error ? reason.message : "Could not load administrator listings.");
    }).finally(() => { if (!cancelled) setAdminListingsLoading(false); });
    return () => { cancelled = true; };
  }, [loggedIn, isAdministrator, email, identityToken, adminListingsPage, refreshKey]);

  useEffect(() => {
    if (!loggedIn || !isAdministrator || !email) {
      setAdminAllListings([]);
      setAdminAllListingsLoaded(false);
      setAdminAllListingsLoading(false);
      return;
    }
    let cancelled = false;
    setAdminAllListingsLoading(true);
    setAdminAllListingsLoaded(false);
    setAdminAllListingsError("");
    void (async () => {
      // Statistics and listing filters must use the full directory, not only
      // the 10-row page currently visible in Admin: All Listings.
      const pageSize = 100;
      const first = await fetchAdminListings({
        data: { email, ...(identityToken ? { identityToken } : {}), page: 1, perPage: pageSize },
      }) as { items?: typeof adminAllListings; total_pages?: number; total?: number };
      const totalPages = Math.max(1, Number(first.total_pages) || Math.ceil((Number(first.total) || (first.items ?? []).length) / pageSize));
      const remaining = await Promise.all(Array.from({ length: Math.max(0, totalPages - 1) }, (_, index) =>
        fetchAdminListings({
          data: { email, ...(identityToken ? { identityToken } : {}), page: index + 2, perPage: pageSize },
        }) as Promise<{ items?: typeof adminAllListings }>
      ));
      if (cancelled) return;
      setAdminAllListings([...(first.items ?? []), ...remaining.flatMap((response) => response.items ?? [])]);
      setAdminAllListingsLoaded(true);
    })().catch((reason) => {
      if (!cancelled) {
        setAdminAllListings([]);
        setAdminAllListingsLoaded(false);
        setAdminAllListingsError(reason instanceof Error ? reason.message : "Could not load the full administrator listing directory.");
        console.error("Could not load the full administrator listing directory for statistics.", reason);
      }
    }).finally(() => {
      if (!cancelled) setAdminAllListingsLoading(false);
    });
    return () => { cancelled = true; };
  }, [loggedIn, isAdministrator, email, identityToken, refreshKey]);

  useEffect(() => {
    if (!email) {
      setOwnerListings([]);
      setOwnerContentLoading(false);
      return;
    }
    let cancelled = false;
    setOwnerContentLoading(true);
    setOwnerContentError("");
    setStatisticsReady(false);
    const loadOwnerListingsWithCounters = async () => {
      // Some WordPress installs expose the listing records before their view
      // counters have finished syncing. Do not commit an all-zero response to
      // the UI immediately; retry while the counters are still warming up.
      let result: { items?: Array<{ id: number; title?: string; slug?: string; url?: string; site_view_count?: number; app_view_count?: number }> } = {};
      for (let attempt = 0; attempt < 5; attempt += 1) {
        result = await fetchOwnerListings({ data: { email, ...(identityToken ? { identityToken } : {}) } }) as typeof result;
        if (cancelled) return;
        const items = result.items ?? [];
        const hasAnyViews = items.some((item) =>
          Math.max(0, Number(item.site_view_count ?? 0) || 0) +
          Math.max(0, Number(item.app_view_count ?? 0) || 0) > 0
        );
        if (items.length === 0 || hasAnyViews || attempt === 4) break;
        await new Promise((resolve) => setTimeout(resolve, 1200));
      }
      if (cancelled) return;
      setOwnerListings((result.items ?? []).map((item) => ({
        id: item.id,
        wpId: item.id,
        slug: item.slug ?? String(item.id),
        title: item.title ?? "Untitled listing",
        url: item.url,
        siteViewCount: Math.max(0, Number(item.site_view_count ?? 0) || 0),
        appViewCount: Math.max(0, Number(item.app_view_count ?? 0) || 0),
      })));
    };
    void loadOwnerListingsWithCounters()
      .catch((reason) => { if (!cancelled) setOwnerContentError(reason instanceof Error ? reason.message : "Could not load owner listings."); })
      .finally(() => { if (!cancelled) { setOwnerContentLoading(false); setStatisticsReady(true); } });
    return () => { cancelled = true; };
  }, [email, identityToken, refreshKey]);

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
  }, [email, userId, refreshKey]);

  // Keep statistics in a loading state until either the dedicated owner-list
  // endpoint or the session's listing store has supplied view counters. The
  // owner endpoint can return an empty list before the session store hydrates.
  const statisticsDataLoading = isAdministrator ? (adminAllListingsLoading || (!adminAllListingsLoaded && !adminAllListingsError)) : (ownerContentLoading || (!ownerContentError && ownerListings.length === 0 && sessionListings.length === 0));

  const sessionListingsById = new Map(sessionListings.map((item) => [
    String(item.wpId ?? item.id ?? item.slug),
    item,
  ]));
  const sessionListingsBySlug = new Map(sessionListings.map((item) => [String(item.slug ?? ""), item]));
  const visibleOwnerListings = isAdministrator
    ? (adminAllListingsLoaded ? adminAllListings : adminListings).map((item) => ({
        id: item.id, wpId: item.id, slug: item.slug, title: item.title, url: item.url,
        siteViewCount: item.site_view_count ?? 0, appViewCount: item.app_view_count ?? 0,
      }))
    : ownerListings.length
      ? ownerListings.map((item) => {
          // The owner endpoint can briefly return stale zero counters while
          // the app session already has the current lifetime totals. Counters
          // are monotonic, so prefer the highest known value for each source.
          const sessionItem = sessionListingsById.get(String(item.wpId ?? item.id ?? item.slug))
            ?? sessionListingsBySlug.get(String(item.slug ?? ""));
          return {
            ...item,
            siteViewCount: Math.max(item.siteViewCount ?? 0, sessionItem?.siteViewCount ?? 0),
            appViewCount: Math.max(item.appViewCount ?? 0, sessionItem?.appViewCount ?? 0),
          };
        })
      : sessionListings.map((item) => ({
          id: item.wpId, wpId: item.wpId, slug: item.slug, title: item.name, url: item.siteUrl,
          siteViewCount: item.siteViewCount ?? 0, appViewCount: item.appViewCount ?? 0,
        }));
  useEffect(() => {
    if (!loggedIn || view !== "statistics") return;
    const ids = [...new Set(visibleOwnerListings.map((item) => Number(item.wpId ?? item.id)).filter((id) => Number.isInteger(id) && id > 0))].slice(0, 1000);
    if (!ids.length) {
      setDailyListingStats({});
      setDailyListingStatsLoading(false);
      return;
    }
    let cancelled = false;
    setDailyListingStatsLoading(true);
    setDailyListingStatsError("");
    void fetchWpDailyListingViewStats({ data: { ids } })
      .then((stats) => { if (!cancelled) setDailyListingStats(stats); })
      .catch((reason) => {
        if (!cancelled) {
          setDailyListingStats({});
          setDailyListingStatsError(reason instanceof Error ? reason.message : "Could not load dated listing analytics.");
        }
      })
      .finally(() => { if (!cancelled) setDailyListingStatsLoading(false); });
    return () => { cancelled = true; };
  }, [loggedIn, view, isAdministrator, adminAllListingsLoaded, adminAllListings, adminListings, ownerListings, sessionListings, refreshKey]);

  const listing = dashboard?.listings.find((item) => item.id === selectedListing) ?? visibleOwnerListings.find((item) => item.id === selectedListing);

  const sortedOwnerListings = [...visibleOwnerListings].sort((a, b) => {
    const siteA = a.siteViewCount ?? 0;
    const appA = a.appViewCount ?? 0;
    const siteB = b.siteViewCount ?? 0;
    const appB = b.appViewCount ?? 0;
    if (ownerViewsSort === "site-desc") return siteB - siteA || (appB - appA) || a.title.localeCompare(b.title);
    if (ownerViewsSort === "app-desc") return appB - appA || (siteB - siteA) || a.title.localeCompare(b.title);
    if (ownerViewsSort === "name-asc") return a.title.localeCompare(b.title);
    return (siteB + appB) - (siteA + appA) || a.title.localeCompare(b.title);
  });
  const ownerViewsPageCount = Math.max(1, Math.ceil(sortedOwnerListings.length / OWNER_VIEWS_PAGE_SIZE));
  const paginatedOwnerListings = sortedOwnerListings.slice((ownerViewsPage - 1) * OWNER_VIEWS_PAGE_SIZE, ownerViewsPage * OWNER_VIEWS_PAGE_SIZE);


  const activeView = view === "menu" ? "overview" : view;
  const totalBookings = (dashboard?.reservations.length ?? 0) + eventBookings.length + experienceBookings.length;
  const totalNotifications = ownerNotifications.length + ownerEventNotifications.length;
  const pendingBookings =
    (dashboard?.reservations.filter((item) => ["pending", "pending_review"].includes(item.status)).length ?? 0) +
    eventBookings.filter((item) => ["pending", "pending_payment"].includes(item.status ?? "")).length +
    experienceBookings.filter((item) => ["pending_review", "pending"].includes(item.status)).length;
  const unreadNotifications = ownerNotifications.filter((item) => !item.read_at).length + ownerEventNotifications.filter((item) => !item.read_at).length;

  const dashboardNav = [
    { key: "overview", label: "Overview", icon: ClipboardList, count: undefined, view: "menu" as const, bookingType: undefined, child: false },
    ...(isAdministrator ? [{ key: "admin-listings", label: "Admin: All Listings", icon: Settings2, count: adminListingsTotalCount || adminListings.length || undefined, view: "admin-listings" as const, bookingType: undefined, child: false }] : []),
    { key: "listings", label: "Listings", icon: Store, count: visibleOwnerListings.length || dashboard?.listings.length || 0, view: "listings" as const, bookingType: undefined, child: false },
    { key: "statistics", label: "Statistics", icon: ChartNoAxesCombined, count: undefined, view: "statistics" as const, bookingType: undefined, child: false },
    { key: "events", label: "Events", icon: CalendarDays, count: events.length, view: "events" as const, bookingType: undefined, child: false },
    { key: "experiences", label: "Experiences", icon: Ticket, count: experiences.length, view: "experiences" as const, bookingType: undefined, child: false },
    { key: "bookings", label: "Bookings", icon: ClipboardList, count: totalBookings, view: "bookings" as const, bookingType: undefined, child: false },
    { key: "table-reservations", label: "Table Reservations", icon: CalendarDays, count: dashboard?.reservations.length ?? 0, pendingCount: dashboard?.reservations.filter((reservation) => reservation.status === "pending").length ?? 0, view: "bookings" as const, bookingType: "table" as const, child: true },
    { key: "event-bookings", label: "Event Bookings", icon: CalendarDays, count: eventBookings.length, view: "bookings" as const, bookingType: "events" as const, child: true },
    { key: "experience-bookings", label: "Experience Bookings", icon: Ticket, count: experienceBookings.length, view: "bookings" as const, bookingType: "experiences" as const, child: true },
    { key: "notifications", label: "Notifications", icon: Bell, count: unreadNotifications, view: "notifications" as const, bookingType: undefined, child: false },
  ];

  return (
    <div className="xp-partner-shell">
      <header className="xp-partner-header">
        <Link to="/dashboard" search={{}} className="xp-partner-brand"><Logo /><span className="xp-partner-brand-label">PARTNER</span></Link>
        <div className="xp-partner-header-right">
          
          <a href="https://xplorepondy.com" target="_blank" rel="noreferrer" className="xp-partner-site-link"><ExternalLink className="size-4" /> View website</a>
          <Link to="/dashboard" search={{ view: "notifications" }} aria-label="View notifications" className="xp-partner-icon-button"><Bell className="size-5" />{unreadNotifications > 0 && <span className="xp-partner-notification-dot">{Math.min(unreadNotifications, 99)}</span>}</Link>
          <ThemeToggle />
          <HeaderAuth showSignOut={false} />
          {loggedIn && <button type="button" className="xp-partner-icon-button md:hidden" aria-label={mobileMenuOpen ? "Close navigation menu" : "Open navigation menu"} aria-expanded={mobileMenuOpen} aria-controls="xp-partner-mobile-menu" onClick={() => setMobileMenuOpen((open) => !open)}>{mobileMenuOpen ? <X className="size-5" /> : <Menu className="size-5" />}</button>}
        </div>
      </header>

      {loggedIn && mobileMenuOpen && (
        <>
        <button type="button" className="xp-partner-mobile-menu-backdrop md:hidden" aria-label="Close navigation menu" onClick={() => setMobileMenuOpen(false)} />
        <nav id="xp-partner-mobile-menu" aria-label="Mobile partner portal navigation" className="border-b border-border bg-card px-3 py-3 shadow-sm md:hidden">
          <div className="grid gap-1">
            {dashboardNav.map((item) => (
              <Link
                key={item.key}
                to="/dashboard"
                search={item.view === "menu" ? {} : { view: item.view, ...(item.bookingType ? { bookingType: item.bookingType } : {}) }}
                aria-current={item.bookingType ? activeView === "bookings" && searchBookingType === item.bookingType ? "page" : undefined : activeView === item.key ? "page" : undefined}
                onClick={() => setMobileMenuOpen(false)}
                className={"flex items-center gap-3 rounded-xl py-2 text-sm font-medium text-foreground transition hover:bg-muted aria-[current=page]:bg-primary/10 aria-[current=page]:text-primary " + (item.child ? "min-h-10 pl-10 pr-3 text-[13px]" : "min-h-11 px-3")}
              >
                <item.icon className="size-4 shrink-0" />
                <span className="flex-1">{item.label}</span>
                {item.count !== undefined && <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums">{item.count}</span>}{item.key === "table-reservations" && (item.pendingCount ?? 0) > 0 && <span className="rounded-full border border-amber-500/30 bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-500">{item.pendingCount} pending</span>}
              </Link>
            ))}
            <Link to="/qr-scan" onClick={() => setMobileMenuOpen(false)} className="flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-foreground transition hover:bg-muted">
              <QrCode className="size-4 shrink-0" /><span>Scan QR tickets</span>
            </Link>
            <Link to="/reservation-setup" search={{}} onClick={() => setMobileMenuOpen(false)} className="flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-foreground transition hover:bg-muted">
              <Settings2 className="size-4 shrink-0" /><span>Reservation setup</span>
            </Link>
            <button type="button" onClick={() => { setMobileMenuOpen(false); useSession.getState().clearSession(); if (authEnabled) { void signOut().catch(() => { window.location.href = "/login"; }); } else { window.location.href = "/login"; } }} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-medium text-foreground transition hover:bg-muted">
              <X className="size-4 shrink-0" /><span>Sign out</span>
            </button>
          </div>
        </nav>
        </>
      )}

      {!loggedIn ? (
        <main className="xp-partner-signed-out">
          <section className="xp-partner-welcome">
            <div className="xp-partner-eyebrow"><Store className="size-4" /> PARTNER WORKSPACE</div>
            <h1>Everything your business needs, in one place.</h1>
            <p>Manage listings, events, experiences, table reservations and bookings across Xplore Pondy.</p>
            <div className="xp-partner-welcome-actions"><Button asChild size="lg"><Link to="/login">Sign in to your partner account</Link></Button><a href="https://xplorepondy.com" target="_blank" rel="noreferrer">Explore Xplore Pondy ↗</a></div>
            <div className="xp-partner-feature-grid">
              <div><Store /><strong>Listings</strong><span>Keep business details and photos up to date.</span></div>
              <div><CalendarDays /><strong>Events</strong><span>Publish events and follow registrations.</span></div>
              <div><Ticket /><strong>Experiences</strong><span>Manage activities, requests and capacity.</span></div>
              <div><Bell /><strong>Bookings & alerts</strong><span>Respond to guest activity from one inbox.</span></div>
            </div>
          </section>
        </main>
      ) : (
        <div className="xp-partner-app-layout">
          <aside className="xp-partner-sidebar">
            <div className="xp-partner-sidebar-label">WORKSPACE</div>
            <nav aria-label="Partner portal navigation">
              {dashboardNav.map((item) => (
                <Link key={item.key} to="/dashboard" search={item.view === "menu" ? {} : { view: item.view, ...(item.bookingType ? { bookingType: item.bookingType } : {}) }} aria-current={item.bookingType ? activeView === "bookings" && searchBookingType === item.bookingType ? "page" : undefined : activeView === item.key ? "page" : undefined} className={"xp-partner-nav-link " + (item.child ? "ml-3 !min-h-10 !border-transparent !bg-transparent !pl-7 !text-sm hover:!bg-muted" : "")}>
                  <item.icon className="size-4" /><span>{item.label}</span>{item.count !== undefined && <span className="xp-partner-nav-count">{item.key === "table-reservations" && (item.pendingCount ?? 0) > 0 ? `${item.pendingCount} Pending (${item.count})` : item.count}</span>}
                </Link>
              ))}
              <Link to="/qr-scan" className="xp-partner-nav-link"><QrCode className="size-4" /><span>Scan QR tickets</span></Link>
              <Link to="/reservation-setup" search={{}} className="xp-partner-nav-link"><Settings2 className="size-4" /><span>Reservation setup</span></Link>
            </nav>
            <div className="xp-partner-sidebar-footer"><div className="xp-partner-online-dot" /> Connected to Xplore Pondy</div>
          </aside>

          <main className="xp-partner-main">
            <div className="xp-partner-page-heading">
              <div><div className="xp-partner-eyebrow">PARTNER WORKSPACE</div><h1>{activeView === "overview" ? "Welcome back" : activeView === "admin-listings" ? "Administrator — All Listings" : activeView === "listings" ? "My Listings" : activeView === "statistics" ? "Statistics" : activeView === "events" ? "Events" : activeView === "experiences" ? "Experiences" : activeView === "bookings" ? "Bookings & Reservations" : "Notifications"}</h1><p>{email ? `Signed in as ${email}` : "Manage your business across Xplore Pondy."}</p></div>
              <div className="xp-partner-page-actions"><span className="xp-partner-date">{new Date().toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" })}</span><Button variant="outline" size="sm" disabled={refreshing} onClick={() => { setRefreshing(true); setRefreshKey((key) => key + 1); toast.success("Refreshing dashboard data…"); window.setTimeout(() => setRefreshing(false), 900); }}><LoaderCircle className={`mr-2 size-4 ${refreshing ? "animate-spin" : ""}`} />{refreshing ? "Refreshing…" : "Refresh data"}</Button></div>
            </div>

            {activeView === "overview" && (
              <>
                <section className="xp-partner-welcome-strip">
                  
                  <div className="xp-partner-welcome-copy"><span className="xp-partner-welcome-tag">Xplore Pondy Partner</span><h2>Your business, beautifully managed.</h2><p>Keep your listings fresh, track customer activity and stay on top of new bookings.</p></div>
                </section>

                <section className="xp-partner-stats-grid" aria-label="Partner account summary">
                  {[
                    { label: "My Listings", view: "listings" as const, value: visibleOwnerListings.length || dashboard?.listings.length || 0, note: "Business profiles", icon: Store, color: "cyan" },
                    { label: "Active Events", view: "events" as const, value: events.filter((item) => item.status === "publish").length, note: `${events.length} total events`, icon: CalendarDays, color: "blue" },
                    { label: "Experiences", view: "experiences" as const, value: experiences.length, note: "Activities & tours", icon: Ticket, color: "amber" },
                    { label: "Total Bookings", view: "bookings" as const, value: totalBookings, note: `${pendingBookings} need attention`, icon: ClipboardList, color: "green" },
                  ].map((stat) => <Link to="/dashboard" search={{ view: stat.view }} className="xp-partner-stat-card transition hover:-translate-y-0.5 hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" key={stat.label} aria-label={`Open ${stat.label}`}><div className={`xp-partner-stat-icon ${stat.color}`}><stat.icon className="size-5" /></div><span className="xp-partner-stat-label">{stat.label}</span><strong>{loading || eventsLoading || experiencesLoading ? "…" : stat.value}</strong><span className="xp-partner-stat-note">{stat.note}</span></Link>)}
                </section>

                <section className="mt-5 rounded-2xl border border-border/70 bg-card p-4 sm:p-5" aria-label="Content views analytics">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div><h2 className="text-lg font-bold">Content views</h2><p className="mt-1 text-sm text-muted-foreground">Detail-page views for content you own across Xplore Pondy.</p></div>
                    <div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">All-time totals</span><Link to="/dashboard" search={{ view: "statistics" }} className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs font-semibold hover:bg-muted">Detailed statistics <ArrowLeft className="size-3.5 rotate-180" /></Link></div>
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    {[
                      { label: "Listing views", site: visibleOwnerListings.reduce((sum, item) => sum + (item.siteViewCount ?? 0), 0), app: visibleOwnerListings.reduce((sum, item) => sum + (item.appViewCount ?? 0), 0), icon: Store },
                      { label: "Event views", site: events.reduce((sum, item) => sum + (item.site_view_count ?? 0), 0), app: events.reduce((sum, item) => sum + (item.app_view_count ?? item.view_count ?? 0), 0), icon: CalendarDays },
                      { label: "Experience views", site: experiences.reduce((sum, item) => sum + (item.site_view_count ?? 0), 0), app: experiences.reduce((sum, item) => sum + (item.app_view_count ?? item.view_count ?? 0), 0), icon: Ticket },
                    ].map((item) => <article key={item.label} className="rounded-xl border border-border/70 bg-background p-4">
                      <div className="flex items-center gap-2 text-sm font-semibold"><item.icon className="size-4 text-primary" />{item.label}</div>
                      <div className="mt-3 grid grid-cols-2 gap-3">
                        <div><p className="text-[11px] leading-4 text-muted-foreground">xplorepondy.com</p><p className="mt-1 text-2xl font-bold tabular-nums">{item.site.toLocaleString("en-IN")}</p></div>
                        <div><p className="text-[11px] leading-4 text-muted-foreground">app.xplorepondy.com</p><p className="mt-1 text-2xl font-bold tabular-nums">{item.app.toLocaleString("en-IN")}</p></div>
                      </div>
                    </article>)}
                  </div>
                  <div className="mt-4 border-t border-border/70 pt-3">
                    <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-semibold">Your listings</h3><span className="text-xs text-muted-foreground">{visibleOwnerListings.length} listings</span></div><label className="flex items-center gap-2 text-xs text-muted-foreground">Sort by <select aria-label="Sort listings by views" value={ownerViewsSort} onChange={(event) => { setOwnerViewsSort(event.target.value as typeof ownerViewsSort); setOwnerViewsPage(1); }} className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"><option value="total-desc">Most total views</option><option value="site-desc">Most website views</option><option value="app-desc">Most app views</option><option value="name-asc">Listing name A–Z</option></select></label></div>
                    {isAdministrator && adminListingsLoading ? <p className="mt-3 text-sm text-muted-foreground">Loading all administrator listings…</p> : isAdministrator && adminListingsError ? <p role="alert" className="mt-3 rounded-lg border border-destructive/40 p-3 text-sm text-destructive">Administrator listing catalogue failed to load: {adminListingsError}. The dashboard will not substitute the partner-only 100-listing result.</p> : ownerContentLoading ? <p className="mt-3 text-sm text-muted-foreground">Loading listing views…</p> : ownerContentError ? <p className="mt-3 text-sm text-destructive">Listing views are unavailable: {ownerContentError}</p> : visibleOwnerListings.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">{isAdministrator ? "No administrator listings returned by WordPress yet." : "No owner listings found."}</p> : <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[580px] text-left text-sm"><thead className="bg-muted/50 text-xs text-muted-foreground"><tr><th className="px-3 py-2 font-semibold">Listing</th><th className="px-3 py-2 font-semibold">xplorepondy.com</th><th className="px-3 py-2 font-semibold">app.xplorepondy.com</th><th className="px-3 py-2 font-semibold">Total</th></tr></thead><tbody>{paginatedOwnerListings.map((item) => <tr key={item.wpId ?? item.id ?? item.slug} className="border-t border-border/70"><td className="max-w-[260px] px-3 py-3"><div className="truncate font-medium">{item.title}</div>{item.slug && <a href={`https://app.xplorepondy.com/place/${encodeURIComponent(item.slug)}`} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">View in app ↗</a>}</td><td className="px-3 py-3 tabular-nums">{(item.siteViewCount ?? 0).toLocaleString("en-IN")}</td><td className="px-3 py-3 tabular-nums">{(item.appViewCount ?? 0).toLocaleString("en-IN")}</td><td className="px-3 py-3 font-semibold tabular-nums">{((item.siteViewCount ?? 0) + (item.appViewCount ?? 0)).toLocaleString("en-IN")}</td></tr>)}</tbody></table>{visibleOwnerListings.length > 0 && <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground"><span>Showing {(ownerViewsPage - 1) * OWNER_VIEWS_PAGE_SIZE + 1}–{Math.min(ownerViewsPage * OWNER_VIEWS_PAGE_SIZE, sortedOwnerListings.length)} of {sortedOwnerListings.length} listings</span><div className="flex items-center gap-2"><button type="button" disabled={ownerViewsPage <= 1} onClick={() => setOwnerViewsPage((page) => Math.max(1, page - 1))} className="rounded-lg border border-border px-3 py-2 text-foreground disabled:cursor-not-allowed disabled:opacity-40">Previous</button><span>Page {ownerViewsPage} of {ownerViewsPageCount}</span><button type="button" disabled={ownerViewsPage >= ownerViewsPageCount} onClick={() => setOwnerViewsPage((page) => Math.min(ownerViewsPageCount, page + 1))} className="rounded-lg border border-border px-3 py-2 text-foreground disabled:cursor-not-allowed disabled:opacity-40">Next</button></div></div>}</div>}
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">Views are cumulative. Website and app totals use their respective counters. Event and experience site-specific counts display as 0 until the WordPress owner API returns that source counter.</p>
                </section>

                <section className="xp-partner-content-grid">
                  <article className="xp-partner-panel xp-partner-bookings-panel">
                    <div className="xp-partner-panel-header"><div><h2>Booking activity</h2><p>Current reservations and customer requests</p></div><Link to="/dashboard" search={{ view: "bookings" }} className="xp-partner-text-link">View all <ArrowLeft className="size-3.5 rotate-180" /></Link></div>
                    <div className="xp-partner-booking-summary">
                      <Link to="/dashboard" search={{ view: "bookings", bookingType: "table" }}><span className="xp-partner-booking-summary-icon"><CalendarDays /></span><span><strong>Table reservations</strong><small>Guest seating requests</small></span><b>{dashboard?.reservations.length ?? 0}</b></Link>
                      <Link to="/dashboard" search={{ view: "bookings", bookingType: "events" }}><span className="xp-partner-booking-summary-icon blue"><CalendarDays /></span><span><strong>Event bookings</strong><small>Ticket registrations</small></span><b>{eventBookings.length}</b></Link>
                      <Link to="/dashboard" search={{ view: "bookings", bookingType: "experiences" }}><span className="xp-partner-booking-summary-icon amber"><Ticket /></span><span><strong>Experience requests</strong><small>Activities & tours</small></span><b>{experienceBookings.length}</b></Link>
                    </div>
                    <div className="xp-partner-panel-footer"><span><strong>{pendingBookings}</strong> booking items may need a response.</span><Link to="/dashboard" search={{ view: "bookings" }} className="xp-partner-text-link">Manage bookings <ArrowLeft className="size-3.5 rotate-180" /></Link></div>
                  </article>

                  <article className="xp-partner-panel xp-partner-quick-actions">
                    <div className="xp-partner-panel-header"><div><h2>Quick actions</h2><p>Jump straight into common tasks</p></div></div>
                    <div className="xp-partner-quick-grid">
                      <Link to="/my-listings"><span className="quick-icon teal"><Store /></span><strong>Manage listings</strong><small>Edit details & photos</small></Link>
                      <Link to="/submit-event"><span className="quick-icon violet"><CalendarDays /></span><strong>Create event</strong><small>Promote what’s on</small></Link>
                      <Link to="/submit-experiences" search={{}}><span className="quick-icon orange"><Ticket /></span><strong>Add experience</strong><small>Publish an activity</small></Link>
                      <Link to="/dashboard" search={{ view: "listings" }}><span className="quick-icon green"><Settings2 /></span><strong>Table reservations</strong><small>Setup availability</small></Link>
                    </div>
                  </article>
                </section>

                <section className="mt-5 overflow-hidden rounded-2xl border border-border/80 bg-card">
                  <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-5">
                    <div><h2 className="text-lg font-bold">Recent bookings</h2><p className="mt-1 text-sm text-muted-foreground">Latest guest activity across your business</p></div>
                    <Link to="/dashboard" search={{ view: "bookings" }} className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline">View all bookings <ArrowLeft className="size-3.5 rotate-180" /></Link>
                  </div>
                  {loading ? (
                    <div className="flex items-center gap-2 px-5 py-8 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />Loading recent bookings…</div>
                  ) : (dashboard?.reservations.length ?? 0) === 0 ? (
                    <div className="px-5 py-8 text-sm text-muted-foreground">No table reservations yet. New guest bookings will appear here.</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[690px] border-collapse text-left">
                        <thead className="bg-muted/60 text-[11px] uppercase tracking-wide text-muted-foreground">
                          <tr><th className="px-5 py-3 font-semibold">Guest</th><th className="px-5 py-3 font-semibold">Service</th><th className="px-5 py-3 font-semibold">Date</th><th className="px-5 py-3 font-semibold">Guests</th><th className="px-5 py-3 font-semibold">Status</th></tr>
                        </thead>
                        <tbody>
                          {[...(dashboard?.reservations ?? [])].sort((a, b) => new Date(`${b.reservationDate}T${b.startTime || "00:00"}`).getTime() - new Date(`${a.reservationDate}T${a.startTime || "00:00"}`).getTime()).slice(0, 5).map((reservation) => {
                            const service = dashboard?.listings.find((item) => item.id === reservation.listingId)?.title ?? `Listing #${reservation.listingId}`;
                            const dateLabel = reservation.reservationDate ? new Date(`${reservation.reservationDate}T12:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "Date not set";
                            const status = String(reservation.status || "pending").replace(/[_-]/g, " ");
                            const statusClass = /confirm/.test(status) ? "bg-emerald-500/10 text-emerald-600" : /cancel/.test(status) ? "bg-red-500/10 text-red-600" : /complete|check.?in/.test(status) ? "bg-sky-500/10 text-sky-600" : "bg-amber-500/15 text-amber-700";
                            return <tr key={reservation.id} className="border-t border-border/70 text-sm">
                              <td className="px-5 py-3.5"><div className="font-semibold">{reservation.guestName || "Guest"}</div></td>
                              <td className="max-w-[260px] px-5 py-3.5"><span className="block truncate">{service}</span></td>
                              <td className="whitespace-nowrap px-5 py-3.5 text-xs text-muted-foreground">{dateLabel}, {reservation.startTime ? formatReservationTime(reservation.startTime) : "Time not set"}</td>
                              <td className="px-5 py-3.5">{reservation.guests}</td>
                              <td className="px-5 py-3.5"><span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold capitalize ${statusClass}`}>{status}</span></td>
                            </tr>;
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>

                <section className="xp-partner-content-grid secondary">
                  <article className="xp-partner-panel">
                    <div className="xp-partner-panel-header"><div><h2>Latest notifications</h2><p>Updates from your partner account</p></div><Link to="/dashboard" search={{ view: "notifications" }} className="xp-partner-text-link">View inbox <ArrowLeft className="size-3.5 rotate-180" /></Link></div>
                    {ownerNotificationsLoading ? <div className="xp-partner-empty"><LoaderCircle className="size-5 animate-spin" />Loading notifications…</div> : ownerNotificationsError ? <p role="alert" className="xp-partner-error">{ownerNotificationsError}</p> : totalNotifications === 0 ? <div className="xp-partner-empty"><Bell className="size-5" /><span>You’re all caught up. New booking alerts will appear here.</span></div> : <div className="xp-partner-notice-list">
                      {[...ownerEventNotifications.map((item) => ({ key: `event-${item.id}`, title: item.title, body: item.body, date: item.created_at, unread: !item.read_at, target: { view: "bookings" as const, bookingType: "events" as const, bookingId: Number(item.booking_id) || undefined } })), ...ownerNotifications.map((item) => ({ key: `notice-${item.id}`, title: item.title, body: item.body, date: item.created_at, unread: !item.read_at, target: { view: "notifications" as const } }))].slice(0, 4).map((item) => <Link key={item.key} to="/dashboard" search={item.target} className="xp-partner-notice"><span className={`xp-partner-notice-icon ${item.unread ? "unread" : ""}`}><Bell className="size-4" /></span><span className="min-w-0 flex-1"><strong>{item.title}</strong><span>{item.body}</span><small>{formatDisplayDateTime(item.date)}</small></span>{item.unread && <i aria-label="Unread" />}</Link>)}
                    </div>}
                  </article>

                  <article className="xp-partner-panel">
                    <div className="xp-partner-panel-header"><div><h2>Business health</h2><p>A few things to keep your profile working hard</p></div></div>
                    <div className="xp-partner-health"><span className="xp-partner-health-icon"><CheckCircle2 /></span><div><strong>Keep listings up to date</strong><p>Fresh photos and accurate hours help travelers choose your business.</p><Link to="/my-listings" className="xp-partner-text-link">Review listings <ArrowLeft className="size-3.5 rotate-180" /></Link></div></div>
                    <div className="xp-partner-health"><span className="xp-partner-health-icon amber"><Bell /></span><div><strong>Respond to guest requests</strong><p>{pendingBookings ? `${pendingBookings} items may need action.` : "You have no obvious pending items in the loaded booking data."}</p><Link to="/dashboard" search={{ view: "bookings" }} className="xp-partner-text-link">Open bookings <ArrowLeft className="size-3.5 rotate-180" /></Link></div></div>
                    <div className="xp-partner-health"><span className="xp-partner-health-icon blue"><Settings2 /></span><div><strong>Check table availability</strong><p>Make sure operating hours and capacity match your service.</p><Link to="/my-listings" className="xp-partner-text-link">Manage reservation settings <ArrowLeft className="size-3.5 rotate-180" /></Link></div></div>
                  </article>
                </section>
              </>
            )}

            {view === "statistics" && (() => {
              const selectedListings = statisticsListingFilter === "all"
                ? sortedOwnerListings
                : sortedOwnerListings.filter((item) => String(item.wpId ?? item.id ?? item.slug) === statisticsListingFilter);
              const totalSiteViews = selectedListings.reduce((sum, item) => sum + (item.siteViewCount ?? 0), 0);
              const totalAppViews = selectedListings.reduce((sum, item) => sum + (item.appViewCount ?? 0), 0);
              const rangeDays = statisticsTimeRange === "today" ? 1 : statisticsTimeRange === "7" ? 7 : statisticsTimeRange === "30" ? 30 : statisticsTimeRange === "90" ? 90 : statisticsTimeRange === "year" ? 365 : 0;
              const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
              const rangeStart = new Date();
              rangeStart.setHours(0, 0, 0, 0);
              if (rangeDays > 0) rangeStart.setDate(rangeStart.getDate() - (rangeDays - 1));
              const rangeStartKey = dateKey(rangeStart);
              const rangeEndKey = dateKey(new Date());
              const getListingRangeViews = (item: typeof selectedListings[number]) => {
                const id = Number(item.wpId ?? item.id);
                const daily = dailyListingStats[id]?.daily_app_views ?? {};
                if (statisticsTimeRange === "all") return Number(item.appViewCount ?? dailyListingStats[id]?.app_views ?? 0);
                return Object.entries(daily).reduce((sum, [day, row]) => day >= rangeStartKey && day <= rangeEndKey ? sum + row.app_views : sum, 0);
              };
              const periodAppViews = selectedListings.reduce((sum, item) => sum + getListingRangeViews(item), 0);
              const totalListingViews = statisticsTimeRange === "all" ? totalSiteViews + totalAppViews : periodAppViews;
              const totalEventSiteViews = events.reduce((sum, item) => sum + (item.site_view_count ?? 0), 0);
              const totalEventAppViews = events.reduce((sum, item) => sum + (item.app_view_count ?? item.view_count ?? 0), 0);
              const totalExperienceSiteViews = experiences.reduce((sum, item) => sum + (item.site_view_count ?? 0), 0);
              const totalExperienceAppViews = experiences.reduce((sum, item) => sum + (item.app_view_count ?? item.view_count ?? 0), 0);
              const topListings = [...selectedListings]
                .sort((a, b) => statisticsTimeRange === "all"
                  ? ((b.siteViewCount ?? 0) + (b.appViewCount ?? 0)) - ((a.siteViewCount ?? 0) + (a.appViewCount ?? 0))
                  : getListingRangeViews(b) - getListingRangeViews(a))
                .slice(0, 10);
              const maxListingViews = Math.max(1, ...topListings.map((item) => statisticsTimeRange === "all" ? (item.siteViewCount ?? 0) + (item.appViewCount ?? 0) : getListingRangeViews(item)));
              const metricCards = [
                { label: "Listing views", site: totalSiteViews, app: totalAppViews, icon: Store, color: "cyan" },
                { label: "Event views", site: totalEventSiteViews, app: totalEventAppViews, icon: CalendarDays, color: "blue" },
                { label: "Experience views", site: totalExperienceSiteViews, app: totalExperienceAppViews, icon: Ticket, color: "amber" },
              ];
              return <div className="mt-5 space-y-5">
                <section className="rounded-2xl border border-border/70 bg-card p-4 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div><div className="xp-partner-eyebrow">PERFORMANCE OVERVIEW</div><h2 className="mt-1 text-xl font-bold">Content statistics</h2><p className="mt-1 text-sm text-muted-foreground">Cumulative detail-page views across your Xplore Pondy content.</p></div>{isAdministrator && adminAllListingsError && <p role="alert" className="mt-2 text-sm text-destructive">Could not load all 932-directory statistics: {adminAllListingsError}. Displayed figures may reflect only the currently loaded admin page.</p>}
                    <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">All-time totals</span>
                  </div>
                  <div className="mt-4 flex flex-wrap items-end gap-4 rounded-xl bg-muted/40 p-3">
                    <div className="flex min-w-40 max-w-full flex-col gap-2 text-sm font-medium">
                      <label htmlFor="statistics-time-range">Time Range</label>
                      <select id="statistics-time-range" aria-label="Filter statistics by time range" value={statisticsTimeRange} onChange={(event) => setStatisticsTimeRange(event.target.value)} className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm font-normal">
                        <option value="today">Today</option>
                        <option value="7">Last 7 Days</option>
                        <option value="30">Last 30 Days</option>
                        <option value="90">Last 90 Days</option>
                        <option value="year">Last Year</option>
                        <option value="all">All Time</option>
                      </select>
                    </div>
                    <div className="relative flex min-w-64 max-w-full flex-col gap-2 text-sm font-medium">
                      <label id="statistics-listing-label">Filter by listing</label>
                      <button
                        type="button"
                        aria-labelledby="statistics-listing-label"
                        aria-haspopup="listbox"
                        aria-expanded={statisticsListingDropdownOpen}
                        onClick={() => setStatisticsListingDropdownOpen((open) => !open)}
                        className="flex h-10 w-full items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 text-left text-sm font-normal outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        <span className="truncate">{statisticsListingFilter === "all" ? "All listings" : sortedOwnerListings.find((item) => String(item.wpId ?? item.id ?? item.slug) === statisticsListingFilter)?.title ?? "All listings"}</span>
                        <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="size-4 shrink-0 text-muted-foreground"><path d="m5 7.5 5 5 5-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      </button>
                      {statisticsListingDropdownOpen && <div className="absolute left-0 top-full z-50 mt-1 w-full min-w-64 overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-2xl ring-1 ring-border/80">
                        <div className="border-b border-border bg-card p-2">
                          <input
                            autoFocus
                            id="statistics-listing-search"
                            type="search"
                            value={statisticsListingSearch}
                            onChange={(event) => setStatisticsListingSearch(event.target.value)}
                            placeholder="Search listings…"
                            aria-label="Search listings by name"
                            className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm font-normal outline-none focus-visible:ring-2 focus-visible:ring-primary"
                          />
                        </div>
                        <div role="listbox" aria-labelledby="statistics-listing-label" className="max-h-64 overflow-y-auto bg-card p-1">
                          <button type="button" role="option" aria-selected={statisticsListingFilter === "all"} onClick={() => { setStatisticsListingFilter("all"); setStatisticsListingDropdownOpen(false); setStatisticsListingSearch(""); }} className={`w-full rounded-md px-3 py-2.5 text-left text-sm font-normal hover:bg-muted ${statisticsListingFilter === "all" ? "bg-primary text-primary-foreground hover:bg-primary" : ""}`}>All listings</button>
                          {sortedOwnerListings
                            .filter((item) => item.title.toLocaleLowerCase().includes(statisticsListingSearch.trim().toLocaleLowerCase()))
                            .map((item) => {
                              const value = String(item.wpId ?? item.id ?? item.slug);
                              const selected = statisticsListingFilter === value;
                              return <button key={item.wpId ?? item.id ?? item.slug} type="button" role="option" aria-selected={selected} onClick={() => { setStatisticsListingFilter(value); setStatisticsListingDropdownOpen(false); setStatisticsListingSearch(""); }} className={`w-full rounded-md px-3 py-2.5 text-left text-sm font-normal hover:bg-muted ${selected ? "bg-primary text-primary-foreground hover:bg-primary" : ""}`}>{item.title}</button>;
                            })}
                          {sortedOwnerListings.filter((item) => item.title.toLocaleLowerCase().includes(statisticsListingSearch.trim().toLocaleLowerCase())).length === 0 && <p className="px-3 py-4 text-sm text-muted-foreground">No listings found.</p>}
                        </div>
                      </div>}
                    </div>
                    <span className="max-w-xl text-xs text-muted-foreground">{dailyListingStatsError ? dailyListingStatsError : statisticsTimeRange === "all" ? "Showing lifetime totals for website and app listing views." : "Date range filters app listing views using daily records. Website, event, experience and booking totals remain lifetime/current totals because historical daily records are not available for those metrics."}</span>
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <article className="rounded-xl border border-border/70 bg-background p-4"><div className="flex items-center gap-2 text-sm font-semibold"><span className="rounded-lg bg-primary/10 p-2 text-primary"><ChartNoAxesCombined className="size-4"/></span>Total listing views</div><p className="mt-3 text-3xl font-bold tabular-nums">{statisticsDataLoading || (statisticsTimeRange !== "all" && dailyListingStatsLoading) ? <span className="xp-skeleton inline-block h-9 w-24 rounded-md align-middle" aria-label="Loading total listing views" /> : totalListingViews.toLocaleString("en-IN")}</p><p className="mt-1 text-xs text-muted-foreground">{statisticsTimeRange === "all" ? "Website + app · lifetime" : "App views in selected period"}</p></article>
                    <article className="rounded-xl border border-border/70 bg-background p-4"><div className="flex items-center gap-2 text-sm font-semibold"><span className="rounded-lg bg-cyan-500/10 p-2 text-cyan-600"><Store className="size-4"/></span>Website listing views</div><p className="mt-3 text-3xl font-bold tabular-nums">{statisticsDataLoading ? <span className="xp-skeleton inline-block h-9 w-24 rounded-md align-middle" aria-label="Loading website listing views" /> : statisticsTimeRange === "all" ? totalSiteViews.toLocaleString("en-IN") : "—"}</p><p className="mt-1 text-xs text-muted-foreground">{statisticsTimeRange === "all" ? "xplorepondy.com · lifetime" : "Dated website tracking not available"}</p></article>
                    <article className="rounded-xl border border-border/70 bg-background p-4"><div className="flex items-center gap-2 text-sm font-semibold"><span className="rounded-lg bg-sky-500/10 p-2 text-sky-600"><ExternalLink className="size-4"/></span>App listing views</div><p className="mt-3 text-3xl font-bold tabular-nums">{statisticsDataLoading || (statisticsTimeRange !== "all" && dailyListingStatsLoading) ? <span className="xp-skeleton inline-block h-9 w-24 rounded-md align-middle" aria-label="Loading app listing views" /> : (statisticsTimeRange === "all" ? totalAppViews : periodAppViews).toLocaleString("en-IN")}</p><p className="mt-1 text-xs text-muted-foreground">{statisticsTimeRange === "all" ? "app.xplorepondy.com · lifetime" : "app.xplorepondy.com · selected period"}</p></article>
                    <article className="rounded-xl border border-border/70 bg-background p-4"><div className="flex items-center gap-2 text-sm font-semibold"><span className="rounded-lg bg-emerald-500/10 p-2 text-emerald-600"><CalendarDays className="size-4"/></span>Bookings</div><p className="mt-3 text-3xl font-bold tabular-nums">{totalBookings.toLocaleString("en-IN")}</p><p className="mt-1 text-xs text-muted-foreground">Current booking records</p></article>
                  </div>
                </section>
                <div className="grid gap-5 xl:grid-cols-2">
                  <section className="rounded-2xl border border-border/70 bg-card p-4 sm:p-5">
                    <div className="flex items-center justify-between gap-3"><div><h2 className="font-bold">Top listings by views</h2><p className="mt-1 text-xs text-muted-foreground">{statisticsTimeRange === "all" ? "Top 10 by combined lifetime views" : "Top 10 by app views in selected period"}</p></div><ChartNoAxesCombined className="size-5 text-primary"/></div>
                    {statisticsDataLoading || (statisticsTimeRange !== "all" && dailyListingStatsLoading) ? <div className="mt-5 space-y-5" role="status" aria-label="Loading top listing statistics">{Array.from({ length: 6 }, (_, index) => <div key={index} className="space-y-2"><div className="flex justify-between gap-3"><span className="xp-skeleton h-4 w-56 max-w-[75%] rounded" /><span className="xp-skeleton h-4 w-12 rounded" /></div><div className="xp-skeleton h-2 w-full rounded-full" /><span className="xp-skeleton block h-3 w-40 rounded" /></div>)}</div> : ownerContentError ? <p role="alert" className="mt-4 text-sm text-destructive">{ownerContentError}</p> : topListings.length === 0 ? <div className="mt-5 space-y-4" aria-label="No listing rows to display">{Array.from({ length: 3 }, (_, index) => <div key={index} className="space-y-2 opacity-60"><div className="flex justify-between gap-3"><span className="h-4 w-48 max-w-[75%] rounded bg-muted/70" /><span className="h-4 w-12 rounded bg-muted/70" /></div><div className="h-2 w-full rounded-full bg-muted/70" /><div className="h-3 w-40 rounded bg-muted/70" /></div>)}</div> : <div className="mt-5 space-y-4">{topListings.map((item, index) => { const site = item.siteViewCount ?? 0; const app = item.appViewCount ?? 0; const total = statisticsTimeRange === "all" ? site + app : getListingRangeViews(item); return <div key={item.wpId ?? item.id ?? item.slug} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1.5"><div className="truncate text-sm font-medium" title={item.title}>{index + 1}. {item.title}</div><div className="text-sm font-bold tabular-nums">{total.toLocaleString("en-IN")}</div><div className="col-span-2 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(total ? 1 : 0, total / maxListingViews * 100)}%` }}/></div><p className="col-span-2 text-[11px] text-muted-foreground">{statisticsTimeRange === "all" ? `Website ${site.toLocaleString("en-IN")} · App ${app.toLocaleString("en-IN")}` : `App views in period: ${total.toLocaleString("en-IN")}`}</p></div>; })}</div>}
                  </section>
                  <section className="rounded-2xl border border-border/70 bg-card p-4 sm:p-5">
                    <h2 className="font-bold">Content type breakdown</h2><p className="mt-1 text-xs text-muted-foreground">Lifetime view totals from available counters</p>
                    <div className="mt-4 space-y-3">{statisticsDataLoading ? Array.from({ length: 3 }, (_, index) => <article key={index} className="rounded-xl border border-border/70 bg-background p-3" aria-hidden="true"><div className="flex items-center gap-2"><span className="xp-skeleton h-4 w-32 rounded" /><span className="xp-skeleton ml-auto h-4 w-12 rounded" /></div><div className="mt-3 grid grid-cols-2 gap-3"><div><span className="xp-skeleton block h-3 w-28 rounded" /><span className="xp-skeleton mt-2 block h-6 w-16 rounded" /></div><div><span className="xp-skeleton block h-3 w-28 rounded" /><span className="xp-skeleton mt-2 block h-6 w-16 rounded" /></div></div></article>) : metricCards.map((item) => { const total = item.site + item.app; return <article key={item.label} className="rounded-xl border border-border/70 bg-background p-3"><div className="flex items-center gap-2 text-sm font-semibold"><item.icon className="size-4 text-primary"/>{item.label}<span className="ml-auto tabular-nums">{total.toLocaleString("en-IN")}</span></div><div className="mt-3 grid grid-cols-2 gap-3"><div><p className="text-xs text-muted-foreground">xplorepondy.com</p><p className="text-xl font-bold tabular-nums">{item.site.toLocaleString("en-IN")}</p></div><div><p className="text-xs text-muted-foreground">app.xplorepondy.com</p><p className="text-xl font-bold tabular-nums">{item.app.toLocaleString("en-IN")}</p></div></div></article>; })}</div>
                    <p className="mt-3 text-xs text-muted-foreground">Event and experience website counts depend on the counters returned by WordPress.</p>
                  </section>
                </div>
                <section className="rounded-2xl border border-border/70 bg-card p-4 sm:p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-bold">Listing performance details</h2><p className="mt-1 text-xs text-muted-foreground">{selectedListings.length} listings in this view</p></div><label className="flex items-center gap-2 text-xs text-muted-foreground">Sort by <select aria-label="Sort statistics table" value={ownerViewsSort} onChange={(event) => setOwnerViewsSort(event.target.value as typeof ownerViewsSort)} className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"><option value="total-desc">Most total views</option><option value="site-desc">Most website views</option><option value="app-desc">Most app views</option><option value="name-asc">Name A–Z</option></select></label></div>
                  {selectedListings.length === 0 ? <p className="mt-4 text-sm text-muted-foreground">No listings match this filter.</p> : <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[560px] text-left text-sm"><thead className="bg-muted/50 text-xs text-muted-foreground"><tr><th className="px-3 py-2">Listing</th><th className="px-3 py-2">Website</th><th className="px-3 py-2">App</th><th className="px-3 py-2">Total</th></tr></thead><tbody>{selectedListings.slice().sort((a,b) => { const av=(a.siteViewCount??0)+(a.appViewCount??0); const bv=(b.siteViewCount??0)+(b.appViewCount??0); return ownerViewsSort==="name-asc" ? a.title.localeCompare(b.title) : ownerViewsSort==="site-desc" ? (b.siteViewCount??0)-(a.siteViewCount??0) : ownerViewsSort==="app-desc" ? (b.appViewCount??0)-(a.appViewCount??0) : bv-av; }).slice(0,50).map((item) => <tr key={item.wpId ?? item.id ?? item.slug} className="border-t border-border/70"><td className="px-3 py-3"><div className="font-medium">{item.title}</div>{item.slug && <a href={`https://app.xplorepondy.com/place/${encodeURIComponent(item.slug)}`} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">View in app ↗</a>}</td><td className="px-3 py-3 tabular-nums">{(item.siteViewCount??0).toLocaleString("en-IN")}</td><td className="px-3 py-3 tabular-nums">{(item.appViewCount??0).toLocaleString("en-IN")}</td><td className="px-3 py-3 font-semibold tabular-nums">{((item.siteViewCount??0)+(item.appViewCount??0)).toLocaleString("en-IN")}</td></tr>)}</tbody></table></div>}
                </section>
              </div>;
            })()}

            {view === "bookings" && (
              <section className="mt-5">
                <div className="hidden md:block"><OwnerTicketScanner email={email} identityToken={identityToken ?? undefined} cameraRequest={cameraRequest} onCameraRequestHandled={() => setCameraRequest(false)} onTableCheckedIn={(id, checkedAt) => setDashboard((current) => current ? { ...current, reservations: current.reservations.map((reservation) => reservation.id === id ? { ...reservation, checkedIn: true, checkedInAt: checkedAt } : reservation) } : current)} /></div>
                {!searchBookingType && <div className="mt-2 grid grid-cols-3 gap-1.5 sm:mt-3 sm:gap-2">
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
                </div>}
                {bookingType === "table" && (
                  dashboard ? <OwnerBookings dashboard={dashboard} listings={visibleOwnerListings} email={email} selectedListing={selectedListing} targetReservationId={searchBookingType === "table" ? searchBookingId : undefined} onUpdated={(id, status) => setDashboard((current) => current ? { ...current, reservations: current.reservations.map((reservation) => reservation.id === id ? { ...reservation, status } : reservation) } : current)} /> : <p className="mt-4 text-sm text-muted-foreground">Loading table reservations…</p>
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
                    {experienceBookingsLoading ? <p className="text-sm text-muted-foreground">Loading experience bookings…</p> : experienceBookingError ? <p className="rounded-xl border border-destructive/30 p-3 text-sm text-destructive">{experienceBookingError}</p> : experienceBookings.length === 0 ? <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">No customer requests found for your experiences.</p> : experienceBookings.map((booking) => <ExperienceOwnerBookingCard key={booking.id} booking={booking} email={email} identityToken={identityToken ?? undefined} targetBookingId={searchBookingType === "experiences" ? searchBookingId : undefined} onUpdated={(id, status) => setExperienceBookings((current) => current.map((item) => item.id === id ? { ...item, status } : item))} />)}
                   </div>
                )}
              </section>
            )}

            {view === "admin-listings" && isAdministrator && (
              <section className="mt-5">
                <div className="xp-partner-panel-header"><div><h2>All directory listings</h2><p>Administrator access · {adminListingsTotalCount || adminListings.length} listings · Assign a WordPress owner after a claim or verified package purchase.</p></div></div>
                <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"><label className="block text-sm">Search listings<input value={adminListingSearch} onChange={(event) => { setAdminListingSearch(event.target.value); setAdminListingsPage(1); }} placeholder="Search title, slug or current owner email" className="mt-1 h-11 w-full rounded-xl border border-border bg-background px-3" /></label><label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm"><input type="checkbox" checked={adminReservationEnabledOnly} onChange={(event) => { setAdminReservationEnabledOnly(event.target.checked); setAdminListingsPage(1); }} className="size-4 accent-primary" /><span>Table reservation enabled only</span></label></div>
                {adminListingsLoading ? <p className="mt-4 text-sm text-muted-foreground">Loading all listings…</p> : adminListingsError ? <p role="alert" className="mt-4 text-sm text-destructive">{adminListingsError}</p> : <>{adminReservationEnabledOnly && adminReservationSettingsError && <p role="alert" className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">Could not load table reservation settings: {adminReservationSettingsError}. The enabled-only filter may be incomplete.</p>}<div className="mt-3 overflow-x-auto rounded-xl border border-border/70"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-muted/60"><tr><th className="p-3">Listing</th><th className="p-3">Current owner</th><th className="p-3">Views</th><th className="p-3">Assign owner</th></tr></thead><tbody>{adminListings.filter((item) => { const query = adminListingSearch.trim().toLowerCase(); const matchesQuery = !query || [item.title, item.slug, item.owner_email, item.owner_name].some((value) => String(value ?? "").toLowerCase().includes(query)); const reservationEnabled = item.table_reservation_enabled === true; return matchesQuery && (!adminReservationEnabledOnly || reservationEnabled); }).map((item) => <tr key={item.id} className="border-t border-border/70"><td className="p-3"><strong>{item.title}</strong><div className="text-xs text-muted-foreground">{item.status} · #{item.id}</div><a href={item.url} target="_blank" rel="noreferrer" className="text-xs text-primary">Open listing ↗</a><div className="mt-1 text-xs text-muted-foreground">Claim: {item.claim_status || "none"} · Package: {item.package_status || "none"}</div></td><td className="p-3">{item.owner_name || "Unassigned"}<div className="text-xs text-muted-foreground">{item.owner_email}</div></td><td className="p-3">{(item.site_view_count ?? 0) + (item.app_view_count ?? 0)}<div className="text-xs text-muted-foreground">Website {item.site_view_count ?? 0} · App {item.app_view_count ?? 0}</div></td><td className="p-3"><form className="flex gap-2" onSubmit={async (event) => { event.preventDefault(); const userEmail = (adminAssignmentEmails[item.id] ?? item.owner_email ?? "").trim(); if (!userEmail) { toast.error("Enter the partner's WordPress email."); return; } setAdminAssigningId(item.id); try { await assignAdminListing({ data: { email, ...(identityToken ? { identityToken } : {}), listingId: item.id, userEmail } }); setAdminListings((current) => current.map((row) => row.id === item.id ? { ...row, owner_email: userEmail, owner_name: userEmail, claim_status: "approved" } : row)); toast.success("Listing assigned. The partner's WordPress account now has the Owner role."); } catch (error) { toast.error(error instanceof Error ? error.message : "Could not assign listing."); } finally { setAdminAssigningId(null); } }}><input type="email" required aria-label={`Owner email for ${item.title}`} placeholder="partner@example.com" value={adminAssignmentEmails[item.id] ?? item.owner_email ?? ""} onChange={(event) => setAdminAssignmentEmails((current) => ({ ...current, [item.id]: event.target.value }))} className="h-9 min-w-0 w-48 rounded-lg border border-border bg-background px-2 text-xs" /><Button size="sm" type="submit" disabled={adminAssigningId === item.id}>{adminAssigningId === item.id ? "Saving…" : "Assign"}</Button></form></td></tr>)}</tbody></table></div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                    <p className="text-xs text-muted-foreground">Showing {adminListings.length ? ((adminListingsPage - 1) * ADMIN_LISTINGS_PAGE_SIZE) + 1 : 0}–{Math.min(adminListingsPage * ADMIN_LISTINGS_PAGE_SIZE, adminListingsTotalCount || adminListings.length)} of {adminListingsTotalCount || adminListings.length} listings</p>
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="outline" disabled={adminListingsLoading || adminListingsPage <= 1} onClick={() => setAdminListingsPage((page) => Math.max(1, page - 1))}><ChevronLeft className="mr-1 size-4"/>Previous</Button>
                      <span className="min-w-20 text-center text-xs tabular-nums text-muted-foreground">Page {adminListingsPage} of {adminListingsTotalPages}</span>
                      <Button size="sm" variant="outline" disabled={adminListingsLoading || adminListingsPage >= adminListingsTotalPages} onClick={() => setAdminListingsPage((page) => Math.min(adminListingsTotalPages, page + 1))}>Next<ChevronRight className="ml-1 size-4"/></Button>
                    </div>
                  </div>
                  {adminListingsLoading && <div role="status" aria-live="polite" className="mt-3 flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 p-3 text-sm"><span className="inline-block size-4 animate-spin rounded-full border-2 border-primary/30 border-t-primary"/><span>Loading page {adminListingsPage} of administrator listings…</span></div>}
                </>}
              </section>
            )}

            {view === "listings" && (
              <section className="mt-5">
                <div className="rounded-3xl bg-card p-4 ring-1 ring-border/70 sm:p-6">
                  <div className="flex items-center gap-3">
                    <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Store className="size-6" /></div>
                    <div><h2 className="font-display text-2xl font-semibold">Listing Owner</h2><p className="text-sm text-muted-foreground">Manage your directory listings and reservations.</p></div>
                  </div>

                  <OwnerListingsManager loggedIn={loggedIn} isAdministrator={isAdministrator} allowedListingIds={visibleOwnerListings.map((item) => Number(item.id ?? item.wpId)).filter((id) => Number.isFinite(id) && id > 0)} listingsResolved={!ownerContentLoading} email={email} identityToken={identityToken ?? undefined} />

                  {ownerContentLoading && <p className="mt-5 flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />Loading your listings…</p>}
                  {ownerContentError && <p role="alert" className="mt-4 rounded-xl border border-destructive/30 p-3 text-sm text-destructive">{ownerContentError}</p>}
                  {!ownerContentLoading && visibleOwnerListings.length === 0 && <div className="mt-5 rounded-2xl border border-dashed border-border p-6 text-center"><Store className="mx-auto size-8 text-muted-foreground" /><h3 className="mt-3 font-semibold">No listings found</h3><p className="mt-1 text-sm text-muted-foreground">No directory listings are currently attached to this account.</p></div>}

                  {!ownerContentLoading && visibleOwnerListings.length > 0 && <>
                    <div className="relative mt-6">
                      <label id="dashboard-owner-listing-label" className="block text-sm font-medium">Select listing</label>
                      <button
                        id="dashboard-owner-listing-select"
                        type="button"
                        aria-labelledby="dashboard-owner-listing-label"
                        aria-haspopup="listbox"
                        aria-expanded={dashboardListingDropdownOpen}
                        onClick={() => { setDashboardListingDropdownOpen((open) => !open); setDashboardListingSearch(""); }}
                        className="mt-2 flex h-11 w-full items-center justify-between gap-3 rounded-xl border border-border bg-background px-3 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        <span className="truncate">{selectedListing ? visibleOwnerListings.find((item) => Number(item.id ?? item.wpId) === selectedListing)?.title ?? "Select listing" : "All listings"}</span>
                        <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                      </button>
                      {dashboardListingDropdownOpen && <div className="absolute left-0 top-full z-50 mt-1 w-full overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-2xl ring-1 ring-border/80">
                        <div className="border-b border-border p-2">
                          <input
                            autoFocus
                            type="search"
                            value={dashboardListingSearch}
                            onChange={(event) => setDashboardListingSearch(event.target.value)}
                            placeholder="Search listings..."
                            aria-label="Search listings"
                            className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                          />
                        </div>
                        <div role="listbox" aria-labelledby="dashboard-owner-listing-label" className="max-h-64 overflow-y-auto p-1">
                          <button type="button" role="option" aria-selected={!selectedListing} onClick={() => { setSelectedListing(0); setDashboardListingDropdownOpen(false); setDashboardListingSearch(""); }} className={`w-full rounded-lg px-3 py-2.5 text-left text-sm hover:bg-muted ${!selectedListing ? "bg-primary text-primary-foreground hover:bg-primary" : ""}`}>All listings</button>
                          {visibleOwnerListings.filter((item) => item.title.toLocaleLowerCase().includes(dashboardListingSearch.trim().toLocaleLowerCase()) || String(item.id ?? item.wpId ?? "").includes(dashboardListingSearch.trim())).map((item) => {
                            const value = Number(item.id ?? item.wpId);
                            const selected = selectedListing === value;
                            return <button key={item.id ?? item.wpId ?? item.slug} type="button" role="option" aria-selected={selected} onClick={() => { setSelectedListing(value); setDashboardListingDropdownOpen(false); setDashboardListingSearch(""); }} className={`block w-full rounded-lg px-3 py-2.5 text-left text-sm hover:bg-muted ${selected ? "bg-primary text-primary-foreground hover:bg-primary" : ""}`}>{item.title}</button>;
                          })}
                          {visibleOwnerListings.filter((item) => item.title.toLocaleLowerCase().includes(dashboardListingSearch.trim().toLocaleLowerCase()) || String(item.id ?? item.wpId ?? "").includes(dashboardListingSearch.trim())).length === 0 && <p className="px-3 py-4 text-sm text-muted-foreground">No matching listings found.</p>}
                        </div>
                      </div>}
                    </div>
                    <div className="mt-5 grid gap-3 sm:grid-cols-2">
                      <Link to="/dashboard" search={selectedListing ? { view: "bookings", bookingType: "table", listingId: selectedListing } : { view: "bookings", bookingType: "table" }} className="group rounded-2xl border border-border/70 bg-background p-5 transition hover:border-primary/50 hover:bg-muted">
                        <CalendarDays className="size-6 text-primary" />
                        <h3 className="mt-3 font-display text-lg font-semibold">View Bookings</h3>
                        <p className="mt-1 text-sm text-muted-foreground">{selectedListing ? `View and manage reservations for ${visibleOwnerListings.find((item) => Number(item.id ?? item.wpId) === selectedListing)?.title ?? "the selected listing"}.` : "View and manage reservations across all your listings."}</p>
                        <span className="mt-4 inline-block text-sm font-medium text-primary group-hover:underline">Open bookings →</span>
                      </Link>
                      {selectedListing ? <Link to="/reservation-setup" search={{ listingId: selectedListing, listingTitle: visibleOwnerListings.find((item) => Number(item.id ?? item.wpId) === selectedListing)?.title, listingSlug: visibleOwnerListings.find((item) => Number(item.id ?? item.wpId) === selectedListing)?.slug }} className="group rounded-2xl border border-border/70 bg-background p-5 transition hover:border-primary/50 hover:bg-muted">
                        <Settings2 className="size-6 text-primary" />
                        <h3 className="mt-3 font-display text-lg font-semibold">Setup Reservations</h3>
                        <p className="mt-1 text-sm text-muted-foreground">Configure opening hours, slots, capacity and booking rules.</p>
                        <span className="mt-4 inline-block text-sm font-medium text-primary group-hover:underline">Open setup →</span>
                      </Link> : <div className="rounded-2xl border border-dashed border-border/70 bg-background/60 p-5">
                        <Settings2 className="size-6 text-muted-foreground" />
                        <h3 className="mt-3 font-display text-lg font-semibold">Setup Reservations</h3>
                        <p className="mt-1 text-sm text-muted-foreground">Select a specific listing above to configure its opening hours, slots, capacity and booking rules.</p>
                      </div>}
                    </div>
                    <div className="mt-4 text-sm">{(() => { const listing = visibleOwnerListings.find((item) => Number(item.id ?? item.wpId) === selectedListing) ?? visibleOwnerListings[0]; return listing?.url ? <a href={listing.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">View listing ↗</a> : listing?.slug ? <a href={`https://xplorepondy.com/listing/${listing.slug}/`} target="_blank" rel="noreferrer" className="text-primary hover:underline">View listing ↗</a> : null; })()}</div>
                  </>}
                </div>
              </section>
            )}

            {view === "events" && (
              <section className="mt-5"><div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-display text-xl font-semibold">My events</h2><p className="text-sm text-muted-foreground">Publish and update events, then manage registrations.</p></div><Button asChild size="sm"><Link to="/submit-event"><FilePlus2 className="mr-2 size-4" />Create event</Link></Button></div>{eventsLoading ? <p className="mt-4 text-sm text-muted-foreground">Loading events…</p> : events.length === 0 ? <div className="xp-partner-empty mt-4"><CalendarDays className="size-6" /><span>No events found yet. Create your first event to start promoting it.</span></div> : <div className="mt-3 space-y-2">{events.map((event) => <div key={event.id} className="flex flex-col gap-3 rounded-xl border border-border/70 bg-background p-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0 flex-1"><p className="truncate font-medium">{event.title}</p><p className="mt-1 text-xs text-muted-foreground">{event.start_datetime || "Date to be announced"} · {event.booking_count ?? 0} registrations</p></div><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-muted px-2 py-1 text-xs">{event.status || "Unknown"}</span><Button asChild size="sm" variant="outline"><Link to="/my-events/$eventId/edit" params={{ eventId: String(event.id) }}>Edit event</Link></Button>{event.url && event.status === "publish" && <Button asChild size="sm" variant="ghost"><a href={event.url} target="_blank" rel="noreferrer">View event <ExternalLink className="ml-1 size-3.5" /></a></Button>}</div></div>)}</div>}</section>
            )}

            {view === "experiences" && (
              <section className="mt-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="font-display text-xl font-semibold">My experiences</h2>
                    <p className="text-sm text-muted-foreground">Manage your activity listings and booking requests.</p>
                  </div>
                  <Button asChild size="sm">
                    <Link to="/submit-experiences" search={{}}>
                      <FilePlus2 className="mr-2 size-4" />
                      Add experience
                    </Link>
                  </Button>
                </div>
                {experiencesLoading ? (
                  <p className="mt-4 text-sm text-muted-foreground">Loading experiences…</p>
                ) : experiences.length === 0 ? (
                  <div className="xp-partner-empty mt-4">
                    <Ticket className="size-6" />
                    <span>No experiences found yet. Add your first activity or tour.</span>
                  </div>
                ) : (
                  <div className="mt-3 space-y-2">
                    {experiences.map((experience) => (
                      <div
                        key={experience.id}
                        className="flex flex-col gap-3 rounded-xl border border-border/70 bg-background p-3 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">{experience.title}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {experience.status} · Updated {experience.modified || "—"}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Button asChild variant="outline" size="sm">
                            <Link to="/my-experiences/$experienceId/edit" params={{ experienceId: String(experience.id) }}>
                              Edit experience
                            </Link>
                          </Button>
                          {experience.status === "publish" && experience.url ? (
                            <Button asChild variant="ghost" size="sm">
                              <a href={experience.url} target="_blank" rel="noreferrer">
                                View experience <ExternalLink className="ml-1 size-3.5" />
                              </a>
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}

            {view === "notifications" && (
              <section className="mt-5"><div className="xp-partner-panel-header"><div><h2>Notifications inbox</h2><p>Updates related to your events, experiences and table reservations.</p></div><Button variant="outline" size="sm" disabled={refreshing} onClick={() => { setRefreshing(true); setRefreshKey((key) => key + 1); toast.success("Refreshing notifications…"); window.setTimeout(() => setRefreshing(false), 900); }}>Refresh inbox</Button></div>{ownerNotificationsLoading ? <p className="mt-4 text-sm text-muted-foreground">Loading notifications…</p> : ownerNotificationsError ? <p role="alert" className="mt-4 text-sm text-destructive">{ownerNotificationsError}</p> : totalNotifications === 0 ? <div className="xp-partner-empty mt-4"><Bell className="size-6" /><span>No notifications yet. New booking and reservation updates will appear here.</span></div> : <div className="xp-partner-notice-list mt-3">{[...ownerEventNotifications.map((item) => ({ key: `event-${item.id}`, title: item.title, body: item.body, date: item.created_at, unread: !item.read_at, target: { view: "bookings" as const, bookingType: "events" as const } })), ...ownerNotifications.map((item) => ({ key: `notice-${item.id}`, title: item.title, body: item.body, date: item.created_at, unread: !item.read_at, target: { view: "bookings" as const, bookingType: "table" as const } }))].map((item) => <Link key={item.key} to="/dashboard" search={item.target} className="xp-partner-notice"><span className={`xp-partner-notice-icon ${item.unread ? "unread" : ""}`}><Bell className="size-4" /></span><span className="min-w-0 flex-1"><strong>{item.title}</strong><span>{item.body}</span><small>{formatDisplayDateTime(item.date)}</small></span>{item.unread && <i aria-label="Unread" />}</Link>)}</div>}</section>
            )}
          </main>
        </div>
      )}

      <nav aria-label="Owner dashboard navigation" className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] shadow-lg backdrop-blur-md md:hidden">
        <ul className="grid grid-cols-6">
          {[
            { key: "listings", label: "Listings", icon: Store, count: visibleOwnerListings.length || dashboard?.listings.length || 0 },
            { key: "statistics", label: "Stats", icon: ChartNoAxesCombined, count: undefined },
            { key: "events", label: "Events", icon: CalendarDays, count: events.length },
            { key: "experiences", label: "Experiences", icon: Ticket, count: experiences.length },
            { key: "bookings", label: "Bookings", icon: ClipboardList, count: totalBookings },
          ].map((item) => (
            <li key={item.key}>
              <Link to="/dashboard" search={{ view: item.key as "listings" | "events" | "experiences" | "bookings" | "statistics" }} aria-current={view === item.key ? "page" : undefined} className={`relative flex h-14 flex-col items-center justify-center gap-0.5 px-1 text-center text-[10px] font-medium transition-colors ${view === item.key ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`}>
                <item.icon className="size-5" /><span>{item.label}</span>
              </Link>
            </li>
          ))}
          <li><Link to="/qr-scan" aria-label="Scan QR tickets" className="flex h-14 flex-col items-center justify-center gap-0.5 px-1 text-[10px] font-medium text-muted-foreground hover:bg-primary/10 hover:text-primary"><QrCode className="size-5"/><span>QR Scan</span></Link></li>
        </ul>
      </nav>
    </div>
  );
}
