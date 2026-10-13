(function () {
  let stream;
  let audioContext;
  let source;
  let processor;
  let silentGain;
  let startedAt;
  let sampleChunks = [];
  let state = 'idle';
  let startRequestedDuringStop = false;

  function createWav(samples, sampleRate) {
    const bytes = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(bytes);
    const writeText = (offset, value) => {
      for (let index = 0; index < value.length; index++) view.setUint8(offset + index, value.charCodeAt(index));
    };

    writeText(0, 'RIFF');
    view.setUint32(4, 36 + samples.length * 2, true);
    writeText(8, 'WAVE');
    writeText(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeText(36, 'data');
    view.setUint32(40, samples.length * 2, true);

    let offset = 44;
    for (const sample of samples) {
      const value = Math.max(-1, Math.min(1, sample));
      view.setInt16(offset, value < 0 ? value * 0x8000 : value * 0x7fff, true);
      offset += 2;
    }
    return new Uint8Array(bytes);
  }

  function toBase64(bytes) {
    let binary = '';
    for (let index = 0; index < bytes.length; index += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    }
    return btoa(binary);
  }

  async function releaseCapture() {
    processor?.disconnect();
    source?.disconnect();
    silentGain?.disconnect();
    stream?.getTracks().forEach((track) => track.stop());
    const context = audioContext;
    processor = undefined;
    source = undefined;
    silentGain = undefined;
    stream = undefined;
    audioContext = undefined;
    await context?.close().catch(() => {});
  }

  async function startRecording() {
    if (state !== 'idle') {
      if (state === 'stopping') startRequestedDuringStop = true;
      return;
    }
    state = 'starting';
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (state !== 'starting' && state !== 'stopping') {
        await releaseCapture();
        return;
      }

      audioContext = new AudioContext({ sampleRate: 16000 });
      if (audioContext.state === 'suspended') await audioContext.resume();
      source = audioContext.createMediaStreamSource(stream);
      processor = audioContext.createScriptProcessor(4096, 1, 1);
      silentGain = audioContext.createGain();
      silentGain.gain.value = 0;
      sampleChunks = [];
      processor.addEventListener('audioprocess', (event) => {
        sampleChunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
      });
      source.connect(processor);
      processor.connect(silentGain);
      silentGain.connect(audioContext.destination);
      startedAt = performance.now();

      if (state === 'stopping') {
        state = 'recording';
        finishRecording();
      } else {
        state = 'recording';
        window.capture.send({ type: 'recording-started' });
      }
    } catch (error) {
      await releaseCapture();
      state = 'idle';
      startRequestedDuringStop = false;
      window.capture.send({ type: 'recording-error', message: error.message || 'Microphone access failed' });
    }
  }

  async function finishRecording() {
    const durationSeconds = Math.max(0, (performance.now() - startedAt) / 1000);
    let stoppedEvent;
    let failureMessage;
    try {
      const sampleCount = sampleChunks.reduce((total, chunk) => total + chunk.length, 0);
      if (sampleCount === 0) throw new Error('No microphone audio was captured. Try recording again.');
      const samples = new Float32Array(sampleCount);
      let offset = 0;
      for (const chunk of sampleChunks) {
        samples.set(chunk, offset);
        offset += chunk.length;
      }
      const wav = createWav(samples, audioContext?.sampleRate || 16000);
      stoppedEvent = {
        type: 'recording-stopped',
        audioBase64: toBase64(wav),
        mimeType: 'audio/wav',
        durationSeconds
      };
    } catch (error) {
      failureMessage = error.message || 'Recording failed';
    } finally {
      sampleChunks = [];
      await releaseCapture();
      state = 'idle';
    }

    const shouldRestart = startRequestedDuringStop;
    startRequestedDuringStop = false;
    if (failureMessage) window.capture.send({ type: 'recording-error', message: failureMessage });
    else window.capture.send(stoppedEvent);
    if (shouldRestart) startRecording();
  }

  window.capture.onCommand(({ type }) => {
    if (type === 'start') startRecording();
    if (type === 'stop') {
      if (state === 'starting') {
        state = 'stopping';
        startRequestedDuringStop = false;
      } else if (state === 'recording') {
        state = 'stopping';
        finishRecording();
      } else if (state === 'stopping') startRequestedDuringStop = false;
    }
  });
})();
