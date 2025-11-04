// server.js — cleaned and simplified
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const { sql } = require('./db');
const path = require('path');

// Controllers & routes
const adminController = require('./controllers/adminController');
const adminKYCApprovalController = require('./controllers/adminKYCApprovalController');
const geocodeRoutes = require('./routes/geocodeRoutes');
const courierKYCRoutes = require('./routes/courierKYC');
const adminKYCApprovalRoutes = require('./routes/adminKYCApproval');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const paymentsRoutes = require('./routes/paymentsRoutes'); // contains /flutterwave-webhook etc.
const courierRoutes = require('./routes/courierRoutes');
const deliveryRoutes = require('./routes/deliveryRoutes');
const courierSwitchRoutes = require('./routes/courierSwitchRoutes');
const orderRoutes = require('./routes/orderRoutes');
const adminOrdersRoutes = require('./routes/adminOrdersRoutes');

const app = express();
const server = http.createServer(app);

// Socket.IO
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

// Pass Socket.IO instance to controllers that need it
if (adminKYCApprovalController && typeof adminKYCApprovalController.setSocket === 'function') {
  adminKYCApprovalController.setSocket(io);
}
if (adminController && typeof adminController.initSocketIO === 'function') {
  adminController.initSocketIO(io);
}

// ======== MIDDLEWARE ========
//
// IMPORTANT: apply express.raw for the webhook route BEFORE express.json()
// so the webhook route gets the raw body (required by Flutterwave signature verification).
//
app.use('/api/flutterwave-webhook', express.raw({ type: 'application/json' }));

// Standard middleware
app.use(cors());
app.use(express.json()); // other routes get normal JSON body parsing

// Static uploads
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ======== ROUTES ========
// Keep API routes under /api for consistency
app.use('/api/geocode', geocodeRoutes);
app.use('/api/courier', courierKYCRoutes);
app.use('/api/admin', adminKYCApprovalRoutes); // admin KYC endpoints
app.use('/api/auth', authRoutes);

// Admin API (existing admin controller routes)
app.use('/api/admin', adminRoutes); // NOTE: adminRoutes exports many admin endpoints

// Payments & webhook (mounted at /api so webhook becomes /api/flutterwave-webhook)
app.use('/api', paymentsRoutes);

// Admin orders (separate file)
app.use('/api/admin', adminOrdersRoutes);

// Couriers & delivery
app.use('/api/couriers', courierRoutes);
app.use('/api/delivery', deliveryRoutes);
app.use('/api/courier-switch', courierSwitchRoutes);

// Orders
app.use('/api/order', orderRoutes);

// Optional: if you still want to expose an "admin UI" under /admin (non-API), uncomment below.
// app.use('/admin', adminRoutes);

// ======== SOCKET.IO REAL-TIME ========
io.on('connection', (socket) => {
  console.log('🚗 Client connected:', socket.id);

  socket.on('locationUpdate', async (data) => {
    try {
      const { courier_id, latitude, longitude } = data;
      if (!courier_id || !latitude || !longitude) return;

      await sql`
        INSERT INTO courier_location (courier_id, latitude, longitude, updated_at)
        VALUES (${courier_id}, ${latitude}, ${longitude}, NOW())
        ON CONFLICT (courier_id)
        DO UPDATE SET latitude = ${latitude}, longitude = ${longitude}, updated_at = NOW()
      `;

      io.emit('courierLocation', data);
    } catch (err) {
      console.error('❌ Error saving location:', err);
    }
  });

  socket.on('sendNotification', async (data) => {
    try {
      const { user_id, message, type } = data;
      if (!user_id || !message) return;

      await sql`
        INSERT INTO notifications (user_id, message, type, created_at, is_read)
        VALUES (${user_id}, ${message}, ${type || 'info'}, NOW(), false)
      `;

      io.to(`user_${user_id}`).emit('notification', { message, type });
    } catch (err) {
      console.error('❌ Error saving notification:', err);
    }
  });

  socket.on('joinUserRoom', (user_id) => {
    socket.join(`user_${user_id}`);
    console.log(`📌 User ${user_id} joined their room`);
  });

  socket.on('disconnect', () => {
    console.log('❌ Client disconnected:', socket.id);
  });
});

// ======== HEALTH CHECK ========
app.get('/', (req, res) => res.send('🚀 Oluwaflo backend is running!'));

// ======== REQUEST LOGGER (after routes to show route handling) ========
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});

// ======== START SERVER ========
const PORT = process.env.PORT || 3000;

server.listen(PORT, '0.0.0.0', async () => {
  try {
    const result = await sql`SELECT NOW()`;
    console.log('✅ Database connected:', result);
  } catch (error) {
    console.error('❌ Database connection failed:', error);
  }
  console.log(`🚀 Server with Socket.IO listening on port ${PORT}`);
});
