import "dotenv/config";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import OpenAI from "openai";

const require = createRequire(import.meta.url);
const { chromium } = require("/Users/marigold/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");

const root = process.cwd();
const inputPath = process.argv[2] || "archive-inputs/test-archive-001.txt";
const archiveId = path.basename(inputPath, path.extname(inputPath));
const freshRun = process.argv.includes("--fresh");
const outputDir = path.join(root, "output", "pdf");
const dataDir = path.join(root, "output", "archive-data");
const htmlDir = path.join(root, "tmp", "archive-render");
const checkpointDir = path.join(root, "tmp", "archive-checkpoints");
const checkpointPath = path.join(checkpointDir, `${archiveId}.json`);
const apiBase = process.env.ARCHIVE_PIPELINE_BASE_URL || "https://self-reviser.vercel.app";
const model = process.env.OPENAI_MODEL;

const visibleEditBudget = {
  1: { operations: 1, characters: 48 },
  2: { operations: 1, characters: 56 },
  3: { operations: 1, characters: 80 },
  4: { operations: 2, characters: 120 },
  5: { operations: 1, characters: 130 },
  6: { operations: 1, characters: Infinity },
};

if (!process.env.OPENAI_API_KEY || !model) {
  throw new Error("OPENAI_API_KEY and OPENAI_MODEL are required locally to generate the academic paper metadata.");
}

await Promise.all([mkdir(outputDir, { recursive: true }), mkdir(dataDir, { recursive: true }), mkdir(htmlDir, { recursive: true }), mkdir(checkpointDir, { recursive: true })]);

const source = (await readFile(path.resolve(root, inputPath), "utf8")).trim();
const sourceParagraphs = source.split(/\n\s*\n+/).map((text, index) => ({
  id: `archive-${index + 1}`,
  source: text.trim(),
})).filter((paragraph) => paragraph.source);

if (!sourceParagraphs.length) throw new Error("The archive input does not contain any paragraphs.");

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function replaceAt(text, start, length, replacement) {
  return `${text.slice(0, start)}${replacement}${text.slice(start + length)}`;
}

function applyOperation(currentText, operation) {
  const sourceQuote = operation.source_quote || "";
  const revised = operation.revised_text || "";
  if (sourceQuote && operation.targetStart >= 0 && currentText.slice(operation.targetStart, operation.targetStart + sourceQuote.length) === sourceQuote) {
    return replaceAt(currentText, operation.targetStart, sourceQuote.length, revised);
  }
  if (!sourceQuote && revised && !currentText.includes(revised)) return replaceAt(currentText, operation.targetStart ?? currentText.length, 0, revised);
  return currentText;
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
    } else index += 1;
    if (!inDeletion) plainIndex += 1;
  }
  return plainIndex === plainOffset ? html.length : null;
}

function applyOperationMarkup(currentHtml, operation) {
  const sourceQuote = operation.source_quote || "";
  const revised = operation.revised_text || "";
  if (sourceQuote) {
    const range = markupRangeForPlainText(currentHtml, operation.targetStart, sourceQuote.length);
    if (!range) return currentHtml;
    const replacement = revised
      ? `<span class="track-replacement"><del title="original wording">${escapeHtml(sourceQuote)}</del><ins title="${escapeHtml(operation.reason)}">${escapeHtml(revised)}</ins></span>`
      : `<del title="${escapeHtml(operation.reason)}">${escapeHtml(sourceQuote)}</del>`;
    return replaceAt(currentHtml, range.start, range.end - range.start, replacement);
  }
  if (!revised || currentHtml.includes(escapeHtml(revised))) return currentHtml;
  const offset = markupOffsetForPlainText(currentHtml, operation.targetStart ?? 0);
  return offset === null ? currentHtml : replaceAt(currentHtml, offset, 0, `<ins title="${escapeHtml(operation.reason)}">${escapeHtml(revised)}</ins>`);
}

