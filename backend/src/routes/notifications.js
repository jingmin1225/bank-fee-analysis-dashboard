const router  = require('express').Router();
const { query } = require('../config/db');
const { authenticate, isAnyStaff } = require('../middleware/auth');
const { AppError } = require('../middleware/errorHandler');

/* GET / */
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { request_id } = req.query;
    const params = [];
    const where  = [];
    if (request_id) where.push(`nl.request_id=$${params.push(request_id)}`);
    const { rows } = await query(
      `SELECT nl.*, u.full_name AS recipient_name, u.email AS recipient_email
       FROM notification_logs nl
       LEFT JOIN users u ON u.id = nl.recipient_user_id
       ${where.length ? 'WHERE '+where.join(' AND ') : ''}
       ORDER BY nl.sent_at DESC`, params
    );
    res.json({ data: rows, total: rows.length });
  } catch (err) { next(err); }
});

/* POST / — log a notification send */
router.post('/', authenticate, isAnyStaff, async (req, res, next) => {
  try {
    const { recipient_user_id, notification_template_id, trigger_type, request_id, document_requirement_ids } = req.body;
    if (!recipient_user_id) throw new AppError('recipient_user_id required');
    const { rows } = await query(
      `INSERT INTO notification_logs
         (recipient_user_id, notification_template_id, trigger_type, request_id, document_requirement_ids)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [recipient_user_id, notification_template_id||null,
       trigger_type||'Manual', request_id||null,
       document_requirement_ids||[]]
    );
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

module.exports = router;
