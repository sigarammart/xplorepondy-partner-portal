import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { FormEvent, useEffect, useState } from "react";
import { ArrowRight, BarChart3, CalendarDays, ClipboardCheck, ExternalLink, LockKeyhole, Megaphone, Store, Ticket, UserRound, Users } from "lucide-react";
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
      <path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.2-2.27H12v4.3h6.46a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.55-5.17 3.55-8.65Z"/>
      <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.95-2.91l-3.88-3c-1.08.72-2.47 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.27v3.09A12 12 0 0 0 12 24Z"/>
      <path fill="#FBBC05" d="M5.27 14.28A7.2 7.2 0 0 1 4.89 12c0-.79.14-1.56.38-2.28V6.63H1.27A12 12 0 0 0 0 12c0 1.94.46 3.77 1.27 5.37l4-3.09Z"/>
      <path fill="#EA4335" d="M12 4.75c1.76 0 3.34.61 4.58 1.8l3.43-3.43C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.69 1.27 6.63l4 3.09C6.22 6.86 8.87 4.75 12 4.75Z"/>
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
  const returnTo = requestedRedirect.startsWith("/") && !requestedRedirect.startsWith("//") ? requestedRedirect : "/dashboard";
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
    setPending(true); setError(null); setLastUsername(username);
    try {
      const result = await wpLogin({ data: { username, password } });
      if (!result.ok) { setError(result.error); return; }
      setSession({ user: result.user, myListings: result.myListings, myTrips: result.myTrips, method: result.method, bookmarkIds: result.bookmarkIds, identityToken: result.identityToken });
      toast.success(`Signed in as ${result.user.name}`);
      if (forceReauth) window.location.assign(returnTo); else void navigate({ to: "/dashboard" });
    } catch { setError("Could not sign in. Check your username and password."); }
    finally { setPending(false); }
  }

  return (
    <div className="xp-partner-public-page min-h-dvh">
      <header className="xp-partner-public-header">
        <a href="https://xplorepondy.com" className="xp-partner-public-brand" aria-label="Xplore Pondy Partner Portal"><Logo /><span>Partner Portal</span></a>
        <nav className="xp-partner-public-nav" aria-label="Partner information">
          <a href="#benefits">Partner Benefits</a><a href="#features">Features</a><a href="#how-it-works">How It Works</a><a href="#faqs">FAQs</a>
        </nav>
        <div className="xp-partner-public-header-actions">
          <a className="xp-partner-visit-link" href="https://xplorepondy.com" target="_blank" rel="noreferrer">Visit Xplore Pondy <ExternalLink className="size-4" /></a>
          <a className="xp-partner-login-link" href="#partner-login"><UserRound className="size-4" /> Login</a>
        </div>
      </header>

      <main>
        <section className="xp-partner-public-hero">
          <div className="xp-partner-hero-art" aria-hidden="true" /><div className="xp-partner-hero-overlay" />
          <div className="xp-partner-public-hero-inner">
            <div className="xp-partner-public-copy">
              <span className="xp-partner-public-eyebrow">Partner Portal for Businesses in Pondicherry</span>
              <h1>Grow your business where <em>Pondicherry</em> travelers are already exploring.</h1>
              <p>List your business, get more visibility, attract more visitors, manage bookings, run promotions and be part of Pondicherry&apos;s leading travel platform.</p>
              <div className="xp-partner-public-actions">
                <a href="#partner-login" className="xp-partner-primary-cta">Get Started <ArrowRight className="size-5" /></a>
                <a href="#features" className="xp-partner-secondary-cta"><span className="xp-partner-play">▶</span> Explore Partner Tools</a>
              </div>
            </div>
            <div id="partner-login" className="xp-partner-login-card">
              <div className="xp-partner-login-heading"><h2>Partner Login</h2><p>Access your Xplore Pondy business account</p></div>
              {authEnabled ? <div className="xp-partner-google-wrap">
                {GROK_PROVIDERS.map((p) => <Button key={p.providerId} type="button" variant="outline" size="lg" className="xp-partner-google-button" disabled={oauthPending != null} onClick={() => { setOauthPending(p.providerId); void signIn(p.providerId, { callbackURL: forceReauth ? returnTo : "/dashboard" }).catch(() => setOauthPending(null)); }}>
                  {p.providerId === "google" ? <GoogleMark /> : null}{oauthPending === p.providerId ? "Opening Google…" : `Continue with ${p.label}`}
                </Button>)}
              </div> : <p className="xp-partner-login-note">Google sign-in is turning on — refresh in a moment.</p>}
              <div className="xp-partner-login-divider"><span>or</span></div>
              <form onSubmit={onSubmit} className="xp-partner-login-form">
                <div className="xp-partner-login-field"><Label htmlFor="username">Username or Email</Label><div className="xp-partner-input-wrap"><UserRound className="size-4" /><Input id="username" name="username" autoComplete="username" required defaultValue={hydrated ? lastUsername : ""} placeholder="Username or email" /></div></div>
                <div className="xp-partner-login-field"><Label htmlFor="password">Password</Label><div className="xp-partner-input-wrap"><LockKeyhole className="size-4" /><Input id="password" name="password" type="password" autoComplete="current-password" required placeholder="Password" /></div></div>
                <div className="xp-partner-login-row"><label className="xp-partner-remember"><input type="checkbox" defaultChecked /><span>Remember me</span></label><span className="xp-partner-forgot">Forgot password?</span></div>
                {error && <p className="xp-partner-login-error">{error}</p>}
                <Button type="submit" className="xp-partner-submit" size="lg" disabled={pending}>{pending ? "Signing in…" : "Login to Partner Portal"}</Button>
              </form>
              <p className="xp-partner-login-security">Google sign-in is handled securely. Your username and password go only to xplorepondy.com.</p>
            </div>
          </div>
        </section>

        <section id="benefits" className="xp-partner-metrics">
          <div><span className="xp-partner-metric-icon listing"><Store className="size-6" /></span><strong>930+</strong><b>Active Listings</b><small>Cafes, Restaurants, Stays, Activities & more</small></div>
          <div><span className="xp-partner-metric-icon bookings"><CalendarDays className="size-6" /></span><strong>12,000+</strong><b>Bookings</b><small>Reservations & experiences by travelers</small></div>
          <div><span className="xp-partner-metric-icon reach"><Users className="size-6" /></span><strong>2.5M+</strong><b>Traveler Reach</b><small>On xplorepondy.com and app.xplorepondy.com</small></div>
        </section>

        <section id="features" className="xp-partner-features-section">
          <div className="xp-partner-section-heading"><div><span className="xp-partner-section-kicker">Partner Benefits</span><h2>What you can do as a Partner</h2></div><p>Powerful tools to showcase, promote and grow your business in Pondicherry.</p></div>
          <div className="xp-partner-feature-grid">
            <article><span className="xp-partner-feature-icon blue"><Store /></span><h3>Manage your Listing</h3><p>Create, update and keep your business information always up to date.</p></article>
            <article><span className="xp-partner-feature-icon coral"><Megaphone /></span><h3>XP Ads</h3><p>Promote your business with targeted ads on Xplore Pondy (Homepage, listings and more).</p></article>
            <article><span className="xp-partner-feature-icon purple"><CalendarDays /></span><h3>Events &amp; Experiences</h3><p>Add and manage your events, workshops and unique experiences.</p></article>
            <article><span className="xp-partner-feature-icon green"><ClipboardCheck /></span><h3>Bookings &amp; Reservations</h3><p>Receive and manage bookings, slots and customer details.</p></article>
            <article><span className="xp-partner-feature-icon yellow"><Ticket /></span><h3>Status Updates</h3><p>Share quick updates, offers, new arrivals and behind-the-scenes with travelers.</p></article>
            <article><span className="xp-partner-feature-icon cyan"><BarChart3 /></span><h3>Performance / Statistics</h3><p>Track views, bookings, ad performance and overall business reach.</p></article>
          </div>
        </section>

        <section id="how-it-works" className="xp-partner-bottom-cta">
          <div className="xp-partner-bottom-art" aria-hidden="true" /><div className="xp-partner-bottom-copy"><span className="xp-partner-section-kicker">Built for Pondicherry businesses</span><h2>List your business on Xplore Pondy today!</h2><p>Get discovered by thousands of travelers planning their Pondicherry trip.</p></div>
          <a href="#partner-login" className="xp-partner-primary-cta">Become a Partner <ArrowRight className="size-5" /></a>
        </section>
        <section id="faqs" className="xp-partner-faq-strip"><strong>Questions about becoming a partner?</strong><span>Sign in to your existing account or contact the Xplore Pondy team for partner support.</span></section>
      </main>
    </div>
  );
}
