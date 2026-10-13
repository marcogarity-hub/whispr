import { useEffect, useState } from 'react';
import api from '../api.js';

export default function TranscriptEditor({ refreshKey = 0, onChanged, onError }) {
  const [transcript, setTranscript] = useState(null);
  const [text, setText] = useState('');
  const [state, setState] = useState('loading');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let active = true;
    setState('loading');
    setError('');
    setPending(false);
    api.getTranscript().then((result) => {
      if (!active) return;
      setTranscript(result);
      setText(result?.text || '');
      setState('ready');
    }).catch((reason) => {
      if (!active) return;
      const message = reason.message || 'Unable to load the latest transcript.';
      setError(message);
      setState('error');
      onError?.(message);
    });
    return () => { active = false; };
  }, [refreshKey]);

  async function save() {
    if (!transcript || pending) return;
    setPending(true);
    try {
      const updated = await api.updateTranscript(transcript.id, text);
      setTranscript(updated);
      setText(updated.text);
      setError('');
      onChanged?.();
    } catch (reason) {
      const message = reason.message || 'Unable to save transcript.';
      setError(message);
      onError?.(message);
    } finally {
      setPending(false);
    }
  }

  async function remove() {
    if (pending) return;
    setPending(true);
    try {
      await api.deleteTranscript();
      setTranscript(null);
      setText('');
      setError('');
      onChanged?.();
    } catch (reason) {
      const message = reason.message || 'Unable to delete transcript.';
      setError(message);
      onError?.(message);
    } finally {
      setPending(false);
    }
  }

  return <section className="card transcript-card" aria-labelledby="transcript-title">
    <div className="section-heading"><h2 id="transcript-title">Transcript</h2>{transcript && <span className="mode-pill">{transcript.mode}</span>}</div>
    {state === 'loading' && <p className="empty">Loading transcript…</p>}
    {error && <p className="error-message" role="alert">{error}</p>}
    {state === 'error' && !error && <p className="error-message" role="alert">Unable to load the latest transcript.</p>}
    {state === 'ready' && !transcript && <p className="empty">No transcript yet. Start dictating to see it here.</p>}
    {state === 'ready' && transcript && <><textarea aria-label="Transcript text" value={text} onChange={(event) => setText(event.target.value)} disabled={pending} /><div className="actions"><button type="button" onClick={save} disabled={pending}>{pending ? 'Saving…' : 'Save changes'}</button><button className="secondary" type="button" onClick={remove} disabled={pending}>Delete</button></div></>}
  </section>;
}
