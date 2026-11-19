<?php
/**
 * Plugin Name: Xplore Stay Facilities
 * Description: Retrieves available Google Places attributes for Stay listings using their existing _place_id and stores reviewable Xplore facility suggestions.
 * Version: 1.0.0
 * Author: Xplore Pondy
 * Text Domain: xplore-stay-facilities
 */

if (!defined('ABSPATH')) {
    exit;
}

final class Xplore_Stay_Facilities {
    const VERSION = '1.0.0';
    const OPTION_KEY = 'xplore_stay_facilities_google_api_key';
    const RAW_META = '_xplore_google_place_details';
    const SUGGESTIONS_META = '_xplore_stay_facility_suggestions';
    const SYNCED_META = '_xplore_stay_facilities_synced_at';
    const ERROR_META = '_xplore_stay_facilities_sync_error';
    const REST_NAMESPACE = 'xplore-stay/v1';

    public static function init() {
        add_action('admin_menu', [__CLASS__, 'admin_menu']);
        add_action('add_meta_boxes', [__CLASS__, 'add_meta_box']);
        add_action('admin_enqueue_scripts', [__CLASS__, 'admin_assets']);
        add_action('admin_post_xplore_stay_facilities_sync', [__CLASS__, 'handle_sync']);
        add_action('rest_api_init', [__CLASS__, 'register_routes']);
    }

    public static function admin_menu() {
        add_options_page(
            __('Xplore Stay Facilities', 'xplore-stay-facilities'),
            __('Stay Facilities', 'xplore-stay-facilities'),
            'manage_options',
            'xplore-stay-facilities',
            [__CLASS__, 'settings_page']
        );
    }

    public static function settings_page() {
        if (!current_user_can('manage_options')) {
            return;
        }

        if (isset($_POST['xplore_stay_facilities_save'])) {
            check_admin_referer('xplore_stay_facilities_settings');
            $key = isset($_POST['google_api_key']) ? sanitize_text_field(wp_unslash($_POST['google_api_key'])) : '';
            update_option(self::OPTION_KEY, $key, false);
            echo '<div class="notice notice-success is-dismissible"><p>' . esc_html__('Settings saved.', 'xplore-stay-facilities') . '</p></div>';
        }

        $api_key = (string) get_option(self::OPTION_KEY, '');
        ?>
        <div class="wrap">
            <h1><?php esc_html_e('Xplore Stay Facilities', 'xplore-stay-facilities'); ?></h1>
            <p><?php esc_html_e('Connect an existing Stay listing to Google Places using its _place_id. This plugin retrieves supported Place Details fields and prepares facility suggestions for an administrator to review.', 'xplore-stay-facilities'); ?></p>
            <form method="post">
                <?php wp_nonce_field('xplore_stay_facilities_settings'); ?>
                <table class="form-table" role="presentation">
                    <tr>
                        <th scope="row"><label for="google_api_key"><?php esc_html_e('Google Places API key', 'xplore-stay-facilities'); ?></label></th>
                        <td>
                            <input type="password" class="regular-text" id="google_api_key" name="google_api_key" value="<?php echo esc_attr($api_key); ?>" autocomplete="new-password">
                            <p class="description"><?php esc_html_e('Use a server-side key with Places API (New) enabled. Restrict it to your server IP and the Places API. The key is stored in WordPress options and is never sent to the browser.', 'xplore-stay-facilities'); ?></p>
                        </td>
                    </tr>
                </table>
                <?php submit_button(__('Save API Key', 'xplore-stay-facilities'), 'primary', 'xplore_stay_facilities_save'); ?>
            </form>
            <h2><?php esc_html_e('How it works', 'xplore-stay-facilities'); ?></h2>
            <ol>
                <li><?php esc_html_e('Open a Stay listing in WordPress admin.', 'xplore-stay-facilities'); ?></li>
                <li><?php esc_html_e('Use the Google Place Facilities panel to fetch data using the existing _place_id field.', 'xplore-stay-facilities'); ?></li>
                <li><?php esc_html_e('Review the suggestions. They are saved separately and do not overwrite existing JetEngine facilities.', 'xplore-stay-facilities'); ?></li>
            </ol>
            <p><strong><?php esc_html_e('Important:', 'xplore-stay-facilities'); ?></strong> <?php esc_html_e('Google Places does not expose a complete hotel amenity inventory. Missing facilities such as room service, spa, gym or breakfast must be verified from another source or by the listing owner.', 'xplore-stay-facilities'); ?></p>
        </div>
        <?php
    }

