const express = require('express');
const router = express.Router();
const {createPendingDelivery, getPendingDeliveryByOrder, finalizeDeliveryAfterPayment } = require('../controllers/deliveryController');
const { verifyToken } = require('../middleware/auth');

router.post('/finalize', verifyToken, finalizeDeliveryAfterPayment);

router.get('/pending/:order_id', verifyToken, getPendingDeliveryByOrder);


router.post('/create', verifyToken, createPendingDelivery);

module.exports = router;
