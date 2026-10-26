/** Listeo → WooCommerce payment URL lookup (PWA booking bridge). */
async function resolveListeoPaymentUrlFromOrder(
  email: string,
  createdAfter: number,
  listingId: number,
  submittedProductIds: number[] = [],
): Promise<{ orderId: number; paymentUrl: string } | undefined> {
  const secret = process.env.WP_SOCIAL_SESSION_BRIDGE_SECRET?.trim();
  if (!secret) {
    throw new Error("The PWA booking bridge is not configured. Set WP_SOCIAL_SESSION_BRIDGE_SECRET on the PWA server.");
  }

  let lastStatus: number | undefined;
  let lastBridgeReason: string | undefined;
  let lastBridgeVersion: string | undefined;
  let lastDiagnostics: {
    orders_scanned?: number;
    identity_matches?: number;
    product_matches?: number;
    unpaid_matches?: number;
    listing_id_requested?: number;
    expected_product_ids?: number[];
    submitted_product_ids?: number[];
    product_mismatches?: Array<{
      id?: number;
      status?: string;
      order_product_ids?: number[];
      expected_product_ids?: number[];
      submitted_product_ids?: number[];
    }>;
    recent_orders?: Array<{
      id?: number;
      status?: string;
      created?: string;
      customer_id?: number;
      billing_email?: string;
      product_ids?: number[];
      product_names?: string[];
    }>;
  } | undefined;

  const WP_ORIGIN = "https://xplorepondy.com";

  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      const response = await fetch(WP_ORIGIN + "/wp-json/xplore/v1/pwa/latest-order", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: "Bearer " + secret,
        },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          created_after: createdAfter,
          listing_id: listingId,
          product_id: submittedProductIds,
        }),
        signal: AbortSignal.timeout(12000),
      });

      lastStatus = response.status;

      if (response.status === 401 || response.status === 403) {
        throw new Error(
          "The WordPress booking bridge rejected the PWA secret. WP_SOCIAL_SESSION_BRIDGE_SECRET and XPLORE_PWA_SESSION_SECRET must contain the same value.",
        );
      }

      if (response.status === 404) {
        throw new Error(
          "The WordPress payment-order bridge is not installed. Install and activate the xplore-pwa-booking-bridge plugin on xplorepondy.com (and disable the old WPCode snippet).",
        );
      }

      if (response.ok) {
        const body = (await response.json().catch(() => null)) as
          | {
              ok?: boolean;
              order_id?: number;
              payment_url?: string;
              reason?: string;
              bridge_version?: string;
              diagnostics?: typeof lastDiagnostics;
            }
          | null;
        if (body?.bridge_version) lastBridgeVersion = body.bridge_version;
        if (body?.diagnostics) lastDiagnostics = body.diagnostics;
        if (body?.ok && body.payment_url && Number(body.order_id) > 0) {
          return {
            orderId: Number(body.order_id),
            paymentUrl: body.payment_url,
          };
        }
        if (body?.reason) {
          lastBridgeReason = body.reason;
        }
      }
    } catch (error) {
      if (error instanceof Error && /booking bridge|payment-order bridge|WP_SOCIAL_SESSION_BRIDGE_SECRET|XPLORE_PWA_SESSION_SECRET/i.test(error.message)) {
        throw error;
      }
    }

    if (attempt < 9) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  if (lastStatus && lastStatus >= 500) {
    throw new Error(
      "The WordPress payment-order bridge returned a server error. Check the xplore-pwa-booking-bridge plugin and WooCommerce on xplorepondy.com.",
    );
  }

  // bridge_version is diagnostic only — do not block on version string.
  // Surface concrete order-match failures below instead of a false "older WPCode" error.

  if (lastBridgeReason === "submitted_product_id_does_not_match_listing_product") {
    const expected = (lastDiagnostics?.expected_product_ids ?? []).join(",") || "none";
    const submitted = (lastDiagnostics?.submitted_product_ids ?? []).join(",") || "none";
    throw new Error(`Listeo submitted product ${submitted}, but the listing is linked to WooCommerce product ${expected}.`);
  }
  if (lastBridgeReason === "multiple_fresh_product_orders_without_customer_match") {
    throw new Error("Listeo created multiple fresh WooCommerce orders for this product, but none is linked to the WordPress customer/email. Update the WordPress bridge plugin.");
  }
  if (lastBridgeReason === "fresh_product_order_found_but_payment_url_unavailable") {
    throw new Error("A fresh WooCommerce order for this listing product was found, but WooCommerce did not return a payment URL. Check the order status in wp-admin.");
  }
  if (lastBridgeReason === "recent_orders_found_but_customer_did_not_match") {
    const submitted = (lastDiagnostics?.submitted_product_ids ?? []).join(",") || "none";
    const expected = (lastDiagnostics?.expected_product_ids ?? []).join(",") || "none";
    throw new Error(`Listeo created recent WooCommerce orders, but none matched the WordPress customer/email or listing product. Submitted product: ${submitted}; listing product: ${expected}.`);
  }
  if (lastBridgeReason === "matching_order_was_paid_or_terminal") {
    throw new Error("Listeo found a matching WooCommerce order, but it is already paid or in a terminal status.");
  }
  if (lastBridgeReason === "matching_unpaid_order_has_no_payment_url") {
    throw new Error("A matching unpaid WooCommerce order exists, but WooCommerce did not return its payment URL.");
  }
  if (lastBridgeReason === "no_recent_matching_order") {
    const recent = lastDiagnostics?.recent_orders ?? [];
    const summary = recent.length
      ? recent
          .slice(0, 5)
          .map((order) =>
            `#${order.id ?? "?"} ${order.status ?? "?"} ${order.billing_email || "no-email"} products:${(order.product_ids ?? []).join(",") || "-"}`,
          )
          .join(" | ")
      : "none";
    throw new Error(
      `No matching fresh WooCommerce order was detected for this booking attempt. Recent candidates: ${summary}`,
    );
  }
  if (lastBridgeVersion) {
    throw new Error(
      `Booking order lookup failed (bridge ${lastBridgeVersion}${lastBridgeReason ? `, reason: ${lastBridgeReason}` : ""}). Check WooCommerce orders and the xplore-pwa-booking-bridge plugin.`,
    );
  }
  return undefined;
}

export { resolveListeoPaymentUrlFromOrder };
