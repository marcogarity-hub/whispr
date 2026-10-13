import { useEffect, useState } from 'react';
import api from '../api.js';
import { formatDuration } from '../formatDuration.js';

export default function StatsPanel({ client = api, refreshKey = 0, onError }) {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setStats(null);
    setError('');
    client.getStats().then((result) => {
      if (active) setStats(result);
    }).catch((reason) => {
      if (!active) return;
      const message = reason.message || 'Unable to load usage statistics.';
      setError(message);
      onError?.(message);
    });
    return () => { active = false; };
  }, [refreshKey, client]);
  return <section className="card" aria-labelledby="stats-title" aria-busy={!error && !stats}><div className="section-heading"><h2 id="stats-title">Your usage</h2><span className="muted">All time</span></div>{error && <p className="error-message" role="alert">{error}</p>}{!error && !stats && <p className="empty">Loading usage statistics…</p>}{!error && stats && <dl className="stats"><div><dt>Total words</dt><dd>{stats.totalWords}</dd></div><div><dt>Dictation time</dt><dd>{formatDuration(stats.totalDurationSeconds)}</dd></div><div><dt>Sessions</dt><dd>{stats.sessionCount}</dd></div><div><dt>Success rate</dt><dd>{Math.round(stats.successRate)}%</dd></div></dl>}</section>;
}
