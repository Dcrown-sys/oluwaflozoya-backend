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
const geocodeRoutes = require("./routes/geocodeRoutes");
const courierKYCRoutes = require('./routes/courierKYC');
const adminKYCApprovalRoutes = require('./routes/adminKYCApproval');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const paymentsRoutes = require('./routes/paymentsRoutes'); // Contains the active webhook
const courierRoutes = require("./routes/courierRoutes");
const deliveryRoutes = require("./routes/deliveryRoutes");
const courierSwitchRoutes = require('./routes/courierSwitchRoutes');
const orderRoutes = require('./routes/orderRoutes');
// const flutterwaveWebhook = require('./routes/webhook'); // Removed - duplicate/unused

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

// Pass Socket.IO instance to controllers
adminKYCApprovalController.setSocket(io);
adminController.initSocketIO(io);

// ======== MIDDLEWARE ========

// Mount paymentsRoutes (with webhook) BEFORE express.json() to allow raw body capture
app.use('/api/payment', paymentsRoutes);

// Removed: app.use('/api/flutterwave', flutterwaveWebhook); // Unused/duplicate

// Standard middleware (applied after raw-body routes)
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Other routes
app.use("/api/geocode", geocodeRoutes);
app.use('/api/courier', courierKYCRoutes);
app.use('/api/admin', adminKYCApprovalRoutes);
app.use('/api/auth', authRoutes);
app.use('/admin', adminRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/admin', require('./routes/adminOrdersRoutes'));
app.use("/api/couriers", courierRoutes);
app.use("/api/delivery", deliveryRoutes);
app.use("/api/courier-switch", courierSwitchRoutes);
app.use('/api/order', orderRoutes);

// ======== SOCKET.IO REAL-TIME ========
io.on('connection', (socket) => {
  console.log('🚗 Client connected:', socket.id);

  // Courier location updates
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

  // Send notifications
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

  // Join room
  socket.on('joinUserRoom', (user_id) => {
    socket.join(`user_${user_id}`);
    console.log(`📌 User ${user_id} joined their room`);
  });

  socket.on('disconnect', () => {
    console.log('❌ Client disconnected:', socket.id);
  });
});

// Removed: Commented-out webhook code in app.js (lines ~100-150) - consolidate to paymentsRoutes

// Webhook test route (if needed, but webhook is in paymentsRoutes)
// app.use('/api/payment', paymentsRoutes); // Already mounted above

// Health check
app.get('/', (req, res) => res.send('🚀 Oluwaflo backend is running!'));

// Request logger
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});

// ======== FLUTTERWAVE REDIRECT PAGE ========
app.get('/payment-success', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>Payment Successful</title>
        <style>
          body { 
            font-family: system-ui, sans-serif; 
            text-align: center; 
            padding-top: 50px; 
            background-color: #f9f9f9;
          }
          h1 { color: #4CAF50; }
        </style>
      </head>
      <body>
        <h1>🎉 Payment Successful!</h1>
        <p>Thank you — you can close this tab.</p>
        <script>
          // Optional: redirect to your app via deep link
          setTimeout(() => {
            window.location.href = "oluwoflomobile://payment-success";
          }, 1500);
        </script>
      </body>
    </html>
  `);
});

// ======== START SERVER ========
const PORT = process.env.PORT || 3000;

server.listen(PORT, '0.0.0.0', async () => {
  try {
    const result = await sql`SELECT NOW()`;
    console.log(`✅ Database connected:`, result);
  } catch (error) {
    console.error('❌ Database connection failed:', error);
  }
  console.log(`🚀 Server with Socket.IO listening on port ${PORT}`);
});