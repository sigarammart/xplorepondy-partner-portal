import { Link } from "@tanstack/react-router";
import { LogIn } from "lucide-react";
import { UserButton } from "@/lib/auth/gates";
import { authEnabled } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { Button } from "@/components/ui/button";
import { useHydrated } from "@/lib/use-hydrated";
import { useAuthModal } from "@/store/auth-modal";
import { useSession } from "@/store/session";

export function HeaderAuth({ onSignIn, showSignOut = true }: { onSignIn?: () => void; showSignOut?: boolean } = {}) {
  const { user, isPending } = useCurrentUserState();
  const hydrated = useHydrated();
  const wpUser = useSession((s) => s.user);
  const showLogin = useAuthModal((s) => s.show);

  if (authEnabled && isPending) {
    return <div className="size-8 shrink-0 animate-pulse rounded-full bg-muted" aria-hidden />;
  }

  if (authEnabled && user && !user.isDevFallback) {
    return (
      <div className="max-w-[11rem] overflow-hidden sm:max-w-none [&_span.text-sm.font-medium]:hidden sm:[&_span.text-sm.font-medium]:inline">
        <UserButton showSignOut={showSignOut} />
      </div>
    );
  }

  if (hydrated && wpUser) {
    return (
      <Button variant="ghost" size="sm" asChild>
        <Link to="/dashboard">{wpUser.name.split(" ")[0]}</Link>
      </Button>
    );
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => {
        if (onSignIn) onSignIn();
        else showLogin({ reason: "trip", next: "/dashboard" });
      }}
    >
      <LogIn />
      <span>Sign in</span>
    </Button>
  );
}