// routes/paymentRoutes.js - BULLETPROOF VERSION
const express = require('express');
const router = express.Router();
const { sql } = require('../db');
const { v4: uuidv4 } = require('uuid');
const { finalizeDeliveryAfterPaymentAuto } = require('../controllers/deliveryController');

const FLW_WEBHOOK_SECRET = process.env.FLW_WEBHOOK_SECRET?.trim();

const { payOrderDelivery, confirmPayment } = require('../controllers/paymentsController');
const { verifyBuyer } = require('../middleware/auth');

router.post('/order/:orderId', verifyBuyer, payOrderDelivery);
router.post('/confirm-payment', confirmPayment);

router.post(
  '/flutterwave-webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    try {
      console.log('🌀 Flutterwave webhook received');

      const signature = (req.headers['verif-hash'] || req.headers['verif_hash'] || '').trim();
      const payload = req.body.toString();

      if (!signature) {
        console.warn('❌ No signature provided');
        return res.status(401).send('No signature');
      }

      if (!FLW_WEBHOOK_SECRET) {
        console.error('❌ FLW_WEBHOOK_SECRET is missing');
        return res.status(500).send('Server configuration error');
      }

      if (signature !== FLW_WEBHOOK_SECRET) {
        console.warn('❌ Invalid signature', { received: signature });
        return res.status(401).send('Invalid signature');
      }

      console.log('✅ Webhook signature verified');

      let body;
      try {
        body = JSON.parse(payload);
      } catch (err) {
        console.error('❌ Invalid JSON payload', err);
        return res.status(400).send('Invalid JSON');
      }

      const { event, data } = body;
      if (!data) {
        console.warn('⚠️ Missing data in payload');
        return res.status(400).send('Missing data');
      }

      console.log('💡 Parsed payload:', JSON.stringify(body));

      const txRef = data.tx_ref || null;
      const flwRef = data.id || null;
      const flutterStatus = (data.status || '').toLowerCase();

      console.log('🔑 Identifiers:', { txRef, flwRef, flutterStatus });

      if (!txRef) {
        console.warn('⚠️ No tx_ref in payload, cannot process');
        return res.status(200).send('Ignored - no tx_ref');
      }

      // Only look up by tx_ref
      const [payment] = await sql`
        SELECT * FROM payments
        WHERE tx_ref = ${txRef}
        LIMIT 1;
      `;

      if (!payment) {
        console.warn('⚠️ Payment not found for tx_ref:', txRef);
        return res.status(200).send('Ignored - payment not found');
      }

      // Idempotency check
      if (['completed', 'cancelled'].includes(payment.status)) {
        console.log(`ℹ️ Payment already finalized: ${payment.id}`);
        return res.status(200).send('Already processed');
      }

      // Determine new status
      let newPaymentStatus = 'pending';
      if (
        ['charge.completed', 'payment.completed'].includes(event) &&
        ['successful', 'success', 'completed'].includes(flutterStatus)
      ) {
        newPaymentStatus = 'completed';
      }
      if (['failed', 'cancelled'].includes(flutterStatus)) {
        newPaymentStatus = 'cancelled';
      }

      console.log('💠 Mapped newPaymentStatus:', newPaymentStatus);

      // Always store flw_ref from data.id
      await sql`
        UPDATE payments
        SET 
          status = ${newPaymentStatus},
          flw_ref = ${String(flwRef)},
          amount = ${data.amount || payment.amount},
          currency = ${data.currency || payment.currency},
          updated_at = NOW()
        WHERE id = ${payment.id};
      `;

      console.log('✅ Payment record updated');

      // -----------------------------------------------
      // DELIVERY PAYMENT
      // -----------------------------------------------
      if (payment.payment_type === 'delivery' && newPaymentStatus === 'completed') {
        const orderId = payment.order_id;

        if (!orderId) {
          console.error('❌ No order_id on delivery payment record:', payment.id);
          return res.status(200).send('OK - but missing order_id');
        }

        const updatedDelivery = await sql`
          UPDATE deliveries
          SET status = 'en_route', updated_at = NOW()
          WHERE order_id = ${orderId}
            AND status NOT IN ('en_route', 'delivered', 'cancelled')
          RETURNING id;
        `;

        if (updatedDelivery.length === 0) {
          console.warn(`⚠️ No eligible delivery found for order ${orderId}`);
        } else {
          console.log('🚚 Delivery updated to en_route:', updatedDelivery);
        }

        try {
          await finalizeDeliveryAfterPaymentAuto(orderId);
          console.log('🤝 Courier auto-assigned');
        } catch (err) {
          console.error('❌ Courier auto-assignment failed:', err);
        }

        await sql`
          UPDATE orders
          SET status = 'en_route', updated_at = NOW()
          WHERE id = ${orderId};
        `;
        console.log(`📦 Order ${orderId} marked en_route`);
      }

      // -----------------------------------------------
      // ORDER PAYMENT — create order after payment confirmed
      // -----------------------------------------------
      if (payment.payment_type === 'order' && newPaymentStatus === 'completed') {
        console.log('🛒 Order payment completed, creating order...');

        // Parse items saved during payment initiation
        let items = [];
        try {
          items = typeof payment.items === 'string' ? JSON.parse(payment.items) : (payment.items || []);
        } catch (e) {
          console.error('❌ Failed to parse payment items:', e);
          return res.status(200).send('OK - but failed to parse items');
        }

        if (!items.length) {
          console.error('❌ No items found on payment record:', payment.id);
          return res.status(200).send('OK - but no items to create order');
        }

        // Recalculate totals from saved items
        let subtotal = 0;
        const uniqueProducts = new Set();
        const productCache = {};

        for (const item of items) {
          const [product] = await sql`
            SELECT id, price, vendor_id FROM products WHERE id = ${item.product_id}
          `;
          if (!product) {
            console.error('❌ Product not found during order creation:', item.product_id);
            continue;
          }
          subtotal += Number(product.price) * Number(item.quantity);
          uniqueProducts.add(item.product_id);
          productCache[item.product_id] = product;
        }

        const vat = Math.round(subtotal * 0.075);
        const appFee = Math.round(uniqueProducts.size * 1000);
        const totalAmount = Math.round(subtotal + vat + appFee);

        // Create the order
        const orderId = uuidv4();
        await sql`
          INSERT INTO orders (
            id,
            user_id,
            status,
            total_amount,
            delivery_address,
            phone_number,
            name,
            email,
            payment_reference,
            created_at,
            updated_at
          )
          VALUES (
            ${orderId},
            ${payment.user_id},
            'paid',
            ${totalAmount},
            ${payment.delivery_address},
            ${payment.phone},
            ${payment.name},
            ${payment.email},
            ${payment.tx_ref},
            NOW(),
            NOW()
          )
        `;
        console.log('📦 Order created:', orderId);

        // Create order items
        for (const item of items) {
          const product = productCache[item.product_id];
          if (!product) continue;

          await sql`
            INSERT INTO order_items (
              id,
              order_id,
              product_id,
              quantity,
              unit_price,
              vendor_id,
              created_at
            )
            VALUES (
              ${uuidv4()},
              ${orderId},
              ${item.product_id},
              ${item.quantity},
              ${product.price},
              ${product.vendor_id},
              NOW()
            )
          `;
        }
        console.log('🧾 Order items created');

        // Link payment to the new order
        await sql`
          UPDATE payments
          SET order_id = ${orderId}, updated_at = NOW()
          WHERE id = ${payment.id}
        `;
        console.log('🔗 Payment linked to order:', orderId);

        // Create delivery record (ready for delivery payment later)
        const deliveryFee = 1500; // adjust to your pricing logic
        await sql`
          UPDATE orders
          SET delivery_fee = ${deliveryFee}, updated_at = NOW()
          WHERE id = ${orderId}
        `;

        await sql`
          INSERT INTO deliveries (
            id,
            order_id,
            status,
            delivery_address,
            created_at,
            updated_at
          )
          VALUES (
            ${uuidv4()},
            ${orderId},
            'pending',
            ${payment.delivery_address},
            NOW(),
            NOW()
          )
        `;
        console.log('🚚 Delivery record created for order:', orderId);
      }

      console.log(`✅ Webhook fully processed for payment ${payment.id}`);
      return res.status(200).send('OK');

    } catch (err) {
      console.error('💥 Webhook processing error:', err);
      return res.status(500).send('Server error');
    }
  }
);

module.exports = router;