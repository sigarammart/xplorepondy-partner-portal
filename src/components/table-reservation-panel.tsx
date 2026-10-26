import { useEffect, useId, useMemo, useState } from "react";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";
import { CalendarDays, Clock3, Info, Loader2, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  createTableReservation,
  fetchTableReservationAvailability,
  fetchTableReservationPushKey,
  subscribeTableReservationFcm,
  subscribeTableReservationPush,
  unsubscribeTableReservationFcm,
  unsubscribeTableReservationPush,
  type TableReservationConfig,
  type TableReservationSlot,
} from "@/lib/wp-api";
import { cn } from "@/lib/utils";
import { useAppLoggedIn } from "@/lib/app-session";
import { useAuthModal } from "@/store/auth-modal";

import { getFcmDeviceToken, isFcmPushSubscription } from "@/lib/firebase-messaging";

type TableReservationPanelProps = {
  listingId: number;
  listingName: string;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  config: TableReservationConfig;
  initialName?: string;
  initialEmail?: string;
  initialPhone?: string;
};

type ReservationDate = {
  value: string;
  weekday: string;
  day: string;
  month: string;
};

function localDateValue() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return get("year") + "-" + get("month") + "-" + get("day");
}

function buildDates(days: number): ReservationDate[] {
  const today = localDateValue();
  const base = new Date(today + "T00:00:00+05:30");
  return Array.from({ length: Math.min(15, Math.max(0, days)) + 1 }, (_, index) => {
    const date = new Date(base);
    date.setDate(base.getDate() + index);
    const value = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
    const display = new Date(value + "T00:00:00");
    return {
      value,
      weekday: new Intl.DateTimeFormat("en-IN", { weekday: "short" }).format(display),
      day: new Intl.DateTimeFormat("en-IN", { day: "2-digit" }).format(display),
      month: new Intl.DateTimeFormat("en-IN", { month: "short" }).format(display),
    };
  });
}

