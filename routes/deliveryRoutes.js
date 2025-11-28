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

router.get('/payment/callback', deliveryController.flutterwavePaymentCallback);

// 📌 Verify delivery payment manually (Frontend)
router.get('/delivery/verify/:orderId', deliveryController.verifyDeliveryPayment);

// 📦 Get order + delivery details
router.get('/order/:order_id/details', deliveryController.getOrderAndDeliveryDetails);

// 🚚 Finalize delivery manually (admin-triggered only, optional)
router.post('/finalize', verifyToken, deliveryController.finalizeDeliveryAfterPaymentAuto);

module.exports = router;
