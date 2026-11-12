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
    <div className="xp-partner-public-page min-h-dvh">
      <header className="xp-partner-public-header">
        <a href="https://xplorepondy.com" className="xp-partner-public-brand" aria-label="Xplore Pondy Partner Portal">
          <Logo />
          <span>Partner Portal</span>
        </a>
        <nav className="xp-partner-public-nav" aria-label="Partner information">
          <a href="#benefits">Partner Benefits</a>
          <a href="#features">Features</a>
          <a href="#how-it-works">How It Works</a>
          <a href="#faqs">FAQs</a>
        </nav>
        <div className="xp-partner-public-header-actions">
          <a className="xp-partner-visit-link" href="https://xplorepondy.com" target="_blank" rel="noreferrer">
            Visit Xplore Pondy <ExternalLink className="size-4" />
          </a>
          <a className="xp-partner-login-link" href="#partner-login">
            <UserRound className="size-4" /> Login
          </a>
        </div>
      </header>

      <main>
        <section className="xp-partner-public-hero">
          <div className="xp-partner-hero-art" aria-hidden="true" />
          <div className="xp-partner-hero-overlay" />
          <div className="xp-partner-public-hero-inner">
            <div className="xp-partner-public-copy">
              <span className="xp-partner-public-eyebrow">Partner Portal for Businesses in Pondicherry</span>
              <h1>
                Grow your business where <em>Pondicherry</em> travelers are already exploring.
              </h1>
              <p>
                List your business, get more visibility, attract more visitors, manage bookings,
                run promotions and be part of Pondicherry&apos;s leading travel platform.
              </p>
              <div className="xp-partner-public-actions">
                <a href="#partner-login" className="xp-partner-primary-cta">
                  Get Started <ArrowRight className="size-5" />
                </a>
                <a href="#features" className="xp-partner-secondary-cta">
                  <span className="xp-partner-play">▶</span> Explore Partner Tools
                </a>
              </div>
            </div>

            <div id="partner-login" className="xp-partner-login-card">
              <div className="xp-partner-login-heading">
                <h2>Partner Login</h2>
                <p>Access your Xplore Pondy business account</p>
              </div>

              {authEnabled ? (
                <div className="xp-partner-google-wrap">
                  {GROK_PROVIDERS.map((p) => (
                    <Button
                      key={p.providerId}
                      type="button"
                      variant="outline"
                      size="lg"
                      className="xp-partner-google-button"
                      disabled={oauthPending != null}
                      onClick={() => {
                        setOauthPending(p.providerId);
                        void signIn(p.providerId, { callbackURL: forceReauth ? returnTo : "/dashboard" }).catch(() => setOauthPending(null));
                      }}
                    >
                      {p.providerId === "google" ? <GoogleMark /> : null}
                      {oauthPending === p.providerId ? "Opening Google…" : "Continue with Google"}
                    </Button>
                  ))}
                </div>
              ) : (
                <p className="xp-partner-login-note">Google sign-in is turning on — refresh in a moment.</p>
              )}

              <div className="xp-partner-login-divider"><span>or</span></div>

              <form onSubmit={onSubmit} className="xp-partner-login-form">
                <div className="xp-partner-login-field">
                  <Label htmlFor="username">Username or Email</Label>
                  <div className="xp-partner-input-wrap">
                    <UserRound className="size-4" />
                    <Input
                      id="username"
                      name="username"
                      autoComplete="username"
                      required
                      defaultValue={hydrated ? lastUsername : ""}
                      placeholder="Username or email"
                    />
                  </div>
                </div>
                <div className="xp-partner-login-field">
                  <Label htmlFor="password">Password</Label>
                  <div className="xp-partner-input-wrap">
                    <LockKeyhole className="size-4" />
                    <Input
                      id="password"
                      name="password"
                      type="password"
                      autoComplete="current-password"
                      required
                      placeholder="Password"
                    />
                  </div>
                </div>

                <div className="xp-partner-login-row">
                  <label className="xp-partner-remember">
                    <input type="checkbox" defaultChecked /> <span>Remember me</span>
                  </label>
                  <span className="xp-partner-forgot">Forgot password?</span>
                </div>

                {error && <p className="xp-partner-login-error">{error}</p>}

                <Button type="submit" className="xp-partner-submit" size="lg" disabled={pending}>
                  {pending ? "Signing in…" : "Login to Partner Portal"}
                </Button>
              </form>

              <p className="xp-partner-login-security">
                Google sign-in is handled securely. Your username and password go only to xplorepondy.com.
              </p>
            </div>
          </div>
        </section>

        <section id="benefits" className="xp-partner-metrics">
          <div><span className="xp-partner-metric-icon listing"><Store className="size-6" /></span><strong>930+</strong><b>Active Listings</b><small>Cafes, Restaurants, Stays, Activities & more</small></div>
          <div><span className="xp-partner-metric-icon bookings"><CalendarDays className="size-6" /></span><strong>12,000+</strong><b>Bookings</b><small>Reservations & experiences by travelers</small></div>
          <div><span className="xp-partner-metric-icon reach"><Users className="size-6" /></span><strong>2.5M+</strong><b>Traveler Reach</b><small>On xplorepondy.com and app.xplorepondy.com</small></div>
        </section>

        <section id="features" className="xp-partner-features-section">
          <div className="xp-partner-section-heading">
            <div>
              <span className="xp-partner-section-kicker">Partner Benefits</span>
              <h2>What you can do as a Partner</h2>
            </div>
            <p>Powerful tools to showcase, promote and grow your business in Pondicherry.</p>
          </div>
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
          <div className="xp-partner-bottom-art" aria-hidden="true" />
          <div className="xp-partner-bottom-copy">
            <span className="xp-partner-section-kicker">Built for Pondicherry businesses</span>
            <h2>List your business on Xplore Pondy today!</h2>
            <p>Get discovered by thousands of travelers planning their Pondicherry trip.</p>
          </div>
          <a href="#partner-login" className="xp-partner-primary-cta">Become a Partner <ArrowRight className="size-5" /></a>
        </section>

        <section id="faqs" className="xp-partner-faq-strip">
          <strong>Questions about becoming a partner?</strong>
          <span>Sign in to your existing account or contact the Xplore Pondy team for partner support.</span>
        </section>
      </main>
    </div>
  );
}