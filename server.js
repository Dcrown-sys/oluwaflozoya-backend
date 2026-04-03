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
const aiController = require('./src/ai/controller');
const projectRoutes = require('./routes/projectRoutes');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { 
    origin: '*', 
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true 
  },
});

// Pass Socket.IO instance to controllers
adminKYCApprovalController.setSocket(io);
adminController.initSocketIO(io);

// ======== MIDDLEWARE - FIXED CORS & LIMITS ========
app.use(cors({
  origin: true,  // ✅ MOBILE FIX: Allow all origins
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'multipart/form-data']
}));

// ✅ Large file/image support for vision AI
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.raw({ type: 'application/json', limit: '50mb' }));

// ✅ Static files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/ai-uploads', express.static('src/ai/uploads'));

// Request logger
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});

// ======== HEALTH CHECKS - RENDER FIX ========
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    aiReady: AI_READY || false,
    uptime: process.uptime()
  });
});

app.get('/api/ai/vision/health', (req, res) => {
  res.json({ 
    status: 'vision-ready', 
    aiReady: AI_READY || false,
    endpoint: '/api/ai/vision'
  });
});

// ======== ROUTES ========
app.use('/api/payment', paymentsRoutes); // Webhook first

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
app.use('/api/categories', require('./routes/categoryRouter'));
app.use('/api', require('./routes/projectRoutes'));

// AI Routes
app.use('/api/ai/basic', aiController.basicAI);
app.use('/api/ai/stream', require('./src/ai/controller').streamAI);
app.use('/api/ai/think', require('./src/ai/controller').thinkingAI);
app.use('/api/ai/json', require('./src/ai/controller').structuredAI);

// ✅ FIXED VISION ROUTE
app.post('/api/ai/vision', 
  require('./src/ai/controller').upload.single('image'), 
  async (req, res, next) => {
    try {
      const result = await require('./src/ai/controller').visionAI(req, res, next);
      if (!res.headersSent) {
        res.json(result);
      }
    } catch (error) {
      console.error('❌ Vision AI error:', error);
      if (!res.headersSent) {
        res.status(500).json({ 
          error: 'Vision processing failed', 
          message: error.message 
        });
      }
    }
  }
);

// Debug route (keep if needed)
app.get('/debug/ollama', async (req, res) => {
  try {
    const models = await getModels();
    res.json({
      ready: AI_READY,
      models: models.map(m => ({
        name: m.name,
        size: m.size
      }))
    });
  } catch (err) {
    res.json({
      ready: false,
      error: err.message
    });
  }
});

// ======== SOCKET.IO ========
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

// ======== AI INIT (KEEP AS IS) ========
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

function pullModel() {
  return new Promise((resolve, reject) => {
    console.log('⬇️ Pulling gemma3:latest...');
    exec('ollama pull gemma3:latest', (err, stdout, stderr) => {
      if (err) {
        console.error('❌ Pull failed:', stderr);
        return reject(err);
      }
      console.log(stdout);
      resolve();
    });
  });
}

async function getModels() {
  const res = await axios.get('http://127.0.0.1:11434/api/tags');
  return res.data.models || [];
}

async function ensureModel() {
  const models = await getModels();
  console.log('📦 Models found:', models.map(m => m.name));
  const exists = models.some(m => m.name.includes('gemma3'));
  if (!exists) {
    console.log('⬇️ gemma3 not found, pulling...');
    await pullModel();
  } else {
    console.log('✅ gemma3 already installed');
  }
}

async function initAI() {
  try {
    await waitForOllama();
    await ensureModel();
    AI_READY = true;
    console.log('🔥 AI is fully ready');
  } catch (err) {
    console.error('❌ AI init failed:', err.message);
  }
}

// ======== START SERVER ========
const PORT = process.env.PORT || 10000;

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