import * as THREE from "three";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  WORLD_CHUNK_SIZE,
  chunkRing,
  generateChunkDescriptor,
  generateChunkVisualPlan,
  type ChunkCoordinate,
  type WorldVisualDetail,
} from "../src/game/world/generation";
import { generateSemanticChunkPlan } from "../src/game/world/semanticGeneration";

export type VisualWorldAuditOptions = Readonly<{
  seed: string;
  gridRadius: number;
  activeRadius: number;
  detail: WorldVisualDetail;
}>;

export type VisualStaticCategory =
  | "tree"
  | "mineable-rock"
  | "harvestable-plant"
  | "ambient-foliage"
  | "micro-clutter";

export type VisualStaticInventoryArchitecture = Readonly<{
  version: string;
  categories: Readonly<
    Record<
      VisualStaticCategory,
      Readonly<{
        draws: number;
        scope: "per-nonempty-chunk" | "per-active-ring";
      }>
    >
  >;
}>;

/**
 * The single estimator switch for the currently shipped semantic mesh layout.
 * V1A moved trees and rocks into active-ring pools; plants and clutter still
 * use per-chunk meshes. Any later pool migration must advance this version and
 * its pinned tests only after the matching runtime architecture lands.
 */
export const CURRENT_STATIC_INVENTORY_ARCHITECTURE: VisualStaticInventoryArchitecture = {
  version: "semantic-post-v1a-rainforest-depth-fill-v2",
  categories: {
    tree: { draws: 5, scope: "per-active-ring" },
    "mineable-rock": { draws: 3, scope: "per-active-ring" },
    "harvestable-plant": { draws: 2, scope: "per-nonempty-chunk" },
    "ambient-foliage": { draws: 1, scope: "per-nonempty-chunk" },
    "micro-clutter": { draws: 1, scope: "per-nonempty-chunk" },
  },
};

export function estimateSemanticDrawInventory(
  architecture: VisualStaticInventoryArchitecture,
  chunksWithRenderedCategory: Readonly<Record<VisualStaticCategory, number>>,
) {
  const byCategory = Object.fromEntries(
    (Object.keys(architecture.categories) as VisualStaticCategory[]).map(
      (category) => {
        const model = architecture.categories[category];
        const populatedChunks = chunksWithRenderedCategory[category];
        const draws =
          model.scope === "per-active-ring"
            ? populatedChunks > 0
              ? model.draws
              : 0
            : populatedChunks * model.draws;
        return [category, draws];
      },
    ),
  ) as Record<VisualStaticCategory, number>;
  return {
    byCategory,
    total: Object.values(byCategory).reduce((sum, draws) => sum + draws, 0),
  };
}

export const DEFAULT_VISUAL_WORLD_AUDIT_OPTIONS: VisualWorldAuditOptions = {
  seed: "1",
  gridRadius: 20,
  activeRadius: 2,
  detail: "standard",
};

export function parseVisualWorldAuditOptions(
  args: readonly string[],
): VisualWorldAuditOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    const value = args[index + 1];
    if (!name?.startsWith("--") || value === undefined) continue;
    values.set(name.slice(2), value);
    index += 1;
  }
  const integer = (name: string, fallback: number) => {
    const parsed = Number(values.get(name) ?? fallback);
    if (!Number.isSafeInteger(parsed) || parsed < 0) {
      throw new RangeError(`--${name} must be a non-negative safe integer`);
    }
    return parsed;
  };
  const detail = values.get("detail") ?? DEFAULT_VISUAL_WORLD_AUDIT_OPTIONS.detail;
  if (detail !== "low" && detail !== "standard") {
    throw new RangeError("--detail must be low or standard");
  }
  return {
    seed: values.get("seed") ?? DEFAULT_VISUAL_WORLD_AUDIT_OPTIONS.seed,
    gridRadius: integer(
      "grid-radius",
      DEFAULT_VISUAL_WORLD_AUDIT_OPTIONS.gridRadius,
    ),
    activeRadius: integer(
      "active-radius",
      DEFAULT_VISUAL_WORLD_AUDIT_OPTIONS.activeRadius,
    ),
    detail,
  };
}

function key(coordinate: ChunkCoordinate): string {
  return `${coordinate.x}:${coordinate.z}`;
}

function triangleCount(geometry: THREE.BufferGeometry): number {
  return geometry.index
    ? geometry.index.count / 3
    : geometry.getAttribute("position").count / 3;
}

function riverCenter(x: number): number {
  return -17 + Math.sin(x * 0.09) * 3;
}

function riverSegmentCount(coordinate: ChunkCoordinate): number {
  const minX = coordinate.x * WORLD_CHUNK_SIZE;
  const maxX = minX + WORLD_CHUNK_SIZE;
  const minZ = coordinate.z * WORLD_CHUNK_SIZE;
  const maxZ = minZ + WORLD_CHUNK_SIZE;
  let count = 0;
  for (let x = minX + 1.5; x < maxX; x += 3) {
    const z = riverCenter(x);
    if (z >= minZ - 2.4 && z <= maxZ + 2.4) count += 1;
  }
  return count;
}

