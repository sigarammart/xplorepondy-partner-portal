import { createFileRoute } from "@tanstack/react-router";
import { auth } from "@/lib/auth/server";

async function handleAuthRequest(request: Request): Promise<Response> {
  try {
    return await auth.handler(request);
  } catch (error) {
    // OAuth callback failures can otherwise surface as a generic 500/HTTPError.
    // Log the server-side error without logging the callback query string,
    // which may contain OAuth authorization codes or state values.
    if (error instanceof Error) {
      console.error("[auth] Better Auth request failed", {
        method: request.method,
        pathname: new URL(request.url).pathname,
        name: error.name,
        message: error.message,
        stack: error.stack,
        cause: error.cause instanceof Error
          ? { name: error.cause.name, message: error.cause.message }
          : error.cause,
      });
    } else {
      console.error("[auth] Better Auth request failed", {
        method: request.method,
        pathname: new URL(request.url).pathname,
        error,
      });
    }
    throw error;
  }
}

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: ({ request }) => handleAuthRequest(request),
      POST: ({ request }) => handleAuthRequest(request),
    },
  },
});
