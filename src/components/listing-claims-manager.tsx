import { useEffect, useState } from "react";
import { Bell, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  fetchListingClaimNotifications,
  markListingClaimNotificationRead,
  updateListingClaimStatus,
  type ListingClaimNotification,
} from "@/lib/wp-api";
import { formatDisplayDateTime } from "@/lib/date-time-format";

export function ListingClaimsManager({ email, identityToken }: { email: string; identityToken?: string }) {
  const [items, setItems] = useState<ListingClaimNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState("");

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const result = await fetchListingClaimNotifications({ data: { email, identityToken } });
      setItems(result.items ?? []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load listing claims.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, [email, identityToken]);

  async function setStatus(claimId: number, status: "approved" | "rejected") {
    setBusyId(claimId);
    try {
      await updateListingClaimStatus({ data: { email, identityToken, claimId, status } });
      setItems((current) => current.map((item) => item.id === claimId ? { ...item, status, read_at: item.read_at ?? new Date().toISOString() } : item));
      toast.success(status === "approved" ? "Listing claim approved." : "Listing claim rejected.");
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : "Could not update the listing claim.");
    } finally {
      setBusyId(null);
    }
  }

  async function markRead(claimId: number) {
    setBusyId(claimId);
    try {
      await markListingClaimNotificationRead({ data: { email, identityToken, claimId } });
      setItems((current) => current.map((item) => item.id === claimId ? { ...item, read_at: new Date().toISOString() } : item));
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : "Could not mark the claim as read.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="mt-5 rounded-2xl border border-amber-500/30 bg-card p-4 sm:p-6">
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-amber-500/10 p-3 text-amber-600"><Bell className="size-6" /></div>
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-semibold">Listing Claims</h2>
          <p className="mt-1 text-sm text-muted-foreground">Claims submitted from the Xplore Pondy app are delivered here for administrator review.</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => void refresh()} disabled={loading}>Refresh</Button>
      </div>

      {loading ? (
        <div className="mt-5 flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />Loading listing claims…</div>
      ) : error ? (
        <p role="alert" className="mt-4 rounded-xl border border-destructive/30 p-3 text-sm text-destructive">{error}</p>
      ) : items.length === 0 ? (
        <div className="xp-partner-empty mt-4"><Bell className="size-6" /><span>No listing claims have been submitted.</span></div>
      ) : (
        <div className="mt-4 space-y-3">
          {items.map((claim) => (
            <article key={claim.id} className="rounded-xl border border-border/70 bg-background p-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-amber-500/15 px-2 py-1 text-[11px] font-semibold text-amber-700 dark:text-amber-300">Listing Claim</span>
                    <span className="rounded-full bg-muted px-2 py-1 text-[11px] font-medium">{claim.status}</span>
                    <span className="text-xs text-muted-foreground">{formatDisplayDateTime(claim.created_at)}</span>
                    {!claim.read_at && <span className="size-2 rounded-full bg-primary" aria-label="Unread" />}
                  </div>
                  <h3 className="mt-2 font-semibold">{claim.listing_title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {claim.first_name} {claim.last_name} · {claim.email}{claim.phone ? " · " + claim.phone : ""}
                  </p>
                  <p className="mt-3 whitespace-pre-wrap rounded-lg bg-muted/40 p-3 text-sm">{claim.details}</p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Button size="sm" disabled={busyId === claim.id || claim.status === "approved"} onClick={() => void setStatus(claim.id, "approved")}>
                    Approve
                  </Button>
                  <Button size="sm" variant="outline" disabled={busyId === claim.id || claim.status === "rejected"} onClick={() => void setStatus(claim.id, "rejected")}>
                    Reject
                  </Button>
                  {!claim.read_at && (
                    <Button size="sm" variant="ghost" disabled={busyId === claim.id} onClick={() => void markRead(claim.id)}>
                      Mark read
                    </Button>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
