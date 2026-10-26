import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

export function NotFound() {
  return (
    <div className="flex flex-col items-center py-20 text-center">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">404</p>
      <h1 className="mt-2 font-display text-3xl font-semibold">That page isn’t on the map</h1>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">
        The street may have been renamed. Try Explore, or go back to the promenade.
      </p>
      <Button asChild className="mt-6">
        <Link to="/">Back home</Link>
      </Button>
    </div>
  );
}
