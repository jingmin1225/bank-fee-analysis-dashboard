const router  = require('express').Router();
const { query } = require('../config/db');
const { authenticate, isAdmin } = require('../middleware/auth');
const { AppError } = require('../middleware/errorHandler');

/* GET / */
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, connection_name, base_url, auth_type, scope, is_active, last_sync_at, created_at
       FROM api_integrations ORDER BY created_at DESC`
    );
    res.json({ data: rows, total: rows.length });
  } catch (err) { next(err); }
});

/* GET /:id */
router.get('/:id', authenticate, isAdmin, async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM api_integrations WHERE id=$1', [req.params.id]);
    if (!rows[0]) throw new AppError('Not found', 404);
    // Never return client_secret in plaintext
    delete rows[0].client_secret;
    res.json(rows[0]);
  } catch (err) { next(err); }
});

/* POST / */
router.post('/', authenticate, isAdmin, async (req, res, next) => {
  try {
    const { connection_name, auth_url, base_url, client_id, client_secret, scope, auth_type } = req.body;
    if (!connection_name || !base_url) throw new AppError('connection_name and base_url required');
    const { rows } = await query(
      `INSERT INTO api_integrations
         (connection_name, auth_url, base_url, client_id, client_secret, scope, auth_type)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, connection_name, base_url, auth_type, scope, created_at`,
      [connection_name, auth_url||null, base_url, client_id||null,
       client_secret||null, scope||null, auth_type||'OAuth2 Client Credentials']
    );
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

/* PUT /:id */
router.put('/:id', authenticate, isAdmin, async (req, res, next) => {
  try {
    const fields = ['connection_name','auth_url','base_url','client_id','client_secret','scope','auth_type','is_active'];
    const cols   = fields.filter(f => req.body[f] !== undefined);
    if (!cols.length) throw new AppError('No valid fields');
    const sets = cols.map((f,i)=>`${f}=$${i+1}`);
    const vals = [...cols.map(f=>req.body[f]), req.params.id];
    const { rows } = await query(
      `UPDATE api_integrations SET ${sets.join(',')} WHERE id=$${vals.length} RETURNING id, connection_name, base_url, auth_type, is_active`, vals
    );
    if (!rows[0]) throw new AppError('Not found', 404);
    res.json(rows[0]);
  } catch (err) { next(err); }
});

/* DELETE /:id */
router.delete('/:id', authenticate, isAdmin, async (req, res, next) => {
  try {
    await query('DELETE FROM api_integrations WHERE id=$1', [req.params.id]);
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

/* POST /:id/test — attempt OAuth2 token fetch and return status */
router.post('/:id/test', authenticate, isAdmin, async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM api_integrations WHERE id=$1', [req.params.id]);
    if (!rows[0]) throw new AppError('Integration not found', 404);
    const cfg = rows[0];

    // Attempt OAuth2 client-credentials token request
    const params = new URLSearchParams({
      grant_type:    'client_credentials',
      client_id:     cfg.client_id     || '',
      client_secret: cfg.client_secret || '',
      scope:         cfg.scope         || '',
    });

    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), parseInt(process.env.EXTERNAL_API_TIMEOUT_MS)||10000);

    let connected = false, statusCode = null, error = null;
    try {
      const resp = await fetch(cfg.auth_url || cfg.base_url + '/oauth/token', {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body:    params.toString(),
        signal:  controller.signal,
      });
      statusCode = resp.status;
      connected  = resp.ok;
    } catch (e) {
      error = e.message;
    } finally {
      clearTimeout(timeout);
    }

    // Update last_sync_at if connected
    if (connected) {
      await query('UPDATE api_integrations SET last_sync_at=NOW(), is_active=TRUE WHERE id=$1', [cfg.id]);
    }

    res.json({ connected, statusCode, error });
  } catch (err) { next(err); }
});

/* POST /:id/sync — fetch entities from external API and import them */
router.post('/:id/sync', authenticate, isAdmin, async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM api_integrations WHERE id=$1', [req.params.id]);
    if (!rows[0]) throw new AppError('Integration not found', 404);
    const cfg = rows[0];

    // Get OAuth2 token
    const tokenRes = await fetch(cfg.auth_url || cfg.base_url + '/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: cfg.client_id || '',
        client_secret: cfg.client_secret || '',
        scope: cfg.scope || '',
      }).toString(),
    });
    if (!tokenRes.ok) throw new AppError('Failed to obtain access token', 502);
    const { access_token } = await tokenRes.json();

    const headers = { Authorization: `Bearer ${access_token}` };
    const endpoints = [
      { url: `${cfg.base_url}/v1/accounts`,    type: 'Account' },
      { url: `${cfg.base_url}/v1/companies`,   type: 'Company' },
      { url: `${cfg.base_url}/v1/signers`,     type: 'Signer' },
      { url: `${cfg.base_url}/v1/authorities`, type: 'Authority' },
    ];

    let totalImported = 0, totalSkipped = 0;
    for (const ep of endpoints) {
      const resp = await fetch(ep.url, { headers });
      if (!resp.ok) continue;
      const data = await resp.json();
      const items = Array.isArray(data) ? data : (data.data || data.items || []);
      for (const item of items) {
        try {
          await query(
            `INSERT INTO entities (code,name,entity_type,country,currency,source,metadata)
             VALUES ($1,$2,$3,$4,$5,'Kyriba',$6)
             ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name, metadata=EXCLUDED.metadata, updated_at=NOW()`,
            [item.code||item.id, item.name, ep.type, item.country||null, item.currency||null, JSON.stringify(item)]
          );
          totalImported++;
        } catch { totalSkipped++; }
      }
    }

    await query('UPDATE api_integrations SET last_sync_at=NOW() WHERE id=$1', [cfg.id]);
    res.json({ imported: totalImported, skipped: totalSkipped });
  } catch (err) { next(err); }
});

module.exports = router;
