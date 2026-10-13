const labels = {
  idle: 'Ready to listen',
  recording: 'Listening…',
  transcribing: 'Transcribing…',
  success: 'Transcript ready',
  error: 'Something went wrong'
};

export default function StatusCard({ status = 'idle', mode = 'exact', shortcut = '⌘ ⇧ Space', isElectron = true, onModeChange, onToggle }) {
  return (
    <section className={`card status-card status-${status}`} aria-labelledby="status-title">
      <div className="status-heading"><div><p className="eyebrow">STATUS</p><h2 id="status-title">{labels[status] || labels.idle}</h2></div><span className="status-dot" aria-hidden="true" /></div>
      {isElectron ? <p className="status-detail">Shortcut: <strong>{shortcut}</strong></p> : <p className="status-detail">Browser recording is being prepared.</p>}
      <label>Mode<select value={mode} onChange={(event) => onModeChange?.(event.target.value)} aria-label="Mode">
        <option value="exact">Exact</option>
        <option value="polished">Polished</option>
      </select></label>
      <button type="button" onClick={onToggle} disabled={!isElectron}>{status === 'recording' ? 'Stop recording' : isElectron ? 'Start recording' : 'Browser recording is being prepared'}</button>
    </section>
  );
}
