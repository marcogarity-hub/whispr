const express = require('express');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const {createSessionAuth}=require('./session-auth.cjs');
const {createAuthRoutes}=require('./auth-routes.cjs');
const {createPairingRoutes}=require('./pairing-routes.cjs');
const {createUserRoutes}=require('./user-routes.cjs');
const { createRoutes } = require('./routes.cjs');

function createApp({
  repository = null,
  authStore,
  google,
  appOrigin,
  commit = '',
  clock = () => new Date(),
  staticDirectory = path.join(__dirname, '..', 'dist')
} = {}) {
  if(!authStore || !google || !appOrigin) throw new Error('Authentication configuration is required');
  const app = express();
  const auth=createSessionAuth({store:authStore,appOrigin});
  app.use('/api',(_q,r,next)=>{r.set('Cache-Control','no-store');next();});

  app.use((request, response, next) => {
    request.id = request.get('x-request-id') || randomUUID();
    response.set('x-request-id', request.id);
    next();
  });
  app.use(express.static(staticDirectory));
  app.use(express.json({ limit: '32kb' }));
  app.get('/api/health', (_request, response) => response.json({ ok: true }));
  app.get('/api/version', (_request, response) => response.json({ commit }));
  app.use(createAuthRoutes({store:authStore,google,auth,appOrigin,clock}));
  app.use(createPairingRoutes({store:authStore,auth,appOrigin}));
  app.use(createUserRoutes({store:authStore,auth}));
  app.use('/api',auth.authenticate,(q,r,next)=>['GET','HEAD','OPTIONS'].includes(q.method)?next():auth.csrf(q,r,next));
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
