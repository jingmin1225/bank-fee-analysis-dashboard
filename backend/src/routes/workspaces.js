const router = require('express').Router();
const { query } = require('../config/db');
const { AppError } = require('../middleware/errorHandler');
const { authenticate } = require('../middleware/auth');

router.get('/', authenticate, async (req, res, next) => {
  try {
    const email = String(req.user?.email || '').trim().toLowerCase();
    if (!email) throw new AppError('Authenticated user email is required', 400);
    const { rows } = await query(
      'SELECT owner_email, workspace_state, created_at, updated_at FROM workspace_snapshots WHERE owner_email = $1',
      [email]
    );
    if (!rows[0]) return res.json({ exists: false, workspace_state: null });
    res.json({ exists: true, ...rows[0] });
  } catch (err) {
    next(err);
  }
});

router.put('/', authenticate, async (req, res, next) => {
  try {
    const email = String(req.user?.email || '').trim().toLowerCase();
    const workspaceState = req.body?.workspace_state;
    if (!email) throw new AppError('Authenticated user email is required', 400);
    if (!workspaceState || typeof workspaceState !== 'object') {
      throw new AppError('workspace_state object is required', 400);
    }

    const { rows } = await query(
      `INSERT INTO workspace_snapshots (owner_email, workspace_state)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (owner_email)
       DO UPDATE SET workspace_state = EXCLUDED.workspace_state, updated_at = NOW()
       RETURNING owner_email, workspace_state, created_at, updated_at`,
      [email, JSON.stringify(workspaceState)]
    );
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
