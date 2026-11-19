<?php
/**
 * Plugin Name: Xplore Listing Verification
 * Description: Displays verified and unverified listing status with a claim-listing link for Listeo listings.
 * Version: 1.0.0
 * Author: Xplore Pondy
 * Text Domain: xplore-listing-verification
 */

if (!defined('ABSPATH')) {
    exit;
}

if (!class_exists('XPLORE_Listing_Verification')) {
    final class XPLORE_Listing_Verification {
        const VERSION = '1.0.0';
        const SHORTCODE = 'xplore_listing_verification';

        public static function init() {
            add_shortcode(self::SHORTCODE, [__CLASS__, 'render_shortcode']);
            add_filter('the_content', [__CLASS__, 'append_to_listing_content'], 20);
            add_action('wp_enqueue_scripts', [__CLASS__, 'register_styles']);
            add_action('admin_menu', [__CLASS__, 'admin_menu']);
        }

        private static function is_listing($post_id) {
            return $post_id > 0 && get_post_type($post_id) === 'listing';
        }

        /**
         * Read Listeo _verified; only explicit positive values count as verified.
         * Supports scalar and one-item array values.
         */
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
                    // Preserve Listeo's native listing claim workflow.
                    $output .= '<a class="xplore-listing-verification__claim" href="' . esc_url(get_permalink($post_id)) . '">';
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

        /**
         * Optional content insertion. Disabled by default to avoid duplicate
         * badges in Elementor/custom listing layouts.
         */
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
