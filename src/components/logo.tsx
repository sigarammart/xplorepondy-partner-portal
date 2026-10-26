import { cn } from "@/lib/utils";

const PARTNER_LOGO_URL =
  "https://xplorepondy.com/wp-content/uploads/2026/10/Xplore-Pondy-Partner-Logo.png";

export function Logo({ className, mark = true }: { className?: string; mark?: boolean }) {
  return (
    <span className={cn("inline-flex min-w-0 items-center", className)}>
      <img
        src={PARTNER_LOGO_URL}
        alt="Xplore Pondy Partner"
        className={cn(
          "h-9 w-auto max-w-[13rem] object-contain object-left outline-none sm:h-10 sm:max-w-[15rem]",
          !mark && "h-7",
        )}
      />
    </span>
  );
}
