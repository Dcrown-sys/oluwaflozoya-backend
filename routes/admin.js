const express = require('express');
const router = express.Router();
const multer = require('multer');
const storage = multer.memoryStorage();
const upload = multer({ storage });

const adminController = require('../controllers/adminController');
const { getAds, createAd, deleteAd } = require("../controllers/adminController");

const {
  verifyAdmin,
  verifyToken,
  verifyCourier, // <- Make sure this is imported
} = require('../middleware/auth');

const {
  updateAccountInfo,
  changePassword,
  changePhoneNumber,
} = require('../controllers/adminController');

// ============================
// Admin Auth
// ============================
router.post('/signup', adminController.signupAdmin);
router.post('/login', adminController.loginAdmin);

// ============================
// Dashboard + Analytics
// ============================
router.get('/dashboard', verifyAdmin, (req, res) => {
  res.status(200).json({ message: 'Welcome Admin', admin: req.admin });
});
router.get('/overview', adminController.getAdminAnalyticsOverview);
router.get('/analytics/overview', verifyAdmin, adminController.getAdminAnalyticsOverview);
router.get('/analytics/sales-graph', verifyAdmin, adminController.getSalesGraph);

// ============================
// Product Management
// ============================
router.get('/products', adminController.getAllProducts);
router.post('/add-product', verifyToken, upload.single('image'), adminController.addProduct);
router.put('/products/:id', adminController.updateProduct);
router.delete('/products/:id', adminController.deleteProduct);

// ============================
// Producer Management
// ============================
router.get('/producers', verifyAdmin, adminController.getAllProducers);
router.post('/producers', verifyAdmin, adminController.addProducer);
router.get('/producer/:producerId/products', adminController.getProductsByProducer);
router.post('/initiatePayment', adminController.initiatePayment);
router.get('/verifyPayment', adminController.verifyPayment);
router.post('/webhook/flutterwave', adminController.flutterwaveWebhook);

// ============================
// Orders
// ============================
router.post('/orders', adminController.createOrder);
router.get('/orders/:user_id', adminController.getOrdersByUser);
router.patch('/orders/:id/status', adminController.updateOrderStatus);
router.get('/orders', adminController.getAllOrdersAdmin);
router.post('/promo/validate', adminController.validatePromoCode);
router.post('/promo/redeem', adminController.redeemPromoCode);
router.get('/categories', adminController.getCategories);
router.get('/products/category/:categoryId', adminController.getProductsByCategory);
router.get('/buyer/category/:categoryId/producers', adminController.getProducersByCategory);
router.post('/buyer/create-payment-link', adminController.createPaymentLink);

router.get('/payment-success', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>Payment Success</title>
        <style>body { font-family: sans-serif; text-align: center; padding-top: 50px; }</style>
      </head>
      <body>
        <h1>🎉 Payment Successful!</h1>
        <p>Redirecting to app...</p>
        <script>setTimeout(() => { window.location.href = "https://zoyaapp://payment-success"; }, 1500);</script>
      </body>
    </html>
  `);
});

// ============================
// Notifications
// ============================
router.get('/notifications', adminController.getNotifications);
router.post('/notifications', adminController.createNotification);
router.patch('/notifications/:id/read', adminController.markNotificationAsRead);
router.patch('/user/account', updateAccountInfo);
router.patch('/user/password', changePassword);
router.patch('/change-phone', changePhoneNumber);

// ============================
// Couriers
// ============================
router.post('/courier/location', adminController.updateCourierLocation);
router.get('/tracking/couriers', verifyAdmin, adminController.getCourierTrackingStatus);
router.post('/user/fcm-token', verifyToken, adminController.saveFcmToken);
router.get('/couriers/available', verifyAdmin, adminController.availableCouriers);
router.get('/couriers/nearest/:orderId', verifyAdmin, adminController.nearestCourier);
router.get('/tracking/nearest-couriers', verifyAdmin, adminController.getNearestCouriers);

// ============================
// Courier Assignments & Actions
// ============================

// Assign courier (legacy)
router.post("/assign-courier/:orderId", adminController.assignCourierToOrder);

// Assign delivery (new)
router.post('/assign-delivery', verifyAdmin, adminController.assignDelivery);
router.get('/delivery-tracking/:delivery_id', adminController.getDeliveryTracking);

// Courier dashboard
router.get('/courier/:courierId/dashboard', verifyCourier, adminController.getCourierDashboard);

// Pickup order
router.post('/delivery/:delivery_id/pickup', verifyCourier, adminController.courierPickupOrder);
router.patch(
  "/courier/deliveries/:deliveryId/status",
  adminController.updateDeliveryStatus
);

// Featured products routes
router.get("/products/featured", adminController.getFeaturedProducts); // no auth if buyer
router.post("/products/featured", verifyAdmin, adminController.setFeaturedProducts);
router.delete("/products/featured", verifyAdmin, adminController.removeFeaturedProducts);

// 🔥 Trending / Best Sellers
router.get("/best-sellers", adminController.getBestSellers);
router.get("/trending", adminController.getTrending);

// ✅ Trending Products route
router.get("/trending-products", adminController.getTrendingProducts);

// 🔍 Product search
router.get("/products/search", adminController.searchProducts);



// Deliver order
router.post('/delivery/:delivery_id/deliver', verifyCourier, adminController.courierDeliverOrder);

// Rate order
router.post('/courier/order/:id/rate', verifyCourier, adminController.courierRateOrder);

// Update availability
router.post('/courier/:courierId/availability', verifyCourier, adminController.updateCourierAvailability);

// Stats & Ratings
router.get('/courier/:courierId/stats', verifyCourier, adminController.getCourierStats);
router.get('/courier/:courierId/ratings/summary', verifyCourier, adminController.getCourierRatingsSummary);
router.get('/courier/:courierId/referral-link', verifyCourier, adminController.getCourierReferralLink);

// Delivery history
router.get('/courier/deliveries/history', verifyCourier, adminController.getCourierDeliveryHistory);


// Tickets
router.get('/courier/:courierId/tickets', verifyCourier, adminController.getCourierTickets);
router.post('/courier/:courierId/tickets', verifyCourier, adminController.createCourierTicket);


// Ads routes
router.get("/ads", getAds);
router.post("/ads", createAd);
router.delete("/ads/:id", deleteAd);


module.exports = router;