    public static function add_meta_box() {
        add_meta_box(
            'xplore_stay_facilities_google',
            __('Google Place Facilities', 'xplore-stay-facilities'),
            [__CLASS__, 'render_meta_box'],
            'listing',
            'side',
            'default'
        );
    }

    public static function render_meta_box($post) {
        if (!current_user_can('edit_post', $post->ID)) {
            return;
        }

        $place_id = self::get_place_id($post->ID);
        $suggestions = get_post_meta($post->ID, self::SUGGESTIONS_META, true);
        $synced_at = get_post_meta($post->ID, self::SYNCED_META, true);
        $error = get_post_meta($post->ID, self::ERROR_META, true);
        $raw = get_post_meta($post->ID, self::RAW_META, true);
        $action_url = admin_url('admin-post.php');
        ?>
        <p><strong><?php esc_html_e('Existing Place ID', 'xplore-stay-facilities'); ?></strong></p>
        <?php if ($place_id) : ?>
            <code style="display:block;overflow-wrap:anywhere;"><?php echo esc_html($place_id); ?></code>
        <?php else : ?>
            <p class="description"><?php esc_html_e('No _place_id value was found on this listing.', 'xplore-stay-facilities'); ?></p>
        <?php endif; ?>

        <form method="post" action="<?php echo esc_url($action_url); ?>">
            <input type="hidden" name="action" value="xplore_stay_facilities_sync">
            <input type="hidden" name="listing_id" value="<?php echo esc_attr($post->ID); ?>">
            <?php wp_nonce_field('xplore_stay_facilities_sync_' . $post->ID); ?>
            <?php submit_button(__('Fetch Google Facilities', 'xplore-stay-facilities'), 'secondary', 'submit', false, ['disabled' => !$place_id || !get_option(self::OPTION_KEY)]); ?>
        </form>

        <?php if (!get_option(self::OPTION_KEY)) : ?>
            <p class="description"><?php esc_html_e('Add your Google Places API key under Settings → Stay Facilities first.', 'xplore-stay-facilities'); ?></p>
        <?php endif; ?>

        <?php if ($synced_at) : ?>
            <p class="description"><?php echo esc_html(sprintf(__('Last fetched: %s', 'xplore-stay-facilities'), $synced_at)); ?></p>
        <?php endif; ?>
        <?php if ($error) : ?>
            <div class="notice notice-error inline"><p><?php echo esc_html($error); ?></p></div>
        <?php endif; ?>

        <?php if (is_array($suggestions) && $suggestions) : ?>
            <hr>
            <p><strong><?php esc_html_e('Facility suggestions', 'xplore-stay-facilities'); ?></strong></p>
            <ul style="margin-left:18px;list-style:disc;">
                <?php foreach ($suggestions as $suggestion) : ?>
                    <li><?php echo esc_html($suggestion['label'] ?? $suggestion['id'] ?? ''); ?>
                        <?php if (!empty($suggestion['detail'])) : ?><span class="description"> — <?php echo esc_html($suggestion['detail']); ?></span><?php endif; ?>
                    </li>
                <?php endforeach; ?>
            </ul>
            <p class="description"><?php esc_html_e('These are suggestions only. Review and add the verified items to the listing’s existing JetEngine facilities field.', 'xplore-stay-facilities'); ?></p>
        <?php elseif (is_array($raw) && !empty($raw)) : ?>
            <p class="description"><?php esc_html_e('Google returned details, but no mapped facility attributes were found.', 'xplore-stay-facilities'); ?></p>
        <?php endif; ?>
        <?php
    }

