// routes/ordersRouter.js
const express = require('express');
const router = express.Router();
const { assignCourier, getOrderDetails } = require('../controllers/orderController');
const { verifyAdmin } = require('../middleware/auth'); // optional

// Assign courier (admin)
router.post('/:orderId/assign', verifyAdmin, assignCourier);

// Get order details
router.get('/:order_id/details', getOrderDetails);

module.exports = router;
