import { create } from "zustand";

export type ColorMode = "dark" | "light";

const STORAGE_KEY = "xp-color-mode";

export function readColorMode(): ColorMode {
  if (typeof window === "undefined") return "dark";
  try {
    return localStorage.getItem(STORAGE_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function applyColorMode(mode: ColorMode) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.toggle("light", mode === "light");
  root.classList.toggle("dark", mode === "dark");
  root.style.colorScheme = mode;
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* private mode */
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", mode === "light" ? "#1A5F66" : "#0b1213");
}

type ThemeState = {
  mode: ColorMode;
  hydrated: boolean;
  hydrate: () => void;
  setMode: (mode: ColorMode) => void;
  toggle: () => void;
};

export const useTheme = create<ThemeState>((set, get) => ({
  mode: "dark",
  hydrated: false,
  hydrate: () => {
    const mode = readColorMode();
    applyColorMode(mode);
    set({ mode, hydrated: true });
  },
  setMode: (mode) => {
    applyColorMode(mode);
    set({ mode });
  },
  toggle: () => {
    const mode = get().mode === "dark" ? "light" : "dark";
    applyColorMode(mode);
    set({ mode });
  },
}));
