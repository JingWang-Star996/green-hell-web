import assert from "node:assert/strict";
import test from "node:test";

import {
  CANONICAL_PLAYER_WIKI_URL,
  GAME_RELEASE_NOTES,
  LATEST_GAME_RELEASE,
} from "../../src/game/releaseNotes";

function releaseOrderParts(buildId: string): readonly number[] {
  return buildId.split(".").map(Number);
}

function isStrictlyNewer(left: string, right: string): boolean {
  const leftParts = releaseOrderParts(left);
  const rightParts = releaseOrderParts(right);
  return leftParts.some((part, index) =>
    part !== rightParts[index] &&
    leftParts.slice(0, index).every((prefix, prefixIndex) => prefix === rightParts[prefixIndex]) &&
    part > rightParts[index],
  );
}

test("the first release-ledger entry remains a candidate until its Toy artifact is public", () => {
  const firstCandidate = GAME_RELEASE_NOTES[0];

  assert.ok(firstCandidate);
  assert.equal(firstCandidate.buildId, "2026.07.16.1");
  assert.equal(firstCandidate.date, "2026-07-16");
  assert.equal(firstCandidate.status, "candidate");
  assert.ok(firstCandidate.title.trim().length > 0);
  assert.ok(firstCandidate.changes.length > 0);
});

test("every player-visible release has a unique dated build and concrete change list", () => {
  const buildIds = new Set<string>();

  for (const release of GAME_RELEASE_NOTES) {
    assert.match(release.buildId, /^\d{4}\.\d{2}\.\d{2}\.\d+$/);
    assert.match(release.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(release.date, release.buildId.split(".").slice(0, 3).join("-"));
    assert.equal(
      new Date(`${release.date}T00:00:00.000Z`).toISOString().slice(0, 10),
      release.date,
      `${release.buildId} must contain a real calendar date`,
    );
    const serial = Number(release.buildId.split(".").at(-1));
    assert.equal(Number.isSafeInteger(serial) && serial > 0, true, `${release.buildId} needs a positive serial`);
    assert.equal(buildIds.has(release.buildId), false, `duplicate build ${release.buildId}`);
    buildIds.add(release.buildId);
    assert.ok(release.title.trim().length > 0, `${release.buildId} needs a title`);
    assert.ok(release.changes.length > 0, `${release.buildId} needs changes`);
    assert.equal(
      new Set(release.changes.map((change) => `${change.category}:${change.text}`)).size,
      release.changes.length,
      `${release.buildId} contains duplicate changes`,
    );
    for (const change of release.changes) {
      assert.ok(change.text.trim().length >= 8, `${release.buildId} has an empty placeholder`);
    }
  }

  const candidates = GAME_RELEASE_NOTES.filter((release) => release.status === "candidate");
  assert.ok(candidates.length <= 1, "only the newest unpublished build may remain a candidate");
  if (candidates.length === 1) assert.equal(candidates[0], GAME_RELEASE_NOTES[0]);

  for (let index = 1; index < GAME_RELEASE_NOTES.length; index += 1) {
    assert.ok(
      isStrictlyNewer(
        GAME_RELEASE_NOTES[index - 1].buildId,
        GAME_RELEASE_NOTES[index].buildId,
      ),
      "new releases must be prepended in descending build order",
    );
  }
});

test("the game uses the canonical published player Wiki URL", () => {
  assert.equal(
    CANONICAL_PLAYER_WIKI_URL,
    "https://www.bilibili.com/toy/canopy-survival-wiki/index.html",
  );
});

test("the current daily build names its reversible-building player outcome", () => {
  assert.ok(
    LATEST_GAME_RELEASE.changes.some(
      (change) => /前哨迁营/.test(change.text) && /自动保存/.test(change.text),
    ),
  );
});
