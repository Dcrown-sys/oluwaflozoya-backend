require('dotenv').config();

const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const { sql } = require('./db');
const adminController = require('./controllers/adminController');
const geocodeRoutes = require("./routes/geocode");
const courierKYCRoutes = require('./routes/courierKYC');
const adminKYCApprovalRoutes = require('./routes/adminKYCApproval');
const adminKYCApprovalController = require('./controllers/adminKYCApprovalController');



const app = express();
const path = require('path');
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*', // Update for production security
    methods: ['GET', 'POST'],
  },
});


// Pass the Socket.IO instance to the controller
adminKYCApprovalController.setSocket(io);

// ========== MIDDLEWARE ==========

// Raw body for Flutterwave webhook ONLY (kept scoped)
app.use('/api/admin/flutterwave-webhook', express.raw({ type: 'application/json' }));

// Standard middleware
app.use(cors());
app.use(express.json());
app.use("/api/geocode", geocodeRoutes);
app.use('/api/courier', courierKYCRoutes);
app.use('/api/admin', adminKYCApprovalRoutes);

// ========== SOCKET.IO REAL-TIME ==========
io.on('connection', (socket) => {
  console.log('🚗 Client connected:', socket.id);

  /**
   * Courier Location Updates
   * data: { courier_id, latitude, longitude }
   */
  socket.on('locationUpdate', async (data) => {
    try {
      const { courier_id, latitude, longitude } = data;
      if (!courier_id || !latitude || !longitude) return;

      console.log(`📍 Courier ${courier_id} location:`, latitude, longitude);

      // Save to courier_location table
      await sql`
        INSERT INTO courier_location (courier_id, latitude, longitude, updated_at)
        VALUES (${courier_id}, ${latitude}, ${longitude}, NOW())
        ON CONFLICT (courier_id) 
        DO UPDATE SET latitude = ${latitude}, longitude = ${longitude}, updated_at = NOW()
      `;

      // Broadcast updated location to all clients
      io.emit('courierLocation', data);
    } catch (err) {
      console.error('❌ Error saving location:', err);
    }
  });

  /**
   * Send Notification
   * data: { user_id, message, type }
   */
  socket.on('sendNotification', async (data) => {
    try {
      const { user_id, message, type } = data;
      if (!user_id || !message) return;

      console.log(`🔔 Notification to user ${user_id}: ${message}`);

      // Save to notifications table
      await sql`
        INSERT INTO notifications (user_id, message, type, created_at, is_read)
        VALUES (${user_id}, ${message}, ${type || 'info'}, NOW(), false)
      `;

      // Emit notification to specific user room
      io.to(`user_${user_id}`).emit('notification', { message, type });
    } catch (err) {
      console.error('❌ Error saving notification:', err);
    }
  });

  // Join room for direct notifications
  socket.on('joinUserRoom', (user_id) => {
    socket.join(`user_${user_id}`);
    console.log(`📌 User ${user_id} joined their room`);
  });

  socket.on('disconnect', () => {
    console.log('❌ Client disconnected:', socket.id);
  });
});

// ========== ROUTES ==========
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
adminController.initSocketIO(io);

app.use('/api/auth', authRoutes);
app.use('/admin', adminRoutes);
app.use('/api/admin', adminRoutes);





// ---------- Flutterwave webhook with improved logic ----------
app.post('/api/admin/flutterwave-webhook', async (req, res) => {
  const FLW_SECRET_HASH = process.env.FLW_SECRET_HASH || 'zoyaWebhookSecret123';
  const signature = req.headers['verif-hash'] || req.headers['verif_hash'];

  if (!signature || signature !== FLW_SECRET_HASH) {
    console.warn('⚠️ Invalid Flutterwave signature');
    return res.status(401).send('⚠️ Invalid Flutterwave signature');
  }

  try {
    // Raw body is buffer, parse JSON here
    const payload = JSON.parse(req.body.toString());

    console.log('✅ Flutterwave webhook received:', payload);

    // Only handle charge.completed event to update payment status
    if (payload.event === 'charge.completed') {
      const { tx_ref, status, amount, currency, customer } = payload.data;

      // Normalize status to lowercase
      const normalizedStatus = status.toLowerCase();

      // Update payments table
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

        // Emit payment update notification to user via Socket.IO
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

// Webhook test route
app.use('/api/webhook', require('./routes/webhook'));

// Health check route
app.get('/', (req, res) => res.send('🚀 Oluwaflo backend is running!'));

// Global request logger
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});

// ========== START SERVER ==========
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
