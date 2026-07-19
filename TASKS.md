# Self Reviser — Tasks and Next Steps

Status date: 19 July 2026 (Europe/London)

## Priority 0 — exhibition readiness

| Status | Task | Acceptance check | Notes |
|---|---|---|---|
| Complete | Deploy public site to Vercel | `https://self-reviser.vercel.app` loads and accepts writing | Current production host. |
| Complete | Persist sessions in Supabase | first input creates a row; refresh restores active session; reset retains prior row | Phase 1 tested manually. |
| Complete | Cumulative public manuscript | committed text from multiple sessions remains on site | Separate sessions are retained; public view accumulates submitted paragraphs. |
| Complete | Six-pass revision pipeline | each committed paragraph runs passes 1–6 sequentially | Pass transitions may appear delayed due to model latency. |
| Complete | Public reset lifecycle | `Ctrl + Alt + R` clears public surface but preserves saved record | Staff-only operational shortcut; no visible button. |
| Verify before opening | Full-device rehearsal | write/commit two paragraphs, test refresh, reset, and Supabase rows on exhibition hardware | Required because network and browser environment affect AI latency. |
| Verify before opening | Check OpenAI budget/rate limits | six passes and comments respond under expected use | The project is API-dependent. |

## Priority 1 — private archive / post-exhibition

| Status | Task | Needed action |
|---|---|---|
| Complete but email delivery blocked | `/admin/archive` login, list/detail, JSON export | Configure SMTP in Supabase Auth, then re-test magic-link email and allow-list. |
| Deferred | Individual session PDF export | Build server-side/static render from saved snapshots. |
| Deferred | Cumulative PDF snapshots | Create snapshot after five newly completed sessions and daily London-time snapshot. |
| Deferred | Supabase Storage structure | Use persistent Storage bucket; do not use host filesystem. |
| Deferred | ZIP archive download | Package JSON, PDFs, snapshots, CSV log, and summary server-side. |
| Deferred | Stale-session worker | Mark truly inactive `active` sessions `incomplete` without closing live visitors early. |

## Priority 2 — printable selected-manuscript archive

| Status | Task | Output |
|---|---|---|
| Complete | Test archive 001 from supplied Chinese Draft | `output/pdf/self-reviser-test-archive-001-printable-archive.pdf` |
| Complete | Alternate plural-theory final paper | `output/pdf/self-reviser-test-archive-001-plural-theory-paper.pdf` |
| Complete | Corrected combined archive | `output/pdf/self-reviser-test-archive-001-plural-theory-complete.pdf` |
| Pending artist review | Approve archive layout/template | Confirm cover, Word pages, comments, Pass 6 layering, title/abstract/keywords. |
| Pending after approval | Run selected additional manuscripts (approximately four more) | One independent archive per selected original Draft. |
| Deferred | Batch automation | Only after an example is approved; do not automate unreviewed theory/paper output. |

## Priority 3 — revision quality refinements

| Status | Task | Why it matters |
|---|---|---|
| Current design frozen | Pass 1–5 distinct roles | Avoid reverting to generic "more academic" paraphrase. |
| Current issue | Pass 6 can overuse Goffman / become summary-like | Offline plural-theory example demonstrates an alternative balance using Higgins, Festinger, Hacking, and only limited Goffman. |
| Decision required | Move plural-theory approach into live Pass 6 prompt? | This changes visitor-facing generation and should be approved explicitly. |
| Deferred | Draft contamination | Left Draft must currently remain author-owned and clean. |
| Deferred | More visible reading behavior | Reading is a backend rule first; do not add scanning animations without a design decision. |

## Historic / intentionally removed

| Status | Item | Reason |
|---|---|---|
| Removed | Voice Dictate button and Web Speech API | Kept interaction focused on writing, reading, comments, and revision; avoided speech/language/punctuation complexity. |
| Removed | Auto-commit after pause | Enter is the explicit commit trigger. |
| Deferred | Full admin Storage/PDF/ZIP system | Phase 1 persistence had to be stable first. |
| Superseded | Render hosting | GitHub private-repo authorization blocked deployment; Vercel works. Keep `render.yaml` only as historical fallback. |

## Suggested order after handoff

1. Verify public exhibition flow on the intended screen/network.
2. Decide whether current public behavior is frozen for exhibition.
3. Review and approve/archive the plural-theory test PDF.
4. After exhibition, configure SMTP and resume Archive Phase 3.
5. Only then consider live Pass 6 prompt changes or additional visual work.
