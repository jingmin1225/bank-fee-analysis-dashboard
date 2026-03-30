const jwt = require('jsonwebtoken');

/* Verify JWT and attach user to req */
function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No token provided' });

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/* Role-based access control factory */
function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

/* Convenience role sets */
const isAdmin      = authorize('admin');
const isAdminOrTreasurer = authorize('admin', 'treasurer');
const isAnyStaff   = authorize('admin', 'treasurer', 'document_manager');

module.exports = { authenticate, authorize, isAdmin, isAdminOrTreasurer, isAnyStaff };
