// routes/admin.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const storage = multer.memoryStorage();
const upload = multer({ storage });
const { verifyFirebaseToken } = require('../middleware/firebaseAuth');


const adminController = require('../controllers/adminController');
const { getAds, createAd, deleteAd } = require("../controllers/adminController");



const {
  verifyAdmin,
  verifyToken,
  verifyCourier,
} = require('../middleware/auth');


const {
  updateAccountInfo,
  changePassword,
  changePhoneNumber,
} = require('../controllers/adminController');



const { firebaseLogin } = require('../controllers/authController');

// ============================
// Firebase login
// ============================
router.post('/firebase-login', firebaseLogin);

// ============================
// Admin Auth
// ============================
router.post('/signup', adminController.signupAdmin);
router.post('/login', adminController.loginAdmin);

// ============================
// Dashboard & Analytics
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
router.get('/products/search', adminController.searchProducts);
router.get('/products/category/:categoryId', adminController.getProductsByCategory);
router.get('/products/featured', adminController.getFeaturedProducts);
router.get('/trending-products', adminController.getTrendingProducts);
router.get('/best-sellers', adminController.getBestSellers);
router.get('/trending', adminController.getTrending);

router.post('/add-product', verifyToken, upload.single('image'), adminController.addProduct);
router.put('/products/:id', adminController.updateProduct);
router.delete('/products/:id', adminController.deleteProduct);

router.post('/products/featured', verifyAdmin, adminController.setFeaturedProducts);
router.delete('/products/featured', verifyAdmin, adminController.removeFeaturedProducts);

// ============================
// Producer Management
// ============================
router.get('/producers', verifyAdmin, adminController.getAllProducers);
router.post('/producers', verifyAdmin, adminController.addProducer);
router.get('/producer/:producerId/products', adminController.getProductsByProducer);

// ============================
// Payments
// ============================
router.post('/initiatePayment', adminController.initiatePayment);
router.get('/verifyPayment', adminController.verifyPayment);
router.post('/webhook/flutterwave', adminController.flutterwaveWebhook);
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

// Courier submits KYC (Courier protected route)
router.post('/assign-courier/:orderId', adminController.assignCourierToOrder);



// Courier submits KYC (requires Firebase authentication)
router.post('/courier/kyc', verifyFirebaseToken, upload.fields([
  { name: 'selfie', maxCount: 1 },
  { name: 'document', maxCount: 1 },
]), adminController.submitCourierKYC);

// Admin verifies or rejects KYC (also requires Firebase authentication)
router.put('/courier/kyc/:courier_id/verify', verifyFirebaseToken, verifyAdmin, adminController.verifyCourierKYC);



// ============================
// Orders
// ============================
router.post('/orders', adminController.createOrder);
router.get('/orders/user/:user_id', adminController.getOrdersByUser);
router.get('/orders/:id', adminController.getOrderById);
// routes/admin.js
router.get('/buyer/orders/:orderId', adminController.getOrderByIdForUser);

router.get('/orders', adminController.getAllOrdersAdmin);
router.patch('/orders/:id/status', adminController.updateOrderStatus);
router.get('/ping', (req, res) => res.send('✅ Admin API is alive!'));

// ============================
// Promo
// ============================
router.post('/promo/validate', adminController.validatePromoCode);
router.post('/promo/redeem', adminController.redeemPromoCode);

// ============================
// Categories
// ============================
router.get('/categories', adminController.getCategories);
router.get('/buyer/category/:categoryId/producers', adminController.getProducersByCategory);

// ============================
// Notifications
// ============================
router.get('/notifications', adminController.getNotifications);
router.post('/notifications', adminController.createNotification);
router.patch('/notifications/:id/read', adminController.markNotificationAsRead);

// ============================
// Account updates
// ============================
router.patch('/user/account', updateAccountInfo);
router.patch('/user/password', changePassword);
router.patch('/change-phone', changePhoneNumber);

// ============================
// Couriers
// ============================
router.post('/courier/location', adminController.updateCourierLocation);
router.get('/tracking/couriers', verifyAdmin, adminController.getCourierTrackingStatus);
router.get('/couriers/available', verifyAdmin, adminController.availableCouriers);
router.get('/couriers/nearest/:orderId', verifyAdmin, adminController.nearestCourier);
router.get('/tracking/nearest-couriers', verifyAdmin, adminController.getNearestCouriers);

router.get('/courier/:courierId/dashboard', verifyCourier, adminController.getCourierDashboard);
router.post('/delivery/:delivery_id/pickup', verifyCourier, adminController.courierPickupOrder);
router.post('/delivery/:delivery_id/deliver', verifyCourier, adminController.courierDeliverOrder);
router.patch('/courier/deliveries/:deliveryId/status', adminController.updateDeliveryStatus);
router.post('/courier/:courierId/availability', verifyCourier, adminController.updateCourierAvailability);
router.get('/courier/:courierId/stats', verifyCourier, adminController.getCourierStats);
router.get('/courier/:courierId/ratings/summary', verifyCourier, adminController.getCourierRatingsSummary);
router.get('/courier/:courierId/referral-link', verifyCourier, adminController.getCourierReferralLink);

router.get('/courier/:courierId/tickets', verifyCourier, adminController.getCourierTickets);
router.post('/courier/:courierId/tickets', verifyCourier, adminController.createCourierTicket);

router.post('/assign-delivery', verifyAdmin, adminController.assignDelivery);
router.post('/assign-courier/:orderId', adminController.assignCourierToOrder);
router.get('/delivery-tracking/:delivery_id', adminController.getDeliveryTracking);
router.get('/courier/deliveries/history', verifyCourier, adminController.getCourierDeliveryHistory);

router.post('/courier/order/:id/rate', verifyCourier, adminController.courierRateOrder);
router.post('/ratings/courier', verifyToken, adminController.rateCourier);

// ============================
// Ads
// ============================
router.get('/ads', getAds);
router.post('/ads', createAd);
router.delete('/ads/:id', deleteAd);

module.exports = router;
