import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const sourceId = "test-archive-001";
const archiveId = "test-archive-001-plural-theory";
const sourcePath = path.join(root, "output", "archive-data", `self-reviser-${sourceId}-pipeline.json`);
const variantPath = path.join(root, "output", "paper-variants", `self-reviser-${sourceId}-plural-theory-paper.json`);
const outputPath = path.join(root, "output", "archive-data", `self-reviser-${archiveId}-pipeline.json`);

const [source, variant] = await Promise.all([
  readFile(sourcePath, "utf8").then(JSON.parse),
  readFile(variantPath, "utf8").then(JSON.parse),
]);

const esc = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

const previousPass = source.stages["5"] || [];
// Pass 6 is a real revision of Pass 5, not an all-new red manuscript. Each
// completed Pass 5 insertion remains visible as a red struck-through source,
// followed by the new theoretical reading as a red insertion.
const passSix = variant.paper.map((paragraph, index) => ({
  id: `archive-1-pass6-${index + 1}`,
  text: paragraph,
  html: `<span class="track-replacement"><del class="former-insertion" title="Accepted wording at the end of Pass 5">${esc(previousPass[index]?.text || "")}</del><ins title="Pass 6 repositions the accepted Pass 5 material through a plural theoretical reading; the analysis remains grounded in the same submitted narrative.">${esc(paragraph)}</ins></span>`,
}));

const data = {
  ...source,
  metadata: {
    ...source.metadata,
    title: variant.title,
    abstract: variant.abstract,
    keywords: variant.keywords,
  },
  stages: { ...source.stages, "6": passSix },
  finalManuscript: variant.paper.join("\n\n"),
  archiveVariant: {
    name: "plural-theory-pass-6",
    source: "Accepted Pass 6 was re-read as a multi-framework institutional manuscript.",
  },
};

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, JSON.stringify(data, null, 2), "utf8");
console.log(JSON.stringify({ archiveId, outputPath, passSixParagraphs: passSix.length }, null, 2));
