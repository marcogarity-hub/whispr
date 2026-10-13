const express = require('express');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { basicAuth } = require('./auth.cjs');
const { createRoutes } = require('./routes.cjs');

function createApp({
  repository = null,
  username,
  password,
  commit = '',
  clock = () => new Date(),
  staticDirectory = path.join(__dirname, '..', 'dist')
} = {}) {
  const app = express();

  app.use((request, response, next) => {
    request.id = request.get('x-request-id') || randomUUID();
    response.set('x-request-id', request.id);
    next();
  });
  app.use(express.static(staticDirectory));
  app.use(express.json({ limit: '32kb' }));
  app.get('/api/health', (_request, response) => response.json({ ok: true }));
  app.get('/api/version', (_request, response) => response.json({ commit }));
  app.use('/api', basicAuth({ username, password }));
  if (repository) app.use(createRoutes({ repository, clock }));

  app.use((error, request, response, _next) => {
    const status = error?.type === 'entity.too.large' ? 413 : error?.type === 'entity.parse.failed' ? 400 : 500;
    console.error('Whispr request failed', {
      method: request.method,
      path: request.path,
      status,
      requestId: request.id
    });
    if (response.headersSent) return undefined;
    return response.status(status).json({ error: status === 500 ? 'Request failed' : 'Invalid request' });
  });

  return app;
}

module.exports = { createApp };
