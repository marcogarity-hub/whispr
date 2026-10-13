# Whispr

Whispr is a private voice typing dashboard. The desktop app records microphone audio locally,
transcribes it with `whisper-cli`, pastes the finished text into the focused macOS application,
and synchronizes only the finished text and session metadata with the hosted API. Browser
recording also keeps audio on the device and sends no raw audio to the API.

## Desktop use

From this directory, install dependencies and start Electron:

```sh
npm install
npm start
```

The desktop dashboard opens `https://whispr-flow-clone.vercel.app` by default.
Set `WHISPR_DASHBOARD_URL` to use
a local Vite server during development:

```sh
VITE_DEV_SERVER_URL=http://localhost:5173 npm run dev
```

Sign in with the shared Whispr account. Credentials stay in memory in the dashboard and Electron
main process. macOS may ask for Microphone and Accessibility permissions so recording and paste
can work. The global shortcut is Command+Shift+Space.

## Local Whisper setup

Electron expects the existing local model at `.local/whisper/models/ggml-base.en-q5_1.bin` and the
bundled command at `.local/whisper/bin/whisper-cli`. Override these locations when needed:

```sh
LOCAL_TRANSCRIPTION_COMMAND=/path/to/whisper-cli \
LOCAL_TRANSCRIPTION_MODEL=/path/to/model.bin \
npm start
```

The executable and model stay on the Mac and are never uploaded to Vercel. Grant Microphone and
Accessibility permissions when macOS requests them. If the model is not already installed, obtain
the course-provided Whisper files and place them at the paths above, or use the two environment
variable overrides.

## Browser development

Run `npm run dev` and open the Vite URL. Allow microphone access, choose Exact or Polished mode,
and start and stop the browser recorder. On first use, the browser downloads the English Whisper
tiny model from its public model host, caches it when possible, and performs inference locally.
Only finished text and session metadata are sent to the API; use Copy if a save is unavailable.
The Vite `/api` proxy targets the development API at `http://127.0.0.1:3000`.

## Vercel and Supabase deployment checklist

The Vercel project uses the private assignments repository, `ps3/` as its Root Directory, and
`main` as its production branch. `vercel.json` runs the test suite before the Vite build, serves
`dist/`, and rewrites `/api/*` to the `api/index.js` function. Confirm the dashboard Build Command
and Root Directory match those values after importing the repository.

Create separate Supabase development and production projects and apply
`supabase/migrations/20261008000000_init.sql` to each one before sending traffic to its API.
Configure these names in Vercel Project Settings → Environment Variables; enter their values
directly in the host dashboards:

- Production: `BASIC_AUTH_USERNAME`, `BASIC_AUTH_PASSWORD`, `SUPABASE_URL`, and
  `SUPABASE_SERVICE_ROLE_KEY` for the production Supabase project.
- Development: the same four names for the development Supabase project, with a separate shared
  password.
- Enable Vercel's Git system environment variables so `VERCEL_GIT_COMMIT_SHA` is available to
  `/api/version`.

After signing in to Vercel, link the local `ps3/` project and check the development routes:

```sh
vercel link
VERCEL_GIT_COMMIT_SHA="$(git rev-parse HEAD)" vercel dev
```

With `vercel dev` running, `/api/version` should return the commit, an unauthenticated request to
`/api/transcript` should return 401, and an authenticated save/read should round-trip through the
development Supabase project. Do not put credentials in this file, Git, or chat.

After Vercel supplies the verified HTTPS URL, record it and the protected path in `DEPLOY.md`, then
update Electron's fallback URL in `electron/main.cjs`. Keep `WHISPR_DASHBOARD_URL` as the local
override. Before grading, confirm the production build log shows `npm test` before `npm run build`,
compare `/api/version` with the deployed `main` commit, and verify a transcript survives a new
deployment.

## Verification

```sh
npm test
npm run build
```
