# USAIPO — Railway DB Setup Runbook
*Pre-staged by Pip, 2026-02-19 nightly build. Ready to run at 1pm 2026-02-20.*

## What This Does
Provisions a Postgres + pgvector DB on Railway, migrates the 4 existing inventions from JSON, and wires the DATABASE_URL into Vercel so the live site (`usaipo-vercel.vercel.app`) can actually read/write inventions.

## Prerequisites
- Railway CLI installed and authenticated (`railway login`)
- Vercel CLI authenticated (already done as smcronin)
- This repo: `/home/seth/clawd/usaipo-vercel/`

---

## Step 1 — Install Railway CLI (if needed)
```bash
npm install -g @railway/cli
railway login
# Opens browser → authenticate with GitHub
```

## Step 2 — Create Railway Project + Postgres
```bash
cd /home/seth/clawd/usaipo-vercel

# Create new project
railway init --name usaipo

# Add Postgres plugin (includes pgvector)
railway add --plugin postgresql
```

Railway will provision the DB and set `DATABASE_URL` in the project environment automatically.

## Step 3 — Get the DATABASE_URL
```bash
railway variables --json | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('DATABASE_URL',''))"
```

Copy the `postgres://...` URL. You'll need it for step 5.

## Step 4 — Run the Migration
```bash
cd /home/seth/clawd/usaipo-vercel

# Set the URL and run migration
DATABASE_URL="<paste from step 3>" node scripts/migrate-to-postgres.js
```

Expected output:
```
Table created
Inserted USAIPO-000004: Inference Identity...
Inserted USAIPO-000002: Recursive Context Window Optimization...
Inserted USAIPO-000003: ...
Inserted USAIPO-000001: ...
Migration complete: 4 inventions
```

## Step 5 — Set DATABASE_URL in Vercel
```bash
cd /home/seth/clawd/usaipo-vercel

# Set the env var (production + preview)
vercel env add DATABASE_URL production
# Paste the URL when prompted

vercel env add DATABASE_URL preview
# Paste again

# Redeploy to pick up the env var
vercel --prod
```

## Step 6 — Test It
```bash
# Should return 4 inventions
curl https://usaipo-vercel.vercel.app/api/inventions | python3 -m json.tool | head -30

# Stats
curl https://usaipo-vercel.vercel.app/api/stats
```

## Step 7 — Connect Repo to Railway (Optional but nice)
```bash
# Link repo for Railway dashboard visibility
railway link

# Can also run migrations from Railway dashboard going forward
```

---

## What's Already Done (Don't Redo)
- ✅ `@neondatabase/serverless` package installed (Railway uses same protocol)
- ✅ Migration script: `scripts/migrate-to-postgres.js`
- ✅ Inventory JSON export: `data/inventions.json` (4 inventions)
- ✅ API routes: `/api/inventions`, `/api/stats`, `/api/inventions/[filing_number]`
- ✅ Frontend already uses relative API paths (no hardcoded URLs to change)
- ✅ GitHub → Vercel auto-deploy connected

## After This Is Done
- [ ] Point `usaipo.org` domain → Vercel (Vercel dashboard → Domains → Add)
- [ ] End-to-end test: file a new invention via the website form
- [ ] Test semantic search when pgvector extension is enabled
