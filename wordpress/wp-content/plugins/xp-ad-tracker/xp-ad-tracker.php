<?php
/**
 * Plugin Name: XP Ad Tracker
 * Description: Tracks XP Ads views, clicks, CTR + vendor stats + auto-disable.
 * Version: 2.2
 * Author: Xplore Pondy
 */

if (!defined('ABSPATH')) exit;

// 1) Register AJAX: Track Views & Clicks
add_action('wp_ajax_xp_track_ad_view', 'xp_track_ad_view_callback');
add_action('wp_ajax_nopriv_xp_track_ad_view', 'xp_track_ad_view_callback');
add_action('wp_ajax_xp_track_ad_click', 'xp_track_ad_click_callback');
add_action('wp_ajax_nopriv_xp_track_ad_click', 'xp_track_ad_click_callback');

function xp_track_ad_view_callback() {
    $ad_id = intval($_REQUEST['ad_id']);
    if (!$ad_id) wp_send_json_error('Invalid ad ID', 400);

    $transient_key = "xp_ad_views_{$ad_id}";
    $views = (int) get_transient($transient_key);
    if ($views === false) {
        $views = (int) get_post_meta($ad_id, '_ad_views', true);
    }
    $views++;
    set_transient($transient_key, $views, HOUR_IN_SECONDS);
    update_post_meta($ad_id, '_ad_views', $views);

    wp_send_json_success(['views' => $views]);
}

function xp_track_ad_click_callback() {
    $ad_id = intval($_REQUEST['ad_id']);
    if (!$ad_id) wp_send_json_error('Invalid ad ID', 400);

    $transient_key = "xp_ad_clicks_{$ad_id}";
    $clicks = (int) get_transient($transient_key);
    if ($clicks === false) {
        $clicks = (int) get_post_meta($ad_id, '_ad_clicks', true);
    }
    $clicks++;
    set_transient($transient_key, $clicks, HOUR_IN_SECONDS);
    update_post_meta($ad_id, '_ad_clicks', $clicks);

    wp_send_json_success(['clicks' => $clicks]);
}

// 2) Enqueue Tracker JS (Skip in Editor)
add_action('wp_enqueue_scripts', function() {
    if (isset($_GET['action']) && $_GET['action'] === 'elementor') {
        return; // Skip in Elementor editor
    }
    wp_enqueue_script(
        'xp-ad-tracker',
        plugin_dir_url(__FILE__) . 'xp-ad-tracker.js',
        ['jquery'],
        '2.1',
        true
    );
});

// 3) CTR Shortcode
function xp_get_ad_ctr($post_id) {
    $transient_key = "xp_ad_ctr_{$post_id}";
    $ctr = get_transient($transient_key);
    if ($ctr === false) {
        $views  = (int) get_post_meta($post_id, '_ad_views', true);
        $clicks = (int) get_post_meta($post_id, '_ad_clicks', true);
        $ctr = $views === 0 ? '0%' : round(($clicks / $views) * 100, 2) . '%';
        set_transient($transient_key, $ctr, HOUR_IN_SECONDS);
    }
    return $ctr;
}

add_shortcode('xp_ad_ctr', function() {
    return 'CTR: ' . xp_get_ad_ctr(get_the_ID());
});

// 4) Vendor Ad Stats Shortcode
function xp_listing_ad_stats($atts) {
    if (!is_user_logged_in()) return '';

    global $post;
    $listing_id = $post->ID;
    $current_user_id = get_current_user_id();
    $transient_key = "xp_ad_stats_{$listing_id}_{$current_user_id}";
    $output = get_transient($transient_key);

    if ($output === false) {
        $ads = get_posts([
            'post_type'  => 'xp-ads',
            'numberposts' => -1,
            'meta_query' => [
                [
                    'key'   => 'ad_target_listing',
                    'value' => $listing_id,
                ]
            ]
        ]);

        $output = '';
        foreach ($ads as $ad) {
            $repeater = get_post_meta($ad->ID, 'xp_ad_user_id', true);
            if (!is_array($repeater)) continue;

            $found = false;
            foreach ($repeater as $row) {
                if (isset($row['user_id']) && (int) $row['user_id'] === $current_user_id) {
                    $found = true; break;
                }
            }
            if (!$found) continue;

            $views  = (int) get_post_meta($ad->ID, '_ad_views', true);
            $clicks = (int) get_post_meta($ad->ID, '_ad_clicks', true);
            $ctr    = $views > 0 ? round(($clicks / $views) * 100, 2) : 0;
            $output .= "<p><strong>{$ad->post_title}</strong>: Views: {$views} | Clicks: {$clicks} | CTR: {$ctr}%</p>";
        }
        set_transient($transient_key, $output ?: '', HOUR_IN_SECONDS);
    }
    return $output;
}
add_shortcode('xp_listing_ad_stats', 'xp_listing_ad_stats');

