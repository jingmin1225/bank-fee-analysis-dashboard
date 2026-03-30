const router  = require('express').Router();
const { query } = require('../config/db');
const { authenticate, isAdmin } = require('../middleware/auth');
const { AppError } = require('../middleware/errorHandler');

const FIELDS = ['name','request_type_id','rank','conditions','required_documents','company_ownership','is_active'];

/* GET / — list, optionally filter by request_type_id */
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { request_type_id, search } = req.query;
    const params = [];
    const where  = ['dr.is_active = TRUE'];
    if (request_type_id) where.push(`dr.request_type_id = $${params.push(request_type_id)}`);
    if (search) where.push(`dr.name ILIKE $${params.push('%'+search+'%')}`);
    const { rows } = await query(
      `SELECT dr.*, rt.name AS request_type_name
       FROM documentation_rules dr
       LEFT JOIN request_types rt ON rt.id = dr.request_type_id
       WHERE ${where.join(' AND ')}
       ORDER BY dr.request_type_id, dr.rank ASC`,
      params
    );
    res.json({ data: rows, total: rows.length });
  } catch (err) { next(err); }
});

/* GET /:id */
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT dr.*, rt.name AS request_type_name
       FROM documentation_rules dr
       LEFT JOIN request_types rt ON rt.id = dr.request_type_id
       WHERE dr.id = $1`, [req.params.id]
    );
    if (!rows[0]) throw new AppError('Not found', 404);
    res.json(rows[0]);
  } catch (err) { next(err); }
});

/* POST / */
router.post('/', authenticate, isAdmin, async (req, res, next) => {
  try {
    const { name, request_type_id, rank, conditions, required_documents, company_ownership } = req.body;
    if (!name || !request_type_id) throw new AppError('name and request_type_id are required');
    const { rows } = await query(
      `INSERT INTO documentation_rules
         (name, request_type_id, rank, conditions, required_documents, company_ownership)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [name, request_type_id, rank || 1,
       JSON.stringify(conditions || []),
       JSON.stringify(required_documents || []),
       company_ownership || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

/* PUT /:id */
router.put('/:id', authenticate, isAdmin, async (req, res, next) => {
  try {
    const cols = FIELDS.filter(f => req.body[f] !== undefined);
    if (!cols.length) throw new AppError('No valid fields to update');
    const sets = cols.map((f, i) => `${f} = $${i + 1}`);
    const vals = [...cols.map(f => {
      const v = req.body[f];
      return (typeof v === 'object') ? JSON.stringify(v) : v;
    }), req.params.id];
    const { rows } = await query(
      `UPDATE documentation_rules SET ${sets.join(',')} WHERE id = $${vals.length} RETURNING *`, vals
    );
    if (!rows[0]) throw new AppError('Not found', 404);
    res.json(rows[0]);
  } catch (err) { next(err); }
});

/* DELETE /:id */
router.delete('/:id', authenticate, isAdmin, async (req, res, next) => {
  try {
    const { rows } = await query(
      `UPDATE documentation_rules SET is_active=FALSE WHERE id=$1 RETURNING id`, [req.params.id]
    );
    if (!rows[0]) throw new AppError('Not found', 404);
    res.json({ deleted: true, id: req.params.id });
  } catch (err) { next(err); }
});

/* DELETE / — batch delete */
router.delete('/', authenticate, isAdmin, async (req, res, next) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || !ids.length) throw new AppError('ids array required');
    const ph = ids.map((_,i)=>`$${i+1}`).join(',');
    const { rowCount } = await query(
      `UPDATE documentation_rules SET is_active=FALSE WHERE id IN (${ph})`, ids
    );
    res.json({ deleted: rowCount, ids });
  } catch (err) { next(err); }
});

/* POST /reorder — update ranks within a request type */
router.post('/reorder', authenticate, isAdmin, async (req, res, next) => {
  try {
    const { request_type_id, ordered_ids } = req.body;
    if (!request_type_id || !Array.isArray(ordered_ids)) {
      throw new AppError('request_type_id and ordered_ids required');
    }
    for (let i = 0; i < ordered_ids.length; i++) {
      await query(
        'UPDATE documentation_rules SET rank=$1 WHERE id=$2 AND request_type_id=$3',
        [i + 1, ordered_ids[i], request_type_id]
      );
    }
    res.json({ reordered: ordered_ids.length });
  } catch (err) { next(err); }
});

module.exports = router;
