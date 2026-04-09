const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { query }       = require('../config/db');
const { authenticate }= require('../middleware/auth');
const { AppError }    = require('../middleware/errorHandler');

function normalizeRole(role) {
  const value = String(role || '').trim().toLowerCase();
  if (['admin', 'treasurer', 'document_manager', 'individual'].includes(value)) return value;
  if (value === 'document manager') return 'document_manager';
  if (value === 'individual (signer/id owner)') return 'individual';
  return 'individual';
}

/* POST /api/v1/auth/login */
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) throw new AppError('Email and password required');

    const { rows } = await query(
      'SELECT * FROM users WHERE email = $1 AND is_active = TRUE',
      [email.toLowerCase()]
    );
    const user = rows[0];
    if (!user) throw new AppError('Invalid credentials', 401);

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) throw new AppError('Invalid credentials', 401);

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, name: user.full_name },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    res.json({
      token,
      user: { id: user.id, email: user.email, role: user.role, name: user.full_name },
    });
  } catch (err) { next(err); }
});

/* POST /api/v1/auth/register  (admin only in production — open for demo) */
router.post('/register', async (req, res, next) => {
  try {
    const { email, password, full_name, role } = req.body;
    if (!email || !password || !full_name) throw new AppError('email, password, full_name required');

    const hash = await bcrypt.hash(password, 12);
    const { rows } = await query(
      `INSERT INTO users (email, password_hash, full_name, role)
       VALUES ($1,$2,$3,$4) RETURNING id, email, role, full_name`,
      [email.toLowerCase(), hash, full_name, normalizeRole(role)]
    );
    res.status(201).json({ user: rows[0] });
  } catch (err) {
    if (err.code === '23505') next(new AppError('Email already registered', 409));
    else next(err);
  }
});

/* GET /api/v1/auth/me */
router.get('/me', authenticate, async (req, res, next) => {
  try {
    const { rows } = await query(
      'SELECT id, email, full_name, role, created_at FROM users WHERE id = $1',
      [req.user.id]
    );
    if (!rows[0]) throw new AppError('User not found', 404);
    res.json(rows[0]);
  } catch (err) { next(err); }
});

module.exports = router;
