import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, relative, resolve, sep } from "node:path";

import { createHandbookData } from "../handbook-src/handbookData";

const root = resolve(import.meta.dirname, "..");
const source = resolve(root, "handbook-src");
const output = resolve(root, "game-dev-handbook-out");
const assets = resolve(output, "assets");
const sourceOutput = resolve(output, "sources");

const SOURCE_DOCUMENTS = [
  { path: "docs/CANOPY_DEVELOPMENT_RETROSPECTIVE_AND_NEXT_GAME_PLAYBOOK.md", file: "CANOPY-DEVELOPMENT-RETROSPECTIVE.md", title: "CANOPY 开发总复盘与下一款游戏制作手册" },
  { path: "docs/POSTMORTEM.md", file: "CANOPY-FIRST-POSTMORTEM.md", title: "CANOPY 首版失败复盘" },
  { path: "docs/PRODUCTION_PLAYBOOK.md", file: "EARLY-PRODUCTION-PLAYBOOK.md", title: "早期端到端制作流程（历史）" },
  { path: "PROJECT_BRIEF.md", file: "PROJECT-BRIEF.md", title: "项目交付简报" },
  { path: "PLAYTEST_RUBRIC.md", file: "PLAYTEST-RUBRIC.md", title: "试玩量表" },
] as const;

function sha256(content: Uint8Array | string): string {
  return createHash("sha256").update(content).digest("hex");
}

function git(args: string[]): string {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true }).trim();
  } catch {
    return "unavailable";
  }
}

function portablePath(path: string): string {
  return path.split(sep).join("/");
}

async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const item of entries) {
    const full = resolve(directory, item.name);
    if (item.isDirectory()) files.push(...await walk(full));
    else files.push(full);
  }
  return files;
}

await rm(output, { recursive: true, force: true });
await mkdir(assets, { recursive: true });
await mkdir(sourceOutput, { recursive: true });

for (const file of ["index.html", "styles.css", "app.js"]) {
  await cp(resolve(source, file), resolve(output, file));
}
await cp(resolve(root, "public", "game-dev-handbook-poster.png"), resolve(assets, "poster.png"));

const sourceManifest = [];
for (const item of SOURCE_DOCUMENTS) {
  const original = resolve(root, item.path);
  const bytes = await readFile(original);
  await writeFile(resolve(sourceOutput, item.file), bytes);
  sourceManifest.push({
    ...item,
    bytes: bytes.byteLength,
    sha256: sha256(bytes),
  });
}

const sourceCanonical = sourceManifest
  .map((item) => `${item.path}\t${item.bytes}\t${item.sha256}`)
  .sort((left, right) => left.localeCompare(right))
  .join("\n");
const sourceCommit = git(["rev-parse", "HEAD"]);
const sourceDirty = git(["status", "--porcelain"]) !== "";
const sourceEpoch = Number.parseInt(process.env.SOURCE_DATE_EPOCH ?? "", 10);
const builtAt = Number.isFinite(sourceEpoch) ? new Date(sourceEpoch * 1000).toISOString() : new Date().toISOString();

const generated = createHandbookData();
const data = {
  ...generated,
  meta: {
    ...generated.meta,
    schemaVersion: 1,
    builtAt,
    sourceCommit,
    sourceDirty,
    sourceDigest: sha256(sourceCanonical),
  },
  sourceManifest,
};
const serialized = JSON.stringify(data).replaceAll("<", "\\u003c");
await writeFile(resolve(output, "handbook-data.js"), `window.GAME_DEV_HANDBOOK_DATA = Object.freeze(${serialized});\n`, "utf8");

await writeFile(resolve(output, "asset-provenance.json"), `${JSON.stringify({
  assets: [{
    file: "assets/poster.png",
    kind: "code-generated-raster",
    generator: "scripts/create-game-dev-handbook-poster.py",
    source: "Original typography and geometry; no external artwork",
    size: "1200x900",
    purpose: "Bilibili Toy public listing poster",
    license: "Project-original",
  }],
}, null, 2)}\n`, "utf8");

await writeFile(resolve(output, "build-info.json"), `${JSON.stringify({
  title: data.meta.title,
  edition: data.meta.edition,
  builtAt,
  sourceCommit,
  sourceDirty,
  sourceDigest: data.meta.sourceDigest,
  sourceDocuments: sourceManifest.length,
  counts: data.meta.counts,
  publishMode: "create-only",
  forbiddenToyIds: [10228414336000, 11151719061504],
  intendedSlug: "game-dev-handbook",
}, null, 2)}\n`, "utf8");

const artifactFiles = (await walk(output))
  .filter((file) => basename(file) !== "artifact-manifest.tsv")
  .sort((left, right) => portablePath(relative(output, left)).localeCompare(portablePath(relative(output, right))));
const artifactRows = [];
for (const file of artifactFiles) {
  const bytes = await readFile(file);
  artifactRows.push(`${portablePath(relative(output, file))}\t${bytes.byteLength}\t${sha256(bytes)}`);
}
const artifactDigest = sha256(artifactRows.join("\n"));
await writeFile(resolve(output, "artifact-manifest.tsv"), `${artifactRows.join("\n")}\n`, "utf8");

const totalBytes = (await Promise.all((await walk(output)).map(async (file) => (await stat(file)).size))).reduce((sum, size) => sum + size, 0);
console.log(JSON.stringify({
  ok: true,
  output,
  files: (await walk(output)).length,
  bytes: totalBytes,
  artifactDigest,
  sourceCommit,
  sourceDirty,
  sourceDigest: data.meta.sourceDigest,
  counts: data.meta.counts,
}, null, 2));
