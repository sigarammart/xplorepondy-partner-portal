<?php
/**
 * Plugin Name: Xplore Pondy Rentals
 * Description: Standalone bike and car rental inventory, availability and booking API for Xplore Pondy.
 * Version: 0.1.0
 * Author: Xplore Pondy
 * Text Domain: xplore-pondy-rentals
 */

if (!defined('ABSPATH')) {
    exit;
}

if (defined('XP_RENTALS_LOADED')) {
    return;
}
define('XP_RENTALS_LOADED', true);

define('XP_RENTALS_VERSION', '0.1.0');
define('XP_RENTALS_DB_VERSION', '1');
define('XP_RENTALS_PLUGIN_FILE', __FILE__);
define('XP_RENTALS_PLUGIN_DIR', plugin_dir_path(__FILE__));

register_activation_hook(__FILE__, 'xp_rentals_activate');
function xp_rentals_activate() {
    xp_rentals_install_tables();
    update_option('xp_rentals_db_version', XP_RENTALS_DB_VERSION, false);
}

function xp_rentals_install_tables() {
    global $wpdb;

    require_once ABSPATH . 'wp-admin/includes/upgrade.php';

    $charset = $wpdb->get_charset_collate();
    $vehicles = $wpdb->prefix . 'xp_rental_vehicles';
    $bookings = $wpdb->prefix . 'xp_rental_bookings';
    $blocks = $wpdb->prefix . 'xp_rental_blocks';

    $sql_vehicles = "CREATE TABLE {$vehicles} (
        id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
        owner_user_id bigint(20) unsigned NOT NULL,
        listing_id bigint(20) unsigned NULL,
        vehicle_type varchar(12) NOT NULL,
        brand varchar(100) NOT NULL,
        model varchar(120) NOT NULL,
        variant varchar(120) NOT NULL DEFAULT '',
        registration_year smallint(5) unsigned NULL,
        fuel_type varchar(30) NOT NULL DEFAULT '',
        transmission varchar(30) NOT NULL DEFAULT '',
        engine_cc smallint(5) unsigned NULL,
        seating_capacity tinyint(3) unsigned NULL,
        has_ac tinyint(1) NOT NULL DEFAULT 0,
        helmets_included tinyint(1) NOT NULL DEFAULT 0,
        description text NULL,
        price_per_hour decimal(10,2) NULL,
        price_per_day decimal(10,2) NOT NULL DEFAULT 0,
        price_per_week decimal(10,2) NULL,
        security_deposit decimal(10,2) NOT NULL DEFAULT 0,
        minimum_duration_hours smallint(5) unsigned NOT NULL DEFAULT 24,
        pickup_location varchar(255) NOT NULL DEFAULT '',
        delivery_available tinyint(1) NOT NULL DEFAULT 0,
        delivery_charge decimal(10,2) NOT NULL DEFAULT 0,
        featured_image_url text NULL,
        gallery_json longtext NULL,
        status varchar(20) NOT NULL DEFAULT 'draft',
        created_at datetime NOT NULL,
        updated_at datetime NOT NULL,
        PRIMARY KEY  (id),
        KEY owner_status (owner_user_id,status),
        KEY listing_id (listing_id),
        KEY public_search (status,vehicle_type)
    ) {$charset};";

    $sql_bookings = "CREATE TABLE {$bookings} (
        id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
        booking_code varchar(32) NOT NULL,
        vehicle_id bigint(20) unsigned NOT NULL,
        owner_user_id bigint(20) unsigned NOT NULL,
        customer_user_id bigint(20) unsigned NULL,
        customer_name varchar(150) NOT NULL,
        customer_email varchar(190) NOT NULL,
        customer_phone varchar(40) NOT NULL,
        pickup_datetime datetime NOT NULL,
        return_datetime datetime NOT NULL,
        pickup_location varchar(255) NOT NULL DEFAULT '',
        return_location varchar(255) NOT NULL DEFAULT '',
        rental_amount decimal(10,2) NOT NULL DEFAULT 0,
        delivery_charge decimal(10,2) NOT NULL DEFAULT 0,
        security_deposit decimal(10,2) NOT NULL DEFAULT 0,
        total_amount decimal(10,2) NOT NULL DEFAULT 0,
        payment_status varchar(20) NOT NULL DEFAULT 'unpaid',
        booking_status varchar(20) NOT NULL DEFAULT 'pending',
        customer_notes text NULL,
        created_at datetime NOT NULL,
        updated_at datetime NOT NULL,
        PRIMARY KEY  (id),
        UNIQUE KEY booking_code (booking_code),
        KEY vehicle_dates (vehicle_id,pickup_datetime,return_datetime),
        KEY owner_status (owner_user_id,booking_status),
        KEY customer_user_id (customer_user_id)
    ) {$charset};";

    $sql_blocks = "CREATE TABLE {$blocks} (
        id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
        vehicle_id bigint(20) unsigned NOT NULL,
        owner_user_id bigint(20) unsigned NOT NULL,
        start_datetime datetime NOT NULL,
        end_datetime datetime NOT NULL,
        reason varchar(190) NOT NULL DEFAULT '',
        created_at datetime NOT NULL,
        PRIMARY KEY  (id),
        KEY vehicle_dates (vehicle_id,start_datetime,end_datetime),
        KEY owner_user_id (owner_user_id)
    ) {$charset};";

    dbDelta($sql_vehicles);
    dbDelta($sql_bookings);
    dbDelta($sql_blocks);
}

