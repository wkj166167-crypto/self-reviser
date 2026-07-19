# Self Reviser — Project Handoff

**Prepared:** 19 July 2026 (Europe/London)  
**Repository:** `https://github.com/wkj166167-crypto/self-reviser` (private at the time of writing)  
**Public deployment:** `https://self-reviser.vercel.app`  
**Primary workspace:** `/Users/marigold/Documents/New project`

## 1. Project purpose

Self Reviser is an interactive exhibition artwork about how an AI system reads,
comments on, categorises, and progressively institutionalises a visitor's
personal writing. It is **not** a writing-improvement product and must not be
framed as a chatbot, productivity tool, therapeutic system, or diagnostic
instrument.

The central contrast is deliberate:

- The visitor writes an unfinished, uncertain, self-interpreting Draft.
- Editorial Notes read one paragraph at a time and ask for clarification,
  definition, distinction, evidence, or a more precise relation.
- The Revision system rereads the wider committed document, but edits the
  paragraph that initiated a task.
- Across six passes, the system's voice moves from light copy editing to an
  institutionally authored interpretation.

The artwork should leave viewers with the sense that lived experience remains
present, but its ambiguity and interpretive openness are gradually covered by
layers of more stable institutional language.

## 2. Current deliverables

### A. Interactive exhibition website — operational

The live application is a Word 2010 Review Mode-inspired, two-page workspace:

```text
Left page:  Draft + Editorial Notes
Right page: Revision with Track Changes
```

The public page is intentionally sparse. The Word ribbon, workspace, rulers,
status bar, page shadows, comments, red insertions, and grey deletions are
scenographic rather than functional software controls. The active areas are
only the Draft, Editorial Notes, and Revision.

### B. Persistent exhibition archive — Phases 1 and 2 operational

Supabase PostgreSQL stores session snapshots and normalised paragraph/comment/
revision records. The project has been tested for:

- session creation after first input;
- browser refresh recovery of an active session;
- staff reset preserving the earlier session as completed;
- creation of a subsequent active session;
- archive database diagnostics;
- private `/admin/archive` route, email magic-link flow, allow-list checks,
  session list/detail, and JSON export.

The public display also reads committed paragraphs across sessions as a
cumulative manuscript. A new visitor's session is therefore saved separately,
but older committed writing remains visible in the exhibition document.

### C. Printable offline archive prototype — operational, not visitor-facing

One supplied Chinese five-paragraph Draft was processed through the deployed
Editorial Notes and Pass 1–6 pipeline. The printable archive contains:

1. Original Draft + globally numbered Editorial Notes
2. Pass 1
3. Pass 2
4. Pass 3
5. Pass 4
6. Pass 5
7. Pass 6
8. Cover, abstract/keywords, and clean institutional narrative paper

The most recent complete PDF is:

`output/pdf/self-reviser-test-archive-001-plural-theory-complete.pdf`

Its Pass 6 correctly shows the completed Pass 5 wording as grey struck-through
deletion and the alternate plural-theory reading as red insertion. The final
paper is a clean accepted-text version.

## 3. Core interaction model

### Draft writing and Enter behaviour

- Draft input is keyboard-based only. Voice/dictation was intentionally removed
  in full, including browser speech-recognition logic and controls.
- The first non-empty input begins a single visitor Session.
- The user writes in the current editable paragraph. Prior submitted paragraphs
  are locked/read-only but can be selected/copied.
- Enter with new uncommitted text commits that paragraph, starts a Revision
  task, creates a new editable paragraph, and moves the caret there.
- Enter on an unchanged current paragraph creates a normal paragraph break.
- Shift+Enter always creates a manual line break.
- Typing pauses, caret movement, and scrolling never commit or begin Revision.
- A three-second auto-commit rule was explicitly removed.
- Pasted multiline writing keeps paragraph breaks. The next pending paragraph is
  activated after the current one is committed.

### Editorial Notes

- Notes read at paragraph scope, independently from Revision.
- Sentence-ending punctuation in live typing can trigger a Notes read.
- A completed paste triggers **one** Notes read if the live paragraph has a
  complete sentence; it does not trigger one request per punctuation mark.
