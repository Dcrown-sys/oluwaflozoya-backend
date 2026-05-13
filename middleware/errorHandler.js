exports.errorHandler = (err, req, res, next) => {
  if (err && err.status) {
    return res.status(err.status).json({
      success: false,
      message: err.message,
      details: err.details ?? undefined,
    });
  }
  console.error('[unhandled]', err);
  res.status(500).json({ 
    success: false, 
    message: 'Internal server error',
    error: err.message,        // ADD
    stack: err.stack           // ADD
  });
};