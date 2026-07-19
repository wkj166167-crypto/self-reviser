import "./draft-live.css";

// Supabase may deliver a magic-link session to the configured Site URL rather
// than the requested archive path. Preserve that session fragment and hand it
// directly to the private archive before the public exhibition app starts.
const authCallbackHash = new URLSearchParams(window.location.hash.slice(1));
if (authCallbackHash.get("access_token")) {
  window.location.replace(`/admin/archive${window.location.search}${window.location.hash}`);
}

const MAX_CHARS = 10000;
// Revision should be readable at the character level, while the editorial
// attention itself moves continuously from one pass into the next.
const CHAR_DELAY_MS = 64;
const CHINESE_CHAR_DELAY_MS = 44;
const OPERATION_SETTLE_MS = 480;
const PASS_SETTLE_MS = 90;
// Reading begins immediately when the request begins. These are minimum visible
// reading moments, not additional waits after an AI response.
const INITIAL_READING_MS = 850;
const BETWEEN_PASS_READING_MS = 420;
const REVISION_REQUEST_TIMEOUT_MS = 45000;
const COMMENT_REQUEST_TIMEOUT_MS = 30000;
const ARCHIVE_STORAGE_KEY = "self-reviser.active-archive-session.v1";
const ARCHIVE_AUTOSAVE_DELAY_MS = 900;
const VISIBLE_EDIT_BUDGET = {
  1: { operations: 1, characters: 48 },
  2: { operations: 1, characters: 56 },
  3: { operations: 1, characters: 80 },
  4: { operations: 2, characters: 120 },
  5: { operations: 1, characters: 130 },
  6: { operations: 1, characters: Infinity },
};

/*
  The Draft is always live. Each committed paragraph owns an independent
  six-pass task, so a later paragraph never waits for an earlier one.
*/
const state = {
  author: createAuthorLabel(),
  draft: "",
  status: "empty",
  sealed: false,
  draftState: {
    paragraphs: [],
  },
  revisionState: {
    tasks: new Map(),
    attention: null,
  },
  commentState: {
    tasks: new Map(),
  },
  linkedScroll: {
    revisionPaused: false,
  },
  highlightedCommentId: "",
  archive: {
    session: null,
    creating: null,
    restoring: false,
    hasLocalEdits: false,
    saveTimer: null,
    saveInFlight: false,
    pendingSave: false,
    queuedEvent: "autosave",
    unavailable: false,
    lastError: "",
  },
};

const els = {
  app: document.querySelector("#app"),
  authorLabel: document.querySelector("#authorLabel"),
  statusLabel: document.querySelector("#statusLabel"),
  wordCount: document.querySelector("#wordCount"),
  limitNotice: document.querySelector("#limitNotice"),
  draftEditor: document.querySelector("#draftEditor"),
  commentsList: document.querySelector("#commentsList"),
  revisionOutput: document.querySelector("#revisionOutput"),
};

function createAuthorLabel() {
  return `Author ${String(Math.floor(Math.random() * 900) + 100)}`;
}

function fetchWithTimeout(url, options, timeoutMs, timeoutMessage) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal })
    .catch((error) => {
      if (error?.name === "AbortError") throw new Error(timeoutMessage);
      throw error;
    })
    .finally(() => window.clearTimeout(timeoutId));
}

function nowIso() {
  return new Date().toISOString();
}

function archiveStorage() {
  try { return window.localStorage; } catch { return null; }
}

function readStoredArchiveSession() {
  try {
    const raw = archiveStorage()?.getItem(ARCHIVE_STORAGE_KEY);
    const value = raw ? JSON.parse(raw) : null;
    return value?.id && value?.writeToken ? value : null;
  } catch {
    return null;
  }
}

function storeArchiveSession(session) {
  try { archiveStorage()?.setItem(ARCHIVE_STORAGE_KEY, JSON.stringify(session)); } catch { /* browser privacy mode: save still works for this page */ }
}

function clearStoredArchiveSession() {
  try { archiveStorage()?.removeItem(ARCHIVE_STORAGE_KEY); } catch { /* no-op */ }
}

async function archiveRequest(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || "Persistent archive is unavailable.");
    error.status = response.status;
    throw error;
  }
  return payload;
}

function archiveHeaders() {
  return {
    "Content-Type": "application/json",
    ...(state.archive.session?.writeToken ? { "X-Session-Write-Token": state.archive.session.writeToken } : {}),
  };
}

async function ensureArchiveSession() {
  if (state.archive.unavailable) return null;
  if (state.archive.session) return state.archive.session;
  if (state.archive.restoring) {
    await wait(40);
    return ensureArchiveSession();
  }
  if (state.archive.creating) return state.archive.creating;
  state.archive.creating = archiveRequest("/api/archive/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ author_label: state.author }),
  }).then((payload) => {
    state.archive.session = {
      id: payload.session.id,
      writeToken: payload.write_token,
      sequenceNumber: payload.session.sequence_number,
      createdAt: payload.session.created_at,
    };
    storeArchiveSession(state.archive.session);
    return state.archive.session;
  }).catch((error) => {
    // Archive failure must never interrupt a visitor's writing or revision.
    state.archive.lastError = error.message;
    if (error.status === 503) state.archive.unavailable = true;
    return null;
  }).finally(() => {
    state.archive.creating = null;
  });
  return state.archive.creating;
}

function commentArchiveState(paragraphId) {
  const task = state.commentState.tasks.get(paragraphId);
  return (task?.comments || []).map((comment) => ({ ...comment }));
}

function revisionArchiveState(paragraphId) {
  const task = state.revisionState.tasks.get(paragraphId);
  if (!task) return { status: "not_started", pass_index: 0, text: "", html: "", history: [] };
  return {
    status: task.error ? "error" : task.active ? "in_progress" : task.passIndex === 6 ? "revision_complete" : "paused",
    pass_index: task.passIndex || 0,
    text: task.text || "",
    html: task.html || "",
    history: (task.history || []).map((entry) => ({
      pass_number: entry.passNumber,
      status: entry.status || "completed",
      text_before: entry.textBefore || "",
      text_after: entry.textAfter || "",
      operations: entry.operations || [],
      context_snapshot: entry.contextSnapshot || {},
      timing: entry.timing || {},
    })),
  };
}

function detectDocumentLanguage(text) {
  const hasChinese = /[\u3400-\u9fff]/.test(text);
  const hasLatin = /[A-Za-z]/.test(text);
  if (hasChinese && hasLatin) return "mixed";
  if (hasChinese) return "zh";
  if (hasLatin) return "en";
  return "unknown";
}

