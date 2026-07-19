import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("/Users/marigold/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");

const input = process.argv[2];
const output = process.argv[3];
if (!input || !output) throw new Error("Usage: node scripts/render-archive-html.mjs <input.html> <output.pdf>");

const html = await readFile(path.resolve(process.cwd(), input), "utf8");
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1240, height: 1754 }, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: "load" });
await page.pdf({ path: path.resolve(process.cwd(), output), format: "A4", printBackground: true, preferCSSPageSize: true, margin: { top: "0", right: "0", bottom: "0", left: "0" } });
await browser.close();
console.log(path.resolve(process.cwd(), output));
