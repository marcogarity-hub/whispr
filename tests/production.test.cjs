const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createApp } = require('../server/app.cjs');
const { getDashboardUrl } = require('../electron/main.cjs');

test('production API code uses the Supabase repository entry point and no SQLite server', () => {
  const apiSource = fs.readFileSync(path.join(__dirname, '..', 'api/index.js'), 'utf8') + fs.readFileSync(path.join(__dirname, '..', 'server/bootstrap.cjs'), 'utf8');
  assert.match(apiSource, /@supabase\/supabase-js/);
  assert.match(apiSource, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(apiSource, /createDatabase|db\.cjs/);
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'server/server.cjs')), false);
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'server/db.cjs')), false);
});

test('dashboard loads built assets and keeps its URL selection contract', async () => {
  const staticDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'whispr-dist-'));
  fs.writeFileSync(path.join(staticDirectory, 'index.html'), '<main>Whispr dashboard</main>');
  const app = createApp({
    repository: {}, ...require('./helpers/auth-fixture.cjs').authOptions, commit: 'abc123', staticDirectory
  });
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));

  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/`);
    assert.equal(await response.text(), '<main>Whispr dashboard</main>');
    assert.equal(getDashboardUrl({}), 'https://whispr-flow-clone.vercel.app');
    assert.equal(getDashboardUrl({ VITE_DEV_SERVER_URL: 'http://127.0.0.1:5173' }), 'http://127.0.0.1:5173');
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    fs.rmSync(staticDirectory, { recursive: true, force: true });
  }
});
