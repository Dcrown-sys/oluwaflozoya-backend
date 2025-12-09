// routes/deliveryRoutes.js
const express = require('express');
const router = express.Router();
const deliveryController = require('../controllers/deliveryController');
const { verifyToken } = require('../middleware/auth');

// 🧾 Create a new pending delivery (admin action)
router.post('/create', verifyToken, deliveryController.createPendingDelivery);

// 📦 Get pending delivery by order_id (buyer/admin)
router.get('/pending/:order_id', verifyToken, deliveryController.getPendingDeliveryByOrder);

// 💳 Initiate Flutterwave payment for delivery fee
router.post('/:order_id/pay', verifyToken, deliveryController.initiateDeliveryPayment);

// 🔄 Flutterwave redirect after successful payment
router.get('/payment-success', deliveryController.flutterwavePaymentCallback);

// 📦 Get full order + delivery + courier + items details
router.get('/order/:order_id/details', verifyToken, deliveryController.getOrderAndDeliveryDetails);

module.exports = router;
