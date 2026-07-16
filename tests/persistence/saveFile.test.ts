import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_SAVE_FILE_BYTES,
  checksum,
  createSaveEnvelope,
  createSaveFileText,
  parseSaveFileText,
} from "../../src/game/persistence";

type Payload = { seed: number; tick: number; marker: string };

function isPayload(value: unknown): value is Payload {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Payload>;
  return (
    Number.isSafeInteger(candidate.seed) &&
    Number.isSafeInteger(candidate.tick) &&
    typeof candidate.marker === "string"
  );
}

function parse(raw: string) {
  return parseSaveFileText<Payload>(raw, {
    schema: 1,
    content: ["canopy@2", "canopy@1"],
    payloadValidator: isPayload,
    checkpointValidator: (envelope) =>
      envelope.seed === envelope.payload.seed &&
      envelope.simTick === envelope.payload.tick,
  });
}

function envelope() {
  return createSaveEnvelope<Payload>({
    schema: 1,
    content: "canopy@2",
    runEpoch: 10,
    revision: 4,
    device: "private-device-id",
    seed: 7,
    simTick: 22,
    payload: { seed: 7, tick: 22, marker: "雨林恢复点" },
  });
}

test("portable save files round-trip envelope and retained recipe profile", () => {
  const raw = createSaveFileText(envelope(), {
    retainedRecipeIds: ["shelter", "stone-blade", "shelter"],
  }, "2026-07-15T03:00:00.000Z");
  const result = parse(raw);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.envelope.payload.marker, "雨林恢复点");
  assert.equal(result.envelope.device, "portable-export");
  assert.deepEqual(result.profile.retainedRecipeIds, ["shelter", "stone-blade"]);
  assert.equal(result.exportedAt, "2026-07-15T03:00:00.000Z");
  assert.doesNotMatch(raw, /private-device-id/);
});

test("wrapper tampering is rejected before the gameplay envelope is trusted", () => {
  const value = JSON.parse(createSaveFileText(envelope(), { retainedRecipeIds: [] }));
  value.exportedAt = "2027-01-01T00:00:00.000Z";
  const result = parse(JSON.stringify(value));
  assert.deepEqual(
    { ok: result.ok, reason: result.ok ? undefined : result.reason },
    { ok: false, reason: "file-checksum-mismatch" },
  );
});

test("an envelope checksum failure survives a recomputed outer checksum", () => {
  const value = JSON.parse(createSaveFileText(envelope(), { retainedRecipeIds: [] }));
  value.envelope.payload.marker = "tampered";
  value.checksum = checksum({
    format: value.format,
    fileVersion: value.fileVersion,
    product: value.product,
    exportedAt: value.exportedAt,
    envelope: value.envelope,
    profile: value.profile,
  });
  const result = parse(JSON.stringify(value));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "envelope-invalid");
    assert.equal(result.envelopeReason, "checksum-mismatch");
  }
});

test("oversized and excessively deep files are rejected with bounded work", () => {
  assert.equal(parse(`"${"x".repeat(MAX_SAVE_FILE_BYTES)}"`).ok, false);

  let nested: unknown = null;
  for (let index = 0; index < 70; index += 1) nested = { nested };
  const deep = parse(JSON.stringify(nested));
  assert.equal(deep.ok, false);
  if (!deep.ok) assert.equal(deep.reason, "too-complex");
});

test("checkpoint metadata must agree with the payload", () => {
  const mismatched = createSaveEnvelope<Payload>({
    schema: 1,
    content: "canopy@2",
    revision: 1,
    device: "device",
    seed: 7,
    simTick: 23,
    payload: { seed: 7, tick: 22, marker: "mismatch" },
  });
  const result = parse(createSaveFileText(mismatched, { retainedRecipeIds: [] }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "checkpoint-mismatch");
});