function serializeArchiveDocument() {
  const paragraphs = state.draftState.paragraphs.map((paragraph, position) => ({
    id: paragraph.id,
    position,
    text: paragraph.text,
    committed_text: paragraph.committedText || "",
    state: paragraph.committed ? "committed" : paragraph.pending ? "pending" : "editing",
    committed_at: paragraph.committedAt || "",
    timing: { first_seen_at: paragraph.createdAt || "", last_input_at: paragraph.lastInputAt || "" },
    comments: commentArchiveState(paragraph.id),
    revision: revisionArchiveState(paragraph.id),
  }));
  return {
    schema_version: 1,
    author_label: state.author,
    saved_at: nowIso(),
    paragraphs,
    meta: {
      all_committed_revisions_complete: paragraphs.filter((paragraph) => paragraph.state === "committed").every((paragraph) => paragraph.revision.pass_index === 6),
    },
  };
}

function queueArchiveSave(eventType = "autosave", { immediate = false } = {}) {
  if (!getDraftText().trim()) return;
  state.archive.pendingSave = true;
  state.archive.queuedEvent = eventType === "autosave" ? state.archive.queuedEvent : eventType;
  window.clearTimeout(state.archive.saveTimer);
  const run = () => { void persistArchiveState(); };
  state.archive.saveTimer = immediate ? window.setTimeout(run, 0) : window.setTimeout(run, ARCHIVE_AUTOSAVE_DELAY_MS);
}

async function persistArchiveState() {
  if (state.archive.unavailable || !getDraftText().trim()) return;
  if (state.archive.saveInFlight) {
    await wait(60);
    return persistArchiveState();
  }
  if (!state.archive.pendingSave) return;
  state.archive.saveInFlight = true;
  state.archive.pendingSave = false;
  const eventType = state.archive.queuedEvent;
  state.archive.queuedEvent = "autosave";
  try {
    const session = await ensureArchiveSession();
    if (!session) return;
    const documentState = serializeArchiveDocument();
    await archiveRequest(`/api/archive/sessions/${session.id}`, {
      method: "PUT",
      headers: archiveHeaders(),
      body: JSON.stringify({
        event_type: eventType,
        document_state: documentState,
        language: detectDocumentLanguage(getDraftText()),
        word_count: countWords(getDraftText()),
      }),
    });
    state.archive.lastError = "";
  } catch (error) {
    state.archive.lastError = error.message;
  } finally {
    state.archive.saveInFlight = false;
    if (state.archive.pendingSave) queueArchiveSave(state.archive.queuedEvent, { immediate: true });
  }
}

function hydrateArchiveDocument(session) {
  const documentState = session?.document_state;
  const savedParagraphs = Array.isArray(documentState?.paragraphs) ? documentState.paragraphs : [];
  if (!savedParagraphs.length) return false;
  state.author = documentState.author_label || session.author_label || state.author;
  state.draftState.paragraphs = savedParagraphs.map((item) => ({
    id: item.id,
    text: item.text || "",
    committed: item.state === "committed",
    committedText: item.committed_text || "",
    pending: item.state === "pending",
    wasPasted: false,
    committedAt: item.committed_at || "",
    createdAt: item.timing?.first_seen_at || "",
    lastInputAt: item.timing?.last_input_at || "",
  }));
  state.commentState.tasks.clear();
  state.revisionState.tasks.clear();
  savedParagraphs.forEach((item) => {
    const comments = Array.isArray(item.comments) ? item.comments : [];
    if (comments.length) {
      state.commentState.tasks.set(item.id, {
        paragraphId: item.id,
        comments,
        nextNumber: Math.max(0, ...comments.map((comment) => Number(comment.number) || 0)) + 1,
        token: 0,
        active: false,
        closed: item.state === "committed",
        needsAnalysis: false,
        sourceText: item.text || "",
        error: "",
      });
    }
    const revision = item.revision || {};
    if ((revision.pass_index || 0) > 0 || revision.text || revision.html) {
      state.revisionState.tasks.set(item.id, {
        id: item.id,
        sourceText: item.committed_text || item.text || "",
        text: revision.text || item.committed_text || item.text || "",
        html: revision.html || escapeHtml(revision.text || item.committed_text || item.text || ""),
        frameHtml: null,
        active: false,
        passIndex: revision.pass_index || 0,
        operationQueue: [],
        history: (revision.history || []).map((entry) => ({
          passNumber: entry.pass_number,
          status: entry.status,
          textBefore: entry.text_before,
          textAfter: entry.text_after,
          operations: entry.operations || [],
          contextSnapshot: entry.context_snapshot || {},
          timing: entry.timing || {},
        })),
        editLedger: [],
        token: 1,
        error: "",
      });
    }
  });
  state.draft = getDraftText();
  state.revisionState.attention = null;
  ensureEditableParagraph();
  renderDraftDecorations();
  renderComments();
  renderRevisionDocument();
  setStatus(state.draft.trim() ? "ready" : "empty");
  updateChrome();
  return true;
}

async function restoreActiveArchiveSession() {
  const stored = readStoredArchiveSession();
  if (!stored) return;
  state.archive.restoring = true;
  try {
    const payload = await archiveRequest(`/api/archive/sessions/${stored.id}`, {
      headers: { "X-Session-Write-Token": stored.writeToken },
    });
    if (payload.session.status === "active") {
      state.archive.session = { ...stored, sequenceNumber: payload.session.sequence_number, createdAt: payload.session.created_at };
    }
    if (state.archive.hasLocalEdits || payload.session.status !== "active") {
      if (payload.session.status !== "active") clearStoredArchiveSession();
      return;
    }
    hydrateArchiveDocument(payload.session);
  } catch {
    // A first-run or locally unconfigured archive must leave the exhibition
    // writing surface entirely usable. The diagnostic endpoint exposes errors
    // to staff without exposing them to visitors.
  } finally {
    state.archive.restoring = false;
  }
}

async function closeArchiveSessionForReset() {
  if (!getDraftText().trim()) {
    clearStoredArchiveSession();
    state.archive.session = null;
    return;
  }
  state.archive.pendingSave = true;
  state.archive.queuedEvent = "reset";
  await persistArchiveState();
  const session = state.archive.session;
  if (!session) return;
  const hasCommittedParagraph = state.draftState.paragraphs.some((paragraph) => paragraph.committed && paragraph.committedText.trim());
  try {
    await archiveRequest(`/api/archive/sessions/${session.id}/close`, {
      method: "POST",
      headers: archiveHeaders(),
      body: JSON.stringify({ status: hasCommittedParagraph ? "completed" : "incomplete" }),
    });
    clearStoredArchiveSession();
    state.archive.session = null;
  } catch (error) {
    // Keep the local token when closing fails, so staff can refresh and retry
    // rather than silently orphaning the visitor's saved session.
    state.archive.lastError = error.message;
  }
}

function flushArchiveOnPageHide() {
  if (!state.archive.session || !getDraftText().trim()) return;
  const payload = JSON.stringify({
    event_type: "autosave",
    document_state: serializeArchiveDocument(),
    language: detectDocumentLanguage(getDraftText()),
    word_count: countWords(getDraftText()),
  });
  // Keepalive is intentionally best-effort: regular debounced saves are the
  // durable path and this catches the last keystrokes during a browser close.
  if (payload.length > 60000) return;
  void fetch(`/api/archive/sessions/${state.archive.session.id}`, {
    method: "PUT",
    headers: archiveHeaders(),
    body: payload,
    keepalive: true,
  });
}

