// middleware/firebaseAuth.js
const admin = require('../config/serviceAccountKey'); // your firebase admin setup

const verifyFirebaseToken = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.user = decoded; // include uid, email, etc.
    next();
  } catch (err) {
    console.error('Auth error:', err.message);
    res.status(401).json({ error: 'Invalid or expired token' });
  }
};

module.exports = { verifyFirebaseToken };