function planPassOperations(pass, text, editLedger) {
  const budget = visibleEditBudget[pass.pass_number] || visibleEditBudget[6];
  const candidates = (pass.operations || []).map((operation) => {
    if (!operation.source_quote) {
      const anchor = operation.insert_after || "";
      const anchorIndex = anchor ? text.indexOf(anchor) : text.length;
      return { ...operation, initialIndex: anchorIndex < 0 ? -1 : anchorIndex + anchor.length };
    }
    return { ...operation, initialIndex: text.indexOf(operation.source_quote) };
  }).filter((operation) => operation.initialIndex >= 0);
  const ordered = candidates
    .sort((left, right) => left.initialIndex - right.initialIndex)
    .filter((operation) => (operation.source_quote.length + operation.revised_text.length) <= budget.characters)
    .slice(0, budget.operations);
  let current = text;
  let cursor = 0;
  const planned = [];
  ordered.forEach((operation) => {
    const sourceQuote = operation.source_quote || "";
    const anchorIndex = !sourceQuote && operation.insert_after ? current.indexOf(operation.insert_after, cursor) : -1;
    const index = sourceQuote
      ? current.indexOf(sourceQuote, cursor)
      : (operation.insert_after ? (anchorIndex < 0 ? -1 : anchorIndex + operation.insert_after.length) : current.length);
    if (index < 0) return;
    const duplicate = editLedger.some((entry) => entry.source === sourceQuote && entry.revised === operation.revised_text);
    if (duplicate) return;
    const plannedOperation = { ...operation, targetStart: index };
    planned.push(plannedOperation);
    current = applyOperation(current, plannedOperation);
    cursor = index + (plannedOperation.revised_text || "").length;
    editLedger.push({ source: sourceQuote, revised: operation.revised_text, passNumber: pass.pass_number });
  });
  return planned;
}

