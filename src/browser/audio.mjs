const TARGET_SAMPLE_RATE = 16000;

function clockNow() {
  return typeof globalThis.performance?.now === 'function'
    ? globalThis.performance.now()
    : Date.now();
}

function audioContextConstructor() {
  return globalThis.AudioContext || globalThis.webkitAudioContext;
}

export function microphoneErrorMessage(error) {
  const diagnostic = typeof error?.message === 'string' && error.message.trim() ? ` (${error.message.trim()})` : '';
  if (error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError') {
    return `Microphone permission was denied. Allow microphone access for this site and try again.${diagnostic}`;
  }
  if (error?.name === 'NotFoundError' || error?.name === 'DevicesNotFoundError') {
    return `No microphone was found. Connect a microphone and try again.${diagnostic}`;
  }
  if (error?.name === 'NotReadableError' || error?.name === 'TrackStartError') {
    return `The microphone is unavailable. Close other apps using it and try again.${diagnostic}`;
  }
  if (error?.name === 'SecurityError') {
    return `Microphone access requires a secure browser page (HTTPS or localhost).${diagnostic}`;
  }
  return `Microphone recording could not start. Check your browser permissions and try again.${diagnostic}`;
}

export function mixChannels(channels) {
  const channelList = Array.from(channels || [], (channel) => channel || new Float32Array(0));
  const length = channelList.reduce((longest, channel) => Math.max(longest, channel.length), 0);
  const mixed = new Float32Array(length);
  if (channelList.length === 0) return mixed;

  for (let index = 0; index < length; index += 1) {
    let total = 0;
    for (const channel of channelList) total += channel[index] || 0;
    mixed[index] = total / channelList.length;
  }
  return mixed;
}

export function resampleLinear(samples, fromRate, toRate = TARGET_SAMPLE_RATE) {
  const input = samples instanceof Float32Array ? samples : Float32Array.from(samples || []);
  if (!input.length || !Number.isFinite(fromRate) || fromRate <= 0 || !Number.isFinite(toRate) || toRate <= 0) {
    return new Float32Array(0);
  }
  if (fromRate === toRate) return new Float32Array(input);

  const length = Math.max(1, Math.round(input.length * toRate / fromRate));
  const output = new Float32Array(length);
  const step = fromRate / toRate;
  for (let index = 0; index < length; index += 1) {
    const position = index * step;
    const left = Math.min(input.length - 1, Math.floor(position));
    const right = Math.min(input.length - 1, left + 1);
    const fraction = position - left;
    output[index] = input[left] + (input[right] - input[left]) * fraction;
  }
  return output;
}

function stopTracks(stream) {
  stream?.getTracks?.().forEach((track) => track.stop());
}

function recorderBlob(recorder) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    recorder.addEventListener('dataavailable', (event) => {
      if (event.data?.size) chunks.push(event.data);
    });
    recorder.addEventListener('error', (event) => reject(event.error || new Error('Microphone recording failed.')));
    recorder.addEventListener('stop', () => resolve(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })));
    recorder.stop();
  });
}

export async function startRecording() {
  if (!globalThis.navigator?.mediaDevices?.getUserMedia) {
    throw new Error('This browser cannot access a microphone. Try a current browser over HTTPS.');
  }
  if (typeof globalThis.MediaRecorder !== 'function') {
    throw new Error('This browser does not support microphone recording.');
  }
  const Context = audioContextConstructor();
  if (typeof Context !== 'function') throw new Error('This browser cannot decode microphone audio.');

  let stream;
  try {
    stream = await globalThis.navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (error) {
    throw new Error(microphoneErrorMessage(error), { cause: error });
  }
  let context;
  let recorder;
  let stopped;
  const startedAt = clockNow();
  try {
    context = new Context();
    const preferredMime = 'audio/webm;codecs=opus';
    const options = typeof globalThis.MediaRecorder.isTypeSupported === 'function'
      && globalThis.MediaRecorder.isTypeSupported(preferredMime)
      ? { mimeType: preferredMime }
      : undefined;
    recorder = options ? new globalThis.MediaRecorder(stream, options) : new globalThis.MediaRecorder(stream);
    recorder.start();
  } catch (error) {
    stopTracks(stream);
    await Promise.resolve(context?.close?.()).catch(() => {});
    throw new Error(microphoneErrorMessage(error), { cause: error });
  }

  async function stop() {
    if (stopped) return stopped;
    stopped = (async () => {
      const duration = Math.max(0, (clockNow() - startedAt) / 1000);
      try {
        const blob = await recorderBlob(recorder);
        if (!blob.size) throw new Error('No microphone audio was captured. Try recording again.');
        const decoded = await context.decodeAudioData(await blob.arrayBuffer());
        const channels = Array.from({ length: decoded.numberOfChannels }, (_, index) => decoded.getChannelData(index));
        const mono = mixChannels(channels);
        const samples = resampleLinear(mono, decoded.sampleRate, TARGET_SAMPLE_RATE);
        if (!samples.length) throw new Error('No microphone audio was captured. Try recording again.');
        return { samples, duration };
      } finally {
        stopTracks(stream);
        await Promise.resolve(context.close?.()).catch(() => {});
      }
    })();
    return stopped;
  }

  return { stop };
}
