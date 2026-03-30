/**
 * api.js — lightweight fetch wrapper that:
 *  - Reads VITE_API_URL from env
 *  - Injects Authorization header from localStorage
 *  - Throws on non-2xx with parsed error message
 */

const BASE = import.meta.env.VITE_API_URL || '/api/v1';

function getToken() {
  return localStorage.getItem('bam_token');
}

async function request(method, path, body, isFormData = false) {
  const headers = {};
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (!isFormData) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body
      ? isFormData
        ? body
        : JSON.stringify(body)
      : undefined,
  });

  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

const get  = (path)         => request('GET',    path);
const post = (path, body, isFormData) => request('POST',   path, body, isFormData);
const put  = (path, body)   => request('PUT',    path, body);
const del  = (path, body)   => request('DELETE', path, body);

/* ── Auth ── */
export const authApi = {
  login:    (email, password)  => post('/auth/login', { email, password }),
  register: (payload)          => post('/auth/register', payload),
  me:       ()                 => get('/auth/me'),
};

/* ── Request Types ── */
export const requestTypesApi = {
  list:      (params = {}) => get('/request-types?' + new URLSearchParams(params)),
  get:       (id)          => get(`/request-types/${id}`),
  create:    (body)        => post('/request-types', body),
  update:    (id, body)    => put(`/request-types/${id}`, body),
  delete:    (id)          => del(`/request-types/${id}`),
  deleteBatch: (ids)       => del('/request-types', { ids }),
};

/* ── Document Types ── */
export const documentTypesApi = {
  list:      (params = {}) => get('/document-types?' + new URLSearchParams(params)),
  get:       (id)          => get(`/document-types/${id}`),
  create:    (body)        => post('/document-types', body),
  update:    (id, body)    => put(`/document-types/${id}`, body),
  delete:    (id)          => del(`/document-types/${id}`),
  deleteBatch: (ids)       => del('/document-types', { ids }),
};

/* ── Documentation Rules ── */
export const docRulesApi = {
  list:      (params = {}) => get('/documentation-rules?' + new URLSearchParams(params)),
  get:       (id)          => get(`/documentation-rules/${id}`),
  create:    (body)        => post('/documentation-rules', body),
  update:    (id, body)    => put(`/documentation-rules/${id}`, body),
  delete:    (id)          => del(`/documentation-rules/${id}`),
  deleteBatch: (ids)       => del('/documentation-rules', { ids }),
  reorder:   (request_type_id, ordered_ids) =>
                             post('/documentation-rules/reorder', { request_type_id, ordered_ids }),
};

/* ── Document Managers ── */
export const docManagersApi = {
  list:    (params = {}) => get('/document-managers?' + new URLSearchParams(params)),
  get:     (id)          => get(`/document-managers/${id}`),
  create:  (body)        => post('/document-managers', body),
  update:  (id, body)    => put(`/document-managers/${id}`, body),
  delete:  (id)          => del(`/document-managers/${id}`),
  deleteBatch: (ids)     => del('/document-managers', { ids }),
};

/* ── Entities ── */
export const entitiesApi = {
  list:    (params = {}) => get('/entities?' + new URLSearchParams(params)),
  get:     (id)          => get(`/entities/${id}`),
  create:  (body)        => post('/entities', body),
  update:  (id, body)    => put(`/entities/${id}`, body),
  delete:  (id)          => del(`/entities/${id}`),
  import:  (entities)    => post('/entities/import', { entities }),
};

/* ── Entity Documents ── */
export const entityDocsApi = {
  list:    (params = {}) => get('/entity-documents?' + new URLSearchParams(params)),
  upload:  (formData)    => post('/entity-documents', formData, true),
  update:  (id, body)    => put(`/entity-documents/${id}`, body),
  delete:  (id)          => del(`/entity-documents/${id}`),
};

/* ── Document Requirements ── */
export const requirementsApi = {
  list:           (params = {})          => get('/document-requirements?' + new URLSearchParams(params)),
  create:         (body)                 => post('/document-requirements', body),
  linkDocument:   (reqId, documentId)    => put(`/document-requirements/${reqId}/link-document`, { document_id: documentId }),
  refreshStatuses: ()                    => post('/document-requirements/refresh-statuses'),
};

/* ── Notifications ── */
export const notificationsApi = {
  list:   (params = {}) => get('/notifications?' + new URLSearchParams(params)),
  send:   (body)        => post('/notifications', body),
};

/* ── API Integrations ── */
export const apiIntegrationsApi = {
  list:   ()       => get('/api-integrations'),
  get:    (id)     => get(`/api-integrations/${id}`),
  create: (body)   => post('/api-integrations', body),
  update: (id, b)  => put(`/api-integrations/${id}`, b),
  delete: (id)     => del(`/api-integrations/${id}`),
  test:   (id)     => post(`/api-integrations/${id}/test`),
  sync:   (id)     => post(`/api-integrations/${id}/sync`),
};