add_action('plugins_loaded', function () {
    if (get_option('xp_rentals_db_version') !== XP_RENTALS_DB_VERSION) {
        xp_rentals_install_tables();
        update_option('xp_rentals_db_version', XP_RENTALS_DB_VERSION, false);
    }
});

function xp_rentals_table($name) {
    global $wpdb;
    $allowed = ['vehicles', 'bookings', 'blocks'];
    if (!in_array($name, $allowed, true)) {
        return '';
    }
    return $wpdb->prefix . 'xp_rental_' . $name;
}

/**
 * Validate the same HMAC-bridge identity contract used by XP Ad Tracker.
 * This is server-to-server authentication; client-supplied user IDs are ignored.
 */
function xp_rentals_partner_identity(WP_REST_Request $request) {
    $secret = defined('WP_SOCIAL_SESSION_BRIDGE_SECRET') ? WP_SOCIAL_SESSION_BRIDGE_SECRET : '';
    $provided = (string) $request->get_header('x-xplore-pwa-secret');
    $authorization = (string) $request->get_header('authorization');
    $bearer = '';
    if (preg_match('/^Bearer\\s+(.+)$/i', $authorization, $matches)) {
        $bearer = trim((string) $matches[1]);
    }
    $provided_secret = $provided !== '' ? $provided : $bearer;
    $email = sanitize_email((string) $request->get_header('x-xplore-pwa-user-email'));

    if (!$secret || !$provided_secret || !hash_equals((string) $secret, $provided_secret) || !$email) {
        return new WP_Error(
            'xp_rentals_unauthorized',
            $secret ? 'Rental API authentication failed.' : 'Rental API authentication is not configured on WordPress.',
            ['status' => 401]
        );
    }

    $user = get_user_by('email', $email);
    if (!$user || !$user->exists()) {
        return new WP_Error('xp_rentals_user_not_found', 'Partner account was not found.', ['status' => 403]);
    }

    if (!user_can($user, 'manage_options') && !array_intersect(['vendor', 'owner', 'administrator'], (array) $user->roles)) {
        return new WP_Error('xp_rentals_forbidden', 'Your account cannot manage rental vehicles.', ['status' => 403]);
    }

    return $user;
}

function xp_rentals_current_user(WP_REST_Request $request) {
    $user = xp_rentals_partner_identity($request);
    return is_wp_error($user) ? $user : $user;
}

function xp_rentals_user_can_manage_vehicle($user, $vehicle) {
    return user_can($user, 'manage_options') || (int) $vehicle->owner_user_id === (int) $user->ID;
}

