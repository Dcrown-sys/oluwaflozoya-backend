// controllers/deliveryController.js
const { sql } = require('../db');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const crypto = require('crypto');

exports.createPendingDelivery = async (req, res) => {
  try {
    const { courier_id, order_id, pickup_address, dropoff_address, delivery_fee } = req.body;
    const adminId = req.user?.id;

    if (!courier_id || !order_id || !pickup_address || !dropoff_address || !delivery_fee) {
      return res.status(400).json({ success: false, message: "Missing required fields." });
    }

    const [order] = await sql`SELECT id, user_id, status FROM orders WHERE id = ${order_id};`;
    if (!order) return res.status(404).json({ success: false, message: "Order not found." });

    const existing = await sql`
      SELECT id FROM deliveries WHERE order_id = ${order_id} AND status = 'pending';
    `;
    if (existing.length > 0) {
      return res.status(400).json({ success: false, message: "Delivery already pending for this order." });
    }

    const [delivery] = await sql`
      INSERT INTO deliveries (
        courier_id, order_id, pickup_address, dropoff_address, delivery_fee,
        status, created_by, created_at, updated_at
      )
      VALUES (
        ${courier_id}, ${order_id}, ${pickup_address}, ${dropoff_address}, ${delivery_fee},
        'pending', ${adminId}, NOW(), NOW()
      )
      RETURNING id, order_id, courier_id, status;
    `;

    return res.json({
      success: true,
      message: "Delivery request created. Buyer notified to pay the delivery fee.",
      data: delivery,
    });
  } catch (err) {
    console.error("❌ createPendingDelivery error:", err);
    res.status(500).json({ success: false, message: "Failed to create pending delivery." });
  }
};