    public static function admin_assets($hook) {
        if (!in_array($hook, ['post.php', 'post-new.php'], true)) {
            return;
        }
        $screen = function_exists('get_current_screen') ? get_current_screen() : null;
        if (!$screen || $screen->post_type !== 'listing') {
            return;
        }
        wp_add_inline_style('common', '#xplore_stay_facilities_google .notice{margin:8px 0;}#xplore_stay_facilities_google code{white-space:normal;}');
    }

    public static function handle_sync() {
        $listing_id = isset($_POST['listing_id']) ? absint($_POST['listing_id']) : 0;
        if (!$listing_id || get_post_type($listing_id) !== 'listing') {
            wp_die(esc_html__('Invalid Stay listing.', 'xplore-stay-facilities'), '', ['response' => 400]);
        }
        if (!current_user_can('edit_post', $listing_id) || !current_user_can('manage_options')) {
            wp_die(esc_html__('You are not allowed to fetch Google facilities.', 'xplore-stay-facilities'), '', ['response' => 403]);
        }
        check_admin_referer('xplore_stay_facilities_sync_' . $listing_id);

        $result = self::sync_listing($listing_id);
        $redirect = get_edit_post_link($listing_id, 'url');
        if (!$redirect) {
            $redirect = admin_url('post.php?post=' . $listing_id . '&action=edit');
        }
        wp_safe_redirect(add_query_arg('xplore_facilities_result', is_wp_error($result) ? 'error' : 'success', $redirect));
        exit;
    }

    public static function register_routes() {
        register_rest_route(self::REST_NAMESPACE, '/listing/(?P<id>\d+)/facilities', [
            'methods' => WP_REST_Server::READABLE,
            'callback' => [__CLASS__, 'rest_get_suggestions'],
            'permission_callback' => static function () {
                return current_user_can('manage_options');
            },
            'args' => [
                'id' => ['sanitize_callback' => 'absint', 'validate_callback' => static function ($value) { return absint($value) > 0; }],
            ],
        ]);
        register_rest_route(self::REST_NAMESPACE, '/listing/(?P<id>\d+)/sync', [
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => [__CLASS__, 'rest_sync_listing'],
            'permission_callback' => static function () {
                return current_user_can('manage_options');
            },
            'args' => [
                'id' => ['sanitize_callback' => 'absint', 'validate_callback' => static function ($value) { return absint($value) > 0; }],
            ],
        ]);
    }

    public static function rest_get_suggestions(WP_REST_Request $request) {
        $listing_id = absint($request['id']);
        if (get_post_type($listing_id) !== 'listing') {
            return new WP_Error('xplore_stay_listing_not_found', __('Stay listing not found.', 'xplore-stay-facilities'), ['status' => 404]);
        }
        return rest_ensure_response([
            'listing_id' => $listing_id,
            'place_id' => self::get_place_id($listing_id),
            'suggestions' => get_post_meta($listing_id, self::SUGGESTIONS_META, true) ?: [],
            'synced_at' => get_post_meta($listing_id, self::SYNCED_META, true) ?: null,
        ]);
    }

    public static function rest_sync_listing(WP_REST_Request $request) {
        $listing_id = absint($request['id']);
        $result = self::sync_listing($listing_id);
        if (is_wp_error($result)) {
            return $result;
        }
        return rest_ensure_response($result);
    }

