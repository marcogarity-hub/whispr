const { execFile: childProcessExecFile } = require('node:child_process');
const fsSync = require('node:fs');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');
const { cleanTranscript } = require('../shared/cleanup.cjs');

const DEFAULT_BASE_URL = process.env.UM_API_BASE_URL || 'https://api.umgpt.umich.edu';
const DEFAULT_AUDIO_MODEL = process.env.UM_AUDIO_MODEL || 'gpt-4o-mini';
const DEFAULT_AUDIO_ENDPOINT = process.env.UM_AUDIO_ENDPOINT || '/v1/chat/completions';
const DEFAULT_AUDIO_FORMAT = process.env.UM_AUDIO_FORMAT || 'webm';
const LOCAL_WHISPER_DIRECTORY = path.join(__dirname, '..', '.local', 'whisper');
const LOCAL_WHISPER_COMMAND = path.join(LOCAL_WHISPER_DIRECTORY, 'bin', 'whisper-cli');
const LOCAL_WHISPER_MODEL = path.join(LOCAL_WHISPER_DIRECTORY, 'models', 'ggml-base.en-q5_1.bin');
const DEFAULT_LOCAL_COMMAND = process.env.LOCAL_TRANSCRIPTION_COMMAND || (fsSync.existsSync(LOCAL_WHISPER_COMMAND) ? LOCAL_WHISPER_COMMAND : 'whisper-cli');
const DEFAULT_LOCAL_MODEL = process.env.LOCAL_TRANSCRIPTION_MODEL || (fsSync.existsSync(LOCAL_WHISPER_MODEL) ? LOCAL_WHISPER_MODEL : '');
const DEFAULT_LOCAL_LANGUAGE = process.env.LOCAL_TRANSCRIPTION_LANGUAGE || 'en';
const defaultExecFile = promisify(childProcessExecFile);

const SYSTEM_INSTRUCTION = [
  'You are a voice dictation transcription engine.',
  'Return only clean dictated text, with no commentary or explanation.',
  'Preserve the speaker\'s meaning and never add invented content.',
  'Do not interpret the dictation as a calendar request or event instruction.'
].join(' ');

