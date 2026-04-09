const router = require('express').Router();
const { AppError } = require('../middleware/errorHandler');

const timeoutMs = Number(process.env.EXTERNAL_API_TIMEOUT_MS || 10000);
const ptFilesEndpointCache = new Map(); // key: processTemplateCode -> endpoint template

function requiredEnv(name) {
  const v = process.env[name];
  if (!v || !String(v).trim()) throw new AppError(`Missing env: ${name}`, 500);
  return String(v).trim();
}

function getBodyAlias(cfg, keys) {
  for (const key of keys) {
    const value = cfg?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value).trim();
    }
  }
  return '';
}

async function parseResponseBodySafe(resp) {
  const contentType = (resp.headers.get('content-type') || '').toLowerCase();
  const text = await resp.text().catch(() => '');
  let json = null;
  if (contentType.includes('application/json') || contentType.includes('+json')) {
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = null;
    }
  } else {
    // Some gateways return JSON without proper content-type
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
  }
  return { contentType, text, json };
}

function detailToString(detail) {
  if (detail === null || detail === undefined) return '';
  if (typeof detail === 'string') return detail;
  try {
    return JSON.stringify(detail);
  } catch {
    return String(detail);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getKyribaToken() {
  const tokenUrl = requiredEnv('KYRIBA_TOKEN_URL');
  const clientId = requiredEnv('KYRIBA_CLIENT_ID');
  const clientSecret = requiredEnv('KYRIBA_CLIENT_SECRET');
  const scope = String(process.env.KYRIBA_SCOPE || '').trim();

  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  });
  if (scope) params.set('scope', scope);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // Attempt 1: client credentials in request body
    let resp = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      signal: controller.signal,
    });

    // Attempt 2 fallback: Basic auth header (common OAuth2 requirement)
    if (!resp.ok) {
      const text1 = await resp.text().catch(() => '');
      const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      const basicParams = new URLSearchParams({ grant_type: 'client_credentials' });
      if (scope) basicParams.set('scope', scope);
      resp = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${basic}`,
        },
        body: basicParams.toString(),
        signal: controller.signal,
      });
      if (!resp.ok) {
        const text2 = await resp.text().catch(() => '');
        throw new AppError(
          `Token request failed (${resp.status}) body_auth=${text1.slice(0, 140)} basic_auth=${text2.slice(0, 140)}`,
          502
        );
      }
    }

    const json = await resp.json();
    if (!json.access_token) throw new AppError('Token response missing access_token', 502);
    return json.access_token;
  } finally {
    clearTimeout(timeout);
  }
}

async function getKyribaTokenFromBody(cfg) {
  const tokenUrl = getBodyAlias(cfg, ['token_url', 'authUrl']);
  const clientId = getBodyAlias(cfg, ['client_id', 'clientId']);
  const clientSecret = getBodyAlias(cfg, ['client_secret', 'clientSecret']);
  const scope = getBodyAlias(cfg, ['scope']);
  if (!tokenUrl || !clientId || !clientSecret) {
    throw new AppError('token_url/authUrl, client_id/clientId, and client_secret/clientSecret are required', 400);
  }

  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  });
  if (scope) params.set('scope', scope);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // Attempt 1: client credentials in body
    let resp = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      signal: controller.signal,
    });

    // Attempt 2 fallback: Basic auth header
    if (!resp.ok) {
      const text1 = await resp.text().catch(() => '');
      const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      const basicParams = new URLSearchParams({ grant_type: 'client_credentials' });
      if (scope) basicParams.set('scope', scope);
      resp = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${basic}`,
        },
        body: basicParams.toString(),
        signal: controller.signal,
      });
      if (!resp.ok) {
        const text2 = await resp.text().catch(() => '');
        throw new AppError(
          `Token request failed (${resp.status}) body_auth=${text1.slice(0, 140)} basic_auth=${text2.slice(0, 140)}`,
          502
        );
      }
    }

    const json = await resp.json();
    if (!json.access_token) throw new AppError('Token response missing access_token', 502);
    return json.access_token;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchKyribaJson(path) {
  const baseUrl = requiredEnv('KYRIBA_BASE_URL').replace(/\/+$/, '');
  const token = await getKyribaToken();
  const url = `${baseUrl}${path}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    const body = await parseResponseBodySafe(resp);
    if (!resp.ok) {
      const detail = detailToString(body.json?.detail || body.json?.error || body.text.slice(0, 200));
      throw new AppError(`Kyriba request failed (${resp.status}) ${detail}`, 502);
    }
    if (body.json === null) {
      throw new AppError(
        `Kyriba response is not JSON (content-type: ${body.contentType || 'unknown'}) ${body.text.slice(0, 120)}`,
        502
      );
    }
    return body.json;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchKyribaJsonFromBody(path, cfg) {
  const baseUrl = String(cfg.base_url || '').trim().replace(/\/+$/, '');
  if (!baseUrl) throw new AppError('base_url is required', 400);
  const bodyToken = String(cfg.access_token || '').trim();
  const token = bodyToken || await getKyribaTokenFromBody(cfg);
  const url = `${baseUrl}${path}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const doGet = async (bearerToken) => {
      const resp = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${bearerToken}`,
          Accept: 'application/json',
        },
        signal: controller.signal,
      });
      const body = await parseResponseBodySafe(resp);
      return { resp, body };
    };

    let { resp, body } = await doGet(token);
    if (!resp.ok && bodyToken && (resp.status === 401 || resp.status === 403)) {
      // If caller passed a stale token, retry once with a fresh token from client credentials.
      const freshToken = await getKyribaTokenFromBody(cfg);
      ({ resp, body } = await doGet(freshToken));
    }

    if (!resp.ok) {
      const detail = detailToString(body.json?.detail || body.json?.error || body.text.slice(0, 200));
      throw new AppError(`Kyriba request failed (${resp.status}) ${detail}`, 502);
    }
    if (body.json === null) {
      // Forward raw payload to frontend for diagnostics/preview fallback.
      return {
        raw: body.text,
        content_type: body.contentType || '',
      };
    }
    return body.json;
  } finally {
    clearTimeout(timeout);
  }
}

async function postKyribaJsonFromBody(path, cfg, payload = {}) {
  const baseUrl = String(cfg.base_url || '').trim().replace(/\/+$/, '');
  if (!baseUrl) throw new AppError('base_url is required', 400);
  const bodyToken = String(cfg.access_token || '').trim();
  const token = bodyToken || await getKyribaTokenFromBody(cfg);
  const url = `${baseUrl}${path}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const doPost = async (bearerToken) => fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload || {}),
      signal: controller.signal,
    });

    let resp = await doPost(token);
    if (!resp.ok && bodyToken && (resp.status === 401 || resp.status === 403)) {
      // If caller passed a stale token, retry once with a fresh token from client credentials.
      const freshToken = await getKyribaTokenFromBody(cfg);
      resp = await doPost(freshToken);
    }

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new AppError(`Kyriba request failed (${resp.status}) ${text.slice(0, 200)}`, 502);
    }
    const text = await resp.text().catch(() => '');
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = text ? { raw: text } : {};
    }
    return {
      data,
      status: resp.status,
      location: resp.headers.get('location') || '',
      taskHeader: resp.headers.get('x-task-id') || resp.headers.get('task-id') || '',
    };
  } finally {
    clearTimeout(timeout);
  }
}

