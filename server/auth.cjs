const { timingSafeEqual } = require('node:crypto');

function equal(left, right) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function basicAuth({ username, password }) {
  if (!username || !password) throw new Error('Basic auth credentials are required');

  return (request, response, next) => {
    const encoded = /^Basic ([A-Za-z0-9+/=]+)$/.exec(request.headers.authorization || '')?.[1];
    const decoded = encoded ? Buffer.from(encoded, 'base64').toString('utf8') : '';
    const colon = decoded.indexOf(':');
    const valid = colon >= 0
      && equal(decoded.slice(0, colon), username)
      && equal(decoded.slice(colon + 1), password);
    if (!valid) {
      return response
        .set('WWW-Authenticate', 'Basic realm="Whispr"')
        .status(401)
        .json({ error: 'Sign in required' });
    }
    return next();
  };
}

module.exports = { basicAuth };
