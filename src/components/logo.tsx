import { cn } from "@/lib/utils";

export function Logo({ className, mark = true }: { className?: string; mark?: boolean }) {
  return (
    <span className={cn("inline-flex items-center rounded-lg bg-logo-bg px-2 py-1", className)}>
      <img
        src="/images/xplore-pondy-logo.webp"
        alt="Xplore Pondy"
        className={cn(
          "h-8 w-auto max-w-[10.5rem] object-contain object-left outline-none sm:h-9 sm:max-w-[12rem]",
          !mark && "h-7",
        )}
      />
    </span>
  );
}
