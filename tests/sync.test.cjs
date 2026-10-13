const test = require('node:test');
const assert = require('node:assert/strict');
const { createSync } = require('../electron/sync.cjs');

test('saveDictation posts authenticated finished text and no audio bytes', async () => {
  let request;
  const sync = createSync({
    apiUrl: 'https://whispr.example',
    getAuthorization: () => 'Basic dGVzdDp0ZXN0',
    fetchImpl: async (url, options) => {
      request = { url, options };
      assert.equal(url, 'https://whispr.example/api/dictations');
      assert.equal(options.headers.authorization, 'Basic dGVzdDp0ZXN0');
      assert.deepEqual(JSON.parse(options.body), { text: 'hello', mode: 'exact', duration: 2 });
      assert.doesNotMatch(options.body, /audio|base64|multipart/i);
      return new Response(JSON.stringify({ transcript: { text: 'hello' }, session: { status: 'success' } }), { status: 201 });
    }
  });

  assert.deepEqual(await sync.saveDictation({ text: 'hello', mode: 'exact', duration: 2 }), {
    transcript: { text: 'hello' },
    session: { status: 'success' }
  });
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.headers['content-type'], 'application/json');
});

test('saveDictation reports the API failure message', async () => {
  const failing = createSync({
    apiUrl: 'https://whispr.example',
    getAuthorization: () => 'Basic dGVzdDp0ZXN0',
    fetchImpl: async () => new Response(JSON.stringify({ error: 'Save failed' }), { status: 503 })
  });

  await assert.rejects(
    failing.saveDictation({ text: 'hello', mode: 'exact', duration: 2 }),
    /Save failed/
  );
});

test('saveFailedSession posts error metadata', async () => {
  const calls = [];
  const sync = createSync({
    apiUrl: 'https://whispr.example/',
    getAuthorization: () => 'Basic auth',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({ id: 7, status: 'error' }), { status: 201 });
    }
  });

  assert.deepEqual(await sync.saveFailedSession({ duration: 3, errorMessage: 'whisper unavailable' }), { id: 7, status: 'error' });
  assert.equal(calls[0].url, 'https://whispr.example/api/sessions');
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    status: 'error', duration: 3, errorMessage: 'whisper unavailable'
  });
});
