# Xplore Pondy Rentals

Standalone WordPress plugin for bike and car rental inventory, public vehicle discovery and availability checks. It has no Listeo dependency and does not use the Listeo booking system.

## Current version

- Plugin: Xplore Pondy Rentals
- Version: 0.1.0
- Database schema: 1

## Database tables

- `{prefix}xp_rental_vehicles`: vehicle inventory and rental pricing
- `{prefix}xp_rental_bookings`: booking records and payment/status fields (booking-write workflow is not enabled in v0.1.0)
- `{prefix}xp_rental_blocks`: owner-created maintenance/unavailable time blocks (block-management endpoints are planned next)

Tables are created/updated on plugin activation and schema-version mismatch.

## Authentication

Partner endpoints use the established server-to-server WordPress bridge contract:

- `X-Xplore-PWA-Secret` (or Bearer token)
- `X-Xplore-PWA-User-Email`

The secret is read from `WP_SOCIAL_SESSION_BRIDGE_SECRET`. User identity is resolved by WordPress from the verified email header. Client-supplied owner IDs are ignored. Administrators can manage all vehicles; vendor/owner accounts can manage their own records only.

## REST API

Base namespace: `/wp-json/xplore-rentals/v1`

### Partner vehicle inventory

- `GET /partner/vehicles?page=1&per_page=20&vehicle_type=bike|car`
- `POST /partner/vehicles`
- `GET /partner/vehicles/{id}`
- `PATCH /partner/vehicles/{id}`
- `DELETE /partner/vehicles/{id}`

Partner-created vehicles start in `draft`. Only administrators can change the `status` field through the API. An owner cannot delete a vehicle with pending or confirmed bookings; deactivate it instead.

Vehicle creation requires `vehicle_type`, `brand`, `model`, and `price_per_day`. Optional fields include variant/year/fuel/transmission/engine_cc/seating_capacity, has_ac, helmets_included, description, hourly/daily/weekly pricing, security deposit, minimum duration, pickup location, delivery and image gallery URLs.

### Public catalogue

- `GET /vehicles?vehicle_type=bike|car&search=...`
- `GET /vehicles/{id}`

Only active vehicles are publicly returned. Public payloads do not contain owner user IDs, listing IDs, or private vehicle documents/registration numbers.

### Availability (advisory)

- `GET /availability?vehicle_id=123&pickup_datetime=2026-11-18%2010:00:00&return_datetime=2026-11-20%2010:00:00`

Datetimes are local WordPress timezone values in `YYYY-MM-DD HH:MM:SS` format. Pending/confirmed booking intervals and owner blocks are considered. This endpoint is advisory only: it does not reserve or hold a vehicle.

## Not included in v0.1.0

No booking creation/confirmation, payment capture, WooCommerce integration, vehicle upload endpoint, owner availability-block management API, cancellation/refund workflow, or frontend screens are enabled yet. These must be implemented and tested before accepting customer bookings or payments.
