import { useEffect, useMemo, useState } from "react";
import { LoaderCircle, ShieldCheck, UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  addListingModerator,
  fetchListingModerators,
  removeListingModerator,
  type ListingModerator,
} from "@/lib/listing-moderators";

type ListingOption = { id?: number; wpId?: number; title: string };

export function ListingModeratorsManager({
  email,
  identityToken,
  listings,
}: {
  email: string;
  identityToken?: string;
  listings: ListingOption[];
}) {
  const [moderators, setModerators] = useState<ListingModerator[]>([]);
  const [selectedListing, setSelectedListing] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [removingKey, setRemovingKey] = useState("");
  const [error, setError] = useState("");

  const options = useMemo(
    () => listings
      .map((listing) => ({ id: Number(listing.wpId ?? listing.id), title: listing.title }))
      .filter((item) => Number.isSafeInteger(item.id) && item.id > 0),
    [listings],
  );

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const result = await fetchListingModerators({ data: { email, identityToken } });
      setModerators(Array.isArray(result?.items) ? result.items as ListingModerator[] : []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load Listing Moderators.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, [email, identityToken]);

  async function add() {
    const listingId = Number(selectedListing);
    const cleanEmail = userEmail.trim().toLowerCase();
    if (!listingId) { setError("Select a listing first."); return; }
    if (!cleanEmail) { setError("Enter the moderator's email address."); return; }

    setSaving(true);
    setError("");
    try {
      await addListingModerator({ data: { email, identityToken, listingId, userEmail: cleanEmail } });
      setUserEmail("");
      toast.success("Listing Moderator added.");
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not add the Listing Moderator.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(moderator: ListingModerator) {
    const key = `${moderator.listing_id}:${moderator.user_email}`;
    setRemovingKey(key);
    setError("");
    try {
      await removeListingModerator({
        data: { email, identityToken, listingId: moderator.listing_id, userEmail: moderator.user_email },
      });
      toast.success("Listing Moderator removed.");
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not remove the Listing Moderator.");
    } finally {
      setRemovingKey("");
    }
  }

  return (
    <section className="mt-5 rounded-2xl border border-border/70 bg-card p-4 sm:p-6">
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-primary/10 p-3 text-primary"><ShieldCheck className="size-6" /></div>
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-semibold">Listing Moderators</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Give trusted users permission to publish status updates for selected listings. They do not become listing owners.
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
        <label className="block text-sm font-medium">
          Listing
          <select
            value={selectedListing}
            onChange={(event) => setSelectedListing(event.target.value)}
            className="mt-1.5 h-11 w-full rounded-xl border border-border bg-background px-3"
          >
            <option value="">Select listing</option>
            {options.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
          </select>
        </label>
        <label className="block text-sm font-medium">
          Moderator email
          <input
            type="email"
            value={userEmail}
            onChange={(event) => setUserEmail(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void add(); } }}
            placeholder="moderator@example.com"
            className="mt-1.5 h-11 w-full rounded-xl border border-border bg-background px-3"
          />
        </label>
        <div className="flex items-end">
          <Button type="button" disabled={saving} onClick={() => void add()}>
            {saving ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : <UserPlus className="mr-2 size-4" />}
            Add Moderator
          </Button>
        </div>
      </div>

      {error && <p role="alert" className="mt-3 rounded-lg border border-destructive/30 p-3 text-sm text-destructive">{error}</p>}

      <div className="mt-5 overflow-hidden rounded-xl border border-border/70">
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-3 border-b border-border bg-muted/40 px-3 py-2 text-xs font-semibold text-muted-foreground">
          <span>Listing</span><span>Moderator</span><span>Action</span>
        </div>
        {loading ? (
          <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />Loading Listing Moderators…</div>
        ) : moderators.length === 0 ? (
          <div className="p-5 text-center text-sm text-muted-foreground">No Listing Moderators have been assigned yet.</div>
        ) : (
          <div className="divide-y divide-border">
            {moderators.map((moderator) => {
              const key = `${moderator.listing_id}:${moderator.user_email}`;
              return (
                <div key={key} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-3 px-3 py-3 text-sm">
                  <div className="min-w-0"><p className="truncate font-medium">{moderator.listing_title}</p><p className="text-xs text-muted-foreground">Status publishing</p></div>
                  <div className="min-w-0"><p className="truncate font-medium">{moderator.user_name || moderator.user_email}</p><p className="truncate text-xs text-muted-foreground">{moderator.user_email}</p></div>
                  <Button type="button" size="sm" variant="outline" disabled={removingKey === key} onClick={() => void remove(moderator)}>
                    {removingKey === key ? <LoaderCircle className="size-4 animate-spin" /> : <X className="mr-1 size-4" />}
                    Remove
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        Listing Moderators can publish statuses only for listings assigned to them. Listing ownership and other Partner Portal permissions remain unchanged.
      </p>
    </section>
  );
}
