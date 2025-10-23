const express = require('express');
const router = express.Router();
const adminOrdersController = require('../controllers/adminOrdersController');
const { verifyAdmin } = require('../middleware/auth'); // optional

// Admin endpoints
router.get('/orders', verifyAdmin, adminOrdersController.getAllOrders);
router.patch('/orders/:orderId/received', verifyAdmin, adminOrdersController.markOrderAsReceived);
router.post('/orders/:orderId/assign-courier', verifyAdmin, adminOrdersController.assignCourier);

module.exports = router;
