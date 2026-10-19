import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../package.json'));
const { parse } = require('pg-connection-string');

/** Pure validation, no connection. Never include credentials/DSN in diagnostics. */
export function assertIsolatedDatabase(connectionString) {
  assert.equal(typeof connectionString, 'string', 'Explicit isolated database URL required');
  const url = new URL(connectionString);
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol), 'PostgreSQL protocol required');
  assert.equal(url.hostname, '127.0.0.1', 'Only the exact isolated IPv4 host is allowed');
  assert.equal(url.port, '55440', 'Only the scaled isolated database port is allowed');
  assert.equal(url.pathname, '/alfa_queue_scaled', 'Only the scaled isolated database name is allowed');
  assert.equal(url.search, '', 'Database routing/options query parameters are prohibited');
  assert.equal(url.hash, '', 'Database URL fragments are prohibited');
  // This is the installed parser used by pg; query options must never override URL routing.
  const resolved = parse(connectionString);
  assert.equal(resolved.host, '127.0.0.1', 'Driver resolved a non-isolated host');
  assert.equal(String(resolved.port), '55440', 'Driver resolved a non-isolated port');
  assert.equal(resolved.database, 'alfa_queue_scaled', 'Driver resolved a non-isolated database');
  return { host: resolved.host, port: Number(resolved.port), database: resolved.database };
}
