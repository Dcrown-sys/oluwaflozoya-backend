const express = require('express');
const router = express.Router();
const {
  createPendingDelivery,
  initiateDeliveryPayment,
  getPendingDeliveryByOrder,
  finalizeDeliveryAfterPayment
} = require('../controllers/deliveryController');
const { verifyToken } = require('../middleware/auth');

// Create new delivery
router.post('/create', verifyToken, createPendingDelivery);

// Get pending delivery
router.get('/pending/:order_id', verifyToken, getPendingDeliveryByOrder);

// Initiate Flutterwave payment
router.get('/pending/:order_id/pay', verifyToken, initiateDeliveryPayment); // ✅ FIXED

// Finalize delivery after payment
router.post('/finalize', verifyToken, finalizeDeliveryAfterPayment);

module.exports = router;
