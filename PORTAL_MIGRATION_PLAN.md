# Partner Portal Migration Plan

## Source baseline
- Repository: `sigarammart/xplorepondy-webapp-007`
- Source branch: `feature/trip-planner-choice`
- Owner entry points: `src/routes/dashboard.tsx`, `src/routes/my-listings.tsx`, `src/routes/reservation-setup.tsx`, and owner event/experience routes.
- Shared WordPress backend: `https://xplorepondy.com`

## Architecture notes
The source app uses TanStack Start with Vite and Nitro server routes, not a static-only Vite SPA. The partner app must retain server-side handlers for authenticated owner operations. Do not convert protected server functions to browser requests.

## Migration sequence
1. Copy the selected source revision without production secrets or deployment credentials.
2. Keep owner functions and their required dependencies: Better Auth integration, WordPress owner-listing bridge, booking/event/experience APIs, UI primitives and styling.
3. Remove traveler-only routes and navigation. Retain only owner dashboard, listing management, reservation setup, supported event/experience owner workflows, login and required API handlers.
4. Regenerate the TanStack route tree from the resulting route files during build; do not hand-maintain stale generated route entries.
5. Update page metadata and app branding for Xplore Pondy Partner Portal. Remove traveler PWA/install behavior and do not ship the traveler service worker on this hostname.
6. Configure independent secrets and origin/callback allowlists for `https://partner.xplorepondy.com`; set `BETTER_AUTH_URL=https://partner.xplorepondy.com`, `VITE_AUTH_ENABLED=true`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `BETTER_AUTH_SECRET`, and `DATABASE_URL` in the partner deployment environment. Register `https://partner.xplorepondy.com` as the Google authorized JavaScript origin and `https://partner.xplorepondy.com/api/auth/callback/google` as the authorized redirect URI. Never reuse traveler-app secrets or commit `.env` files.
7. Validate typecheck, tests and production build. Test owners with one and multiple listings, unauthorized access, WordPress session bridge, OAuth, logout, bookings and mobile layouts.
8. Deploy to staging first; do not change `app.xplorepondy.com` production deployment during migration.

## Security constraints
- WordPress remains the source of truth for listings and bookings.
- Verify identity and listing/booking ownership server-side for every request.
- Never trust client-supplied user IDs, owner emails or listing IDs as authorization.
- Never commit app passwords, OAuth client secrets, HMAC bridge secret, database URLs or production environment files.

## Deployment status
Source repository and empty destination repository were verified. Initial destination README has been committed. Full source transfer and route pruning must be completed and build-validated before deployment.