function xp_rentals_vehicle_payload($row, $private = false) {
    $payload = [
        'id' => (int) $row->id,
        'vehicle_type' => (string) $row->vehicle_type,
        'brand' => (string) $row->brand,
        'model' => (string) $row->model,
        'variant' => (string) $row->variant,
        'registration_year' => $row->registration_year ? (int) $row->registration_year : null,
        'fuel_type' => (string) $row->fuel_type,
        'transmission' => (string) $row->transmission,
        'engine_cc' => $row->engine_cc ? (int) $row->engine_cc : null,
        'seating_capacity' => $row->seating_capacity ? (int) $row->seating_capacity : null,
        'has_ac' => (bool) $row->has_ac,
        'helmets_included' => (bool) $row->helmets_included,
        'description' => (string) $row->description,
        'price_per_hour' => $row->price_per_hour !== null ? (float) $row->price_per_hour : null,
        'price_per_day' => (float) $row->price_per_day,
        'price_per_week' => $row->price_per_week !== null ? (float) $row->price_per_week : null,
        'security_deposit' => (float) $row->security_deposit,
        'minimum_duration_hours' => (int) $row->minimum_duration_hours,
        'pickup_location' => (string) $row->pickup_location,
        'delivery_available' => (bool) $row->delivery_available,
        'delivery_charge' => (float) $row->delivery_charge,
        'featured_image_url' => (string) $row->featured_image_url,
        'gallery' => $row->gallery_json ? (json_decode($row->gallery_json, true) ?: []) : [],
        'status' => (string) $row->status,
    ];

    if ($private) {
        $payload['owner_user_id'] = (int) $row->owner_user_id;
        $payload['listing_id'] = $row->listing_id ? (int) $row->listing_id : null;
        $payload['created_at'] = (string) $row->created_at;
        $payload['updated_at'] = (string) $row->updated_at;
    }

    return $payload;
}

function xp_rentals_validate_vehicle($data, $partial = false) {
    $errors = [];
    $required = ['vehicle_type', 'brand', 'model', 'price_per_day'];
    if (!$partial) {
        foreach ($required as $field) {
            if (!isset($data[$field]) || $data[$field] === '') {
                $errors[] = $field . ' is required.';
            }
        }
    }

    if (isset($data['vehicle_type']) && !in_array($data['vehicle_type'], ['bike', 'car'], true)) {
        $errors[] = 'vehicle_type must be bike or car.';
    }

    foreach (['brand', 'model', 'variant', 'fuel_type', 'transmission', 'pickup_location'] as $field) {
        if (isset($data[$field]) && !is_scalar($data[$field])) {
            $errors[] = $field . ' must be text.';
        }
    }

    foreach (['price_per_hour', 'price_per_day', 'price_per_week', 'security_deposit', 'delivery_charge'] as $field) {
        if (isset($data[$field]) && (!is_numeric($data[$field]) || (float) $data[$field] < 0)) {
            $errors[] = $field . ' must be a non-negative amount.';
        }
    }

    if (isset($data['status']) && !in_array($data['status'], ['draft', 'active', 'inactive'], true)) {
        $errors[] = 'status must be draft, active or inactive.';
    }

    return $errors;
}

