import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { FormEvent, useEffect, useState } from "react";
import { LockKeyhole } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/logo";
import { GROK_PROVIDERS, authEnabled, signIn } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { wpLogin } from "@/lib/wp-api";
import { useHydrated } from "@/lib/use-hydrated";
import { useSession } from "@/store/session";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ name: "robots", content: "noindex, follow" }] }),
  component: LoginPage,
});

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.54-.2-2.27H12v4.3h6.46a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.55-5.17 3.55-8.65Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.07 7.95-2.91l-3.88-3c-1.08.72-2.47 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.27v3.09A12 12 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.28A7.2 7.2 0 0 1 4.89 12c0-.79.14-1.56.38-2.28V6.63H1.27A12 12 0 0 0 0 12c0 1.94.46 3.77 1.27 5.37l4-3.09Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.76 0 3.34.61 4.58 1.8l3.43-3.43C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.69 1.27 6.63l4 3.09C6.22 6.86 8.87 4.75 12 4.75Z"
      />
    </svg>
  );
}

function LoginPage() {
  const navigate = useNavigate();
  const hydrated = useHydrated();
  const { user: googleUser, isPending } = useCurrentUserState();
  const user = useSession((s) => s.user);
  const lastUsername = useSession((s) => s.lastUsername);
  const setSession = useSession((s) => s.setSession);
  const setLastUsername = useSession((s) => s.setLastUsername);
  const loginQuery = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  const forceReauth = loginQuery?.get("reauth") === "1";
  const requestedRedirect = loginQuery?.get("redirect") ?? "";
  const returnTo = requestedRedirect.startsWith("/") && !requestedRedirect.startsWith("//")
    ? requestedRedirect
    : "/dashboard";
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [oauthPending, setOauthPending] = useState<string | null>(null);

  useEffect(() => {
    if (isPending || forceReauth) return;
    if (googleUser || (hydrated && user)) void navigate({ to: "/dashboard" });
  }, [hydrated, user, googleUser, isPending, navigate, forceReauth]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const username = String(form.get("username") ?? "").trim();
    const password = String(form.get("password") ?? "");
    setPending(true);
    setError(null);
    setLastUsername(username);
    try {
      const result = await wpLogin({ data: { username, password } });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSession({
        user: result.user,
        myListings: result.myListings,
        myTrips: result.myTrips,
        method: result.method,
        bookmarkIds: result.bookmarkIds,
        identityToken: result.identityToken,
      });
      toast.success(`Signed in as ${result.user.name}`);
      if (forceReauth) window.location.assign(returnTo);
      else void navigate({ to: "/dashboard" });
    } catch {
      setError("Could not sign in. Check your username and password.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="xp-partner-public-page min-h-dvh overflow-hidden">
      <header className="xp-partner-public-header">
        <Logo />
        <div className="flex items-center gap-3">
          <span className="hidden text-sm text-muted-foreground sm:inline">Already a partner?</span>
          <a href="#partner-login" className="rounded-full border border-border px-4 py-2 text-sm font-semibold transition hover:border-primary hover:text-primary">Sign in</a>
        </div>
      </header>
      <main>
        <section className="xp-partner-public-hero">
          <div className="xp-partner-public-hero-glow" />
          <div className="xp-partner-public-hero-inner">
            <div className="xp-partner-public-copy">
              <span className="xp-partner-public-eyebrow">Xplore Pondy Partner</span>
              <h1>Grow your business where Pondicherry travelers are already exploring.</h1>
              <p>Claim and manage your presence on Xplore Pondy, reach more visitors, promote offers, manage bookings, publish updates, and turn traveler interest into real business.</p>
              <div className="xp-partner-public-actions">
                <a href="#partner-login" className="inline-flex items-center justify-center rounded-xl bg-primary px-6 py-3 font-bold text-primary-foreground shadow-lg transition hover:-translate-y-0.5">Get started</a>
                <a href="#partner-tools" className="inline-flex items-center justify-center rounded-xl border border-white/25 bg-white/5 px-6 py-3 font-semibold text-white backdrop-blur transition hover:bg-white/10">Explore partner tools</a>
              </div>
              <div className="xp-partner-public-proof">
                <span><strong>Listings</strong><small>Showcase your business</small></span>
                <span><strong>Bookings</strong><small>Manage reservations</small></span>
                <span><strong>Reach</strong><small>Connect with travelers</small></span>
              </div>
            </div>
            <div id="partner-login" className="xp-partner-login-card">
              <div className="mb-5">
                <span className="text-xs font-bold uppercase tracking-[0.16em] text-primary">Partner login</span>
                <h2 className="mt-1 font-display text-2xl font-semibold">Welcome back</h2>
                <p className="mt-1 text-sm text-muted-foreground">Manage your Xplore Pondy business presence.</p>
              </div>
      <h1 className="mt-1 font-display text-3xl font-semibold">Welcome back</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Google for a quick account, or sign in with your xplorepondy.com username and password.
      </p>

      {authEnabled ? (
        <div className="mt-8 space-y-2">
          {GROK_PROVIDERS.map((p) => (
            <Button
              key={p.providerId}
              type="button"
              variant={p.providerId === "google" ? "outline" : "ghost"}
              size="lg"
              className="w-full bg-card"
              disabled={oauthPending != null}
              onClick={() => {
                setOauthPending(p.providerId);
                void signIn(p.providerId, { callbackURL: forceReauth ? returnTo : "/dashboard" }).catch(() => setOauthPending(null));
              }}
            >
              {p.providerId === "google" ? <GoogleMark /> : null}
              {oauthPending === p.providerId ? "Opening Google…" : `Continue with ${p.label}`}
            </Button>
          ))}
        </div>
      ) : (
        <p className="mt-8 text-sm text-muted-foreground">Google sign-in is turning on — refresh in a moment.</p>
      )}

      <div className="my-8 flex items-center gap-3 text-xs uppercase tracking-wide text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        Login
        <span className="h-px flex-1 bg-border" />
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="username">Username</Label>
          <Input
            id="username"
            name="username"
            autoComplete="username"
            required
            defaultValue={hydrated ? lastUsername : ""}
            placeholder="Username"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            placeholder="Password"
          />
        </div>
        {error && (
          <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
        )}
        <Button type="submit" className="w-full" size="lg" disabled={pending}>
          <LockKeyhole />
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      <p className="mt-4 text-center text-xs text-muted-foreground">
        Google sign-in is handled securely. Your username and password go only to xplorepondy.com.
      </p>
      <p className="mt-6 text-center text-sm">
        <Link to="/dashboard" className="text-muted-foreground hover:text-foreground">
          Continue without signing in
        </Link>
      </p>
            </div>
          </div>
        </section>
        <section id="partner-tools" className="xp-partner-public-tools">
          <div className="mx-auto max-w-6xl">
            <div className="mx-auto max-w-2xl text-center">
              <span className="xp-partner-public-eyebrow">Everything in one place</span>
              <h2 className="mt-2 font-display text-3xl font-semibold sm:text-4xl">Tools built for local businesses</h2>
              <p className="mt-3 text-muted-foreground">One partner workspace to keep your listings fresh, engage visitors and manage the activity that matters.</p>
            </div>
            <div className="xp-partner-feature-grid mt-10">
              <article><span>01</span><h3>Manage your listing</h3><p>Update your business information, photos, amenities and customer-facing details.</p></article>
              <article><span>02</span><h3>Promote with XP Ads</h3><p>Put your business in premium placements across Xplore Pondy and reach travelers at the right moment.</p></article>
              <article><span>03</span><h3>Events & experiences</h3><p>Create and manage events and experiences so visitors can discover what you offer.</p></article>
              <article><span>04</span><h3>Bookings & reservations</h3><p>Keep reservations, customer requests and booking activity in one partner dashboard.</p></article>
              <article><span>05</span><h3>Publish status updates</h3><p>Share offers, new photos and timely business updates with people exploring Pondicherry.</p></article>
              <article><span>06</span><h3>Track performance</h3><p>Understand listing views, engagement and activity so you can make better decisions.</p></article>
            </div>
          </div>
        </section>
        <section className="xp-partner-public-cta">
          <div>
            <span className="xp-partner-public-eyebrow">Built for Pondicherry businesses</span>
            <h2 className="mt-2 font-display text-3xl font-semibold">Put your business in front of the people planning their Pondy trip.</h2>
          </div>
          <a href="#partner-login" className="inline-flex shrink-0 items-center justify-center rounded-xl bg-primary px-6 py-3 font-bold text-primary-foreground">Partner with Xplore Pondy</a>
        </section>
      </main>
    </div>
  );
}