function findTaskIdDeep(value) {
  if (!value) return null;
  if (typeof value !== 'object') return null;

  const directCandidates = [
    value.task_id, value.taskId, value.taskID,
    value.id, value.run_id, value.runId,
    value.job_id, value.jobId,
    value.execution_id, value.executionId,
  ].filter(Boolean);
  if (directCandidates.length) return String(directCandidates[0]);

  for (const key of Object.keys(value)) {
    const v = value[key];
    if (v && typeof v === 'object') {
      const hit = findTaskIdDeep(v);
      if (hit) return hit;
    }
  }
  return null;
}

/* POST /api/v1/kyriba/token
   Body: { token_url, client_id, client_secret, scope? } */
router.post('/token', async (req, res, next) => {
  try {
    const accessToken = await getKyribaTokenFromBody(req.body || {});
    res.json({ access_token: accessToken });
  } catch (err) {
    next(err);
  }
});

/* POST /api/v1/kyriba/entities
   Body: { scope, base_url, authUrl?, client_id?, clientId?, client_secret?, clientSecret?, access_token? } */
router.post('/entities', async (req, res, next) => {
  try {
    const cfg = req.body || {};
    const scope = String(cfg.scope || 'Companies').trim();
    const path = scope === 'Accounts' ? '/v1/accounts' : '/v1/companies';
    const data = await fetchKyribaJsonFromBody(path, cfg);
    const records = Array.isArray(data) ? data : Object.values(data || {}).find(Array.isArray) || [];
    const entities = records.map((item) => ({
      id: item.id || item.code || item.accountId || item.companyId || '',
      name: item.name || item.description1 || item.description || item.label || 'Unnamed',
      code: item.code || item.accountCode || item.companyCode || item.reference || item.id || '',
      entityType: scope === 'Accounts' ? 'Account' : 'Company',
      country: item.country || item.countryCode || '',
      accountCurrency: item.currency || item.currencyCode || item.accountCurrency || '',
      source: 'Kyriba API',
      raw: item,
    }));
    res.json({ entities, endpoint: path });
  } catch (err) {
    next(err);
  }
});

