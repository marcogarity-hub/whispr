import { useEffect, useState } from 'react';
import api from './api.js';
import StatusCard from './components/StatusCard.jsx';
import BrowserRecorder from './components/BrowserRecorder.jsx';
import TranscriptEditor from './components/TranscriptEditor.jsx';
import StatsPanel from './components/StatsPanel.jsx';
import SignIn from './components/SignIn.jsx';
import UserManagement from './components/UserManagement.jsx';
import PairingApproval, {rememberPairing} from './components/PairingApproval.jsx';

const statusForEvent = {
  'recording-started': 'recording',
  'recording-error': 'error',
  transcribing: 'transcribing',
  'transcription-complete': 'success',
  'transcription-error': 'error',
  'shortcut-error': 'error',
  'save-warning': 'error'
};

function messageForError(error, fallback) {
  return error?.message || fallback;
}

export default function App({client = api} = {}) {
  const [mode, setMode] = useState('exact');
  const [status, setStatus] = useState('idle');
  const [refreshKey, setRefreshKey] = useState(0);
  const [errorMessage, setErrorMessage] = useState('');
  const [unsavedText, setUnsavedText] = useState('');
  const [user,setUser]=useState(null);
  const signedIn=Boolean(user);
  const [loading,setLoading]=useState(true);
  const [signInBusy, setSignInBusy] = useState(false);

  const voiceTyping = typeof window !== 'undefined' ? window.voiceTyping : undefined;
  const isElectron = Boolean(voiceTyping);

  useEffect(() => {
    if (!signedIn || typeof voiceTyping?.onStatus !== 'function') return undefined;
    const unsubscribe=voiceTyping.onStatus((event) => {
      const next = statusForEvent[event?.type] || 'idle';
      setStatus(next);
      if (event?.type === 'recording-started') {
        setErrorMessage('');
        setUnsavedText('');
      } else if (event?.type === 'transcription-complete') {
        setErrorMessage('');
        setUnsavedText('');
        // Electron emits this event after its protected cloud save is confirmed.
        setRefreshKey((key) => key + 1);
      } else if (['recording-error', 'transcription-error', 'shortcut-error', 'save-warning'].includes(event?.type)) {
        setErrorMessage(event.message || 'Whispr could not complete that recording.');
        if (event?.type === 'save-warning' && typeof event.text === 'string') setUnsavedText(event.text);
      }
    });
    return unsubscribe;
  }, [signedIn, voiceTyping]);

  useEffect(() => {
    if (!signedIn || typeof voiceTyping?.onResult !== 'function') return undefined;
    const unsubscribe=voiceTyping.onResult((result) => {
      if (typeof result?.text === 'string') setUnsavedText(result.text);
    });
    return unsubscribe;
  }, [signedIn, voiceTyping]);

  useEffect(() => {
    if (!signedIn || typeof voiceTyping?.getShortcutState !== 'function') return undefined;
    voiceTyping.getShortcutState().then((shortcutState) => {
      if (shortcutState?.registered === false) {
        setStatus('error');
        setErrorMessage(shortcutState.message || 'Whispr could not register Command+Shift+Space.');
      }
    }).catch((error) => setErrorMessage(messageForError(error, 'Whispr could not check shortcut availability.')));
    return undefined;
  }, [signedIn, voiceTyping]);

  useEffect(() => {
    if (signedIn) voiceTyping?.setMode?.(mode);
  }, [mode, signedIn, voiceTyping]);

  useEffect(() => {
    let active=true;
    if(!isElectron)rememberPairing();
    setLoading(true);setUser(null);setUnsavedText('');
    const unsubscribe=client.onAuthFailure(()=>{if(active){setUser(null);setUnsavedText('');setErrorMessage('Your session ended. Sign in again.');}});
    client.getCurrentUser().then(current=>{if(active)setUser(current.user);}).catch(error=>{if(active && error.status!==401)setErrorMessage(messageForError(error,'Unable to check sign-in.'));}).finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;unsubscribe?.();};
  },[client]);

  async function signIn() {
    setSignInBusy(true);setErrorMessage('');
    try {await voiceTyping.signIn();setUser((await client.getCurrentUser()).user);}
    catch(error){setErrorMessage(messageForError(error,'Unable to sign in.'));}
    finally{setSignInBusy(false);}
  }
  async function signOut() {
    try {
      await client.logout();
      await voiceTyping?.logout?.();
      setUser(null);setStatus('idle');setErrorMessage('');setUnsavedText('');
    }catch(error){setErrorMessage(messageForError(error,'Unable to sign out.'));}
  }

  function toggleRecording(nextMode = mode) {
    if (!isElectron) {
      setErrorMessage('Browser recording is being prepared. You can use the Whispr desktop shortcut in the meantime.');
      return;
    }
    if (typeof voiceTyping?.start !== 'function' || typeof voiceTyping?.stop !== 'function') {
      setStatus('error');
      setErrorMessage('Recording is unavailable in this Whispr desktop build.');
      return;
    }
    const action = status === 'recording' ? voiceTyping.stop() : voiceTyping.start(nextMode);
    Promise.resolve(action).catch((error) => {
      setStatus('error');
      setErrorMessage(messageForError(error, 'Whispr could not start recording.'));
    });
  }

  if(loading) return <main className="shell"><p role="status">Checking sign-in…</p></main>;
  if (!signedIn) return <SignIn isElectron={isElectron} onSignIn={signIn} busy={signInBusy} errorMessage={errorMessage || (typeof window!=='undefined' && new URLSearchParams(window.location.search).has('authError')?'Google sign-in could not be completed. Please try again.':'')} />;

  return (
    <main className="shell" key={user.id}>
      <header className="dashboard-header">
        <div><p className="eyebrow">WHISPR</p><h1>Voice typing, made simple.</h1></div>
        <button className="secondary sign-out" type="button" onClick={signOut}>Sign out</button>
      </header>
      <p className="muted">{user.email}</p>
      {!isElectron && <PairingApproval client={client} />}
      {user.role==='owner' && <UserManagement client={client} />}
      <p className="intro">Press the desktop shortcut or use the control below to turn speech into text.</p>
      <section className="card setup-help" aria-labelledby="setup-title">
        <h2 id="setup-title">{isElectron ? 'One-time setup and quick help' : 'Browser recording help'}</h2>
        {isElectron ? <ul><li>Allow Microphone permission so Whispr can hear your dictation.</li><li>Allow Accessibility permission so Whispr can paste into the focused app.</li><li>Press Command+Shift+Space to start and stop recording.</li><li>Exact keeps your words and punctuation; Polished improves phrasing while preserving meaning.</li><li>After transcription, the result is pasted into the focused ChatGPT or Claude window.</li></ul> : <ul><li>Allow Microphone permission when the browser asks.</li><li>The English Whisper tiny model downloads once and runs locally in your browser.</li><li>Audio stays on this device; only finished text and session metadata are saved.</li><li>BrowserRecorder keeps the transcript copyable if a cloud save fails.</li></ul>}
      </section>
      {errorMessage && <p className="error-message global-error" role="alert">{errorMessage}</p>}
      {unsavedText && <section className="card unsaved-card" aria-labelledby="unsaved-title"><h2 id="unsaved-title">Unsaved transcript</h2><p className="muted">Cloud save failed. Copy this text before trying again.</p><textarea aria-label="Unsaved transcript text" readOnly value={unsavedText} /></section>}
      {isElectron
        ? <StatusCard status={status} mode={mode} isElectron onModeChange={setMode} onToggle={() => toggleRecording()} />
        : <BrowserRecorder mode={mode} onModeChange={setMode} onStatus={setStatus} onSaved={() => setRefreshKey((key) => key + 1)} onError={setErrorMessage} />}
      <TranscriptEditor client={client} key={`transcript-${user.id}`} refreshKey={refreshKey} onChanged={() => { setErrorMessage(''); setRefreshKey((key) => key + 1); }} onError={setErrorMessage} />
      <StatsPanel client={client} key={`stats-${user.id}`} refreshKey={refreshKey} onError={setErrorMessage} />
    </main>
  );
}
