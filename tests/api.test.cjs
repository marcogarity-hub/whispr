const test = require('node:test');
const assert = require('node:assert/strict');

const { createApp } = require('../server/app.cjs');

const authorization = `Basic ${Buffer.from('student:password').toString('base64')}`;
const timestamp = '2026-10-08T00:00:00.000Z';

function createFakeRepository({ transcript = null, stats = { totalWords: 0, totalDurationSeconds: 0, sessionCount: 0, successRate: 0 } } = {}) {
  const calls = [];
  let latest = transcript;
  return {
    calls,
    async saveDictation(input) {
      calls.push({ method: 'saveDictation', input });
      latest = { id: 1, text: input.text, mode: input.mode, wordCount: input.text.split(/\s+/).length, createdAt: input.timestamp, updatedAt: input.timestamp };
      return { transcript: latest, session: { id: 2, duration: input.duration, status: 'success', createdAt: input.timestamp } };
    },
    async getLatestTranscript() {
      calls.push({ method: 'getLatestTranscript' });
      return latest;
    },
    async updateTranscript(id, text, updatedAt) {
      calls.push({ method: 'updateTranscript', input: { id, text, updatedAt } });
      latest = { ...latest, id, text: text.trim(), wordCount: text.trim().split(/\s+/).length, updatedAt };
      return latest;
    },
    async deleteTranscript() {
      calls.push({ method: 'deleteTranscript' });
      const existed = Boolean(latest);
      latest = null;
      return existed;
    },
    async getStats() {
      calls.push({ method: 'getStats' });
      return stats;
    },
    async saveFailedSession(input) {
      calls.push({ method: 'saveFailedSession', input });
      return { id: 3, duration: input.duration, status: 'error', errorMessage: input.errorMessage, createdAt: input.timestamp };
    }
  };
}

async function withApp(repository, run) {
  const app = createApp({ repository, username: 'student', password: 'password', commit: 'abc123', clock: () => new Date(timestamp) });
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    await run((path, options) => fetch(`${baseUrl}${path}`, options));
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

function jsonOptions(method, body, authenticated = true) {
  return {
    method,
    headers: {
      ...(authenticated ? { authorization } : {}),
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  };
}

test('exposes the deployment version without credentials and protects data routes', async () => {
  const repository = createFakeRepository();
  await withApp(repository, async request => {
    const version = await request('/api/version');
    assert.equal(version.status, 200);
    assert.deepEqual(await version.json(), { commit: 'abc123' });

    const protectedResponse = await request('/api/transcript');
    assert.equal(protectedResponse.status, 401);
    assert.equal(protectedResponse.headers.get('www-authenticate'), 'Basic realm="Whispr"');
  });
});

test('saves and reads a dictation through the authenticated repository contract', async () => {
  const repository = createFakeRepository();
  await withApp(repository, async request => {
    const saved = await request('/api/dictations', jsonOptions('POST', { text: ' one two ', mode: 'exact', duration: 2 }));
    assert.equal(saved.status, 201);
    assert.equal(repository.calls[0].method, 'saveDictation');
    assert.deepEqual(repository.calls[0].input, { text: 'one two', mode: 'exact', duration: 2, timestamp });
    assert.equal((await (await request('/api/transcript', { headers: { authorization } })).json()).text, 'one two');
  });
});

test('updates and deletes the latest transcript', async () => {
  const repository = createFakeRepository({ transcript: { id: 1, text: 'one two', mode: 'exact', wordCount: 2 } });
  await withApp(repository, async request => {
    const updated = await request('/api/transcript', jsonOptions('PUT', { id: 1, text: 'three four' }));
    assert.equal(updated.status, 200);
    assert.deepEqual(repository.calls.find(call => call.method === 'updateTranscript').input, { id: 1, text: 'three four', updatedAt: timestamp });
    assert.equal((await request('/api/transcript', { method: 'DELETE', headers: { authorization } })).status, 204);
    assert.equal((await request('/api/transcript', { headers: { authorization } })).status, 404);
  });
});

test('returns stats and records only failed sessions', async () => {
  const repository = createFakeRepository({ stats: { totalWords: 2, totalDurationSeconds: 3, sessionCount: 1, successRate: 100 } });
  await withApp(repository, async request => {
    const stats = await request('/api/stats', { headers: { authorization } });
    assert.equal(stats.status, 200);
    assert.deepEqual(await stats.json(), { totalWords: 2, totalDurationSeconds: 3, sessionCount: 1, successRate: 100 });
    const failed = await request('/api/sessions', jsonOptions('POST', { status: 'error', duration: 2, errorMessage: 'No microphone' }));
    assert.equal(failed.status, 201);
    assert.deepEqual(repository.calls.find(call => call.method === 'saveFailedSession').input, { duration: 2, errorMessage: 'No microphone', timestamp });
    assert.equal((await request('/api/sessions', jsonOptions('POST', { status: 'success', duration: 2 }))).status, 400);
  });
});

test('rejects invalid fields and hides repository failures', async () => {
  const repository = createFakeRepository();
  repository.getStats = async () => { throw new Error('database password leaked'); };
  await withApp(repository, async request => {
    assert.equal((await request('/api/dictations', jsonOptions('POST', { text: '', mode: 'exact', duration: 1 }))).status, 400);
    assert.equal((await request('/api/transcript', jsonOptions('PUT', { id: 2, text: 'nope' }))).status, 400);
    const failed = await request('/api/stats', { headers: { authorization } });
    assert.equal(failed.status, 500);
    assert.deepEqual(await failed.json(), { error: 'Request failed' });
  });
});

test('requires credentials when constructing the app', () => {
  assert.throws(() => createApp({ repository: createFakeRepository(), username: '', password: 'password', commit: 'abc123' }), /Basic auth credentials are required/);
  assert.throws(() => createApp({ repository: createFakeRepository(), username: 'student', password: '', commit: 'abc123' }), /Basic auth credentials are required/);
});
