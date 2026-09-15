# FleetSync — PostgreSQL via Docker
# Run these commands one at a time after Docker Desktop is running

# ── 1. Start a PostgreSQL container ─────────────────────────────────────
docker run -d `
  --name fleetsync-db `
  -e POSTGRES_USER=postgres `
  -e POSTGRES_PASSWORD=fleetsync123 `
  -e POSTGRES_DB=fleetsync `
  -p 5432:5432 `
  postgres:16-alpine

# ── 2. Verify it's running ───────────────────────────────────────────────
docker ps

# ── 3. Push Prisma schema ────────────────────────────────────────────────
cd C:\Users\USER\Desktop\dev_drik\FleetSync\backend
node node_modules/prisma/build/index.js db push

# ── 4. Seed demo data ────────────────────────────────────────────────────
node src/db/seed.js

# ── 5. Start the API server ──────────────────────────────────────────────
node src/index.js
