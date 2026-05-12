// middleware/errorHandler.js
exports.errorHandler = (err, req, res, next) => {
    if (err && err.status) {
      return res.status(err.status).json({
        success: false,
        message: err.message,
        details: err.details ?? undefined,
      });
    }
    console.error('[unhandled]', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  };