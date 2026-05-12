// middleware/validate.js
exports.validate = (schema, target = 'body') => (req, res, next) => {
    const parsed = schema.safeParse(req[target]);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        details: parsed.error.flatten(),
      });
    }
    req[target] = parsed.data;
    next();
  };