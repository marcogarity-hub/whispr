const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appDir = path.join(__dirname, '..');

test('Task 1 modes are Exact and Polished', () => {
  const source = fs.readFileSync(path.join(appDir, 'src/components/StatusCard.jsx'), 'utf8');
  assert.match(source, /<option value="exact">Exact<\/option>/);
  assert.match(source, /<option value="polished">Polished<\/option>/);
});

test('Task 1 dev script passes Vite URL to Electron', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8'));
  const electronSource = fs.readFileSync(path.join(appDir, 'electron/main.cjs'), 'utf8');
  assert.match(manifest.scripts.dev, /VITE_DEV_SERVER_URL=http:\/\/localhost:5173/);
  assert.match(electronSource, /VITE_DEV_SERVER_URL/);
  assert.match(electronSource, /https:\/\/whispr\.vercel\.app/);
});
