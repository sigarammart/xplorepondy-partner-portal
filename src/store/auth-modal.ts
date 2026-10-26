import { create } from "zustand";

export type AuthReason = "trip" | "bookmark" | "add-trip";

type AuthModalState = {
  open: boolean;
  reason: AuthReason | null;
  next: string | null;
  slug: string | null;
  name: string | null;
  wpId?: number;
  show: (opts?: { reason?: AuthReason; next?: string; slug?: string; name?: string; wpId?: number }) => void;
  hide: () => void;
};

export const useAuthModal = create<AuthModalState>((set) => ({
  open: false,
  reason: null,
  next: null,
  slug: null,
  name: null,
  wpId: undefined,
  show: (opts) =>
    set({
      open: true,
      reason: opts?.reason ?? null,
      next: opts?.next ?? null,
      slug: opts?.slug ?? null,
      name: opts?.name ?? null,
      wpId: opts?.wpId,
    }),
  hide: () => set({ open: false, reason: null, next: null, slug: null, name: null, wpId: undefined }),
}));
