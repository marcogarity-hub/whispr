const express = require('express');

function validText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validDuration(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

const wrap = fn => (request, response, next) => Promise.resolve(fn(request, response, next)).catch(next);

function createRoutes({ repository, clock = () => new Date() }) {
  if (!repository) throw new Error('A repository is required');
  const router = express.Router();
  const timestamp = () => clock().toISOString();

  router.post('/api/dictations', wrap(async (request, response) => {
    const { text, mode, duration } = request.body || {};
    if (!validText(text) || !['exact', 'polished'].includes(mode) || !validDuration(duration)) {
      return response.status(400).json({ error: 'Valid text, mode, and duration are required' });
    }
    const result = await repository.saveDictation({
      text: text.trim(),
      mode,
      duration,
      timestamp: timestamp()
    });
    return response.status(201).json(result);
  }));

  router.get('/api/transcript', wrap(async (_request, response) => {
    const transcript = await repository.getLatestTranscript();
    return transcript
      ? response.json(transcript)
      : response.status(404).json({ error: 'No latest transcript exists' });
  }));

  router.put('/api/transcript', wrap(async (request, response) => {
    const { id, text } = request.body || {};
    if (id !== 1 || !validText(text)) {
      return response.status(400).json({ error: 'id 1 and nonempty text are required' });
    }
    const transcript = await repository.updateTranscript(1, text.trim(), timestamp());
    return transcript
      ? response.json(transcript)
      : response.status(404).json({ error: 'No latest transcript exists' });
  }));

  router.delete('/api/transcript', wrap(async (_request, response) => {
    const deleted = await repository.deleteTranscript();
    return deleted ? response.status(204).end() : response.status(404).json({ error: 'No latest transcript exists' });
  }));

  router.get('/api/stats', wrap(async (_request, response) => response.json(await repository.getStats())));

  router.post('/api/sessions', wrap(async (request, response) => {
    const { status, duration, errorMessage } = request.body || {};
    if (status !== 'error' || !validDuration(duration) || typeof errorMessage !== 'string') {
      return response.status(400).json({ error: 'An error status, duration, and error message are required' });
    }
    const session = await repository.saveFailedSession({ duration, errorMessage, timestamp: timestamp() });
    return response.status(201).json(session);
  }));

  return router;
}

module.exports = { createRoutes, validText, validDuration, wrap };
