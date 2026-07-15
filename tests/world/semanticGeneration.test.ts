import assert from "node:assert/strict";
import test from "node:test";

import {
  WORLD_CHUNK_SIZE,
  chunkRing,
  worldToChunkCoordinate,
  type ChunkCoordinate,
} from "../../src/game/world/generation";
import {
  SEMANTIC_DENSITY_BUDGET,
  generateSemanticChunkPlan,
  semanticObjectIntersectsNavigationClearance,
  type SemanticHarvestablePlantObject,
  type SemanticMineableRockObject,
  type SemanticTreeObject,
} from "../../src/game/world/semanticGeneration";

test("semantic chunk plans are byte-stable for the same seed and coordinate", () => {
  const coordinate = { x: 8, z: -13 };
  const first = generateSemanticChunkPlan("semantic-stability", coordinate);
  const second = generateSemanticChunkPlan("semantic-stability", coordinate);

  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
});

test("different seeds change semantic content without changing the consumer contract", () => {
  const coordinate = { x: -4, z: 9 };
  const first = generateSemanticChunkPlan("semantic-world-a", coordinate);
  const second = generateSemanticChunkPlan("semantic-world-b", coordinate);

  assert.notDeepEqual(first.objects, second.objects);
  assert.deepEqual(
    new Set(first.objects.map((object) => object.category)),
    new Set(second.objects.map((object) => object.category)),
  );
});

test("one authoritative plan clearly separates interactive objects from micro clutter", () => {
  const coordinate = { x: 3, z: 6 };
  const plan = generateSemanticChunkPlan("semantic-categories", coordinate);
  const categories = new Set(plan.objects.map((object) => object.category));
  assert.deepEqual(categories, new Set([
    "tree",
    "mineable-rock",
    "harvestable-plant",
    "ambient-foliage",
    "micro-clutter",
  ]));

  const ids = plan.objects.map((object) => object.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const object of plan.objects) {
    assert.equal(object.chunkKey, plan.chunkKey);
    assert.equal(object.generatorVersion, plan.generatorVersion);
    const ambient =
      object.category === "micro-clutter" ||
      object.category === "ambient-foliage";
    assert.equal(ambient, !object.interactive);
    if (ambient) {
      assert.equal(object.selectionPolicy, "never-focus");
      assert.equal(
        object.visualRole,
        object.category === "ambient-foliage" ? "depth-fill" : "ground-texture",
      );
    } else {
      assert.ok(object.toolRequirement.action);
      assert.ok(object.yieldIntent.tableId);
      assert.ok(object.yieldIntent.baseUnits[0] > 0);
      assert.ok(object.baselineQuantity >= object.yieldIntent.baseUnits[0]);
      assert.ok(object.baselineQuantity <= object.yieldIntent.baseUnits[1]);
    }
  }
});

test("trees and rocks expose morphology, material, tool tier, and yield intent", () => {
  const plans = chunkRing({ x: 0, z: 0 }, 4).map((coordinate) =>
    generateSemanticChunkPlan("semantic-morphology", coordinate),
  );
  const trees = plans.flatMap((plan) =>
    plan.objects.filter(
      (object): object is SemanticTreeObject => object.category === "tree",
    ),
  );
  const rocks = plans.flatMap((plan) =>
    plan.objects.filter(
      (object): object is SemanticMineableRockObject =>
        object.category === "mineable-rock",
    ),
  );

  assert.equal(new Set(trees.map((tree) => tree.species)).size, 3);
  assert.ok(new Set(trees.map((tree) => tree.growthStage)).size >= 3);
  assert.ok(new Set(trees.map((tree) => tree.material)).size >= 3);
  assert.ok(trees.every((tree) => tree.toolRequirement.minimumTier >= 1));
  assert.ok(trees.every((tree) => tree.yieldIntent.primaryMaterial === tree.material));

  assert.equal(new Set(rocks.map((rock) => rock.material)).size, 4);
  assert.ok(new Set(rocks.map((rock) => rock.size)).size >= 3);
  assert.ok(rocks.every((rock) => rock.toolRequirement.action === "mine"));
  assert.ok(rocks.every((rock) => rock.toolRequirement.minimumTier === 1));
  assert.ok(rocks.every((rock) => rock.yieldIntent.primaryMaterial === "stone"));
  assert.ok(rocks.every((rock) => rock.yieldIntent.secondaryMaterials.length === 0));
  assert.ok(rocks.every((rock) => rock.yieldIntent.baseUnits[1] >= rock.yieldIntent.baseUnits[0]));
});

