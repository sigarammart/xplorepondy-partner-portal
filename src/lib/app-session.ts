import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { useSession } from "@/store/session";

/** Signed in via Grok (Google/X) or a WordPress xplorepondy.com account. Dev fallback is not a login. */
export function useAppLoggedIn() {
  const wpUser = useSession((s) => s.user);
  const { user, isPending } = useCurrentUserState();
  const grokIn = Boolean(user && !user.isDevFallback);
  return {
    loggedIn: Boolean(wpUser || grokIn),
    isPending: user?.isDevFallback ? false : isPending,
    wpUser,
    grokUser: grokIn ? user : null,
  };
}
