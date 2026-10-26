import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme, type ColorMode } from "@/store/theme";

const OPTIONS: Array<{ mode: ColorMode; label: string; icon: typeof Moon }> = [
  { mode: "dark", label: "Dark", icon: Moon },
  { mode: "light", label: "Day", icon: Sun },
];

export function ThemeToggle({ className }: { className?: string }) {
  const mode = useTheme((s) => s.mode);
  const setMode = useTheme((s) => s.setMode);

  return (
    <div
      className={cn("flex overflow-hidden rounded-full ring-1 ring-border", className)}
      role="group"
      aria-label="Color mode"
    >
      {OPTIONS.map((opt) => {
        const Icon = opt.icon;
        const active = mode === opt.mode;
        return (
          <button
            key={opt.mode}
            type="button"
            onClick={() => setMode(opt.mode)}
            aria-pressed={active}
            aria-label={opt.label}
            title={opt.label}
            className={cn(
              "flex h-9 items-center gap-1.5 px-2.5 text-xs font-semibold transition-colors sm:px-3",
              active
                ? "bg-primary text-primary-foreground"
                : "bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-3.5" />
            <span className="hidden sm:inline">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