function normalizeReservationPhone(value: string) {
  const trimmed = value.trim();
  const digits = trimmed.replace(/\\D/g, "");
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  if (trimmed.startsWith("+") && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  throw new Error("Enter a valid mobile number with country code.");
}

function formatTime(value: string) {
  const [hourText, minute] = value.split(":");
  const hour = Number(hourText);
  if (!Number.isFinite(hour)) return value;
  const suffix = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return displayHour + ":" + minute + " " + suffix;
}

function formatDate(value: string) {
  const date = new Date(value + "T00:00:00");
  return new Intl.DateTimeFormat("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

function decodeApplicationServerKey(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob(padded);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

async function saveLegacyPushSubscription(email: string, subscription: PushSubscription) {
  const serialized = subscription.toJSON();
  if (!serialized.endpoint || !serialized.keys?.p256dh || !serialized.keys?.auth) {
    throw new Error("The browser returned an incomplete push subscription.");
  }
  await subscribeTableReservationPush({
    data: {
      email,
      subscription: {
        endpoint: serialized.endpoint,
        expirationTime: serialized.expirationTime ?? null,
        keys: { p256dh: serialized.keys.p256dh, auth: serialized.keys.auth },
      },
    },
  });
}

async function registerFcmForAccount(email: string) {
  const registration = await navigator.serviceWorker.ready;
  const currentSubscription = await registration.pushManager.getSubscription();
  if (currentSubscription && !(await isFcmPushSubscription(currentSubscription))) {
    const oldEndpoint = currentSubscription.endpoint;
    const legacyKey = await fetchTableReservationPushKey();
    if (!legacyKey.enabled || !legacyKey.publicKey) {
      throw new Error("Push notifications could not be enabled because the existing subscription cannot be migrated.");
    }
    await unsubscribeTableReservationPush({ data: { email, endpoint: oldEndpoint } });
    await currentSubscription.unsubscribe();
    let device: Awaited<ReturnType<typeof getFcmDeviceToken>> | undefined;
    try {
      device = await getFcmDeviceToken();
      await subscribeTableReservationFcm({ data: { email, token: device.token, endpoint: device.endpoint } });
      return;
    } catch (error) {
      if (device) {
        try { await unsubscribeTableReservationFcm({ data: { email, token: device.token } }); } catch { /* best effort */ }
      }
      try {
        const restored = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: decodeApplicationServerKey(legacyKey.publicKey),
        });
        await saveLegacyPushSubscription(email, restored);
      } catch { /* best effort */ }
      throw error;
    }
  }
  const device = await getFcmDeviceToken();
  await subscribeTableReservationFcm({ data: { email, token: device.token, endpoint: device.endpoint } });
}

export function TableReservationButton({
  enabled,
  onOpen,
  className,
}: {
  enabled: boolean;
  onOpen: () => void;
  className?: string;
}) {
  const { loggedIn, isPending } = useAppLoggedIn();
  const showLogin = useAuthModal((s) => s.show);
  if (!enabled) return null;
  return (
    <Button
      type="button"
      className={className ?? "h-10 w-full font-bold"}
      disabled={isPending}
      onClick={() => {
        if (!loggedIn) {
          showLogin();
          return;
        }
        onOpen();
      }}
    >
      <CalendarDays />
      Reserve a Table
    </Button>
  );
}

export function TableReservationPanel({
  listingId,
  listingName,
  open,
  onOpen,
  onClose,
  config,
  initialName = "",
  initialEmail = "",
  initialPhone = "",
}: TableReservationPanelProps) {
  const { loggedIn, wpUser, grokUser } = useAppLoggedIn();
  const showLogin = useAuthModal((s) => s.show);
  const recaptchaContainerId = "xp-phone-recaptcha-" + useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const dates = useMemo(() => buildDates(Math.min(15, config.advanceDays)), [config.advanceDays]);
  const [selectedDate, setSelectedDate] = useState(dates[0]?.value ?? "");
  const [guests, setGuests] = useState(Math.max(config.minGuests, Math.min(2, config.maxGuests)));
  const [slots, setSlots] = useState<TableReservationSlot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<TableReservationSlot | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [pushEnabling, setPushEnabling] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<Awaited<ReturnType<typeof createTableReservation>> | null>(null);
  const [details, setDetails] = useState({
    name: initialName,
    email: initialEmail,
    phone: initialPhone,
    mobilePushConsent: false,
    notes: "",
  });

  useEffect(() => {
    if (!open) return;
    setSelectedDate(dates[0]?.value ?? "");
    setGuests(Math.max(config.minGuests, Math.min(2, config.maxGuests)));
    setSelectedSlot(null);
    setSuccess(null);
    setError("");
    setDetails({
      name: wpUser?.name || grokUser?.displayName || initialName,
      email: wpUser?.email || grokUser?.primaryEmail || initialEmail,
      phone: wpUser?.phone || initialPhone,
      mobilePushConsent: false,
      notes: "",
    });
  }, [open, listingId, wpUser?.name, wpUser?.email, wpUser?.phone, grokUser?.displayName, grokUser?.primaryEmail, initialName, initialEmail, initialPhone]);

  useEffect(() => {
    if (!open || !selectedDate) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    setSelectedSlot(null);
    void fetchTableReservationAvailability({
      data: { listingId, date: selectedDate, guests },
    })
      .then((result) => {
        if (!cancelled) setSlots(result.slots);
      })
      .catch((reason) => {
        if (!cancelled) {
          setSlots([]);
          setError(reason instanceof Error ? reason.message : "Unable to load available times.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, listingId, selectedDate, guests]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  async function enableReservationPush() {
    const email = details.email.trim().toLowerCase();
    if (!email) {
      setDetails((current) => ({ ...current, mobilePushConsent: false }));
      toast.error("Enter your email before enabling reservation notifications.");
      return;
    }
    if (!("serviceWorker" in navigator) || !("Notification" in window)) {
      setDetails((current) => ({ ...current, mobilePushConsent: false }));
      toast.error("Push notifications are not supported in this browser. You can still reserve a table.");
      return;
    }
    setPushEnabling(true);
    try {
      const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
      if (permission !== "granted") {
        setDetails((current) => ({ ...current, mobilePushConsent: false }));
        toast.error("Notification permission was not granted. You can still reserve a table.");
        return;
      }
      await registerFcmForAccount(email);
      localStorage.removeItem("xp-fcm-disabled");
      setDetails((current) => ({ ...current, mobilePushConsent: true }));
      toast.success("Reservation updates enabled on this device.");
    } catch (reason) {
      setDetails((current) => ({ ...current, mobilePushConsent: false }));
      toast.error(reason instanceof Error ? reason.message : "Could not enable reservation notifications.");
    } finally {
      setPushEnabling(false);
    }
  }

  async function submit() {
    if (submitting) return;
    if (!loggedIn) {
      showLogin();
      return;
    }
    if (!selectedSlot) {
      setError("Please select an available time.");
      return;
    }
    if (!details.name.trim() || !details.email.trim() || !details.phone.trim()) {
      setError("Please enter your name, email and phone number.");
      return;
    }
    let normalizedPhone = "";
    try { normalizedPhone = normalizeReservationPhone(details.phone); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Enter a valid mobile number."); return; }
    setSubmitting(true);
    setError("");
    try {
      const result = await createTableReservation({
        data: {
          listingId,
          date: selectedDate,
          startTime: selectedSlot.startTime,
          endTime: selectedSlot.endTime,
          guests,
          guestName: details.name.trim(),
          guestEmail: details.email.trim(),
          guestPhone: normalizedPhone,
          mobilePushConsent: details.mobilePushConsent,
          notes: details.notes.trim(),
        },
      });
      setSuccess(result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not create your reservation.");
      setSelectedSlot(null);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[200] bg-black/65 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-label={"Reserve a table at " + listingName}>
      <div className="flex h-[100dvh] w-full flex-col overflow-hidden bg-background sm:mx-auto sm:my-5 sm:h-[calc(100dvh-2.5rem)] sm:max-w-2xl sm:rounded-2xl sm:shadow-2xl">
        <header className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3.5 sm:px-5">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Table reservation</p>
            <h2 className="truncate font-display text-lg font-semibold">{listingName}</h2>
          </div>
          <button type="button" onClick={onClose} className="grid size-9 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground hover:bg-muted/80" aria-label="Close reservation">
            <X className="size-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {success ? (
            <div className="flex min-h-full flex-col items-center justify-center px-5 py-14 text-center">
              <div className="grid size-16 place-items-center rounded-full bg-primary/12 text-primary text-2xl">✓</div>
              <h3 className="mt-5 font-display text-2xl font-semibold">Reservation confirmed</h3>
              <p className="mt-2 max-w-sm text-sm text-muted-foreground">Your table has been reserved at {listingName}.</p>
              <div className="mt-6 w-full max-w-sm rounded-xl bg-card p-4 text-left ring-1 ring-border">
                <p className="text-xs text-muted-foreground">Booking ID</p>
                <p className="font-semibold font-mono">#{String(999 + success.id).padStart(4, "0")}</p>
                <div className="mt-3 grid gap-2 text-sm">
                  <div><span className="text-muted-foreground">Date:</span> {formatDate(success.reservationDate)}</div>
                  <div><span className="text-muted-foreground">Time:</span> {formatTime(success.startTime)} – {formatTime(success.endTime)}</div>
                  <div><span className="text-muted-foreground">Party:</span> {success.guests} {success.guests === 1 ? "guest" : "guests"}</div>
                  <div><span className="text-muted-foreground">Status:</span> <span className="font-medium">{success.status}</span></div>
                </div>
              </div>
              <Button className="mt-6 rounded-full px-7" onClick={onClose}>Done</Button>
              <Link
                to="/account"
                search={{ tab: "reservations" }}
                className="mt-3 text-sm font-medium text-primary hover:underline"
              >
                View your recent reservations
              </Link>
            </div>
          ) : (
            <div className="mx-auto w-full max-w-xl px-4 py-5 sm:px-6 sm:py-7">
              <section className="rounded-xl border border-border bg-muted/35 p-4">
                <div className="flex gap-3">
                  <Info className="mt-0.5 size-5 shrink-0 text-primary" />
                  <div>
                    <h3 className="text-sm font-semibold">Before you book</h3>
                    <ul className="mt-2 space-y-1 text-xs leading-relaxed text-muted-foreground">
                      <li>• Reservations are available for the next {Math.min(15, config.advanceDays)} days.</li>
                      <li>• Availability depends on the restaurant's table capacity.</li>
                      <li>• Your reservation is confirmed only after successful booking.</li>
                      <li>• If your plans change, please cancel in advance.</li>
                    </ul>
                  </div>
                </div>
              </section>

              <section className="mt-5">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">Choose date</h3>
                  <span className="text-xs text-muted-foreground">{dates.length} dates</span>
                </div>
                <div
                  className="mt-2 flex gap-2 overflow-x-auto pb-2 cursor-grab active:cursor-grabbing [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted-foreground/40 [&::-webkit-scrollbar-track]:bg-transparent"
                  onWheel={(event) => {
                    if (event.deltaY !== 0 && Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
                      event.currentTarget.scrollLeft += event.deltaY;
                      event.preventDefault();
                    }
                  }}
                >
                  {dates.map((date) => (
                    <button
                      key={date.value}
                      type="button"
                      onClick={() => setSelectedDate(date.value)}
                      className={cn(
                        "min-w-[68px] shrink-0 rounded-xl border px-2 py-2 text-center transition",
                        selectedDate === date.value ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:border-primary/50",
                      )}
                    >
                      <span className="block text-[10px] font-semibold uppercase opacity-75">{date.weekday}</span>
                      <span className="mt-0.5 block text-lg font-bold leading-none">{date.day}</span>
                      <span className="mt-0.5 block text-[10px] opacity-75">{date.month}</span>
                    </button>
                  ))}
                </div>
              </section>

              <section className="mt-5">
                <label className="flex items-center justify-between text-sm font-semibold" htmlFor="xp-table-guests">
                  <span className="flex items-center gap-2"><Users className="size-4 text-primary" />Guests</span>
                  <select
                    id="xp-table-guests"
                    value={guests}
                    onChange={(event) => setGuests(Number(event.target.value))}
                    className="rounded-lg border border-border bg-card px-3 py-2 text-sm"
                  >
                    {Array.from({ length: config.maxGuests - config.minGuests + 1 }, (_, index) => config.minGuests + index).map((count) => (
                      <option key={count} value={count}>{count} {count === 1 ? "guest" : "guests"}</option>
                    ))}
                  </select>
                </label>
              </section>

              <section className="mt-5">
                <div className="flex items-center justify-between">
                  <h3 className="flex items-center gap-2 text-sm font-semibold"><Clock3 className="size-4 text-primary" />Available times</h3>
                  {loading && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
                </div>
                {error && <p className="mt-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}
                {!loading && !error && slots.length === 0 && <p className="mt-2 rounded-lg bg-muted px-3 py-3 text-xs text-muted-foreground">No available times for this date and guest count.</p>}
                {slots.length > 0 && (
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {slots.map((slot) => (
                      <button
                        key={slot.id}
                        type="button"
                        onClick={() => setSelectedSlot(slot)}
                        className={cn(
                          "rounded-xl border px-3 py-3 text-left transition",
                          selectedSlot?.id === slot.id ? "border-primary bg-primary/8 ring-1 ring-primary" : "border-border bg-card hover:border-primary/50",
                        )}
                      >
                        <span className="block text-sm font-semibold">{formatTime(slot.startTime)} – {formatTime(slot.endTime)}</span>
                        <span className="mt-1 block text-[11px] text-muted-foreground">{slot.remaining} guests remaining</span>
                      </button>
                    ))}
                  </div>
                )}
              </section>

              <section className="mt-6 border-t border-border pt-5">
                <h3 className="text-sm font-semibold">Your details</h3>
                <div className="mt-3 grid gap-3">
                  <input className="h-11 rounded-lg border border-border bg-background px-3 text-sm" placeholder="Name" value={details.name} onChange={(event) => setDetails((v) => ({ ...v, name: event.target.value }))} />
                  <label className="block text-sm">
                    <span className="mb-1.5 block font-medium">Mobile number</span>
                    <input className="h-11 w-full rounded-lg border border-border bg-background px-3 text-sm" type="tel" autoComplete="tel" placeholder="+91 98765 43210" value={details.phone} onChange={(event) => {
                      const phone = event.target.value;
                      setDetails((v) => ({ ...v, phone }));
                                  clearReservationPhoneOtp();
                    }} />
                  </label>
                  <p className="text-xs text-muted-foreground">SMS verification is temporarily optional while our company billing account is being configured.</p>
                  <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border bg-background px-3 py-3 text-sm">
                    <input
                      type="checkbox"
                      className="mt-0.5 size-4 shrink-0 accent-primary"
                      checked={details.mobilePushConsent}
                      disabled={pushEnabling}
                      onChange={(event) => {
                        if (event.target.checked) void enableReservationPush();
                        else setDetails((v) => ({ ...v, mobilePushConsent: false }));
                      }}
                    />
                    <span className="min-w-0">
                      <span className="block font-medium">Send reservation updates to my mobile device</span>
                      <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                        Optional. Mobile push requires notification permission and a registered device. You can opt out at any time.
                      </span>
                    </span>
                  </label>
                  <input className="h-11 rounded-lg border border-border bg-background px-3 text-sm" type="email" placeholder="Email" value={details.email} onChange={(event) => setDetails((v) => ({ ...v, email: event.target.value }))} />
                  <textarea className="min-h-20 rounded-lg border border-border bg-background px-3 py-2 text-sm" placeholder="Notes (optional)" value={details.notes} onChange={(event) => setDetails((v) => ({ ...v, notes: event.target.value }))} />
                </div>
              </section>

              <Button
                type="button"
                disabled={submitting}
                onClick={() => void submit()}
                className="mt-5 h-11 w-full rounded-full bg-primary font-bold text-primary-foreground opacity-100 hover:bg-primary/90"
              >
                {submitting ? <><Loader2 className="animate-spin" /> Reserving…</> : "Reserve a Table"}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}