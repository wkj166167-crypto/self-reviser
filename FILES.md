# Self Reviser — Files and Resources

All paths below are relative to the project root unless marked otherwise.
Secrets are intentionally not included.

## Application source

| Path | Purpose |
|---|---|
| `index.html` | Public exhibition document shell. |
| `src/main.js` | Draft/paragraph state, Comments, six-pass tasks, Track Changes animation, persistence client, linked reading behavior. |
| `src/styles.css` | Word-like public interface styling. |
| `src/draft-live.css` | Draft/editor-specific styles. |
| `server.js` | Express API, OpenAI prompt/request layer, Supabase persistence, archive/admin endpoints. |
| `api/index.js` | Vercel serverless entry point wrapping Express app. |
| `admin.html` | Private archive page shell. |
| `src/admin.js` | Admin authentication/list/detail/JSON download behavior. |
| `src/admin.css` | Private archive styling. |
| `vite.config.js` | Vite configuration. |
| `package.json` | Dependencies and `dev`, `start`, `build`, `check` scripts. |
| `pnpm-lock.yaml` | Locked dependency graph. |
| `vercel.json` | Vercel build/function/rewrite configuration. |
| `render.yaml` | Historic Render fallback deployment configuration. |

## Persistence and configuration

| Path | Purpose |
|---|---|
| `supabase/migrations/001_phase1_exhibition_archive.sql` | PostgreSQL schema, RPC/persistence setup for archive Phase 1. |
| `.env.example` | Safe variable-name template. |
| `.env` | Local secrets/configuration; **excluded from Git and ZIP**. |
| `.gitignore` | Ensures `.env`, dependencies, build output, and local OS files are excluded. |

Required environment variable names:

```text
OPENAI_API_KEY
OPENAI_MODEL
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
ARCHIVE_SESSION_TOKEN_PEPPER
ARCHIVE_DIAGNOSTIC_SECRET
EXHIBITION_TIMEZONE
ADMIN_EMAIL_ALLOWLIST
APP_BASE_URL
NODE_ENV
HOST
```

## Specifications and handoff documents

| Path | Purpose |
|---|---|
| `SYSTEM_SPECIFICATION.md` | Current formal interaction/persistence specification. |
| `README.md` | Installation, run, test, deployment reference. |
| `HANDOFF.md` | Full project/context transfer document. |
| `TASKS.md` | Status and priorities. |
| `DECISIONS.md` | Rationale and non-negotiable design decisions. |
| `FILES.md` | This index. |

## Offline printable archive assets

| Path | Purpose |
|---|---|
| `archive-inputs/test-archive-001.txt` | Selected Chinese original Draft used for print testing. |
| `scripts/generate-printable-archive.mjs` | Calls deployed Notes/Pass 1–6 endpoints to create structured archive data. Cost/network-bearing; do not run casually. |
| `scripts/render-archive-from-pipeline.mjs` | Renders saved structured data into Word-style printable HTML. |
| `scripts/render-archive-html.mjs` | Uses local Playwright/Chromium to make PDF from archive HTML. |
| `scripts/generate-final-paper-variant.mjs` | Generates alternate clean final paper from accepted Pass 6 via OpenAI. Requires explicit consent for private text transmission. |
| `scripts/compose-plural-theory-archive.mjs` | Substitutes plural-theory Pass 6/final-paper material into a complete archive. |
| `output/archive-data/self-reviser-test-archive-001-pipeline.json` | Original generated archive state, Notes, Pass 1–6, metadata. |
| `output/archive-data/self-reviser-test-archive-001-plural-theory-pipeline.json` | Combined archive state with corrected plural-theory Pass 6. |
| `output/paper-variants/self-reviser-test-archive-001-plural-theory-paper.json` | Alternate title/abstract/keywords/body. |
| `output/pdf/self-reviser-test-archive-001-printable-archive.pdf` | Original full printable archive. |
| `output/pdf/self-reviser-test-archive-001-plural-theory-paper.pdf` | Clean alternate paper only. |
| `output/pdf/self-reviser-test-archive-001-plural-theory-complete.pdf` | Latest complete combined archive. |

## Temporary/generated QA files

| Path | Purpose | Transfer status |
|---|---|---|
| `tmp/archive-render/*.html` | Intermediate static HTML for print rendering. | Included only if needed for diagnosis; can be regenerated. |
| `tmp/pdfs/**/*.png` | Page-image visual QA renders. | Not required to run project; excluded from ZIP to avoid duplication. |
| `dist/` | Vite production build. | Regenerate with `npm run build`; excluded from ZIP. |
| `node_modules/` | Installed dependencies. | Regenerate with package manager; excluded from ZIP. |

## Historical motion prototypes

All root-level `exhibition-motion*.html` files are preserved. They record the
motion-film phase and visual evolution. Important examples:

| Path | Significance |
|---|---|
| `exhibition-motion-v21.html` | Canonical motion behavior reference before interactive translation. |
| `exhibition-motion-v21-english.html` | English display variation. |
| `exhibition-motion-v28-v21-visual.html` | V21 behavior with later visual exploration. |
| `exhibition-motion-v29-word-review.html` | Word Review Mode direction. |
| `exhibition-motion-v30-word-environment.html` | Word workspace/ribbon environment direction. |
| `exhibition-motion-v31-word-refined.html` | Refined Word visual iteration. |
| `exhibition-motion-v32-word-layout.html` | Later Word layout study. |

Other numbered variants (`exhibition-motion.html`, `-v2` through `-v27`) are
historic studies. Keep them unless a separate curation decision is made.

## External references / services

| Resource | Role |
|---|---|
| `https://self-reviser.vercel.app` | Current public deployment. |
| `https://github.com/wkj166167-crypto/self-reviser` | Current code repository. |
| Supabase project | Persistent database and Auth. Project URL/key values are not recorded here. |
| OpenAI API | Server-side Editorial Notes, Revision, and offline paper generation. |
| Microsoft Word 2010 Review Mode screenshots | Visual reference only; do not recreate full Word functionality. |
| Institutional narrative report image | Reference for final clean printable paper layout. |

The original screenshots and pasted-text attachments live in the originating
Codex conversation attachment store, outside this repository. Their concepts
and requirements are preserved in `HANDOFF.md`, `DECISIONS.md`, and
`SYSTEM_SPECIFICATION.md`; no external private attachment is copied into this
ZIP without an explicit separate consent/check.
