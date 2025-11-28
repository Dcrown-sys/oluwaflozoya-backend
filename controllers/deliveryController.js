// controllers/deliveryController.js
const { sql } = require('../db');
const { v4: uuidv4 } = require('uuid');
const flutterwave = require('../utils/flutterwave');
const axios = require('axios');


/**
 * STEP 1: Admin creates a pending delivery and triggers buyer payment
 */
exports.createPendingDelivery = async (req, res) => {
  try {
    const { courier_id, order_id, pickup_address, dropoff_address, delivery_fee } = req.body;
    const adminId = req.user?.id; // from JWT (admin)

    if (!courier_id || !order_id || !pickup_address || !dropoff_address || !delivery_fee) {
      return res.status(400).json({ success: false, message: "Missing required fields." });
    }

    const [order] = await sql`SELECT id, user_id, status FROM orders WHERE id = ${order_id};`;
    if (!order) return res.status(404).json({ success: false, message: "Order not found." });

    const existing = await sql`
      SELECT id FROM deliveries WHERE order_id = ${order_id} AND status = 'pending';
    `;
    if (existing.length > 0)
      return res.status(400).json({ success: false, message: "Delivery already pending for this order." });

    const tx_ref = `DELIVERY-${order_id}-${Date.now()}`;

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

    await sql`
      INSERT INTO payments (
        order_id, user_id, amount, status, payment_reference, tx_ref,
        payment_method, currency, payment_type, created_at
      )
      VALUES (
        ${order_id}, ${order.user_id}, ${delivery_fee}, 'pending', NULL, ${tx_ref},
        'flutterwave', 'NGN', 'delivery_fee', NOW()
      );
    `;

    return res.json({
      success: true,
      message: "Delivery request created. Buyer notified to pay the delivery fee.",
      data: { ...delivery, tx_ref },
    });
  } catch (err) {
    console.error("❌ Error creating pending delivery:", err);
    res.status(500).json({ success: false, message: "Failed to create pending delivery." });
  }
};

/**
 * STEP 1.5: Get pending delivery for an order
 */