- Notes are anchored to specific phrases/sentences in the Draft margin.
- They may be active, addressed, partially addressed, or require further
  clarification in the data model. They must not automatically rewrite Draft.
- Comments should arise from paragraph/context reading, not a permanent
  keyword-matching mechanism. Keyword rules were only a historic mock.

### Revision tasks and document snapshots

- Each committed paragraph gets a stable paragraph ID and an independent task.
- Tasks can overlap across paragraphs. A new paragraph must remain writable
  while earlier paragraphs revise.
- Passes inside one paragraph task are sequential.
- At the start of every pass the client freezes a document-context snapshot:
  latest completed revision text from all committed paragraphs in document order.
- The task reads the complete snapshot but may operate only on its own target
  paragraph. Uncommitted live writing is visible but never enters AI context.
- A later pass rereads the newly evolving institutional document; all six passes
  must not be pre-planned from the initial Draft.

### Six-pass editorial progression

1. **Copy Editing** — grammar, punctuation, repetition, readability; no new
   interpretation.
2. **Editorial Editor** — supported clarification and reference resolution;
   ordinary authorial language remains.
3. **Academic Reader** — a restrained, provisional conceptual relation.
4. **Institutional Interpreter** — selects/organises a supported interpretation.
5. **Institutional Reviewer** — conceptual and terminological consistency with
   the wider manuscript.
6. **Institutional Author** — independent qualitative-journal-style synthesis:
   observation → interpretation → qualification → provisional conclusion. It
   treats the narrative as an analytical object, not a diary to polish.

Pass 6 may cite only genuinely supported theoretical frameworks. The project has
used Festinger (1954), Higgins (1987), Goffman (1959), and Hacking (1999).
References must be cautious, concise, non-diagnostic, and explained on their
first use. The plural-theory offline variation intentionally reduces Goffman's
dominance and distributes theoretical work across different concepts.

## 4. Visual requirements

- Microsoft Word 2010 Review Mode is a visual language reference, not a literal
  application recreation.
- White pages sit side by side in a grey Word-like workspace.
- Draft and Revision have matching starting positions, typography, paragraph
  rhythm, margins, and baseline size.
- Editorial Notes live inside the right margin of the left Word page: compact,
  thin red borders, tight padding, clear anchor/connector relationship.
- Revision retains black source text as dominant. Grey strikethrough represents
  deletion; red text represents insertion/replacement.
- Only one active Revision attention cursor should appear at a time.
- No SaaS UI, rounded cards, glassmorphism, gradients, dashboard aesthetic,
  chat UI, glitch, blur, or diagnostic visual effects.
- Draft is clean/author-owned. "Draft contamination" through automatic left-side
  Track Changes was deliberately deferred and must not be reintroduced without
  a fresh design decision.

## 5. Data, archive, and privacy model

### Session rules

- One visitor session begins at first input and may include multiple paragraphs.
- Paragraph Pass 6 completion is `revision-complete` for that paragraph only;
  it never closes a session.
- `Ctrl + Alt + R` is the staff reset/new-session shortcut. It saves/close-tags
  the active session, clears the public UI, and starts the next session only on
  next input. It never deletes stored work.
- A session with one or more committed paragraphs closes as `completed`; a
  draft-only unfinished session closes as `incomplete`.
- Local storage holds an opaque session ID/write token for refresh recovery.
  Secrets and service-role access remain server-side.

### Persistence

- Supabase PostgreSQL is the persistent source of truth. Do not save exhibition
  material to a deployment filesystem.
- Autosave is debounced for typing and immediate for commit/Notes/pass changes.
- The migration is `supabase/migrations/001_phase1_exhibition_archive.sql`.
- Diagnostic endpoint: `GET /api/archive/diagnostics` with
  `X-Archive-Diagnostic-Key: <ARCHIVE_DIAGNOSTIC_SECRET>`.
- Private archive route: `/admin/archive`.

## 6. Deployment history

### Current production host: Vercel

- Vercel deployment is working at `https://self-reviser.vercel.app`.
- `vercel.json` builds Vite, maps `/api/*` to `api/index.js`, and rewrites
  `/admin/archive` to `admin.html`.
- Supabase Auth URL configuration must include the deployed
  `/admin/archive` callback URL and the Vercel origin.
