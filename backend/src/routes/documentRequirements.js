const router  = require('express').Router();
const { query } = require('../config/db');
const { authenticate, isAnyStaff } = require('../middleware/auth');
const { AppError } = require('../middleware/errorHandler');

/* Compute document_status from expiration_date */
function computeStatus(latestDoc) {
  if (!latestDoc) return 'Missing';
  if (!latestDoc.expiration_date) return 'Available';
  const daysLeft = (new Date(latestDoc.expiration_date) - new Date()) / 86400000;
  if (daysLeft < 0)  return 'Expired';
  if (daysLeft <= 30) return 'WillExpireSoon';
  return 'Available';
}

/* GET / — dashboard view */
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { request_id, entity_id, status } = req.query;
    const params = [];
    const where  = [];
    if (request_id) where.push(`dr.request_id=$${params.push(request_id)}`);
    if (entity_id)  where.push(`dr.entity_id=$${params.push(entity_id)}`);
    if (status)     where.push(`dr.document_status=$${params.push(status)}`);

    const { rows } = await query(
      `SELECT dr.*,
              e.name  AS entity_name,  e.code AS entity_code,  e.entity_type,
              dt.name AS document_type_name, dt.category,
              ed.file_name, ed.file_url, ed.issuance_date, ed.expiration_date,
              ed.uploaded_at, u.full_name AS uploaded_by_name
       FROM document_requirements dr
       LEFT JOIN entities e ON e.id = dr.entity_id
       LEFT JOIN document_types dt ON dt.id = dr.document_type_id
       LEFT JOIN entity_documents ed ON ed.id = dr.latest_document_id
       LEFT JOIN users u ON u.id = ed.uploaded_by
       ${where.length ? 'WHERE '+where.join(' AND ') : ''}
       ORDER BY dr.created_at DESC`, params
    );
    res.json({ data: rows, total: rows.length });
  } catch (err) { next(err); }
});

/* POST / — create requirement */
router.post('/', authenticate, isAnyStaff, async (req, res, next) => {
  try {
    const { request_id, entity_id, document_type_id, is_mandatory } = req.body;
    if (!request_id || !entity_id || !document_type_id) {
      throw new AppError('request_id, entity_id, document_type_id required');
    }
    const { rows } = await query(
      `INSERT INTO document_requirements (request_id,entity_id,document_type_id,is_mandatory)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [request_id, entity_id, document_type_id, is_mandatory !== false]
    );
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

/* POST /refresh-statuses — recompute all statuses (run nightly via cron) */
router.post('/refresh-statuses', authenticate, isAnyStaff, async (req, res, next) => {
  try {
    const { rows: reqs } = await query(
      `SELECT dr.id, ed.expiration_date
       FROM document_requirements dr
       LEFT JOIN entity_documents ed ON ed.id = dr.latest_document_id`
    );
    let updated = 0;
    for (const req of reqs) {
      const newStatus = computeStatus(req);
      await query(
        'UPDATE document_requirements SET document_status=$1 WHERE id=$2',
        [newStatus, req.id]
      );
      updated++;
    }
    res.json({ updated });
  } catch (err) { next(err); }
});

/* PUT /:id/link-document — link an uploaded doc to a requirement */
router.put('/:id/link-document', authenticate, isAnyStaff, async (req, res, next) => {
  try {
    const { document_id } = req.body;
    const { rows: docRows } = await query(
      'SELECT expiration_date FROM entity_documents WHERE id=$1', [document_id]
    );
    if (!docRows[0]) throw new AppError('Document not found', 404);
    const newStatus = computeStatus(docRows[0]);
    const { rows } = await query(
      `UPDATE document_requirements
       SET latest_document_id=$1, document_status=$2
       WHERE id=$3 RETURNING *`,
      [document_id, newStatus, req.params.id]
    );
    if (!rows[0]) throw new AppError('Requirement not found', 404);
    res.json(rows[0]);
  } catch (err) { next(err); }
});

module.exports = router;