// 5) Auto-disable expired ads (WP Cron)
add_action('wp', function() {
    if (!wp_next_scheduled('xp_check_expired_ads')) {
        wp_schedule_event(time(), 'hourly', 'xp_check_expired_ads');
    }
});

add_action('xp_check_expired_ads', function() {
    $ads = get_posts([
        'post_type'      => 'xp-ads',
        'post_status'    => 'publish',
        'posts_per_page' => 50,
        'meta_query'     => [
            'relation' => 'AND',
            [
                'relation' => 'OR',
                ['key' => 'xp_ad_max_views', 'compare' => 'EXISTS'],
                ['key' => 'xp_ad_max_clicks', 'compare' => 'EXISTS'],
                ['key' => 'ad_end_date', 'compare' => 'EXISTS'],
            ],
            [
                'key'     => 'ad_end_date',
                'value'   => time() - MONTH_IN_SECONDS,
                'compare' => '>=',
                'type'    => 'NUMERIC',
            ],
        ],
    ]);

    foreach ($ads as $ad) {
        $post_id = $ad->ID;
        $views       = (int) get_post_meta($post_id, '_ad_views', true);
        $clicks      = (int) get_post_meta($post_id, '_ad_clicks', true);
        $max_views   = (int) get_post_meta($post_id, 'xp_ad_max_views', true);
        $max_clicks  = (int) get_post_meta($post_id, 'xp_ad_max_clicks', true);
        $end_date_ts = (int) get_post_meta($post_id, 'ad_end_date', true);

        if (($max_views && $views >= $max_views) || ($max_clicks && $clicks >= $max_clicks) || ($end_date_ts && time() >= $end_date_ts)) {
            update_post_meta($post_id, 'ad_status', 'disabled');
        }
    }
});



/**
 * Public XP Ads feed for app.xplorepondy.com.
 *
 * The existing XP Ads CPT/configuration remains the source of truth. This
 * endpoint only exposes the fields required by the public app and never
 * exposes vendor/user assignment data.
 */
add_action('rest_api_init', function () {
    register_rest_route('xplore/v1', '/ads', [
        'methods'             => WP_REST_Server::READABLE,
        'permission_callback' => '__return_true',
        'callback'            => 'xp_ads_public_feed',
        'args'                => [
            'position' => [
                'required'          => false,
                'sanitize_callback' => 'sanitize_key',
            ],
            'per_page' => [
                'required'          => false,
                'default'           => 20,
                'sanitize_callback' => function ($value) {
                    return min(100, max(1, absint($value)));
                },
            ],
        ],
    ]);
});

function xp_ads_meta_first($post_id, array $keys) {
    foreach ($keys as $key) {
        $value = get_post_meta($post_id, $key, true);
        if ($value !== '' && $value !== null && $value !== false) {
            return $value;
        }
    }
    return '';
}

function xp_ads_media_url($value) {
    if (is_array($value)) {
        if (!empty($value['url']) && is_string($value['url'])) return esc_url_raw($value['url']);
        if (!empty($value['ID'])) $value = $value['ID'];
        elseif (!empty($value['id'])) $value = $value['id'];
    }

    if (is_numeric($value)) {
        $url = wp_get_attachment_url((int) $value);
        return $url ? esc_url_raw($url) : '';
    }

    if (is_string($value) && filter_var($value, FILTER_VALIDATE_URL)) {
        return esc_url_raw($value);
    }

    return '';
}

