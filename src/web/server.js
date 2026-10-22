// Express app for the dashboard (static UI in ./public, JSON API under /api).
import crypto from 'node:crypto';
import path from 'node:path';
import express from 'express';
import { PUBLIC_DIR } from '../core/paths.js';
import { env, host } from '../core/config.js';
import { createLogger } from '../core/log.js';
import systemRoutes from './routes/system.js';
import radarRoutes from './routes/radar.js';
import discordRoutes from './routes/discord.js';
import playtestRoutes from './routes/playtests.js';

const log = createLogger('web');
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/** Optional password (DASHBOARD_PASSWORD). Any user name works. */
function basicAuth(req, res, next) {
  const password = env('DASHBOARD_PASSWORD');
  if (!password) return next();
  const [scheme, encoded] = String(req.headers.authorization || '').split(' ');
  if (scheme === 'Basic' && encoded) {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const pass = decoded.slice(decoded.indexOf(':') + 1);
    if (safeEqual(pass, password)) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="Creator Launch Kit", charset="UTF-8"');
  res.status(401).send('Passwort erforderlich');
}

/**
 * Without a password the dashboard only answers to localhost (protects against DNS rebinding).
 * Changing requests must carry the header "X-CLK: 1" (blocks cross-site form posts / CSRF).
 */
function guard(req, res, next) {
  if (!env('DASHBOARD_PASSWORD')) {
    const hostname = String(req.hostname || '').toLowerCase();
    const configured = host().toLowerCase();
    if (!LOCAL_HOSTNAMES.has(hostname) && hostname !== configured) {
      return res.status(403).send('Zugriff nur über localhost. Für Zugriff von außen DASHBOARD_PASSWORD setzen.');
    }
  }
  if (req.path.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('x-clk') !== '1') {
    return res.status(403).json({ error: 'Fehlender Header X-CLK.' });
  }
  next();
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);
  app.use(basicAuth);
  app.use(guard);
  app.use(express.json({ limit: '10mb' }));

  app.use('/api', systemRoutes(), radarRoutes(), discordRoutes(), playtestRoutes());
  app.use('/api', (req, res) => res.status(404).json({ error: `Unbekannter API-Endpunkt: ${req.method} ${req.originalUrl}` }));

  app.get('/capture', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'capture.html')));
  app.use(express.static(PUBLIC_DIR, { index: 'index.html', extensions: ['html'] }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || err.statusCode || 500;
    if (status === 503) log.warn(`${req.method} ${req.originalUrl}: ${err.message}`);
    else if (status >= 500) log.error(`${req.method} ${req.originalUrl}:`, err);
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Ungültiges JSON.' });
    res.status(status).json({ error: err.message || 'Unbekannter Fehler' });
  });
  return app;
}