function statusCopy(status) {
  if (/^pass_/i.test(status)) return "Revising";
  return {
    empty: "Ready",
    typing: "Writing",
    reading: "Reading",
    generating: "Preparing revision",
    ready: "Ready",
    error: "Revision unavailable",
    sealed: "Sealed",
  }[status] || status;
}

function setStatus(status) {
  state.status = status;
  els.app.dataset.state = status;
  els.statusLabel.textContent = statusCopy(status);
}

function updateChrome() {
  els.authorLabel.textContent = state.author;
  els.wordCount.textContent = countWords(state.draft);
  // The document container is never directly editable. Only its newest
  // paragraph is editable; submitted paragraphs remain selectable but locked.
  els.draftEditor.contentEditable = "false";
  els.draftEditor.setAttribute("aria-readonly", String(state.sealed));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function getDraftText() {
  return state.draftState.paragraphs.map((paragraph) => paragraph.text).join("\n");
}

function allowedLengthForParagraph(paragraph) {
  const otherTextLength = state.draftState.paragraphs
    .filter((item) => item !== paragraph)
    .reduce((total, item) => total + item.text.length, 0);
  const paragraphBreaks = Math.max(0, state.draftState.paragraphs.length - 1);
  return Math.max(0, MAX_CHARS - otherTextLength - paragraphBreaks);
}

function constrainParagraphToLimit(paragraph) {
  const allowedLength = allowedLengthForParagraph(paragraph);
  if (paragraph.text.length <= allowedLength) return false;
  paragraph.text = paragraph.text.slice(0, allowedLength);
  return true;
}

function handleDraftInput(event) {
  if (state.sealed) return;
  const paragraph = getEditingParagraph();
  if (!paragraph || !event.target.closest?.(`.draft-paragraph[data-paragraph-id="${paragraph.id}"]`)) return;
  paragraph.text = event.target.textContent || "";
  paragraph.lastInputAt = nowIso();
  paragraph.createdAt ||= paragraph.lastInputAt;
  state.archive.hasLocalEdits = true;
  const trimmedToLimit = constrainParagraphToLimit(paragraph);
  const nextText = getDraftText();
  state.draft = nextText;
  // A session begins with the first real visitor input; saving its changing
  // contents remains debounced, but identity is issued immediately so a rapid
  // refresh cannot create a second visitor record.
  if (nextText.trim()) void ensureArchiveSession();
  if (trimmedToLimit) {
    renderDraftDecorations({ focusParagraphId: paragraph.id });
    els.limitNotice.textContent = "Maximum length reached. Start a new exhibition session to continue.";
    setStatus(nextText.trim() ? "typing" : "empty");
    updateChrome();
    queueArchiveSave();
    return;
  }
  renderRevisionDocument();
  if (removeInvalidCommentAnchors()) renderComments();

  if (nextText.length >= MAX_CHARS) {
    els.limitNotice.textContent = "Maximum length reached. Please revise existing text before continuing.";
  } else {
    els.limitNotice.textContent = nextText.length > 9400 ? `${nextText.length} / ${MAX_CHARS}` : "";
  }

  setStatus(nextText.trim() ? "typing" : "empty");
  updateChrome();

  // Only a typed terminal mark opens a live editorial reading. Pasting,
  // pausing, caret movement, and ordinary characters remain computationally
  // silent; Enter alone commits to the Revision pipeline.
  const typedSentenceEnd = event?.inputType === "insertText" && /[.?!。！？]$/.test(event.data || "");
  const pastedCompletedParagraph = event?.inputType === "insertFromPaste";
  if (typedSentenceEnd || pastedCompletedParagraph) {
    if (paragraph && pastedCompletedParagraph) paragraph.wasPasted = true;
    if (paragraph && !paragraph.committed && paragraph.text.trim() && (!pastedCompletedParagraph || hasCompletedSentence(paragraph.text))) {
      queueLiveParagraphComments(paragraph);
    }
  }
  queueArchiveSave();
}

function hasCompletedSentence(text) {
  return /[.?!。！？](?:\s|$)/.test(text);
}

function handleDraftPaste(event) {
  if (state.sealed) return;
  const paragraph = getEditingParagraph();
  const plainText = event.clipboardData?.getData("text/plain") || "";
  if (!paragraph) return;
  const available = Math.max(0, allowedLengthForParagraph(paragraph) - paragraph.text.length);
  const acceptedText = plainText.slice(0, available);
  const rawSegments = plainText.replace(/\r\n?/g, "\n").split(/\n+/).map((item) => item.trim()).filter(Boolean);
  const segments = acceptedText.replace(/\r\n?/g, "\n").split(/\n+/).map((item) => item.trim()).filter(Boolean);
  if (rawSegments.length < 2) return;

  // A multi-paragraph paste is a seed manuscript, not one oversized editable
  // paragraph. Subsequent paragraphs remain visible but activate one at a time
  // as the author submits the preceding paragraph.
  event.preventDefault();
  if (!segments.length) {
    els.limitNotice.textContent = "Maximum length reached. Start a new exhibition session to continue.";
    return;
  }
  paragraph.text = `${paragraph.text}${segments.shift()}`;
  paragraph.lastInputAt = nowIso();
  paragraph.createdAt ||= paragraph.lastInputAt;
  state.archive.hasLocalEdits = true;
  constrainParagraphToLimit(paragraph);
  paragraph.wasPasted = true;
  segments.forEach((text) => {
    state.draftState.paragraphs.push({
      id: crypto.randomUUID(), text, committed: false, committedText: "", pending: true, wasPasted: true, createdAt: nowIso(), lastInputAt: nowIso(),
    });
  });
  state.draft = getDraftText();
  if (state.draft.trim()) void ensureArchiveSession();
  renderDraftDecorations({ focusParagraphId: paragraph.id });
  renderRevisionDocument();
  setStatus("typing");
  els.limitNotice.textContent = state.draft.length > 9400 ? `${state.draft.length} / ${MAX_CHARS}` : "";
  updateChrome();
  if (paragraph.text.trim() && hasCompletedSentence(paragraph.text)) queueLiveParagraphComments(paragraph);
  queueArchiveSave();
}

function handleDraftKeydown(event) {
  if (state.sealed || event.isComposing) return;
  const editing = getEditingParagraphElement();
  if (!editing || !editing.contains(event.target)) return;
  if (event.key === "Backspace" && isCaretAtStart(editing)) {
    // A submitted paragraph must never be merged into the active paragraph.
    event.preventDefault();
    return;
  }
  if (event.key !== "Enter" || event.shiftKey) return;
  event.preventDefault();
  if (currentParagraphHasUncommittedText()) commitDraft();
}

function handleDraftBeforeInput(event) {
  if (event.inputType !== "insertParagraph" || event.isComposing || state.sealed) return;
  // This covers virtual keyboards that emit beforeinput without keydown.
  event.preventDefault();
  if (currentParagraphHasUncommittedText()) commitDraft();
}

function currentParagraphHasUncommittedText() {
  const paragraph = getEditingParagraph();
  return Boolean(paragraph?.text.trim() && !paragraph.committed);
}

function getCurrentParagraph() {
  const index = state.draftState.paragraphs.findIndex((paragraph) => !paragraph.committed && !paragraph.pending);
  return { index, text: index >= 0 ? state.draftState.paragraphs[index].text : "" };
}

function getEditingParagraph() {
  return state.draftState.paragraphs.find((paragraph) => !paragraph.committed && !paragraph.pending) || null;
}

function getEditingParagraphElement() {
  const paragraph = getEditingParagraph();
  return paragraph ? els.draftEditor.querySelector(`.draft-paragraph[data-paragraph-id="${paragraph.id}"]`) : null;
}

function createEditableParagraph() {
  const paragraph = { id: crypto.randomUUID(), text: "", committed: false, committedText: "", pending: false, createdAt: nowIso(), lastInputAt: "" };
  state.draftState.paragraphs.push(paragraph);
  return paragraph;
}

function ensureEditableParagraph() {
  return getEditingParagraph() || createEditableParagraph();
}

function caretOffsetWithin(element) {
  const selection = window.getSelection();
  if (!selection?.rangeCount || !element.contains(selection.anchorNode)) return element.textContent.length;
  const range = selection.getRangeAt(0).cloneRange();
  range.selectNodeContents(element);
  range.setEnd(selection.anchorNode, selection.anchorOffset);
  return range.toString().length;
}

function isCaretAtStart(element) {
  const selection = window.getSelection();
  return Boolean(selection?.rangeCount && selection.isCollapsed && element.contains(selection.anchorNode) && caretOffsetWithin(element) === 0);
}

function commitDraft() {
  const current = getCurrentParagraph();
  const paragraph = state.draftState.paragraphs[current.index];
  const paragraphText = paragraph?.text.trim();
  state.draft = getDraftText();
  if (!paragraph || !paragraphText) {
    setStatus("empty");
    updateChrome();
    return;
  }

  setStatus("reading");
  paragraph.committed = true;
  paragraph.committedText = paragraph.text;
  paragraph.committedAt = nowIso();
  startParagraphRevision(paragraph);
  freezeParagraphComments(paragraph);
  // Every submission immediately creates the next writable paragraph. This
  // removes the former two-Enter state and keeps the author continuously able
  // to write while earlier paragraphs revise independently.
  const nextParagraph = activateNextPendingParagraph() || createEditableParagraph();
  state.draft = getDraftText();
  renderDraftDecorations({ focusParagraphId: nextParagraph.id });
  renderComments();
  renderRevisionDocument();
  updateChrome();
  queueArchiveSave("commit", { immediate: true });
}

function activateNextPendingParagraph() {
  const next = state.draftState.paragraphs.find((paragraph) => !paragraph.committed && paragraph.pending);
  if (!next) return null;
  next.pending = false;
  if (next.wasPasted && next.text.trim() && hasCompletedSentence(next.text)) queueLiveParagraphComments(next);
  return next;
}

function startParagraphRevision(paragraph) {
  const existing = state.revisionState.tasks.get(paragraph.id);
  if (existing?.active && existing.sourceText === paragraph.committedText) return;
  const task = {
    id: paragraph.id,
    sourceText: paragraph.committedText,
    text: paragraph.committedText,
    html: escapeHtml(paragraph.committedText),
    frameHtml: null,
    active: true,
    passIndex: 0,
    operationQueue: [],
    history: [],
    editLedger: [],
    startedAt: nowIso(),
    token: (existing?.token || 0) + 1,
    error: "",
  };
  state.revisionState.tasks.set(paragraph.id, task);
  runParagraphRevision(task);
}

async function runParagraphRevision(task) {
  const token = task.token;
  setRevisionAttention(task, 1, "reading");

  try {
    for (let passNumber = 1; passNumber <= 6; passNumber += 1) {
      // A pass is a separate rereading event. Keep this visible without adding
      // a new UI panel or exposing revision-round labels inside the document.
      if (passNumber > 1) {
        setRevisionAttention(task, passNumber, "reading");
      }
      const contextSnapshot = assembleRevisionContext(task.id);
      task.currentPassContextSnapshot = contextSnapshot;
      task.currentPassStartedAt = nowIso();
      const target = contextSnapshot.paragraphs.find((paragraph) => paragraph.id === task.id);
      if (!target) return;
      // Render the reading caret before the request begins, so model latency
      // reads as editorial attention rather than an inactive page.
      setRevisionAttention(task, passNumber, "reading");
      const responsePromise = requestRevisionPass({
        documentContext: contextSnapshot,
        targetParagraphId: task.id,
        targetText: target.text,
        passNumber,
      });
      // Begin the request before waiting. The minimum reading time therefore
      // never adds to normal model latency, but keeps a very brief, deliberate
      // reading beat if the response is unusually fast.
      await wait(passNumber === 1 ? INITIAL_READING_MS : BETWEEN_PASS_READING_MS);
      if (!isCurrentRevisionTask(task, token)) return;
      const result = await responsePromise;
      if (!isCurrentRevisionTask(task, token)) return;
      if (result.safety?.triggered) {
        task.error = result.safety.message;
        renderRevisionDocument();
        return;
      }
      const operations = planPassOperations(result.pass, task.text, task.editLedger);
      let nextText = task.text;
      operations.forEach((operation) => { nextText = applyOperation(nextText, operation); });
      task.operationQueue = [{ ...result.pass, operations, text: nextText }];
      task.contextSnapshots ??= [];
      task.contextSnapshots.push(contextSnapshot);
      await playParagraphOperationQueue(task, token);
      if (!isCurrentRevisionTask(task, token)) return;
      task.passIndex = passNumber;
      queueArchiveSave("revision_update", { immediate: true });
    }
    if (!isCurrentRevisionTask(task, token)) return;
  } catch (error) {
    if (isCurrentRevisionTask(task, token)) {
      task.error = error?.message || "Revision is temporarily unavailable.";
      renderRevisionDocument();
    }
  } finally {
    if (isCurrentRevisionTask(task, token)) {
      task.active = false;
      task.operationQueue = [];
      if (state.revisionState.attention?.taskId === task.id) state.revisionState.attention = null;
      if (![...state.revisionState.tasks.values()].some((item) => item.active)) {
        setStatus(task.error ? "error" : "ready");
      }
      renderRevisionDocument();
    }
  }
}

function isCurrentRevisionTask(task, token) {
  return !state.sealed && token === task.token && state.revisionState.tasks.get(task.id) === task;
}

async function playParagraphOperationQueue(task, token) {
  for (const pass of task.operationQueue) {
    if (!isCurrentRevisionTask(task, token)) return;
    setRevisionAttention(task, pass.pass_number, "editing");
    const passStartText = task.text;

    for (const operation of pass.operations) {
      if (!isCurrentRevisionTask(task, token)) return;
      await animateOperation(task, operation, token);
      await wait(OPERATION_SETTLE_MS);
    }

    task.text = pass.text;
    task.history.push({
      passNumber: pass.pass_number,
      status: "completed",
      textBefore: passStartText,
      textAfter: pass.text,
      operations: pass.operations,
      contextSnapshot: task.currentPassContextSnapshot,
      timing: { started_at: task.currentPassStartedAt || "", completed_at: nowIso() },
    });
    renderRevisionDocument();
    await wait(PASS_SETTLE_MS);
  }
}

function setRevisionAttention(task, passNumber, phase) {
  state.revisionState.attention = { taskId: task.id, passNumber, phase };
  setStatus(phase === "reading" ? "reading" : `pass_${passNumber}`);
  renderRevisionDocument();
}

async function animateOperation(task, operation, token) {
  const beforeText = task.text;
  const source = operation.source_quote || "";
  const revised = operation.revised_text || "";
  const sourceExists = Boolean(source && operation.targetStart >= 0 && beforeText.slice(operation.targetStart, operation.targetStart + source.length) === source);

  if (sourceExists) {
    for (let count = 1; count <= source.length; count += 1) {
      if (!isCurrentRevisionTask(task, token)) return;
      renderOperationFrame(task, operation, count, 0);
      await wait(characterDelayFor(task.text, source));
    }
  }
  if (revised) {
    for (let count = 1; count <= revised.length; count += 1) {
      if (!isCurrentRevisionTask(task, token)) return;
      renderOperationFrame(task, operation, sourceExists ? source.length : 0, count);
      await wait(characterDelayFor(task.text, revised));
    }
  }

  task.text = applyOperation(beforeText, operation);
  task.html = applyOperationMarkup(task.html, operation);
  task.frameHtml = null;
  renderRevisionDocument();
}

function characterDelayFor(currentText, editText) {
  return /[\u3400-\u9fff]/.test(`${currentText}${editText}`) ? CHINESE_CHAR_DELAY_MS : CHAR_DELAY_MS;
}

function renderOperationFrame(task, operation, deletedCount, insertedCount) {
  const source = operation.source_quote || "";
  const revised = operation.revised_text || "";
  let html = task.html;
  const deletion = source.slice(0, deletedCount);
  const remaining = source.slice(deletedCount);
  const insertion = revised.slice(0, insertedCount);

  const range = source ? markupRangeForPlainText(html, operation.targetStart, source.length) : null;
  if (source && range) {
    const marker = `${deletion ? `<del>${escapeHtml(deletion)}</del>` : ""}${remaining ? `<span class="pending-delete">${escapeHtml(remaining)}</span>` : ""}${insertion ? `<ins>${escapeHtml(insertion)}</ins>` : ""}`;
    html = replaceAt(html, range.start, range.end - range.start, marker);
  } else if (!source && insertion) {
    const offset = markupOffsetForPlainText(html, operation.targetStart ?? task.text.length);
    if (offset !== null) html = replaceAt(html, offset, 0, `<ins>${escapeHtml(insertion)}</ins>`);
  }
  task.frameHtml = html;
  renderRevisionDocument();
}

function applyOperationMarkup(currentHtml, operation) {
  const source = operation.source_quote || "";
  const revised = operation.revised_text || "";
  if (source) {
    const range = markupRangeForPlainText(currentHtml, operation.targetStart, source.length);
    if (!range) return currentHtml;
    const escapedSource = escapeHtml(source);
    const replacement = revised
      ? `<span class="track-replacement"><del title="original wording">${escapedSource}</del><ins title="${escapeHtml(operation.reason)}">${escapeHtml(revised)}</ins></span>`
      : `<del title="${escapeHtml(operation.reason)}">${escapedSource}</del>`;
    return replaceAt(currentHtml, range.start, range.end - range.start, replacement);
  }
  if (!revised || currentHtml.includes(escapeHtml(revised))) return currentHtml;
  const offset = markupOffsetForPlainText(currentHtml, operation.targetStart ?? 0);
  return offset === null ? currentHtml : replaceAt(currentHtml, offset, 0, `<ins title="${escapeHtml(operation.reason)}">${escapeHtml(revised)}</ins>`);
}

function renderRevisionDocument() {
  const paragraphs = state.draftState.paragraphs;
  if (!state.revisionState.tasks.size) {
    els.revisionOutput.innerHTML = '<p class="empty-copy">Press Enter to submit it for revision.</p>';
    return;
  }
  const body = paragraphs.map((paragraph) => {
    const task = state.revisionState.tasks.get(paragraph.id);
    const html = task?.frameHtml ?? task?.html ?? escapeHtml(paragraph.text);
    const error = task?.error ? `<span class="error-copy">${escapeHtml(task.error)}</span>` : "";
    const attention = state.revisionState.attention;
    const readingCaret = attention?.taskId === paragraph.id && attention.phase === "reading"
      ? '<span class="reading-caret" role="status" aria-label="Revision is reading this paragraph"></span>'
      : "";
    const readingClass = attention?.taskId === paragraph.id && attention.phase === "reading" ? " is-reading" : "";
    return `<p class="${readingClass.trim()}" data-paragraph-id="${paragraph.id}">${html || "&nbsp;"}${readingCaret}${error}</p>`;
  }).join("");
  els.revisionOutput.innerHTML = `<article class="tracked-article">${body}</article>`;
}

function assembleRevisionContext(targetParagraphId) {
  return {
    targetParagraphId,
    paragraphs: state.draftState.paragraphs
      .filter((paragraph) => paragraph.committed && paragraph.committedText.trim())
      .map((paragraph) => ({
        id: paragraph.id,
        // A task's text is its latest completed tracked state. Uncommitted live
        // text is intentionally excluded from this computational snapshot.
        text: state.revisionState.tasks.get(paragraph.id)?.text || paragraph.committedText,
      })),
  };
}

function requestRevisionPass({ documentContext, targetParagraphId, targetText, passNumber }) {
  return fetchWithTimeout("/api/revision-pass", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      document_context: documentContext.paragraphs,
      target_paragraph_id: targetParagraphId,
      target_text: targetText,
      pass_number: passNumber,
      editorial_intensity: editorialIntensityForPass(passNumber),
    }),
  }, REVISION_REQUEST_TIMEOUT_MS, "Revision timed out. Use the exhibition reset shortcut to begin a new session.").then(async (response) => {
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "AI revision failed. Please try again.");
    return payload;
  });
}

