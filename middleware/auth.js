const jwt = require('jsonwebtoken');
const { sql } = require('../db');
const JWT_SECRET = process.env.JWT_SECRET;

// Generic JWT validator (attach decoded token to req.user)
exports.verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // Attach decoded token payload to request
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
};

// Role-based middleware for admin only
exports.verifyAdmin = (req, res, next) => {
  exports.verifyToken(req, res, () => {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Access denied: Admins only' });
    }
    next();
  });
};

// Role-based middleware for courier only
exports.verifyCourier = (req, res, next) => {
  exports.verifyToken(req, res, () => {
    if (req.user.role !== 'courier') {
      return res.status(403).json({ success: false, message: 'Access denied: Couriers only' });
    }
    next();
  });
};

// Role-based middleware for buyer only
exports.verifyBuyer = (req, res, next) => {
  exports.verifyToken(req, res, () => {
    if (req.user.role !== 'buyer') {
      return res.status(403).json({ success: false, message: 'Access denied: Buyers only' });
    }
    next();
  });
};
