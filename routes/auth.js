const express = require('express');
const router = express.Router();
const admin = require('../utils/firebase-admin');
const jwt = require('jsonwebtoken');
const { sql } = require('../db');
const bcrypt = require('bcrypt'); // Add if missing: npm i bcrypt

const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret';

// 🔥 LOG ALL REQUESTS
router.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} /api/auth${req.path}`);
  next();
});

// 🔥 FIXED /firebase-login WITH TIMEOUT
router.post('/firebase-login', async (req, res) => {
  const startTime = Date.now();
  console.log('🚀 /firebase-login START - Time:', new Date().toISOString());
  
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log('❌ Missing Authorization header');
      return res.status(400).json({ error: 'Missing or invalid Authorization header' });
    }

    const idToken = authHeader.split(' ')[1];
    console.log('🔍 Token length:', idToken.length);

    // 🔥 PRODUCTION FIX: 8s TIMEOUT
    const decodedToken = await Promise.race([
      admin.auth().verifyIdToken(idToken),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Firebase timeout')), 8000)
      )
    ]);

    console.log('✅ Firebase verified in', Date.now() - startTime, 'ms');

    const firebase_uid = decodedToken.uid;
    const email = decodedToken.email || null;

    const {
      phone = null,
      fullName = null,
      role = 'buyer',
      address = null,
      deliveryAddress = null,
      latitude = null,
      longitude = null,
    } = req.body;

    if (!firebase_uid) {
      console.error('❌ firebase_uid missing');
      return res.status(400).json({ error: 'Missing firebase_uid from token' });
    }

    // Check if user exists
    const existingUsers = await sql`
      SELECT * FROM users WHERE firebase_uid = ${firebase_uid}
    `;

    let user;
    if (existingUsers.length > 0) {
      user = existingUsers[0];
      console.log('👤 Existing user:', user.id);
    } else {
      // Create new user
      const [newUser] = await sql`
        INSERT INTO users (
          firebase_uid, email, phone, role, full_name,
          address, delivery_address, latitude, longitude
        )
        VALUES (
          ${firebase_uid}, ${email}, ${phone}, ${role}, ${fullName},
          ${address}, ${deliveryAddress}, ${latitude}, ${longitude}
        )
        RETURNING *
      `;
      user = newUser;
      console.log('✅ New user created:', user.id);
    }

    // Courier logic (unchanged)
    if (user.role === 'courier') {
      const [courier] = await sql`SELECT * FROM couriers WHERE user_id = ${user.id}`;
      if (!courier) {
        const [newCourier] = await sql`
          INSERT INTO couriers (user_id, status, created_at)
          VALUES (${user.id}, 'available', NOW()) RETURNING *
        `;
        console.log('✅ Courier created:', newCourier.id);
      }
    }

    // Generate JWT
    const token = jwt.sign(
      { id: user.id, firebase_uid: user.firebase_uid, role: user.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    console.log('🎉 Login success in', Date.now() - startTime, 'ms');
    
    res.status(200).json({
      success: true,
      message: existingUsers.length > 0 ? 'Login successful' : 'Account created',
      user,
      token,
    });

  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`❌ /firebase-login FAILED after ${duration}ms:`, error.message);
    
    if (error.message === 'Firebase timeout') {
      return res.status(408).json({ error: 'Server busy, try again' });
    }
    
    res.status(500).json({
      success: false,
      error: 'Login failed',
      details: error.message,
    });
  }
});

// POST /auth/login-with-apple (unchanged)
router.post('/login-with-apple', async (req, res) => {
  // Your existing code - perfect
});

// POST /auth/login (email/password) - FIXED
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    const users = await sql`
      SELECT id, email, full_name, phone, password_hash, role 
      FROM users WHERE email = ${email}
    `;
    
    const user = users[0];
    if (!user || !await bcrypt.compare(password, user.password_hash)) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      user: {
        id: user.id, email: user.email, full_name: user.full_name,
        phone: user.phone, role: user.role
      },
      token,
    });
  } catch (error) {
    console.error('❌ Email login error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// POST /auth/refresh
router.post('/refresh', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    
    const users = await sql`
      SELECT id, email, full_name, phone, role 
      FROM users WHERE id = ${decoded.id}
    `;
    
    const user = users[0];
    if (!user) return res.status(401).json({ error: 'User not found' });

    const newToken = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({ success: true, user, token: newToken });
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

module.exports = router;