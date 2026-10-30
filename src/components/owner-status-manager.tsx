import { useEffect, useState } from "react";
import { Camera, Clock3, Eye, LoaderCircle, Send, Video } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { fetchOwnerStatuses, publishOwnerStatus, type OwnerStatus } from "@/lib/status-api";

type ListingOption = { id?: number; wpId?: number; title: string; slug?: string };
type Props = { email: string; identityToken?: string; listings: ListingOption[] };

const allowedTypes = ["image/jpeg", "image/png", "image/webp", "video/mp4"];

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the selected file."));
    reader.onload = () => {
      const value = String(reader.result ?? "");
      const comma = value.indexOf(",");
      if (comma < 0) reject(new Error("Invalid file data."));
      else resolve(value.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
}

export function OwnerStatusManager({ email, identityToken, listings }: Props) {
  const [statuses, setStatuses] = useState<OwnerStatus[]>([]);
  const [listingId, setListingId] = useState("");
  const [caption, setCaption] = useState("");
  const [ctaType, setCtaType] = useState<"listing" | "directions" | "call">("listing");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState("");

  const options = listings.map((listing) => ({
    id: Number(listing.wpId ?? listing.id),
    title: listing.title,
  })).filter((item) => Number.isSafeInteger(item.id) && item.id > 0);

  async function refresh() {
    try {
      const rows = await fetchOwnerStatuses({ data: { email, identityToken } });
      setStatuses(rows);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load your statuses.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, [email, identityToken]);

  async function publish() {
    if (!listingId) { setError("Select the listing this status belongs to."); return; }
    if (!file) { setError("Choose a photo or video to publish."); return; }
    if (!allowedTypes.includes(file.type)) { setError("Use a JPG, PNG, WebP image or MP4 video."); return; }
    if (file.size > 8 * 1024 * 1024) { setError("Please keep each upload under 8 MB."); return; }
    setPublishing(true); setError("");
    try {
      const base64 = await fileToBase64(file);
      await publishOwnerStatus({
        data: {
          email, identityToken, listingId: Number(listingId),
          fileName: file.name, mimeType: file.type as "image/jpeg" | "image/png" | "image/webp" | "video/mp4",
          base64, caption, ctaType,
        },
      });
      setCaption(""); setFile(null);
      const input = document.getElementById("xp-status-file") as HTMLInputElement | null;
      if (input) input.value = "";
      toast.success("Your status is now live for 24 hours.");
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not publish this status.");
    } finally {
      setPublishing(false);
    }
  }

  return (
    <section className="mt-5 space-y-5">
      <div className="rounded-2xl border border-border/70 bg-card p-4 sm:p-6">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-primary/10 p-3 text-primary"><Camera className="size-6" /></div>
          <div><h2 className="text-xl font-semibold">Publish a status</h2><p className="mt-1 text-sm text-muted-foreground">Share offers, new photos and business updates. Statuses disappear after 24 hours.</p></div>
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-medium">Publish for listing
            <select value={listingId} onChange={(event) => setListingId(event.target.value)} className="mt-1.5 h-11 w-full rounded-xl border border-border bg-background px-3">
              <option value="">Select your listing</option>
              {options.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
            </select>
          </label>
          <label className="block text-sm font-medium">Photo or video
            <input id="xp-status-file" type="file" accept="image/jpeg,image/png,image/webp,video/mp4" onChange={(event) => setFile(event.target.files?.[0] ?? null)} className="mt-1.5 block min-h-11 w-full rounded-xl border border-border bg-background p-2 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-primary/10 file:px-3 file:py-1.5 file:font-semibold file:text-primary" />
            <span className="mt-1 block text-xs text-muted-foreground">JPG, PNG, WebP or MP4 · maximum 8 MB</span>
          </label>
        </div>
        <label className="mt-4 block text-sm font-medium">Caption / offer details
          <textarea value={caption} onChange={(event) => setCaption(event.target.value.slice(0, 500))} rows={3} maxLength={500} placeholder="Tell visitors what's new…" className="mt-1.5 w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm" />
          <span className="mt-1 block text-right text-xs text-muted-foreground">{caption.length}/500</span>
        </label>
        <label className="mt-3 block text-sm font-medium">Action button
          <select value={ctaType} onChange={(event) => setCtaType(event.target.value as typeof ctaType)} className="mt-1.5 h-11 w-full rounded-xl border border-border bg-background px-3 sm:max-w-sm">
            <option value="listing">View Listing</option><option value="directions">Get Directions</option><option value="call">Call Now</option>
          </select>
        </label>
        {file && <div className="mt-3 flex items-center gap-2 rounded-xl bg-muted/50 p-3 text-sm"><Video className="size-4 text-primary" /><span className="min-w-0 flex-1 truncate">{file.name}</span><span className="text-xs text-muted-foreground">{(file.size / 1024 / 1024).toFixed(1)} MB</span></div>}
        {error && <p role="alert" className="mt-3 rounded-lg border border-destructive/30 p-3 text-sm text-destructive">{error}</p>}
        <Button className="mt-4" disabled={publishing || options.length === 0} onClick={() => void publish()}>
          {publishing ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : <Send className="mr-2 size-4" />}
          {publishing ? "Publishing…" : "Publish Status"}
        </Button>
        <p className="mt-2 text-xs text-muted-foreground">You can have up to 10 active statuses at a time.</p>
      </div>

      <div className="rounded-2xl border border-border/70 bg-card p-4 sm:p-6">
        <div className="flex items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">Your active statuses</h2><p className="text-sm text-muted-foreground">Live updates from your listings</p></div><span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">{statuses.length}/10 active</span></div>
        {loading ? <p className="mt-5 flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />Loading statuses…</p>
          : statuses.length === 0 ? <p className="mt-5 rounded-xl bg-muted/40 p-5 text-center text-sm text-muted-foreground">You haven't published any statuses yet.</p>
          : <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{statuses.map((status) => <article key={status.id} className="overflow-hidden rounded-xl border border-border/70">
              {status.media_type === "video" ? <video src={status.media_url} className="h-44 w-full bg-black object-cover" muted playsInline /> : <img src={status.thumbnail_url || status.media_url} alt={status.caption || status.listing_name} className="h-44 w-full object-cover" />}
              <div className="p-3"><p className="truncate text-sm font-semibold">{status.listing_name}</p>{status.caption && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{status.caption}</p>}
                <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground"><span className="flex items-center gap-1"><Eye className="size-3.5" />{status.views} views</span><span className="flex items-center gap-1"><Clock3 className="size-3.5" />Expires {new Date(status.expires_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span></div>
              </div>
            </article>)}</div>}
      </div>
    </section>
  );
}
