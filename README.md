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