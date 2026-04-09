require('dotenv').config();
const express  = require('express');
const helmet   = require('helmet');
const cors     = require('cors');
const morgan   = require('morgan');
const path     = require('path');

const { errorHandler } = require('./middleware/errorHandler');
const authRoutes        = require('./routes/auth');
const requestTypeRoutes = require('./routes/requestTypes');
const documentTypeRoutes= require('./routes/documentTypes');
const docRuleRoutes     = require('./routes/documentationRules');
const docManagerRoutes  = require('./routes/documentManagers');
const entityRoutes      = require('./routes/entities');
const entityDocRoutes   = require('./routes/entityDocuments');
const requirementRoutes = require('./routes/documentRequirements');
const notificationRoutes= require('./routes/notifications');
const workspaceRoutes   = require('./routes/workspaces');
const apiIntegRoutes    = require('./routes/apiIntegrations');
const kyribaProxyRoutes = require('./routes/kyribaProxy');

const app  = express();
const PORT = process.env.PORT || 4000;

/* ── Security & parsing ── */
app.use(helmet());
const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || origin === 'null') return cb(null, true); // supports file:// local HTML
    if (allowedOrigins.length === 0 || allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error(`CORS blocked for origin: ${origin}`));
  },
  credentials: true,
}));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ── Static uploads (local storage mode) ── */
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

/* ── Health check ── */
app.get('/health', (req, res) => res.json({ status: 'ok', ts: new Date() }));

/* ── API routes ── */
const api = '/api/v1';
app.use(`${api}/auth`,                 authRoutes);
app.use(`${api}/request-types`,        requestTypeRoutes);
app.use(`${api}/document-types`,       documentTypeRoutes);
app.use(`${api}/documentation-rules`,  docRuleRoutes);
app.use(`${api}/document-managers`,    docManagerRoutes);
app.use(`${api}/entities`,             entityRoutes);
app.use(`${api}/entity-documents`,     entityDocRoutes);
app.use(`${api}/document-requirements`,requirementRoutes);
app.use(`${api}/notifications`,        notificationRoutes);
app.use(`${api}/workspaces`,           workspaceRoutes);
app.use(`${api}/api-integrations`,     apiIntegRoutes);
app.use(`${api}/kyriba`,               kyribaProxyRoutes);
app.use('/api/kyriba',                 kyribaProxyRoutes);

/* ── 404 ── */
app.use((req, res) => res.status(404).json({ error: 'Route not found' }));

/* ── Error handler ── */
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`BAM API running on http://localhost:${PORT}`);
});

module.exports = app;
