import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, LoaderCircle, MapPin, Plus, Search, ShieldCheck, Trash2, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { useAppLoggedIn } from "@/lib/app-session";
import { fetchEventCategories, searchEventPlaces, submitEventFromApp, type EventCategoryOption, type EventPlaceOption, type NewEventPayload } from "@/lib/events-api";
import { useSession } from "@/store/session";

export const Route = createFileRoute("/submit-event")({ component: SubmitEventPage });

type TicketDraft = { name: string; price: string; quantity: string; min_per_order: string; max_per_order: string };
type FormDraft = {
  title: string; description: string; start_datetime: string; end_datetime: string;
  venue_name: string; venue_address: string; venue_listing_id: number; venue_latitude: number | null; venue_longitude: number | null;
  event_mode: "in_person" | "online" | "hybrid"; ticketing_mode: "free" | "paid" | "external"; category_id: number; capacity: string;
  organizer_name: string; organizer_email: string; organizer_phone: string; things_to_know: string; terms_and_conditions: string;
};
const blankTicket = (): TicketDraft => ({ name: "General", price: "0", quantity: "1", min_per_order: "1", max_per_order: "10" });
const localDateTime = () => {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
};
function readImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Could not read the selected image."));
    reader.onerror = () => reject(new Error("Could not read the selected image."));
    reader.readAsDataURL(file);
  });
}