// The pass number is the primary editorial contract. Intensity is supplied as
// a secondary signal so the model's institutional authority rises gradually
// rather than appearing only in the final pass.
function editorialIntensityForPass(passNumber) {
  if (passNumber <= 2) return "low";
  if (passNumber <= 4) return "medium";
  return "high";
}

function queueLiveParagraphComments(paragraph, { committed = false, requestedCount = 0 } = {}) {
  let task = state.commentState.tasks.get(paragraph.id);
  if (task?.closed && !committed) return;
  if (paragraph.committed && !committed) return;
  if (task?.active) {
    task.needsAnalysis = true;
    return;
  }
  if (!task) {
    task = {
      paragraphId: paragraph.id,
      comments: [],
      nextNumber: 1,
      token: 0,
      active: false,
      closed: false,
      needsAnalysis: false,
      sourceText: "",
      error: "",
    };
    state.commentState.tasks.set(paragraph.id, task);
  }

  task.active = true;
  task.needsAnalysis = false;
  task.sourceText = paragraph.text;
  task.error = "";
  task.lockAfterRequest = committed;
  const token = ++task.token;
  requestEditorialComments(paragraph.id, paragraph.text, task.comments.filter((comment) => comment.status === "active"), requestedCount).then((payload) => {
    if (state.commentState.tasks.get(paragraph.id) !== task || task.token !== token) return;
    reconcileLiveComments(task, payload.comments || [], paragraph.text);
    queueArchiveSave("comment_update", { immediate: true });
  }).catch((error) => {
    if (state.commentState.tasks.get(paragraph.id) === task && task.token === token) task.error = error.message;
  }).finally(() => {
    if (state.commentState.tasks.get(paragraph.id) !== task || task.token !== token) return;
    task.active = false;
    if (task.lockAfterRequest) {
      task.closed = true;
      if (!isDraftEditing()) renderDraftDecorations();
      renderComments();
      return;
    }
    const latest = state.draftState.paragraphs.find((item) => item.id === paragraph.id);
    if (task.needsAnalysis && latest && !latest.committed && latest.text.trim()) {
      queueLiveParagraphComments(latest);
      return;
    }
    if (!isDraftEditing()) renderDraftDecorations();
    renderComments();
    queueArchiveSave("comment_update", { immediate: true });
  });
}

