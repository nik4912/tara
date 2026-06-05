import express from 'express';
import * as dotenv from 'dotenv';
import askRouter from './routes/ask';

// Allow self-signed / corporate-proxy certificates in non-production envs.
// This is needed on networks that intercept TLS (corporate proxies, VPNs).
if (process.env.NODE_ENV !== 'production') {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT ?? 3000);

// ── Middleware ────────────────────────────────────────────────────────────────

app.use(express.json({ limit: '1mb' }));

// CORS – allow Vercel frontend + local dev
const ALLOWED_ORIGINS = [
  'https://tara-gamma.vercel.app',
  'http://localhost:3001',
  'http://localhost:5173',
];

app.use((req, res, next) => {
  const origin = req.headers.origin ?? '';
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

// API Key auth – protects /ask (skip for /health and OPTIONS preflight)
app.use((req, res, next) => {
  const configuredKey = process.env.API_KEY;
  if (!configuredKey || req.path === '/health' || req.method === 'OPTIONS') {
    next();
    return;
  }
  const provided = req.headers['x-api-key'];
  if (provided !== configuredKey) {
    res.status(401).json({ error: 'Unauthorized: invalid or missing x-api-key' });
    return;
  }
  next();
});

// Request logger – logs method + path for each request
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ── Routes ────────────────────────────────────────────────────────────────────

app.use('/', askRouter);

// Health check endpoint
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    agent: 'Tara',
    timestamp: new Date().toISOString(),
  });
});

// Catch-all 404
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ── Global error handler ──────────────────────────────────────────────────────

app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error('[server] Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
);

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n🤖 Tara Finance Agent is running`);
  console.log(`   POST http://localhost:${PORT}/ask`);
  console.log(`   GET  http://localhost:${PORT}/health\n`);
});

export default app;
