const test = require('node:test');
const assert = require('node:assert/strict');

const audio = import('../src/browser/audio.mjs');

test('mixChannels averages stereo samples into a Float32Array', async () => {
  const { mixChannels } = await audio;
  const mixed = mixChannels([
    Float32Array.from([1, -1]),
    Float32Array.from([-1, 1])
  ]);

  assert.ok(mixed instanceof Float32Array);
  assert.deepEqual(Array.from(mixed), [0, 0]);
});

test('resampleLinear converts 48 kHz samples to 16 kHz', async () => {
  const { resampleLinear } = await audio;
  const resampled = resampleLinear(Float32Array.from([0, 1, 0, -1, 0, 1]), 48000, 16000);

  assert.ok(resampled instanceof Float32Array);
  assert.equal(resampled.length, 2);
  assert.ok(resampled.every(Number.isFinite));
});

test('audio conversion helpers handle empty input without negative duration', async () => {
  const { resampleLinear } = await audio;
  const samples = resampleLinear(new Float32Array(0), 48000, 16000);
  const duration = samples.length / 16000;

  assert.ok(samples instanceof Float32Array);
  assert.ok(duration >= 0);
});

test('microphone permission errors explain how to recover', async () => {
  const { microphoneErrorMessage } = await audio;
  const error = new Error('Permission denied by browser');
  error.name = 'NotAllowedError';

  assert.match(microphoneErrorMessage(error), /Microphone permission was denied/);
  assert.match(microphoneErrorMessage(error), /Permission denied by browser/);
});
