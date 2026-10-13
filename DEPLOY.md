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
| `GOOGLE_CLIENT_ID` | Vercel project environment variables, Production | Google OAuth client registration. |
| `GOOGLE_CLIENT_SECRET` | Vercel project environment variables, Production | Server-only Google OAuth secret. |
| `APP_ORIGIN` | Vercel project environment variables, Production | Canonical application origin and redirect/CSRF validation. |
| `OWNER_EMAIL` | Vercel project environment variables, Production | Reserved owner identity used during migration. |
| `VERCEL_GIT_COMMIT_SHA` | Supplied by Vercel through its Git system environment variables | Commit returned by `/api/version`. |

The optional Supabase integration also supplies settings such as `POSTGRES_*`,
`NEXT_PUBLIC_SUPABASE_*`, and additional Supabase keys. The current app reads only
the settings listed above. No database key is embedded in the React build.

Development uses disposable local PostgreSQL for OAuth acceptance and integration tests. Local Google settings are in an ignored .env.local file; no production database credentials are used by tests.

## Historical access rules — Part A (replaced)

| Visitor | Server-enforced access |
| --- | --- |
| Not signed in | May load the frontend and request `/api/version` or `/api/health`; data routes require authentication and return 401 without it. |
| Signed in with the shared account | May read, save, edit, and delete the shared latest transcript, read statistics, and record sessions. Everyone using this account shares the same data. |

The shared account above was replaced by Google OAuth on October 13, 2026. Current access rules are in the Part B table below.

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

## Part B — deployed October 13, 2026

The source implements Google sign-in with `openid email profile`, server-side sessions and CSRF checks. The ownership and authentication migrations were applied atomically with mgarity@umich.edu reserved as owner. Production contained zero transcripts and zero history rows before migration, and the same counts and fingerprints were verified afterward. The following table describes current production behavior.

| Account | Server-enforced access in Part B |
| --- | --- |
| Anonymous | Public frontend, health/version, sign-in; protected data returns 401. |
| Enabled user | Own latest transcript and usage only; owner actions return 403. |
| Owner | Own data plus list users and disable/restore regular accounts; cannot disable owner. |
| Disabled user | Existing sessions revoked; further sign-in refused until restored. |

Additional server settings: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, APP_ORIGIN, OWNER_EMAIL. Google credentials were confirmed present in Vercel on October 13, 2026; APP_ORIGIN and OWNER_EMAIL were added to Vercel Production. Owner is mgarity@umich.edu. Secrets remain outside Git and chat.

See [the release runbook](docs/GOOGLE-AUTH-RELEASE.md) before any production migration. It requires a tested backup restore, a database write freeze, protection of old deployment URLs, transactional migration, and two-account HTTP acceptance tests before writes resume. The production backup was restored successfully into isolated PostgreSQL and the exact migration rehearsed there. Migrations 20261013000000–20261013000003 are applied and recorded. The OAuth candidate passed 72 application tests in Vercel and six real-PostgreSQL tests locally before promotion. Live owner and ordinary-user Google login passed; anonymous transcript access returned 401 and legacy Basic access was rejected. Old generated deployment URLs require Vercel authentication. Data writes were resumed after these checks. Live save/isolation, main auto-deployment and remaining acceptance results are recorded below as completed.

## Remaining submission and manual checks

The class showcase pull request and Canvas submission remain outstanding. Full Electron recording/shortcut/paste acceptance and a classmate repeating the ordinary-user 403 check are still manual checks.
