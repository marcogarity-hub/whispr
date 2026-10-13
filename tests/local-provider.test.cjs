const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const {
  createLocalTranscriptionProvider,
  createProviderFromEnvironment
} = require('../server/provider.cjs');

async function assertRemoved(filename) {
  await assert.rejects(() => fs.access(filename), { code: 'ENOENT' });
}

test('local exact mode writes audio, invokes whisper.cpp flags, returns stdout, and cleans up', async () => {
  let request;
  let audioPath;
  const provider = createLocalTranscriptionProvider({
    command: 'whisper-cli',
    model: '/models/base.bin',
    language: 'en',
    execFile: async (command, args, options) => {
      request = { command, args, options };
      audioPath = args[args.indexOf('-f') + 1];
      assert.deepEqual(await fs.readFile(audioPath), Buffer.from('audio bytes'));
      return { stdout: 'Exact wording stays.\n' };
    }
  });

  assert.deepEqual(
    await provider.transcribe(Buffer.from('audio bytes'), 'audio/wav', 'exact'),
    { text: 'Exact wording stays.\n' }
  );
  assert.equal(request.command, 'whisper-cli');
  assert.deepEqual(request.args, ['-m', '/models/base.bin', '-ng', '-f', audioPath, '-nt', '-l', 'en']);
  assert.equal(request.options.shell, false);
  await assertRemoved(audioPath);
});

test('absolute whisper-cli commands resolve bundled libraries from their bin directory', async () => {
  let request;
  const provider = createLocalTranscriptionProvider({
    command: '/local/whisper/bin/whisper-cli',
    model: '/local/whisper/models/base.bin',
    language: 'en',
    execFile: async (command, args, options) => {
      request = { command, args, options };
      return { stdout: 'Local result' };
    }
  });

  await provider.transcribe(Buffer.from('audio bytes'), 'audio/wav', 'exact');

  assert.equal(request.command, '/local/whisper/bin/whisper-cli');
  assert.ok(request.args.includes('-ng'));
  assert.equal(request.options.env.DYLD_LIBRARY_PATH.split(path.delimiter)[0], '/local/whisper/bin');
});

test('local polished mode uses one process call and removes obvious filler words locally', async () => {
  let calls = 0;
  const provider = createLocalTranscriptionProvider({
    command: 'whisper-wrapper',
    model: '',
    language: '',
    execFile: async () => {
      calls += 1;
      return { stdout: 'Um, this is   uh ready.\n' };
    }
  });

  assert.deepEqual(
    await provider.transcribe(Buffer.from('audio bytes'), 'audio/webm', 'polished'),
    { text: 'this is ready.' }
  );
  assert.equal(calls, 1);
});

test('local provider rejects command failures and empty stdout after cleanup', async () => {
  let failedPath;
  const failedProvider = createLocalTranscriptionProvider({
    command: 'whisper-wrapper',
    model: 'model.bin',
    execFile: async (_command, args) => {
      failedPath = args[args.indexOf('-f') + 1];
      const error = new Error('process exited with code 1');
      error.code = 1;
      error.stderr = 'ggml_metal_buffer_init: failed to allocate Metal buffer';
      throw error;
    }
  });
  await assert.rejects(
    () => failedProvider.transcribe(Buffer.from('audio'), 'audio/webm', 'exact'),
    /Local transcription command failed \(exit code 1\).*failed to allocate Metal buffer/
  );
  await assertRemoved(failedPath);

  let abortedPath;
  const abortedProvider = createLocalTranscriptionProvider({
    command: 'whisper-wrapper',
    model: 'model.bin',
    execFile: async (_command, args) => {
      abortedPath = args[args.indexOf('-f') + 1];
      const error = new Error('child process terminated');
      error.signal = 'SIGABRT';
      error.stderr = 'GGML_ASSERT(buffer) failed';
      throw error;
    }
  });
  await assert.rejects(
    () => abortedProvider.transcribe(Buffer.from('audio'), 'audio/webm', 'exact'),
    /Local transcription command failed \(signal SIGABRT\).*GGML_ASSERT\(buffer\) failed/
  );
  await assertRemoved(abortedPath);

  let emptyPath;
  const emptyProvider = createLocalTranscriptionProvider({
    command: 'whisper-wrapper',
    model: 'model.bin',
    execFile: async (_command, args) => {
      emptyPath = args[args.indexOf('-f') + 1];
      return { stdout: ' \n' };
    }
  });
  await assert.rejects(
    () => emptyProvider.transcribe(Buffer.from('audio'), 'audio/webm', 'exact'),
    /Local transcription returned empty output/
  );
  await assertRemoved(emptyPath);
});

test('provider selection defaults to local and keeps fake offline while cloud is explicit', async () => {
  const localProvider = createProviderFromEnvironment({
    environment: {
      LOCAL_TRANSCRIPTION_COMMAND: 'whisper-wrapper',
      LOCAL_TRANSCRIPTION_MODEL: 'model.bin'
    },
    localOptions: { execFile: async () => ({ stdout: 'Local result' }) }
  });
  assert.deepEqual(
    await localProvider.transcribe(Buffer.from('audio'), 'audio/webm', 'exact'),
    { text: 'Local result' }
  );

  const fakeProvider = createProviderFromEnvironment({
    environment: { TRANSCRIPTION_PROVIDER: 'fake' }
  });
  assert.deepEqual(
    await fakeProvider.transcribe(Buffer.from('audio'), 'audio/webm', 'polished'),
    { text: 'Fake polished transcription' }
  );

  let cloudCalls = 0;
  const cloudProvider = createProviderFromEnvironment({
    environment: { TRANSCRIPTION_PROVIDER: 'cloud' },
    cloudOptions: {
      baseUrl: 'https://example.test',
      fetch: async () => {
        cloudCalls += 1;
        return { ok: true, json: async () => ({ choices: [{ message: { content: 'Cloud result' } }] }) };
      }
    }
  });
  assert.deepEqual(
    await cloudProvider.transcribe(Buffer.from('audio'), 'audio/webm', 'exact'),
    { text: 'Cloud result' }
  );
  assert.equal(cloudCalls, 1);
});
