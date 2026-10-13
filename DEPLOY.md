App: https://whispr-flow-clone.vercel.app
API: https://whispr-flow-clone.vercel.app
Protected: /api/transcript

# Whispr Flow Clone deployment

## Hosts and deployment

| Part | Host | Configuration |
| --- | --- | --- |
| React frontend | Vercel, project `whispr-flow-clone` | Vite output in `dist/`; repository root directory `ps3/`. |
| Express backend | Vercel Functions | `api/index.js`; `/api/*` routes to this function. |
| PostgreSQL database | Supabase, project `Whispr Flow Clone` | Transcript and session tables, with row-level security enabled. The backend uses the server-only service role. |

Source is in the private `marcogarity-hub/si212-assignments-mgarity` repository.
Vercel deploys the production app from `main`. The build command is
`npm test && npm run build`: a failing test prevents the build from proceeding.
`GET /api/version` is public and returns the running Git commit.

## Required settings

Values are entered directly in the host dashboards and are never recorded here.

| Setting | Where it is set | Purpose |
| --- | --- | --- |
| `SUPABASE_URL` | Vercel project environment variables, Production | Production Supabase project URL used by the backend. |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel project environment variables, Production; obtained from Supabase API settings | Server-only database access; never exposed to the frontend. |
| `BASIC_AUTH_USERNAME` | Vercel project environment variables, Production | Shared Part A account username. |
| `BASIC_AUTH_PASSWORD` | Vercel project environment variables, Production | Shared Part A account password. |
| `VERCEL_GIT_COMMIT_SHA` | Supplied by Vercel through its Git system environment variables | Commit returned by `/api/version`. |

The optional Supabase integration also supplies settings such as `POSTGRES_*`,
`NEXT_PUBLIC_SUPABASE_*`, and additional Supabase keys. The current app reads only
the five settings listed above. No database key is embedded in the React build.

Development must use a separate database and separate shared credentials. A hosted
development database has not yet been configured; do not use the production database
for development tests.

## Access rules — Part A

| Visitor | Server-enforced access |
| --- | --- |
| Not signed in | May load the frontend and request `/api/version` or `/api/health`; data routes require authentication and return 401 without it. |
| Signed in with the shared account | May read, save, edit, and delete the shared latest transcript, read statistics, and record sessions. Everyone using this account shares the same data. |

Part B is pending: Google or GitHub OAuth and at least two authorization levels
enforced on the server still need to replace this shared account. The table above
describes the deployed Part A behavior, not completed Part B authorization.

## Database and verification

The schema is in `supabase/migrations/20261008000000_init.sql` and has been applied
to the production project. Data lives in Supabase independently of Vercel deployments.

Verified on October 12, 2026:

- Vercel ran all 62 tests successfully before building the production frontend.
- The public homepage returned HTTP 200.
- `/api/version` returned the deployed `main` commit.
- An unauthenticated `/api/transcript` request returned HTTP 401.
- Supabase contains `transcripts` and `sessions`, both with row-level security enabled.

Still to verify: authenticated saving and reading through the live app, persistence
across a subsequent deployment, a visible change deploying automatically from `main`,
and request logs for a live app action. Part B and the class showcase pull request
remain separate work.
