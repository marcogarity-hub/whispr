const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function makeRecorderHarness() {
  const events = [];
  const processors = [];
  let microphoneCalls = 0;
  let closeCalls = 0;
  let resolveFirstClose;
  const firstClose = new Promise((resolve) => { resolveFirstClose = resolve; });
  const capture = {
    onCommand(callback) { this.callback = callback; },
    send(event) { events.push(event); }
  };
  class FakeAudioContext {
    constructor() {
      this.state = 'running';
      this.sampleRate = 16000;
      this.destination = {};
    }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createScriptProcessor() {
      const processor = {
        addEventListener(_type, callback) { this.onAudioProcess = callback; },
        connect() {},
        disconnect() {}
      };
      processors.push(processor);
      return processor;
    }
    createGain() { return { gain: {}, connect() {}, disconnect() {} }; }
    resume() { return Promise.resolve(); }
    close() {
      closeCalls += 1;
      return closeCalls === 1 ? firstClose : Promise.resolve();
    }
  }
  const stream = { getTracks: () => [{ stop() {} }] };
  const context = {
    window: { capture },
    navigator: { mediaDevices: { getUserMedia: async () => { microphoneCalls += 1; return stream; } } },
    AudioContext: FakeAudioContext,
    performance: { now: (() => { let time = 0; return () => ++time; })() },
    btoa: () => 'audio'
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../electron/recorder.js'), 'utf8'), context);

  return {
    capture,
    events,
    processors,
    microphoneCalls: () => microphoneCalls,
    resolveFirstClose
  };
}

async function flushMicrotasks() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

function deliverAudio(processor) {
  processor.onAudioProcess({ inputBuffer: { getChannelData: () => [0.1, -0.1] } });
}

test('a start during capture cleanup waits for idle and then starts a new recording', async () => {
  const harness = makeRecorderHarness();
  harness.capture.callback({ type: 'start' });
  await flushMicrotasks();
  deliverAudio(harness.processors[0]);

  harness.capture.callback({ type: 'stop' });
  await flushMicrotasks();
  harness.capture.callback({ type: 'start' });
  assert.equal(harness.events.some((event) => event.type === 'recording-stopped'), false);

  harness.resolveFirstClose();
  await flushMicrotasks();

  assert.deepEqual(harness.events.map((event) => event.type), [
    'recording-started',
    'recording-stopped',
    'recording-started'
  ]);
  assert.equal(harness.microphoneCalls(), 2);
});

test('a stop cancels a queued start while the previous capture is closing', async () => {
  const harness = makeRecorderHarness();
  harness.capture.callback({ type: 'start' });
  await flushMicrotasks();
  deliverAudio(harness.processors[0]);

  harness.capture.callback({ type: 'stop' });
  await flushMicrotasks();
  harness.capture.callback({ type: 'start' });
  harness.capture.callback({ type: 'stop' });
  harness.resolveFirstClose();
  await flushMicrotasks();

  assert.deepEqual(harness.events.map((event) => event.type), ['recording-started', 'recording-stopped']);
  assert.equal(harness.microphoneCalls(), 1);
});
