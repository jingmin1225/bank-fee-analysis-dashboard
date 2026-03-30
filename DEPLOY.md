# BAM Documentation Manager — Deployment Guide
# Stack: Supabase (Postgres) · Render (API) · Netlify (Frontend)
# Estimated time: ~30 minutes

═══════════════════════════════════════════════════════
STEP 1 — PUSH PROJECT TO GITHUB
═══════════════════════════════════════════════════════

1. Go to https://github.com/new
   - Repository name: bam-documentation-manager
   - Visibility: Private ✓
   - Click "Create repository"

2. In your terminal, from the bam-app folder:

   git init
   git add .
   git commit -m "Initial BAM app"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/bam-documentation-manager.git
   git push -u origin main


═══════════════════════════════════════════════════════
STEP 2 — SET UP SUPABASE (Free tier — no credit card)
═══════════════════════════════════════════════════════

1. Go to https://supabase.com → "Start your project" → sign in with GitHub

2. Click "New project"
   - Name:     bam-production
   - Database password: generate a strong one and SAVE IT
   - Region:   West EU (Ireland) — closest to France
   - Click "Create new project" (takes ~2 min)

3. Get your connection string:
   - Left sidebar → Settings → Database
   - Under "Connection string" tab → select "URI"
   - Copy the string — it looks like:
     postgresql://postgres:[YOUR-PASSWORD]@db.xxxxxxxxxxxx.supabase.co:5432/postgres
   - SAVE THIS — you'll need it in Steps 3 and 4

4. Run migrations against Supabase:
   - In your terminal, from bam-app/backend:

   cp .env.example .env
   # Edit .env and paste your Supabase DATABASE_URL
   # Also set JWT_SECRET to any long random string

   npm install
   npm run migrate
   npm run seed

   You should see:
     ✅  Migrations complete
     ✅  Seed complete

5. Verify in Supabase:
   - Left sidebar → Table Editor
   - You should see all tables: users, request_types, document_types, etc.


═══════════════════════════════════════════════════════
STEP 3 — DEPLOY BACKEND TO RENDER
═══════════════════════════════════════════════════════

1. Go to https://render.com → Sign up with GitHub

2. Click "New +" → "Web Service"

3. Connect your GitHub repo: bam-documentation-manager
   - Click "Connect" next to your repo

4. Fill in the settings:
   - Name:            bam-api
   - Region:          Frankfurt (EU Central)
   - Branch:          main
   - Root Directory:  backend
   - Runtime:         Node
   - Build Command:   npm install
   - Start Command:   npm start
   - Plan:            Free (to start) or Starter ($7/mo for always-on)

5. Add Environment Variables (click "Add Environment Variable" for each):

   Key                Value
   ───────────────────────────────────────────────────
   NODE_ENV           production
   PORT               4000
   DATABASE_URL       [paste your Supabase URI from Step 2]
   JWT_SECRET         [generate: openssl rand -hex 64]
   JWT_EXPIRES_IN     7d
   STORAGE_DRIVER     local
   UPLOAD_DIR         ./uploads
   CORS_ORIGINS       https://your-app.netlify.app   ← update after Step 4

6. Click "Create Web Service"
   - Render will build and deploy (takes ~3-4 min first time)
   - You'll get a URL like: https://bam-api.onrender.com

7. Test it:
   curl https://bam-api.onrender.com/health
   # Should return: {"status":"ok","ts":"..."}

   curl -X POST https://bam-api.onrender.com/api/v1/auth/login \
     -H "Content-Type: application/json" \
     -d '{"email":"admin@bam.local","password":"Admin1234!"}'
   # Should return a JWT token


═══════════════════════════════════════════════════════
STEP 4 — DEPLOY FRONTEND TO NETLIFY
═══════════════════════════════════════════════════════

1. Go to https://netlify.com → Sign up with GitHub

2. Click "Add new site" → "Import an existing project"

3. Connect GitHub → select your bam-documentation-manager repo

4. Build settings (Netlify auto-detects from netlify.toml):
   - Base directory:  frontend
   - Build command:   npm run build
   - Publish dir:     frontend/dist

5. Add Environment Variable:
   - Click "Add environment variable"
   - Key:   VITE_API_URL
   - Value: https://bam-api.onrender.com/api/v1