function xp_ads_date_timestamp($value) {
    if (is_numeric($value) && (int) $value > 0) {
        return (int) $value;
    }
    if (is_string($value) && trim($value) !== '') {
        $timestamp = strtotime($value);
        return $timestamp ?: 0;
    }
    return 0;
}

function xp_ad_is_publicly_active($post_id) {
    if (get_post_status($post_id) !== 'publish') return false;

    $status = strtolower((string) get_post_meta($post_id, 'ad_status', true));
    if ($status === 'disabled' || $status === 'expired' || $status === 'inactive') return false;

    $now = current_time('timestamp');
    $start = xp_ads_date_timestamp(xp_ads_meta_first($post_id, [
        'ad_start_date',
        'xp_ad_start_date',
        'start_date',
    ]));
    $end = xp_ads_date_timestamp(xp_ads_meta_first($post_id, [
        'ad_end_date',
        'xp_ad_end_date',
        'end_date',
    ]));

    if ($start && $now < $start) return false;
    if ($end && $now >= $end) return false;

    $views = (int) get_post_meta($post_id, '_ad_views', true);
    $clicks = (int) get_post_meta($post_id, '_ad_clicks', true);
    $max_views = (int) get_post_meta($post_id, 'xp_ad_max_views', true);
    $max_clicks = (int) get_post_meta($post_id, 'xp_ad_max_clicks', true);

    if ($max_views && $views >= $max_views) return false;
    if ($max_clicks && $clicks >= $max_clicks) return false;

    return true;
}

function xp_ads_public_feed(WP_REST_Request $request) {
    $position = sanitize_key((string) $request->get_param('position'));
    $per_page = min(100, max(1, absint($request->get_param('per_page') ?: 20)));

    $meta_query = [];
    if ($position !== '') {
        $meta_query[] = [
            'key'     => 'ad_position',
            'value'   => $position,
            'compare' => '=',
        ];
    }

    $query = new WP_Query([
        'post_type'           => 'xp-ads',
        'post_status'         => 'publish',
        'posts_per_page'      => $per_page,
        'orderby'             => 'date',
        'order'               => 'DESC',
        'no_found_rows'       => true,
        'ignore_sticky_posts' => true,
        'meta_query'          => $meta_query,
    ]);

    $ads = [];

    foreach ($query->posts as $ad) {
        $post_id = (int) $ad->ID;

        if (!xp_ad_is_publicly_active($post_id)) continue;

        $image = xp_ads_media_url(xp_ads_meta_first($post_id, [
            'ad_image',
            'ad_image_url',
            'ad_creative',
            'ad_banner',
            'ad_media',
            'image',
            'image_url',
        ]));

        if (!$image && has_post_thumbnail($post_id)) {
            $image = get_the_post_thumbnail_url($post_id, 'full') ?: '';
        }

        $target_url = xp_ads_meta_first($post_id, [
            'ad_url',
            'ad_link',
            'ad_target_url',
            'target_url',
            'link_url',
        ]);
        $target_url = is_string($target_url) ? esc_url_raw($target_url) : '';

        $listing_id = (int) xp_ads_meta_first($post_id, [
            'ad_target_listing',
            'listing_id',
            'target_listing',
        ]);

        $listing_slug = $listing_id ? (string) get_post_field('post_name', $listing_id) : '';

        $ads[] = [
            'id'           => $post_id,
            'title'        => get_the_title($post_id),
            'image_url'    => $image,
            'target_url'   => $target_url,
            'position'     => (string) xp_ads_meta_first($post_id, ['ad_position']),
            'listing_id'   => $listing_id,
            'listing_slug' => $listing_slug,
        ];
    }

    $response = new WP_REST_Response([
        'ads'          => $ads,
        'generated_at' => gmdate('c'),
    ]);

    $response->header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    $response->header('Pragma', 'no-cache');

    return $response;
}

