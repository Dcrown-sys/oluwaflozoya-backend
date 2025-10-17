// controllers/authController.js
const { sql } = require('../db');
const jwt = require('jsonwebtoken');
const admin = require("../config/firebase"); // Firebase Admin SDK
const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret';

exports.firebaseLogin = async (req, res) => {
  const firebaseToken = req.headers.authorization?.split(' ')[1];
  const profileData = req.body || {};

  console.log('🔹 Incoming firebase-login request');
  console.log('🔹 Profile data:', profileData);

  if (!firebaseToken) {
    console.warn('⚠️ No Firebase token provided');
    return res.status(401).json({ success: false, error: 'No Firebase token provided' });
  }

  try {
    // 1️⃣ Verify Firebase token
    const decoded = await admin.auth().verifyIdToken(firebaseToken);
    console.log('✅ Firebase token decoded:', decoded);

    const email = decoded.email;
    if (!email) {
      console.warn('⚠️ Firebase token has no email');
      return res.status(400).json({ success: false, error: 'Firebase token missing email' });
    }

    // 2️⃣ Look up user in DB
    const result = await sql`SELECT * FROM users WHERE email = ${email} LIMIT 1`;
    console.log('🔹 DB query result:', result);

    if (!result || result.length === 0) {
      console.warn(`⚠️ User not found in DB for email: ${email}`);
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const user = result[0];

    // 3️⃣ Generate backend JWT
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    console.log('✅ JWT generated for user:', user.id);

    // 4️⃣ Return response exactly frontend expects
    const responseUser = {
      id: user.id,
      full_name: user.name || user.full_name || 'User',
      email: user.email,
      role: user.role,
      ...profileData // merge extra profileData safely
    };

    console.log('🔹 Sending response user object:', responseUser);

    return res.json({
      success: true,
      user: responseUser,
      token
    });

  } catch (err) {
    console.error('❌ Firebase login error:', err);

    // Provide more informative error to help frontend debug
    const message = err.code ? `${err.code}: ${err.message}` : err.message;
    return res.status(401).json({ success: false, error: `Invalid Firebase token - ${message}` });
  }
};
