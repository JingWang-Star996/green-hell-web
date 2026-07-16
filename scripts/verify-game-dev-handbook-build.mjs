import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, relative, resolve, sep } from "node:path";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "game-dev-handbook-out");
const findings = [];
const required = [
  "index.html",
  "styles.css",
  "app.js",
  "handbook-data.js",
  "build-info.json",
  "asset-provenance.json",
  "artifact-manifest.tsv",
  "assets/poster.png",
  "sources/CANOPY-DEVELOPMENT-RETROSPECTIVE.md",
  "sources/CANOPY-FIRST-POSTMORTEM.md",
  "sources/EARLY-PRODUCTION-PLAYBOOK.md",
  "sources/PROJECT-BRIEF.md",
  "sources/PLAYTEST-RUBRIC.md",
];
const forbiddenNames = new Set(["node_modules", ".git", "toy.yaml", "package.json", "package-lock.json"]);
const allowedExternal = new Set([
  "https://www.bilibili.com/toy/green-hell-web/index.html",
  "https://www.bilibili.com/toy/canopy-survival-wiki/index.html",
]);

function sha256(content) { return createHash("sha256").update(content).digest("hex"); }
function portable(path) { return path.split(sep).join("/"); }
async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const item of entries) {
    const full = resolve(directory, item.name);
    if (item.isDirectory()) files.push(...await walk(full));
    else files.push(full);
  }
  return files;
}

for (const file of required) {
  try {
    const info = await stat(resolve(output, file));
    if (!info.isFile() || info.size === 0) findings.push(`${file}: missing or empty`);
  } catch { findings.push(`${file}: missing`); }
}

const files = await walk(output);
for (const file of files) {
  const rel = portable(relative(output, file));
  if (rel.split("/").some((part) => forbiddenNames.has(part))) findings.push(`${rel}: forbidden package content`);
}

const index = await readFile(resolve(output, "index.html"), "utf8");
const css = await readFile(resolve(output, "styles.css"), "utf8");
const app = await readFile(resolve(output, "app.js"), "utf8");
const dataScript = await readFile(resolve(output, "handbook-data.js"), "utf8");
const buildInfo = JSON.parse(await readFile(resolve(output, "build-info.json"), "utf8"));
const provenance = JSON.parse(await readFile(resolve(output, "asset-provenance.json"), "utf8"));