// 6) Dashboard Notices (AJAX)
add_action('wp_ajax_get_dashboard_notices', function () {
    if (!is_user_logged_in()) wp_send_json([]);

    $current_user = wp_get_current_user();
    if (!array_intersect(['vendor', 'owner', 'administrator'], $current_user->roles)) wp_send_json([]);

    $notices = [];
    $ads_query = new WP_Query([
        'post_type'      => 'xp-ads',
        'posts_per_page' => -1,
        'post_status'    => ['publish'],
        'meta_query'     => [[
            'key'     => 'xp_ad_user_id',
            'value'   => $current_user->ID,
            'compare' => 'LIKE',
        ]]
    ]);

    if ($ads_query->have_posts()) {
        $notices[] = [
            'class' => 'info',
            'msg'   => "<h3 style='margin:0 0 10px;'>📢 Recent Ads</h3>"
        ];
    }

    foreach ($ads_query->posts as $ad) {
        $ad_id    = $ad->ID;
        $ad_title = esc_html(get_the_title($ad_id));
        $views    = (int) get_post_meta($ad_id, '_ad_views', true);
        $clicks   = (int) get_post_meta($ad_id, '_ad_clicks', true);
        $ctr      = $views > 0 ? number_format(($clicks / $views) * 100, 2) : '0.00';

        $notices[] = [
            'class' => 'info',
            'msg'   => "📢 <strong>{$ad_title}</strong><br>👁️ Views: {$views} | 🖱️ Clicks: {$clicks} | 📊 CTR: {$ctr}%"
        ];
    }

    wp_send_json($notices);
});

/**
 * Authenticated Partner Portal API.
 *
 * The portal calls these routes server-to-server with the existing HMAC-backed
 * WordPress identity bridge. Vendor identity is resolved from the verified
 * request email; client-supplied owner IDs are never used for authorization.
 */
function xp_ads_partner_request_identity(WP_REST_Request $request) {
    $secret = defined('WP_SOCIAL_SESSION_BRIDGE_SECRET') ? WP_SOCIAL_SESSION_BRIDGE_SECRET : '';
    $provided = (string) $request->get_header('x-xplore-pwa-secret');
    $email = sanitize_email((string) $request->get_header('x-xplore-pwa-user-email'));

    if (!$secret || !$provided || !hash_equals((string) $secret, $provided) || !$email) {
        return new WP_Error('xp_ads_unauthorized', 'Authentication required.', ['status' => 401]);
    }

    $user = get_user_by('email', $email);
    if (!$user || !$user->exists()) {
        return new WP_Error('xp_ads_unauthorized', 'Partner account was not found.', ['status' => 403]);
    }

    if (!array_intersect(['vendor', 'owner', 'administrator'], (array) $user->roles)) {
        return new WP_Error('xp_ads_forbidden', 'Your account cannot manage advertisements.', ['status' => 403]);
    }

    return $user;
}

function xp_ads_user_can_manage_ad($user, $ad_id) {
    if (user_can($user, 'manage_options')) return true;

    $assigned = get_post_meta($ad_id, 'xp_ad_user_id', true);
    $owns = false;
    if (is_array($assigned)) {
        foreach ($assigned as $row) {
            if (is_array($row) && isset($row['user_id']) && (int) $row['user_id'] === (int) $user->ID) {
                $owns = true;
                break;
            }
        }
    } elseif (is_numeric($assigned)) {
        $owns = (int) $assigned === (int) $user->ID;
    }

    if ($owns) return true;

    $listing_id = (int) xp_ads_meta_first($ad_id, ['ad_target_listing', 'listing_id', 'target_listing']);
    if ($listing_id > 0) {
        $listing = get_post($listing_id);
        if ($listing && (int) $listing->post_author === (int) $user->ID) return true;
        if (function_exists('listeo_core_is_user_owner_of_listing') && listeo_core_is_user_owner_of_listing($listing_id, $user->ID)) return true;
    }

    return false;
}

