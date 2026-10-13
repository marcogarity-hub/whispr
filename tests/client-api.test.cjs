const test = require('node:test');
const assert = require('node:assert/strict');

test('client authenticates protected dashboard requests in memory', async () => {
  const { createApiClient } = await import('../src/apiClient.mjs');
  const api = createApiClient(async (_url, options) => {
    if (!options.headers.authorization) {
      return new Response(JSON.stringify({ error: 'Sign in required' }), { status: 401 });
    }
    assert.equal(options.headers.authorization, 'Basic ' + Buffer.from('student:password').toString('base64'));
    return new Response(JSON.stringify({ totalWords: 0, totalDurationSeconds: 0, sessionCount: 0, successRate: 0 }), { status: 200 });
  });

  await assert.rejects(api.getStats(), /Sign in required/);
  api.setCredentials('student', 'password');
  await api.getStats();
  api.clearCredentials();
  await assert.rejects(api.getStats(), /Sign in required/);
});

test('client maps dashboard request payloads and treats a missing transcript as empty', async () => {
  const { createApiClient } = await import('../src/apiClient.mjs');
  const calls = [];
  const api = createApiClient(async (url, options) => {
    calls.push({ url, options });
    if (url === '/api/transcript' && !options.method) return new Response(JSON.stringify({ error: 'No latest transcript exists' }), { status: 404 });
    if (options.method === 'PUT') return new Response(JSON.stringify({ id: 1, text: 'changed' }), { status: 200 });
    if (options.method === 'DELETE') return new Response(null, { status: 204 });
    if (url === '/api/dictations') return new Response(JSON.stringify({ transcript: { text: 'hello' }, session: { status: 'success' } }), { status: 201 });
    if (url === '/api/sessions') return new Response(JSON.stringify({ status: 'error' }), { status: 201 });
    throw new Error(`unexpected request ${url}`);
  });
  api.setCredentials('student', 'password');

  assert.equal(await api.getTranscript(), null);
  assert.deepEqual(await api.updateTranscript(1, 'changed'), { id: 1, text: 'changed' });
  assert.equal(await api.deleteTranscript(), undefined);
  assert.deepEqual(await api.saveDictation({ text: 'hello', mode: 'exact', duration: 2 }), { transcript: { text: 'hello' }, session: { status: 'success' } });
  assert.deepEqual(await api.saveFailedSession({ duration: 1, errorMessage: 'No microphone' }), { status: 'error' });
  assert.deepEqual(JSON.parse(calls[3].options.body), { text: 'hello', mode: 'exact', duration: 2 });
  assert.deepEqual(JSON.parse(calls[4].options.body), { status: 'error', duration: 1, errorMessage: 'No microphone' });
});
