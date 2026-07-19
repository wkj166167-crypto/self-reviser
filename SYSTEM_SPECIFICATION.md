# Self Reviser — Current System Specification

## Interaction model

The Draft is a continuously editable author-owned manuscript. Its internal text
column scrolls independently when it outgrows the fixed document page. Keyboard
typing, pasting, caret movement, and pauses never initiate Revision.

Enter is evaluated against the current paragraph:

- If the paragraph has text that differs from its last committed text, Enter
  commits that paragraph and starts its Revision task without adding a line
  break.
- If the current paragraph is already committed and unchanged, Enter inserts a
  normal paragraph break.
- Shift+Enter is always a manual line break.

When a multi-paragraph text is pasted, its paragraph breaks are preserved. The
first pasted paragraph becomes the active Draft paragraph; later pasted
paragraphs remain visible as pending, read-only Draft paragraphs. Each Enter
submits the active paragraph, then activates the next pending paragraph. This
prevents one long pasted manuscript from becoming a single oversized Revision
target or from launching all paragraph tasks concurrently.

The initial Revision page displays “Press Enter to submit it for revision.” It
remains until the first paragraph is committed.

The live manuscript has a hard 10,000-character ceiling. Input beyond that
ceiling is not retained in the visible Draft or silently omitted from the AI
context. A multi-paragraph paste is truncated before pending paragraphs are
created, so the document displayed to the visitor and the document available to
Revision remain identical.

## Paragraph identity and concurrency

Every Draft paragraph has a stable paragraph ID and an explicit committed or
uncommitted state. Only committed paragraphs enter computational pipelines.
Uncommitted live text remains visible on both pages but is not sent to either
Editorial Notes or Revision.

A committed paragraph creates one Revision task with its own source text,
current tracked text, HTML markup, pass index, operation queue, edit history,
cancellation token, error state, and frozen document-context snapshots.

Tasks are independent. A new paragraph can be written and committed while an
earlier paragraph is being revised. Its six passes begin immediately; it does
not wait for earlier tasks. Passes within a single task remain strictly
sequential: Pass 2 begins only after Pass 1 has finished, and so on through
Pass 6.

The right page always follows the Draft paragraph order. Uncommitted new
paragraphs appear there immediately as plain black text once a first submission
has occurred. Their Track Changes begin only after their own Enter submission.

## Revision behaviour

Each pass is an independent rereading event:

Read → Interpret → Select → Maybe Edit.

At the start of a pass, the client assembles the latest completed Revision text
from all committed paragraphs in document order and freezes it as that pass’s
document-context snapshot. The target paragraph is identified separately. The
editor reads the whole frozen document but may generate operations only for the
target paragraph. New live text and subsequent concurrent changes do not alter
that request while it is in flight.

The editor may replace, delete, insert, or leave a passage unchanged. Deletion
and meaningful phrase- or sentence-level replacement are preferred; insertion
is exceptional and must have a local anchor. Each next pass assembles a new
snapshot after the previous pass’s visible edits have completed. The system
retains all prior Track Changes.

Each pass has a distinct and increasing editorial authority:

1. **Copy Editing** corrects grammar, punctuation, repetition, and readability
   without changing interpretation or authorial voice.
2. **Editorial Editor** resolves supported ambiguity and references while
   retaining ordinary authorial language.
3. **Academic Reader** introduces one restrained, provisional conceptual
   relation while beginning to read the account from outside the authorial voice.
4. **Institutional Interpreter** selects and organises an emerging supported
   interpretation, increasingly shifting from personal description to the
   language of the present narrative or account.
5. **Institutional Reviewer** aligns the paragraph with patterns and
   terminology already established in the wider committed manuscript.
6. **Institutional Author** commits to one framework that emerged in the prior
   passes, treating the author’s material as an object of academically framed
   interpretation rather than continuing the authorial voice. It replaces the
   target paragraph as a whole with one independent journal-style synthesis:
   observation → interpretation → qualification → provisional conclusion. It
   may develop a substantive 3–5 sentence argument and connect it to up to two
   supported reference frameworks. Source phrases function as evidence rather
   than the organising vocabulary: Pass 6 establishes one or two supported,
   non-diagnostic analytical terms and uses them consistently to structure the
   argument. It does not claim objective truth, diagnosis, or new evidence.

Passes are not a path to a final or more truthful interpretation. They are a
visible escalation in the system's authority to decide how the author's account
is organised.

### Visible edit budget

