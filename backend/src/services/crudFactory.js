/**
 * crudFactory(table, fields, opts)
 * Generates standard Express router with GET list, GET one, POST, PUT, DELETE.
 *
 * @param {string} table         — Postgres table name
 * @param {string[]} fields      — Writable columns (for INSERT / UPDATE)
 * @param {object} opts
 *   searchCols  {string[]}  — Columns to apply ?search= filter on
 *   defaultSort {string}    — Default ORDER BY clause
 *   readRoles   {string[]}  — Roles allowed to read  (default: all authenticated)
 *   writeRoles  {string[]}  — Roles allowed to write (default: ['admin'])
 */
const router  = require('express').Router;
const { query } = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const { AppError } = require('../middleware/errorHandler');

function crudFactory(table, fields, opts = {}) {
  const {
    searchCols  = ['name'],
    defaultSort = 'created_at DESC',
    readRoles   = ['admin','treasurer','document_manager','individual'],
    writeRoles  = ['admin'],
  } = opts;

  const r = router();
  const canRead  = authenticate;  // all authenticated users
  const canWrite = [authenticate, authorize(...writeRoles)];

  /* GET /  — list with optional search, filter, pagination */
  r.get('/', canRead, async (req, res, next) => {
    try {
      const { search, status, page = 1, limit = 50 } = req.query;
      const params = [];
      const where  = [];

      if (search) {
        const conditions = searchCols.map((col, i) => `${col} ILIKE $${params.push('%'+search+'%')}`);
        where.push(`(${conditions.join(' OR ')})`);
      }
      if (status) where.push(`is_active = $${params.push(status === 'Active')}`);

      const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';
      const offset = (parseInt(page) - 1) * parseInt(limit);

      const [dataRes, countRes] = await Promise.all([
        query(`SELECT * FROM ${table} ${whereClause} ORDER BY ${defaultSort} LIMIT $${params.push(limit)} OFFSET $${params.push(offset)}`, params),
        query(`SELECT COUNT(*) FROM ${table} ${whereClause}`, params.slice(0, -2)),
      ]);

      res.json({
        data:  dataRes.rows,
        total: parseInt(countRes.rows[0].count),
        page:  parseInt(page),
        limit: parseInt(limit),
      });
    } catch (err) { next(err); }
  });

  /* GET /:id */
  r.get('/:id', canRead, async (req, res, next) => {
    try {
      const { rows } = await query(`SELECT * FROM ${table} WHERE id = $1`, [req.params.id]);
      if (!rows[0]) throw new AppError('Not found', 404);
      res.json(rows[0]);
    } catch (err) { next(err); }
  });

  /* POST / */
  r.post('/', ...canWrite, async (req, res, next) => {
    try {
      const cols   = fields.filter(f => req.body[f] !== undefined);
      const vals   = cols.map(f => req.body[f]);
      const placeholders = cols.map((_, i) => `$${i + 1}`);
      const { rows } = await query(
        `INSERT INTO ${table} (${cols.join(',')}) VALUES (${placeholders}) RETURNING *`,
        vals
      );
      res.status(201).json(rows[0]);
    } catch (err) {
      if (err.code === '23505') next(new AppError('A record with that name already exists', 409));
      else next(err);
    }
  });

  /* PUT /:id */
  r.put('/:id', ...canWrite, async (req, res, next) => {
    try {
      const cols = fields.filter(f => req.body[f] !== undefined);
      if (!cols.length) throw new AppError('No valid fields to update');
      const sets = cols.map((f, i) => `${f} = $${i + 1}`);
      const vals = [...cols.map(f => req.body[f]), req.params.id];
      const { rows } = await query(
        `UPDATE ${table} SET ${sets.join(',')} WHERE id = $${vals.length} RETURNING *`,
        vals
      );
      if (!rows[0]) throw new AppError('Not found', 404);
      res.json(rows[0]);
    } catch (err) { next(err); }
  });

  /* DELETE /:id — soft delete (sets is_active=false) */
  r.delete('/:id', ...canWrite, async (req, res, next) => {
    try {
      const { rows } = await query(
        `UPDATE ${table} SET is_active = FALSE WHERE id = $1 RETURNING id`,
        [req.params.id]
      );
      if (!rows[0]) throw new AppError('Not found', 404);
      res.json({ deleted: true, id: req.params.id });
    } catch (err) { next(err); }
  });

  /* DELETE /batch  — batch soft-delete */
  r.delete('/', ...canWrite, async (req, res, next) => {
    try {
      const { ids } = req.body;
      if (!Array.isArray(ids) || !ids.length) throw new AppError('ids array required');
      const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
      const { rowCount } = await query(
        `UPDATE ${table} SET is_active = FALSE WHERE id IN (${placeholders})`,
        ids
      );
      res.json({ deleted: rowCount, ids });
    } catch (err) { next(err); }
  });

  return r;
}

module.exports = crudFactory;
