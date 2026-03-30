const router  = require('express').Router();
const path    = require('path');
const { query }       = require('../config/db');
const { authenticate, isAnyStaff } = require('../middleware/auth');
const { upload, uploadToS3 } = require('../middleware/upload');
const { AppError }    = require('../middleware/errorHandler');

/* GET / — list docs for an entity */
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { entity_id, document_type_id } = req.query;
    const params = [];
    const where  = [];
    if (entity_id)        where.push(`ed.entity_id = $${params.push(entity_id)}`);
    if (document_type_id) where.push(`ed.document_type_id = $${params.push(document_type_id)}`);
    const { rows } = await query(
      `SELECT ed.*,
              dt.name  AS document_type_name,
              dt.category,
              dt.is_sensitive,
              u.full_name AS uploaded_by_name
       FROM entity_documents ed
       LEFT JOIN document_types dt ON dt.id = ed.document_type_id
       LEFT JOIN users u ON u.id = ed.uploaded_by
       ${where.length ? 'WHERE '+where.join(' AND ') : ''}
       ORDER BY ed.uploaded_at DESC`, params
    );
    res.json({ data: rows, total: rows.length });
  } catch (err) { next(err); }
});

/* POST / — upload a document (multipart/form-data or JSON with file_url) */
router.post('/', authenticate, isAnyStaff, upload.single('file'), async (req, res, next) => {
  try {
    const { entity_id, document_type_id, issuance_date, expiration_date, comment, file_url } = req.body;
    if (!entity_id || !document_type_id || !issuance_date) {
      throw new AppError('entity_id, document_type_id, issuance_date are required');
    }

    let fileName = null, filePath = null, resolvedUrl = file_url || null;

    if (req.file) {
      fileName = req.file.originalname;
      if (process.env.STORAGE_DRIVER === 's3') {
        resolvedUrl = await uploadToS3(req.file);
      } else {
        filePath = req.file.path;
        resolvedUrl = `/uploads/${path.basename(req.file.path)}`;
      }
    }

    const { rows } = await query(
      `INSERT INTO entity_documents
         (entity_id, document_type_id, file_name, file_url, file_path,
          issuance_date, expiration_date, comment, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [entity_id, document_type_id, fileName, resolvedUrl, filePath,
       issuance_date, expiration_date||null, comment||null, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

/* PUT /:id */
router.put('/:id', authenticate, isAnyStaff, async (req, res, next) => {
  try {
    const fields = ['issuance_date','expiration_date','comment'];
    const cols   = fields.filter(f => req.body[f] !== undefined);
    if (!cols.length) throw new AppError('No updatable fields');
    const sets = cols.map((f,i)=>`${f}=$${i+1}`);
    sets.push(`last_updated_by=$${cols.length+1}`, `last_updated_at=NOW()`);
    const vals = [...cols.map(f=>req.body[f]), req.user.id, req.params.id];
    const { rows } = await query(
      `UPDATE entity_documents SET ${sets.join(',')} WHERE id=$${vals.length} RETURNING *`, vals
    );
    if (!rows[0]) throw new AppError('Not found',404);
    res.json(rows[0]);
  } catch (err) { next(err); }
});

/* DELETE /:id */
router.delete('/:id', authenticate, isAnyStaff, async (req, res, next) => {
  try {
    const { rowCount } = await query('DELETE FROM entity_documents WHERE id=$1',[req.params.id]);
    if (!rowCount) throw new AppError('Not found',404);
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

module.exports = router;
