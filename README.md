# Self Reviser

Interactive exhibition writing environment in which a visitor's unfinished
Draft is read through Editorial Notes and six rounds of tracked institutional
revision. The project is an artwork about the transformation of lived
experience into institutionally legible language; it is not a writing assistant
or diagnostic tool.

Current production: [self-reviser.vercel.app](https://self-reviser.vercel.app)

For full project transfer information, read:

- [HANDOFF.md](./HANDOFF.md)
- [TASKS.md](./TASKS.md)
- [DECISIONS.md](./DECISIONS.md)
- [FILES.md](./FILES.md)
- [SYSTEM_SPECIFICATION.md](./SYSTEM_SPECIFICATION.md)

## Requirements

- Node.js 20+ recommended
- npm or pnpm
- An OpenAI API project/key for live Notes and Revision
- A Supabase project for persistent Sessions and the private archive

## Local installation

```bash
npm install
cp .env.example .env
```

Fill only the local `.env` file. Do **not** commit it or send it to a browser.

```dotenv
OPENAI_API_KEY=<server-only OpenAI API key>
OPENAI_MODEL=<selected model name>

SUPABASE_URL=<Supabase project URL>
SUPABASE_SERVICE_ROLE_KEY=<server-only Supabase service role key>
ARCHIVE_SESSION_TOKEN_PEPPER=<random secret>
ARCHIVE_DIAGNOSTIC_SECRET=<random staff diagnostic secret>
EXHIBITION_TIMEZONE=Europe/London

ADMIN_EMAIL_ALLOWLIST=<comma-separated invited administrator email addresses>
APP_BASE_URL=http://127.0.0.1:5173
```

Start the development server:

```bash
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173).

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Start Express + Vite development server. |
| `npm run start` | Start production-style Express server. |
| `npm run build` | Build Vite frontend into `dist/`. |
| `npm run check` | Syntax-check server and main frontend source. |

The browser frontend talks only to this server. The server owns OpenAI and
Supabase credentials.

## Supabase setup and persistence test

1. In Supabase SQL Editor, run
   [`supabase/migrations/001_phase1_exhibition_archive.sql`](./supabase/migrations/001_phase1_exhibition_archive.sql).
2. Add the Supabase values and archive secrets to `.env`.
3. Start the app, write a paragraph, and confirm an `exhibition_sessions` row
   appears in Supabase.
4. Refresh the same browser and confirm the active Session restores.
5. Run staff diagnostics locally:

   ```bash
   curl -H "X-Archive-Diagnostic-Key: <ARCHIVE_DIAGNOSTIC_SECRET>" \
     http://127.0.0.1:5173/api/archive/diagnostics
   ```

Expected result includes `configured: true` and `database.ok: true`.

The staff shortcut `Ctrl + Alt + R` saves/closes the current Session and clears
only the public interface. It does not delete archived data.

## Private archive administration

The public website has no save/archive controls. Private administration is at:

```text
/admin/archive
```

Before using it:

1. Invite the administrator accounts in Supabase Auth; do not enable public
   sign-up.
2. Put the invited addresses in `ADMIN_EMAIL_ALLOWLIST`.
3. Add both local and deployed `/admin/archive` URLs in Supabase Auth → URL
   Configuration.
4. Set `APP_BASE_URL` to the current deployment origin.

The page uses magic-link email. The current Supabase default sender may hit a
rate limit; configure SMTP before relying on it during/after exhibition.

## Vercel deployment

Vercel is the active deployment target. `vercel.json` handles the Vite build,
Express API serverless function, and `/admin/archive` rewrite.

1. Push this repository to GitHub.
2. Import the repository into Vercel.
3. Add every variable from `.env` in Vercel Project Settings → Environment
   Variables. Use the same variable names; never use `VITE_` for secrets.
4. Deploy.
5. Set `APP_BASE_URL=https://<your-vercel-domain>` in Vercel.
6. Add the Vercel origin and
   `https://<your-vercel-domain>/admin/archive` to Supabase Auth URL
   Configuration.
7. Verify public writing, Supabase session persistence, refresh recovery, and
   diagnostics.

`render.yaml` remains only as historical fallback. Render deployment previously
failed due to private-repository authorization; do not treat it as production
configuration.

## Exhibition behavior in brief

- Visitors type only in the left Draft.
- Enter commits new text and starts its six-pass revision task.
- Submitted Draft paragraphs lock; a new editable paragraph is created.
- Comments read at paragraph scope.
- Revision reads a frozen whole-document context but edits only the initiating
  paragraph.
- A visitor may keep writing while earlier paragraphs revise.
- Passes 1–6 are sequential per paragraph and retain Track Changes.
- The Draft remains author-owned; do not automatically rewrite it.

Read `SYSTEM_SPECIFICATION.md` before changing behavior or prompts.

## Offline printable archives

The local scripts under `scripts/` generate a selected-manuscript PDF without
changing the public exhibition or database:

```bash
# Network/API-bearing: creates full structured archive data from a selected Draft.
node scripts/generate-printable-archive.mjs

# Local rendering from saved data.
node scripts/render-archive-from-pipeline.mjs test-archive-001
node scripts/render-archive-html.mjs \
  tmp/archive-render/test-archive-001.html \
  output/pdf/self-reviser-test-archive-001-printable-archive.pdf
```

The current best combined example is:

`output/pdf/self-reviser-test-archive-001-plural-theory-complete.pdf`

The plural-theory paper generator sends an accepted Pass 6 manuscript to the
OpenAI API. Obtain explicit consent before running it on private writing.

## Security notes

- Never commit `.env`.
- Never expose `SUPABASE_SERVICE_ROLE_KEY`, OpenAI keys, archive peppers,
  diagnostic secrets, or session write tokens to client code.
- Rotate any secret that may have been copied into an unsafe place.
- The handoff ZIP excludes `.env`, dependencies, temporary QA images, Git
  metadata, and build output.