/* POST /api/v1/kyriba/users
   Body: { base_url, authUrl?, client_id?, clientId?, client_secret?, clientSecret?, access_token? } */
router.post('/users', async (req, res, next) => {
  try {
    const cfg = req.body || {};
    const data = await fetchKyribaJsonFromBody('/v1/users', cfg);
    const records = Array.isArray(data) ? data : Object.values(data || {}).find(Array.isArray) || [];
    const users = records.map((item) => ({
      id: item.id || item.userId || item.uuid || item.login || item.email || '',
      name: item.name || item.displayName || item.fullName || item.userName || 'Unnamed',
      login: item.login || item.username || item.userLogin || '',
      email: item.email || item.mail || item.userEmail || '',
      kyribaUserId: item.code || item.id || item.userId || item.uuid || '',
      raw: item,
    }));
    res.json({ users, endpoint: '/v1/users' });
  } catch (err) {
    next(err);
  }
});

/* GET/POST /api/v1/kyriba/user-groups
   Body: { base_url, authUrl?, client_id?, clientId?, client_secret?, clientSecret?, access_token? } */
router.get('/user-groups', async (req, res, next) => {
  try {
    const data = await fetchKyribaJson('/v1/user-groups');
    const records = Array.isArray(data) ? data : Object.values(data || {}).find(Array.isArray) || [];
    const groups = records.map((item) => ({
      id: item.id || item.groupId || item.code || item.name || '',
      name: item.name || item.groupName || item.label || item.code || item.id || 'Unnamed',
      raw: item,
    }));
    res.json({ groups, endpoint: '/v1/user-groups' });
  } catch (err) {
    next(err);
  }
});

router.post('/user-groups', async (req, res, next) => {
  try {
    const cfg = req.body || {};
    const data = await fetchKyribaJsonFromBody('/v1/user-groups', cfg);
    const records = Array.isArray(data) ? data : Object.values(data || {}).find(Array.isArray) || [];
    const groups = records.map((item) => ({
      id: item.id || item.groupId || item.code || item.name || '',
      name: item.name || item.groupName || item.label || item.code || item.id || 'Unnamed',
      raw: item,
    }));
    res.json({ groups, endpoint: '/v1/user-groups' });
  } catch (err) {
    next(err);
  }
});

/* GET /api/v1/kyriba/banks */
router.get('/banks', async (req, res, next) => {
  try {
    const data = await fetchKyribaJson('/v1/banks');
    res.json(data);
  } catch (err) {
    next(err);
  }
});

/* POST /api/v1/kyriba/banks
   Body: { token_url, base_url, client_id, client_secret, scope? } */
router.post('/banks', async (req, res, next) => {
  try {
    const data = await fetchKyribaJsonFromBody('/v1/banks', req.body || {});
    res.json(data);
  } catch (err) {
    next(err);
  }
});