function SubmitEventPage() {
  const { loggedIn, wpUser, grokUser } = useAppLoggedIn();
  const identityToken = useSession((state) => state.wpIdentityToken);
  const sessionEmail = useSession((state) => state.user?.email ?? "");
  const email = (grokUser?.primaryEmail || wpUser?.email || sessionEmail).trim().toLowerCase();
  const displayName = String(grokUser?.displayName || wpUser?.name || "");
  const [step, setStep] = useState(1);
  const [categories, setCategories] = useState<EventCategoryOption[]>([]);
  const [placeQuery, setPlaceQuery] = useState("");
  const [places, setPlaces] = useState<EventPlaceOption[]>([]);
  const [placeLoading, setPlaceLoading] = useState(false);
  const [selectedPlace, setSelectedPlace] = useState<EventPlaceOption | null>(null);
  const [tickets, setTickets] = useState<TicketDraft[]>([blankTicket()]);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [galleryFiles, setGalleryFiles] = useState<File[]>([]);
  const [loadingCategories, setLoadingCategories] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [draft, setDraft] = useState<FormDraft>({
    title: "", description: "", start_datetime: "", end_datetime: "",
    venue_name: "", venue_address: "", venue_listing_id: 0, venue_latitude: null, venue_longitude: null,
    event_mode: "in_person", ticketing_mode: "free", category_id: 0, capacity: "0",
    organizer_name: displayName, organizer_email: email, organizer_phone: "", things_to_know: "", terms_and_conditions: "",
  });

  useEffect(() => {
    let active = true;
    if (!loggedIn || !email) { setLoadingCategories(false); return; }
    fetchEventCategories({ data: { email, identityToken: identityToken ?? undefined } })
      .then((result) => { if (active) setCategories(result.items ?? []); })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Could not load event categories."); })
      .finally(() => { if (active) setLoadingCategories(false); });
    return () => { active = false; };
  }, [loggedIn, email, identityToken]);

  useEffect(() => {
    setDraft((current) => ({
      ...current,
      organizer_name: current.organizer_name || displayName,
      organizer_email: current.organizer_email || email,
    }));
  }, [displayName, email]);

  function setField<K extends keyof FormDraft>(key: K, value: FormDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function findPlaces() {
    if (placeQuery.trim().length < 2) { setPlaces([]); return; }
    setPlaceLoading(true);
    setError("");
    try {
      const result = await searchEventPlaces({ data: { email, identityToken: identityToken ?? undefined, query: placeQuery.trim() } });
      setPlaces(result.items ?? []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not search Places.");
    } finally {
      setPlaceLoading(false);
    }
  }

  function choosePlace(place: EventPlaceOption) {
    setSelectedPlace(place);
    setField("venue_name", place.title);
    setField("venue_address", place.address || "");
    setField("venue_listing_id", place.id);
    setField("venue_latitude", place.latitude);
    setField("venue_longitude", place.longitude);
    setPlaces([]);
    setPlaceQuery(place.title);
  }

  function clearPlace() {
    setSelectedPlace(null);
    setField("venue_listing_id", 0);
    setField("venue_latitude", null);
    setField("venue_longitude", null);
    setPlaceQuery("");
  }

  function updateTicket(index: number, key: keyof TicketDraft, value: string) {
    setTickets((current) => current.map((ticket, i) => i === index ? { ...ticket, [key]: value } : ticket));
  }

  function validStep(target: number) {
    const panel = document.querySelector<HTMLElement>(`[data-submit-step="${target}"]`);
    if (!panel) return true;
    const fields = Array.from(panel.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input, textarea, select"));
    for (const field of fields) {
      if (field.disabled || field.type === "file" || field.type === "button" || field.type === "search") continue;
      if (!field.checkValidity()) {
        setStep(target);
        window.setTimeout(() => { field.reportValidity(); field.focus(); }, 0);
        return false;
      }
    }
    if (target === 1 && draft.start_datetime && draft.end_datetime && draft.end_datetime <= draft.start_datetime) {
      setStep(1);
      setError("The event end date and time must be after its start.");
      return false;
    }
    if (target === 2 && draft.venue_listing_id && selectedPlace && selectedPlace.id !== draft.venue_listing_id) {
      setError("Please reselect the Place or clear the Place link.");
      return false;
    }
    return true;
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setSuccess("");
    for (const target of [1, 2, 3]) {
      if (!validStep(target)) return;
    }
    if (galleryFiles.length > 8) { setError("Please choose no more than 8 gallery images."); setStep(1); return; }
    const images = [coverFile, ...galleryFiles].filter((file): file is File => Boolean(file));
    if (images.some((file) => file.size > 3 * 1024 * 1024)) {
      setError("Each event image must be 3 MB or smaller. Please resize larger images and try again.");
      setStep(1);
      return;
    }
    if (images.reduce((total, file) => total + file.size, 0) > 12 * 1024 * 1024) {
      setError("Please keep the combined size of your event images under 12 MB so the upload completes reliably.");
      setStep(1);
      return;
    }
    setSaving(true);
    try {
      const coverImageData = coverFile ? await readImage(coverFile) : undefined;
      const galleryImageData = await Promise.all(galleryFiles.map(async (file) => ({ data: await readImage(file), name: file.name })));
      const payload: NewEventPayload = {
        title: draft.title.trim(),
        description: draft.description.trim(),
        start_datetime: draft.start_datetime,
        end_datetime: draft.end_datetime,
        venue_name: draft.venue_name.trim(),
        venue_address: draft.venue_address.trim(),
        venue_listing_id: draft.venue_listing_id,
        venue_latitude: draft.venue_latitude,
        venue_longitude: draft.venue_longitude,
        event_mode: draft.event_mode,
        ticketing_mode: draft.ticketing_mode,
        category_id: draft.category_id,
        capacity: Math.max(0, Number(draft.capacity) || 0),
        organizer_name: draft.organizer_name.trim(),
        organizer_email: draft.organizer_email.trim(),
        organizer_phone: draft.organizer_phone.trim(),
        things_to_know: draft.things_to_know,
        terms_and_conditions: draft.terms_and_conditions,
        ticket_types: tickets.map((ticket) => ({
          name: ticket.name.trim(),
          price: Math.max(0, Number(ticket.price) || 0),
          quantity: Math.max(1, Number(ticket.quantity) || 1),
          min_per_order: Math.max(1, Number(ticket.min_per_order) || 1),
          max_per_order: Math.max(Math.max(1, Number(ticket.min_per_order) || 1), Number(ticket.max_per_order) || 10),
        })),
        ...(coverImageData ? { cover_image_data: coverImageData, cover_image_name: coverFile?.name } : {}),
        ...(galleryImageData.length ? { gallery_images: galleryImageData } : {}),
      };
      const result = await submitEventFromApp({ data: { email, identityToken: identityToken ?? undefined, event: payload } });
      setSuccess(result.message);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Your event could not be submitted. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const fieldClass = "mt-1.5 w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20";
  const labelClass = "block text-sm font-medium";
  const minDate = localDateTime();

  return (
    <main className="mx-auto max-w-4xl px-1 py-5 sm:py-8">
      <Link to="/my-events" className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> My Events</Link>
      <header className="mt-5">
        <p className="text-xs font-bold uppercase tracking-[.16em] text-primary">Event dashboard</p>
        <h1 className="mt-1 font-display text-3xl font-semibold sm:text-4xl">Submit an event</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Share your event with Pondicherry visitors. Your submission will be reviewed by the Xplore Pondy team before it goes live.</p>
      </header>

      {!loggedIn ? (
        <section className="mt-6 rounded-2xl border border-border bg-card p-6 text-center">
          <CalendarDays className="mx-auto size-9 text-primary" /><h2 className="mt-3 font-semibold">Sign in to submit an event</h2>
          <p className="mt-1 text-sm text-muted-foreground">Sign in to manage your event submissions and registration details.</p>
          <Button className="mt-4" asChild><Link to="/login">Sign in</Link></Button>
        </section>
      ) : success ? (
        <section className="mt-6 rounded-2xl border border-emerald-500/30 bg-card p-6 sm:p-8">
          <CheckCircle2 className="size-10 text-emerald-600" /><h2 className="mt-3 font-display text-2xl font-semibold">Event submitted successfully</h2>
          <p className="mt-2 text-sm text-muted-foreground">{success}</p>
          <div className="mt-5 flex flex-wrap gap-3"><Button asChild><Link to="/my-events">View My Events</Link></Button><Button variant="outline" onClick={() => window.location.reload()}>Submit another event</Button></div>
        </section>
      ) : (
        <>
          {error && <div role="alert" className="mt-5 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm">{error}</div>}
          {loadingCategories && <div className="mt-5 flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" /> Loading event categories…</div>}
          <div className="mt-6 grid grid-cols-3 gap-2 sm:gap-3">
            {[
              ["1", "Event details"], ["2", "Tickets"], ["3", "Policies & organiser"],
            ].map(([number, label], index) => {
              const n = index + 1;
              return <button key={number} type="button" onClick={() => { if (n < step || validStep(step)) setStep(n); }} className={`flex items-center gap-2 rounded-xl border px-2 py-3 text-left text-xs transition sm:px-4 sm:text-sm ${step === n ? "border-primary bg-primary/5 text-primary" : step > n ? "border-emerald-500/40 bg-emerald-500/5" : "border-border text-muted-foreground"}`}><span className="flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold">{step > n ? <CheckCircle2 className="size-4" /> : number}</span><span className="font-medium">{label}</span></button>;
            })}
          </div>

          <form noValidate onSubmit={handleSubmit} className="mt-4 space-y-5 rounded-2xl border border-border bg-card p-4 shadow-soft sm:p-6">
            <section data-submit-step="1" hidden={step !== 1} className="space-y-5">
              <div><h2 className="font-display text-xl font-semibold">Event details</h2><p className="mt-1 text-sm text-muted-foreground">Tell visitors what your event is about and when it takes place.</p></div>
              <div><label className={labelClass} htmlFor="event-title">Event title *</label><input id="event-title" className={fieldClass} required maxLength={180} value={draft.title} onChange={(e) => setField("title", e.target.value)} placeholder="e.g. Heritage Music Night" /></div>
              <div><label className={labelClass} htmlFor="event-description">Event description *</label><textarea id="event-description" className={fieldClass} required rows={6} maxLength={20000} value={draft.description} onChange={(e) => setField("description", e.target.value)} placeholder="Describe the event, highlights and what visitors can expect…" /></div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div><label className={labelClass} htmlFor="event-start">Start date and time *</label><input id="event-start" type="datetime-local" min={minDate} className={fieldClass} required value={draft.start_datetime} onChange={(e) => setField("start_datetime", e.target.value)} /></div>
                <div><label className={labelClass} htmlFor="event-end">End date and time *</label><input id="event-end" type="datetime-local" min={draft.start_datetime || minDate} className={fieldClass} required value={draft.end_datetime} onChange={(e) => setField("end_datetime", e.target.value)} /></div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div><label className={labelClass} htmlFor="event-category">Event category</label><select id="event-category" className={fieldClass} value={draft.category_id} onChange={(e) => setField("category_id", Number(e.target.value))}><option value={0}>Choose a category</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></div>
                <div><label className={labelClass} htmlFor="event-capacity">Capacity (0 = unlimited)</label><input id="event-capacity" type="number" min={0} step={1} className={fieldClass} value={draft.capacity} onChange={(e) => setField("capacity", e.target.value)} /></div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div><label className={labelClass} htmlFor="event-mode">Event format</label><select id="event-mode" className={fieldClass} value={draft.event_mode} onChange={(e) => setField("event_mode", e.target.value as FormDraft["event_mode"])}><option value="in_person">In person</option><option value="online">Online</option><option value="hybrid">Hybrid</option></select></div>
                <div><label className={labelClass} htmlFor="event-cover">Event cover image</label><input id="event-cover" type="file" accept="image/jpeg,image/png,image/webp,image/gif" className={fieldClass} onChange={(e) => setCoverFile(e.target.files?.[0] ?? null)} /><p className="mt-1 text-xs text-muted-foreground">JPEG, PNG, WebP or GIF · max 3 MB</p></div>
              </div>
              <div><label className={labelClass} htmlFor="event-gallery">Gallery images</label><input id="event-gallery" type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif" className={fieldClass} onChange={(e) => setGalleryFiles(Array.from(e.target.files ?? []).slice(0, 8))} /><p className="mt-1 text-xs text-muted-foreground">Up to 8 images, each max 3 MB {galleryFiles.length ? `· ${galleryFiles.length} selected` : ""}</p></div>
              <div className="flex justify-end"><Button type="button" onClick={() => { if (validStep(1)) setStep(2); }}>Next: Tickets <ChevronRight className="ml-2 size-4" /></Button></div>
            </section>

            <section data-submit-step="2" hidden={step !== 2} className="space-y-5">
              <div><h2 className="font-display text-xl font-semibold">Venue and tickets</h2><p className="mt-1 text-sm text-muted-foreground">Link an existing Place to connect your event to Xplore Pondy’s directory, or enter the venue manually.</p></div>
              <div className="rounded-xl border border-border p-4">
                <label className={labelClass} htmlFor="place-search">Find an existing Place</label>
                <div className="mt-1.5 flex gap-2"><input id="place-search" className={fieldClass + " mt-0"} value={placeQuery} onChange={(e) => setPlaceQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void findPlaces(); } }} placeholder="Search places, cafés, venues…" /><Button type="button" variant="outline" disabled={placeLoading || placeQuery.trim().length < 2} onClick={() => void findPlaces()}>{placeLoading ? <LoaderCircle className="size-4 animate-spin" /> : <Search className="size-4" />}<span className="ml-2 hidden sm:inline">Search</span></Button></div>
                {places.length > 0 && <div className="mt-2 divide-y rounded-xl border border-border">{places.map((place) => <button type="button" key={place.id} onClick={() => choosePlace(place)} className="flex w-full items-start gap-3 p-3 text-left hover:bg-muted/60">{place.image ? <img src={place.image} alt="" className="size-12 rounded-lg object-cover" /> : <MapPin className="mt-1 size-5 shrink-0 text-primary" />}<span className="min-w-0"><strong className="block text-sm">{place.title}</strong><span className="mt-0.5 block text-xs text-muted-foreground">{place.address || "Address not listed"}</span></span></button>)}</div>}
                {selectedPlace && <p className="mt-3 flex items-center gap-2 text-sm text-emerald-700"><CheckCircle2 className="size-4" /> Linked to {selectedPlace.title}<button type="button" onClick={clearPlace} className="ml-auto underline">Unlink</button></p>}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div><label className={labelClass} htmlFor="venue-name">Venue name *</label><input id="venue-name" className={fieldClass} required maxLength={180} value={draft.venue_name} onChange={(e) => { setField("venue_name", e.target.value); if (selectedPlace && e.target.value !== selectedPlace.title) clearPlace(); }} placeholder="Enter venue name" /></div>
                <div><label className={labelClass} htmlFor="venue-address">Venue address</label><input id="venue-address" className={fieldClass} maxLength={250} value={draft.venue_address} onChange={(e) => setField("venue_address", e.target.value)} placeholder="Street, area, city" /></div>
              </div>
              <div className="border-t border-border pt-4">
                <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-semibold">Ticket types</h3><p className="mt-1 text-xs text-muted-foreground">Paid checkout is not enabled yet; paid-ticket settings can be saved for review.</p></div><Button type="button" variant="outline" size="sm" disabled={tickets.length >= 20} onClick={() => setTickets((current) => [...current, { ...blankTicket(), name: "" }])}><Plus className="mr-1 size-4" /> Add ticket</Button></div>
                <div className="mt-3 max-w-sm"><label className={labelClass} htmlFor="ticketing-mode">Registration mode</label><select id="ticketing-mode" className={fieldClass} value={draft.ticketing_mode} onChange={(e) => setField("ticketing_mode", e.target.value as FormDraft["ticketing_mode"])}><option value="free">Free registration</option><option value="paid">Paid tickets</option><option value="external">External registration</option></select></div>
              <div className="mt-3 space-y-3">{tickets.map((ticket, index) => <div key={index} className="rounded-xl border border-border p-3">
                  <div className="mb-3 flex items-center justify-between"><span className="text-sm font-semibold">Ticket type {index + 1}</span><Button type="button" variant="ghost" size="sm" disabled={tickets.length === 1} onClick={() => setTickets((current) => current.filter((_, i) => i !== index))}><Trash2 className="mr-1 size-3.5" /> Remove</Button></div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div><label className={labelClass}>Ticket name *</label><input className={fieldClass} required maxLength={100} value={ticket.name} onChange={(e) => updateTicket(index, "name", e.target.value)} /></div>
                    <div><label className={labelClass}>Price (INR ₹)</label><input className={fieldClass} type="number" min={0} step="0.01" required value={ticket.price} onChange={(e) => updateTicket(index, "price", e.target.value)} /></div>
                    <div><label className={labelClass}>Quantity offered *</label><input className={fieldClass} type="number" min={1} step={1} required value={ticket.quantity} onChange={(e) => updateTicket(index, "quantity", e.target.value)} /></div>
                    <div><label className={labelClass}>Minimum per order</label><input className={fieldClass} type="number" min={1} max={100} value={ticket.min_per_order} onChange={(e) => updateTicket(index, "min_per_order", e.target.value)} /></div>
                    <div><label className={labelClass}>Maximum per order</label><input className={fieldClass} type="number" min={1} max={100} value={ticket.max_per_order} onChange={(e) => updateTicket(index, "max_per_order", e.target.value)} /></div>
                  </div>
                </div>)}</div>
              </div>
              <div className="flex flex-wrap justify-between gap-3"><Button type="button" variant="outline" onClick={() => setStep(1)}><ChevronLeft className="mr-2 size-4" /> Back</Button><Button type="button" onClick={() => { if (validStep(2)) setStep(3); }}>Next: Policies & organiser <ChevronRight className="ml-2 size-4" /></Button></div>
            </section>

            <section data-submit-step="3" hidden={step !== 3} className="space-y-5">
              <div><h2 className="font-display text-xl font-semibold">Policies and organiser</h2><p className="mt-1 text-sm text-muted-foreground">Give visitors the key details they need before attending.</p></div>
              <div><label className={labelClass} htmlFor="event-rules">Things to know <span className="font-normal text-muted-foreground">(one item per line)</span></label><textarea id="event-rules" className={fieldClass} rows={4} value={draft.things_to_know} onChange={(e) => setField("things_to_know", e.target.value)} placeholder={"Age restrictions\nEntry requirements\nWhat to bring"} /></div>
              <div><label className={labelClass} htmlFor="event-terms">Terms and conditions <span className="font-normal text-muted-foreground">(one term per line)</span></label><textarea id="event-terms" className={fieldClass} rows={4} value={draft.terms_and_conditions} onChange={(e) => setField("terms_and_conditions", e.target.value)} placeholder={"Tickets are subject to venue rules.\nPlease arrive before the event starts."} /></div>
              <div className="border-t border-border pt-4"><h3 className="font-semibold">Organiser information</h3><div className="mt-3 grid gap-4 sm:grid-cols-2">
                <div><label className={labelClass} htmlFor="organizer-name">Organiser name *</label><input id="organizer-name" className={fieldClass} required maxLength={180} value={draft.organizer_name} onChange={(e) => setField("organizer_name", e.target.value)} /></div>
                <div><label className={labelClass} htmlFor="organizer-email">Organiser email *</label><input id="organizer-email" type="email" className={fieldClass} required maxLength={254} value={draft.organizer_email} onChange={(e) => setField("organizer_email", e.target.value)} /></div>
                <div><label className={labelClass} htmlFor="organizer-phone">Organiser phone</label><input id="organizer-phone" type="tel" className={fieldClass} maxLength={40} value={draft.organizer_phone} onChange={(e) => setField("organizer_phone", e.target.value)} /></div>
              </div></div>
              <div className="rounded-xl border border-border bg-muted/40 p-4 text-sm text-muted-foreground"><ShieldCheck className="mr-2 inline size-4" />Your event will be saved as Pending review. The Xplore Pondy team must approve it before it appears publicly. Paid checkout is not enabled yet.</div>
              <div className="flex flex-wrap justify-between gap-3"><Button type="button" variant="outline" onClick={() => setStep(2)}><ChevronLeft className="mr-2 size-4" /> Back</Button><Button type="submit" disabled={saving || loadingCategories}>{saving ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : <Upload className="mr-2 size-4" />}{saving ? "Submitting event…" : "Submit event for review"}</Button></div>
            </section>
          </form>
        </>
      )}
    </main>
  );
}
