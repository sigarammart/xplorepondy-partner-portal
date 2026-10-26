/* Minimal service worker for PWA installability. Network requests remain network-first. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
self.addEventListener("fetch", () => {
  // Intentionally leave requests to the browser's normal network handling.
});
