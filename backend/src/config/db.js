const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL client error:', err);
});

/* Helper: run a query and return rows */
async function query(text, params) {
  const start = Date.now();
  const res   = await pool.query(text, params);
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[DB] ${Date.now() - start}ms — ${text.slice(0, 80)}`);
  }
  return res;
}

/* Helper: get a dedicated client for transactions */
async function getClient() {
  const client = await pool.connect();
  const origQuery   = client.query.bind(client);
  const origRelease = client.release.bind(client);
  const timeout = setTimeout(() => {
    console.error('Client checked out for >5s — possible leak');
  }, 5000);
  client.release = () => { clearTimeout(timeout); origRelease(); };
  return client;
}

module.exports = { pool, query, getClient };
