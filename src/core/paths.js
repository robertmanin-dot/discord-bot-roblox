import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Project root (two levels above src/core).
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Tests (and power users) can point data and .env somewhere else.
export const DATA_DIR = process.env.CLK_DATA_DIR
  ? path.resolve(process.env.CLK_DATA_DIR)
  : path.join(ROOT, 'data');

export const ENV_PATH = process.env.CLK_ENV_PATH
  ? path.resolve(process.env.CLK_ENV_PATH)
  : path.join(ROOT, '.env');

export const PUBLIC_DIR = path.join(ROOT, 'src', 'web', 'public');
export const DOCS_DIR = path.join(ROOT, 'docs');
