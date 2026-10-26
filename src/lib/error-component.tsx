import type { ErrorComponentProps } from "@tanstack/react-router";
import { TriangleAlert, WifiOff } from "lucide-react";

const FALLBACK_MESSAGE = "An unexpected error occurred. Try reloading the page.";
const NETWORK_MESSAGE =
  "We couldn't connect to Xplore Pondy. Please check your internet or Wi-Fi connection, then try again. If you're already connected, refresh the page.";

function errorMessage(error: unknown): { message: string; offline: boolean } {
  // Error-like objects can carry a non-string or non-coercible message value.
  // Never pass such values to RegExp.test or render them directly in React.
  const rawMessage: unknown =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";

  const detail = typeof rawMessage === "string" ? rawMessage : "";

  if (
    /failed to fetch|networkerror|network request failed|load failed|err_internet_disconnected|internet disconnected|fetch failed/i.test(
      detail,
    )
  ) {
    return { message: NETWORK_MESSAGE, offline: true };
  }

  return { message: detail || FALLBACK_MESSAGE, offline: false };
}

export function AppErrorComponent({ error }: ErrorComponentProps) {
  const { message, offline } = errorMessage(error);

  return (
    <main
      className={
        "flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center " +
        "bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50"
      }
    >
      <span className="text-red-500" aria-hidden="true">
        {offline ? <WifiOff className="size-10" strokeWidth={2} /> : <TriangleAlert className="size-10" strokeWidth={2} />}
      </span>
      <h1 className="text-lg font-semibold">
        {offline ? "Connection lost" : "Something went wrong"}
      </h1>
      <p className="max-w-md text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
        {message}
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="mt-2 rounded-full bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        Try again
      </button>
    </main>
  );
}
