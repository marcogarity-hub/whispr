function createSync({ fetchImpl = globalThis.fetch, apiUrl, getAuthorization = () => '' } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required');
  if (!apiUrl) throw new Error('An API URL is required');
  const root = String(apiUrl).replace(/\/$/, '');

  async function post(path, body) {
    const response = await fetchImpl(`${root}${path}`, {
      method: 'POST',
      headers: {
        authorization: getAuthorization(),
        'content-type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Cloud save failed');
    return payload;
  }

  return {
    saveDictation: ({ text, mode, duration }) => post('/api/dictations', { text, mode, duration }),
    saveFailedSession: ({ duration, errorMessage }) => post('/api/sessions', {
      status: 'error',
      duration,
      errorMessage
    })
  };
}

module.exports = { createSync };
