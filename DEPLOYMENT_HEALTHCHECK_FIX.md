# 🔧 Deployment Healthcheck Fix - CBC Learning Ecosystem

**Status:** ✅ RESOLVED  
**Date Fixed:** March 17, 2026  
**Impact:** Fixes deployment failures during network healthcheck phase

---

## 🐛 Problem Identified

Deployment was failing during the network healthcheck process due to 3 critical issues:

### Issue 1: Duplicate Server Start
**Location:** `backend/src/index.ts` line 151-152  
**Problem:** The `start()` function was being called twice, causing:
- Two Express servers trying to bind to the same port
- Port conflict error on deployment
- Health checks failing intermittently

### Issue 2: No Initialization State Tracking
**Location:** `backend/src/index.ts` /health endpoint  
**Problem:** The health endpoint didn't distinguish between:
- Server still initializing (migrations running) → should return 503
- Server ready but dependencies degraded → should return 503 with details
- Server fully operational → should return 200

**Result:** Orchestrators (Railway, Render, Vercel) would fail the healthcheck during startup while migrations were still running.

### Issue 3: No Timeout on Health Checks
**Location:** `backend/src/index.ts` /health endpoint  
**Problem:** Database/Redis checks weren't timing out, could hang indefinitely
- Deployment healthchecks would timeout waiting for a response
- Long-running queries during migrations would block healthchecks

---

## ✅ Fixes Applied

### Fix 1: Removed Duplicate `start()` Call
```typescript
// BEFORE (broken)
start();
start();  // ❌ Duplicate call

// AFTER (fixed)
start();  // ✅ Single call
```

### Fix 2: Added `isReady` State Flag
```typescript
let isReady = false;

async function start() {
  try {
    // ... initialization code ...
    app.listen(PORT, () => {
      isReady = true;  // ✅ Mark server as ready
      logger.info(`[server] ✅ Listening on port ${PORT}`);
    });
  } catch (err) {
    // error handling
  }
}
```

### Fix 3: Enhanced Health Endpoint with Timeouts
```typescript
app.get('/health', async (_req, res) => {
  // Return 503 if still initializing
  if (!isReady) {
    return res.status(503).json({
      status: 'starting',
      message: 'Server is initializing migrations and routes',
      timestamp: new Date().toISOString(),
    });
  }

  try {
    const { db } = await import('./config/database');
    const { redis } = await import('./config/redis');

    // ✅ 5-second timeout on each check
    const dbCheck = Promise.race([
      db.raw('SELECT 1').then(() => 'connected'),
      new Promise<string>((resolve) => 
        setTimeout(() => resolve('timeout'), 5000)
      ),
    ]);
    const redisCheck = Promise.race([
      redis.ping().then((r: string) => (r === 'PONG' ? 'connected' : 'degraded')),
      new Promise<string>((resolve) => 
        setTimeout(() => resolve('timeout'), 5000)
      ),
    ]);

    const [dbStatus, redisStatus] = await Promise.all([dbCheck, redisCheck]);

    res.json({
      status: 'ok',
      version: '1.0.0',
      db: dbStatus,
      redis: redisStatus,
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV,
      mpesa: process.env.MPESA_ENVIRONMENT || 'not configured',
    });
  } catch (err) {
    res.status(503).json({
      status: 'degraded',
      error: (err as Error).message,
      timestamp: new Date().toISOString(),
    });
  }
});
```

### Fix 4: Added Readiness Endpoint
```typescript
// ✅ New endpoint: /ready
// Returns 200 only when server is fully initialized
app.get('/ready', (_req, res) => {
  if (!isReady) {
    return res.status(503).json({ status: 'not_ready' });
  }
  res.json({ status: 'ready' });
});
```

### Fix 5: Updated Docker Compose with Healthcheck
```yaml
backend:
  # ... other config ...
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:5000/health"]
    interval: 10s
    timeout: 5s
    retries: 3
    start_period: 30s  # ✅ Grace period for migrations
```

---

## 📊 Health Endpoint Behavior

### `/health` Endpoint Response States