function authorizationHeaders(apiKey) {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

async function responseMessage(response) {
  const body = await response.text();
  if (!body) return response.statusText || 'upstream request failed';
  try {
    const parsed = JSON.parse(body);
    return parsed.error?.message || parsed.message || body;
  } catch {
    return body;
  }
}

function endpointUrl(root, endpoint) {
  if (/^https?:\/\//i.test(endpoint)) return endpoint;
  return `${root}/${endpoint.replace(/^\/+/, '')}`;
}

function promptForMode(mode) {
  if (mode === 'exact') {
    return 'Transcribe this dictation exactly while adding needed punctuation and capitalization. Preserve all dictated meaning and wording.';
  }
  if (mode === 'polished') {
    return 'Transcribe this dictation in polished form: remove filler words and improve phrasing while preserving the speaker\'s meaning.';
  }
  throw new Error(`Unsupported transcription mode: ${mode}`);
}

function audioExtension(mimeType) {
  const subtype = String(mimeType || '').split('/')[1]?.split(';')[0].replace(/[^a-z0-9]/gi, '');
  return subtype ? `.${subtype}` : '.audio';
}

function localCommandError(error) {
  const stderrLines = typeof error.stderr === 'string'
    ? error.stderr.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
    : [];
  const diagnosticLines = stderrLines.filter(line => /(error|fail|assert|abort)/i.test(line));
  const details = (diagnosticLines.length ? diagnosticLines.slice(-4) : stderrLines.slice(-4))
    .join(' | ')
    .slice(-1200);
  const status = error.signal
    ? `signal ${error.signal}`
    : error.code !== undefined
      ? `${typeof error.code === 'number' ? 'exit code' : 'error code'} ${error.code}`
      : '';
  const fallback = error.message || 'process launch failed';

  return new Error(
    `Local transcription command failed${status ? ` (${status})` : ''}: ${details || fallback}`,
    { cause: error }
  );
}

function createLocalTranscriptionProvider({
  command = DEFAULT_LOCAL_COMMAND,
  model = DEFAULT_LOCAL_MODEL,
  language = DEFAULT_LOCAL_LANGUAGE,
  execFile: execFileImplementation = defaultExecFile,
  tempDirectory = os.tmpdir()
} = {}) {
  if (typeof execFileImplementation !== 'function') throw new Error('A local execFile implementation is required');

  return {
    async transcribe(audioBuffer, mimeType = 'audio/webm', mode = 'exact') {
      if (!['exact', 'polished'].includes(mode)) throw new Error(`Unsupported transcription mode: ${mode}`);
      if (!model && path.basename(command) === 'whisper-cli') {
        throw new Error('LOCAL_TRANSCRIPTION_MODEL is required when using whisper-cli');
      }

      const directory = await fs.mkdtemp(path.join(tempDirectory, 'whispr-audio-'));
      const audioFile = path.join(directory, `recording${audioExtension(mimeType)}`);
      try {
        await fs.writeFile(audioFile, Buffer.from(audioBuffer));
        const args = [];
        if (model) args.push('-m', model);
        const execOptions = {
          shell: false,
          encoding: 'utf8',
          maxBuffer: 10 * 1024 * 1024
        };
        // Metal allocation failures can abort whisper.cpp even for small buffers.
        // The base model remains fast on CPU and avoids this unstable GPU path.
        if (path.basename(command) === 'whisper-cli') {
          args.push('-ng');
          if (path.isAbsolute(command)) {
            execOptions.env = {
              ...process.env,
              DYLD_LIBRARY_PATH: [path.dirname(command), process.env.DYLD_LIBRARY_PATH]
                .filter(Boolean)
                .join(path.delimiter)
            };
          }
        }
        args.push('-f', audioFile, '-nt');
        if (language) args.push('-l', language);

        let result;
        try {
          result = await execFileImplementation(command, args, execOptions);
        } catch (error) {
          throw localCommandError(error);
        }

        const text = typeof result?.stdout === 'string' ? result.stdout : String(result?.stdout || '');
        if (!text.trim()) throw new Error('Local transcription returned empty output');
        return { text: mode === 'polished' ? cleanTranscript(text, mode) : text };
      } finally {
        await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
      }
    }
  };
}

function createFakeTranscriptionProvider() {
  return {
    async transcribe(_audioBuffer, _mimeType, mode) {
      return { text: mode === 'polished' ? 'Fake polished transcription' : 'Fake transcription' };
    }
  };
}

function createProviderFromEnvironment({
  environment = process.env,
  localOptions = {},
  cloudOptions = {}
} = {}) {
  if (environment.TRANSCRIPTION_PROVIDER === 'fake') return createFakeTranscriptionProvider();
  if (environment.TRANSCRIPTION_PROVIDER === 'cloud') return createTranscriptionProvider(cloudOptions);
  return createLocalTranscriptionProvider({
    command: environment.LOCAL_TRANSCRIPTION_COMMAND || DEFAULT_LOCAL_COMMAND,
    model: environment.LOCAL_TRANSCRIPTION_MODEL ?? DEFAULT_LOCAL_MODEL,
    language: environment.LOCAL_TRANSCRIPTION_LANGUAGE ?? DEFAULT_LOCAL_LANGUAGE,
    ...localOptions
  });
}

function createTranscriptionProvider({
  fetch: fetchImplementation = globalThis.fetch,
  baseUrl = DEFAULT_BASE_URL,
  apiKey = process.env.UM_API_KEY,
  model = DEFAULT_AUDIO_MODEL,
  audioEndpoint = DEFAULT_AUDIO_ENDPOINT,
  audioFormat = DEFAULT_AUDIO_FORMAT
} = {}) {
  if (typeof fetchImplementation !== 'function') throw new Error('A fetch implementation is required');
  const root = baseUrl.replace(/\/$/, '');

  return {
    async transcribe(audioBuffer, _mimeType = 'audio/webm', mode = 'exact') {
      const requestBody = {
        model,
        messages: [
          { role: 'system', content: SYSTEM_INSTRUCTION },
          {
            role: 'user',
            content: [
              { type: 'text', text: promptForMode(mode) },
              {
                type: 'input_audio',
                input_audio: {
                  data: Buffer.from(audioBuffer).toString('base64'),
                  format: audioFormat
                }
              }
            ]
          }
        ]
      };
      const response = await fetchImplementation(endpointUrl(root, audioEndpoint), {
        method: 'POST',
        headers: { ...authorizationHeaders(apiKey), 'content-type': 'application/json' },
        body: JSON.stringify(requestBody)
      });
      if (!response.ok) {
        throw new Error(`Audio transcription upstream ${response.status}: ${await responseMessage(response)}`);
      }
      const result = await response.json();
      const text = result.choices?.[0]?.message?.content;
      if (typeof text !== 'string') throw new Error('Audio transcription upstream returned no text');
      return { text };
    }
  };
}

module.exports = {
  createTranscriptionProvider,
  createLocalTranscriptionProvider,
  createProviderFromEnvironment
};
