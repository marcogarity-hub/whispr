import { useEffect, useRef, useState } from 'react';
import api from '../api.js';
import { startRecording } from '../browser/audio.mjs';

function readableError(error, fallback) {
  return error?.message || fallback;
}

export default function BrowserRecorder({ mode = 'exact', onModeChange, onStatus, onSaved, onError }) {
  const [phase, setPhase] = useState('idle');
  const [text, setText] = useState('');
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const captureRef = useRef(null);
  const workerRef = useRef(null);
  const modeRef = useRef(mode);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => () => {
    const capture = captureRef.current;
    if (capture) capture.stop().catch(() => {});
    captureRef.current = null;
    workerRef.current?.terminate();
  }, []);

  function updatePhase(nextPhase) {
    setPhase(nextPhase);
    onStatus?.(nextPhase === 'starting' ? 'recording' : nextPhase);
  }

  function reportError(message) {
    setError(message);
    onError?.(message);
  }

  async function saveFailure(duration, message) {
    try {
      await api.saveFailedSession({ duration: Math.max(0, duration || 0), errorMessage: message });
    } catch {
      // The original local failure is the useful message when the API is unavailable too.
    }
  }

  async function begin() {
    if (phase !== 'idle' && phase !== 'error' && phase !== 'success') return;
    setError('');
    setProgress('Requesting microphone permission…');
    setCopied(false);
    updatePhase('starting');
    try {
      captureRef.current = await startRecording();
      setProgress('Listening…');
      updatePhase('recording');
    } catch (reason) {
      captureRef.current = null;
      updatePhase('error');
      reportError(readableError(reason, 'Microphone access failed.'));
      setProgress('');
    }
  }

  async function transcribe(samples, duration) {
    const worker = new Worker(new URL('../browser/whisper.worker.js', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        worker.terminate();
        if (workerRef.current === worker) workerRef.current = null;
        resolve();
      };
      worker.onmessage = async (event) => {
        const payload = event.data || {};
        if (payload.type === 'progress') {
          const percent = Number.isFinite(payload.progress) ? ` ${Math.round(payload.progress)}%` : '';
          setProgress(`${payload.status || 'Loading model'}${percent}`);
          return;
        }
        if (payload.type === 'error') {
          const message = payload.message || 'Local transcription failed.';
          await saveFailure(duration, message);
          updatePhase('error');
          reportError(message);
          setProgress('');
          finish();
          return;
        }
        if (payload.type !== 'result') return;
        const resultText = typeof payload.text === 'string' ? payload.text : '';
        if (!resultText.trim()) {
          const message = 'Whisper returned no transcript. Try speaking again.';
          await saveFailure(duration, message);
          updatePhase('error');
          reportError(message);
          setProgress('');
          finish();
          return;
        }
        setText(resultText);
        setCopied(false);
        try {
          await api.saveDictation({ text: resultText, mode: modeRef.current, duration });
          setError('');
          setProgress('');
          updatePhase('success');
          onSaved?.();
        } catch (reason) {
          const message = `Transcript ready, but cloud save failed: ${readableError(reason, 'Request failed')}`;
          updatePhase('error');
          reportError(message);
          setProgress('');
        } finally {
          finish();
        }
      };
      worker.onerror = async () => {
        const message = 'The local Whisper worker stopped unexpectedly.';
        await saveFailure(duration, message);
        updatePhase('error');
        reportError(message);
        setProgress('');
        finish();
      };
      worker.postMessage({ type: 'transcribe', samples, mode: modeRef.current }, [samples.buffer]);
    });
  }

  async function end() {
    if (phase !== 'recording' || !captureRef.current) return;
    const capture = captureRef.current;
    captureRef.current = null;
    updatePhase('transcribing');
    setProgress('Preparing local Whisper…');
    try {
      const { samples, duration } = await capture.stop();
      await transcribe(samples, duration);
    } catch (reason) {
      const message = readableError(reason, 'Recording could not be completed.');
      await saveFailure(0, message);
      updatePhase('error');
      reportError(message);
      setProgress('');
    }
  }

  async function toggle() {
    if (phase === 'recording') return end();
    return begin();
  }

  async function copyText() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard access is unavailable.');
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setError('');
    } catch (reason) {
      reportError(readableError(reason, 'Unable to copy the transcript.'));
    }
  }

  const busy = ['starting', 'recording', 'transcribing'].includes(phase);
  const statusLabel = phase === 'recording' ? 'Listening…' : phase === 'transcribing' ? 'Transcribing locally…' : phase === 'success' ? 'Transcript saved' : phase === 'error' ? 'Something went wrong' : 'Ready to listen';

  return <section className={`card browser-recorder browser-${phase}`} aria-labelledby="browser-recorder-title">
    <div className="status-heading">
      <div><p className="eyebrow">BROWSER DICTATION</p><h2 id="browser-recorder-title">{statusLabel}</h2></div>
      <span className="status-dot" aria-hidden="true" />
    </div>
    <p className="status-detail">Audio stays on this device. The English Whisper tiny model runs locally.</p>
    <label>Mode<select value={mode} onChange={(event) => onModeChange?.(event.target.value)} aria-label="Browser dictation mode"><option value="exact">Exact</option><option value="polished">Polished</option></select></label>
    {progress && <p className="progress-message" aria-live="polite">{progress}</p>}
    {error && <p className="error-message" role="alert">{error}</p>}
    <button type="button" onClick={toggle} disabled={phase === 'transcribing'}>{phase === 'recording' ? 'Stop recording' : phase === 'starting' ? 'Starting microphone…' : 'Start recording'}</button>
    {text && <div className="browser-result"><label htmlFor="browser-transcript">Transcript</label><textarea id="browser-transcript" aria-label="Browser transcript" readOnly value={text} /><button className="secondary" type="button" onClick={copyText}>{copied ? 'Copied' : 'Copy'}</button></div>}
  </section>;
}
