import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Listing } from "@/lib/types";
import type { WpTrip, WpUser } from "@/lib/wp-api";

type SessionState = {
  user: WpUser | null;
  myListings: Listing[];
  myTrips: WpTrip[];
  bookmarkIds: number[];
  method: string | null;
  wpIdentityToken: string | null;
  lastUsername: string;
  setSession: (payload: {
    user: WpUser;
    myListings: Listing[];
    myTrips: WpTrip[];
    method: string;
    bookmarkIds?: number[];
    identityToken?: string;
  }) => void;
  setLastUsername: (username: string) => void;
  clearSession: () => void;
};

export const useSession = create<SessionState>()(
  persist(
    (set) => ({
      user: null,
      myListings: [],
      myTrips: [],
      bookmarkIds: [],
      method: null,
      wpIdentityToken: null,
      lastUsername: "",
      setSession: ({ user, myListings, myTrips, method, bookmarkIds, identityToken }) =>
        set((state) => ({
          user,
          myListings,
          myTrips,
          method,
          // Account/profile refreshes often update the WP user and saved data
          // without re-authenticating. Preserve the signed identity token unless
          // a caller explicitly supplies a replacement; clearSession removes it.
          wpIdentityToken: identityToken === undefined
            ? state.wpIdentityToken
            : (identityToken || null),
          bookmarkIds: bookmarkIds ?? [],
          lastUsername: user.slug || user.name,
        })),
      setLastUsername: (lastUsername) => set({ lastUsername }),
      clearSession: () => set({ user: null, myListings: [], myTrips: [], bookmarkIds: [], method: null, wpIdentityToken: null }),
    }),
    {
      name: "xplore-pondy-wp",
      partialize: (s) => ({
        user: s.user,
        myListings: s.myListings,
        myTrips: s.myTrips,
        bookmarkIds: s.bookmarkIds,
        method: s.method,
        wpIdentityToken: s.wpIdentityToken,
        lastUsername: s.lastUsername,
      }),
      skipHydration: true,
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<SessionState>;
        return {
          ...current,
          ...p,
          myListings: p.myListings ?? [],
          myTrips: p.myTrips ?? [],
          bookmarkIds: p.bookmarkIds ?? [],
          lastUsername: p.lastUsername ?? "",
          wpIdentityToken: p.wpIdentityToken ?? null,
        };
      },
    },
  ),
);