The AI may form a broad interpretation internally, but visible Track Changes
remain deliberately selective because every character is animated. Pass 1
allows one short operation; Pass 2 permits a slightly fuller clarification;
Pass 3 permits one conceptual edit; Pass 4 allows up to two medium operations;
Pass 5 allows one substantial reviewing operation. Pass 6 is the sole
paragraph-level synthesis exception: one complete target paragraph may be
replaced with an independent analytical paragraph. The
client and server both reject
operations that exceed the pass-specific visible character budget. A pass may
therefore make no visible edit rather than animate a long rewrite. During model
latency, exactly one Reading caret and a subtle underline identify the paragraph
being reread; no spinner or pass label is shown.

### Lightweight references

Only Pass 4 or Pass 5 may introduce one optional parenthetical reference; Pass
6 may introduce up to three. References appear only when a stable conceptual
framework has already
emerged from the author’s material. The permitted references are `(Festinger,
1954)`, `(Higgins, 1987)`, `(Goffman, 1959)`, and `(Hacking, 1999)`. References
must be qualified rather than diagnostic (for example, “may be understood
through”); they are conceptual traces of the institutional knowledge framework,
not a bibliography, evidence of clinical truth, or decorative academic styling.
The reference must map to a recurring relation in the material: comparative
self-evaluation may support Festinger, self-discrepancy may support Higgins,
interactional self-presentation may support Goffman, and concern with labels or
classification may support Hacking. Otherwise it is omitted.

For Pass 6, once such a relation is clearly established in the synthesis, a
primary parenthetical citation should appear within the relevant reasoning
sentence. Where the same material also supports one or two secondary, plausible
institutional readings, these may be added as qualified perspectives rather
than proof; Pass 6 allows at most three citations. They are not collected into
a separate bibliography and are never added merely to make the manuscript
appear academic.

For Pass 6, the source manuscript remains evidence, but it does not prescribe
the final paragraph’s word order, vocabulary, or argumentative structure. The
Institutional Author can name a supported relation through its own cautious
conceptual vocabulary, provided it remains grounded in the material and does
not introduce a clinical category or unsupported fact.

Pass 6 adopts the genre of a qualitative journal discussion rather than an AI
summary: it establishes its conceptual argument before introducing a reference.
References locate an already-supported argument within an existing framework;
they never replace reasoning or appear as decorative academic styling. Where no
framework is genuinely supported, the paragraph remains uncited.

When Pass 6 uses a reference, it names the theory in prose and provides one
brief, plain-language explanation of its central idea before relating that idea
back to the narrative. A bare parenthetical citation is insufficient. The
explanation is concise enough to clarify why an institutional framework has
entered the interpretation; it does not become a theory lesson.

On a theory’s first appearance, the prose uses a recognisable name alongside
its citation: `Social Comparison Theory (Festinger, 1954)`, `Self-Discrepancy
Theory (Higgins, 1987)`, `Goffman’s Presentation of Self (Goffman, 1959)`, or
`Hacking’s account of classificatory language (Hacking, 1999)`. Each receives
at most one concise explanation before it is applied to the narrative.

### Revision pacing

Revision requests begin as soon as a pass enters its Reading state. The first
pass retains an approximately 0.85-second minimum visible reading beat; later
passes retain an approximately 0.42-second minimum beat. These are concurrent
with the request rather than delays added after a response. The only deliberate
post-edit pause is 0.09 seconds, so a subsequent pass begins as soon as its
newly required rereading request can return. Any longer interval is model
response time, represented by the single Reading caret rather than empty UI.

## Rendering boundaries

Draft input and Revision rendering are separate. Revision animation never
rewrites, delays, hides, or disables Draft input. The left page remains the
author’s manuscript. Editorial Notes can mark and comment on Draft text, but
they do not automatically revise the Draft.

## Editorial Notes

Notes are a separate paragraph-level live pipeline. A typed `.`, `?`, `!`,
`。`, `！`, or `？` triggers a reading of the current uncommitted paragraph. A
completed paste also triggers one reading when the current live paragraph
contains at least one complete sentence; punctuation inside a single paste never
creates multiple requests. Ordinary typing, pauses, caret movement, and Enter
do not trigger a new live reading. Enter instead freezes the paragraph and
begins Revision.

Each live paragraph has a task keyed by its paragraph ID. It stores active
comments, their source anchors, status, text version, request token, and a
`needsAnalysis` flag. If a second sentence completes while a request is active,
the task records that it needs re-analysis; it does not start a parallel request.
When the first request finishes, the latest paragraph version is read.

The endpoint returns zero to three notes anchored to meaningful phrases or
complete sentences within that paragraph. Notes identify unresolved relations,
undefined experience, unsupported patterns, unstable categories, or unclear
causality. Their wording should offer a concrete next writing move without
supplying the next sentence, advice, or diagnosis.