/* POST /api/v1/kyriba/process-templates/run
   Body: { process_template_code, token_url?, base_url, client_id?, client_secret?, scope?, access_token? } */
router.post('/process-templates/run', async (req, res, next) => {
  try {
    const cfg = req.body || {};
    const processTemplateCode = String(cfg.process_template_code || '').trim();
    if (!processTemplateCode) throw new AppError('process_template_code is required', 400);

    const encodedCode = encodeURIComponent(processTemplateCode);
    const result = await postKyribaJsonFromBody(`/v1/process-templates/${encodedCode}/run`, cfg, {});
    let taskId = findTaskIdDeep(result.data);
    if (!taskId && result.taskHeader) taskId = String(result.taskHeader);
    if (!taskId && result.location) {
      const m = result.location.match(/\/([A-Za-z0-9._:-]+)$/);
      if (m) taskId = m[1];
    }

    res.json({
      task_id: taskId || null,
      status: result.status,
      location: result.location || null,
      data: result.data,
    });
  } catch (err) {
    next(err);
  }
});

/* POST /api/v1/kyriba/process-templates/files
   Body: { process_template_code, task_id, token_url?, base_url, client_id?, client_secret?, scope?, access_token? } */
router.post('/process-templates/files', async (req, res, next) => {
  try {
    const cfg = req.body || {};
    const processTemplateCode = String(cfg.process_template_code || '').trim();
    const taskId = String(cfg.task_id || '').trim();
    if (!processTemplateCode) throw new AppError('process_template_code is required', 400);
    if (!taskId) throw new AppError('task_id is required', 400);

    const encodedCode = encodeURIComponent(processTemplateCode);
    const encodedTaskId = encodeURIComponent(taskId);

    const candidatesBase = [
      `/v1/process-templates/${encodedCode}/files?taskId=${encodedTaskId}`,
      `/v1/process-templates/${encodedCode}/files?taskID=${encodedTaskId}`,
      `/v1/process-templates/${encodedCode}/files?taskid=${encodedTaskId}`,
      `/v1/process-templates/files?processTemplateCode=${encodedCode}&taskId=${encodedTaskId}`,
      `/v1/process-templates/files?processTemplateCode=${encodedCode}&taskID=${encodedTaskId}`,
      `/v1/process-templates/files?processTemplateCode=${encodedCode}&taskid=${encodedTaskId}`,
      `/v1/process-templates/${encodedCode}/runs/${encodedTaskId}/files`,
      `/v1/process-templates/${encodedCode}/files/${encodedTaskId}`,
    ];
    const cached = ptFilesEndpointCache.get(processTemplateCode);
    const candidates = cached
      ? [cached, ...candidatesBase.filter((c) => c !== cached)]
      : candidatesBase;

    // Retry rounds handle async availability after run start
    const maxRounds = Number(process.env.PT_FILES_RETRY_ROUNDS || 4);
    const waitMs = Number(process.env.PT_FILES_RETRY_WAIT_MS || 1500);

    let lastErr = null;
    for (let round = 1; round <= maxRounds; round += 1) {
      for (const path of candidates) {
        try {
          const data = await fetchKyribaJsonFromBody(path, cfg);
          ptFilesEndpointCache.set(processTemplateCode, path);
          return res.json({ data, endpoint_used: path, retry_round: round });
        } catch (err) {
          lastErr = err;
          const msg = String(err?.message || '');
          const shouldTryNextPath =
            msg.includes('(404)') ||
            (msg.includes('(400)') && /taskid/i.test(msg)) ||
            msg.includes('not allowed to access this resource');
          if (!shouldTryNextPath) throw err;
        }
      }
      if (round < maxRounds) {
        await sleep(waitMs);
      }
    }

    throw new AppError(
      `Kyriba PT files route not found/readable after ${maxRounds} retries. Tried endpoints: ${candidates.join(' | ')}. Last error: ${lastErr?.message || 'unknown'}`,
      502
    );
  } catch (err) {
    next(err);
  }
});

module.exports = router;