async function request(pathname, body) {
  const response = await fetch(`${apiBase}${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `${pathname} failed with ${response.status}`);
  return payload;
}

let checkpoint = null;
if (!freshRun) {
  try {
    await access(checkpointPath);
    checkpoint = JSON.parse(await readFile(checkpointPath, "utf8"));
    if (checkpoint.sourceText !== source) checkpoint = null;
  } catch { /* First run has no checkpoint. */ }
}

let tasks;
let commentsByParagraph;
let stageSnapshots;

if (checkpoint) {
  tasks = checkpoint.tasks;
  commentsByParagraph = new Map(Object.entries(checkpoint.comments || {}));
  stageSnapshots = new Map(Object.entries(checkpoint.stages || {}).map(([key, value]) => [Number(key), value]));
  console.log(`Resuming Case ${archiveId} after Pass ${Math.max(0, ...stageSnapshots.keys())}.`);
} else {
  tasks = sourceParagraphs.map((paragraph) => ({
    ...paragraph,
    text: paragraph.source,
    html: escapeHtml(paragraph.source),
    history: [],
    editLedger: [],
  }));

  const commentResponses = await Promise.all(tasks.map(async (task) => {
    const response = await request("/api/editorial-comments", {
      paragraph_id: task.id,
      paragraph_text: task.source,
      existing_comments: [],
      requested_count: 2,
    });
    return (response.comments || []).map((comment, index) => ({ ...comment, id: `${task.id}-comment-${index + 1}`, paragraphId: task.id, number: index + 1, status: "active" }));
  }));
  commentsByParagraph = new Map(tasks.map((task, index) => [task.id, commentResponses[index]]));
  stageSnapshots = new Map();
}

async function saveCheckpoint() {
  await writeFile(checkpointPath, JSON.stringify({
    sourceText: source,
    tasks,
    comments: Object.fromEntries(commentsByParagraph),
    stages: Object.fromEntries(stageSnapshots),
  }, null, 2), "utf8");
}

for (let passNumber = Math.max(0, ...stageSnapshots.keys()) + 1; passNumber <= 6; passNumber += 1) {
  const applyPassResponse = (task, result, documentContext) => {
    if (result.safety?.triggered) throw new Error(result.safety.message || "Safety intervention prevents archive generation.");
    const operations = planPassOperations(result.pass, task.text, task.editLedger);
    const before = task.text;
    operations.forEach((operation) => {
      task.text = applyOperation(task.text, operation);
      task.html = applyOperationMarkup(task.html, operation);
    });
    task.history.push({
      pass_number: passNumber,
      title: result.pass.title,
      focus: result.pass.focus,
      text_before: before,
      text_after: task.text,
      operations,
      context_snapshot: documentContext,
    });
  };

  if (passNumber === 6) {
    // Pass 6 is the document-level institutional author. Run its target
    // paragraphs in document order so every later request sees citations that
    // were actually accepted in the preceding final paragraph. This prevents
    // several concurrent requests from independently defaulting to the same
    // theorist.
    for (const task of tasks) {
      const documentContext = tasks.map((item) => ({ id: item.id, text: item.text }));
      const result = await request("/api/revision-pass", {
        document_context: documentContext,
        target_paragraph_id: task.id,
        target_text: task.text,
        pass_number: passNumber,
        editorial_intensity: "high",
      });
      applyPassResponse(task, result, documentContext);
    }
  } else {
    const documentContext = tasks.map((task) => ({ id: task.id, text: task.text }));
    const passResponses = await Promise.all(tasks.map((task) => request("/api/revision-pass", {
      document_context: documentContext,
      target_paragraph_id: task.id,
      target_text: task.text,
      pass_number: passNumber,
      editorial_intensity: passNumber <= 2 ? "low" : passNumber <= 4 ? "medium" : "high",
    })));
    tasks.forEach((task, index) => applyPassResponse(task, passResponses[index], documentContext));
  }
  stageSnapshots.set(passNumber, tasks.map((task) => ({ id: task.id, text: task.text, html: task.html })));
  await saveCheckpoint();
  console.log(`Pass ${passNumber}/6 complete.`);
}

const finalManuscript = tasks.map((task) => task.text).join("\n\n");

const metadataSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "abstract", "keywords"],
  properties: {
    title: { type: "string" },
    abstract: { type: "string" },
    keywords: { type: "array", minItems: 4, maxItems: 6, items: { type: "string" } },
  },
};

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const metadataResponse = await client.responses.create({
  model,
  input: [
    { role: "developer", content: [{ type: "input_text", text: "You prepare front matter for a qualitative humanities or social-science institutional narrative report. The manuscript is already complete. Generate only a restrained academic title, a 100-160 word abstract in the manuscript's dominant language, and 4-6 concise keywords. Ground every claim in the supplied manuscript. Do not introduce new evidence, diagnoses, citations, theoretical claims, or a conclusion that changes the manuscript." }] },
    { role: "user", content: [{ type: "input_text", text: finalManuscript }] },
  ],
  text: { format: { type: "json_schema", name: "archive_paper_metadata", strict: true, schema: metadataSchema } },
});
const metadata = JSON.parse(metadataResponse.output_text);

function markCommentSource(text, comments) {
  let html = escapeHtml(text);
  comments.forEach((comment) => {
    const source = escapeHtml(comment.source_quote || "");
    if (source && html.includes(source)) html = html.replace(source, `<mark>${source}</mark>`);
  });
  return html;
}

function splitForPages(items, limit) {
  const groups = [];
  let group = [];
  let weight = 0;
  items.forEach((item) => {
    const itemWeight = String(item.text || "").length + (String(item.html || "").length - String(item.text || "").length) * 0.35;
    if (group.length && weight + itemWeight > limit) {
      groups.push(group);
      group = [];
      weight = 0;
    }
    group.push(item);
    weight += itemWeight;
  });
  if (group.length) groups.push(group);
  return groups;
}

function wordStagePage(label, paragraphs, { draft = false, continuation = false } = {}) {
  const comments = draft
    ? paragraphs.flatMap((paragraph) => (commentsByParagraph.get(paragraph.id) || []).map((comment) => ({ ...comment, paragraph })))
    : [];
  const main = paragraphs.map((paragraph) => {
    const html = draft ? markCommentSource(paragraph.source, commentsByParagraph.get(paragraph.id) || []) : paragraph.html;
    return `<p data-paragraph-id="${paragraph.id}">${html}</p>`;
  }).join("");
  const noteHtml = comments.map((comment) => `<div class="comment-card"><span class="note-number">${comment.number}</span>${escapeHtml(comment.text)}</div>`).join("");
  return `<section class="sheet word-sheet">
    <header class="word-header"><span>AUTHOR_024.DOCX</span><span>${label}${continuation ? " - CONTINUED" : ""}</span></header>
    <div class="word-rule"></div>
    <div class="word-stage ${draft ? "with-comments" : ""}">
      <article class="word-text">${main}</article>
      ${draft ? `<aside class="word-comments">${noteHtml}</aside>` : ""}
    </div>
  </section>`;
}

function coverPage() {
  return `<section class="sheet paper cover">
    <header class="paper-header"><span>SELF REVISER<br>INSTITUTIONAL NARRATIVE REPORT</span><span>CASE NO.<br><b>001</b></span></header>
    <div class="paper-rule"></div>
    <div class="cover-centre">
      <h1>${escapeHtml(metadata.title)}</h1>
      <div class="cover-line"></div>
      <dl><dt>Author</dt><dd>Anonymous Author 001</dd><dt>Generated by</dt><dd>Self Reviser v1.6</dd><dt>Date</dt><dd>19 July 2026</dd><dt>Classification</dt><dd>Interpretive Report</dd><dt>Distribution</dt><dd>Internal Use Only</dd></dl>
    </div>
    <footer>This report is generated through iterative editorial interpretation.<br>It does not represent the author’s original words, but an institutional reading of the submitted narrative.</footer>
  </section>`;
}

function abstractPage() {
  return `<section class="sheet paper abstract-page">
    <header class="paper-header"><span>SELF REVISER - CASE 001</span><span>INSTITUTIONAL NARRATIVE REPORT</span></header>
    <div class="paper-rule"></div>
    <div class="abstract-content"><h2>Abstract</h2><p>${escapeHtml(metadata.abstract)}</p><div class="keywords"><h3>Keywords</h3><p>${metadata.keywords.map(escapeHtml).join(" &nbsp; | &nbsp; ")}</p></div></div>
    <footer>ii</footer>
  </section>`;
}

function paperBodyPage(paragraphs, pageNumber, continuation = false) {
  return `<section class="sheet paper body-page">
    <header class="paper-header"><span>SELF REVISER - CASE 001</span><span>INSTITUTIONAL NARRATIVE REPORT</span></header>
    <div class="paper-rule"></div>
    <article class="paper-body">${continuation ? "" : "<h2>Institutional Narrative</h2>"}${paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}</article>
    <footer>${pageNumber}</footer>
  </section>`;
}

const sheets = [];
const draftItems = tasks.map((task) => ({ id: task.id, source: task.source, text: task.source }));
splitForPages(draftItems, 1250).forEach((group, index) => sheets.push(wordStagePage("ORIGINAL DRAFT + EDITORIAL NOTES", group, { draft: true, continuation: index > 0 })));
for (const passNumber of [1, 3, 4, 5, 6]) {
  const snapshot = stageSnapshots.get(passNumber);
  const limit = passNumber === 6 ? 1050 : 1450;
  splitForPages(snapshot, limit).forEach((group, index) => sheets.push(wordStagePage(`REVISION PASS ${passNumber}`, group, { continuation: index > 0 })));
}
sheets.push(coverPage(), abstractPage());
const finalGroups = splitForPages(finalManuscript.split(/\n\s*\n+/).map((text) => ({ text })), 1200);
finalGroups.forEach((group, index) => sheets.push(paperBodyPage(group.map((item) => item.text), index + 1, index > 0)));

const html = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>Self Reviser ${archiveId}</title><style>
  @page { size: A4 portrait; margin: 0; }
  * { box-sizing: border-box; }
  body { margin:0; background:#d0d3d4; color:#111; font-family:"Times New Roman", "Songti SC", "STSong", serif; }
  .sheet { position:relative; width:210mm; min-height:297mm; margin:0 auto; padding:18mm 17mm 16mm; background:#fff; page-break-after:always; break-after:page; }
  .word-sheet { padding:16mm 14mm 16mm; }
  .word-header,.paper-header { display:flex; justify-content:space-between; gap:12mm; color:#222; font:700 7.8pt/1.45 "Times New Roman", "Songti SC", serif; letter-spacing:.45pt; }
  .word-rule,.paper-rule { height:1px; margin:4mm 0 11mm; background:#777; }
  .word-stage { min-height:246mm; }
  .word-stage.with-comments { display:grid; grid-template-columns:minmax(0, 68%) minmax(0, 27%); gap:5%; }
  .word-text { font-size:10.2pt; line-height:1.66; }
  .word-text p { margin:0 0 7.5mm; text-align:left; }
  .word-text mark { background:transparent; border-bottom:1px solid #c00000; color:inherit; }
  .word-comments { border-left:1px solid #ececec; padding-left:5mm; }
  .comment-card { position:relative; margin:0 0 6mm; padding:2.3mm 2.5mm; border:1px solid #c00000; color:#222; background:#fff; font-size:7.4pt; line-height:1.35; }
  .comment-card::before { content:""; position:absolute; top:6mm; left:-31mm; width:30mm; border-top:1px dashed #c00000; }
  .note-number { color:#c00000; margin-right:1.4mm; font-weight:bold; }
  .word-stage:not(.with-comments) .word-text { font-size:9.7pt; line-height:1.67; }
  del { color:#777; text-decoration-color:#777; text-decoration-thickness:.75pt; }
  ins { color:#b00000; text-decoration:none; }
  .track-replacement del { margin-right:.8mm; }
  .paper { padding:18mm 20mm 18mm; }
  .paper-header { font-size:7.5pt; }
  .paper-rule { margin-bottom:13mm; }
  .cover .paper-header { min-height:16mm; }
  .cover-centre { margin-top:46mm; text-align:center; }
  .cover h1 { max-width:130mm; margin:0 auto; font-weight:400; font-size:28pt; line-height:1.23; }
  .cover-line { width:35mm; height:1px; margin:14mm auto 20mm; background:#777; }
  .cover dl { display:grid; grid-template-columns:30mm 1px 1fr; width:111mm; margin:0 auto; text-align:left; font-size:10pt; line-height:2.0; }
  .cover dl::before { content:""; grid-column:2; grid-row:1 / span 5; background:#999; }
  .cover dt { grid-column:1; margin:0; }
  .cover dd { grid-column:3; margin:0; padding-left:6mm; }
  .paper footer { position:absolute; right:20mm; bottom:13mm; left:20mm; padding-top:6mm; border-top:1px solid #888; color:#222; text-align:center; font-size:7.5pt; line-height:1.55; font-style:italic; }
  .abstract-content { margin-top:23mm; }
  .abstract-content h2 { margin:0 0 11mm; font-size:22pt; font-weight:400; }
  .abstract-content > p { max-width:142mm; margin:0; font-size:11pt; line-height:1.9; text-align:left; }
  .keywords { margin-top:27mm; padding-top:8mm; border-top:1px solid #999; }
  .keywords h3 { margin:0 0 5mm; font-size:12pt; font-weight:400; }
  .keywords p { font-size:9.5pt; line-height:1.7; }
  .body-page .paper-body { font-size:10.8pt; line-height:1.85; }
  .paper-body h2 { margin:22mm 0 14mm; font-size:20pt; font-weight:400; }
  .paper-body p { margin:0 0 7.5mm; text-align:left; }
  @media screen { body { padding:8mm 0; } .sheet { margin-bottom:8mm; box-shadow:0 1mm 4mm rgba(0,0,0,.18); } }
</style></head><body>${sheets.join("\n")}</body></html>`;

const htmlPath = path.join(htmlDir, `${archiveId}.html`);
const pdfPath = path.join(outputDir, `self-reviser-${archiveId}-printable-archive.pdf`);
const dataPath = path.join(dataDir, `self-reviser-${archiveId}-pipeline.json`);
await writeFile(htmlPath, html, "utf8");
await writeFile(dataPath, JSON.stringify({ sourceParagraphs, comments: Object.fromEntries(commentsByParagraph), stages: Object.fromEntries(stageSnapshots), finalManuscript, metadata }, null, 2), "utf8");

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1240, height: 1754 }, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: "load" });
await page.pdf({ path: pdfPath, format: "A4", printBackground: true, preferCSSPageSize: true, margin: { top: "0", right: "0", bottom: "0", left: "0" } });
await browser.close();

console.log(JSON.stringify({ archive: archiveId, pdfPath, dataPath, pages: sheets.length }, null, 2));
