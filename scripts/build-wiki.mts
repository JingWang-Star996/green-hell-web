import { execFileSync } from "node:child_process";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createWikiData } from "../wiki-src/wikiData";

const root = resolve(import.meta.dirname, "..");
const source = resolve(root, "wiki-src");
const output = resolve(root, "wiki-out");
const assets = resolve(output, "assets");

function currentCommit(): string {
  try {
    return execFileSync("git", ["rev-parse", "--short=12", "HEAD"], {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
    }).trim();
  } catch {
    return "working-tree";
  }
}

await rm(output, { recursive: true, force: true });
await mkdir(assets, { recursive: true });

for (const file of ["index.html", "styles.css", "app.js"]) {
  await cp(resolve(source, file), resolve(output, file));
}
await cp(
  resolve(root, "public", "og-canopy-first-night.png"),
  resolve(assets, "canopy-cover.png"),
);
await cp(
  resolve(root, "public", "wiki-canopy-survival.png"),
  resolve(assets, "wiki-poster.png"),
);
await cp(resolve(root, "public", "icon.svg"), resolve(assets, "icon.svg"));

const generated = createWikiData();
const data = {
  ...generated,
  meta: {
    ...generated.meta,
    builtAt: new Date().toISOString(),
    sourceCommit: currentCommit(),
  },
};
const serialized = JSON.stringify(data).replaceAll("<", "\\u003c");
await writeFile(
  resolve(output, "wiki-data.js"),
  `window.CANOPY_WIKI_DATA = Object.freeze(${serialized});\n`,
  "utf8",
);
await writeFile(
  resolve(output, "build-info.json"),
  `${JSON.stringify({
    title: data.meta.title,
    sourceCommit: data.meta.sourceCommit,
    builtAt: data.meta.builtAt,
    counts: data.meta.counts,
  }, null, 2)}\n`,
  "utf8",
);

console.log(
  `CANOPY Wiki built: ${data.meta.counts.items} items, ${data.meta.counts.recipes} recipes, ${data.meta.counts.tasks} tasks -> ${output}`,
);
