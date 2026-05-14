// routes/auth.js
const express = require("express");
const router = express.Router();
const admin = require("../utils/firebase-admin");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { sql } = require("../db");

const JWT_SECRET = process.env.JWT_SECRET || "your_jwt_secret";

function buildUserResponse(user) {
  return {
    id: user.id,
    firebase_uid: user.firebase_uid || null,
    email: user.email,
    phone: user.phone || null,
    full_name: user.full_name || "User",
    role: user.role,
    status: user.status || null,
    username: user.username || null,
    username_confirmed: user.username_confirmed || false,
    engineer_onboarding_required: user.engineer_onboarding_required || false,
    referred_by_user_id: user.referred_by_user_id || null,
  };
}

function generateToken(user) {
  return jwt.sign(
    {
      id: user.id,
      firebase_uid: user.firebase_uid || null,
      email: user.email,
      role: user.role,
    },
    JWT_SECRET,
    { expiresIn: "7d" },
  );
}

// POST /api/auth/firebase-login
router.post("/firebase-login", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(400).json({
        success: false,
        error: "Missing or invalid Authorization header",
      });
    }

    const idToken = authHeader.split(" ")[1];
    const decodedToken = await admin.auth().verifyIdToken(idToken);

    const firebase_uid = decodedToken.uid;
    const email = decodedToken.email || null;

    const {
      phone = null,
      fullName = null,
      role = "buyer",
      address = null,
      deliveryAddress = null,
      latitude = null,
      longitude = null,
      referral_username = null,
    } = req.body;

    if (!firebase_uid) {
      return res.status(400).json({
        success: false,
        error: "Missing firebase_uid from token",
      });
    }

    let [user] = await sql`
      SELECT *
      FROM users
      WHERE firebase_uid = ${firebase_uid}
         OR email = ${email}
      LIMIT 1
    `;

    if (user) {
      const [updatedUser] = await sql`
        UPDATE users
        SET
          firebase_uid = COALESCE(firebase_uid, ${firebase_uid}),
          email = COALESCE(email, ${email}),
          phone = COALESCE(phone, ${phone || null}),
          full_name = COALESCE(full_name, ${fullName || decodedToken.name || "User"}),
          updated_at = NOW()
        WHERE id = ${user.id}
        RETURNING *
      `;

      user = updatedUser;
    }
let referredByUserId = null;

const defaultReferralUsername = "ZOYA-VICTORER5137";
const finalReferralUsername = referral_username || defaultReferralUsername;

const [referrer] = await sql`
  SELECT id
  FROM users
  WHERE username = ${finalReferralUsername}
  LIMIT 1
`;

if (referrer) {
  referredByUserId = referrer.id;
    } else {
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
  longitude,
  referred_by_user_id,
  status,
  created_at
)
VALUES (
  ${firebase_uid},
  ${email},
  ${phone || null},
  ${role || "buyer"},
  ${fullName || decodedToken.name || "User"},
  ${address || null},
  ${deliveryAddress || null},
  ${latitude || null},
  ${longitude || null},
  ${referredByUserId},
  'active',
  NOW()
)
        RETURNING *
      `;

      user = newUser;

      if (referredByUserId) {
  await sql`
    INSERT INTO engineer_referrals (
      referrer_user_id,
      referred_user_id,
      status,
      created_at
    )
    VALUES (
      ${referredByUserId},
      ${user.id},
      'pending',
      NOW()
    )
    ON CONFLICT DO NOTHING
  `;
}
    }

    if (user.role === "courier") {
      const [courier] = await sql`
        SELECT *
        FROM couriers
        WHERE user_id = ${user.id}
        LIMIT 1
      `;

      if (!courier) {
        await sql`
          INSERT INTO couriers (user_id, status, created_at)
          VALUES (${user.id}, 'available', NOW())
        `;
      }
    }

    const token = generateToken(user);

    return res.status(200).json({
      success: true,
      message: "Login successful",
      user: buildUserResponse(user),
      token,
    });
  } catch (error) {
    console.error("❌ Firebase login error:", error);
    return res.status(500).json({
      success: false,
      error: "Internal Server Error",
      details: error.message,
    });
  }
});

// POST /api/auth/login-with-apple
router.post("/login-with-apple", async (req, res) => {
  try {
    const { firebaseUid, email } = req.body;

    if (!firebaseUid || !email) {
      return res.status(400).json({
        success: false,
        error: "Firebase UID and email are required",
      });
    }

    const [user] = await sql`
      SELECT *
      FROM users
      WHERE firebase_uid = ${firebaseUid}
         OR email = ${email}
      LIMIT 1
    `;

    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found. Please sign up first.",
      });
    }

    const token = generateToken(user);

    return res.status(200).json({
      success: true,
      user: buildUserResponse(user),
      token,
    });
  } catch (error) {
    console.error("❌ Apple login error:", error);
    return res.status(500).json({
      success: false,
      error: "Internal Server Error",
      details: error.message,
    });
  }
});

// POST /api/auth/login
// Use this mainly for admin/password accounts, not Firebase mobile users.
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: "Email and password are required",
      });
    }

    const [user] = await sql`
      SELECT *
      FROM users
      WHERE LOWER(email) = LOWER(${email})
      LIMIT 1
    `;

    if (!user || !user.password) {
      return res.status(401).json({
        success: false,
        error: "Invalid email or password",
      });
    }

    const isHash =
      user.password.startsWith("$2a$") ||
      user.password.startsWith("$2b$") ||
      user.password.startsWith("$2y$");

    if (!isHash) {
      return res.status(401).json({
        success: false,
        error: "Password is not securely set. Please reset password.",
      });
    }

    const valid = await bcrypt.compare(password, user.password);

    if (!valid) {
      return res.status(401).json({
        success: false,
        error: "Invalid email or password",
      });
    }

    const token = generateToken(user);

    return res.json({
      success: true,
      user: buildUserResponse(user),
      token,
    });
  } catch (error) {
    console.error("🚨 LOGIN ERROR:", error);
    return res.status(500).json({
      success: false,
      error: "Server error",
      details: error.message,
    });
  }
});

// POST /api/auth/refresh
router.post("/refresh", async (req, res) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];

    if (!token) {
      return res.status(401).json({
        success: false,
        error: "No token",
      });
    }

    const decoded = jwt.verify(token, JWT_SECRET);

    const [user] = await sql`
      SELECT *
      FROM users
      WHERE id = ${decoded.id}
      LIMIT 1
    `;

    if (!user) {
      return res.status(401).json({
        success: false,
        error: "User not found",
      });
    }

    const newToken = generateToken(user);

    return res.json({
      success: true,
      user: buildUserResponse(user),
      token: newToken,
    });
  } catch (error) {
    return res.status(401).json({
      success: false,
      error: "Invalid token",
    });
  }
});

module.exports = router;
