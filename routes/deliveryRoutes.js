const express = require('express');
const router = express.Router();
const deliveryController = require('../controllers/deliveryController');
const { verifyToken } = require('../middleware/auth');

/**
 * 1️⃣ Create a new pending delivery (Admin)
 * POST /api/delivery
 */
router.post('/', verifyToken, deliveryController.createPendingDelivery);

/**
 * 2️⃣ Get pending delivery by order_id
 * GET /api/delivery/:order_id/pending
 */
router.get('/:order_id/pending', verifyToken, deliveryController.getOrderAndDeliveryDetails); 
// You can optionally have a separate getPendingDeliveryByOrder if you want only 'pending' delivery

/**
 * 3️⃣ Initiate Flutterwave payment for delivery fee
 * POST /api/delivery/:order_id/pay
 */
router.post('/:order_id/pay', verifyToken, deliveryController.initiateDeliveryPayment);

/**
 * 4️⃣ Flutterwave callback (public, no token)
 * GET /api/delivery/payment/callback?transaction_id=...
 */
router.get('/payment/callback', deliveryController.flutterwavePaymentCallback);

/**
 * 5️⃣ Verify delivery payment manually (Frontend)
 * GET /api/delivery/:order_id/verify?transaction_id=...
 */
router.get('/:order_id/verify', verifyToken, deliveryController.verifyDeliveryPayment);

/**
 * 6️⃣ Get order + delivery details
 * GET /api/delivery/:order_id/details
 */
router.get('/:order_id/details', verifyToken, deliveryController.getOrderAndDeliveryDetails);

/**
 * 7️⃣ (Optional) Finalize delivery manually (Admin)
 * POST /api/delivery/finalize
 */
router.post('/finalize', verifyToken, deliveryController.finalizeDeliveryAfterPaymentAuto);

module.exports = router;