    public static function sync_listing($listing_id) {
        $listing_id = absint($listing_id);
        if (!$listing_id || get_post_type($listing_id) !== 'listing') {
            return new WP_Error('xplore_stay_listing_not_found', __('Stay listing not found.', 'xplore-stay-facilities'), ['status' => 404]);
        }
        if (!current_user_can('manage_options')) {
            return new WP_Error('xplore_stay_forbidden', __('Only administrators can sync Google facilities.', 'xplore-stay-facilities'), ['status' => 403]);
        }

        $api_key = trim((string) get_option(self::OPTION_KEY, ''));
        if (!$api_key) {
            return new WP_Error('xplore_stay_google_key_missing', __('Google Places API key is not configured. Open Settings → Stay Facilities.', 'xplore-stay-facilities'), ['status' => 400]);
        }

        $place_id = self::get_place_id($listing_id);
        if (!$place_id) {
            return new WP_Error('xplore_stay_place_id_missing', __('This listing has no usable _place_id value.', 'xplore-stay-facilities'), ['status' => 400]);
        }

        $url = 'https://places.googleapis.com/v1/places/' . rawurlencode($place_id);
        $response = wp_remote_get($url, [
            'timeout' => 20,
            'redirection' => 2,
            'headers' => [
                'X-Goog-Api-Key' => $api_key,
                'X-Goog-FieldMask' => implode(',', self::field_mask()),
            ],
        ]);

        if (is_wp_error($response)) {
            self::save_error($listing_id, $response->get_error_message());
            return new WP_Error('xplore_stay_google_request_failed', __('Google Places request failed. Check the server connection and API configuration.', 'xplore-stay-facilities'), ['status' => 502]);
        }

        $status = (int) wp_remote_retrieve_response_code($response);
        $body = json_decode(wp_remote_retrieve_body($response), true);
        if ($status < 200 || $status >= 300 || !is_array($body)) {
            $google_message = is_array($body) ? sanitize_text_field($body['error']['message'] ?? '') : '';
            $message = $google_message ?: sprintf(__('Google Places returned HTTP %d.', 'xplore-stay-facilities'), $status);
            self::save_error($listing_id, $message);
            return new WP_Error('xplore_stay_google_api_error', $message, ['status' => $status >= 400 && $status < 600 ? $status : 502]);
        }

        $suggestions = self::map_facilities($body);
        update_post_meta($listing_id, self::RAW_META, $body);
        update_post_meta($listing_id, self::SUGGESTIONS_META, $suggestions);
        update_post_meta($listing_id, self::SYNCED_META, current_time('mysql'));
        delete_post_meta($listing_id, self::ERROR_META);

        return [
            'ok' => true,
            'listing_id' => $listing_id,
            'place_id' => $place_id,
            'place_name' => sanitize_text_field($body['displayName']['text'] ?? ''),
            'suggestions' => $suggestions,
            'synced_at' => get_post_meta($listing_id, self::SYNCED_META, true),
        ];
    }

    private static function get_place_id($listing_id) {
        $value = get_post_meta($listing_id, '_place_id', true);
        if (is_array($value)) {
            $value = reset($value);
        }
        if (is_array($value) || is_object($value)) {
            return '';
        }
        return sanitize_text_field((string) $value);
    }

    private static function field_mask() {
        // These are supported Places API (New) fields. No field mask wildcard:
        // requesting only needed fields keeps billing predictable.
        return [
            'id',
            'displayName',
            'formattedAddress',
            'location',
            'rating',
            'userRatingCount',
            'websiteUri',
            'nationalPhoneNumber',
            'accessibilityOptions',
            'parkingOptions',
            'paymentOptions',
            'allowsDogs',
            'restroom',
            'goodForChildren',
            'goodForGroups',
            'outdoorSeating',
            'liveMusic',
            'servesBreakfast',
            'servesLunch',
            'servesDinner',
            'servesBeer',
            'servesWine',
            'servesVegetarianFood',
            'servesBrunch',
            'reservable',
            'takeout',
            'delivery',
        ];
    }

