import { readdir, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "wiki-out");
const required = [
  "index.html",
  "styles.css",
  "app.js",
  "wiki-data.js",
  "build-info.json",
  "assets/canopy-cover.png",
  "assets/wiki-poster.png",
  "assets/icon.svg",
];

const findings = [];
for (const relative of required) {
  try {
    const info = await stat(resolve(output, relative));
    if (!info.isFile() || info.size === 0) findings.push(`${relative}: empty or not a file`);
  } catch {
    findings.push(`${relative}: missing`);
  }
}

const index = await readFile(resolve(output, "index.html"), "utf8");
const styles = await readFile(resolve(output, "styles.css"), "utf8");
const app = await readFile(resolve(output, "app.js"), "utf8");
const dataScript = await readFile(resolve(output, "wiki-data.js"), "utf8");

for (const [name, source] of [["index.html", index], ["styles.css", styles], ["app.js", app]]) {
  if (/\b(?:src|href)=["']\/(?!\/)/i.test(source)) {
    findings.push(`${name}: root-absolute resource path`);
  }
  if (/https?:\/\/(?!www\.bilibili\.com\/toy\/green-hell-web\/index\.html|www\.w3\.org\/2000\/svg)/i.test(source)) {
    findings.push(`${name}: unexpected external network URL`);
  }
}

if (!index.includes('src="./wiki-data.js"') || !index.includes('src="./app.js"')) {
  findings.push("index.html: scripts must use relative Toy-safe paths");
}
if (!index.includes('href="./styles.css"')) {
  findings.push("index.html: stylesheet must use a relative Toy-safe path");
}
if (!index.includes('name="viewport"')) findings.push("index.html: missing viewport meta");
if (!index.includes('id="wiki-search"')) findings.push("index.html: missing primary search input");
if (!index.includes('id="spoiler-toggle"')) findings.push("index.html: missing spoiler control");
if (!index.includes('href="https://www.bilibili.com/toy/green-hell-web/index.html" target="_top"')) {
  findings.push("index.html: game link must escape the Toy iframe to the canonical production URL");
}
if (!app.includes("renderWiki")) findings.push("app.js: missing render entry point");

const prefix = "window.CANOPY_WIKI_DATA = Object.freeze(";
if (!dataScript.startsWith(prefix) || !dataScript.trimEnd().endsWith(");")) {
  findings.push("wiki-data.js: invalid data wrapper");
} else {
  const json = dataScript.slice(prefix.length, dataScript.lastIndexOf(");"));
  const data = JSON.parse(json);
  const counts = data.meta?.counts ?? {};
  if (counts.items !== data.items?.length) findings.push("wiki-data.js: item count mismatch");
  if (counts.recipes !== data.recipes?.length) findings.push("wiki-data.js: recipe count mismatch");
  if (counts.tasks !== data.tasks?.length) findings.push("wiki-data.js: task count mismatch");
  if ((data.faq?.length ?? 0) < 8) findings.push("wiki-data.js: FAQ coverage too small");
  if ((data.sources?.length ?? 0) < 6) findings.push("wiki-data.js: provenance coverage too small");
}

async function walk(directory, prefixPath = "") {
  const names = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of names) {
    const relative = prefixPath ? `${prefixPath}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await walk(resolve(directory, entry.name), relative));
    else files.push(relative);
  }
  return files;
}

const files = await walk(output);
let bytes = 0;
for (const file of files) bytes += (await stat(resolve(output, file))).size;
if (findings.length > 0) {
  console.error(JSON.stringify({ ok: false, findings }, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ ok: true, files: files.length, bytes, findings: [] }, null, 2));
}
