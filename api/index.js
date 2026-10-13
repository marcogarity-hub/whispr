const { createClient } = require('@supabase/supabase-js');
const { createRepository } = require('../server/repository.cjs');
const { createApp } = require('../server/app.cjs');

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  BASIC_AUTH_USERNAME,
  BASIC_AUTH_PASSWORD,
  VERCEL_GIT_COMMIT_SHA
} = process.env;

for (const [name, value] of Object.entries({
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  BASIC_AUTH_USERNAME,
  BASIC_AUTH_PASSWORD,
  VERCEL_GIT_COMMIT_SHA
})) {
  if (!value) throw new Error(`${name} is required`);
}

const client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

module.exports = createApp({
  repository: createRepository(client),
  username: BASIC_AUTH_USERNAME,
  password: BASIC_AUTH_PASSWORD,
  commit: VERCEL_GIT_COMMIT_SHA
});
