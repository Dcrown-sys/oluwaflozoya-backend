// routes/ordersRouter.js
const express = require('express');
const router = express.Router();
const { assignCourier } = require('../controllers/orderController'); // ✅ destructure, not require the whole object

const { verifyAdmin } = require('../middleware/auth'); // if you have auth

router.post('/:orderId/assign', verifyAdmin, assignCourier); // ✅ this MUST be a function

module.exports = router;
