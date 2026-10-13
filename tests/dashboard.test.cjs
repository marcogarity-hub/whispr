const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadApi(fetch) {
  const clientSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'apiClient.mjs'), 'utf8')
    .replace('export function createApiClient', 'function createApiClient');
  const source = `${clientSource}\n${fs.readFileSync(path.join(__dirname, '..', 'src', 'api.js'), 'utf8')}`
    .replace(/import \{ createApiClient \} from '\.\/apiClient\.mjs';\s*/, '')
    .replace(/export default api;?\s*$/, '')
    .replace(/export default \{[^}]+\};?/, '')
    .replace(/export \{([^}]+)\};?/, 'Object.assign(exports, {$1});')
    .replace(/export async function /g, 'async function ')
    .replace(/export function /g, 'function ');
  const context = { exports: {}, fetch };
  vm.runInNewContext(`${source}\nObject.assign(exports, { getTranscript, updateTranscript, deleteTranscript, getStats });`, context);
  return context.exports;
}

test('API client centralizes transcript and stats requests and normalizes responses', async () => {
  const calls = [];
  const api = loadApi(async (url, options = {}) => {
    calls.push({ url, options });
    if (url === '/api/transcript' && !options.method) return { ok: false, status: 404, json: async () => ({ error: 'No latest transcript exists' }) };
    if (url === '/api/stats') return { ok: true, status: 200, json: async () => ({ totalWords: 4, totalDurationSeconds: 2500, sessionCount: 2, successRate: 50 }) };
    if (options.method === 'PUT') return { ok: true, status: 200, json: async () => ({ id: 7, text: 'Edited' }) };
    if (options.method === 'DELETE') return { ok: true, status: 204, json: async () => { throw new Error('must not parse 204'); } };
    throw new Error(`unexpected request ${url}`);
  });

  assert.equal(await api.getTranscript(), null);
  assert.deepEqual(await api.updateTranscript(7, 'Edited'), { id: 7, text: 'Edited' });
  assert.equal(await api.deleteTranscript(), undefined);
  assert.equal(JSON.stringify(await api.getStats()), JSON.stringify({ totalWords: 4, totalDurationSeconds: 2500, sessionCount: 2, successRate: 50 }));
  assert.equal(calls[1].options.headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[1].options.body), { id: 7, text: 'Edited', wordCount: 1 });
});

test('dashboard components expose status, editable transcript, and all usage metrics', () => {
  const files = ['StatusCard.jsx', 'TranscriptEditor.jsx', 'StatsPanel.jsx'];
  for (const file of files) assert.equal(fs.existsSync(path.join(__dirname, '..', 'src', 'components', file)), true, file);
  const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.jsx'), 'utf8');
  const status = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'StatusCard.jsx'), 'utf8');
  assert.match(app, /voiceTyping|recording/);
  assert.match(app, /onStatus/);
  assert.match(app, /exact/);
  assert.match(status, /polished/);
});

test('dashboard includes visible setup guidance and explicit API error paths', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.jsx'), 'utf8');
  const editor = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'TranscriptEditor.jsx'), 'utf8');
  const stats = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'StatsPanel.jsx'), 'utf8');
  for (const phrase of ['Microphone permission', 'Accessibility permission', 'Command+Shift+Space', 'ChatGPT', 'Claude']) assert.equal(app.includes(phrase), true, phrase);
  assert.match(app, /errorMessage|role="alert"/);
  assert.match(editor, /catch.*setState/s);
  assert.match(editor, /updateTranscript[\s\S]*catch/);
  assert.match(editor, /deleteTranscript[\s\S]*catch/);
  assert.match(stats, /catch[\s\S]*(setState|setError)/);
  assert.doesNotMatch(stats, /catch\(\) => setStats\(null\)/);
});

test('short dictation totals are shown in seconds and longer totals in minutes and seconds', () => {
  const { formatDuration } = require('../src/formatDuration.cjs');
  assert.equal(formatDuration(12), '12s');
  assert.equal(formatDuration(60), '1m 0s');
  assert.equal(formatDuration(125), '2m 5s');
});