function increment(record: Record<string, number>, name: string, amount = 1): void {
  record[name] = (record[name] ?? 0) + amount;
}

function continuityReport(options: VisualWorldAuditOptions) {
  const descriptors = new Map<
    string,
    ReturnType<typeof generateChunkDescriptor>
  >();
  const biomeCounts: Record<string, number> = {};
  for (let z = -options.gridRadius; z <= options.gridRadius; z += 1) {
    for (let x = -options.gridRadius; x <= options.gridRadius; x += 1) {
      const descriptor = generateChunkDescriptor(options.seed, { x, z });
      descriptors.set(key({ x, z }), descriptor);
      increment(biomeCounts, descriptor.biome);
    }
  }

  let edgeCount = 0;
  let sameBiomeEdges = 0;
  let elevationDeltaSum = 0;
  let elevationDeltaMax = 0;
  let interiorCount = 0;
  let oneCellIslands = 0;
  const compare = (
    current: ReturnType<typeof generateChunkDescriptor>,
    neighbor: ReturnType<typeof generateChunkDescriptor>,
  ) => {
    edgeCount += 1;
    if (current.biome === neighbor.biome) sameBiomeEdges += 1;
    const delta = Math.abs(current.elevation - neighbor.elevation);
    elevationDeltaSum += delta;
    elevationDeltaMax = Math.max(elevationDeltaMax, delta);
  };

  for (let z = -options.gridRadius; z <= options.gridRadius; z += 1) {
    for (let x = -options.gridRadius; x <= options.gridRadius; x += 1) {
      const current = descriptors.get(key({ x, z }))!;
      const right = descriptors.get(key({ x: x + 1, z }));
      const down = descriptors.get(key({ x, z: z + 1 }));
      if (right) compare(current, right);
      if (down) compare(current, down);
      const neighbors = [
        descriptors.get(key({ x: x - 1, z })),
        descriptors.get(key({ x: x + 1, z })),
        descriptors.get(key({ x, z: z - 1 })),
        descriptors.get(key({ x, z: z + 1 })),
      ];
      if (neighbors.every(Boolean)) {
        interiorCount += 1;
        if (neighbors.every((neighbor) => neighbor!.biome !== current.biome)) {
          oneCellIslands += 1;
        }
      }
    }
  }

  return {
    sampleWidth: options.gridRadius * 2 + 1,
    chunkCount: descriptors.size,
    biomeCounts,
    orthogonalEdgeCount: edgeCount,
    sameBiomeEdgeRatio:
      edgeCount > 0 ? Number((sameBiomeEdges / edgeCount).toFixed(6)) : null,
    meanElevationEdgeDelta:
      edgeCount > 0 ? Number((elevationDeltaSum / edgeCount).toFixed(6)) : null,
    maxElevationEdgeDelta: Number(elevationDeltaMax.toFixed(6)),
    oneCellIslandRatio:
      interiorCount > 0
        ? Number((oneCellIslands / interiorCount).toFixed(6))
        : null,
    definition:
      "A one-cell island is an interior chunk whose four orthogonal neighbors all have a different biome.",
  };
}

