import { createFileRoute, Link, useLocation } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CalendarClock, ExternalLink, FilePlus2, LoaderCircle, PencilLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAppLoggedIn } from "@/lib/app-session";
import { fetchMyExperiences, type ExperienceAccountItem } from "@/lib/experiences-account-api";
import { ExperienceEditor } from "@/components/experience-editor";
import { useSession } from "@/store/session";

export const Route = createFileRoute("/my-experiences")({ component: MyExperiencesPage });

function statusLabel(status: string) {
  if (status === "publish") return "Published";
  if (status === "pending") return "Pending review";
  if (status === "draft") return "Draft";
  if (status === "private") return "Private";
  if (status === "future") return "Scheduled";
  return status;
}
function MyExperiencesPage() {
  const location = useLocation();
  // Defensive route fallback: if an older/stale client route manifest matches
  // this archive for a nested edit URL, render the editor instead of the archive.
  const editMatch = location.pathname.match(/^\/my-experiences\/(\d+)\/edit\/?$/);
  const { loggedIn, wpUser, grokUser } = useAppLoggedIn();
  const identityToken = useSession((state) => state.wpIdentityToken);
  const sessionEmail = useSession((state) => state.user?.email ?? "");
  const email = (grokUser?.primaryEmail || wpUser?.email || sessionEmail).trim().toLowerCase();
  const [items, setItems] = useState<ExperienceAccountItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    if (editMatch) {
      setLoading(false);
      return () => { active = false; };
    }
    if (!loggedIn || !email) { setLoading(false); return; }
    fetchMyExperiences({ data: { email, identityToken: identityToken ?? undefined } })
      .then((result) => { if (active) setItems(result); })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Could not load your experiences."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [loggedIn, email, identityToken, location.pathname]);
  if (editMatch) return <ExperienceEditor mode="edit" experienceId={Number(editMatch[1])} />;
  if (!loggedIn) return <main className="mx-auto max-w-4xl px-4 py-10"><h1 className="font-display text-3xl font-semibold">My Experiences</h1><p className="mt-2 text-muted-foreground">Sign in to manage your submitted experiences.</p><Button asChild className="mt-4"><Link to="/login">Sign in</Link></Button></main>;
  return <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Provider dashboard</p><h1 className="mt-1 font-display text-3xl font-semibold">My Experiences</h1><p className="mt-2 text-sm text-muted-foreground">Manage your experiences and track review status.</p></div><Button asChild><Link to="/submit-experiences"><FilePlus2 className="mr-2 size-4" />Submit an experience</Link></Button></div>
    {error && <div role="alert" className="mt-5 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm">{error}</div>}
    {loading && <div className="mt-8 flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />Loading your experiences…</div>}
    {!loading && !error && items.length===0 && <section className="mt-8 rounded-2xl border border-dashed border-border p-8 text-center"><FilePlus2 className="mx-auto size-9 text-muted-foreground" /><h2 className="mt-3 font-display text-xl font-semibold">No experiences yet</h2><p className="mt-2 text-sm text-muted-foreground">Create your first experience and submit it for review.</p><Button asChild className="mt-4"><Link to="/submit-experiences">Create an experience</Link></Button></section>}
    <div className="mt-6 space-y-4">{items.map((item)=><article key={item.id} className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:p-5">
      {item.image ? <img src={item.image} alt="" className="h-28 w-full rounded-xl object-cover sm:w-36" /> : <div className="flex h-28 w-full items-center justify-center rounded-xl bg-muted sm:w-36"><CalendarClock className="size-7 text-muted-foreground" /></div>}
      <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="font-display text-lg font-semibold">{item.title || "Untitled experience"}</h2><span className="rounded-full border border-border px-2.5 py-1 text-xs">{statusLabel(item.status)}</span></div>{item.excerpt && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{item.excerpt}</p>}<p className="mt-2 text-xs text-muted-foreground">Last updated {item.modified ? new Date(item.modified).toLocaleDateString() : "—"}</p></div>
      <div className="flex shrink-0 flex-wrap gap-2"><Button variant="outline" asChild><Link to="/my-experiences/$experienceId/edit" params={{experienceId:String(item.id)}}><PencilLine className="mr-2 size-4" />Edit experience</Link></Button>{item.status==="publish" && item.slug && <Button variant="ghost" asChild><a href={item.url} target="_blank" rel="noreferrer">View experience <ExternalLink className="ml-1 size-4" /></a></Button>}</div>
    </article>)}</div>
  </main>;
}
