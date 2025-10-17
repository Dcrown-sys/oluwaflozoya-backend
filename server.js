require('dotenv').config();

const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const { sql } = require('./db');
const adminController = require('./controllers/adminController');
const geocodeRoutes = require('./routes/geocode');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*', // ⚠️ Allow all for now — restrict in production
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  },
});

// ========================
// 🧩 MIDDLEWARE
// ========================

// Global request logger (place this early)
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});

// Handle raw body for Flutterwave webhook ONLY
app.use(
  '/api/admin/flutterwave-webhook',
  express.raw({ type: 'application/json' })
);

// Normal JSON parser and CORS
app.use(cors());
app.use(express.json());

// ========================
// 🧭 ROUTES
// ========================
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
adminController.initSocketIO(io);

// Standardized route prefixes
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/geocode', geocodeRoutes);

// Webhook routes
app.use('/api/webhook', require('./routes/webhook'));

// ========================
// ⚡ SOCKET.IO EVENTS
// ========================
io.on('connection', (socket) => {
  console.log('🚗 Client connected:', socket.id);

  // --- Courier Location Update ---
  socket.on('locationUpdate', async (data) => {
    try {
      const { courier_id, latitude, longitude } = data;
      if (!courier_id || !latitude || !longitude) return;

      console.log(`📍 Courier ${courier_id} location:`, latitude, longitude);

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

  // --- Notifications ---
  socket.on('sendNotification', async (data) => {
    try {
      const { user_id, message, type } = data;
      if (!user_id || !message) return;

      console.log(`🔔 Notification to user ${user_id}: ${message}`);

      await sql`
        INSERT INTO notifications (user_id, message, type, created_at, is_read)
        VALUES (${user_id}, ${message}, ${type || 'info'}, NOW(), false)
      `;

      io.to(`user_${user_id}`).emit('notification', { message, type });
    } catch (err) {
      console.error('❌ Error saving notification:', err);
    }
  });

  // --- Room Join ---
  socket.on('joinUserRoom', (user_id) => {
    socket.join(`user_${user_id}`);
    console.log(`📌 User ${user_id} joined their room`);
  });

  socket.on('disconnect', () => {
    console.log('❌ Client disconnected:', socket.id);
  });
});

// ========================
// 💳 FLUTTERWAVE WEBHOOK
// ========================
app.post('/api/admin/flutterwave-webhook', async (req, res) => {
  const FLW_SECRET_HASH = process.env.FLW_SECRET_HASH || 'zoyaWebhookSecret123';
  const signature = req.headers['verif-hash'] || req.headers['verif_hash'];

  if (!signature || signature !== FLW_SECRET_HASH) {
    console.warn('⚠️ Invalid Flutterwave signature');
    return res.status(401).send('⚠️ Invalid Flutterwave signature');
  }

  try {
    const payload = JSON.parse(req.body.toString());
    console.log('✅ Flutterwave webhook received:', payload);

    if (payload.event === 'charge.completed') {
      const { tx_ref, status, amount, currency } = payload.data;
      const normalizedStatus = status.toLowerCase();

      const result = await sql`
        UPDATE payments
        SET status = ${normalizedStatus}, amount = ${amount}, currency = ${currency}, updated_at = NOW()
        WHERE tx_ref = ${tx_ref}
        RETURNING user_id
      `;

      if (result.length === 0) {
        console.warn(`⚠️ Payment with tx_ref ${tx_ref} not found`);
      } else {
        const user_id = result[0].user_id;
        io.to(`user_${user_id}`).emit('paymentUpdate', {
          tx_ref,
          status: normalizedStatus,
          amount,
          currency,
          message:
            normalizedStatus === 'successful'
              ? 'Payment successful. Your order is confirmed.'
              : normalizedStatus === 'cancelled'
              ? 'Payment was cancelled.'
              : `Payment status updated: ${normalizedStatus}`,
        });

        console.log(`✅ Payment updated & notification sent for tx_ref: ${tx_ref}`);
      }
    }

    res.status(200).send('Webhook processed successfully');
  } catch (error) {
    console.error('❌ Flutterwave webhook processing error:', error);
    res.status(500).send('Server error processing webhook');
  }
});

// ========================
// 🚀 HEALTH CHECK
// ========================
app.get('/', (req, res) => res.send('🚀 Oluwaflo backend is running!'));

// ========================
// 🏁 START SERVER
// ========================
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