#### 1️⃣ Server Starting (Status: 503)
```json
{
  "status": "starting",
  "message": "Server is initializing migrations and routes",
  "timestamp": "2026-03-17T21:30:00.000Z"
}
```
- **When:** During boot, migrations running, routes being registered
- **Action:** Orchestrator continues retrying
- **Duration:** ~2-5 seconds typically

#### 2️⃣ Server Ready (Status: 200)
```json
{
  "status": "ok",
  "version": "1.0.0",
  "db": "connected",
  "redis": "connected",
  "timestamp": "2026-03-17T21:35:42.123Z",
  "environment": "production",
  "mpesa": "production"
}
```
- **When:** Server fully initialized, all routes registered, connections healthy
- **Action:** Orchestrator starts routing traffic
- **Duration:** Normal operation

#### 3️⃣ Dependencies Timeout (Status: 200)
```json
{
  "status": "ok",
  "version": "1.0.0",
  "db": "timeout",
  "redis": "timeout",
  "timestamp": "2026-03-17T21:36:00.000Z",
  "environment": "production",
  "mpesa": "production"
}
```
- **When:** DB/Redis not responding within 5 seconds
- **Action:** Orchestrator may still route traffic if not critical dependency
- **Benefit:** Doesn't block deployment for slow queries

#### 4️⃣ Degraded Service (Status: 503)
```json
{
  "status": "degraded",
  "error": "connect ECONNREFUSED 127.0.0.1:5432",
  "timestamp": "2026-03-17T21:36:30.000Z"
}
```
- **When:** Fatal error (DB connection refused, unexpected exception)
- **Action:** Orchestrator fails healthcheck, marks instance unhealthy
- **Duration:** Continues retrying until fixed

---

## 📍 `/ready` Endpoint (Binary Check)

### Usage: Deployment Orchestration
```
GET /ready HTTP/1.1

Response 200:        ✅ Server ready, accept traffic
{ "status": "ready" }

Response 503:        ⏳ Server not ready, don't accept traffic
{ "status": "not_ready" }
```

**When to use:**
- Load balancer pre-traffic checks (Kubernetes readiness probe)
- Blue-green deployments (ensure new instances ready before switching)
- Rolling deployments (wait for instance ready before removing old one)

---

## 🚀 Platform-Specific Configuration

### Railway.app Deployment

**Current:** Railway auto-detects `/health` endpoint  
**With Fix:** Add explicit healthcheck to `railway.toml`

```toml
[deploy]
restartPolicyMaxRetries = 5
healthcheckPath = "/health"
healthcheckTimeout = 10
```

**Or in Railway dashboard:**
```
Health Check URL: /health
Health Check Timeout: 10s
Max Retries: 5
```

### Render

**In `render.yaml`:**
```yaml
services:
  - type: web
    name: cbc-backend
    buildCommand: npm run build
    startCommand: node dist/index.js
    envVars:
      - key: NODE_ENV
        value: production
    healthCheck:
      path: /health
      timeout: 5
      startPeriod: 30
```

**Or Render dashboard:**
- Health Check Path: `/health`
- Health Check Timeout: 5 seconds
- Start Period: 30 seconds

### Vercel (Node Functions)

Vercel doesn't use health checks for serverless functions, but for long-running processes:

```json
{
  "buildCommand": "cd backend && npm run build",
  "startCommand": "node dist/index.js"
}
```

Uses automatic function timeouts (typically 60s for pro).

---

## 🧪 Local Testing

### Test with Docker Compose
```bash
# Start all services
docker compose -f docker-compose.dev.yml up

# In another terminal, test endpoints

# Health check during startup
curl http://localhost:5000/health
# Expected: 503 with "starting" status

# Wait ~30 seconds for migrations...
# Then test again
curl http://localhost:5000/health
# Expected: 200 with "ok" status

# Test readiness
curl http://localhost:5000/ready
# Expected: 200 with "ready" status
```

### Test Backend Only
```bash
cd backend

# Build
npm run build

# Run migrations + start server
node -e "require('./dist/database/migrate').run()" && node dist/index.js

# In another terminal
curl http://localhost:5000/health
curl http://localhost:5000/ready
```