function reconcileLiveComments(task, candidates, latestText) {
  const retained = [];
  const seen = new Set();
  candidates.slice(0, 3).forEach((candidate) => {
    const key = `${candidate.source_quote}|${candidate.category}`;
    if (!candidate.source_quote || !latestText.includes(candidate.source_quote) || seen.has(key)) return;
    seen.add(key);
    const existing = task.comments.find((comment) => comment.status === "active" && comment.source_quote === candidate.source_quote && comment.category === candidate.category);
    retained.push(existing ? { ...existing, textVersion: latestText } : {
      ...candidate,
      id: crypto.randomUUID(),
      number: task.nextNumber++,
      paragraphId: task.paragraphId,
      status: "active",
      textVersion: latestText,
      createdAt: nowIso(),
    });
  });
  task.comments.forEach((comment) => {
    if (!latestText.includes(comment.source_quote)) {
      retained.push({ ...comment, status: "addressed", textVersion: latestText });
    }
  });
  task.comments = retained;
}

function freezeParagraphComments(paragraph) {
  const task = state.commentState.tasks.get(paragraph.id);
  if (task) {
    task.closed = !paragraph.wasPasted;
    task.needsAnalysis = false;
    task.sourceText = paragraph.committedText;
    // Do not let an in-flight reading of an older live version alter the
    // committed manuscript after Enter has frozen it.
    task.active = false;
    task.token += 1;
  }
  if (paragraph.wasPasted) {
    queueLiveParagraphComments(paragraph, { committed: true, requestedCount: 2 });
  }
}

