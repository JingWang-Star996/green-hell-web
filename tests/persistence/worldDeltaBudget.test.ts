import assert from "node:assert/strict";
import test from "node:test";

import {
  MemoryKV,
  SaveRepository,
  ToyBridgeCloudKV,
  createSaveEnvelope,
} from "../../src/game/persistence";
import {
  TOY_CLOUD_MAX_ITEM_BYTES,
  TOY_CLOUD_MAX_KEYS,
  ToyBridgeClient,
  type RawToyBridge,
} from "../../src/game/platform";
import { createInitialState } from "../../src/game/sim/state";
import type { GameState, WorldEntity } from "../../src/game/sim/types";
import { worldToChunkCoordinate } from "../../src/game/world/generation";
import { materializeGeneratedWorldChunk } from "../../src/game/world/saveDelta";

const encoder = new TextEncoder();
const STRUCTURE_BUDGET_BYTES = 24 * 1_024;
const NORMAL_CLOUD_KEY_BUDGET = 40;
const EVENT_PRESSURE_CLOUD_KEY_BUDGET = 80;
const SAVE_SCHEMA = 1;
const SAVE_CONTENT = "canopy-first-night@7";

function isGameState(value: unknown): value is GameState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<GameState>;
  return (
    candidate.version === 1 &&
    typeof candidate.seed === "number" &&
    Boolean(candidate.player && candidate.world && candidate.world.entities)
  );
}

function fakeToyCloud(): {
  storage: Record<string, string>;
  bridge: RawToyBridge;
} {
  const storage: Record<string, string> = {};
  const bridge: RawToyBridge = {
    getCloudStorage(keys = []) {
      if (keys.length === 0) return { ...storage };
      return Object.fromEntries(
        keys.filter((key) => key in storage).map((key) => [key, storage[key]]),
      );
    },
    setCloudStorage(items) {
      Object.assign(storage, items);
    },
    removeCloudStorage(keys) {
      for (const key of keys) delete storage[key];
    },
  };
  return { storage, bridge };
}

function generatedEntities(state: GameState): WorldEntity[] {
  return Object.values(state.world.entities).filter((entity) =>
    entity.tags.includes("generated"),
  );
}

function assertToyPhysicalStorage(
  storage: Readonly<Record<string, string>>,
  keyBudget: number,
): void {
  const entries = Object.entries(storage);
  assert.ok(
    entries.length <= keyBudget,
    `primary + backup should use at most ${keyBudget} physical keys; got ${entries.length}`,
  );
  assert.ok(entries.length <= TOY_CLOUD_MAX_KEYS);
  for (const [key, value] of entries) {
    const physicalBytes =
      encoder.encode(key).byteLength + encoder.encode(value).byteLength;
    assert.ok(
      physicalBytes <= TOY_CLOUD_MAX_ITEM_BYTES,
      `${key} uses ${physicalBytes} UTF-8 bytes; Toy permits ${TOY_CLOUD_MAX_ITEM_BYTES}`,
    );
  }
}

function torchWaymarkSaveProjection(state: GameState) {
  return (state.camp.structures ?? [])
    .filter((structure) => structure.kind === "torch-waymark")
    .map((structure) => ({
      id: structure.id,
      torchFuelQueueSeconds: [...(structure.torchFuelQueueSeconds ?? [])],
      lit: structure.lit,
      everLit: structure.everLit,
    }));
}

function createTorchWaymarks() {
  return Array.from({ length: 80 }, (_, index) => {
    const firstFuelSeconds = 239.875 - (index % 19) * 7.125;
    const secondFuelSeconds = 173.625 - (index % 11) * 9.25;
    return {
      id: `structure.torch-waymark.${10_000 + index}`,
      kind: "torch-waymark" as const,
      position: {
        x: -280.375 + index * 7.125,
        y: 0,
        z: -45.625 + (index % 11) * 9.375,
      },
      yaw: (index % 16) * (Math.PI / 8),
      builtAtTick: 60_000 + index * 113,
      torchFuelQueueSeconds:
        index % 2 === 0
          ? [firstFuelSeconds, secondFuelSeconds]
          : [firstFuelSeconds],
      lit: index % 3 !== 0,
      everLit: true,
      lastAdvancedTick: 71_000 + index,
    };
  });
}

function createLowCompressionEventLog(): GameState["eventLog"] {
  return Array.from({ length: 256 }, (_, index) => {
    const firstEntropy = Math.imul(index + 1, 2_654_435_761) >>> 0;
    const secondEntropy = Math.imul(index + 977, 2_246_822_519) >>> 0;
    return {
      id: 5_000 + index,
      tick: 9_000_000 + index * 37,
      elapsedSeconds: 300_000 + index * 1.233,
      type:
        index % 3 === 0
          ? ("harvest-struck" as const)
          : index % 3 === 1
            ? ("resource-picked" as const)
            : ("command-rejected" as const),
      message: `雨林记录 ${index}：坐标 ${firstEntropy.toString(16)} 的差异化交互反馈 ${secondEntropy.toString(36)}。`,
      cause: {
        source: index % 2 === 0 ? ("system" as const) : ("command" as const),
        code: `budget:event:${index}:${secondEntropy}`,
      },
      details: {
        targetId: `semantic:${index}:${firstEntropy}`,
        amount: ((secondEntropy % 100_000) + 1) / 10_000,
        accepted: index % 4 !== 0,
      },
    };
  });
}