function xp_rentals_normalize_vehicle_input($data) {
    $text_fields = ['brand', 'model', 'variant', 'fuel_type', 'transmission', 'pickup_location', 'description', 'featured_image_url'];
    $integer_fields = ['listing_id', 'registration_year', 'engine_cc', 'seating_capacity', 'minimum_duration_hours'];
    $decimal_fields = ['price_per_hour', 'price_per_day', 'price_per_week', 'security_deposit', 'delivery_charge'];
    $boolean_fields = ['has_ac', 'helmets_included', 'delivery_available'];

    $clean = [];
    if (isset($data['vehicle_type'])) $clean['vehicle_type'] = sanitize_key($data['vehicle_type']);
    foreach ($text_fields as $field) {
        if (array_key_exists($field, $data)) {
            $clean[$field] = $field === 'description' ? sanitize_textarea_field($data[$field]) : sanitize_text_field($data[$field]);
        }
    }
    foreach ($integer_fields as $field) {
        if (array_key_exists($field, $data)) $clean[$field] = max(0, absint($data[$field]));
    }
    foreach ($decimal_fields as $field) {
        if (array_key_exists($field, $data)) $clean[$field] = round((float) $data[$field], 2);
    }
    foreach ($boolean_fields as $field) {
        if (array_key_exists($field, $data)) $clean[$field] = !empty($data[$field]) ? 1 : 0;
    }
    if (array_key_exists('gallery', $data)) {
        $gallery = is_array($data['gallery']) ? $data['gallery'] : [];
        $clean['gallery_json'] = wp_json_encode(array_values(array_filter(array_map('esc_url_raw', $gallery))));
    }
    if (isset($data['status'])) $clean['status'] = sanitize_key($data['status']);

    return $clean;
}

function xp_rentals_vehicle_to_db($data) {
    $map = [
        'vehicle_type' => 'vehicle_type', 'brand' => 'brand', 'model' => 'model',
        'variant' => 'variant', 'listing_id' => 'listing_id',
        'registration_year' => 'registration_year', 'fuel_type' => 'fuel_type',
        'transmission' => 'transmission', 'engine_cc' => 'engine_cc',
        'seating_capacity' => 'seating_capacity', 'has_ac' => 'has_ac',
        'helmets_included' => 'helmets_included', 'description' => 'description',
        'price_per_hour' => 'price_per_hour', 'price_per_day' => 'price_per_day',
        'price_per_week' => 'price_per_week', 'security_deposit' => 'security_deposit',
        'minimum_duration_hours' => 'minimum_duration_hours',
        'pickup_location' => 'pickup_location', 'delivery_available' => 'delivery_available',
        'delivery_charge' => 'delivery_charge', 'featured_image_url' => 'featured_image_url',
        'gallery_json' => 'gallery_json', 'status' => 'status',
    ];
    $result = [];
    foreach ($map as $input => $column) {
        if (array_key_exists($input, $data)) $result[$column] = $data[$input];
    }
    return $result;
}

add_action('rest_api_init', function () {
    register_rest_route('xplore-rentals/v1', '/partner/vehicles', [
        [
            'methods' => WP_REST_Server::READABLE,
            'permission_callback' => 'xp_rentals_current_user',
            'callback' => 'xp_rentals_partner_list_vehicles',
            'args' => [
                'page' => ['default' => 1, 'sanitize_callback' => 'absint'],
                'per_page' => ['default' => 20, 'sanitize_callback' => 'absint'],
                'vehicle_type' => ['sanitize_callback' => 'sanitize_key'],
            ],
        ],
        [
            'methods' => WP_REST_Server::CREATABLE,
            'permission_callback' => 'xp_rentals_current_user',
            'callback' => 'xp_rentals_partner_create_vehicle',
        ],
    ]);

    register_rest_route('xplore-rentals/v1', '/partner/vehicles/(?P<id>\\d+)', [
        [
            'methods' => WP_REST_Server::READABLE,
            'permission_callback' => 'xp_rentals_current_user',
            'callback' => 'xp_rentals_partner_get_vehicle',
        ],
        [
            'methods' => 'POST, PUT, PATCH',
            'permission_callback' => 'xp_rentals_current_user',
            'callback' => 'xp_rentals_partner_update_vehicle',
        ],
        [
            'methods' => WP_REST_Server::DELETABLE,
            'permission_callback' => 'xp_rentals_current_user',
            'callback' => 'xp_rentals_partner_delete_vehicle',
        ],
    ]);

    register_rest_route('xplore-rentals/v1', '/vehicles', [
        [
            'methods' => WP_REST_Server::READABLE,
            'permission_callback' => '__return_true',
            'callback' => 'xp_rentals_public_list_vehicles',
            'args' => [
                'vehicle_type' => ['sanitize_callback' => 'sanitize_key'],
                'search' => ['sanitize_callback' => 'sanitize_text_field'],
                'page' => ['default' => 1, 'sanitize_callback' => 'absint'],
                'per_page' => ['default' => 20, 'sanitize_callback' => 'absint'],
            ],
        ],
    ]);

    register_rest_route('xplore-rentals/v1', '/vehicles/(?P<id>\\d+)', [
        [
            'methods' => WP_REST_Server::READABLE,
            'permission_callback' => '__return_true',
            'callback' => 'xp_rentals_public_get_vehicle',
        ],
    ]);

    register_rest_route('xplore-rentals/v1', '/availability', [
        [
            'methods' => WP_REST_Server::READABLE,
            'permission_callback' => '__return_true',
            'callback' => 'xp_rentals_check_availability',
            'args' => [
                'vehicle_id' => ['required' => true, 'sanitize_callback' => 'absint'],
                'pickup_datetime' => ['required' => true, 'sanitize_callback' => 'sanitize_text_field'],
                'return_datetime' => ['required' => true, 'sanitize_callback' => 'sanitize_text_field'],
            ],
        ],
    ]);
});

