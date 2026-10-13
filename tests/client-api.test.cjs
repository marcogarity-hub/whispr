const test = require('node:test');
const assert = require('node:assert/strict');

test('client sends same-origin cookies and CSRF and clears state after unauthorized responses', async () => {
  const {createApiClient}=await import('../src/apiClient.mjs');
  const calls=[];let unauthorized=false,failures=0;
  const api=createApiClient(async(url,options)=>{
    calls.push({url,options});
    if(unauthorized)return new Response(JSON.stringify({error:'Sign in required'}),{status:401});
    return new Response(JSON.stringify(url==='/api/auth/me'?{user:{id:'user'},csrfToken:'server-csrf'}:{totalWords:0}),{status:200});
  });
  api.onAuthFailure(()=>failures++);
  await api.getCurrentUser();
  await api.saveDictation({text:'private',mode:'exact',duration:1});
  assert.equal(calls[1].options.credentials,'same-origin');
  assert.equal(calls[1].options.headers['x-csrf-token'],'server-csrf');
  assert.equal(calls[1].options.headers.authorization,undefined);
  unauthorized=true;
  await assert.rejects(api.getStats(),error=>error.status===401);
  assert.equal(failures,1);
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

  assert.equal(await api.getTranscript(), null);
  assert.deepEqual(await api.updateTranscript(1, 'changed'), { id: 1, text: 'changed' });
  assert.equal(await api.deleteTranscript(), undefined);
  assert.deepEqual(await api.saveDictation({ text: 'hello', mode: 'exact', duration: 2 }), { transcript: { text: 'hello' }, session: { status: 'success' } });
  assert.deepEqual(await api.saveFailedSession({ duration: 1, errorMessage: 'No microphone' }), { status: 'error' });
  assert.deepEqual(JSON.parse(calls[3].options.body), { text: 'hello', mode: 'exact', duration: 2 });
  assert.deepEqual(JSON.parse(calls[4].options.body), { status: 'error', duration: 1, errorMessage: 'No microphone' });
});