Existing notes are supplied to later paragraph readings so they remain stable
when still relevant. A deleted anchor marks its note addressed; a new issue adds
a note without duplicating the same source and category. On Enter, the latest
notes are frozen as manuscript history and no further live Comment request is
allowed for that paragraph. Notes do not block writing or Revision. Keyword
matching and generated mock comments are not used.

## Technical architecture

- `src/main.js` manages live Draft state, paragraph IDs, per-paragraph Revision
  tasks, frozen document assembly, paragraph-scoped Comments tasks, and Track
  Changes animation.
- `server.js` exposes `/api/revision-pass`, which receives a frozen document
  context plus one target paragraph and produces one structured pass. It also
  exposes `/api/editorial-comments`, which reads one committed paragraph.
- There is no local pseudo-intelligent mock planner. An unavailable service
  produces a minimal error state rather than fabricated edits or comments.
- `src/styles.css` provides the Word-like document presentation.

## Persistent exhibition archive — Phase 1

The public exhibition interface contains no archive, history, save, or download
control. Persistence is a background responsibility of the client and Express
server, and does not alter writing, Comments, Revision, animation, or visual
behaviour.

### Session lifecycle

- The first non-empty input of a visitor creates one `active` archive session.
- The browser keeps only that session's opaque ID and private write token in
  local storage. The token lets the same browser restore its still-active
  session after a refresh without exposing the database to visitors.
- Draft changes are debounced; commits, Comment updates, and completed Revision
  passes request immediate saves. Every saved state contains the complete Draft
  document, paragraph identity/order/state, Notes, current Track Changes text,
  completed pass history, operations, frozen context snapshots, timestamps
  where available, language, and word count.
- A Pass 6 completion is a paragraph-level `revision-complete` result only.
  It never closes the visitor's session or prevents further paragraphs.
- The staff-only `Ctrl` + `Alt` + `R` New Session / Reset path first saves the
  current document. A session with one or more committed paragraphs becomes
  `completed`; a draft-only session becomes `incomplete`. It then clears only
  the public page and allows the next visitor's first input to create a new
  session. It never deletes stored work.
- A later background worker will mark stale active sessions `incomplete`; Phase
  1 does not automatically close a session from the browser.

### Storage boundary and recovery

Phase 1 uses Supabase PostgreSQL through server-side API calls. The Render file
system is never used to store visitor material. The browser has no Supabase
service credential and cannot directly query archive tables. A Supabase SQL RPC
writes the session's raw recovery snapshot and its normalised paragraphs, Notes,
and Pass records atomically.

On a refresh, the active session snapshot is restored into the existing Draft,
Comments, and Revision rendering model. An in-flight Revision is preserved as
its latest saved state rather than being silently regenerated or replayed. The
next archive phase may add controlled resumption rules; Phase 1 prioritises
recovery without duplicating an AI request.

`/api/archive/diagnostics` is intentionally not linked from the public
interface. It requires `X-Archive-Diagnostic-Key` and reports configuration and
database reachability for staff verification. PDF/storage checks belong to
Phase 3.

## Private archive administration — Phase 2

`/admin/archive` is a separate private route and is not linked from the public
exhibition interface. It authenticates through Supabase email magic links. The
server requests a link only when the submitted email already exists as an
invited Supabase Auth user and is listed in `ADMIN_EMAIL_ALLOWLIST`; public
registration is not supported.

The browser stores a short-lived administrator access token only in session
storage. Every archive API request validates that token against Supabase Auth
and checks the server-side email allow-list before it can read data. Supabase's
Secret / service-role key remains server-only.

Phase 2 provides chronological session listing, text search, date/status
filters, full saved session inspection, and protected structured JSON download.
PDF, cumulative snapshot, and ZIP generation remain Phase 3 work.

## Exhibition recovery

Revision requests time out after 45 seconds and Editorial Notes requests after
30 seconds. A timeout or service failure resolves to a local error state rather
than leaving an active task permanently in Reading. Draft input remains usable.

For exhibition staff, `Ctrl` + `Alt` + `R` opens the New Session / Reset path
without a visible product-style control. It first attempts the persistent
archive close described below, then invalidates active task tokens and clears
only the public Draft paragraphs, Notes, Revision history, attention state,
scroll positions, and temporary notices. It is an operator recovery path, not
an inactivity reset; the site never deletes a visitor’s stored work merely
because they pause to read.

## Current constraints

- Concurrent paragraph tasks may animate on the same right page, so the visual
  attention hierarchy can become busy when several paragraphs are submitted in
  rapid succession.
- Paragraph identity is preserved through normal writing, editing, and line
  breaks; highly destructive rearrangement of many identical lines can still
  make identity reconciliation ambiguous.
- Concurrent tasks may read slightly different snapshots by design; each pass
  remains internally reproducible because its own snapshot is immutable.
