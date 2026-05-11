// routes/auth.js
const express = require("express");
const router = express.Router();
const admin = require("../utils/firebase-admin");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { sql } = require("../db");

const JWT_SECRET = process.env.JWT_SECRET || "your_jwt_secret";

// POST /auth/firebase-login
router.post("/firebase-login", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      console.error("❌ Missing or invalid Authorization header");
      return res
        .status(400)
        .json({ error: "Missing or invalid Authorization header" });
    }

    const idToken = authHeader.split(" ")[1];
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
      console.error("❌ firebase_uid is undefined");
      return res.status(400).json({ error: "Missing firebase_uid from token" });
    }

    // Check if user exists
    const existingUsers = await sql`
      SELECT * FROM users WHERE firebase_uid = ${firebase_uid}
    `;

    let user;
    if (existingUsers.length > 0) {
      user = existingUsers[0];
      console.log("👤 Existing user found:", user);
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
      console.log("✅ New user created:", user);
    }

    // ✅ Ensure courier exists if role is courier
    if (user.role === "courier") {
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
      { expiresIn: "7d" },
    );

    return res.status(200).json({
      success: true,
      message:
        existingUsers.length > 0
          ? "User already exists"
          : "User created successfully",
      user,
      token,
    });
  } catch (error) {
    console.error("❌ Firebase login error:", error);
    res.status(500).json({
      success: false,
      error: "Internal Server Error",
      details: error.message || error,
    });
  }
});

// POST /auth/login-with-apple
router.post("/login-with-apple", async (req, res) => {
  try {
    const { firebaseUid, email } = req.body;

    if (!firebaseUid || !email) {
      return res
        .status(400)
        .json({ error: "Firebase UID and email are required" });
    }

    // Check if user exists by Firebase UID or email
    const existingUsers = await sql`
      SELECT * FROM users WHERE firebase_uid = ${firebaseUid} OR email = ${email}
    `;

    if (existingUsers.length === 0) {
      // User doesn't exist, return error to prompt signup
      return res
        .status(404)
        .json({ error: "User not found. Please sign up first." });
    }

    const user = existingUsers[0];
    console.log("👤 Existing user found:", user);

    // Generate backend JWT token
    const token = jwt.sign(
      {
        id: user.id,
        firebase_uid: user.firebase_uid,
        role: user.role,
      },
      JWT_SECRET,
      { expiresIn: "7d" },
    );

    return res.status(200).json({
      success: true,
      user,
      token,
    });
  } catch (error) {
    console.error("❌ Apple login error:", error);
    res.status(500).json({
      success: false,
      error: "Internal Server Error",
      details: error.message || error,
    });
  }
});

// 🔥 EMAIL/PASSWORD FALLBACK (add this)
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    console.log("🔐 Email login:", email);

    const users = await sql`
SELECT id, email, full_name, phone, password, role, username, username_confirmed, engineer_onboarding_required
FROM users 
WHERE email = ${email} 
LIMIT 1
    `;

    const user = users[0];
    if (!user)
      return res
        .status(401)
        .json({ success: false, error: "Invalid credentials" });

    if (!user.password) {
      return res.status(401).json({
        success: false,
        error:
          "This account does not have a password login. Please use Firebase login.",
      });
    }

    let valid = false;

    if (user.password.startsWith("$2a$") || user.password.startsWith("$2b$")) {
      valid = await bcrypt.compare(password, user.password);
    } else {
      valid = password === user.password;
    }

    if (!valid) {
      return res.status(401).json({
        success: false,
        error: "Invalid credentials",
      });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "7d" },
    );

    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        phone: user.phone,
        role: user.role,
        username: user.username,
        username_confirmed: user.username_confirmed,
        engineer_onboarding_required: user.engineer_onboarding_required,
      },
      token,
    });
  } catch (error) {
    console.error("🚨 LOGIN ERROR:", error);
    res.status(500).json({
      success: false,
      error: "Server error",
      details: error.message,
    });
  }
});

// 🔥 JWT REFRESH (add this)
router.post("/refresh", async (req, res) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token)
      return res.status(401).json({ success: false, error: "No token" });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const users =
      await sql`SELECT id, email, full_name, phone, role, username, username_confirmed, engineer_onboarding_required 
FROM users 
WHERE id = ${decoded.id}`;

    const user = users[0];
    if (!user)
      return res.status(401).json({ success: false, error: "User not found" });

    const newToken = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "7d" },
    );

    res.json({ success: true, user, token: newToken });
  } catch (error) {
    res.status(401).json({ success: false, error: "Invalid token" });
  }
});

module.exports = router;