for (const [name, content] of [["index.html", index], ["styles.css", css], ["app.js", app], ["handbook-data.js", dataScript]]) {
  if (/\b(?:src|href)=["']\/(?!\/)/i.test(content)) findings.push(`${name}: root-absolute HTML resource`);
  if (/\burl\(\s*["']?\/(?!\/)/i.test(content)) findings.push(`${name}: root-absolute CSS resource`);
  if (/\b(?:src|href)=["']\/\//i.test(content) || /\burl\(\s*["']?\/\//i.test(content)) findings.push(`${name}: protocol-relative resource`);
  if (/[A-Za-z]:\\(?:Users|文档|Documents|Temp|AppData)\\/i.test(content)) findings.push(`${name}: leaks a local absolute path`);
  if (/feishu|飞书会话|王鲸Codex/i.test(content)) findings.push(`${name}: leaks private notification context`);
}

if (!index.includes('src="./handbook-data.js"') || !index.includes('src="./app.js"') || !index.includes('href="./styles.css"')) findings.push("index.html: scripts/styles must use Toy-safe relative paths");
if (!index.includes('name="viewport"')) findings.push("index.html: missing viewport");
if (!index.includes('lang="zh-CN"')) findings.push("index.html: missing Simplified Chinese language");
if (!index.includes('id="global-search"') || !index.includes('role="search"') && !index.includes('class="global-search"')) findings.push("index.html: missing global search");
if (!index.includes('id="main-content"') || !index.includes('id="knowledge-nav"')) findings.push("index.html: missing main/nav landmarks");
if ((index.match(/<h1\b/g) ?? []).length !== 1) findings.push("index.html: must contain exactly one h1");
if (index.includes("CANOPY 生存档案｜完整游戏 Wiki")) findings.push("index.html: accidentally reuses the player Wiki product title");
if (!app.includes("buildSearchIndex") || !app.includes("tokens.every")) findings.push("app.js: missing source-data AND search");
if (!app.includes("game-dev-handbook:v1:checklist")) findings.push("app.js: missing versioned checklist storage key");

const prefix = "window.GAME_DEV_HANDBOOK_DATA = Object.freeze(";
let data;
if (!dataScript.startsWith(prefix) || !dataScript.trimEnd().endsWith(");")) findings.push("handbook-data.js: invalid wrapper");
else {
  data = JSON.parse(dataScript.slice(prefix.length, dataScript.lastIndexOf(");")));
  const entries = data.chapters.flatMap((chapter) => chapter.entries);
  if (data.meta.counts.chapters !== data.chapters.length || data.chapters.length < 10) findings.push("data: chapter count mismatch or too small");
  if (data.meta.counts.entries !== entries.length || entries.length < 40) findings.push("data: entry count mismatch or too small");
  if (data.meta.counts.gates !== data.gates.length || data.gates.length < 13) findings.push("data: gate count mismatch or too small");
  if (data.meta.counts.terms !== data.glossary.length || data.glossary.length < 70) findings.push("data: glossary count mismatch or too small");
  if (data.meta.counts.checklists !== data.checklists.length || data.checklists.length < 6) findings.push("data: checklist count mismatch or too small");
  if (data.meta.counts.templates !== data.templates.length || data.templates.length < 6) findings.push("data: template count mismatch or too small");
  const ids = [
    ...data.chapters.map((item) => `chapter:${item.id}`),
    ...entries.map((item) => `entry:${item.id}`),
    ...data.gates.map((item) => `gate:${item.id}`),
    ...data.checklists.map((item) => `checklist:${item.id}`),
    ...data.templates.map((item) => `template:${item.id}`),
    ...data.glossary.map((item) => `term:${item.id}`),
  ];
  const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicateIds.length) findings.push(`data: duplicate IDs ${duplicateIds.join(", ")}`);
  const allowedEvidence = new Set(["项目事实", "默认方法", "开放风险"]);
  for (const item of entries) {
    if (!allowedEvidence.has(item.evidence)) findings.push(`entry ${item.id}: invalid evidence label`);
    if (!item.summary || item.practice.length < 2 || item.failureSignals.length < 2 || !item.canopyCase) findings.push(`entry ${item.id}: incomplete decision content`);
    if (!item.sources?.length || item.sources.some((path) => path.startsWith("/") || /^[A-Za-z]:/.test(path))) findings.push(`entry ${item.id}: invalid source path`);
  }
  const forbiddenClaims = ["完整导演已经完成", "完整生态链已经完成", "A3–A5 已完成", "最终 Valheim 式画面已经完成"];
  const serialized = JSON.stringify(data);
  forbiddenClaims.forEach((claim) => { if (serialized.includes(claim)) findings.push(`data: forbidden overclaim ${claim}`); });
  for (const source of data.sourceManifest) {
    const actual = await readFile(resolve(output, "sources", source.file));
    if (actual.byteLength !== source.bytes || sha256(actual) !== source.sha256) findings.push(`source ${source.file}: manifest mismatch`);
  }
  for (const url of serialized.match(/https?:\/\/[^"\\]+/g) ?? []) {
    if (!allowedExternal.has(url)) findings.push(`data: unexpected external URL ${url}`);
  }
}

if (buildInfo.publishMode !== "create-only") findings.push("build-info: must be create-only");
if (!Array.isArray(buildInfo.forbiddenToyIds) || !buildInfo.forbiddenToyIds.includes(10228414336000) || !buildInfo.forbiddenToyIds.includes(11151719061504)) findings.push("build-info: missing protected existing Toy IDs");
if (typeof buildInfo.sourceDirty !== "boolean" || typeof buildInfo.sourceCommit !== "string" || !buildInfo.sourceDigest) findings.push("build-info: incomplete source identity");
if (buildInfo.intendedSlug !== "game-dev-handbook") findings.push("build-info: wrong intended slug");
if (provenance.assets?.length !== 1 || provenance.assets[0]?.file !== "assets/poster.png" || provenance.assets[0]?.license !== "Project-original") findings.push("asset provenance: poster record missing");

const png = await readFile(resolve(output, "assets", "poster.png"));
if (png.toString("hex", 0, 8) !== "89504e470d0a1a0a") findings.push("poster: not a PNG");
else {
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  if (width !== 1200 || height !== 900) findings.push(`poster: expected 1200x900, got ${width}x${height}`);
}

const manifestLines = (await readFile(resolve(output, "artifact-manifest.tsv"), "utf8")).trimEnd().split("\n");
const manifestFiles = new Set();
for (const line of manifestLines) {
  const [path, bytesText, digest] = line.split("\t");
  if (!path || !bytesText || !digest) { findings.push(`artifact manifest: malformed row ${line}`); continue; }
  manifestFiles.add(path);
  const file = resolve(output, path);
  const content = await readFile(file);
  if (content.byteLength !== Number(bytesText) || sha256(content) !== digest) findings.push(`artifact manifest: mismatch ${path}`);
}
for (const file of files.filter((item) => basename(item) !== "artifact-manifest.tsv")) {
  const path = portable(relative(output, file));
  if (!manifestFiles.has(path)) findings.push(`artifact manifest: missing ${path}`);
}
const artifactDigest = sha256(manifestLines.join("\n"));
const totalBytes = (await Promise.all(files.map(async (file) => (await stat(file)).size))).reduce((sum, size) => sum + size, 0);

if (findings.length) {
  console.error(JSON.stringify({ ok: false, files: files.length, bytes: totalBytes, artifactDigest, findings }, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ ok: true, files: files.length, bytes: totalBytes, artifactDigest, sourceDirty: buildInfo.sourceDirty, counts: data.meta.counts, findings: [] }, null, 2));
}
