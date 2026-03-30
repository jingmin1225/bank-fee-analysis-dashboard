const router  = require('express').Router();
const { query } = require('../config/db');
const { authenticate, isAdmin, isAnyStaff } = require('../middleware/auth');
const { AppError } = require('../middleware/errorHandler');

/* GET / */
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { search, entity_type, source, page = 1, limit = 50 } = req.query;
    const params = [];
    const where  = ['is_active = TRUE'];
    if (search)      where.push(`(name ILIKE $${params.push('%'+search+'%')} OR code ILIKE $${params.push('%'+search+'%')})`);
    if (entity_type) where.push(`entity_type = $${params.push(entity_type)}`);
    if (source)      where.push(`source = $${params.push(source)}`);
    const offset = (parseInt(page)-1) * parseInt(limit);
    const [data, count] = await Promise.all([
      query(`SELECT * FROM entities WHERE ${where.join(' AND ')} ORDER BY name ASC LIMIT $${params.push(limit)} OFFSET $${params.push(offset)}`, params),
      query(`SELECT COUNT(*) FROM entities WHERE ${where.join(' AND ')}`, params.slice(0,-2)),
    ]);
    res.json({ data: data.rows, total: parseInt(count.rows[0].count), page: parseInt(page), limit: parseInt(limit) });
  } catch (err) { next(err); }
});

/* GET /:id */
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM entities WHERE id=$1', [req.params.id]);
    if (!rows[0]) throw new AppError('Not found', 404);
    res.json(rows[0]);
  } catch (err) { next(err); }
});

/* POST / */
router.post('/', authenticate, isAnyStaff, async (req, res, next) => {
  try {
    const { code, name, entity_type, country, currency, source, metadata } = req.body;
    if (!code || !name || !entity_type) throw new AppError('code, name, entity_type required');
    const { rows } = await query(
      `INSERT INTO entities (code,name,entity_type,country,currency,source,metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [code, name, entity_type, country||null, currency||null, source||'Manual', JSON.stringify(metadata||{})]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code==='23505') next(new AppError('Entity code already exists',409)); else next(err);
  }
});

/* PUT /:id */
router.put('/:id', authenticate, isAnyStaff, async (req, res, next) => {
  try {
    const fields = ['name','country','currency','metadata','is_active'];
    const cols   = fields.filter(f => req.body[f] !== undefined);
    if (!cols.length) throw new AppError('No valid fields');
    const sets = cols.map((f,i)=>`${f}=$${i+1}`);
    const vals = [...cols.map(f => typeof req.body[f]==='object' ? JSON.stringify(req.body[f]) : req.body[f]), req.params.id];
    const { rows } = await query(`UPDATE entities SET ${sets.join(',')} WHERE id=$${vals.length} RETURNING *`, vals);
    if (!rows[0]) throw new AppError('Not found',404);
    res.json(rows[0]);
  } catch (err) { next(err); }
});

/* DELETE /:id */
router.delete('/:id', authenticate, isAdmin, async (req, res, next) => {
  try {
    await query('UPDATE entities SET is_active=FALSE WHERE id=$1',[req.params.id]);
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

/* POST /import — bulk import from external API response */
router.post('/import', authenticate, isAnyStaff, async (req, res, next) => {
  try {
    const { entities } = req.body;
    if (!Array.isArray(entities)) throw new AppError('entities array required');
    let imported = 0, skipped = 0;
    for (const e of entities) {
      try {
        await query(
          `INSERT INTO entities (code,name,entity_type,country,currency,source,metadata)
           VALUES ($1,$2,$3,$4,$5,'Kyriba',$6)
           ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name, metadata=EXCLUDED.metadata`,
          [e.code||e.id, e.name, e.entity_type||e.type, e.country||null, e.currency||null, JSON.stringify(e)]
        );
        imported++;
      } catch { skipped++; }
    }
    res.json({ imported, skipped });
  } catch (err) { next(err); }
});

module.exports = router;