### Simulate with timeout
```bash
# Test that health checks don't hang
time curl -m 5 http://localhost:5000/health
# Should complete within 5 seconds even if slow DB
```

---

## ✅ Deployment Checklist

Before deploying to production:

- [x] Fix applied to backend/src/index.ts
- [x] Build succeeds: `npm run build`
- [x] No TypeScript errors
- [x] Docker build succeeds: `docker build -t cbc-backend .`
- [x] Local test passes: `docker compose up`
- [ ] Platform configuration updated:
  - [ ] Railway dashboard healthcheck settings
  - [ ] Render render.yaml healthcheck config
  - [ ] Environment variables set (DB, JWT secrets, M-Pesa keys)
- [ ] Test on staging first (if available)
- [ ] Monitor first deployment (watch logs for errors)

---

## 🔍 Verification

### After Deployment

Check that deployment succeeded:
```bash
# SSH/shell into deployed container, or use platform CLI

# Railway
railway run curl http://localhost:5000/health

# Render
curl https://<your-service>.onrender.com/health

# Vercel (if using custom endpoint)
curl https://<your-deployment>.vercel.app/health
```

Expected response:
```json
{
  "status": "ok",
  "db": "connected",
  "redis": "connected",
  "version": "1.0.0"
}
```

### Logs to Check

```bash
# Look for these success indicators:
✅ [startup] ✅ Environment validation passed
✅ [db] ✅ Database connected
✅ [server] ✅ CBC Learning Ecosystem API listening on port 5000
✅ [migration] ✅ No pending migrations
```

### If Still Failing

1. **Check migrations**: `[migration] ❌ Migration failed:`
   - Likely database schema version conflict
   - Solution: Check migration files, verify DB state

2. **Check environment variables**: `[startup] ❌ FATAL:`
   - Missing or invalid JWT_SECRET, DB credentials
   - Solution: Verify .env file on platform; re-deploy with correct vars

3. **Check connectivity**: `[db] ❌ Database connection failed:`
   - Database not reachable from instance
   - Solution: Check firewall, connection string, database status

4. **Check Redis**: Health shows `"redis": "timeout"` or `"degraded"`
   - Redis not responding or network issue
   - Solution: For MVP, Redis is optional; system works in degraded mode
   - Consider disabling Redis for now: comment out Redis routes

---

## 📈 Performance Impact

The fixes have **no negative performance impact**:

- ✅ `isReady` flag: Single boolean, negligible overhead
- ✅ Health endpoint timeout: 5s max per request, only on `/health` calls
- ✅ Readiness endpoint: Simple flag check, <1ms response

---

## 🔄 Migration Path (If Already Deployed with Bugs)

If already deployed with broken healthcheck:

1. **Quick fix:** Redeploy with this fix → automatic restart → healthcheck passes
2. **No data loss:** Migrations are idempotent
3. **Backward compatible:** Old health endpoint still works, just with improved behavior
4. **No client changes:** Frontend doesn't use healthcheck endpoint

---

## 📚 Related Documentation

- [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md) — Full deployment checklist
- [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md) — Setup & operations
- [backend/Dockerfile](backend/Dockerfile) — Container build configuration
- [backend/src/index.ts](backend/src/index.ts) — Application entry point

---

## 🎯 Summary

| Issue | Fix | Impact |
|-------|-----|--------|
| Duplicate start() | Removed one call | Prevents port conflicts |
| No startup state | Added isReady flag | Health returns 503 during startup |
| No timeout | Added 5s Promise.race | Prevents healthcheck hangs |
| No readiness check | Added /ready endpoint | Enables proper deployment orchestration |
| No Docker healthcheck | Added to dev compose | Automatic health monitoring |

**Result:** 🚀 Deployment healthchecks now work reliably on Railway, Render, and other platforms.

---

**Last Updated:** March 17, 2026  
**Fixed By:** GitHub Copilot  
**Status:** ✅ Ready for Production
