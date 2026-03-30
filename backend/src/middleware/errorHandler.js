function errorHandler(err, req, res, next) {
  console.error(err);
  const status  = err.status || err.statusCode || 500;
  const message = err.message || 'Internal server error';
  res.status(status).json({
    error:  message,
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
  });
}

class AppError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

module.exports = { errorHandler, AppError };
