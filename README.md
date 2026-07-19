# Self Reviser

Interactive exhibition writing workspace with persistent, private archive support.

## Local setup

1. Install dependencies:

```bash
npm install
```

2. Create a local `.env` file from the example:

```bash
cp .env.example .env
```

3. Fill in `.env` locally:

```bash
OPENAI_API_KEY=
OPENAI_MODEL=

# Required for Phase 1 persistent sessions
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
ARCHIVE_SESSION_TOKEN_PEPPER=
ARCHIVE_DIAGNOSTIC_SECRET=
EXHIBITION_TIMEZONE=Europe/London
```

Do not commit `.env`. All keys are read only by the server. In particular,
`SUPABASE_SERVICE_ROLE_KEY` must never be exposed to browser code.

4. Start the app:

```bash
npm run dev
```

Open `http://localhost:5173`.

The dev server uses Express for `/api/revise` and Vite middleware for the frontend.

## Phase 1 archive setup

1. Create a Supabase project and run
   [`supabase/migrations/001_phase1_exhibition_archive.sql`](./supabase/migrations/001_phase1_exhibition_archive.sql)
   in its SQL editor.
2. Fill in the archive environment variables above. Generate both archive
   secrets with a password manager; they are not visitor-facing values.
3. Start the site and write a short paragraph. Its browser-local session token
   permits refresh recovery, while its structured content is written to
   Supabase through the Express server.
4. From a staff terminal, verify the connection without exposing a public UI:

   ```bash
   curl -H "X-Archive-Diagnostic-Key: YOUR_SECRET" http://127.0.0.1:5173/api/archive/diagnostics
   ```

   A successful response reports `configured: true` and `database.ok: true`.
   Confirm the resulting record in Supabase's `exhibition_sessions` table,
   refresh the same browser, and verify that the active manuscript returns.

Phase 1 stores data only in PostgreSQL. Private admin authentication, PDFs,
snapshots, and ZIP export are intentionally deferred to later phases.

## Phase 2 private archive setup

1. In Supabase Authentication, invite each administrator email before use. Do
   not enable public sign-up.
2. Add `ADMIN_EMAIL_ALLOWLIST` as a comma-separated set of those invited email
   addresses. Set `APP_BASE_URL` to the current deployment origin. During local
   testing it is `http://127.0.0.1:5173`.
3. In Supabase Auth URL configuration, permit
   `http://127.0.0.1:5173/admin/archive` as a redirect URL. Add the Render
   equivalent before production deployment.
4. Visit `/admin/archive`, request a magic link with an allow-listed email, and
   open the link in the same browser. The private page exposes session search,
   detail inspection, and JSON download only. It has no public counterpart.

## Render deployment preparation

The repository includes [`render.yaml`](./render.yaml) for the web service. It
builds the static frontend, starts the Express server, and makes the server
listen on Render's public network interface. It does not contain any secrets.

1. Push this project to a private GitHub repository, then create a Render **Web
   Service** from that repository. Render will read `render.yaml` if you choose
   the Blueprint option, or you can use the commands specified there manually.
2. In Render's **Environment** settings, add the following exact values from
   your local `.env`: `OPENAI_API_KEY`, `OPENAI_MODEL`, `SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY`, `ARCHIVE_SESSION_TOKEN_PEPPER`,
   `ARCHIVE_DIAGNOSTIC_SECRET`, and `ADMIN_EMAIL_ALLOWLIST`.
3. Leave `HOST=0.0.0.0`, `NODE_ENV=production`, and
   `EXHIBITION_TIMEZONE=Europe/London` as declared in `render.yaml`.
4. After Render gives the service a public URL, add that URL as
   `APP_BASE_URL` in Render, for example `https://self-reviser.onrender.com`.
   In Supabase Authentication → URL Configuration, also add
   `https://self-reviser.onrender.com/admin/archive` as an allowed redirect
   URL. Update the Site URL to the same Render origin when this becomes the
   exhibition deployment.
5. Redeploy once after adding `APP_BASE_URL`, then test the public page,
   `/api/archive/diagnostics` from a staff terminal, and `/admin/archive`.

Do not copy `.env` into Git or into a browser-facing Vite variable. The
Supabase service key and archive secrets must exist only in Render's private
environment settings.

## API

`POST /api/revise`

Request body:

```json
{
  "original_narrative": "Draft text",
  "editorial_intensity": "low"
}
```

Allowed intensity values: `low`, `medium`, `high`.

## Development mode

The frontend calls the real `/api/revise` endpoint by default.

For interface-only testing without API access, add `?mock=1` to the URL. Mock mode is explicit and should not be used to judge AI revision quality.