    private static function map_facilities($place) {
        $map = [
            


            'wheelchair_accessibility' => ['label' => 'Wheelchair accessibility', 'path' => 'accessibilityOptions'],
            'parking' => ['label' => 'Parking', 'path' => 'parkingOptions'],
            'payment_options' => ['label' => 'Payment options', 'path' => 'paymentOptions'],
            'pet_friendly' => ['label' => 'Pets allowed', 'path' => 'allowsDogs'],
            'restroom' => ['label' => 'Restroom', 'path' => 'restroom'],
            'serves_brunch' => ['label' => 'Serves brunch', 'path' => 'servesBrunch'],
            'reservable' => ['label' => 'Reservations available', 'path' => 'reservable'],
            'takeout' => ['label' => 'Takeout available', 'path' => 'takeout'],
            'delivery' => ['label' => 'Delivery available', 'path' => 'delivery'],
            'family_friendly' => ['label' => 'Good for children', 'path' => 'goodForChildren'],
            'group_friendly' => ['label' => 'Good for groups', 'path' => 'goodForGroups'],
            'outdoor_seating' => ['label' => 'Outdoor seating', 'path' => 'outdoorSeating'],
            'breakfast' => ['label' => 'Serves breakfast', 'path' => 'servesBreakfast'],
            'serves_lunch' => ['label' => 'Serves lunch', 'path' => 'servesLunch'],
            'serves_dinner' => ['label' => 'Serves dinner', 'path' => 'servesDinner'],
            'vegetarian_food' => ['label' => 'Vegetarian food', 'path' => 'servesVegetarianFood'],
            'serves_beer' => ['label' => 'Serves beer', 'path' => 'servesBeer'],
            'serves_wine' => ['label' => 'Serves wine', 'path' => 'servesWine'],
            'live_music' => ['label' => 'Live music', 'path' => 'liveMusic'],
        ];

        $suggestions = [];
        foreach ($map as $id => $config) {
            $path = $config['path'];
            if ($path === null) {
                continue;
            }
            $value = self::array_get($place, $path);
            if (self::has_positive_value($value)) {
                $suggestions[] = [
                    'id' => $id,
                    'label' => $config['label'],
                    'source' => 'google_places',
                    'detail' => self::describe_value($id, $value),
                    'value' => $value,
                ];
            }
        }
        return $suggestions;
    }

    private static function describe_value($id, $value) {
        if (!is_array($value)) return '';
        if ($id === 'parking') {
            $labels = [
                'freeParkingLot' => 'Free parking lot',
                'paidParkingLot' => 'Paid parking lot',
                'freeStreetParking' => 'Free street parking',
                'paidStreetParking' => 'Paid street parking',
                'valetParking' => 'Valet parking',
                'freeGarageParking' => 'Free garage parking',
                'paidGarageParking' => 'Paid garage parking',
            ];
            $found = [];
            foreach ($labels as $key => $label) {
                if (!empty($value[$key])) $found[] = $label;
            }
            return implode(', ', $found);
        }
        if ($id === 'wheelchair_accessibility') {
            $labels = [
                'wheelchairAccessibleParking' => 'Accessible parking',
                'wheelchairAccessibleEntrance' => 'Accessible entrance',
                'wheelchairAccessibleRestroom' => 'Accessible restroom',
                'wheelchairAccessibleSeating' => 'Accessible seating',
            ];
            $found = [];
            foreach ($labels as $key => $label) {
                if (!empty($value[$key])) $found[] = $label;
            }
            return implode(', ', $found);
        }
        if ($id === 'payment_options') {
            $labels = [
                'acceptsCreditCards' => 'Credit cards',
                'acceptsDebitCards' => 'Debit cards',
                'acceptsCashOnly' => 'Cash only',
                'acceptsNfc' => 'Contactless/NFC',
            ];
            $found = [];
            foreach ($labels as $key => $label) {
                if (!empty($value[$key])) $found[] = $label;
            }
            return implode(', ', $found);
        }
        return '';
    }

    private static function array_get($array, $path) {
        if (!is_array($array)) return null;
        $value = $array;
        foreach (explode('.', (string) $path) as $segment) {
            if (!is_array($value) || !array_key_exists($segment, $value)) return null;
            $value = $value[$segment];
        }
        return $value;
    }

    private static function has_positive_value($value) {
        if (is_bool($value)) {
            return $value;
        }
        if (is_array($value)) {
            foreach ($value as $item) {
                if (self::has_positive_value($item)) {
                    return true;
                }
            }
        }
        return false;
    }

    private static function save_error($listing_id, $message) {
        update_post_meta($listing_id, self::ERROR_META, sanitize_text_field($message));
    }
}

Xplore_Stay_Facilities::init();
