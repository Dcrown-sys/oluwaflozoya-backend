// routes/auth.js
const express = require('express');
const router = express.Router();
const admin = require('../utils/firebase-admin');
const jwt = require('jsonwebtoken');
const { sql } = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret';

// POST /auth/firebase-login
router.post('/firebase-login', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.error('❌ Missing or invalid Authorization header');
      return res.status(400).json({ error: 'Missing or invalid Authorization header' });
    }

    const idToken = authHeader.split(' ')[1];
    const decodedToken = await admin.auth().verifyIdToken(idToken);

    const firebase_uid = decodedToken.uid;
    const email = decodedToken.email || null;

    const {
      phone,
      fullName,
      role,
      address,
      deliveryAddress,
      latitude,
      longitude,
    } = req.body;

    if (!firebase_uid) {
      console.error('❌ firebase_uid is undefined');
      return res.status(400).json({ error: 'Missing firebase_uid from token' });
    }

    // Check if user exists
    const existingUsers = await sql`
      SELECT * FROM users WHERE firebase_uid = ${firebase_uid}
    `;

    let user;
    if (existingUsers.length > 0) {
      user = existingUsers[0];
      console.log('👤 Existing user found:', user);
    } else {
      // Create new user
      const [newUser] = await sql`
        INSERT INTO users (
          firebase_uid,
          email,
          phone,
          role,
          full_name,
          address,
          delivery_address,
          latitude,
          longitude
        )
        VALUES (
          ${firebase_uid},
          ${email},
          ${phone},
          ${role},
          ${fullName},
          ${address},
          ${deliveryAddress},
          ${latitude},
          ${longitude}
        )
        RETURNING *
      `;
    
      user = newUser;
      console.log('✅ New user created:', user);
    }

    // ✅ Ensure courier exists if role is courier
    if (user.role === 'courier') {
      const [courier] = await sql`
        SELECT * FROM couriers WHERE user_id = ${user.id}
      `;
      if (courier) {
        console.log("✅ Courier already exists:", courier);
      } else {
        const [newCourier] = await sql`
          INSERT INTO couriers (user_id, status, created_at)
          VALUES (${user.id}, 'available', NOW())
          RETURNING *
        `;
        console.log("✅ New courier created:", newCourier);
      }
    }

    // Generate backend JWT token
    const token = jwt.sign(
      {
        id: user.id,
        firebase_uid: user.firebase_uid,
        role: user.role,
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.status(200).json({
      success: true,
      message: existingUsers.length > 0 ? 'User already exists' : 'User created successfully',
      user,
      token,
    });
  } catch (error) {
    console.error('❌ Firebase login error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal Server Error',
      details: error.message || error,
    });
  }
});

module.exports = router;
