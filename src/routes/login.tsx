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
    <div className="mx-auto max-w-md">
      <Logo />
      <p className="mt-6 text-xs font-semibold uppercase tracking-[0.18em] text-primary">Sign in</p>
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
              variant={p.idp === "google" ? "outline" : "ghost"}
              size="lg"
              className="w-full bg-card"
              disabled={oauthPending != null}
              onClick={() => {
                setOauthPending(p.providerId);
                void signIn(p.providerId, { callbackURL: forceReauth ? returnTo : "/dashboard" }).catch(() => setOauthPending(null));
              }}
            >
              {p.idp === "google" ? <GoogleMark /> : null}
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
  );
}