function requestEditorialComments(paragraphId, paragraphText, existingComments, requestedCount) {
  return fetchWithTimeout("/api/editorial-comments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      paragraph_id: paragraphId,
      paragraph_text: paragraphText,
      requested_count: requestedCount,
      existing_comments: existingComments.map(({ source_quote, text, category }) => ({ source_quote, text, category })),
    }),
  }, COMMENT_REQUEST_TIMEOUT_MS, "Editorial notes timed out.").then(async (response) => {
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Editorial notes are temporarily unavailable.");
    return payload;
  });
}

function activeCommentsForParagraph(paragraphId) {
  return (state.commentState.tasks.get(paragraphId)?.comments || []).filter((comment) => comment.status === "active");
}

function removeInvalidCommentAnchors() {
  let changed = false;
  state.commentState.tasks.forEach((task, paragraphId) => {
    const paragraph = state.draftState.paragraphs.find((item) => item.id === paragraphId);
    const latestText = paragraph?.text || "";
    task.comments = task.comments.map((comment) => {
      if (comment.status === "active" && !latestText.includes(comment.source_quote)) {
        changed = true;
        return { ...comment, status: "addressed", textVersion: latestText };
      }
      return comment;
    });
  });
  return changed;
}

function isDraftEditing() {
  return Boolean(document.activeElement && els.draftEditor.contains(document.activeElement));
}

function renderDraftDecorations({ focusParagraphId = "" } = {}) {
  const activeElement = document.activeElement;
  const activeParagraph = activeElement?.closest?.(".draft-paragraph.is-editing");
  const activeParagraphId = focusParagraphId || activeParagraph?.dataset.paragraphId || "";
  const caretOffset = activeParagraph ? caretOffsetWithin(activeParagraph) : null;
  const scrollTop = els.draftEditor.scrollTop;
  const html = state.draftState.paragraphs.map((paragraph) => {
    let paragraphHtml = escapeHtml(paragraph.text);
    activeCommentsForParagraph(paragraph.id).forEach((comment) => {
      const source = escapeHtml(comment.source_quote);
      if (!source || !paragraphHtml.includes(source)) return;
      paragraphHtml = paragraphHtml.replace(source, `<mark class="draft-marker ${state.highlightedCommentId === comment.id ? "active" : ""}" data-comment-id="${comment.id}" data-marker="${comment.number}">${source}</mark>`);
    });
    const isEditable = !paragraph.committed && !paragraph.pending && !state.sealed;
    const classes = isEditable ? "is-editing" : (paragraph.pending ? "is-pending" : "is-committed");
    return `<p class="draft-paragraph ${classes}" data-paragraph-id="${paragraph.id}" contenteditable="${isEditable}" spellcheck="true"${isEditable ? ' data-placeholder="Write about something you are still trying to understand."' : ""}>${paragraphHtml}</p>`;
  }).join("");
  els.draftEditor.innerHTML = html;
  if (activeParagraphId && !state.sealed) {
    const target = els.draftEditor.querySelector(`.draft-paragraph.is-editing[data-paragraph-id="${activeParagraphId}"]`);
    if (target) {
      target.focus();
      placeCaretInParagraph(target, caretOffset);
    }
  }
  els.draftEditor.scrollTop = scrollTop;
  positionComments();
}

function clearDraftDecorations() {
  // Markers remain in locked paragraphs so their comment anchors stay stable.
  // The active paragraph is independently editable and never receives a
  // decoration while the author is typing.
}

