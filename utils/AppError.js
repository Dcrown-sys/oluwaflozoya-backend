// utils/AppError.js
class AppError extends Error {
    constructor(message, status = 500, details = null) {
      super(message);
      this.status = status;
      this.details = details;
      this.name = 'AppError';
    }
  }
  module.exports = { AppError };