function xp_rentals_partner_list_vehicles(WP_REST_Request $request) {
    global $wpdb;
    $user = xp_rentals_current_user($request);
    if (is_wp_error($user)) return $user;

    $page = max(1, absint($request->get_param('page')));
    $per_page = min(100, max(1, absint($request->get_param('per_page'))));
    $offset = ($page - 1) * $per_page;
    $type = sanitize_key((string) $request->get_param('vehicle_type'));
    $table = xp_rentals_table('vehicles');

    $where = user_can($user, 'manage_options') ? '1=1' : $wpdb->prepare('owner_user_id = %d', $user->ID);
    if (in_array($type, ['bike', 'car'], true)) $where .= $wpdb->prepare(' AND vehicle_type = %s', $type);

    $rows = $wpdb->get_results($wpdb->prepare("SELECT * FROM {$table} WHERE {$where} ORDER BY updated_at DESC LIMIT %d OFFSET %d", $per_page, $offset));
    $total = (int) $wpdb->get_var("SELECT COUNT(*) FROM {$table} WHERE {$where}");

    return rest_ensure_response([
        'items' => array_map(function ($row) { return xp_rentals_vehicle_payload($row, true); }, $rows),
        'page' => $page, 'per_page' => $per_page, 'total' => $total,
        'total_pages' => (int) ceil($total / $per_page),
    ]);
}

function xp_rentals_partner_create_vehicle(WP_REST_Request $request) {
    global $wpdb;
    $user = xp_rentals_current_user($request);
    if (is_wp_error($user)) return $user;

    $data = $request->get_json_params();
    $errors = xp_rentals_validate_vehicle($data);
    if ($errors) return new WP_Error('xp_rentals_invalid_vehicle', implode(' ', $errors), ['status' => 400]);

    $clean = xp_rentals_normalize_vehicle_input($data);
    // Owners can submit vehicles for review but cannot publish them directly.
    $clean['status'] = 'draft';
    $now = current_time('mysql');
    $db_data = xp_rentals_vehicle_to_db($clean);
    $db_data['owner_user_id'] = (int) $user->ID;
    $db_data['created_at'] = $now;
    $db_data['updated_at'] = $now;

    $ok = $wpdb->insert(xp_rentals_table('vehicles'), $db_data);
    if (!$ok) return new WP_Error('xp_rentals_create_failed', 'Vehicle could not be saved.', ['status' => 500]);

    $row = $wpdb->get_row($wpdb->prepare('SELECT * FROM ' . xp_rentals_table('vehicles') . ' WHERE id = %d', $wpdb->insert_id));
    return new WP_REST_Response(xp_rentals_vehicle_payload($row, true), 201);
}

