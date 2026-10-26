import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { useEffect } from "react";
import { AuthProvider } from "@/lib/auth/provider";
import { PreviewHostBridge } from "@/components/preview-host-bridge";
import { CacheWorker } from "@/components/cache-worker";
import { AppShell } from "@/components/layout";
import { NotFound } from "@/components/not-found";
import { Toaster } from "sonner";
import { useTrip } from "@/store/trip";
import { useSession } from "@/store/session";
import { useTheme } from "@/store/theme";
import { useGeo } from "@/store/geo";
import "../styles.css";

const APP_NAME = "Xplore Pondy Partner Portal";
const PWA_NAME = "Xplore Partner";

const THEME_BOOT = `(function(){try{var m=localStorage.getItem("xp-color-mode");var r=document.documentElement;if(m==="light"){r.classList.add("light");r.classList.remove("dark")}else{r.classList.add("dark");r.classList.remove("light")}}catch(e){}})();`;

export const Route = createRootRoute({
  notFoundComponent: NotFound,
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: APP_NAME },
      {
        name: "description",
        content:
          "Manage your Xplore Pondy business listings, reservations, events, experiences, and owner tools.",
      },
      { name: "theme-color", content: "#0b1213" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-title", content: PWA_NAME },
      { name: "application-name", content: PWA_NAME },
    ],
    links: [
      { rel: "icon", href: "/favicon.ico", sizes: "48x48" },
      { rel: "icon", type: "image/png", sizes: "32x32", href: "/favicon-32.png" },
      { rel: "icon", type: "image/png", sizes: "192x192", href: "/icon-192.png" },
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Figtree:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&display=swap",
      },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
    ],
  }),
  component: RootDocument,
});

function RootDocument() {
  const mode = useTheme((s) => s.mode);
  const hydrateGeo = useGeo((s) => s.hydrate);

  // Do not hydrate the entire listing directory at app startup. Listing data is
  // loaded on demand by Explore category/subcategory pages.
  useEffect(() => {
    void useTrip.persist.rehydrate();
    void useSession.persist.rehydrate();
    hydrateGeo();
  }, []);

  return (
    <html lang="en" className="dark antialiased" suppressHydrationWarning>
      <head>
        <HeadContent />
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body>
        <PreviewHostBridge />
        <CacheWorker />
        <AuthProvider>
          <AppShell>
            <Outlet />
          </AppShell>
          <Toaster
            theme={mode}
            position="top-center"
            toastOptions={{
              className: "font-sans",
            }}
          />
        </AuthProvider>
        <Scripts />
      </body>
    </html>
  );
}
