<?php
/**
 * Plugin Name: Xplore Listing Verification
 * Description: Displays verified and unverified listing status and provides an in-app claim bridge for Xplore Pondy.
 * Version: 1.4.6
 * Author: Xplore Pondy
 * Text Domain: xplore-listing-verification
 */

if (!defined('ABSPATH')) {
    exit;
}

if (!class_exists('XPLORE_Listing_Verification')) {
    final class XPLORE_Listing_Verification {
        const VERSION = '1.4.6';
        const SHORTCODE = 'xplore_listing_verification';
        const TABLE_SUFFIX = 'xplore_listing_claims';

        public static function init() {
            add_shortcode(self::SHORTCODE, [__CLASS__, 'render_shortcode']);
            add_filter('the_content', [__CLASS__, 'append_to_listing_content'], 20);
            add_action('wp_enqueue_scripts', [__CLASS__, 'register_styles']);
            add_action('admin_menu', [__CLASS__, 'admin_menu']);
            // Keep the legacy CPT registered for backwards compatibility,
            // but do not query/migrate legacy claims during normal requests.
            add_action('init', [__CLASS__, 'register_claim_post_type']);
            add_action('rest_api_init', [__CLASS__, 'register_claim_routes']);
        }

        private static function table_name() {
            global $wpdb;
            return $wpdb->prefix . self::TABLE_SUFFIX;
        }

        public static function ensure_claim_table() {
            global $wpdb;

            $table = self::table_name();
            $charset = $wpdb->get_charset_collate();

            // Do not run dbDelta() on every claim if the table already exists.
            // More importantly, verify the table actually exists before trying
            // to insert. This turns a missing-table failure into a controlled
            // REST error instead of an HTTP 500/HTML critical-error response.
            $exists = $wpdb->get_var($wpdb->prepare(
                'SHOW TABLES LIKE %s',
                $table
            ));

            if ($exists === $table) {
                return true;
            }

            $sql = "CREATE TABLE IF NOT EXISTS {$table} (
                id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
                listing_id bigint(20) unsigned NOT NULL,
                first_name varchar(60) NOT NULL,
                last_name varchar(60) NOT NULL,
                email varchar(120) NOT NULL,
                phone varchar(30) NOT NULL DEFAULT '',
                details text NOT NULL,
                status varchar(20) NOT NULL DEFAULT 'pending',
                admin_read_at datetime NULL DEFAULT NULL,
                created_at datetime NOT NULL,
                updated_at datetime NOT NULL,
                PRIMARY KEY  (id),
                KEY listing_id (listing_id),
                KEY email (email),
                KEY status (status),
                KEY admin_read_at (admin_read_at),
                KEY created_at (created_at)
            ) {$charset};";

            $created = $wpdb->query($sql);

            if ($created === false) {
                error_log('[Xplore Listing Verification] Claim table creation failed: ' . $wpdb->last_error);
                return false;
            }

            $exists = $wpdb->get_var($wpdb->prepare(
                'SHOW TABLES LIKE %s',
                $table
            ));

            if ($exists !== $table) {
                error_log('[Xplore Listing Verification] Claim table is still missing after creation attempt: ' . $table);
                return false;
            }

            return true;
        }

        /**
         * One-time migration from the previous CPT implementation.
         * Existing claims are copied into the dedicated table so the API can
         * continue working without relying on wp_insert_post/get_posts.
         */
        public static function maybe_migrate_legacy_claims() {
            if (get_option('xplore_listing_verification_claims_migrated_v13', '0') === '1') {
                return;
            }

            global $wpdb;
            $table = self::table_name();

            $legacy_ids = get_posts([
                'post_type' => 'xplore_listing_claim',
                'post_status' => 'publish',
                'posts_per_page' => -1,
                'fields' => 'ids',
            ]);

            foreach ($legacy_ids as $legacy_id) {
                $exists = $wpdb->get_var($wpdb->prepare(
                    "SELECT id FROM {$table} WHERE listing_id = %d AND email = %s AND created_at = %s LIMIT 1",
                    (int) get_post_meta($legacy_id, '_listing_id', true),
                    (string) get_post_meta($legacy_id, '_email', true),
                    get_post_time('Y-m-d H:i:s', false, $legacy_id)
                ));

                if ($exists) {
                    continue;
                }

                $created = get_post_time('Y-m-d H:i:s', false, $legacy_id);
                $wpdb->insert($table, [
                    'listing_id' => (int) get_post_meta($legacy_id, '_listing_id', true),
                    'first_name' => (string) get_post_meta($legacy_id, '_first_name', true),
                    'last_name' => (string) get_post_meta($legacy_id, '_last_name', true),
                    'email' => (string) get_post_meta($legacy_id, '_email', true),
                    'phone' => (string) get_post_meta($legacy_id, '_phone', true),
                    'details' => (string) get_post_meta($legacy_id, '_details', true),
                    'status' => (string) get_post_meta($legacy_id, '_claim_status', true) ?: 'pending',
                    'admin_read_at' => (string) get_post_meta($legacy_id, '_admin_read_at', true) ?: null,
                    'created_at' => $created ?: current_time('mysql'),
                    'updated_at' => $created ?: current_time('mysql'),
                ]);
            }

            update_option('xplore_listing_verification_claims_migrated_v13', '1', false);
        }

        private static function is_listing($post_id) {
            return $post_id > 0 && get_post_type($post_id) === 'listing';
        }

        public static function is_verified($post_id) {
            $value = get_post_meta($post_id, '_verified', true);

            if (is_array($value)) {
                $value = reset($value);
            }

            if (is_bool($value)) {
                return $value;
            }

            if (is_numeric($value)) {
                return (int) $value === 1;
            }

            return in_array(
                strtolower(trim((string) $value)),
                ['1', 'yes', 'true', 'on', 'verified'],
                true
            );
        }

        public static function render($post_id, $args = []) {
            $post_id = absint($post_id);

            if (!self::is_listing($post_id)) {
                return '';
            }

            $args = wp_parse_args($args, [
                'show_verified' => 'yes',
                'show_claim' => 'yes',
                'class' => '',
            ]);

            $classes = ['xplore-listing-verification'];

            if (!empty($args['class'])) {
                $classes[] = sanitize_html_class($args['class']);
            }

            $output = '<div class="' . esc_attr(implode(' ', $classes)) . '" data-listing-id="' . esc_attr($post_id) . '">';

            if (self::is_verified($post_id)) {
                if ($args['show_verified'] === 'yes') {
                    $output .= '<span class="xplore-listing-verification__badge xplore-listing-verification__badge--verified">';
                    $output .= '<span class="xplore-listing-verification__icon" aria-hidden="true">✓</span>';
                    $output .= esc_html__('Verified', 'xplore-listing-verification');
                    $output .= '</span>';
                }
            } else {
                $output .= '<span class="xplore-listing-verification__badge xplore-listing-verification__badge--unverified">';
                $output .= esc_html__('Not Verified', 'xplore-listing-verification');
                $output .= '</span>';

                if ($args['show_claim'] === 'yes') {
                    $claim_url = add_query_arg('xplore_claim', '1', get_permalink($post_id));
                    $output .= '<a class="xplore-listing-verification__claim" href="' . esc_url($claim_url) . '">';
                    $output .= esc_html__('Claim this listing', 'xplore-listing-verification');
                    $output .= '</a>';
                }
            }

            return $output . '</div>';
        }

        public static function render_shortcode($atts = []) {
            $atts = shortcode_atts([
                'id' => 0,
                'show_verified' => 'yes',
                'show_claim' => 'yes',
                'class' => '',
            ], $atts, self::SHORTCODE);

            $post_id = absint($atts['id']) ?: get_the_ID();

            return self::render($post_id, $atts);
        }

        public static function append_to_listing_content($content) {
            if (!is_singular('listing') || !in_the_loop() || !is_main_query()) {
                return $content;
            }

            if (get_option('xplore_listing_verification_auto_insert', '0') !== '1') {
                return $content;
            }

            if (strpos($content, 'xplore-listing-verification') !== false) {
                return $content;
            }

            return self::render(get_the_ID()) . $content;
        }

        public static function register_styles() {
            wp_register_style('xplore-listing-verification', false, [], self::VERSION);
            wp_enqueue_style('xplore-listing-verification');

            wp_add_inline_style('xplore-listing-verification', '
                .xplore-listing-verification {
                    display: flex;
                    flex-wrap: wrap;
                    align-items: center;
                    gap: 7px;
                    min-width: 0;
                }
                .xplore-listing-verification__badge {
                    display: inline-flex;
                    align-items: center;
                    gap: 5px;
                    width: fit-content;
                    max-width: 100%;
                    padding: 4px 9px;
                    border-radius: 999px;
                    font-size: 11px;
                    font-weight: 700;
                    line-height: 1.35;
                    white-space: nowrap;
                }
                .xplore-listing-verification__badge--verified {
                    color: #087443;
                    background: #e8f7ef;
                    border: 1px solid #b7e5ca;
                }
                .xplore-listing-verification__badge--unverified {
                    color: #925b08;
                    background: #fff6df;
                    border: 1px solid #f0d89b;
                }
                .xplore-listing-verification__icon {
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    width: 14px;
                    height: 14px;
                    border-radius: 50%;
                    color: #fff;
                    background: #0b9157;
                    font-size: 10px;
                    line-height: 1;
                }
                .xplore-listing-verification__claim {
                    color: var(--e-global-color-primary, #087ea4);
                    font-size: 11px;
                    font-weight: 700;
                    line-height: 1.35;
                    text-decoration: none;
                }
                .xplore-listing-verification__claim:hover,
                .xplore-listing-verification__claim:focus {
                    text-decoration: underline;
                    text-underline-offset: 2px;
                }
            ');
        }

        public static function register_claim_post_type() {
            register_post_type('xplore_listing_claim', [
                'labels' => [
                    'name' => __('Listing Claims', 'xplore-listing-verification'),
                    'singular_name' => __('Listing Claim', 'xplore-listing-verification'),
                ],
                'public' => false,
                'show_ui' => false,
                'show_in_menu' => false,
                'supports' => ['title'],
                'capability_type' => 'post',
                'map_meta_cap' => true,
            ]);
        }

        private static function bridge_secret() {
            $secret = defined('WP_SOCIAL_SESSION_BRIDGE_SECRET')
                ? (string) WP_SOCIAL_SESSION_BRIDGE_SECRET
                : (string) get_option('xplore_listing_verification_bridge_secret', '');
            return trim($secret);
        }

        private static function bridge_permission(\WP_REST_Request $request) {
            $secret = self::bridge_secret();

            if (!$secret) {
                return new \WP_Error(
                    'xplore_claim_bridge_not_configured',
                    __('Claim bridge is not configured.', 'xplore-listing-verification'),
                    ['status' => 503]
                );
            }

            $provided = (string) $request->get_header('x-xplore-pwa-secret');

            if (!$provided || !hash_equals($secret, $provided)) {
                return new \WP_Error(
                    'rest_forbidden',
                    __('Invalid claim bridge credentials.', 'xplore-listing-verification'),
                    ['status' => 401]
                );
            }

            return true;
        }

        // WordPress invokes this method from its REST server, so it must be public.
        public static function admin_bridge_permission(\WP_REST_Request $request) {
            $bridge = self::bridge_permission($request);

            if (is_wp_error($bridge)) {
                return $bridge;
            }

            $email = sanitize_email((string) $request->get_param('admin_email'));

            if (!$email) {
                return new \WP_Error(
                    'xplore_claim_admin_required',
                    __('Administrator email is required.', 'xplore-listing-verification'),
                    ['status' => 400]
                );
            }

            $user = get_user_by('email', $email);

            if (!$user || !user_can($user, 'manage_options')) {
                return new \WP_Error(
                    'rest_forbidden',
                    __('This account is not authorized to manage listing claims.', 'xplore-listing-verification'),
                    ['status' => 403]
                );
            }

            return true;
        }

        private static function claim_payload($row) {
            if (!$row) {
                return null;
            }

            $listing_id = (int) $row->listing_id;
            $listing = $listing_id ? get_post($listing_id) : null;

            return [
                'id' => (int) $row->id,
                'listing_id' => $listing_id,
                'listing_title' => $listing ? $listing->post_title : __('Unknown listing', 'xplore-listing-verification'),
                'listing_url' => $listing ? get_permalink($listing_id) : '',
                'first_name' => (string) $row->first_name,
                'last_name' => (string) $row->last_name,
                'email' => (string) $row->email,
                'phone' => (string) $row->phone,
                'details' => self::claim_details_for_display($row->details),
                'status' => (string) $row->status,
                'read_at' => $row->admin_read_at ? (string) $row->admin_read_at : null,
                'created_at' => mysql_to_rfc3339((string) $row->created_at),
            ];
        }

        public static function register_claim_routes() {
            /*
             * Keep authentication inside the claim callback. This gives us one
             * controlled error path instead of allowing a permission callback
             * failure to be rendered as WordPress's generic critical-error HTML.
             */
            register_rest_route('xplore/v1', '/listing-claims', [
                'methods' => 'POST',
                'callback' => [__CLASS__, 'submit_claim'],
                'permission_callback' => '__return_true',
            ]);

            register_rest_route('xplore/v1', '/listing-claims/health', [
                'methods' => 'GET',
                'callback' => [__CLASS__, 'claim_health'],
                'permission_callback' => '__return_true',
            ]);

            register_rest_route('xplore/v1', '/listing-claims/admin', [
                'methods' => 'GET',
                'callback' => [__CLASS__, 'admin_claims'],
                'permission_callback' => [__CLASS__, 'admin_bridge_permission'],
            ]);

            register_rest_route('xplore/v1', '/listing-claims/admin/read', [
                'methods' => 'POST',
                'callback' => [__CLASS__, 'mark_claim_read'],
                'permission_callback' => [__CLASS__, 'admin_bridge_permission'],
            ]);

            register_rest_route('xplore/v1', '/listing-claims/admin/status', [
                'methods' => 'POST',
                'callback' => [__CLASS__, 'update_claim_status'],
                'permission_callback' => [__CLASS__, 'admin_bridge_permission'],
            ]);
        }

        private static function save_claim_legacy_post($listing_id, $first_name, $last_name, $email, $phone, $details) {
            $title = sprintf(
                /* translators: 1: listing title, 2: claimant name */
                __('Claim: %1$s — %2$s', 'xplore-listing-verification'),
                get_the_title($listing_id),
                trim($first_name . ' ' . $last_name)
            );

            $post_id = wp_insert_post([
                'post_type' => 'xplore_listing_claim',
                'post_status' => 'publish',
                'post_title' => $title,
            ], true);

            if (is_wp_error($post_id)) {
                error_log('[Xplore Listing Verification] Legacy claim fallback failed: ' . $post_id->get_error_message());
                return $post_id;
            }

            update_post_meta($post_id, '_listing_id', $listing_id);
            update_post_meta($post_id, '_first_name', $first_name);
            update_post_meta($post_id, '_last_name', $last_name);
            update_post_meta($post_id, '_email', strtolower($email));
            update_post_meta($post_id, '_phone', $phone);
            update_post_meta($post_id, '_details', $details);
            update_post_meta($post_id, '_claim_status', 'pending');
            update_post_meta($post_id, '_admin_read_at', '');

            return (int) $post_id;
        }

        public static function claim_health(\WP_REST_Request $request) {
            return rest_ensure_response([
                'ok' => true,
                'plugin' => 'xplore-listing-verification',
                'version' => self::VERSION,
                'claim_route' => 'registered',
                'bridge_configured' => self::bridge_secret() !== '',
            ]);
        }

        public static function submit_claim(\WP_REST_Request $request) {
            try {
                $auth = self::bridge_permission($request);
                if (is_wp_error($auth)) {
                    return $auth;
                }

                return self::submit_claim_internal($request);
            } catch (\Throwable $e) {
                error_log(
                    '[Xplore Listing Verification] Unhandled claim submission error: ' .
                    $e->getMessage() .
                    ' in ' . $e->getFile() .
                    ':' . $e->getLine()
                );

                return new \WP_Error(
                    'xplore_claim_unhandled_error',
                    __('The listing claim service encountered a temporary server error. Please try again shortly.', 'xplore-listing-verification'),
                    [
                        'status' => 503,
                        'stage' => 'submit_claim',
                        'plugin_version' => self::VERSION,
                    ]
                );
            }
        }

        private static function submit_claim_internal(\WP_REST_Request $request) {
            /*
             * Keep the public claim submission path independent of the custom
             * database table. The table is useful for querying/analytics, but
             * a WordPress post is the safest persistence mechanism on hosting
             * environments where custom-table permissions/schema can differ.
             */
            $listing_id = absint($request->get_param('listing_id'));
            $listing = get_post($listing_id);

            if (!$listing || $listing->post_type !== 'listing') {
                return new \WP_Error(
                    'xplore_claim_invalid_listing',
                    __('Listing could not be found.', 'xplore-listing-verification'),
                    ['status' => 404]
                );
            }

            if (self::is_verified($listing_id)) {
                return new \WP_Error(
                    'xplore_claim_already_verified',
                    __('This listing is already verified.', 'xplore-listing-verification'),
                    ['status' => 409]
                );
            }

            $first_name = sanitize_text_field((string) $request->get_param('first_name'));
            $last_name = sanitize_text_field((string) $request->get_param('last_name'));
            $email = sanitize_email((string) $request->get_param('email'));
            $phone = sanitize_text_field((string) $request->get_param('phone'));
            $details = self::sanitize_claim_details((string) $request->get_param('details'));

            if (!$first_name || !$last_name || !$email || !$details) {
                return new \WP_Error(
                    'xplore_claim_missing_fields',
                    __('First name, last name, email and verification details are required.', 'xplore-listing-verification'),
                    ['status' => 400]
                );
            }

            /*
             * Check existing pending/approved claims through the legacy CPT.
             * This avoids any dependency on the custom claims table during
             * public submission.
             */
            $pending_existing = get_posts([
                'post_type' => 'xplore_listing_claim',
                'post_status' => 'publish',
                'posts_per_page' => 1,
                'fields' => 'ids',
                'meta_query' => [
                    'relation' => 'AND',
                    [
                        'key' => '_listing_id',
                        'value' => (string) $listing_id,
                        'compare' => '=',
                    ],
                    [
                        'key' => '_email',
                        'value' => strtolower($email),
                        'compare' => '=',
                    ],
                    [
                        'key' => '_claim_status',
                        'value' => 'pending',
                        'compare' => '=',
                    ],
                ],
            ]);

            // Reuse a pending claim for the same listing/email. This lets a
            // claimant correct a claim whose details were corrupted by an
            // older WordPress fatal-error response instead of being blocked
            // by the duplicate-claim check.
            if (!empty($pending_existing)) {
                $claim_id = (int) $pending_existing[0];

                update_post_meta($claim_id, '_first_name', $first_name);
                update_post_meta($claim_id, '_last_name', $last_name);
                update_post_meta($claim_id, '_email', strtolower($email));
                update_post_meta($claim_id, '_phone', $phone);
                update_post_meta($claim_id, '_details', $details);
                update_post_meta($claim_id, '_claim_status', 'pending');
                update_post_meta($claim_id, '_admin_read_at', '');

                wp_update_post([
                    'ID' => $claim_id,
                    'post_title' => sprintf(
                        __('Claim: %1$s — %2$s', 'xplore-listing-verification'),
                        get_the_title($listing_id),
                        trim($first_name . ' ' . $last_name)
                    ),
                ]);

                return rest_ensure_response([
                    'ok' => true,
                    'claim' => [
                        'id' => $claim_id,
                        'listing_id' => $listing_id,
                        'status' => 'pending',
                        'storage' => 'wordpress_cpt',
                        'updated_existing' => true,
                    ],
                ]);
            }

            $approved_existing = get_posts([
                'post_type' => 'xplore_listing_claim',
                'post_status' => 'publish',
                'posts_per_page' => 1,
                'fields' => 'ids',
                'meta_query' => [
                    'relation' => 'AND',
                    [
                        'key' => '_listing_id',
                        'value' => (string) $listing_id,
                        'compare' => '=',
                    ],
                    [
                        'key' => '_email',
                        'value' => strtolower($email),
                        'compare' => '=',
                    ],
                    [
                        'key' => '_claim_status',
                        'value' => 'approved',
                        'compare' => '=',
                    ],
                ],
            ]);

            if (!empty($approved_existing)) {
                return new WP_Error(
                    'xplore_claim_already_approved',
                    __('A claim for this listing from this email has already been approved.', 'xplore-listing-verification'),
                    ['status' => 409]
                );
            }

            $claim_id = self::save_claim_legacy_post(
                $listing_id,
                $first_name,
                $last_name,
                $email,
                $phone,
                $details
            );

            if (is_wp_error($claim_id)) {
                error_log('[Xplore Listing Verification] WordPress claim post creation failed: ' . $claim_id->get_error_message());
                return new \WP_Error(
                    'xplore_claim_storage_failed',
                    __('We could not save your claim right now. Please try again.', 'xplore-listing-verification'),
                    ['status' => 503]
                );
            }

            /*
             * Best-effort mirror into the dedicated table. Failure here must
             * NEVER make the public claim submission fail.
             */
            try {
                global $wpdb;
                if (self::ensure_claim_table()) {
                    $now = current_time('mysql');
                    $wpdb->insert(
                        self::table_name(),
                        [
                            'listing_id' => $listing_id,
                            'first_name' => $first_name,
                            'last_name' => $last_name,
                            'email' => strtolower($email),
                            'phone' => $phone,
                            'details' => $details,
                            'status' => 'pending',
                            'admin_read_at' => null,
                            'created_at' => $now,
                            'updated_at' => $now,
                        ],
                        ['%d', '%s', '%s', '%s', '%s', '%s', '%s', '%s', '%s', '%s']
                    );

                    if ($wpdb->last_error) {
                        error_log('[Xplore Listing Verification] Optional claim-table mirror failed: ' . $wpdb->last_error);
                    }
                }
            } catch (\Throwable $e) {
                error_log('[Xplore Listing Verification] Optional claim-table mirror exception: ' . $e->getMessage());
            }

            return rest_ensure_response([
                'ok' => true,
                'claim' => [
                    'id' => (int) $claim_id,
                    'listing_id' => $listing_id,
                    'status' => 'pending',
                    'storage' => 'wordpress_cpt',
                ],
            ]);
        }

        /**
         * Sanitize claimant-entered verification details before they are ever
         * persisted. In particular, never persist a WordPress fatal-error
         * document or arbitrary HTML as the claimant's message.
         */
        private static function sanitize_claim_details($details) {
            $details = is_string($details) ? trim($details) : '';

            if ($details === '') {
                return '';
            }

            // A previous broken bridge could accidentally submit the complete
            // WordPress fatal-error page as the details value. Do not store it.
            if (
                stripos($details, 'critical error on this website') !== false ||
                stripos($details, 'learn more about troubleshooting wordpress') !== false
            ) {
                error_log('[Xplore Listing Verification] Rejected WordPress fatal-error HTML from claim details.');
                return '';
            }

            // Textarea input should be plain text. Strip any markup that may
            // have been supplied by a client outside the normal app form.
            $details = wp_strip_all_tags($details);
            $details = sanitize_textarea_field($details);
            return trim($details);
        }

        private static function claim_details_for_display($details) {
            $details = is_string($details) ? trim($details) : '';
            if ($details === '') {
                return '';
            }

            // Defensive cleanup for claims created by older plugin versions.
            if (
                stripos($details, 'critical error on this website') !== false ||
                stripos($details, 'learn more about troubleshooting wordpress') !== false
            ) {
                return __('Claim details were not captured correctly. Please ask the claimant to submit the verification details again.', 'xplore-listing-verification');
            }

            return wp_strip_all_tags($details);
        }

        public static function admin_claims(\WP_REST_Request $request) {
            /*
             * WordPress CPT is the authoritative claim record.
             *
             * The dedicated table is only a best-effort mirror used for older
             * deployments/analytics. Returning it first caused stale mirror
             * data to win over a newer successful claim, which could make the
             * Partner Portal display an old WordPress critical-error HTML page
             * as the claimant's verification details.
             */
            $limit = min(100, max(1, absint($request->get_param('limit') ?: 50)));
            $unread_only = sanitize_text_field((string) $request->get_param('unread')) === '1';

            $legacy_args = [
                'post_type' => 'xplore_listing_claim',
                'post_status' => 'publish',
                'posts_per_page' => $limit,
                'orderby' => 'date',
                'order' => 'DESC',
            ];

            if ($unread_only) {
                $legacy_args['meta_query'] = [[
                    'key' => '_admin_read_at',
                    'compare' => 'NOT EXISTS',
                ]];
            }

            $legacy_ids = get_posts($legacy_args);
            $items = [];

            foreach ($legacy_ids as $legacy_id) {
                $listing_id = (int) get_post_meta($legacy_id, '_listing_id', true);
                $email = strtolower(trim((string) get_post_meta($legacy_id, '_email', true)));

                $items[] = [
                    'id' => (int) $legacy_id,
                    'listing_id' => $listing_id,
                    'listing_title' => get_the_title($listing_id) ?: __('Unknown listing', 'xplore-listing-verification'),
                    'listing_url' => $listing_id ? get_permalink($listing_id) : '',
                    'first_name' => (string) get_post_meta($legacy_id, '_first_name', true),
                    'last_name' => (string) get_post_meta($legacy_id, '_last_name', true),
                    'email' => $email,
                    'phone' => (string) get_post_meta($legacy_id, '_phone', true),
                    'details' => self::claim_details_for_display(get_post_meta($legacy_id, '_details', true)),
                    'status' => (string) get_post_meta($legacy_id, '_claim_status', true) ?: 'pending',
                    'read_at' => get_post_meta($legacy_id, '_admin_read_at', true) ?: null,
                    'created_at' => get_post_time('c', false, $legacy_id),
                ];
            }

            /*
             * Do not merge the optional mirror into these records. The public
             * submission path always creates the CPT first; therefore the CPT
             * contains the freshest claimant details.
             */
            usort($items, static function ($a, $b) {
                return strcmp((string) ($b['created_at'] ?? ''), (string) ($a['created_at'] ?? ''));
            });

            $items = array_slice($items, 0, $limit);

            $unread = 0;
            foreach ($items as $item) {
                if (empty($item['read_at'])) {
                    $unread++;
                }
            }

            return rest_ensure_response([
                'items' => $items,
                'unread' => $unread,
                'source' => 'wordpress_cpt',
            ]);
        }

        public static function mark_claim_read(\WP_REST_Request $request) {
            global $wpdb;

            $claim_id = absint($request->get_param('claim_id'));

            if (!$claim_id) {
                return new \WP_Error(
                    'xplore_claim_not_found',
                    __('Claim could not be found.', 'xplore-listing-verification'),
                    ['status' => 404]
                );
            }

            /*
             * Claim IDs returned by /admin are WordPress CPT IDs. Prefer the
             * CPT when it exists so a numeric ID collision with the optional
             * mirror table cannot update the wrong claim.
             */
            if (get_post_type($claim_id) === 'xplore_listing_claim') {
                update_post_meta($claim_id, '_admin_read_at', current_time('mysql'));
                return rest_ensure_response(['ok' => true]);
            }

            $table = self::table_name();
            $updated = $wpdb->update(
                $table,
                ['admin_read_at' => current_time('mysql'), 'updated_at' => current_time('mysql')],
                ['id' => $claim_id],
                ['%s', '%s'],
                ['%d']
            );

            if ($updated === false) {
                return new \WP_Error(
                    'xplore_claim_update_failed',
                    __('Claim could not be updated.', 'xplore-listing-verification'),
                    ['status' => 500]
                );
            }

            return rest_ensure_response(['ok' => true]);
        }

        public static function update_claim_status(\WP_REST_Request $request) {
            global $wpdb;

            $claim_id = absint($request->get_param('claim_id'));
            $status = sanitize_key((string) $request->get_param('status'));

            if (!$claim_id) {
                return new \WP_Error(
                    'xplore_claim_not_found',
                    __('Claim could not be found.', 'xplore-listing-verification'),
                    ['status' => 404]
                );
            }

            if (!in_array($status, ['pending', 'approved', 'rejected'], true)) {
                return new \WP_Error(
                    'xplore_claim_invalid_status',
                    __('Invalid claim status.', 'xplore-listing-verification'),
                    ['status' => 400]
                );
            }

            /*
             * Claim IDs returned by /admin are WordPress CPT IDs. Prefer the
             * CPT when it exists so status changes cannot hit a mirror row with
             * the same numeric ID.
             */
            $now = current_time('mysql');
            if (get_post_type($claim_id) === 'xplore_listing_claim') {
                update_post_meta($claim_id, '_claim_status', $status);
                update_post_meta($claim_id, '_admin_read_at', $now);

                return rest_ensure_response([
                    'ok' => true,
                    'status' => $status,
                    'claim' => [
                        'id' => $claim_id,
                        'status' => $status,
                    ],
                ]);
            }

            $table = self::table_name();
            $updated = $wpdb->update(
                $table,
                [
                    'status' => $status,
                    'admin_read_at' => $now,
                    'updated_at' => $now,
                ],
                ['id' => $claim_id],
                ['%s', '%s', '%s'],
                ['%d']
            );

            if ($updated === false) {
                return new \WP_Error(
                    'xplore_claim_update_failed',
                    __('Claim could not be updated.', 'xplore-listing-verification'),
                    ['status' => 500]
                );
            }

            $row = $wpdb->get_row($wpdb->prepare(
                "SELECT * FROM {$table} WHERE id = %d LIMIT 1",
                $claim_id
            ));

            if (!$row) {
                return new \WP_Error(
                    'xplore_claim_not_found',
                    __('Claim could not be found.', 'xplore-listing-verification'),
                    ['status' => 404]
                );
            }

            return rest_ensure_response([
                'ok' => true,
                'status' => $status,
                'claim' => self::claim_payload($row),
            ]);
        }

        public static function admin_menu() {
            add_options_page(
                __('Xplore Listing Verification', 'xplore-listing-verification'),
                __('Listing Verification', 'xplore-listing-verification'),
                'manage_options',
                'xplore-listing-verification',
                [__CLASS__, 'settings_page']
            );
        }

        public static function settings_page() {
            if (!current_user_can('manage_options')) {
                return;
            }

            if (isset($_POST['xplore_listing_verification_save'])) {
                check_admin_referer('xplore_listing_verification_settings');

                update_option(
                    'xplore_listing_verification_auto_insert',
                    !empty($_POST['auto_insert']) ? '1' : '0'
                );

                echo '<div class="notice notice-success is-dismissible"><p>' .
                    esc_html__('Settings saved.', 'xplore-listing-verification') .
                    '</p></div>';
            }

            $enabled = get_option('xplore_listing_verification_auto_insert', '0') === '1';
            ?>
            <div class="wrap">
                <h1><?php esc_html_e('Xplore Listing Verification', 'xplore-listing-verification'); ?></h1>

                <form method="post">
                    <?php wp_nonce_field('xplore_listing_verification_settings'); ?>
                    <p>
                        <label>
                            <input type="checkbox" name="auto_insert" value="1" <?php checked($enabled); ?>>
                            <?php esc_html_e('Automatically append verification status to single listing content', 'xplore-listing-verification'); ?>
                        </label>
                    </p>
                    <p class="description">
                        <?php esc_html_e('Leave disabled when placing the shortcode in Elementor/Listeo templates manually.', 'xplore-listing-verification'); ?>
                    </p>
                    <p>
                        <button class="button button-primary" type="submit" name="xplore_listing_verification_save" value="1">
                            <?php esc_html_e('Save Changes', 'xplore-listing-verification'); ?>
                        </button>
                    </p>
                </form>

                <h2><?php esc_html_e('Xplore Claim API', 'xplore-listing-verification'); ?></h2>
                <p><?php esc_html_e('Claims submitted by the Xplore Pondy app are stored in a dedicated database table and exposed to the Partner Portal administrator notification inbox. The app server authenticates requests with WP_SOCIAL_SESSION_BRIDGE_SECRET.', 'xplore-listing-verification'); ?></p>

                <h2><?php esc_html_e('Listeo Integration', 'xplore-listing-verification'); ?></h2>
                <p><?php esc_html_e('The WordPress shortcode remains available for the main site. The Xplore Pondy app uses its own in-app claim dialog and submits through the claim REST bridge.', 'xplore-listing-verification'); ?></p>

                <h2><?php esc_html_e('Shortcode', 'xplore-listing-verification'); ?></h2>
                <p><code>[xplore_listing_verification]</code> — <?php esc_html_e('current listing', 'xplore-listing-verification'); ?></p>
                <p><code>[xplore_listing_verification id="123"]</code> — <?php esc_html_e('specific listing', 'xplore-listing-verification'); ?></p>
                <p><code>&lt;?php echo xplore_listing_verification(get_the_ID()); ?&gt;</code> — <?php esc_html_e('PHP templates', 'xplore-listing-verification'); ?></p>
            </div>
            <?php
        }
    }

    XPLORE_Listing_Verification::init();
}

if (!function_exists('xplore_listing_verification')) {
    function xplore_listing_verification($post_id = 0, $args = []) {
        $post_id = $post_id ? absint($post_id) : get_the_ID();
        return XPLORE_Listing_Verification::render($post_id, $args);
    }
}
