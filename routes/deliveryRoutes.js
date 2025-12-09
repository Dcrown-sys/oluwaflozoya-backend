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
router.get("/payment-success", (req, res) => {
    const { tx_ref, status, transaction_id } = req.query;
  
    return res.send(`
      <html>
        <body style="font-family: Arial; text-align: center; padding: 40px;">
          <h2>Payment Successful 🎉</h2>
          <p>You can close this page now.</p>
          <script>
            window.location.href = "myapp://payment-success?tx_ref=${tx_ref}&status=${status}&transaction_id=${transaction_id}";
          </script>
        </body>
      </html>
    `);
  });
  
  // 🔹 Delivery payment cancelled
  router.get("/payment-cancelled", (req, res) => {
    return res.send(`
      <html>
        <body style="font-family: Arial; text-align: center; padding: 40px;">
          <h2>Payment Cancelled ❌</h2>
          <p>You can close this page.</p>
          <script>
            window.location.href = "myapp://payment-cancelled";
          </script>
        </body>
      </html>
    `);
  });
  

// 📦 Get full order + delivery + courier + items details
router.get('/order/:order_id/details', verifyToken, deliveryController.getOrderAndDeliveryDetails);

module.exports = router;
