const express = require('express');
const router = express.Router();
const { finalizeDeliveryAfterPayment } = require('../controllers/deliveryController');
const { verifyToken } = require('../middleware/auth');

router.post('/finalize', verifyToken, finalizeDeliveryAfterPayment);

module.exports = router;
