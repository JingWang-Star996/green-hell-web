import { cp, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";

const sourceDirectory = path.resolve("out");
const publicDirectory = path.resolve("public");
const targetDirectory = path.resolve("toy-out");

await rm(targetDirectory, { recursive: true, force: true });
await mkdir(targetDirectory, { recursive: true });

await cp(path.join(sourceDirectory, "index.html"), path.join(targetDirectory, "index.html"));
await cp(path.join(sourceDirectory, "_next"), path.join(targetDirectory, "_next"), { recursive: true });

for (const entry of await readdir(publicDirectory, { withFileTypes: true })) {
  await cp(path.join(publicDirectory, entry.name), path.join(targetDirectory, entry.name), {
    recursive: entry.isDirectory(),
  });
}

console.log("Prepared Toy entry closure in toy-out/.");