function xp_rentals_partner_get_vehicle(WP_REST_Request $request) {
    global $wpdb;
    $user = xp_rentals_current_user($request);
    if (is_wp_error($user)) return $user;
    $row = $wpdb->get_row($wpdb->prepare('SELECT * FROM ' . xp_rentals_table('vehicles') . ' WHERE id = %d', absint($request['id'])));
    if (!$row || !xp_rentals_user_can_manage_vehicle($user, $row)) return new WP_Error('xp_rentals_not_found', 'Vehicle not found.', ['status' => 404]);
    return rest_ensure_response(xp_rentals_vehicle_payload($row, true));
}

function xp_rentals_partner_update_vehicle(WP_REST_Request $request) {
    global $wpdb;
    $user = xp_rentals_current_user($request);
    if (is_wp_error($user)) return $user;
    $id = absint($request['id']);
    $row = $wpdb->get_row($wpdb->prepare('SELECT * FROM ' . xp_rentals_table('vehicles') . ' WHERE id = %d', $id));
    if (!$row || !xp_rentals_user_can_manage_vehicle($user, $row)) return new WP_Error('xp_rentals_not_found', 'Vehicle not found.', ['status' => 404]);

    $data = $request->get_json_params();
    $errors = xp_rentals_validate_vehicle($data, true);
    if ($errors) return new WP_Error('xp_rentals_invalid_vehicle', implode(' ', $errors), ['status' => 400]);

    $clean = xp_rentals_normalize_vehicle_input($data);
    if (!user_can($user, 'manage_options')) unset($clean['status']);
    $clean['updated_at'] = current_time('mysql');
    $db_data = xp_rentals_vehicle_to_db($clean);
    $db_data['updated_at'] = $clean['updated_at'];

    if ($db_data) {
        $wpdb->update(xp_rentals_table('vehicles'), $db_data, ['id' => $id]);
    }

    $updated = $wpdb->get_row($wpdb->prepare('SELECT * FROM ' . xp_rentals_table('vehicles') . ' WHERE id = %d', $id));
    return rest_ensure_response(xp_rentals_vehicle_payload($updated, true));
}

function xp_rentals_partner_delete_vehicle(WP_REST_Request $request) {
    global $wpdb;
    $user = xp_rentals_current_user($request);
    if (is_wp_error($user)) return $user;
    $id = absint($request['id']);
    $row = $wpdb->get_row($wpdb->prepare('SELECT * FROM ' . xp_rentals_table('vehicles') . ' WHERE id = %d', $id));
    if (!$row || !xp_rentals_user_can_manage_vehicle($user, $row)) return new WP_Error('xp_rentals_not_found', 'Vehicle not found.', ['status' => 404]);

    $booking_count = (int) $wpdb->get_var($wpdb->prepare(
        "SELECT COUNT(*) FROM " . xp_rentals_table('bookings') . " WHERE vehicle_id = %d AND booking_status IN ('pending','confirmed')",
        $id
    ));
    if ($booking_count > 0) return new WP_Error('xp_rentals_vehicle_has_bookings', 'This vehicle has pending or confirmed bookings. Deactivate it instead of deleting it.', ['status' => 409]);

    $wpdb->delete(xp_rentals_table('vehicles'), ['id' => $id]);
    $wpdb->delete(xp_rentals_table('blocks'), ['vehicle_id' => $id]);
    return rest_ensure_response(['deleted' => true, 'id' => $id]);
}

