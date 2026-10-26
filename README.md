# Xplore Pondy Partner Portal

Dedicated business-owner portal for `partner.xplorepondy.com`.

This repository will host the owner dashboard migrated from the Xplore Pondy React/TanStack Start application. It will share the existing WordPress/Listeo/JetEngine backend and must enforce all owner permissions server-side.

## Migration status

- Repository initialized.
- Owner dashboard migration source: `sigarammart/xplorepondy-webapp-007`, branch `feature/trip-planner-choice`.
- Production traveler app remains separate and must not be changed as part of this project.
- Do not commit `.env` files, app passwords, OAuth secrets, or production database credentials.

## Architecture

- React 19 + Vite 8 + TanStack Start + Nitro.
- Shared WordPress API at `https://xplorepondy.com`.
- Owner features: listing submissions/edits, reservation management, and supported event/experience owner workflows.
- Separate deployment and authentication configuration for the partner hostname.

## Deployment prerequisite

Configure production secrets and callback/origin allowlists specifically for `https://partner.xplorepondy.com` before enabling sign-in. Verify listing ownership and booking access on the server before public launch.

## Partner production environment (Hostinger)

Set these environment variables on the **partner portal deployment only**:

- `BETTER_AUTH_URL=https://partner.xplorepondy.com`
- `VITE_AUTH_ENABLED=true`
- `GOOGLE_OAUTH_CLIENT_ID=<Google OAuth 2.0 client ID>`
- `GOOGLE_OAUTH_CLIENT_SECRET=<Google OAuth 2.0 client secret>`
- `BETTER_AUTH_SECRET=<a unique, strong random secret for this portal>`
- `DATABASE_URL=<the portal's production PostgreSQL connection string>`

The Google OAuth 2.0 Web application must authorize this exact redirect URI:

`https://partner.xplorepondy.com/api/auth/callback/google`

Add `https://partner.xplorepondy.com` as an authorized JavaScript origin as well. Do not reuse the traveler app's `BETTER_AUTH_URL`, database, or session secret. Keep secrets in Hostinger environment settings, never in Git. Redeploy after setting them.