- The application uses server-side environment variables; never prefix secrets
  with `VITE_`.

### Render attempt: superseded

- Render configuration is retained in `render.yaml`.
- Deployment was blocked by GitHub private-repository authorization/403 issues.
- The repository was temporarily made public to investigate, then Vercel was
  selected as the practical deployment path. Do not assume Render is current.

### Admin magic-link issue

- Supabase's default email sender hit a rate limit (`429
  over_email_send_rate_limit`) during testing. The public exhibition does not
  depend on admin email delivery, so this was deferred until after exhibition.
- Before relying on admin access in production, configure reliable transactional
  SMTP in Supabase Auth and repeat login tests.

## 7. Offline printable-archive workflow

The archive workflow is local and deliberately separate from visitor behavior.
It does not modify Supabase or the public site.

1. Place a selected original Draft in `archive-inputs/`.
2. Run `scripts/generate-printable-archive.mjs` once to call the existing
   deployed Notes and Pass 1–6 endpoints and save structured results.
3. Use `scripts/render-archive-from-pipeline.mjs <archive-id>` to make a
   Word-page archive HTML document from saved data.
4. Use `scripts/render-archive-html.mjs <html> <pdf>` to make the PDF.
5. Use `scripts/generate-final-paper-variant.mjs` only when testing a different
   final academic-paper interpretation from an accepted Pass 6. This calls the
   OpenAI API and requires explicit consent for sending private manuscript text.
6. `scripts/compose-plural-theory-archive.mjs` combines the variation with
   earlier Passes into a complete archive.

The current archive test has two PDFs:

- `self-reviser-test-archive-001-printable-archive.pdf`: original Pass 6
  archive version.
- `self-reviser-test-archive-001-plural-theory-complete.pdf`: latest complete
  archive with corrected Pass 6 deletion/insertion layering and plural-theory
  final paper.

## 8. Historic motion prototypes

The root contains many `exhibition-motion*.html` files. They are historical
motion-study iterations, not the live website. They document the evolution from
looping exhibition film to interactive writing interface. The most important
historic conceptual reference is `exhibition-motion-v21.html`, which became the
canonical behavioral reference before the interactive implementation.

Do not delete historic files until the artist confirms a separate preservation
policy; they are useful evidence of visual/interaction development.

## 9. Known issues and risks

1. **Admin email**: Supabase default email rate limit prevents dependable magic
   links. Configure SMTP after exhibition; do not expose admin controls publicly.
2. **Archive Phase 3 is not implemented**: automatic PDF snapshots every five
   completed sessions, daily snapshots, Storage, ZIP exports, and individual
   session PDF download remain future work. The offline archive scripts are a
   separate manual prototype, not a production archive service.
3. **Concurrent visual density**: independent paragraph tasks can make the
   right page busy if visitors submit several paragraphs rapidly.
4. **AI availability/cost/latency**: each pass calls OpenAI. Network/API failures
   resolve to visible error states; Draft stays editable. Long pauses between
   passes are usually model latency, not animation delay.
5. **Pass 6 quality**: live Pass 6 can still be source-text-driven or too
   Goffman-heavy depending on model output. The offline plural-theory test is a
   reference, not yet automatically integrated into live prompt behavior.
6. **Printing**: the complete archive PDF is based on one example and needs
   review on another selected manuscript before batch generation.
7. **Security**: rotate any secret that was ever pasted into an untrusted place.
   Keep `.env` outside Git/ZIP. Never share `SUPABASE_SERVICE_ROLE_KEY`,
   `OPENAI_API_KEY`, write-token pepper, or diagnostic secret.

## 10. Suggested next steps

1. Freeze/check the public exhibition: input, commit, persistent accumulation,
   reset, and six-pass behavior on the deployed Vercel URL.
2. Confirm whether the plural-theory Pass 6 should become a live prompt change
   or remain an offline printable-archive option.
3. Configure Supabase custom SMTP and verify `/admin/archive` after exhibition.
4. Review one more printable archive with a new manuscript; then formalise a
   repeatable batch/archive Phase 3 if required.
5. If packing or moving the project, use the ZIP generated with this handoff,
   then create a new `.env` from `.env.example` and supply secrets separately.