function renderComments() {
  const visible = state.draftState.paragraphs.flatMap((paragraph) => activeCommentsForParagraph(paragraph.id));
  if (!visible.length) {
    els.commentsList.innerHTML = '<p class="empty-copy">Editorial notes will appear as the Draft develops.</p>';
    return;
  }
  els.commentsList.innerHTML = visible.map((comment) => `
    <button class="comment-card ${state.highlightedCommentId === comment.id ? "active" : ""}" type="button" data-comment-id="${comment.id}" data-paragraph-id="${comment.paragraphId}">
      <span><span>${escapeHtml(comment.text)}</span></span>
    </button>`).join("");
  positionComments();
}

function activeCommentById(paragraphId, commentId) {
  return activeCommentsForParagraph(paragraphId).find((comment) => comment.id === commentId);
}

function textRangeRect(root, sourceQuote) {
  const sourceStart = root.textContent.indexOf(sourceQuote);
  if (sourceStart < 0) return null;
  const sourceEnd = sourceStart + sourceQuote.length;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node;
  let offset = 0;
  let startNode = null;
  let startOffset = 0;
  let endNode = null;
  let endOffset = 0;

  while ((node = walker.nextNode())) {
    const nextOffset = offset + node.textContent.length;
    if (!startNode && sourceStart >= offset && sourceStart <= nextOffset) {
      startNode = node;
      startOffset = sourceStart - offset;
    }
    if (sourceEnd >= offset && sourceEnd <= nextOffset) {
      endNode = node;
      endOffset = sourceEnd - offset;
      break;
    }
    offset = nextOffset;
  }
  if (!startNode || !endNode) return null;
  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  const rect = range.getBoundingClientRect();
  return rect.height ? rect : null;
}

function positionComments() {
  const listRect = els.commentsList.getBoundingClientRect();
  const draftRect = els.draftEditor.getBoundingClientRect();
  let lowerBoundary = 0;
  els.commentsList.querySelectorAll(".comment-card").forEach((card) => {
    const marker = els.draftEditor.querySelector(`.draft-marker[data-comment-id="${card.dataset.commentId}"]`);
    const paragraph = els.draftEditor.querySelector(`.draft-paragraph[data-paragraph-id="${card.dataset.paragraphId}"]`);
    const comment = activeCommentById(card.dataset.paragraphId, card.dataset.commentId);
    // Editable Draft text deliberately has no injected marker. In that state,
    // measure the source phrase with a DOM Range instead of leaving an
    // absolutely positioned comment unplaced on top of another comment.
    const anchorRect = marker?.getBoundingClientRect()
      || (paragraph && comment ? textRangeRect(paragraph, comment.source_quote) : null)
      || paragraph?.getBoundingClientRect();
    // The margin represents the current reading viewport. Offscreen comments
    // are hidden so accumulated notes cannot force visible cards outside the
    // page or stack over each other in a long manuscript.
    const isVisible = Boolean(anchorRect && anchorRect.bottom > draftRect.top && anchorRect.top < draftRect.bottom);
    card.hidden = !isVisible;
    if (!isVisible) return;
    const preferredTop = anchorRect ? anchorRect.top - listRect.top - 3 : lowerBoundary;
    const top = Math.max(preferredTop, lowerBoundary);
    card.style.top = `${top}px`;
    lowerBoundary = top + card.offsetHeight + 8;
  });
}

function syncRevisionToDraftParagraph() {
  if (state.linkedScroll.revisionPaused) return;
  const draftParagraphs = [...els.draftEditor.querySelectorAll(".draft-paragraph")];
  if (!draftParagraphs.length) return;
  const draftRect = els.draftEditor.getBoundingClientRect();
  const draftCentre = draftRect.top + (draftRect.height / 2);
  // Paragraph correspondence is anchored to each paragraph's first line, not
  // its height or a raw scroll percentage. This remains stable when Revision
  // paragraphs grow substantially longer through Track Changes.
  const active = draftParagraphs.reduce((closest, paragraph) => {
    const rect = paragraph.getBoundingClientRect();
    const distance = Math.abs(rect.top - draftCentre);
    return !closest || distance < closest.distance ? { paragraph, distance, rect } : closest;
  }, null);
  if (!active) return;
  const revisionParagraph = els.revisionOutput.querySelector(`p[data-paragraph-id="${active.paragraph.dataset.paragraphId}"]`);
  if (!revisionParagraph) return;
  const revisionRect = els.revisionOutput.getBoundingClientRect();
  const targetRect = revisionParagraph.getBoundingClientRect();
  const desiredTop = active.rect.top - draftRect.top;
  const targetTop = els.revisionOutput.scrollTop + (targetRect.top - revisionRect.top) - desiredTop;
  const maxTop = Math.max(0, els.revisionOutput.scrollHeight - els.revisionOutput.clientHeight);
  els.revisionOutput.scrollTo({ top: Math.max(0, Math.min(targetTop, maxTop)), behavior: "smooth" });
}

function setHighlightedComment(commentId) {
  state.highlightedCommentId = commentId;
  renderComments();
  renderDraftDecorations();
}

function applyOperation(currentText, operation) {
  const source = operation.source_quote || "";
  const revised = operation.revised_text || "";
  if (source && operation.targetStart >= 0 && currentText.slice(operation.targetStart, operation.targetStart + source.length) === source) {
    return replaceAt(currentText, operation.targetStart, source.length, revised);
  }
  if (!source && revised && !currentText.includes(revised)) return replaceAt(currentText, operation.targetStart ?? currentText.length, 0, revised);
  return currentText;
}

function needsSentenceSpacing(currentText, revisedText) {
  if (!currentText.trim() || !revisedText.trim()) return "";
  return /[\u3400-\u9fff]/.test(currentText + revisedText) ? "" : " ";
}

function lastIndexOf(text, needle) {
  return needle ? text.lastIndexOf(needle) : -1;
}

function replaceAt(text, start, length, replacement) {
  return `${text.slice(0, start)}${replacement}${text.slice(start + length)}`;
}

function planPassOperations(pass, text, editLedger) {
  const budget = VISIBLE_EDIT_BUDGET[pass.pass_number] || VISIBLE_EDIT_BUDGET[6];
  const candidates = (pass.operations || []).map((operation) => {
    if (!operation.source_quote) {
      const anchor = operation.insert_after || "";
      const anchorIndex = anchor ? text.indexOf(anchor) : text.length;
      return { ...operation, initialIndex: anchorIndex < 0 ? -1 : anchorIndex + anchor.length };
    }
    return { ...operation, initialIndex: text.indexOf(operation.source_quote) };
  }).filter((operation) => operation.initialIndex >= 0);

  const ordered = candidates
    .sort((a, b) => a.initialIndex - b.initialIndex)
    .filter((operation) => (operation.source_quote.length + operation.revised_text.length) <= budget.characters)
    .slice(0, budget.operations);
  let current = text;
  let cursor = 0;
  const planned = [];
  ordered.forEach((operation) => {
    const source = operation.source_quote || "";
    const anchorIndex = !source && operation.insert_after ? current.indexOf(operation.insert_after, cursor) : -1;
    const index = source
      ? current.indexOf(source, cursor)
      : (operation.insert_after ? (anchorIndex < 0 ? -1 : anchorIndex + operation.insert_after.length) : current.length);
    if (index < 0) return;
    const duplicate = editLedger.some((entry) => entry.source === source && entry.revised === operation.revised_text);
    if (duplicate) return;
    const plannedOperation = { ...operation, targetStart: index };
    planned.push(plannedOperation);
    current = applyOperation(current, plannedOperation);
    cursor = index + (plannedOperation.revised_text || "").length;
    editLedger.push({ source, revised: operation.revised_text, passNumber: pass.pass_number });
  });
  return planned;
}

