import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './paths.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const minLevel = LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info;
const fileLogging = process.env.CLK_LOG_FILE !== '0' && process.env.NODE_ENV !== 'test';
const quiet = process.env.CLK_QUIET === '1';

const recent = [];
let stream = null;
let streamFailed = false;

function getStream() {
  if (!fileLogging || streamFailed) return null;
  if (stream) return stream;
  try {
    const dir = path.join(DATA_DIR, 'logs');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'app.log');
    // Simple rotation: keep one old file once the log passes 5 MB.
    try {
      if (fs.statSync(file).size > 5 * 1024 * 1024) fs.renameSync(file, file + '.1');
    } catch { /* file does not exist yet */ }
    stream = fs.createWriteStream(file, { flags: 'a' });
    stream.on('error', () => { streamFailed = true; stream = null; });
    return stream;
  } catch {
    streamFailed = true;
    return null;
  }
}

function fmt(value) {
  if (value instanceof Error) return value.stack || value.message;
  if (typeof value === 'string') return value;
  try {
    const s = JSON.stringify(value);
    return s && s.length > 2000 ? s.slice(0, 2000) + '…' : s;
  } catch {
    return String(value);
  }
}

function write(level, scope, args) {
  if (LEVELS[level] < minLevel) return;
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${args.map(fmt).join(' ')}`;
  recent.push({ level, line });
  if (recent.length > 500) recent.shift();
  if (!quiet) {
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  }
  const s = getStream();
  if (s) s.write(line + '\n');
}

export function createLogger(scope) {
  return {
    debug: (...a) => write('debug', scope, a),
    info: (...a) => write('info', scope, a),
    warn: (...a) => write('warn', scope, a),
    error: (...a) => write('error', scope, a),
  };
}

/** Last log lines for the dashboard (newest last). */
export function recentLogs(limit = 200, minLevelName = 'debug') {
  const min = LEVELS[minLevelName] ?? 0;
  return recent.filter((r) => LEVELS[r.level] >= min).slice(-limit).map((r) => r.line);
}
