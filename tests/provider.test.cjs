const test = require('node:test');
const assert = require('node:assert/strict');

const { createTranscriptionProvider } = require('../server/provider.cjs');

function fakeAudioResponse(text) {
  return {
    ok: true,
    json: async () => ({ choices: [{ message: { content: text } }] })
  };
}

async function captureRequest(mode) {
  let calls = 0;
  let request;
  const provider = createTranscriptionProvider({
    apiKey: 'test-key',
    baseUrl: 'https://example.test',
    model: 'gpt-audio-test',
    audioEndpoint: '/v1/chat/completions',
    audioFormat: 'wav',
    fetch: async (url, options) => {
      calls += 1;
      request = { url, options };
      return fakeAudioResponse(`${mode} model text.`);
    }
  });

  const result = await provider.transcribe(Buffer.from('audio bytes'), 'audio/wav', mode);
  return { calls, request, result };
}

test('exact mode uses one GPT audio request and returns the model text', async () => {
  const { calls, request, result } = await captureRequest('exact');
  const body = JSON.parse(request.options.body);
  const audio = body.messages[1].content.find(part => part.type === 'input_audio');

  assert.equal(calls, 1);
  assert.deepEqual(result, { text: 'exact model text.' });
  assert.equal(request.url, 'https://example.test/v1/chat/completions');
  assert.equal(request.options.headers.Authorization, 'Bearer test-key');
  assert.equal(body.model, 'gpt-audio-test');
  assert.match(body.messages[0].content, /only clean dictated text/i);
  assert.match(body.messages[0].content, /commentary/i);
  assert.match(body.messages[0].content, /invented content/i);
  assert.match(body.messages[0].content, /calendar.*event|event.*calendar/i);
  assert.match(body.messages[1].content.find(part => part.type === 'text').text, /exact/i);
  assert.equal(audio.input_audio.data, Buffer.from('audio bytes').toString('base64'));
  assert.equal(audio.input_audio.format, 'wav');
});

test('polished mode uses one GPT audio request with the polished prompt variant', async () => {
  const { calls, request, result } = await captureRequest('polished');
  const body = JSON.parse(request.options.body);
  const prompt = body.messages[1].content.find(part => part.type === 'text').text;

  assert.equal(calls, 1);
  assert.deepEqual(result, { text: 'polished model text.' });
  assert.match(prompt, /polished/i);
  assert.match(prompt, /filler/i);
  assert.doesNotMatch(prompt, /second API call/i);
});