function xp_ads_rest_payload($post_id) {
    $image = xp_ads_media_url(xp_ads_meta_first($post_id, ['ad_image', 'ad_image_url', 'ad_creative', 'ad_banner', 'ad_media', 'image', 'image_url']));
    if (!$image && has_post_thumbnail($post_id)) $image = get_the_post_thumbnail_url($post_id, 'full') ?: '';
    $listing_id = (int) xp_ads_meta_first($post_id, ['ad_target_listing', 'listing_id', 'target_listing']);
    $views = (int) get_post_meta($post_id, '_ad_views', true);
    $clicks = (int) get_post_meta($post_id, '_ad_clicks', true);
    return [
        'id' => (int) $post_id,
        'title' => get_the_title($post_id),
        'status' => (string) get_post_meta($post_id, 'ad_status', true),
        'post_status' => get_post_status($post_id),
        'image_url' => $image,
        'target_url' => (string) xp_ads_meta_first($post_id, ['ad_url', 'ad_link', 'ad_target_url', 'target_url', 'link_url']),
        'position' => (string) get_post_meta($post_id, 'ad_position', true),
        'listing_id' => $listing_id,
        'start_date' => (string) xp_ads_meta_first($post_id, ['ad_start_date', 'xp_ad_start_date', 'start_date']),
        'end_date' => (string) xp_ads_meta_first($post_id, ['ad_end_date', 'xp_ad_end_date', 'end_date']),
        'max_views' => (int) get_post_meta($post_id, 'xp_ad_max_views', true),
        'max_clicks' => (int) get_post_meta($post_id, 'xp_ad_max_clicks', true),
        'views' => $views,
        'clicks' => $clicks,
        'ctr' => $views > 0 ? round(($clicks / $views) * 100, 2) : 0,
        'created_at' => get_post_time('c', true, $post_id),
    ];
}

add_action('rest_api_init', function () {
    register_rest_route('xplore/v1', '/partner/ads', [
        [
            'methods' => WP_REST_Server::READABLE,
            'permission_callback' => function ($request) { return xp_ads_partner_request_identity($request); },
            'callback' => 'xp_ads_partner_list',
            'args' => ['page' => ['default' => 1, 'sanitize_callback' => 'absint'], 'per_page' => ['default' => 20, 'sanitize_callback' => 'absint']],
        ],
        [
            'methods' => WP_REST_Server::CREATABLE,
            'permission_callback' => function ($request) { return xp_ads_partner_request_identity($request); },
            'callback' => 'xp_ads_partner_create',
        ],
    ]);
    register_rest_route('xplore/v1', '/partner/ads/(?P<id>\\d+)', [
        [
            'methods' => WP_REST_Server::READABLE,
            'permission_callback' => function ($request) { return xp_ads_partner_request_identity($request); },
            'callback' => 'xp_ads_partner_detail',
        ],
        [
            'methods' => 'POST, PUT, PATCH',
            'permission_callback' => function ($request) { return xp_ads_partner_request_identity($request); },
            'callback' => 'xp_ads_partner_update',
        ],
    ]);
});

function xp_ads_partner_list(WP_REST_Request $request) {
    $user = xp_ads_partner_request_identity($request);
    if (is_wp_error($user)) return $user;
    $page = max(1, absint($request->get_param('page')));
    $per_page = min(100, max(1, absint($request->get_param('per_page') ?: 20)));
    $query = new WP_Query(['post_type' => 'xp-ads', 'post_status' => ['publish', 'draft', 'pending'], 'posts_per_page' => $per_page, 'paged' => $page, 'orderby' => 'date', 'order' => 'DESC', 'no_found_rows' => false]);
    $items = [];
    foreach ($query->posts as $ad) {
        if (!xp_ads_user_can_manage_ad($user, $ad->ID)) continue;
        $items[] = xp_ads_rest_payload($ad->ID);
    }
    return rest_ensure_response(['items' => $items, 'page' => $page, 'per_page' => $per_page, 'total' => count($items), 'total_pages' => (int) $query->max_num_pages]);
}

function xp_ads_partner_detail(WP_REST_Request $request) {
    $user = xp_ads_partner_request_identity($request);
    if (is_wp_error($user)) return $user;
    $id = absint($request['id']);
    if (get_post_type($id) !== 'xp-ads' || !xp_ads_user_can_manage_ad($user, $id)) return new WP_Error('xp_ads_not_found', 'Advertisement not found.', ['status' => 404]);
    return rest_ensure_response(xp_ads_rest_payload($id));
}

