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
const paymentsRoutes = require('./routes/paymentsRoutes');
const courierRoutes = require("./routes/courierRoutes");
const deliveryRoutes = require("./routes/deliveryRoutes");
const courierSwitchRoutes = require('./routes/courierSwitchRoutes');
const orderRoutes = require('./routes/orderRoutes');


const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

// Pass Socket.IO instance to controllers
adminKYCApprovalController.setSocket(io);
adminController.initSocketIO(io);

// ======== MIDDLEWARE ========

// Raw body ONLY for Flutterwave webhook
app.use('/api/admin/flutterwave-webhook', express.raw({ type: 'application/json' }));

// Standard middleware
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use("/api/geocode", geocodeRoutes);
app.use('/api/courier', courierKYCRoutes);
app.use('/api/admin', adminKYCApprovalRoutes);
app.use('/api/auth', authRoutes);
app.use('/admin', adminRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/payments', paymentsRoutes);
app.use('/api/admin', require('./routes/adminOrdersRoutes'));
app.use("/api/couriers", courierRoutes);
app.use("/api/delivery", deliveryRoutes);
app.use("/api/courier-switch", courierSwitchRoutes)
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

// ======== FLUTTERWAVE WEBHOOK ========
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

    const { event, data } = payload;
    if (!event || !data || !data.tx_ref) return res.status(400).send('Invalid payload');

    const txRef = data.tx_ref;
    const fwStatus = (data.status || '').toLowerCase();

    // Map Flutterwave status to DB status
    let paymentStatus = 'pending';
    if (['successful', 'completed'].includes(fwStatus)) paymentStatus = 'completed';
    else if (['failed', 'cancelled'].includes(fwStatus)) paymentStatus = 'cancelled';
    else if (fwStatus === 'pending') paymentStatus = 'pending';

    // Update payment
    const updatedPayments = await sql`
      UPDATE payments
      SET status = ${paymentStatus}, amount = ${data.amount}, currency = ${data.currency}, updated_at = NOW()
      WHERE tx_ref = ${txRef}
      RETURNING id, user_id, payment_reference, payment_type

    `;

    if (!updatedPayments.length) {
      console.warn(`⚠️ Payment with tx_ref ${txRef} not found`);
      return res.status(404).send('Payment not found');
    }

    const { user_id: userId, payment_reference: paymentReference, payment_type: paymentType } = updatedPayments[0];


    // Update corresponding order status
    let orderStatus = 'pending';
    if (paymentType === 'order') {
      if (paymentStatus === 'completed') orderStatus = 'paid';
      else if (paymentStatus === 'cancelled') orderStatus = 'cancelled';
    } else if (paymentType === 'delivery') {
      if (paymentStatus === 'completed') orderStatus = 'delivery_paid';
      else if (paymentStatus === 'cancelled') orderStatus = 'cancelled';
    }

    if (paymentReference) {
      await sql`
        UPDATE orders
        SET status = ${orderStatus}, updated_at = NOW()
        WHERE payment_reference = ${paymentReference}
      `;
    }

    // Send notification
    if (userId && io) {
      let message = '';
      if (paymentType === 'order') {
        if (paymentStatus === 'completed') message = `🎉 Your order payment (ref: ${txRef}) was successful!`;
        else if (paymentStatus === 'cancelled') message = `⚠️ Your order payment (ref: ${txRef}) was cancelled.`;
        else message = `ℹ️ Your order payment (ref: ${txRef}) is ${paymentStatus}.`;
      } else if (paymentType === 'delivery') {
        if (paymentStatus === 'completed') message = `🚚 Delivery fee (ref: ${txRef}) was paid successfully!`;
        else if (paymentStatus === 'cancelled') message = `⚠️ Delivery payment (ref: ${txRef}) was cancelled.`;
        else message = `ℹ️ Your delivery payment (ref: ${txRef}) is ${paymentStatus}.`;
      }

      await sql`
        INSERT INTO notifications (user_id, title, body, read, created_at)
        VALUES (${userId}, 'Payment Update', ${message}, false, NOW())
      `;

      io.to(`user_${userId}`).emit('paymentUpdate', { tx_ref: txRef, status: paymentStatus, message });
      console.log(`🔔 Payment notification sent for user ${userId}: ${message}`);
    }

    res.status(200).send('Webhook processed successfully');
  } catch (err) {
    console.error('❌ Flutterwave webhook processing error:', err);
    res.status(500).send('Server error processing webhook');
  }
});

// Webhook test route
app.use('/api/webhook', require('./routes/webhook'));

// Health check
app.get('/', (req, res) => res.send('🚀 Oluwaflo backend is running!'));

// Request logger
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
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
