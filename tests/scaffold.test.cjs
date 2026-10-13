const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appDir = path.join(__dirname, '..');

test('package manifest exposes the required scripts', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8'));
  assert.equal(manifest.engines.node, '>=20');
  assert.deepEqual(manifest.scripts, {
    start: 'electron electron/main.cjs',
    dev: 'VITE_DEV_SERVER_URL=http://localhost:5173 concurrently "vite" "electron electron/main.cjs"',
    build: 'vite build',
    test: 'node --test tests/**/*.test.cjs'
  });
});

test('createApp returns an Express app with a health endpoint', async () => {
  const { createApp } = require('../server/app.cjs');
  const app = createApp({
    repository: {}, username: 'student', password: 'password', commit: 'abc123',
    clock: () => new Date('2026-09-29T00:00:00.000Z')
  });
  assert.equal(typeof app, 'function');

  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test('preload exposes only the recording controls', () => {
  const source = fs.readFileSync(path.join(appDir, 'electron/preload.cjs'), 'utf8');
  assert.match(source, /recording:start/);
  assert.match(source, /recording:stop/);
  assert.match(source, /recording:result/);
  assert.doesNotMatch(source, /contextBridge\.exposeInMainWorld\(['"]electron['"]|require\(['"]node/);
});

test('the mode selector contains the exact and polished modes', () => {
  const source = fs.readFileSync(path.join(appDir, 'src/components/StatusCard.jsx'), 'utf8');
  assert.match(source, /<option value="exact">Exact<\/option>/);
  assert.match(source, /<option value="polished">Polished<\/option>/);
});

test('development starts Electron against the Vite server URL', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8'));
  const electronSource = fs.readFileSync(path.join(appDir, 'electron/main.cjs'), 'utf8');
  assert.match(manifest.scripts.dev, /VITE_DEV_SERVER_URL=http:\/\/localhost:5173/);
  assert.match(electronSource, /VITE_DEV_SERVER_URL/);
  assert.match(electronSource, /https:\/\/whispr-flow-clone\.vercel\.app/);
});
