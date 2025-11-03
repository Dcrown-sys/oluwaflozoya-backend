// routes/deliveryRouter.js
const express = require('express');
const router = express.Router();
const deliveryController = require('../controllers/deliveryController');
const { verifyToken } = require('../middleware/auth');

// 🧾 Create a new pending delivery (admin action)
router.post('/create', verifyToken, deliveryController.createPendingDelivery);

// 📦 Get pending delivery by order_id (buyer/admin)
router.get('/pending/:order_id', verifyToken, deliveryController.getPendingDeliveryByOrder);

// 💳 Initiate Flutterwave payment for delivery fee
router.get('/pending/:order_id/pay', verifyToken, deliveryController.initiateDeliveryPayment);

// ✅ Callback route that Flutterwave redirects to after payment
// This does NOT require verifyToken, because Flutterwave servers will call it
router.get('/payment/callback', deliveryController.flutterwavePaymentCallback);

// 🚚 Finalize delivery manually (admin-triggered only, optional)
router.post('/finalize', verifyToken, deliveryController.finalizeDeliveryAfterPayment);

module.exports = router;
