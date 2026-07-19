# Self Reviser — Design and Technical Decisions

## Conceptual decisions

### The project is about institutional interpretation, not improved writing

The AI must not be presented as a helpful co-writer. It progressively reduces
ambiguity, stabilises meanings, and renders lived experience institutionally
legible. It should feel like a system taking interpretative ownership, not like
a product optimising prose.

### Human and AI have asymmetric interpretive logics

- The Draft writer becomes more concrete but more aware of uncertainty,
  contradiction, hesitation, and incomplete self-explanation.
- The AI becomes increasingly organised and confident, while remaining
  provisional and non-diagnostic.

This asymmetry is the central research claim and must survive all technical or
visual changes.

### Reading precedes editing

Every AI intervention follows:

```text
Read → Interpret → Select → Maybe Edit
```

Editing is not mandatory. Comment, revision, or no intervention are valid
outcomes. Passes are independent rereading events, not six preplanned steps.

### Comments and Revision have different scopes

- Comments are paragraph-level readings and interventions, placed in that
  paragraph's Draft margin.
- Revision reads a frozen whole-document context but changes only the task's
  initiating paragraph.

This allows a paragraph to be interpreted in relation to the manuscript without
turning the entire document into one blocking task.

### No diagnosis

The system can use psychological/sociological concepts cautiously, but it must
not diagnose the author, make clinical claims, or invent facts/motives.

## Interaction decisions

### Keyboard-only entry

Dictation, language selection, speech recognition, interim/final transcripts,
and related styles were completely removed. Keeping them hidden is insufficient;
they must remain absent unless explicitly reintroduced.

### Enter is explicit commit

Typing pauses, scrolling, and caret movement must never trigger Revision.
Enter commits new text and creates the next editable paragraph. Submitted Draft
paragraphs lock. This preserves a reliable, legible visitor action.

### Draft remains author-owned

Automatic Draft Track Changes / "contamination" are deferred. Notes may guide
future writing, but the system must not automatically rewrite the left page.

### Paragraph concurrency

Visitors can write/submit subsequent paragraphs while earlier revisions run.
Each task has its own ID, pass index, snapshot, queue, and error state. Never
reintroduce one global active cycle that blocks Draft input.

## Revision decisions

### Pass roles must be visibly distinct

1. Copy Editor
2. Editorial Editor
3. Academic Reader
4. Institutional Interpreter
5. Institutional Reviewer
6. Institutional Author

Escalation should be evident through the nature of Track Changes, not labels or
explanatory UI.

### Fewer, more meaningful visible edits

Long Chinese sentence-level replacements can make six passes unreadably slow.
Use selective operations: short early changes, at most one/two substantial
later interventions, a single active cursor/attention point, and short
post-operation pauses. Model latency is represented as rereading, not a spinner.

### References are institutional traces, not decoration

Permitted theoretical anchors include Festinger (social comparison), Higgins
(self-discrepancy), Goffman (presentation of self), and Hacking (classification
and subjectivity). They must arise from supported patterns, be phrased with
qualification, and have no standalone bibliography in the live artwork.

### Plural-theory Pass 6 is an approved offline test, not a live default

The latest printable archive variation uses several frameworks so Goffman does
not monopolise the reading. It is an example to review before changing the live
Pass 6 prompt.

## Visual decisions

### Word as document language, not application UI

The installation uses Office 2010 / Word Review Mode as a familiar editorial
environment. Ribbon and toolbar are quiet contextual scenery; pages, text,
comments, and Track Changes are the focus.

### Two document pages, not panels

The layout is `Draft + Editorial Notes || Revision`. Comments belong inside the
left page margin. Right page is dedicated to tracked Revision.

### Typography and readability over decoration

Use consistent typography, matching margins/line starts, compact comments,
black source text, grey deletion, red insertion. Avoid cards, gradients, glow,
glass, cyberpunk, chat/product UI, or visual distortion.

## Archive and deployment decisions

### Supabase is persistence source of truth

Deployment filesystem is ephemeral and must never hold visitor records. Use
server-side Supabase REST/RPC with a service-role key, not browser credentials.

### Sessions accumulate publicly but remain discrete in storage

One visitor can submit many paragraphs in an active Session. Reset creates the
next visitor's Session without deleting earlier records. The public manuscript
shows committed paragraphs across sessions.

### Europe/London is the exhibition time zone

All archive timestamps/daily scheduling conventions use `Europe/London`.

### Vercel is current production host

Render is retained only as a fallback configuration. Vercel succeeded after
Render's repository authorization failed.

### Public site contains no archive UI

Archive controls must never appear to visitors. `/admin/archive` is a separate,
allow-listed, magic-link-protected route. SMTP reliability is deferred.

### Printed archive is a document export, not a redesigned report UI

Draft/Pass pages preserve existing Word-document rendering. The final clean
academic paper follows the supplied institutional narrative report reference.