test("a ten-hour travel-scale world saves as seed plus sparse deltas within Toy budget", async () => {
  const state = createInitialState("ten-hour-world-budget");
  // 2.7 m/s walking for ten real hours is roughly 2,025 straight 48 m chunks.
  const travelChunks = 2_025;
  for (let x = 2; x < travelChunks + 2; x += 1) {
    materializeGeneratedWorldChunk(state, { x, z: 2 });
    state.world.exploredChunks?.push(`${x}:2`);
  }
  const generated = generatedEntities(state);
  assert.ok(generated.length > 15_000, "the runtime reproduction must be genuinely large");

  const partial = generated[10];
  const depleted = generated[Math.floor(generated.length / 2)];
  const farPartial = generated.at(-10)!;
  partial.quantity = Math.max(0, partial.quantity - 1);
  partial.depleted = partial.quantity === 0;
  partial.regeneration = {
    capacity: Math.max(2, partial.regeneration?.capacity ?? 2),
    nextTick: 180_000,
    cycle: 3,
    nextAmount: 1,
  };
  depleted.quantity = 0;
  depleted.depleted = true;
  depleted.regeneration = {
    capacity: Math.max(1, depleted.regeneration?.capacity ?? 1),
    nextTick: 240_000,
    cycle: 4,
    nextAmount: 1,
  };
  farPartial.quantity = Math.max(0, farPartial.quantity - 1);
  farPartial.depleted = farPartial.quantity === 0;
  farPartial.regeneration = {
    capacity: Math.max(2, farPartial.regeneration?.capacity ?? 2),
    nextTick: 300_000,
    cycle: 5,
    nextAmount: 1,
  };

  const battery = state.world.entities["resource.battery.weather-station"];
  battery.quantity = 0;
  battery.depleted = true;
  state.objectives.flags.batteryRecovered = true;
  state.world.riverHydrology = {
    version: 1,
    levelMeters: 0.281_25,
    runoff: 0.712_5,
    trendMetersPerGameHour: 0.093_75,
    lastAdvancedTick: 71_937,
  };
  const expectedHydrology = structuredClone(state.world.riverHydrology);
  state.camp.shelterBuilt = true;
  state.camp.structures = [
    {
      id: "structure.shelter.budget-test",
      kind: "shelter",
      position: { x: 12, y: 0, z: 14 },
      yaw: 0.75,
      builtAtTick: 72_000,
    },
    ...createTorchWaymarks(),
    ...Array.from({ length: 12 }, (_, index) => ({
      id: `structure.rain-collector.budget-${index}`,
      kind: "rain-collector" as const,
      position: { x: 96 + index * 4, y: 0, z: 96 },
      yaw: (index % 4) * (Math.PI / 2),
      builtAtTick: 60_000 + index,
      storedUnits: (index % 5) * 0.75,
      capacity: 4,
      lastAdvancedTick: 72_000,
    })),
  ];
  const expectedWaymarks = torchWaymarkSaveProjection(state);
  assert.equal(expectedWaymarks.length, 80);
  const structureBytes = encoder.encode(
    JSON.stringify(state.camp.structures),
  ).byteLength;
  assert.ok(
    structureBytes <= STRUCTURE_BUDGET_BYTES,
    `80 waymarks + 12 collectors use ${structureBytes} UTF-8 bytes; budget is ${STRUCTURE_BUDGET_BYTES}`,
  );

  const local = new MemoryKV();
  const fake = fakeToyCloud();
  const cloud = new ToyBridgeCloudKV(new ToyBridgeClient({ bridge: fake.bridge }));
  const repository = new SaveRepository<GameState>({
    key: "canopy_first_night_v2",
    schema: SAVE_SCHEMA,
    content: SAVE_CONTENT,
    device: "budget-device",
    kv: local,
    cloud,
    payloadValidator: isGameState,
  });

  assert.equal((await repository.save(state, { seed: state.seed, simTick: 72_000 })).ok, true);
  assert.equal((await repository.save(state, { seed: state.seed, simTick: 72_001 })).ok, true);
  await repository.whenCloudIdle();
  assert.equal(repository.getCloudStatus(), "synced");

  const raw = local.getItem(repository.key)!;
  const stored = JSON.parse(raw) as {
    payload: {
      world: {
        format: string;
        entities?: unknown;
        generatedResourceChunks?: unknown;
        deltas: unknown[];
        riverHydrology?: unknown;
      };
    };
  };
  assert.equal(stored.payload.world.format, "canopy-world-delta");
  assert.equal(stored.payload.world.entities, undefined);
  assert.equal(stored.payload.world.generatedResourceChunks, undefined);
  assert.equal(stored.payload.world.deltas.length, 4);
  assert.deepEqual(stored.payload.world.riverHydrology, [
    1,
    0.281_25,
    0.712_5,
    0.093_75,
    71_937,
  ]);

  assertToyPhysicalStorage(fake.storage, NORMAL_CLOUD_KEY_BUDGET);

  const fullEntityEnvelope = createSaveEnvelope({
    schema: SAVE_SCHEMA,
    content: SAVE_CONTENT,
    revision: 1,
    device: "legacy-full-world",
    seed: state.seed,
    simTick: 72_000,
    payload: state,
  });
  const legacyCloud = fakeToyCloud();
  const legacyAdapter = new ToyBridgeCloudKV(
    new ToyBridgeClient({ bridge: legacyCloud.bridge }),
  );
  assert.equal(
    await legacyAdapter.setItems({ full_entity_world: JSON.stringify(fullEntityEnvelope) }),
    false,
    "the reproduced full-entity save should exceed Toy's 128-key ceiling",
  );

  const restoredRepository = new SaveRepository<GameState>({
    key: repository.key,
    schema: SAVE_SCHEMA,
    content: SAVE_CONTENT,
    device: "restore-device",
    kv: new MemoryKV({ [repository.key]: raw }),
    payloadValidator: isGameState,
  });
  const restored = await restoredRepository.load({ allowCloudFallback: false });
  assert.equal(restored.ok, true);
  if (!restored.ok) return;
  const loaded = restored.envelope.payload;
  assert.equal(
    loaded.world.entities["resource.battery.weather-station"].quantity,
    0,
  );
  assert.equal(loaded.objectives.flags.batteryRecovered, true);
  assert.deepEqual(loaded.camp.structures, state.camp.structures);
  assert.deepEqual(loaded.world.riverHydrology, expectedHydrology);
  assert.deepEqual(torchWaymarkSaveProjection(loaded), expectedWaymarks);
  assert.equal(loaded.world.entities[farPartial.id], undefined);

  materializeGeneratedWorldChunk(
    loaded,
    worldToChunkCoordinate(farPartial.position.x, farPartial.position.z),
  );
  assert.equal(loaded.world.entities[farPartial.id].quantity, farPartial.quantity);
  assert.deepEqual(
    loaded.world.entities[farPartial.id].regeneration,
    farPartial.regeneration,
  );

  const cloudRestore = new SaveRepository<GameState>({
    key: repository.key,
    schema: SAVE_SCHEMA,
    content: SAVE_CONTENT,
    device: "cloud-restore-device",
    kv: new MemoryKV(),
    cloud: new ToyBridgeCloudKV(new ToyBridgeClient({ bridge: fake.bridge })),
    payloadValidator: isGameState,
  });
  const restoredFromCloud = await cloudRestore.load();
  assert.equal(restoredFromCloud.ok, true);
  if (restoredFromCloud.ok) {
    assert.equal(restoredFromCloud.source, "cloud");
    assert.deepEqual(
      restoredFromCloud.envelope.payload.world.riverHydrology,
      expectedHydrology,
    );
    assert.deepEqual(
      torchWaymarkSaveProjection(restoredFromCloud.envelope.payload),
      expectedWaymarks,
    );
  }

  const eventPressureState = structuredClone(state);
  eventPressureState.eventLog = createLowCompressionEventLog();
  eventPressureState.nextEventId = 5_256;
  const pressureLocal = new MemoryKV();
  const pressureFake = fakeToyCloud();
  const pressureRepository = new SaveRepository<GameState>({
    key: "canopy_first_night_v2",
    schema: SAVE_SCHEMA,
    content: SAVE_CONTENT,
    device: "event-pressure-device",
    kv: pressureLocal,
    cloud: new ToyBridgeCloudKV(
      new ToyBridgeClient({ bridge: pressureFake.bridge }),
    ),
    payloadValidator: isGameState,
  });
  assert.equal(
    (
      await pressureRepository.save(eventPressureState, {
        seed: eventPressureState.seed,
        simTick: 72_000,
      })
    ).ok,
    true,
  );
  assert.equal(
    (
      await pressureRepository.save(eventPressureState, {
        seed: eventPressureState.seed,
        simTick: 72_001,
      })
    ).ok,
    true,
  );
  await pressureRepository.whenCloudIdle();
  assert.equal(pressureRepository.getCloudStatus(), "synced");
  assertToyPhysicalStorage(
    pressureFake.storage,
    EVENT_PRESSURE_CLOUD_KEY_BUDGET,
  );
});
