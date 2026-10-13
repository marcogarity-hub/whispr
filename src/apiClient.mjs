const jsonHeaders = { 'content-type': 'application/json' };

function encodeCredentials(username, password) {
  const value = `${username}:${password}`;
  if (typeof globalThis.btoa === 'function') return globalThis.btoa(value);
  if (globalThis.Buffer) return globalThis.Buffer.from(value).toString('base64');
  throw new Error('Basic authentication is not available in this browser');
}

function countWords(text) {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

export function createApiClient(fetchImpl = globalThis.fetch) {
  let authorization = null;

  function setCredentials(username, password) {
    authorization = `Basic ${encodeCredentials(username, password)}`;
  }

  function clearCredentials() {
    authorization = null;
  }

  async function request(path, options = {}) {
    if (typeof fetchImpl !== 'function') throw new Error('Fetch is unavailable');
    const headers = { ...(options.body ? jsonHeaders : {}), ...(options.headers || {}) };
    if (authorization) headers.authorization = authorization;
    const response = await fetchImpl(`/api${path}`, { ...options, headers });
    if (response.status === 204) return undefined;
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Request failed');
    return payload;
  }

  async function getTranscript() {
    try {
      return await request('/transcript');
    } catch (error) {
      if (error.message === 'No latest transcript exists') return null;
      throw error;
    }
  }

  function updateTranscript(id, text) {
    return request('/transcript', {
      method: 'PUT',
      body: JSON.stringify({ id, text, wordCount: countWords(text) })
    });
  }

  function deleteTranscript() {
    return request('/transcript', { method: 'DELETE' });
  }

  async function getStats() {
    const stats = await request('/stats');
    return {
      totalWords: stats.totalWords,
      totalDurationSeconds: stats.totalDurationSeconds,
      sessionCount: stats.sessionCount,
      successRate: stats.successRate
    };
  }

  function saveDictation({ text, mode, duration }) {
    return request('/dictations', {
      method: 'POST',
      body: JSON.stringify({ text, mode, duration })
    });
  }

  function saveFailedSession({ duration, errorMessage }) {
    return request('/sessions', {
      method: 'POST',
      body: JSON.stringify({ status: 'error', duration, errorMessage })
    });
  }

  return { setCredentials, clearCredentials, getStats, getTranscript, updateTranscript, deleteTranscript, saveDictation, saveFailedSession };
}

