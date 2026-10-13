import { env, pipeline } from '@huggingface/transformers';
import cleanup from '../../shared/cleanup.cjs';

const MODEL = 'onnx-community/whisper-tiny.en';
const TASK = 'automatic-speech-recognition';

env.allowLocalModels = false;
env.useBrowserCache = true;

let transcriberPromise;

function progressMessage(progress) {
  const status = typeof progress?.status === 'string' ? progress.status : 'Downloading model';
  self.postMessage({
    type: 'progress',
    status,
    file: progress?.file || '',
    progress: Number.isFinite(progress?.progress) ? progress.progress : null
  });
}

function stagedError(message, cause, stage) {
  const error = new Error(message, { cause });
  error.stage = stage;
  return error;
}

function diagnostic(error) {
  return String(error?.message || error || 'unknown error').replace(/\s+/g, ' ').trim().slice(0, 400);
}

function modelDownloadError(error) {
  return stagedError(`Whisper model download failed. Check your connection and try again. (${diagnostic(error)})`, error, 'model');
}

function inferenceError(error) {
  return stagedError(`Whisper could not transcribe this recording. Try speaking again. (${diagnostic(error)})`, error, 'inference');
}

async function getTranscriber() {
  if (transcriberPromise) return transcriberPromise;
  transcriberPromise = (async () => {
    const options = { progress_callback: progressMessage };
    if (typeof navigator !== 'undefined' && navigator.gpu) {
      try {
        progressMessage({ status: 'Preparing WebGPU' });
        return await pipeline(TASK, MODEL, { ...options, device: 'webgpu' });
      } catch (webgpuError) {
        progressMessage({ status: 'WebGPU unavailable; using WASM' });
      }
    }
    progressMessage({ status: 'Preparing WASM' });
    return pipeline(TASK, MODEL, { ...options, device: 'wasm' });
  })().catch((error) => {
    transcriberPromise = undefined;
    throw modelDownloadError(error);
  });
  return transcriberPromise;
}

self.onmessage = async (event) => {
  const { type, samples, mode = 'exact' } = event.data || {};
  if (type !== 'transcribe') return;
  try {
    const input = samples instanceof Float32Array ? samples : Float32Array.from(samples || []);
    if (!input.length) throw new Error('No microphone audio was captured. Try recording again.');
    const transcriber = await getTranscriber();
    const result = await transcriber(input, { return_timestamps: false });
    const text = cleanup.cleanTranscript(result?.text, mode);
    if (!text) throw new Error('Whisper returned no transcript. Try speaking again.');
    self.postMessage({ type: 'result', text });
  } catch (error) {
    const message = error?.stage === 'model' || error?.stage === 'inference' || /No microphone|no transcript/i.test(error?.message || '')
      ? error.message
      : inferenceError(error).message;
    self.postMessage({ type: 'error', message });
  }
};
