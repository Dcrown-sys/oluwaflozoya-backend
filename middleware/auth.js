const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET;

// Generic JWT validator (attach decoded token to req.user)
exports.verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // Attach user info to request
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
};

// Role-based middleware for admin only
exports.verifyAdmin = (req, res, next) => {
  exports.verifyToken(req, res, () => {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied: Admins only' });
    }
    next();
  });
};

// Optional: You can also create for courier, buyer, etc
exports.verifyCourier = (req, res, next) => {
  exports.verifyToken(req, res, () => {
    if (req.user.role !== 'courier') {
      return res.status(403).json({ error: 'Access denied: Couriers only' });
    }
    next();
  });
};

exports.verifyBuyer = (req, res, next) => {
  exports.verifyToken(req, res, () => {
    if (req.user.role !== 'buyer') {
      return res.status(403).json({ error: 'Access denied: Buyers only' });
    }
    next();
  });
};