exports.getPendingDeliveryByOrder = async (req, res) => {
  const { order_id } = req.params;
  try {
    const [delivery] = await sql`
      SELECT 
        d.*, p.tx_ref, p.amount AS payment_amount, p.status AS payment_status
      FROM deliveries d
      LEFT JOIN payments p
        ON p.order_id = d.order_id
        AND p.tx_ref LIKE ${`DELIVERY-${order_id}%`}
      WHERE d.order_id = ${order_id}
        AND d.status = 'pending'
      LIMIT 1;
    `;

    if (!delivery)
      return res.status(404).json({ success: false, message: 'No pending delivery found' });

    res.json({ success: true, delivery });
  } catch (err) {
    console.error('❌ Error fetching pending delivery:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * STEP 2: Buyer initiates payment for the pending delivery
 */
exports.initiateDeliveryPayment = async (req, res) => {
  try {
    const { order_id } = req.params;

    console.log("===== 🟢 initiateDeliveryPayment CALLED =====");
    console.log("➡️ Received order_id:", order_id);

    if (!order_id) {
      return res.status(400).json({ error: "order_id is required" });
    }

    // Fetch delivery info from deliveries table
    console.log("➡️ Fetching delivery info for order:", order_id);
    const [delivery] = await sql`
      SELECT d.delivery_fee, d.courier_id, d.status, o.user_id, o.name, o.email, o.phone_number
      FROM deliveries d
      JOIN orders o ON o.id = d.order_id
      WHERE d.order_id = ${order_id} AND d.status = 'pending'
      LIMIT 1;
    `;

    if (!delivery) {
      console.log("❌ No pending delivery found for this order");
      return res.status(404).json({ error: "No pending delivery found for this order" });
    }

    console.log("🟡 Delivery record fetched:", delivery);

    const amount = Number(delivery.delivery_fee);
    if (!amount || amount <= 0) {
      console.log("❌ Invalid delivery fee:", delivery.delivery_fee);
      return res.status(400).json({ error: "Delivery fee is missing or invalid" });
    }

    const tx_ref = `delivery-${Date.now()}-${uuidv4()}`;
    console.log("➡️ Generated tx_ref:", tx_ref);

    // Build Flutterwave payload for in-app modal
    const payload = {
      tx_ref,
      amount: Number(amount.toFixed(2)),
      currency: "NGN",
      redirect_url: "oluwoflomobile://payment-success",
      customer: {
        email: delivery.email || "zoyaprocurementcompany@gmail.com",
        name: delivery.name || "Customer",
        phonenumber: String(delivery.phone_number || "08000000000").replace(/\D/g, ""),
      },
      customizations: {
        title: "Zoya Delivery Payment",
        description: `Delivery fee for order ${order_id}`,
      },
      meta: { order_id },  // <--- important
    };
    
    console.log("🟢 Constructed Flutterwave Payload:", payload);

    // Send request to Flutterwave
    console.log("➡️ Sending payload to Flutterwave...");
    const fwRes = await axios.post(
      "https://api.flutterwave.com/v3/payments",
      payload,
      {
        headers: {
          Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    console.log("🟢 Flutterwave response:", fwRes.data);

    if (!fwRes.data || fwRes.data.status !== "success") {
      console.log("❌ Flutterwave rejected:", fwRes.data);
      return res.status(400).json({
        error: fwRes.data?.message || "Flutterwave error",
        details: fwRes.data,
      });
    }

    // Save payment record
    await sql`
      INSERT INTO payments (
        order_id, user_id, amount, status, tx_ref,
        payment_type, payment_method, currency, created_at
      )
      VALUES (
        ${order_id}, ${delivery.user_id}, ${amount}, 'pending',
        ${tx_ref}, 'delivery_fee', 'flutterwave', 'NGN', NOW()
      );
    `;

    console.log("✅ Payment record saved successfully");

    return res.json({
      success: true,
      message: "Delivery payment initialized",
      payment_link: fwRes.data.data.link, // this is the modal URL for the app
      tx_ref,
    });

  } catch (err) {
    console.error("❌ [initiateDeliveryPayment] ERROR:", err.response?.data || err.message);
    return res.status(500).json({ error: "Server error initializing delivery payment" });
  }
};


/**
 * STEP 3: Manual (admin) finalization after payment
 */
exports.finalizeDeliveryAfterPayment = async (req, res) => {
  const { order_id, courier_id } = req.body;
  if (!order_id || !courier_id)
    return res.status(400).json({ success: false, message: 'order_id and courier_id are required' });

  try {
    const [order] = await sql`
      SELECT id, status, user_id, delivery_address, pickup_address, delivery_fee
      FROM orders
      WHERE id = ${order_id};
    `;
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (order.status !== 'delivery_paid')
      return res.status(400).json({ success: false, message: 'Delivery fee not paid yet' });

    const [courier] = await sql`
      SELECT id, full_name, phone, vehicle_type, vehicle_plate, verification_status, availability
      FROM couriers
      WHERE id = ${courier_id};
    `;
    if (!courier) return res.status(404).json({ success: false, message: 'Courier not found' });
    if (courier.verification_status !== 'approved')
      return res.status(400).json({ success: false, message: 'Courier not approved' });
    if (courier.availability === 'Offline')
      return res.status(400).json({ success: false, message: 'Courier is currently offline' });

    const [delivery] = await sql`
      UPDATE deliveries
      SET status = 'assigned', updated_at = NOW()
      WHERE order_id = ${order_id} AND courier_id = ${courier_id}
      RETURNING *;
    `;

    await sql`
      UPDATE orders
      SET status = 'courier_assigned', courier_id = ${courier_id}, updated_at = NOW()
      WHERE id = ${order_id};
    `;
    await sql`UPDATE couriers SET availability = 'Busy' WHERE id = ${courier_id};`;

    res.json({
      success: true,
      message: 'Courier assigned successfully after delivery fee payment.',
      delivery,
      courier,
      order,
    });
  } catch (err) {
    console.error('❌ Error finalizing delivery after payment:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

exports.finalizeDeliveryAfterPaymentAuto = async (orderId) => {
    try {
      console.log(`🚀 [finalizeDeliveryAfterPaymentAuto] Starting for order ${orderId}`);
  
      if (!orderId) {
        console.warn('⚠️ No order ID provided to finalize delivery');
        return;
      }
  
      // 1️⃣ Get the order and confirm delivery_fee is paid
      const [order] = await sql`
        SELECT id, user_id, courier_id, status 
        FROM orders 
        WHERE id = ${orderId} 
        LIMIT 1;
      `;
  
      if (!order) {
        console.warn(`⚠️ Order ${orderId} not found`);
        return;
      }
  
      // 2️⃣ Find available courier if not assigned yet
      let courierId = order.courier_id;
      if (!courierId) {
        const [courier] = await sql`
          SELECT id 
          FROM couriers 
          WHERE status = 'available' 
          ORDER BY RANDOM() 
          LIMIT 1;
        `;
        if (courier) courierId = courier.id;
      }
  
      if (!courierId) {
        console.warn(`⚠️ No available courier found for order ${orderId}`);
        return;
      }
  
     // 3️⃣ Assign courier + update order
await sql`
UPDATE orders 
SET courier_id = ${courierId}, status = 'en_route', updated_at = NOW()
WHERE id = ${orderId};
`;

// 4️⃣ Create delivery record
await sql`
INSERT INTO deliveries (order_id, courier_id, status, created_at)
VALUES (${orderId}, ${courierId}, 'en_route', NOW());
`;

  
      console.log(`✅ [finalizeDeliveryAfterPaymentAuto] Courier ${courierId} auto-assigned for order ${orderId}`);
    } catch (err) {
      console.error('❌ finalizeDeliveryAfterPaymentAuto error:', err);
    }
  };


  /**
 * STEP 4: Flutterwave payment verification callback (auto finalize)
 */
  exports.flutterwavePaymentCallback = async (req, res) => {
    try {
      const { tx_ref } = req.query;
  
      if (!tx_ref) return res.status(400).send('Missing tx_ref');
  
      console.log(`🔄 Verifying Flutterwave payment for tx_ref: ${tx_ref}`);
  
      const verifyRes = await axios.get(
        `https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${tx_ref}`,
        {
          headers: { Authorization: `Bearer ${process.env.FLW_SECRET_KEY}` },
        }
      );
  
      const verification = verifyRes.data?.data;
      if (!verification) return res.status(400).send('Invalid verification');
  
      const { status, meta } = verification;
  
      if (status === 'successful' && meta?.order_id) {
        const orderId = meta.order_id;
  
        console.log(`✅ Payment verified for order ${orderId}, updating database...`);
  
        // Update payment
        await sql`
          UPDATE payments
          SET status = 'completed', updated_at = NOW()
          WHERE tx_ref = ${tx_ref};
        `;
  
        // Update order
        await sql`
          UPDATE orders
          SET status = 'delivery_paid', updated_at = NOW()
          WHERE id = ${orderId};
        `;
  
        // Call the auto-finalize function directly
        await exports.finalizeDeliveryAfterPaymentAuto(orderId);
  
        return res.status(200).send('Payment successful and delivery finalized!');
      }
  
      return res.status(400).send('Payment failed or invalid metadata');
    } catch (err) {
      console.error('❌ Flutterwave payment callback error:', err.response?.data || err.message);
      return res.status(500).send('Internal server error during Flutterwave callback');
    }
  };

 /**
 * STEP 5: Get full order + delivery + courier + items details
 */
exports.getOrderAndDeliveryDetails = async (req, res) => {
    const { order_id } = req.params;
  
    try {
      // 1️⃣ Fetch order + delivery + courier info
      const [order] = await sql`
        SELECT 
          o.id AS order_id,
          o.status AS order_status,
          o.total_amount,
          o.created_at,
          o.updated_at,
          d.id AS delivery_id,
          d.status AS delivery_status,
          d.delivery_fee,
          d.created_at AS delivery_created_at,
          d.updated_at AS delivery_updated_at,
          p.status AS payment_status,
          p.amount AS payment_amount,
          c.id AS courier_id,
          c.full_name AS courier_name,
          c.phone AS courier_phone,
          c.vehicle_type,
          c.vehicle_plate
        FROM orders o
        LEFT JOIN deliveries d ON d.order_id = o.id
        LEFT JOIN payments p ON p.order_id = o.id AND p.payment_type = 'delivery_fee'
        LEFT JOIN couriers c ON c.id = d.courier_id
        WHERE o.id = ${order_id}
        LIMIT 1;
      `;
  
      if (!order) {
        return res.status(404).json({ success: false, message: 'Order not found' });
      }
  
      // 2️⃣ Fetch order items with product info
      const items = await sql`
        SELECT 
          oi.id AS order_item_id,
          oi.product_id,
          oi.product_name,
          oi.quantity,
          oi.unit_price,
          oi.total_price,
          p.description AS product_description,
          p.image_url AS product_image
        FROM order_items oi
        LEFT JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = ${order_id};
      `;
  
      // 3️⃣ Respond with order + delivery + courier + items
      res.json({
        success: true,
        order: {
          ...order,
          items,
        },
      });
    } catch (err) {
      console.error('❌ Error fetching order + delivery + items:', err);
      res.status(500).json({ success: false, message: 'Server error fetching order details' });
    }
  };

  // controllers/deliveryController.js
exports.verifyDeliveryPayment = async (req, res) => {
  const { orderId } = req.params;
  const { tx_ref } = req.query;

  if (!orderId || !tx_ref) {
    return res.status(400).json({ success: false, message: 'Missing orderId or tx_ref' });
  }

  try {
    // Verify transaction with Flutterwave
    const fwRes = await axios.get(`https://api.flutterwave.com/v3/transactions/${tx_ref}/verify`, {
      headers: { Authorization: `Bearer ${process.env.FLW_SECRET_KEY}` },
    });

    const data = fwRes.data?.data;
    if (!data || data.status !== 'successful') {
      return res.status(400).json({ success: false, message: 'Payment not successful' });
    }

    // Mark payment as completed
    await sql`
      UPDATE payments
      SET status = 'completed', updated_at = NOW()
      WHERE tx_ref = ${tx_ref};
    `;

    // Update order as delivery_paid
    await sql`
      UPDATE orders
      SET status = 'delivery_paid', updated_at = NOW()
      WHERE id = ${orderId};
    `;

    // Auto finalize delivery
    await exports.finalizeDeliveryAfterPaymentAuto(orderId);

    return res.json({ success: true, message: 'Payment verified and delivery finalized' });
  } catch (err) {
    console.error('❌ verifyDeliveryPayment error:', err.response?.data || err.message);
    return res.status(500).json({ success: false, message: 'Verification failed' });
  }
};

  