function xp_rentals_public_list_vehicles(WP_REST_Request $request) {
    global $wpdb;
    $page = max(1, absint($request->get_param('page')));
    $per_page = min(50, max(1, absint($request->get_param('per_page'))));
    $offset = ($page - 1) * $per_page;
    $type = sanitize_key((string) $request->get_param('vehicle_type'));
    $search = sanitize_text_field((string) $request->get_param('search'));
    $table = xp_rentals_table('vehicles');

    $where = "status = 'active'";
    if (in_array($type, ['bike', 'car'], true)) $where .= $wpdb->prepare(' AND vehicle_type = %s', $type);
    if ($search !== '') {
        $like = '%' . $wpdb->esc_like($search) . '%';
        $where .= $wpdb->prepare(' AND (brand LIKE %s OR model LIKE %s OR variant LIKE %s)', $like, $like, $like);
    }

    $rows = $wpdb->get_results($wpdb->prepare("SELECT * FROM {$table} WHERE {$where} ORDER BY id DESC LIMIT %d OFFSET %d", $per_page, $offset));
    $total = (int) $wpdb->get_var("SELECT COUNT(*) FROM {$table} WHERE {$where}");

    return rest_ensure_response([
        'items' => array_map(function ($row) { return xp_rentals_vehicle_payload($row, false); }, $rows),
        'page' => $page, 'per_page' => $per_page, 'total' => $total,
        'total_pages' => (int) ceil($total / $per_page),
    ]);
}

function xp_rentals_public_get_vehicle(WP_REST_Request $request) {
    global $wpdb;
    $row = $wpdb->get_row($wpdb->prepare(
        "SELECT * FROM " . xp_rentals_table('vehicles') . " WHERE id = %d AND status = 'active'",
        absint($request['id'])
    ));
    if (!$row) return new WP_Error('xp_rentals_not_found', 'Vehicle not found.', ['status' => 404]);
    return rest_ensure_response(xp_rentals_vehicle_payload($row, false));
}

function xp_rentals_parse_datetime($value) {
    if (!is_string($value) || !preg_match('/^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}$/', $value)) {
        return false;
    }
    $dt = DateTime::createFromFormat('!Y-m-d H:i:s', $value, wp_timezone());
    if (!$dt || $dt->format('Y-m-d H:i:s') !== $value) return false;
    return $dt->format('Y-m-d H:i:s');
}

/**
 * Availability is advisory until the transactional booking endpoint in Phase 2.
 * Pending and confirmed bookings, plus owner blocks, make the vehicle unavailable.
 */
function xp_rentals_check_availability(WP_REST_Request $request) {
    global $wpdb;
    $vehicle_id = absint($request->get_param('vehicle_id'));
    $pickup = xp_rentals_parse_datetime((string) $request->get_param('pickup_datetime'));
    $return = xp_rentals_parse_datetime((string) $request->get_param('return_datetime'));

    if (!$vehicle_id || !$pickup || !$return || $return <= $pickup) {
        return new WP_Error('xp_rentals_invalid_dates', 'Provide a valid vehicle_id and pickup/return datetimes in YYYY-MM-DD HH:MM:SS format.', ['status' => 400]);
    }

    $vehicle = $wpdb->get_row($wpdb->prepare(
        "SELECT id, status FROM " . xp_rentals_table('vehicles') . " WHERE id = %d",
        $vehicle_id
    ));
    if (!$vehicle || $vehicle->status !== 'active') {
        return new WP_Error('xp_rentals_not_found', 'Vehicle not found or not available for rental.', ['status' => 404]);
    }

    $booking_conflicts = (int) $wpdb->get_var($wpdb->prepare(
        "SELECT COUNT(*) FROM " . xp_rentals_table('bookings') . "
         WHERE vehicle_id = %d
           AND booking_status IN ('pending','confirmed')
           AND pickup_datetime < %s
           AND return_datetime > %s",
        $vehicle_id, $return, $pickup
    ));
    $block_conflicts = (int) $wpdb->get_var($wpdb->prepare(
        "SELECT COUNT(*) FROM " . xp_rentals_table('blocks') . "
         WHERE vehicle_id = %d
           AND start_datetime < %s
           AND end_datetime > %s",
        $vehicle_id, $return, $pickup
    ));

    return rest_ensure_response([
        'vehicle_id' => $vehicle_id,
        'available' => ($booking_conflicts + $block_conflicts) === 0,
        'conflicts' => [
            'bookings' => $booking_conflicts,
            'owner_blocks' => $block_conflicts,
        ],
        'note' => 'Availability check only; no vehicle is held or booked by this request.',
    ]);
}
