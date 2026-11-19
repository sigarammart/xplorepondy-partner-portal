=== Xplore Stay Facilities ===
Contributors: xplorepondy
Tags: google-places, hotels, facilities, jetengine
Requires at least: 6.0
Tested up to: 6.8
Requires PHP: 7.4
Stable tag: 1.0.0
License: GPLv2 or later

Fetch supported Google Places (New) attributes for existing Stay listings using the listing's existing _place_id field. Stores the raw Place Details response and normalized facility suggestions separately; it does not overwrite existing listing fields or JetEngine taxonomies.

== Installation ==

1. Upload/activate the xplore-stay-facilities plugin.
2. Enable Places API (New) for a Google Cloud project and configure billing.
3. Create a server-side API key restricted to your server IP and Places API.
4. Open Settings → Stay Facilities and save the key.
5. Edit a listing post and use the Google Place Facilities panel.

== Notes ==

Google Places does not provide a complete lodging amenity inventory. Only fields supported by Places API (New) are requested. A missing suggestion does not mean the property does not have that facility. Suggestions must be reviewed and copied to the existing Stay facilities field after verification.

The current release stores data in:
- _xplore_google_place_details
- _xplore_stay_facility_suggestions
- _xplore_stay_facilities_synced_at
- _xplore_stay_facilities_sync_error

REST (administrator only):
- GET /wp-json/xplore-stay/v1/listing/{id}/facilities
- POST /wp-json/xplore-stay/v1/listing/{id}/sync
