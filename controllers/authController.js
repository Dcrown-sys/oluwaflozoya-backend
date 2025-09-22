// controllers/auth/firebaseLogin.js
const jwt = require('jsonwebtoken');
const { sql } = require('../../db'); // ✅ import correctly
const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret';

const firebaseLogin = async (req, res) => {
  try {
    const decodedToken = req.user;
    console.log("🔑 Decoded Firebase token:", decodedToken);

    const firebase_uid = decodedToken.uid;
    const email = decodedToken.email;

    console.log("📌 Checking for existing user with firebase_uid:", firebase_uid);

    // ✅ Check if user already exists
    const [user] = await sql`
      SELECT * FROM users WHERE firebase_uid = ${firebase_uid}
    `;

    let finalUser = user;

    if (!user) {
      const {
        fullName,
        phone,
        role,
        address,
        deliveryAddress,
        latitude,
        longitude
      } = req.body;

      console.log("🆕 Creating new user with data:", {
        firebase_uid,
        email,
        fullName,
        phone,
        role,
        address,
        deliveryAddress,
        latitude,
        longitude
      });

      // ✅ Create user
      const [newUser] = await sql`
        INSERT INTO users (
          firebase_uid, email, full_name, phone, role, address, delivery_address, latitude, longitude
        ) VALUES (
          ${firebase_uid}, ${email}, ${fullName}, ${phone}, ${role},
          ${address}, ${deliveryAddress}, ${latitude}, ${longitude}
        )
        RETURNING *
      `;

      console.log("✅ New user created:", newUser);
      finalUser = newUser;
    }

    // ✅ Ensure courier record exists
    if (finalUser.role === 'courier') {
      const [courier] = await sql`
        SELECT * FROM couriers WHERE user_id = ${finalUser.id}
      `;
      if (courier) {
        console.log("✅ Courier already exists:", courier);
      } else {
        const [newCourier] = await sql`
          INSERT INTO couriers (user_id, status, created_at)
          VALUES (${finalUser.id}, 'available', NOW())
          RETURNING *
        `;
        console.log("✅ New courier record created:", newCourier);
      }
    }

    // ✅ Generate backend JWT
    const token = jwt.sign(
      {
        id: finalUser.id,
        firebase_uid: finalUser.firebase_uid,
        role: finalUser.role
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    console.log("🎟️ JWT issued for user:", finalUser.id);

    return res.json({
      success: true,
      message: user ? 'User already exists (synced)' : 'User created',
      user: finalUser,
      token,
    });
  } catch (err) {
    console.error('🔥 Firebase login error:', err);
    return res.status(500).json({ success: false, error: 'Something went wrong' });
  }
};

module.exports = firebaseLogin;