exports.getPendingDeliveryByOrder = async (req, res) => {
  try {
    const { order_id } = req.params;
    const [delivery] = await sql`
      SELECT 
        d.*, p.tx_ref, p.amount AS payment_amount, p.status AS payment_status
      FROM deliveries d
      LEFT JOIN payments p
        ON p.order_id = d.order_id AND p.payment_type = 'delivery_fee'
      WHERE d.order_id = ${order_id} AND d.status = 'pending'
      LIMIT 1;
    `;

    if (!delivery) {
      return res.status(404).json({ success: false, message: 'No pending delivery found' });
    }

    res.json({ success: true, delivery });
  } catch (err) {
    console.error('❌ getPendingDeliveryByOrder error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.initiateDeliveryPayment = async (req, res) => {
  try {
    const { order_id } = req.params;

    if (!order_id) {
      return res.status(400).json({ success: false, message: 'order_id is required' });
    }

    const [delivery] = await sql`
      SELECT
        d.id AS delivery_id,
        d.delivery_fee,
        o.user_id,
        o.name,
        o.email,
        o.phone_number
      FROM deliveries d
      JOIN orders o ON o.id = d.order_id
      WHERE d.order_id = ${order_id}
        AND d.status = 'pending'
      LIMIT 1;
    `;

    if (!delivery) {
      return res.status(404).json({ success: false, message: 'No pending delivery found' });
    }

    const amount = Number(delivery.delivery_fee);
    if (amount <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid delivery fee' });
    }

    const paymentReference = `DELIVERY-${order_id}-${Date.now()}`;
    const txRef = `delivery-${order_id}-${crypto.randomUUID()}`;

    let [payment] = await sql`
      SELECT * FROM payments
      WHERE order_id = ${order_id} AND payment_type = 'delivery_fee'
      LIMIT 1;
    `;

    if (!payment) {
      [payment] = await sql`
        INSERT INTO payments (
          order_id, user_id, amount, currency, status,
          payment_type, payment_method, tx_ref, payment_reference,
          created_at, updated_at
        )
        VALUES (
          ${order_id}, ${delivery.user_id}, ${amount}, 'NGN', 'pending',
          'delivery_fee', 'flutterwave', ${txRef}, ${paymentReference},
          NOW(), NOW()
        )
        RETURNING *;
      `;
    } else {
      // FIX 1: Only allow re-initiating if payment is NOT already completed
      if (payment.status === 'completed') {
        return res.status(400).json({
          success: false,
          message: 'Delivery fee has already been paid for this order.',
        });
      }

      [payment] = await sql`
        UPDATE payments
        SET tx_ref = ${txRef}, payment_reference = ${paymentReference},
            amount = ${amount}, updated_at = NOW()
        WHERE id = ${payment.id}
        RETURNING *;
      `;
    }

    const payload = {
      tx_ref: payment.tx_ref,
      amount,
      currency: 'NGN',
      redirect_url: `${process.env.BASE_URL}/api/delivery/payment-success?tx_ref=${txRef}`,
      customer: {
        email: delivery.email,
        name: delivery.name,
        phonenumber: String(delivery.phone_number).replace(/\D/g, ''),
      },
      meta: {
        order_id,
        payment_reference: payment.payment_reference,
        payment_type: 'delivery_fee',
      },
      customizations: {
        title: 'Zoya Delivery Payment',
        description: `Delivery fee for order ${order_id}`,
      },
    };

    const fwRes = await axios.post(
      'https://api.flutterwave.com/v3/payments',
      payload,
      {
        headers: {
          Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (fwRes.data?.status !== 'success') {
      console.error('❌ Flutterwave returned error:', fwRes.data);
      return res.status(400).json({ success: false, message: 'Flutterwave error' });
    }

    res.json({
      success: true,
      payment_link: fwRes.data.data.link,
      tx_ref: payment.tx_ref,
      payment_reference: payment.payment_reference,
    });

  } catch (err) {
    console.error('❌ initiateDeliveryPayment error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.finalizeDeliveryAfterPaymentAuto = async (orderId) => {
  try {
    if (!orderId) return console.warn("⚠️ No order ID provided for auto-finalization");

    const [order] = await sql`
      SELECT id, user_id, courier_id, status FROM orders WHERE id = ${orderId} LIMIT 1;
    `;
    if (!order) return console.warn(`⚠️ Order ${orderId} not found`);

    let courierId = order.courier_id;

    if (!courierId) {
      const [courier] = await sql`
        SELECT id FROM couriers
        WHERE verification_status = 'approved' AND availability = 'Online'
        ORDER BY RANDOM() LIMIT 1;
      `;
      if (!courier) return console.warn(`⚠️ No available courier for order ${orderId}`);
      courierId = courier.id;
    }

    await sql`
      UPDATE orders SET courier_id = ${courierId}, status = 'en_route', updated_at = NOW()
      WHERE id = ${orderId};
    `;

    const existingDelivery = await sql`
      SELECT id FROM deliveries WHERE order_id = ${orderId} AND courier_id = ${courierId} LIMIT 1;
    `;

    if (existingDelivery.length === 0) {
      await sql`
        INSERT INTO deliveries (order_id, courier_id, status, created_at)
        VALUES (${orderId}, ${courierId}, 'en_route', NOW());
      `;
    } else {
      await sql`
        UPDATE deliveries SET status = 'en_route', updated_at = NOW()
        WHERE id = ${existingDelivery[0].id};
      `;
    }

    await sql`UPDATE couriers SET availability = 'Busy' WHERE id = ${courierId};`;

    console.log(`✅ [Auto-Finalize] Courier ${courierId} assigned for order ${orderId}`);
  } catch (err) {
    console.error("❌ finalizeDeliveryAfterPaymentAuto error:", err);
  }
};

// FIX 2: Check Flutterwave status BEFORE marking payment complete.
// Cancelled payments hit the same redirect URL — we must verify with Flutterwave first.
exports.flutterwavePaymentCallback = async (req, res) => {
  try {
    let tx_ref = req.query.tx_ref;
    if (!tx_ref) return res.status(400).send('Missing tx_ref');

    tx_ref = tx_ref.trim();

    // Check the status query param Flutterwave sends on redirect
    // cancelled payments come with ?status=cancelled
    const redirectStatus = req.query.status;
    if (redirectStatus === 'cancelled') {
      console.log(`⚠️ Payment cancelled by user for tx_ref: ${tx_ref}`);
      // Redirect buyer back to app — payment stays 'pending', nothing is updated
      return res.redirect(
        `${process.env.MOBILE_REDIRECT_URL || 'oluwoflomobile://payment-cancelled'}?tx_ref=${tx_ref}&status=cancelled`
      );
    }

    // Verify with Flutterwave regardless of redirect status
    const verifyRes = await axios.get(
      `https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${tx_ref}`,
      { headers: { Authorization: `Bearer ${process.env.FLW_SECRET_KEY}` } }
    );

    const verification = verifyRes.data?.data;

    // FIX 3: Only proceed if Flutterwave confirms the transaction as 'successful'
    if (!verification || verification.status !== 'successful') {
      console.log(`⚠️ Payment not successful for tx_ref: ${tx_ref} — status: ${verification?.status}`);
      return res.redirect(
        `${process.env.MOBILE_REDIRECT_URL || 'oluwoflomobile://payment-cancelled'}?tx_ref=${tx_ref}&status=failed`
      );
    }

    const orderId = verification.meta?.order_id;
    if (!orderId) return res.status(400).send('Order ID missing in metadata');

    // Guard: check payment isn't already completed (prevents double processing)
    const [existingPayment] = await sql`
      SELECT status FROM payments WHERE tx_ref = ${tx_ref} LIMIT 1;
    `;
    if (existingPayment?.status === 'completed') {
      console.log(`ℹ️ Payment already completed for tx_ref: ${tx_ref} — skipping`);
      return res.redirect(
        `${process.env.MOBILE_REDIRECT_URL || 'oluwoflomobile://payment-success'}?tx_ref=${tx_ref}&status=success`
      );
    }

    // Mark payment complete and update order
    await sql`
      UPDATE payments SET status = 'completed', updated_at = NOW()
      WHERE tx_ref = ${tx_ref};
    `;
    await sql`
      UPDATE orders SET status = 'delivery_paid', updated_at = NOW()
      WHERE id = ${orderId};
    `;

    await exports.finalizeDeliveryAfterPaymentAuto(orderId);

    console.log(`✅ Payment confirmed and delivery finalized for order ${orderId}`);

    return res.redirect(
      `${process.env.MOBILE_REDIRECT_URL || 'oluwoflomobile://payment-success'}?tx_ref=${tx_ref}&status=success`
    );

  } catch (err) {
    console.error("❌ flutterwavePaymentCallback error:", err.response?.data || err.message);
    res.status(500).send("Internal server error during Flutterwave callback");
  }
};

// FIX 4: getOrderAndDeliveryDetails — pick delivery row with addresses populated,
// and explicitly select pickup_address + dropoff_address
exports.getOrderAndDeliveryDetails = async (req, res) => {
  try {
    const { order_id } = req.params;

    // Fetch the delivery row that actually has address data
    const [delivery] = await sql`
      SELECT
        d.id                  AS delivery_id,
        d.status              AS delivery_status,
        d.delivery_fee,
        d.pickup_address,
        d.dropoff_address,
        d.pickup_latitude,
        d.pickup_longitude,
        d.dropoff_latitude,
        d.dropoff_longitude,
        d.distance_km,
        d.eta,
        d.eta_minutes,
        d.last_location,
        d.assigned_at,
        d.picked_up_at,
        d.delivered_at,
        d.created_at          AS delivery_created_at,
        d.updated_at          AS delivery_updated_at,
        d.courier_id,
        c.full_name           AS courier_name,
        c.phone               AS courier_phone,
        c.vehicle_type,
        c.vehicle_plate
      FROM deliveries d
      LEFT JOIN couriers c ON c.id = d.courier_id
      WHERE d.order_id = ${order_id}
      ORDER BY
        -- Prefer rows with address data
        CASE WHEN d.pickup_address IS NOT NULL AND d.pickup_address != '' THEN 0 ELSE 1 END ASC,
        d.created_at ASC
      LIMIT 1;
    `;

    const [order] = await sql`
      SELECT
        o.id            AS order_id,
        o.status        AS order_status,
        o.total_amount,
        o.created_at,
        o.updated_at
      FROM orders o
      WHERE o.id = ${order_id}
      LIMIT 1;
    `;

    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    // Payment status
    const [payment] = await sql`
      SELECT status AS payment_status, amount AS payment_amount
      FROM payments
      WHERE order_id = ${order_id} AND payment_type = 'delivery_fee'
      ORDER BY created_at DESC
      LIMIT 1;
    `;

    // Items
    const items = await sql`
      SELECT
        oi.id             AS order_item_id,
        oi.product_id,
        oi.product_name,
        oi.quantity,
        oi.unit_price,
        oi.total_price,
        p.description     AS product_description,
        p.image_url       AS product_image
      FROM order_items oi
      LEFT JOIN products p ON p.id = oi.product_id
      WHERE oi.order_id = ${order_id};
    `;

    // Parse courier last_location JSON
    let courierLat = null;
    let courierLng = null;
    if (delivery?.last_location) {
      try {
        const loc = typeof delivery.last_location === 'string'
          ? JSON.parse(delivery.last_location)
          : delivery.last_location;
        courierLat = loc?.lat ?? loc?.latitude ?? null;
        courierLng = loc?.lng ?? loc?.longitude ?? null;
      } catch (_) {}
    }

    res.json({
      success: true,
      order: {
        // Order
        order_id:       order.order_id,
        order_status:   order.order_status,
        total_amount:   order.total_amount,
        created_at:     order.created_at,
        updated_at:     order.updated_at,

        // Delivery
        delivery_id:          delivery?.delivery_id         || null,
        delivery_status:      delivery?.delivery_status     || null,
        delivery_fee:         delivery?.delivery_fee        || null,
        distance_km:          delivery?.distance_km         || null,
        eta:                  delivery?.eta                 || null,
        eta_minutes:          delivery?.eta_minutes         || null,
        assigned_at:          delivery?.assigned_at         || null,
        picked_up_at:         delivery?.picked_up_at        || null,
        delivered_at:         delivery?.delivered_at        || null,
        delivery_created_at:  delivery?.delivery_created_at || null,
        delivery_updated_at:  delivery?.delivery_updated_at || null,

        // ✅ Addresses
        pickup_address:  delivery?.pickup_address  || null,
        dropoff_address: delivery?.dropoff_address || null,

        // Coordinates
        pickup_lat:  delivery?.pickup_latitude  || null,
        pickup_lng:  delivery?.pickup_longitude || null,
        dropoff_lat: delivery?.dropoff_latitude  || null,
        dropoff_lng: delivery?.dropoff_longitude || null,

        // Live courier location
        courier_lat: courierLat,
        courier_lng: courierLng,

        // Payment
        payment_status: payment?.payment_status || null,
        payment_amount: payment?.payment_amount || null,

        // Courier
        courier_id:    delivery?.courier_id    || null,
        courier_name:  delivery?.courier_name  || null,
        courier_phone: delivery?.courier_phone || null,
        vehicle_type:  delivery?.vehicle_type  || null,
        vehicle_plate: delivery?.vehicle_plate || null,

        items: items || [],
      },
    });
  } catch (err) {
    console.error('❌ getOrderAndDeliveryDetails error:', err);
    res.status(500).json({ success: false, message: 'Server error fetching order details' });
  }
};