test("objects remain inside their chunk and IDs never collide across a region", () => {
  const coordinates = chunkRing({ x: -5, z: 7 }, 6);
  const ids = new Set<string>();
  for (const coordinate of coordinates) {
    const plan = generateSemanticChunkPlan("semantic-region", coordinate);
    for (const object of plan.objects) {
      assertInsideChunk(object.transform.x, object.transform.z, coordinate);
      assert.equal(ids.has(object.id), false, `duplicate semantic ID ${object.id}`);
      ids.add(object.id);
    }
  }
  assert.ok(ids.size > 6_000);
});

test("rainforest density stays bounded while solid objects preserve river and authored route clearances", () => {
  const plans = chunkRing({ x: 0, z: 0 }, 5).map((coordinate) =>
    generateSemanticChunkPlan("rainforest-density-budget", coordinate),
  );
  let treeTotal = 0;
  let foliageTotal = 0;
  for (const plan of plans) {
    const counts = new Map<string, number>();
    for (const object of plan.objects) {
      counts.set(object.category, (counts.get(object.category) ?? 0) + 1);
      if (
        object.category === "tree" ||
        object.category === "mineable-rock" ||
        object.category === "ambient-foliage"
      ) {
        assert.equal(
          semanticObjectIntersectsNavigationClearance(object),
          false,
          `${object.id} intrudes into a guaranteed walking envelope`,
        );
      }
    }
    treeTotal += counts.get("tree") ?? 0;
    foliageTotal += counts.get("ambient-foliage") ?? 0;
    assert.ok((counts.get("tree") ?? 0) <= SEMANTIC_DENSITY_BUDGET.treesPerChunk);
    assert.ok((counts.get("mineable-rock") ?? 0) <= SEMANTIC_DENSITY_BUDGET.rocksPerChunk);
    assert.ok(
      (counts.get("harvestable-plant") ?? 0) <=
        SEMANTIC_DENSITY_BUDGET.harvestablePlantsPerChunk,
    );
    assert.ok(
      (counts.get("ambient-foliage") ?? 0) <=
        SEMANTIC_DENSITY_BUDGET.ambientFoliagePerChunk,
    );
    assert.ok(plan.objects.length <= SEMANTIC_DENSITY_BUDGET.totalObjectsPerChunk);
  }
  assert.ok(treeTotal / plans.length >= 12);
  assert.ok(foliageTotal / plans.length >= 28);
});

test("the authored C-17 interaction clearing cannot be buried by deterministic solid clutter", () => {
  const center = { x: 118, z: 92 };
  const coordinate = worldToChunkCoordinate(center.x, center.z);
  for (const seed of ["c17-clear-a", "c17-clear-b", "c17-clear-c"]) {
    const plan = generateSemanticChunkPlan(seed, coordinate);
    const intruders = plan.objects.filter((object) => {
      if (
        object.category !== "tree" &&
        object.category !== "mineable-rock" &&
        object.category !== "ambient-foliage"
      ) {
        return false;
      }
      return Math.hypot(
        object.transform.x - center.x,
        object.transform.z - center.z,
      ) < 7;
    });
    assert.deepEqual(
      intruders.map((object) => object.id),
      [],
      `seed ${seed} buried C-17 under solid semantic clutter`,
    );
  }
});

test("wild plantain is a deterministic readable food node without rerolling into ambient foliage", () => {
  const plants = chunkRing({ x: 0, z: 0 }, 5).flatMap((coordinate) =>
    generateSemanticChunkPlan("wild-plantain-loop", coordinate).objects.filter(
      (object): object is SemanticHarvestablePlantObject =>
        object.category === "harvestable-plant" &&
        object.species === "wild-plantain",
    ),
  );
  assert.ok(plants.length >= 40);
  for (const plant of plants) {
    assert.equal(plant.interactive, true);
    assert.equal(plant.toolRequirement.action, "pickup");
    assert.equal(plant.toolRequirement.toolClass, "hand");
    assert.equal(plant.yieldIntent.primaryMaterial, "palm-fruit");
    assert.match(plant.yieldIntent.tableId, /wild-plantain/);
    assert.ok(plant.id.includes("harvestable-plant"));
  }
});

test("invalid fractional chunk coordinates fail before creating unstable IDs", () => {
  assert.throws(
    () => generateSemanticChunkPlan("semantic-invalid", { x: 1.5, z: 2 }),
    /safe integers/,
  );
});

function assertInsideChunk(x: number, z: number, coordinate: ChunkCoordinate): void {
  const minimumX = coordinate.x * WORLD_CHUNK_SIZE;
  const minimumZ = coordinate.z * WORLD_CHUNK_SIZE;
  assert.ok(x >= minimumX && x < minimumX + WORLD_CHUNK_SIZE);
  assert.ok(z >= minimumZ && z < minimumZ + WORLD_CHUNK_SIZE);
}
