<?php
/**
 * Plugin Name: Xplore Listing Verification
 * Description: Displays verified and unverified listing status and provides an in-app claim bridge for Xplore Pondy.
 * Version: 1.3.1
 * Author: Xplore Pondy
 * Text Domain: xplore-listing-verification
 */

if (!defined('ABSPATH')) {
    exit;
}

if (!class_exists('XPLORE_Listing_Verification')) {
    final class XPLORE_Listing_Verification {
        const VERSION = '1.3.1';
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

            $sql = "CREATE TABLE {$table} (
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

            require_once ABSPATH . 'wp-admin/includes/upgrade.php';
            dbDelta($sql);
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

        private static function admin_bridge_permission(\WP_REST_Request $request) {
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
                'details' => (string) $row->details,
                'status' => (string) $row->status,
                'read_at' => $row->admin_read_at ? (string) $row->admin_read_at : null,
                'created_at' => mysql_to_rfc3339((string) $row->created_at),
            ];
        }

        public static function register_claim_routes() {
            register_rest_route('xplore/v1', '/listing-claims', [
                'methods' => 'POST',
                'callback' => [__CLASS__, 'submit_claim'],
                'permission_callback' => [__CLASS__, 'bridge_permission'],
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

        public static function submit_claim(\WP_REST_Request $request) {
            global $wpdb;

            // Create/repair the claims table lazily on the actual claim request.
            // This avoids running dbDelta() and the legacy migration on every
            // normal WordPress page request.
            self::ensure_claim_table();

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
            $details = sanitize_textarea_field((string) $request->get_param('details'));

            if (!$first_name || !$last_name || !$email || !$details) {
                return new \WP_Error(
                    'xplore_claim_missing_fields',
                    __('First name, last name, email and verification details are required.', 'xplore-listing-verification'),
                    ['status' => 400]
                );
            }

            $table = self::table_name();

            $duplicate = $wpdb->get_var($wpdb->prepare(
                "SELECT id FROM {$table}
                 WHERE listing_id = %d
                   AND email = %s
                   AND status IN ('pending', 'approved')
                 LIMIT 1",
                $listing_id,
                strtolower($email)
            ));

            if ($duplicate) {
                return new \WP_Error(
                    'xplore_claim_duplicate',
                    __('A claim for this listing from this email is already under review.', 'xplore-listing-verification'),
                    ['status' => 409]
                );
            }

            $now = current_time('mysql');

            $inserted = $wpdb->insert(
                $table,
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

            if ($inserted === false) {
                error_log('[Xplore Listing Verification] Claim insert failed: ' . $wpdb->last_error);

                return new \WP_Error(
                    'xplore_claim_storage_failed',
                    __('We could not save your claim right now. Please try again.', 'xplore-listing-verification'),
                    ['status' => 500]
                );
            }

            $claim_id = (int) $wpdb->insert_id;
            // Keep the submit response deliberately small. The Partner Portal
            // only needs confirmation; claim details are fetched by the admin
            // endpoint. This also avoids running any post/meta/template logic
            // during the public submission request.
            return rest_ensure_response([
                'ok' => true,
                'claim' => [
                    'id' => $claim_id,
                    'listing_id' => $listing_id,
                    'status' => 'pending',
                ],
            ]);
        }

        public static function admin_claims(\WP_REST_Request $request) {
            global $wpdb;

            $limit = min(100, max(1, absint($request->get_param('limit') ?: 50)));
            $unread_only = sanitize_text_field((string) $request->get_param('unread')) === '1';
            $table = self::table_name();

            $where = $unread_only ? 'WHERE admin_read_at IS NULL' : '';

            $rows = $wpdb->get_results(
                $wpdb->prepare(
                    "SELECT * FROM {$table} {$where} ORDER BY created_at DESC LIMIT %d",
                    $limit
                )
            );

            $items = array_values(array_filter(array_map([__CLASS__, 'claim_payload'], $rows)));

            $unread = (int) $wpdb->get_var(
                "SELECT COUNT(*) FROM {$table} WHERE admin_read_at IS NULL"
            );

            return rest_ensure_response([
                'items' => $items,
                'unread' => $unread,
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

            $table = self::table_name();
            $now = current_time('mysql');

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
