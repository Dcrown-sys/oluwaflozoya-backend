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

/**
 * STEP 1.5: Get pending delivery for an order
 */
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

/**
 * STEP 2: Initiate delivery payment via Flutterwave
 */
exports.initiateDeliveryPayment = async (req, res) => {
  try {

    /* ======================================================
       🔍 TEMP DEBUG: CONFIRM WHICH DB THIS REQUEST USES
    ====================================================== */
    const [env] = await sql`
      SELECT
        current_database()  AS database,
        inet_server_addr()  AS server_ip,
        inet_server_port()  AS port,
        current_user        AS db_user,
        current_setting('server_version') AS pg_version,
        current_setting('TimeZone') AS timezone;
    `;
    console.log('🧩 BACKEND DB ENV:', env);

    /* ======================================================
       0️⃣ Validate input
    ====================================================== */
    const { order_id } = req.params;

    if (!order_id) {
      return res.status(400).json({ success: false, message: 'order_id is required' });
    }

    /* ======================================================
       1️⃣ Fetch pending delivery
    ====================================================== */
    const [delivery] = await sql`
      SELECT
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

    /* ======================================================
       2️⃣ Generate references
    ====================================================== */
    const paymentReference = `DELIVERY-${order_id}-${Date.now()}`;
    const txRef = `delivery-${order_id}-${crypto.randomUUID()}`;

    /* ======================================================
       3️⃣ Create or update payment row (NO ON CONFLICT)
    ====================================================== */
    let [payment] = await sql`
      SELECT *
      FROM payments
      WHERE order_id = ${order_id}
        AND payment_type = 'delivery_fee'
      LIMIT 1;
    `;

    if (!payment) {
      [payment] = await sql`
        INSERT INTO payments (
          order_id,
          user_id,
          amount,
          currency,
          status,
          payment_type,
          payment_method,
          tx_ref,
          payment_reference,
          created_at,
          updated_at
        )
        VALUES (
          ${order_id},
          ${delivery.user_id},
          ${amount},
          'NGN',
          'pending',
          'delivery_fee',
          'flutterwave',
          ${txRef},
          ${paymentReference},
          NOW(),
          NOW()
        )
        RETURNING *;
      `;
      console.log(`✅ Created new payment row for order ${order_id}`);
    } else {
      [payment] = await sql`
        UPDATE payments
        SET
          tx_ref = ${txRef},
          payment_reference = ${paymentReference},
          amount = ${amount},
          updated_at = NOW()
        WHERE id = ${payment.id}
        RETURNING *;
      `;
      console.log(`ℹ️ Updated existing payment row for order ${order_id}`);
    }

    /* ======================================================
       4️⃣ Build Flutterwave payload
    ====================================================== */
    const payload = {
      tx_ref: payment.tx_ref,
      amount,
      currency: 'NGN',
      redirect_url: `${process.env.BASE_URL}/api/delivery/payment-success`,
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

    /* ======================================================
       5️⃣ Create Flutterwave checkout
    ====================================================== */
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

    /* ======================================================
       6️⃣ Respond to client
    ====================================================== */
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


/**
 * STEP 3: Auto-finalize delivery after successful payment
 */
exports.finalizeDeliveryAfterPaymentAuto = async (orderId) => {
  try {
    if (!orderId) return console.warn("⚠️ No order ID provided for auto-finalization");

    const [order] = await sql`SELECT id, user_id, courier_id, status FROM orders WHERE id = ${orderId} LIMIT 1;`;
    if (!order) return console.warn(`⚠️ Order ${orderId} not found`);

    let courierId = order.courier_id;

    if (!courierId) {
      const [courier] = await sql`SELECT id FROM couriers WHERE verification_status = 'approved' AND availability = 'Online' ORDER BY RANDOM() LIMIT 1;`;
      if (!courier) return console.warn(`⚠️ No available courier for order ${orderId}`);
      courierId = courier.id;
    }

    // Update order
    await sql`UPDATE orders SET courier_id = ${courierId}, status = 'en_route', updated_at = NOW() WHERE id = ${orderId};`;

    // Create delivery if not exists
    const existingDelivery = await sql`SELECT id FROM deliveries WHERE order_id = ${orderId} AND courier_id = ${courierId} LIMIT 1;`;
    if (existingDelivery.length === 0) {
      await sql`INSERT INTO deliveries (order_id, courier_id, status, created_at) VALUES (${orderId}, ${courierId}, 'en_route', NOW());`;
    } else {
      await sql`UPDATE deliveries SET status = 'en_route', updated_at = NOW() WHERE id = ${existingDelivery[0].id};`;
    }

    // Update courier status
    await sql`UPDATE couriers SET availability = 'Busy' WHERE id = ${courierId};`;

    console.log(`✅ [Auto-Finalize] Courier ${courierId} assigned for order ${orderId}`);
  } catch (err) {
    console.error("❌ finalizeDeliveryAfterPaymentAuto error:", err);
  }
};

/**
 * STEP 4: Flutterwave payment verification (callback or redirect)
 */
exports.flutterwavePaymentCallback = async (req, res) => {
  try {
    let tx_ref = req.query.tx_ref;
    if (!tx_ref) return res.status(400).send('Missing tx_ref');

    // Trim whitespace/newlines
    tx_ref = tx_ref.trim();

    const verifyRes = await axios.get(
      `https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${tx_ref}`,
      { headers: { Authorization: `Bearer ${process.env.FLW_SECRET_KEY}` } }
    );

    // ...rest of your code


    const verification = verifyRes.data?.data;
    if (!verification || verification.status !== 'successful') return res.status(400).send('Payment failed or invalid');

    const orderId = verification.meta?.order_id;
    if (!orderId) return res.status(400).send('Order ID missing in metadata');

    await sql`UPDATE payments SET status = 'completed', updated_at = NOW() WHERE tx_ref = ${tx_ref};`;
    await sql`UPDATE orders SET status = 'delivery_paid', updated_at = NOW() WHERE id = ${orderId};`;

    await exports.finalizeDeliveryAfterPaymentAuto(orderId);

    res.send("<h1>Payment successful and delivery finalized!</h1>");
  } catch (err) {
    console.error("❌ flutterwavePaymentCallback error:", err.response?.data || err.message);
    res.status(500).send("Internal server error during Flutterwave callback");
  }
};

/**
 * STEP 5: Get full order + delivery + courier + items details
 */
exports.getOrderAndDeliveryDetails = async (req, res) => {
  try {
    const { order_id } = req.params;

    const [order] = await sql`
      SELECT 
        o.id AS order_id, o.status AS order_status, o.total_amount, o.created_at, o.updated_at,
        d.id AS delivery_id, d.status AS delivery_status, d.delivery_fee, d.created_at AS delivery_created_at, d.updated_at AS delivery_updated_at,
        p.status AS payment_status, p.amount AS payment_amount,
        c.id AS courier_id, c.full_name AS courier_name, c.phone AS courier_phone, c.vehicle_type, c.vehicle_plate
      FROM orders o
      LEFT JOIN deliveries d ON d.order_id = o.id
      LEFT JOIN payments p ON p.order_id = o.id AND p.payment_type = 'delivery_fee'
      LEFT JOIN couriers c ON c.id = d.courier_id
      WHERE o.id = ${order_id}
      LIMIT 1;
    `;

    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    const items = await sql`
      SELECT oi.id AS order_item_id, oi.product_id, oi.product_name, oi.quantity, oi.unit_price, oi.total_price,
             p.description AS product_description, p.image_url AS product_image
      FROM order_items oi
      LEFT JOIN products p ON p.id = oi.product_id
      WHERE oi.order_id = ${order_id};
    `;

    res.json({ success: true, order: { ...order, items } });
  } catch (err) {
    console.error('❌ getOrderAndDeliveryDetails error:', err);
    res.status(500).json({ success: false, message: 'Server error fetching order details' });
  }
};
