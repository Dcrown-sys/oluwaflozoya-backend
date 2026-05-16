require('dotenv').config();

const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const { sql } = require('./db');
const engineerRoutes = require("./routes/engineerRoutes");
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
const multer = require('multer');
const { analyzeConstruction } = require('./src/ai/geminiVision');
const constructionRoutes = require('./routes/Constructionroutes');
const aiCreditsRoutes = require('./routes/aiCreditsRoutes');


const projectRoutes = require('./routes/projectRoutes');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { 
    origin: [
      'https://oluwaflozoya-backend.onrender.com',  // Your backend
      '*',  // Allow all for mobile apps (or specify your app domain)
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true 
  },
});

// ======== PASS SOCKET.IO TO CONTROLLERS ========
adminKYCApprovalController.setSocket(io);
adminController.initSocketIO(io);
require('./controllers/quoteMessagesController').setSocket(io); // ✅ NEW

// ======== MIDDLEWARE ========
app.use(cors({
  origin: [
    "http://localhost:5173",
    "https://zoyasupply.com",
    "https://www.zoyasupply.com",
    true
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'multipart/form-data']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.raw({ type: 'application/json', limit: '10mb' }));

// Request logger
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});

// ======== ROUTES ========
app.use('/api/payment', paymentsRoutes); // Webhook first

app.use("/api/geocode", geocodeRoutes);
app.use('/api/courier', courierKYCRoutes);
app.use('/api/admin', adminKYCApprovalRoutes);
app.use('/api/auth', authRoutes);
app.use("/api/engineer", engineerRoutes);
app.use('/admin', adminRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/admin', require('./routes/adminOrdersRoutes'));
app.use("/api/couriers", courierRoutes);
app.use("/api/delivery", deliveryRoutes);
app.use("/api/courier-switch", courierSwitchRoutes);
app.use('/api/order', orderRoutes);
app.use('/api/categories', require('./routes/categoryRouter'));
app.use('/api', require('./routes/projectRoutes'));
app.use('/api/construction', constructionRoutes);
app.use('/api/ai/credits', require('./routes/aiCreditsRoutes'));

// ── v2 quote system (specific routes first) ──
app.use('/api/v2/quotes/requests/:requestId/messages', require('./routes/quoteMessagesRoutes'));
app.use('/api/v2/quotes/requests',                     require('./routes/quoteRequestsRoutes'));
app.use('/api/v2/quotes/suggestions',                  require('./routes/quoteSuggestionsRoutes'));

app.post('/api/ai/vision', 
  multer({ 
    dest: 'uploads/',
    limits: { fileSize: 20 * 1024 * 1024 }
  }).single('image'),
  analyzeConstruction
);

// List available AI models
app.get('/list-models', async (req, res) => {
  try {
    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
    const models = await genAI.listModels();
    const availableModels = models.models()
      .filter(model => model.supportedGenerationMethods().includes('generateContent'))
      .map(model => ({
        name: model.name(),
        displayName: model.displayName(),
        description: model.description()
      }));
    res.json({ success: true, availableModels, totalModels: availableModels.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ======== SOCKET.IO ========
io.on('connection', (socket) => {
  console.log('🚗 Client connected:', socket.id);

  // ── Courier location updates ──
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

  // ── Notifications ──
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

  // ── User room (for personal notifications) ──
  socket.on('joinUserRoom', (user_id) => {
    socket.join(`user_${user_id}`);
    console.log(`📌 User ${user_id} joined their room`);
  });

  // ── Quote chat rooms ──✅ NEW
  socket.on('joinQuoteRoom', (requestId) => {
    socket.join(`quote_${requestId}`);
    console.log(`💬 Socket ${socket.id} joined quote_${requestId}`);
  });

  socket.on('leaveQuoteRoom', (requestId) => {
    socket.leave(`quote_${requestId}`);
    console.log(`💬 Socket ${socket.id} left quote_${requestId}`);
  });
  socket.on('join_order_room', ({ orderId }) => {
    socket.join(`order_${orderId}`);
    console.log(`📦 Socket ${socket.id} joined order_${orderId}`);
  });

  socket.on('disconnect', () => {
    console.log('❌ Client disconnected:', socket.id);
  });
});

// ======== PAGES ========
app.get('/', (req, res) => res.send('🚀 Oluwaflo backend is running!'));

app.get('/payment-success', (req, res) => {
  res.send(`
    <html>
      <head><title>Payment Successful</title>
        <style>body{font-family:system-ui,sans-serif;text-align:center;padding-top:50px;background:#f9f9f9;}h1{color:#4CAF50;}</style>
      </head>
      <body>
        <h1>🎉 Payment Successful!</h1>
        <p>Thank you — you can close this tab.</p>
        <script>setTimeout(() => window.location.href="oluwoflomobile://payment-success",1500);</script>
      </body>
    </html>
  `);
});

// ======== AI INIT ========
const axios = require('axios');
const { exec } = require('child_process');

let AI_READY = false;

async function checkOllama() {
  try {
    await axios.get('http://localhost:11434/api/tags', { timeout: 5000 });
    console.log('✅ Ollama ready');
    return true;
  } catch (e) {
    console.log('⚠️ Ollama warming up...');
    return false;
  }
}

// ── Error handler (must be last middleware) ──
const { errorHandler } = require('./middleware/errorHandler');
app.use(errorHandler);

// ======== START SERVER ========
const PORT = process.env.PORT || 5000;

server.listen(PORT, '0.0.0.0', async () => {
  try {
    const result = await sql`SELECT NOW()`;
    console.log(`✅ Database connected:`, result);
  } catch (error) {
    console.error('❌ Database connection failed:', error);
  }

  console.log('🚀 Server ready - AI loads on first request');
  console.log(`🚀 Server with Socket.IO listening on port ${PORT}`);
  console.log(`✅ Health: http://localhost:${PORT}/health`);
  console.log(`✅ Vision Health: http://localhost:${PORT}/api/ai/vision/health`);
});