function xp_ads_partner_create(WP_REST_Request $request) {
    $user = xp_ads_partner_request_identity($request);
    if (is_wp_error($user)) return $user;
    $data = $request->get_json_params();
    $title = sanitize_text_field($data['title'] ?? '');
    $image_url = esc_url_raw($data['image_url'] ?? '');
    $position = sanitize_key($data['position'] ?? '');
    $allowed_positions = ['homepage_top', 'listing_loop_between', 'sidebar_top', 'sidebar_bottom', 'sidebar_map_top'];
    if (!$title || !$image_url || !in_array($position, $allowed_positions, true)) return new WP_Error('xp_ads_invalid', 'Title, creative image and a valid placement are required.', ['status' => 400]);

    $post_id = wp_insert_post(['post_type' => 'xp-ads', 'post_title' => $title, 'post_status' => 'pending', 'post_author' => (int) $user->ID], true);
    if (is_wp_error($post_id)) return $post_id;
    update_post_meta($post_id, 'ad_image_url', $image_url);
    update_post_meta($post_id, 'ad_position', $position);
    update_post_meta($post_id, 'ad_status', 'pending');
    update_post_meta($post_id, 'xp_ad_user_id', [['user_id' => (int) $user->ID]]);
    $target_url = esc_url_raw($data['target_url'] ?? '');
    if ($target_url) update_post_meta($post_id, 'ad_url', $target_url);
    $listing_id = absint($data['listing_id'] ?? 0);
    if ($listing_id) update_post_meta($post_id, 'ad_target_listing', $listing_id);
    $start = sanitize_text_field($data['start_date'] ?? '');
    $end = sanitize_text_field($data['end_date'] ?? '');
    if ($start) update_post_meta($post_id, 'ad_start_date', $start);
    if ($end) update_post_meta($post_id, 'ad_end_date', $end);
    $max_views = absint($data['max_views'] ?? 0);
    $max_clicks = absint($data['max_clicks'] ?? 0);
    if ($max_views) update_post_meta($post_id, 'xp_ad_max_views', $max_views);
    if ($max_clicks) update_post_meta($post_id, 'xp_ad_max_clicks', $max_clicks);

    return new WP_REST_Response(xp_ads_rest_payload($post_id), 201);
}

function xp_ads_partner_update(WP_REST_Request $request) {
    $user = xp_ads_partner_request_identity($request);
    if (is_wp_error($user)) return $user;
    $id = absint($request['id']);
    if (get_post_type($id) !== 'xp-ads' || !xp_ads_user_can_manage_ad($user, $id)) return new WP_Error('xp_ads_not_found', 'Advertisement not found.', ['status' => 404]);
    if (!user_can($user, 'manage_options') && get_post_status($id) === 'publish') return new WP_Error('xp_ads_review_required', 'Published advertisements cannot be edited directly. Submit a revision for review.', ['status' => 403]);

    $data = $request->get_json_params();
    if (isset($data['title'])) wp_update_post(['ID' => $id, 'post_title' => sanitize_text_field($data['title'])]);
    $map = [
        'image_url' => ['ad_image_url', 'url'],
        'target_url' => ['ad_url', 'url'],
        'position' => ['ad_position', 'key'],
        'listing_id' => ['ad_target_listing', 'id'],
        'start_date' => ['ad_start_date', 'text'],
        'end_date' => ['ad_end_date', 'text'],
        'max_views' => ['xp_ad_max_views', 'int'],
        'max_clicks' => ['xp_ad_max_clicks', 'int'],
    ];
    $allowed_positions = ['homepage_top', 'listing_loop_between', 'sidebar_top', 'sidebar_bottom', 'sidebar_map_top'];
    foreach ($map as $field => [$meta_key, $type]) {
        if (!array_key_exists($field, $data)) continue;
        $value = $data[$field];
        if ($type === 'url') $value = esc_url_raw($value);
        elseif ($type === 'key') { $value = sanitize_key($value); if (!in_array($value, $allowed_positions, true)) continue; }
        elseif ($type === 'id' || $type === 'int') $value = absint($value);
        else $value = sanitize_text_field($value);
        update_post_meta($id, $meta_key, $value);
    }
    if (isset($data['status']) && user_can($user, 'manage_options') && in_array($data['status'], ['publish', 'draft', 'pending'], true)) {
        wp_update_post(['ID' => $id, 'post_status' => $data['status']]);
        update_post_meta($id, 'ad_status', $data['status'] === 'publish' ? 'active' : $data['status']);
    }
    return rest_ensure_response(xp_ads_rest_payload($id));
}
