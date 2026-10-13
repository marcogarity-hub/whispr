const jsonHeaders = { 'content-type': 'application/json' };

function countWords(text) {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

export function createApiClient(fetchImpl = globalThis.fetch, desktopBridge = typeof window !== 'undefined' ? window.voiceTyping : null) {
  let csrfToken = '';
  let authFailure = () => {};
  function clearSession() { csrfToken = ''; }
  function onAuthFailure(callback) { authFailure=callback; return () => { if(authFailure===callback) authFailure=()=>{}; }; }
  async function getCurrentUser() {const current=await request('/auth/me');csrfToken=current.csrfToken;return current;}
  async function logout() {await request('/auth/logout',{method:'POST'});clearSession();}

  async function request(path, options = {}) {
    if (typeof fetchImpl !== 'function') throw new Error('Fetch is unavailable');
    const headers = { ...(options.body ? jsonHeaders : {}), ...(options.headers || {}) };
    if (!['GET','HEAD'].includes(options.method || 'GET') && csrfToken) headers['x-csrf-token']=csrfToken;
    const response = desktopBridge?.requestApi
      ? await desktopBridge.requestApi({path,method:options.method || 'GET',body:options.body ? JSON.parse(options.body) : undefined}).then(result=>({status:result.status,ok:result.ok,json:async()=>result.payload}))
      : await fetchImpl(`/api${path}`, { ...options, headers, credentials:'same-origin' });
    if (response.status === 204) return undefined;
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error=Object.assign(new Error(payload.error || 'Request failed'),{status:response.status});
      if(response.status===401){clearSession();authFailure();}
      throw error;
    }
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

  return { getPairing:id=>request(`/auth/pairing/approve?id=${encodeURIComponent(id)}`), approvePairing:id=>request('/auth/pairing/approve',{method:'POST',body:JSON.stringify({pairingId:id})}), getCurrentUser, logout, clearSession, onAuthFailure, listUsers:()=>request('/users'), disableUser:id=>request(`/users/${encodeURIComponent(id)}/disable`,{method:'POST'}), restoreUser:id=>request(`/users/${encodeURIComponent(id)}/restore`,{method:'POST'}), getStats, getTranscript, updateTranscript, deleteTranscript, saveDictation, saveFailedSession };
}