function activeRingReport(options: VisualWorldAuditOptions) {
  const coordinates = chunkRing({ x: 0, z: 0 }, options.activeRadius);
  const categoryCounts: Record<string, number> = {};
  const renderedCategoryCounts: Record<string, number> = {};
  const chunksWithRenderedCategory: Record<VisualStaticCategory, number> = {
    tree: 0,
    "mineable-rock": 0,
    "harvestable-plant": 0,
    "ambient-foliage": 0,
    "micro-clutter": 0,
  };
  const biomeCounts: Record<string, number> = {};
  const variantsByCategory = new Map<string, Set<string>>();
  let semanticTriangleInventory = 0;
  let groundTriangles = 0;
  let puddleTriangles = 0;
  let riverTriangles = 0;
  let puddleDrawInventory = 0;
  let riverDrawInventory = 0;

  const geometries = {
    trunk: new THREE.CylinderGeometry(1, 1.18, 1, 7),
    crown: new THREE.IcosahedronGeometry(1, 1),
    rock: new THREE.DodecahedronGeometry(1, 0),
    rockAccent: new THREE.BoxGeometry(1, 1, 1),
    plant: new THREE.ConeGeometry(0.52, 1, 6),
    clutter: new THREE.DodecahedronGeometry(1, 0),
    puddle: new THREE.CircleGeometry(1, 18),
    river: new THREE.PlaneGeometry(3.25, 4.5),
  };
  const terrainSegments = options.detail === "low" ? 8 : 12;

  for (const coordinate of coordinates) {
    const plan = generateSemanticChunkPlan(options.seed, coordinate);
    const visual = generateChunkVisualPlan(options.seed, coordinate, options.detail);
    increment(biomeCounts, plan.terrain.biome);
    const categoriesPresent = new Set<VisualStaticCategory>();
    plan.objects.forEach((object, objectIndex) => {
      increment(categoryCounts, object.category);
      const variants = variantsByCategory.get(object.category) ?? new Set<string>();
      variants.add(object.visualVariant);
      variantsByCategory.set(object.category, variants);
      const rendered =
        (object.category !== "micro-clutter" &&
          object.category !== "ambient-foliage") ||
        options.detail === "standard" ||
        objectIndex % 2 === 0;
      if (!rendered) return;
      increment(renderedCategoryCounts, object.category);
      categoriesPresent.add(object.category);
      if (object.category === "tree") {
        semanticTriangleInventory +=
          triangleCount(geometries.trunk) * 4 + triangleCount(geometries.crown);
      } else if (object.category === "mineable-rock") {
        semanticTriangleInventory +=
          triangleCount(geometries.rock) * 4 +
          triangleCount(geometries.rockAccent) * 2;
      } else if (object.category === "harvestable-plant") {
        semanticTriangleInventory +=
          object.species === "wild-plantain"
            ? 34
            : triangleCount(geometries.plant);
      } else if (object.category === "ambient-foliage") {
        semanticTriangleInventory += 10;
      } else {
        semanticTriangleInventory += triangleCount(geometries.clutter) * 5;
      }
    });
    for (const category of categoriesPresent) {
      chunksWithRenderedCategory[category] += 1;
    }

    groundTriangles += terrainSegments * terrainSegments * 2;
    if (visual.wetPatches.length > 0) {
      puddleDrawInventory += 1;
      puddleTriangles +=
        triangleCount(geometries.puddle) * visual.wetPatches.length;
    }
    const riverSegments = riverSegmentCount(coordinate);
    if (riverSegments > 0) {
      riverDrawInventory += 1;
      riverTriangles += triangleCount(geometries.river) * riverSegments;
    }
  }

  Object.values(geometries).forEach((geometry) => geometry.dispose());
  const semanticDrawInventory = estimateSemanticDrawInventory(
    CURRENT_STATIC_INVENTORY_ARCHITECTURE,
    chunksWithRenderedCategory,
  );
  const semanticMainDrawInventory = semanticDrawInventory.total;
  const shadowSemanticDrawInventory =
    options.detail === "standard" ? semanticMainDrawInventory : 0;
  const shadowSemanticTriangleInventory =
    options.detail === "standard" ? semanticTriangleInventory : 0;
  const knownMainDrawInventory =
    semanticMainDrawInventory +
    coordinates.length +
    puddleDrawInventory +
    riverDrawInventory;

  return {
    centerChunk: { x: 0, z: 0 },
    chunkCount: coordinates.length,
    biomeCounts,
    semanticObjectCount: Object.values(categoryCounts).reduce(
      (sum, value) => sum + value,
      0,
    ),
    categoryCounts,
    renderedCategoryCounts,
    distinctVisualVariants: Object.fromEntries(
      [...variantsByCategory].map(([category, variants]) => [
        category,
        variants.size,
      ]),
    ),
    staticInventoryEstimate: {
      architectureVersion: CURRENT_STATIC_INVENTORY_ARCHITECTURE.version,
      semanticDrawScopeByCategory: Object.fromEntries(
        (Object.keys(
          CURRENT_STATIC_INVENTORY_ARCHITECTURE.categories,
        ) as VisualStaticCategory[]).map((category) => [
          category,
          CURRENT_STATIC_INVENTORY_ARCHITECTURE.categories[category].scope,
        ]),
      ),
      chunksWithRenderedCategory,
      semanticDrawInventoryByCategory: semanticDrawInventory.byCategory,
      knownMainDrawInventory,
      semanticMainDrawInventory,
      groundDrawInventory: coordinates.length,
      puddleDrawInventory,
      riverDrawInventory,
      possibleShadowSemanticDrawInventory: shadowSemanticDrawInventory,
      knownMainTriangleInventory:
        semanticTriangleInventory + groundTriangles + puddleTriangles + riverTriangles,
      semanticTriangleInventory,
      possibleShadowSemanticTriangleInventory: shadowSemanticTriangleInventory,
      caveat:
        "This is a source-model inventory, not WebGL profiling. It assumes every active-ring mesh/instance is submitted, includes tiny reserve lifecycle instances, and excludes frustum/shadow culling, landmarks, wildlife, buildings, held items, particles, UI, and post-processing.",
    },
  };
}

export function createVisualWorldAudit(options: VisualWorldAuditOptions) {
  return {
    schemaVersion: 1,
    inputs: options,
    classification: {
      descriptorMetrics: "deterministic code fact for the selected seed/grid",
      activeRingCounts: "deterministic code fact for the selected seed/ring",
      staticInventoryEstimate:
        "engineering estimate from the current mesh layout; never a substitute for renderer.info or a browser trace",
    },
    descriptorContinuity: continuityReport(options),
    activeRing: activeRingReport(options),
  };
}

function isDirectExecution(metaUrl: string): boolean {
  const entry = process.argv[1];
  return entry !== undefined && pathToFileURL(resolve(entry)).href === metaUrl;
}

if (isDirectExecution(import.meta.url)) {
  const options = parseVisualWorldAuditOptions(process.argv.slice(2));
  console.log(JSON.stringify(createVisualWorldAudit(options), null, 2));
}
