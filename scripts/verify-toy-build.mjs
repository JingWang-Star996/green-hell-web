import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";

import {
  CANONICAL_PLAYER_WIKI_URL,
  LATEST_GAME_RELEASE,
} from "../src/game/releaseNotes.ts";

const outputDirectory = path.resolve("toy-out");
const failures = [];

const indexHtml = await readFile(path.join(outputDirectory, "index.html"), "utf8");
if (!indexHtml.includes('./_next/')) {
  failures.push("index.html does not reference Next.js assets relative to its own directory");
}
if (/\b(?:src|href)=["']\/(?!\/)/.test(indexHtml)) {
  failures.push("index.html contains a root-relative local asset reference");
}

const localReferences = [...indexHtml.matchAll(/\b(?:src|href)=["']([^"']+)["']/g)]
  .map((match) => match[1])
  .filter((reference) => !/^(?:[a-z]+:|\/\/|#)/i.test(reference));

for (const reference of localReferences) {
  const pathname = reference.split(/[?#]/, 1)[0];
  const resolvedPath = path.resolve(outputDirectory, pathname);
  if (!resolvedPath.startsWith(`${outputDirectory}${path.sep}`)) {
    failures.push(`index.html references a path outside the Toy package: ${reference}`);
    continue;
  }
  try {
    await access(resolvedPath);
  } catch {
    failures.push(`index.html references a missing local asset: ${reference}`);
  }
}

const chunkDirectory = path.join(outputDirectory, "_next", "static", "chunks");
const chunkNames = await readdir(chunkDirectory);
const runtimeName = chunkNames.find((name) => name.startsWith("turbopack-") && name.endsWith(".js"));
if (!runtimeName) {
  failures.push("Turbopack runtime chunk is missing");
} else {
  const runtime = await readFile(path.join(chunkDirectory, runtimeName), "utf8");
  if (!/["']\.\/_next\/["']/.test(runtime)) {
    failures.push("Turbopack runtime does not use a relative ./_next/ public path for lazy chunks");
  }
  if (/["']\/_next\/static\//.test(runtime)) {
    failures.push("Turbopack runtime contains a root-relative lazy chunk path");
  }
}

const javascriptChunks = [];
for (const name of chunkNames) {
  if (name.endsWith(".js")) {
    javascriptChunks.push(await readFile(path.join(chunkDirectory, name), "utf8"));
  }
  if (!name.endsWith(".css")) continue;
  const css = await readFile(path.join(chunkDirectory, name), "utf8");
  if (/url\(\s*["']?\/(?!\/)/.test(css)) {
    failures.push(`${name} contains a root-relative CSS asset URL`);
  }
}

const playerFacingArtifact = `${indexHtml}\n${javascriptChunks.join("\n")}`;
if (!playerFacingArtifact.includes(CANONICAL_PLAYER_WIKI_URL)) {
  failures.push(`Toy artifact does not contain the canonical player Wiki URL: ${CANONICAL_PLAYER_WIKI_URL}`);
}
if (!playerFacingArtifact.includes(LATEST_GAME_RELEASE.buildId)) {
  failures.push(`Toy artifact does not contain the latest release build ID: ${LATEST_GAME_RELEASE.buildId}`);
}

if (failures.length > 0) {
  console.error("Toy build verification failed:\n" + failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}

console.log(
  `Toy build verification passed: the single-page entry closure is location-independent and contains Wiki/build ${LATEST_GAME_RELEASE.buildId}.`,
);