function markupRangeForPlainText(html, plainStart, plainLength) {
  let plainIndex = 0;
  let start = -1;
  let end = -1;
  let inDeletion = 0;
  for (let index = 0; index < html.length;) {
    if (html[index] === "<") {
      const close = html.indexOf(">", index);
      if (close < 0) return null;
      const tag = html.slice(index, close + 1).toLowerCase();
      if (/^<del[\s>]/.test(tag)) inDeletion += 1;
      if (/^<\/del/.test(tag)) inDeletion = Math.max(0, inDeletion - 1);
      if (/^<br\b/.test(tag) && !inDeletion) plainIndex += 1;
      index = close + 1;
      continue;
    }
    if (html[index] === "&") {
      const semi = html.indexOf(";", index);
      const next = semi >= 0 ? semi + 1 : index + 1;
      if (!inDeletion) {
        if (plainIndex === plainStart) start = index;
        plainIndex += 1;
        if (plainIndex === plainStart + plainLength) { end = next; break; }
      }
      index = next;
      continue;
    }
    if (!inDeletion) {
      if (plainIndex === plainStart) start = index;
      plainIndex += 1;
      if (plainIndex === plainStart + plainLength) { end = index + 1; break; }
    }
    index += 1;
  }
  return start >= 0 && end >= start ? { start, end } : null;
}

function markupOffsetForPlainText(html, plainOffset) {
  let plainIndex = 0;
  let inDeletion = 0;
  for (let index = 0; index < html.length;) {
    if (html[index] === "<") {
      const close = html.indexOf(">", index);
      if (close < 0) return null;
      const tag = html.slice(index, close + 1).toLowerCase();
      if (/^<del[\s>]/.test(tag)) inDeletion += 1;
      if (/^<\/del/.test(tag)) inDeletion = Math.max(0, inDeletion - 1);
      if (/^<br\b/.test(tag) && !inDeletion) plainIndex += 1;
      index = close + 1;
      continue;
    }
    if (!inDeletion && plainIndex === plainOffset) return index;
    if (html[index] === "&") {
      const semi = html.indexOf(";", index);
      index = semi >= 0 ? semi + 1 : index + 1;
    } else {
      index += 1;
    }
    if (!inDeletion) plainIndex += 1;
  }
  return plainIndex === plainOffset ? html.length : null;
}

function placeCaretAtEnd(element) {
  const range = document.createRange();
  const selection = window.getSelection();
  range.selectNodeContents(element);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function placeCaretInParagraph(element, offset = null) {
  if (offset === null) {
    placeCaretAtEnd(element);
    return;
  }
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let remaining = Math.max(0, offset);
  let node = walker.nextNode();
  while (node) {
    if (remaining <= node.textContent.length) {
      const range = document.createRange();
      const selection = window.getSelection();
      range.setStart(node, remaining);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
    remaining -= node.textContent.length;
    node = walker.nextNode();
  }
  placeCaretAtEnd(element);
}

function countWords(text) {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return /[\u3400-\u9fff]/.test(trimmed) ? trimmed.replace(/\s/g, "").length : trimmed.split(/\s+/).length;
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

els.draftEditor.addEventListener("input", handleDraftInput);
els.draftEditor.addEventListener("paste", handleDraftPaste);
els.draftEditor.addEventListener("keydown", handleDraftKeydown);
els.draftEditor.addEventListener("beforeinput", handleDraftBeforeInput);
els.draftEditor.addEventListener("scroll", () => {
  positionComments();
  syncRevisionToDraftParagraph();
});
els.draftEditor.addEventListener("pointerenter", () => {
  state.linkedScroll.revisionPaused = false;
  syncRevisionToDraftParagraph();
});
els.revisionOutput.addEventListener("pointerenter", () => {
  state.linkedScroll.revisionPaused = true;
});
els.revisionOutput.addEventListener("focusin", () => {
  state.linkedScroll.revisionPaused = true;
});
els.draftEditor.addEventListener("focusin", clearDraftDecorations);
els.draftEditor.addEventListener("focusout", () => {
  window.setTimeout(() => {
    if (!isDraftEditing()) renderDraftDecorations();
  }, 0);
});
els.commentsList.addEventListener("mouseover", (event) => {
  const card = event.target.closest(".comment-card");
  if (card) setHighlightedComment(card.dataset.commentId);
});
els.commentsList.addEventListener("mouseleave", () => setHighlightedComment(""));
els.draftEditor.addEventListener("mouseover", (event) => {
  const marker = event.target.closest(".draft-marker");
  if (marker) setHighlightedComment(marker.dataset.commentId);
});
els.draftEditor.addEventListener("mouseleave", () => setHighlightedComment(""));
window.addEventListener("resize", positionComments);
document.addEventListener("keydown", (event) => {
  // Kept out of the visual interface: exhibition staff can clear the session
  // without introducing a product-style reset control for visitors.
  if (event.ctrlKey && event.altKey && event.key.toLowerCase() === "r") {
    event.preventDefault();
    void resetExhibitionSession();
  }
});

async function resetExhibitionSession() {
  // Complete the persistent lifecycle before clearing the public screen. A
  // completed paragraph closes the visitor session; a draft-only session is
  // retained as incomplete. Neither result deletes archive data.
  await closeArchiveSessionForReset();
  state.revisionState.tasks.forEach((task) => {
    task.token += 1;
    task.active = false;
  });
  state.author = createAuthorLabel();
  state.draft = "";
  state.sealed = false;
  state.draftState.paragraphs = [];
  state.revisionState.tasks.clear();
  state.revisionState.attention = null;
  state.commentState.tasks.clear();
  state.linkedScroll.revisionPaused = false;
  state.highlightedCommentId = "";
  state.archive.hasLocalEdits = false;
  state.archive.pendingSave = false;
  state.archive.queuedEvent = "autosave";
  els.limitNotice.textContent = "";
  ensureEditableParagraph();
  renderDraftDecorations({ focusParagraphId: getEditingParagraph()?.id || "" });
  renderComments();
  renderRevisionDocument();
  els.draftEditor.scrollTop = 0;
  els.revisionOutput.scrollTop = 0;
  setStatus("empty");
  updateChrome();
}

setStatus("empty");
ensureEditableParagraph();
renderDraftDecorations();
renderComments();
updateChrome();
window.addEventListener("pagehide", flushArchiveOnPageHide);
void restoreActiveArchiveSession();