6. Click "Deploy site"
   - Takes ~2 min
   - You'll get a URL like: https://amazing-name-123.netlify.app
   - Optional: set a custom domain in Site settings → Domain management

7. Go BACK to Render → your bam-api service → Environment:
   - Update CORS_ORIGINS to your actual Netlify URL:
     https://amazing-name-123.netlify.app
   - Click "Save Changes" — Render will redeploy automatically


═══════════════════════════════════════════════════════
STEP 5 — VERIFY END-TO-END
═══════════════════════════════════════════════════════

1. Open your Netlify URL
2. Log in with:   admin@bam.local / Admin1234!
3. Check all pages load and data appears
4. Create a test Request Type and verify it persists on refresh


═══════════════════════════════════════════════════════
STEP 6 — CONNECT FRONTEND TO REAL API  (wire the app)
═══════════════════════════════════════════════════════

The frontend currently uses the hardcoded demo data object.
To wire it to the real API, replace the data calls at the top of
bam-documentation-manager.html with fetch calls using src/api.js.

Example swap for Request Types:

  BEFORE (demo data):
    const rows = data['request-types'];

  AFTER (real API):
    import { requestTypesApi } from './src/api.js';
    const { data: rows } = await requestTypesApi.list({ page: 1, limit: 50 });

All API functions are in:  frontend/src/api.js


═══════════════════════════════════════════════════════
STEP 7 — OPTIONAL UPGRADES
═══════════════════════════════════════════════════════

A) Custom domain
   Netlify: Site settings → Domain management → Add custom domain
   Render:  Settings → Custom Domains → Add custom domain
   Use Cloudflare for DNS (free SSL, fast CDN)

B) File storage on S3 (instead of local disk)
   1. Create an S3 bucket in AWS Console (eu-west-1 for EU)
   2. Create an IAM user with s3:PutObject / s3:GetObject on that bucket
   3. In Render env vars, set:
      STORAGE_DRIVER=s3
      AWS_ACCESS_KEY_ID=...
      AWS_SECRET_ACCESS_KEY=...
      AWS_REGION=eu-west-1
      AWS_S3_BUCKET=bam-documents
   4. npm install @aws-sdk/client-s3  (already in upload.js, just needs the SDK)

C) Scheduled status refresh
   Render: create a "Cron Job" service pointing to:
   POST https://bam-api.onrender.com/api/v1/document-requirements/refresh-statuses
   Run: 0 6 * * *  (every day at 6am UTC)

D) Upgrade Render plan
   Free plan sleeps after 15 min of inactivity (cold start ~30s)
   Starter plan ($7/mo) keeps the service always-on

E) Supabase Row Level Security (RLS)
   For production, enable RLS on sensitive tables:
   Supabase dashboard → Authentication → Policies
   This ensures users can only see their own documents


═══════════════════════════════════════════════════════
DEMO ACCOUNTS (seeded by npm run seed)
═══════════════════════════════════════════════════════

Role               Email                    Password
─────────────────────────────────────────────────────
Admin              admin@bam.local          Admin1234!
Treasurer          treasurer@bam.local      User1234!
Document Manager   manager@bam.local        User1234!
Individual/Signer  signer@bam.local         User1234!


═══════════════════════════════════════════════════════
ARCHITECTURE SUMMARY
═══════════════════════════════════════════════════════

  [Browser]
      │  HTTPS
      ▼
  [Netlify CDN]  ← React/HTML frontend (static)
      │  HTTPS (CORS allowed)
      ▼
  [Render Web Service]  ← Node/Express API (bam-api)
      │  SSL (pg driver)
      ▼
  [Supabase]  ← PostgreSQL database
      │
  [Local disk / S3]  ← Document file storage


═══════════════════════════════════════════════════════
COST SUMMARY (EUR/month)
═══════════════════════════════════════════════════════

  Supabase Free:   €0   (500MB DB, 1GB storage)
  Render Free:     €0   (sleeps after inactivity)
  Netlify Free:    €0   (100GB bandwidth)
  ─────────────────────
  Total dev/demo:  €0/month

  For always-on production:
  Render Starter:  ~€7/month
  Supabase Pro:    ~€25/month (if you need >500MB or SLA)
