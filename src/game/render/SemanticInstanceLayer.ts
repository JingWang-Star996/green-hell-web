import * as THREE from "three";

import type { SemanticRenderState } from "./types";
import type { WorldCollider } from "../world/interactionGeometry";
import { pebbleClusterTransforms } from "./rockVisualSemantics";
import { resolvePlantVisualSemantics } from "./plantVisualSemantics";
import {
  RESOURCE_PLANT_GEOMETRY_SPECIES,
  createPlantGeometryCatalogEntry,
  type PlantGeometryCatalogEntry,
  type ResourcePlantGeometrySpecies,
} from "./plantGeometryCatalog";
import { cloneTreeRegrowthState } from "../sim/treeRegrowthRuntime";
import { SemanticRockPool } from "./SemanticRockPool";
import { SemanticTreePool } from "./SemanticTreePool";
import type {
  ChunkCoordinate,
  WorldVisualDetail,
} from "../world/generation";
import { chunkKey } from "../world/generation";
import {
  generateSemanticChunkPlan,
  MAX_SEMANTIC_ROCKS_PER_CHUNK,
  MAX_SEMANTIC_TREES_PER_CHUNK,
} from "../world/semanticGeneration";
import {
  buildSemanticChunkRenderPlan,
  type SemanticChunkRenderPlan,
  type SemanticLifecycle,
  type SemanticRenderObject,
  type SemanticRuntimeRenderState,
} from "../world/semanticRenderPlan";

type InstanceBinding = {
  mesh: THREE.InstancedMesh;
  index: number;
  baseColor: THREE.Color;
};

type InternalRecord = SemanticInstanceRecord & {
  bindings: InstanceBinding[];
  impactUntil: number;
};

type SemanticChunkView = {
  group: THREE.Group;
  signature: string;
  ids: string[];
  colliders: Array<{ id: string; collider: WorldCollider }>;
};

type StagedSemanticChunk = {
  key: string;
  plan: SemanticChunkRenderPlan;
  signature: string;
};

export type SemanticInstanceRecord = {
  id: string;
  chunkKey: string;
  batchKey: string;
  instanceIndex: number;
  lifecycle: SemanticLifecycle;
  interactive: boolean;
  focusPolicy: "capability" | "never-focus";
  anchor: Readonly<{ x: number; z: number; height: number }>;
  collider?: WorldCollider;
};

export type SemanticInstanceLayerOptions = {
  detail: WorldVisualDetail;
  shadows: boolean;
  terrainHeight: (x: number, z: number) => number;
  /** Renderer activity-bubble bound; defaults to 5x5 standard / 3x3 low. */
  maxActiveChunks?: number;
};

export type SemanticInstanceDiagnostics = {
  chunks: number;
  instances: number;
  interactiveInstances: number;
  colliders: number;
  /** Cumulative deterministic counter since construction. */
  staticChunkRebuilds: number;
  /** Non-deterministic timing telemetry; excluded from structural equality. */
  lastSyncMs: number;
  maxSyncMs: number;
  /** Successfully committed unique chunk plans from the most recent sync. */
  lastSyncPlannedChunks: number;
  /** Actual generator invocations committed by the most recent sync. */
  lastSyncPlanGenerations: number;
  treePool: ReturnType<SemanticTreePool["getDiagnostics"]>;
  rockPool: ReturnType<SemanticRockPool["getDiagnostics"]>;
};

/**
 * One visual registry for every deterministic semantic object. It batches the
 * shared plan by object family while retaining stable id -> instance bindings
 * for focus, collision and hit feedback.
 */
export class SemanticInstanceLayer {
  readonly root = new THREE.Group();

  private readonly chunks = new Map<string, SemanticChunkView>();
  private readonly records = new Map<string, InternalRecord>();
  private readonly terrainHeight: SemanticInstanceLayerOptions["terrainHeight"];
  private readonly detail: WorldVisualDetail;
  private readonly shadows: boolean;
  private readonly treePool: SemanticTreePool;
  private readonly rockPool: SemanticRockPool;
  private worldSeed = "";
  private focusedId: string | null = null;
  private focusTone = new THREE.Color(0x9fbe68);
  private staticChunkRebuilds = 0;
  private lastSyncMs = 0;
  private maxSyncMs = 0;
  private lastSyncPlannedChunks = 0;
  private lastSyncPlanGenerations = 0;

  private readonly geometries = {
    plantain: createPlantainGeometry(),
    ambientFoliage: createAmbientFoliageGeometry(),
    clutter: new THREE.DodecahedronGeometry(1, 0),
  };

  private readonly resourcePlantGeometries = new Map<
    ResourcePlantGeometrySpecies,
    PlantGeometryCatalogEntry
  >(
    RESOURCE_PLANT_GEOMETRY_SPECIES.map((species) => {
      const entry = createPlantGeometryCatalogEntry(species);
      if (!entry) {
        throw new Error(`missing resource plant geometry: ${species}`);
      }
      return [species, entry] as const;
    }),
  );

  private readonly materials = {
    plant: new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 1,
      side: THREE.DoubleSide,
    }),
    plantain: new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.94,
      side: THREE.DoubleSide,
      vertexColors: true,
    }),
    ambientFoliage: new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 1,
      side: THREE.DoubleSide,
      vertexColors: true,
    }),
    clutter: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }),
  };

  constructor(options: SemanticInstanceLayerOptions) {
    this.root.name = "semantic-instance-layer";
    this.terrainHeight = options.terrainHeight;
    this.detail = options.detail;
    this.shadows = options.shadows;
    const maxActiveChunks =
      options.maxActiveChunks ?? (options.detail === "low" ? 9 : 25);
    this.treePool = new SemanticTreePool({
      capacity: maxActiveChunks * MAX_SEMANTIC_TREES_PER_CHUNK,
      shadows: options.shadows,
      terrainHeight: options.terrainHeight,
    });
    this.rockPool = new SemanticRockPool({
      capacity: maxActiveChunks * MAX_SEMANTIC_ROCKS_PER_CHUNK,
      shadows: options.shadows,
      terrainHeight: options.terrainHeight,
    });
    this.root.add(this.treePool.root, this.rockPool.root);
  }

  sync(
    worldSeed: string,
    coordinates: readonly ChunkCoordinate[],
    runtimeStates: readonly SemanticRenderState[],
  ): void {
    const syncStartedAt = performance.now();
    // Phase 1 is read-only staging. Duplicate stream coordinates are planned
    // exactly once, and every fallible generator/capacity check completes
    // before the committed render snapshot can be changed.
    const uniqueCoordinates = new Map<string, ChunkCoordinate>();
    for (const coordinate of coordinates) {
      const key = chunkKey(coordinate);
      if (!uniqueCoordinates.has(key)) uniqueCoordinates.set(key, coordinate);
    }
    const statesByChunk = new Map<string, SemanticRenderState[]>();
    for (const state of runtimeStates) {
      const states = statesByChunk.get(state.chunkKey) ?? [];
      states.push(state);
      statesByChunk.set(state.chunkKey, states);
    }
    const stagedChunks: StagedSemanticChunk[] = [];
    const treesById = new Map<string, SemanticRenderObject>();
    const rocksById = new Map<string, SemanticRenderObject>();
    let stagedPlanGenerations = 0;
    for (const [key, coordinate] of uniqueCoordinates) {
      const states = statesByChunk.get(key) ?? [];
      const runtime = runtimeById(states);
      const source = generateSemanticChunkPlan(worldSeed, coordinate);
      stagedPlanGenerations += 1;
      const plan = buildSemanticChunkRenderPlan(source, runtime);
      const trees = plan.objects.filter(
        (object) => object.category === "tree",
      );
      const rocks = plan.objects.filter(
        (object) => object.category === "mineable-rock",
      );
      const treeIds = new Set(trees.map((object) => object.id));
      const rockIds = new Set(rocks.map((object) => object.id));
      for (const tree of trees) treesById.set(tree.id, tree);
      for (const rock of rocks) rocksById.set(rock.id, rock);
      // Tree and rock lifecycles are updated in global pools. Neither may
      // dispose or rebuild the remaining per-chunk plant/clutter resources.
      const signature = stateSignature(
        states.filter(
          (state) => !treeIds.has(state.id) && !rockIds.has(state.id),
        ),
      );
      stagedChunks.push({ key, plan, signature });
    }
    this.treePool.assertCapacityForUniqueCount(treesById.size);
    this.rockPool.assertCapacityForUniqueCount(rocksById.size);

    // Phase 2 commits only after every staged plan is known to fit.
    if (worldSeed !== this.worldSeed) {
      this.clear();
      this.worldSeed = worldSeed;
    }
    const required = new Set(stagedChunks.map((chunk) => chunk.key));
    for (const key of [...this.chunks.keys()]) {
      if (!required.has(key)) this.removeChunk(key);
    }
    for (const chunk of stagedChunks) {
      if (this.chunks.get(chunk.key)?.signature === chunk.signature) continue;
      this.removeChunk(chunk.key);
      this.createChunk(chunk.plan, chunk.signature);
      this.staticChunkRebuilds += 1;
    }
    this.treePool.sync([...treesById.values()]);
    this.rockPool.sync([...rocksById.values()]);
    this.lastSyncMs = performance.now() - syncStartedAt;
    this.maxSyncMs = Math.max(this.maxSyncMs, this.lastSyncMs);
    this.lastSyncPlannedChunks = stagedChunks.length;
    this.lastSyncPlanGenerations = stagedPlanGenerations;
  }

  getRecord(id: string): SemanticInstanceRecord | undefined {
    const record = this.records.get(id);
    if (!record) {
      return this.treePool.getRecord(id) ?? this.rockPool.getRecord(id);
    }
    return {
      id: record.id,
      chunkKey: record.chunkKey,
      batchKey: record.batchKey,
      instanceIndex: record.instanceIndex,
      lifecycle: record.lifecycle,
      interactive: record.interactive,
      focusPolicy: record.focusPolicy,
      anchor: { ...record.anchor },
      ...(record.collider ? { collider: { ...record.collider } } : {}),
    };
  }

  getDiagnostics(): SemanticInstanceDiagnostics {
    const treePool = this.treePool.getDiagnostics();
    const rockPool = this.rockPool.getDiagnostics();
    let colliders = treePool.colliders + rockPool.colliders;
    for (const chunk of this.chunks.values()) colliders += chunk.colliders.length;
    let interactiveInstances = 0;
    for (const record of this.records.values()) {
      if (record.interactive) interactiveInstances += 1;
    }
    return {
      chunks: this.chunks.size,
      instances: this.records.size + treePool.occupied + rockPool.occupied,
      interactiveInstances:
        interactiveInstances + treePool.interactive + rockPool.interactive,
      colliders,
      staticChunkRebuilds: this.staticChunkRebuilds,
      lastSyncMs: this.lastSyncMs,
      maxSyncMs: this.maxSyncMs,
      lastSyncPlannedChunks: this.lastSyncPlannedChunks,
      lastSyncPlanGenerations: this.lastSyncPlanGenerations,
      treePool,
      rockPool,
    };
  }

  getColliders(excludingId?: string): WorldCollider[] {
    const result: WorldCollider[] = [
      ...this.treePool.getColliders(excludingId),
      ...this.rockPool.getColliders(excludingId),
    ];
    for (const chunk of this.chunks.values()) {
      for (const entry of chunk.colliders) {
        if (entry.id !== excludingId) result.push({ ...entry.collider });
      }
    }
    return result;
  }

  setFocus(id: string | null, tone = this.focusTone): void {
    const previous = this.focusedId;
    this.focusedId = id;
    this.focusTone = tone.clone();
    this.treePool.setFocus(id, tone);
    this.rockPool.setFocus(id, tone);
    if (previous) this.refreshRecordColor(previous);
    if (id && id !== previous) this.refreshRecordColor(id);
    else if (id) this.refreshRecordColor(id);
  }

  playImpact(id: string): void {
    const record = this.records.get(id);
    if (!record) {
      if (!this.treePool.playImpact(id)) this.rockPool.playImpact(id);
      return;
    }
    record.impactUntil = performance.now() + 150;
    this.refreshRecordColor(id);
    globalThis.setTimeout(() => {
      const current = this.records.get(id);
      if (current !== record) return;
      current.impactUntil = 0;
      this.refreshRecordColor(id);
    }, 170);
  }

  clear(): void {
    for (const key of [...this.chunks.keys()]) this.removeChunk(key);
    this.records.clear();
    this.treePool.clear();
    this.rockPool.clear();
    this.focusedId = null;
  }

  dispose(): void {
    this.clear();
    this.root.remove(this.treePool.root, this.rockPool.root);
    this.treePool.dispose();
    this.rockPool.dispose();
    Object.values(this.geometries).forEach((geometry) => geometry.dispose());
    this.resourcePlantGeometries.forEach((entry) => entry.geometry.dispose());
    Object.values(this.materials).forEach((material) => material.dispose());
  }

  private createChunk(
    plan: SemanticChunkRenderPlan,
    signature: string,
  ): void {
    const key = plan.chunkKey;
    const group = new THREE.Group();
    group.name = `semantic-chunk-${key}`;
    const ids: string[] = [];
    const colliders: SemanticChunkView["colliders"] = [];

    this.createPlantBatch(
      plan.objects.filter(
        (object) => object.category === "harvestable-plant",
      ),
      group,
      ids,
    );
    const ambientFoliage = plan.objects.filter(
      (object, index) =>
        object.category === "ambient-foliage" &&
        (this.detail === "standard" || index % 2 === 0),
    );
    this.createAmbientFoliageBatch(ambientFoliage, group, ids);
    const clutter = plan.objects.filter(
      (object, index) =>
        object.category === "micro-clutter" &&
        (this.detail === "standard" || index % 2 === 0),
    );
    this.createClutterBatch(clutter, group, ids);

    this.root.add(group);
    this.chunks.set(key, { group, signature, ids, colliders });
  }

  private createPlantBatch(
    objects: readonly SemanticRenderObject[],
    group: THREE.Group,
    ids: string[],
  ): void {
    const plantains: SemanticRenderObject[] = [];
    const bySpecies = new Map<
      ResourcePlantGeometrySpecies,
      SemanticRenderObject[]
    >();
    for (const object of objects) {
      const semantics = resolvePlantVisualSemantics(object);
      if (!semantics) continue;
      if (semantics.species === "wild-plantain") {
        plantains.push(object);
        continue;
      }
      const species = semantics.species as ResourcePlantGeometrySpecies;
      if (!this.resourcePlantGeometries.has(species)) continue;
      const batch = bySpecies.get(species) ?? [];
      batch.push(object);
      bySpecies.set(species, batch);
    }
    for (const species of RESOURCE_PLANT_GEOMETRY_SPECIES) {
      this.createResourcePlantBatch(
        species,
        bySpecies.get(species) ?? [],
        group,
        ids,
      );
    }
    this.createPlantainBatch(plantains, group, ids);
  }

  private createResourcePlantBatch(
    species: ResourcePlantGeometrySpecies,
    objects: readonly SemanticRenderObject[],
    group: THREE.Group,
    ids: string[],
  ): void {
    if (objects.length === 0) return;
    const entry = this.resourcePlantGeometries.get(species);
    if (!entry) return;
    const plants = this.createMesh(
      entry.geometry,
      this.materials.plant,
      objects.length,
      `semantic-resource-plant-${species}`,
    );
    plants.userData.resourcePlantSpecies = species;
    plants.userData.geometryFamily = entry.family;
    plants.userData.anchorHeight = entry.anchorHeight;
    plants.userData.footprint = entry.footprint;
    const dummy = new THREE.Object3D();
    objects.forEach((object, index) => {
      const baseline = Math.max(1, object.baselineQuantity ?? 1);
      const lifecycleScale = plantLifecycleScale(object, baseline);
      const semantics = resolvePlantVisualSemantics(object);
      const growthScale = semantics?.readabilityCue.growthScale ?? 1;
      const scale = object.transform.scale * lifecycleScale * growthScale;
      const baseY = this.terrainHeight(object.transform.x, object.transform.z);
      dummy.position.set(object.transform.x, baseY, object.transform.z);
      dummy.rotation.set(0, object.transform.yaw, 0);
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      plants.setMatrixAt(index, dummy.matrix);
      const color = lifecycleColor(
        plantColor(object.morphology.species),
        object.lifecycle,
        object.quantity,
        object.baselineQuantity,
      );
      plants.setColorAt(index, color);
      this.register(
        object,
        index,
        [{ mesh: plants, index, baseColor: color }],
        undefined,
        Math.max(0.18, entry.anchorHeight * scale),
        ids,
      );
    });
    finishMesh(plants);
    group.add(plants);
  }

  private createPlantainBatch(
    objects: readonly SemanticRenderObject[],
    group: THREE.Group,
    ids: string[],
  ): void {
    if (objects.length === 0) return;
    const plantains = this.createMesh(
      this.geometries.plantain,
      this.materials.plantain,
      objects.length,
      "semantic-wild-plantains",
    );
    const dummy = new THREE.Object3D();
    objects.forEach((object, index) => {
      const baseline = Math.max(1, object.baselineQuantity ?? 1);
      const lifecycleScale = plantLifecycleScale(object, baseline);
      const semantics = resolvePlantVisualSemantics(object);
      const growthScale = semantics?.readabilityCue.growthScale ?? 1;
      const scale = object.transform.scale * lifecycleScale * growthScale;
      const baseY = this.terrainHeight(object.transform.x, object.transform.z);
      dummy.position.set(object.transform.x, baseY, object.transform.z);
      dummy.rotation.set(0, object.transform.yaw, 0);
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      plantains.setMatrixAt(index, dummy.matrix);
      const color = lifecycleColor(
        plantColor(object.morphology.species),
        object.lifecycle,
        object.quantity,
        object.baselineQuantity,
      );
      plantains.setColorAt(index, color);
      this.register(
        object,
        index,
        [{ mesh: plantains, index, baseColor: color }],
        undefined,
        Math.max(0.18, 1.18 * scale),
        ids,
      );
    });
    finishMesh(plantains);
    group.add(plantains);
  }

  private createAmbientFoliageBatch(
    objects: readonly SemanticRenderObject[],
    group: THREE.Group,
    ids: string[],
  ): void {
    if (objects.length === 0) return;
    const foliage = this.createMesh(
      this.geometries.ambientFoliage,
      this.materials.ambientFoliage,
      objects.length,
      "semantic-ambient-foliage",
    );
    foliage.userData.sharedSemanticResource = false;
    foliage.userData.selectionPolicy = "never-focus";
    const dummy = new THREE.Object3D();
    objects.forEach((object, index) => {
      const variant = object.morphology.visualVariant;
      const kindScale = variant.startsWith("midstory")
        ? 1.32
        : variant.startsWith("fern")
          ? 0.72
          : 1;
      const scale = object.transform.scale * kindScale;
      const baseY = this.terrainHeight(object.transform.x, object.transform.z);
      dummy.position.set(object.transform.x, baseY + 0.03, object.transform.z);
      dummy.rotation.set(0, object.transform.yaw, 0);
      dummy.scale.set(scale, scale, scale);
      dummy.updateMatrix();
      foliage.setMatrixAt(index, dummy.matrix);
      const color = ambientFoliageColor(variant);
      foliage.setColorAt(index, color);
      this.register(
        object,
        index,
        [{ mesh: foliage, index, baseColor: color }],
        undefined,
        0.72 * scale,
        ids,
      );
    });
    finishMesh(foliage);
    group.add(foliage);
  }

  private createClutterBatch(
    objects: readonly SemanticRenderObject[],
    group: THREE.Group,
    ids: string[],
  ): void {
    if (objects.length === 0) return;
    const clutter = this.createMesh(
      this.geometries.clutter,
      this.materials.clutter,
      objects.length * 5,
      "semantic-micro-clutter",
    );
    const dummy = new THREE.Object3D();
    objects.forEach((object, index) => {
      const baseY = this.terrainHeight(object.transform.x, object.transform.z);
      const color = new THREE.Color(
        object.morphology.visualVariant.startsWith("pebble")
          ? 0x687064
          : object.morphology.visualVariant.startsWith("leaf")
            ? 0x5b5132
            : 0x43683b,
      );
      const bindings: InstanceBinding[] = [];
      const isPebble = object.morphology.visualVariant.startsWith("pebble");
      const pieces = isPebble
        ? pebbleClusterTransforms(object.transform.yaw)
        : Array.from({ length: 5 }, (_, pieceIndex) =>
            pieceIndex === 0
              ? {
                  x: 0,
                  y: 0.05,
                  z: 0,
                  yaw: object.transform.yaw,
                  scaleX: 0.13,
                  scaleY: 0.03,
                  scaleZ: 0.14,
                }
              : {
                  x: 0,
                  y: 0,
                  z: 0,
                  yaw: 0,
                  scaleX: 0.001,
                  scaleY: 0.001,
                  scaleZ: 0.001,
                },
          );
      for (const [pieceIndex, piece] of pieces.entries()) {
        const instanceIndex = index * 5 + pieceIndex;
        dummy.position.set(
          object.transform.x + piece.x,
          baseY + piece.y,
          object.transform.z + piece.z,
        );
        dummy.rotation.set(0, piece.yaw, 0);
        dummy.scale.set(
          piece.scaleX * object.transform.scale,
          piece.scaleY * object.transform.scale,
          piece.scaleZ * object.transform.scale,
        );
        dummy.updateMatrix();
        clutter.setMatrixAt(instanceIndex, dummy.matrix);
        clutter.setColorAt(instanceIndex, color);
        bindings.push({
          mesh: clutter,
          index: instanceIndex,
          baseColor: color,
        });
      }
      this.register(
        object,
        index,
        bindings,
        undefined,
        0.05,
        ids,
      );
    });
    finishMesh(clutter);
    group.add(clutter);
  }

  private createMesh(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    count: number,
    name: string,
  ): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.name = name;
    mesh.castShadow = this.shadows;
    mesh.receiveShadow = true;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.userData.sharedSemanticResource = true;
    return mesh;
  }

  private register(
    object: SemanticRenderObject,
    instanceIndex: number,
    bindings: InstanceBinding[],
    collider: WorldCollider | undefined,
    height: number,
    ids: string[],
    anchorPosition?: Readonly<{ x: number; z: number }>,
  ): void {
    ids.push(object.id);
    this.records.set(object.id, {
      id: object.id,
      chunkKey: object.chunkKey,
      batchKey: object.batchKey,
      instanceIndex,
      lifecycle: object.lifecycle,
      interactive: object.interactive,
      focusPolicy: object.focusPolicy,
      anchor: {
        x: anchorPosition?.x ?? object.transform.x,
        z: anchorPosition?.z ?? object.transform.z,
        height,
      },
      ...(collider ? { collider } : {}),
      bindings,
      impactUntil: 0,
    });
  }

  private removeChunk(key: string): void {
    const chunk = this.chunks.get(key);
    if (!chunk) return;
    for (const id of chunk.ids) this.records.delete(id);
    chunk.group.traverse((object) => {
      if (object instanceof THREE.InstancedMesh) object.dispose();
    });
    this.root.remove(chunk.group);
    chunk.group.clear();
    this.chunks.delete(key);
  }

  private refreshRecordColor(id: string): void {
    const record = this.records.get(id);
    if (!record) return;
    const impacted = record.impactUntil > performance.now();
    for (const binding of record.bindings) {
      const color = binding.baseColor.clone();
      if (impacted) color.lerp(new THREE.Color(0xffbf54), 0.72);
      else if (this.focusedId === id) color.lerp(this.focusTone, 0.46);
      binding.mesh.setColorAt(binding.index, color);
      if (binding.mesh.instanceColor) binding.mesh.instanceColor.needsUpdate = true;
    }
  }
}

function finishMesh(mesh: THREE.InstancedMesh): void {
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
}

function stateSignature(states: readonly SemanticRenderState[]): string {
  return states
    .map(
      (state) => {
        const tree = state.treeHarvest;
        const regrowth = state.treeRegrowth;
        return `${state.id}:${state.quantity}:${state.nextRegenerationTick ?? "-"}:${
          tree
            ? `${tree.fallDirection},${tree.branches},${tree.trunkSegments},${tree.looseLog ? 1 : 0}`
            : "-"
        }:${
          regrowth
            ? `${regrowth.cycle},${regrowth.stage},${regrowth.stageStartedAtTick},${regrowth.lastAdvancedTick},${regrowth.schedule.matureAtTick}`
            : "-"
        }`;
      },
    )
    .sort()
    .join("|");
}

function runtimeById(
  states: readonly SemanticRenderState[],
): Readonly<Record<string, SemanticRuntimeRenderState>> {
  return Object.fromEntries(
    states.map((state) => [
      state.id,
      {
        quantity: state.quantity,
        nextRegenerationTick: state.nextRegenerationTick,
        ...(state.treeHarvest
          ? { treeHarvest: { ...state.treeHarvest } }
          : {}),
        ...(state.treeRegrowth
          ? { treeRegrowth: cloneTreeRegrowthState(state.treeRegrowth) }
          : {}),
      },
    ]),
  );
}

function plantLifecycleScale(
  object: Pick<
    SemanticRenderObject,
    "lifecycle" | "quantity" | "baselineQuantity"
  >,
  baseline = Math.max(1, object.baselineQuantity ?? 1),
): number {
  const fraction = Math.max(
    0,
    Math.min(1, (object.quantity ?? baseline) / baseline),
  );
  return object.lifecycle === "depleted"
    ? 0.08
    : object.lifecycle === "regrowing"
      ? 0.2 + fraction * 0.65
      : 0.72 + fraction * 0.28;
}

type GeometryPoint = readonly [x: number, y: number, z: number];
type GeometryColor = readonly [r: number, g: number, b: number];

function createColoredGeometry(
  build: (
    triangle: (
      a: GeometryPoint,
      b: GeometryPoint,
      c: GeometryPoint,
      color: GeometryColor,
    ) => void,
  ) => void,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  build((a, b, c, color) => {
    positions.push(...a, ...b, ...c);
    colors.push(...color, ...color, ...color);
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute(
    "color",
    new THREE.Float32BufferAttribute(colors, 3),
  );
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function createPlantainGeometry(): THREE.BufferGeometry {
  const stem: GeometryColor = [0.52, 0.68, 0.27];
  const leaf: GeometryColor = [0.26, 0.62, 0.25];
  const fruit: GeometryColor = [0.91, 0.78, 0.2];
  return createColoredGeometry((triangle) => {
    const addQuad = (
      a: GeometryPoint,
      b: GeometryPoint,
      c: GeometryPoint,
      d: GeometryPoint,
      color: GeometryColor,
    ) => {
      triangle(a, b, c, color);
      triangle(a, c, d, color);
    };
    addQuad([-0.1, 0, 0], [0.1, 0, 0], [0.07, 1.18, 0], [-0.07, 1.18, 0], stem);
    addQuad([0, 0, -0.1], [0, 0, 0.1], [0, 1.18, 0.07], [0, 1.18, -0.07], stem);

    for (let index = 0; index < 7; index += 1) {
      const angle = (index / 7) * Math.PI * 2;
      const directionX = Math.cos(angle);
      const directionZ = Math.sin(angle);
      const sideX = -directionZ;
      const sideZ = directionX;
      const base: GeometryPoint = [directionX * 0.04, 1.08, directionZ * 0.04];
      const left: GeometryPoint = [
        directionX * 0.58 + sideX * 0.24,
        1.48 - (index % 2) * 0.06,
        directionZ * 0.58 + sideZ * 0.24,
      ];
      const right: GeometryPoint = [
        directionX * 0.58 - sideX * 0.24,
        1.48 - (index % 2) * 0.06,
        directionZ * 0.58 - sideZ * 0.24,
      ];
      const tip: GeometryPoint = [
        directionX * 1.28,
        1.04 + (index % 3) * 0.05,
        directionZ * 1.28,
      ];
      triangle(base, left, tip, leaf);
      triangle(base, tip, right, leaf);
    }

    for (let index = 0; index < 5; index += 1) {
      const angle = (index / 5) * Math.PI * 2 + 0.32;
      const x = Math.cos(angle) * 0.17;
      const z = Math.sin(angle) * 0.17;
      const sideX = -Math.sin(angle) * 0.055;
      const sideZ = Math.cos(angle) * 0.055;
      triangle(
        [x, 1.04, z],
        [x + sideX, 0.79, z + sideZ],
        [x, 0.55, z],
        fruit,
      );
      triangle(
        [x, 1.04, z],
        [x, 0.55, z],
        [x - sideX, 0.79, z - sideZ],
        fruit,
      );
    }
  });
}

function createAmbientFoliageGeometry(): THREE.BufferGeometry {
  const dark: GeometryColor = [0.16, 0.4, 0.19];
  const middle: GeometryColor = [0.22, 0.5, 0.23];
  return createColoredGeometry((triangle) => {
    for (let index = 0; index < 5; index += 1) {
      const angle = (index / 5) * Math.PI * 2;
      const directionX = Math.cos(angle);
      const directionZ = Math.sin(angle);
      const sideX = -directionZ;
      const sideZ = directionX;
      const base: GeometryPoint = [0, 0.04, 0];
      const left: GeometryPoint = [
        directionX * 0.42 + sideX * 0.28,
        0.5 + (index % 2) * 0.12,
        directionZ * 0.42 + sideZ * 0.28,
      ];
      const right: GeometryPoint = [
        directionX * 0.42 - sideX * 0.28,
        0.5 + (index % 2) * 0.12,
        directionZ * 0.42 - sideZ * 0.28,
      ];
      const tip: GeometryPoint = [
        directionX * 1.15,
        0.72 + (index % 3) * 0.08,
        directionZ * 1.15,
      ];
      const color = index % 2 === 0 ? dark : middle;
      triangle(base, left, tip, color);
      triangle(base, tip, right, color);
    }
  });
}

function lifecycleColor(
  base: THREE.Color,
  lifecycle: SemanticLifecycle,
  quantity: number | null,
  baselineQuantity: number | null,
): THREE.Color {
  const color = base.clone();
  if (lifecycle === "depleted") return color.lerp(new THREE.Color(0x3f4038), 0.68);
  if (lifecycle === "regrowing") return color.lerp(new THREE.Color(0x83b35c), 0.34);
  if (lifecycle === "felled") return color.lerp(new THREE.Color(0x6f5137), 0.18);
  if (lifecycle === "partial") {
    const fraction = Math.max(
      0,
      Math.min(1, (quantity ?? 0) / Math.max(1, baselineQuantity ?? 1)),
    );
    return color.lerp(new THREE.Color(0x795b3f), 0.2 + (1 - fraction) * 0.32);
  }
  return color;
}

function plantColor(species: string | undefined): THREE.Color {
  return new THREE.Color(
    species === "antiparasitic-herb"
      ? 0x78934a
      : species === "fiber-vine"
        ? 0x47743b
        : species === "palm-fruit-shrub"
          ? 0x6e8a3e
          : species === "wild-plantain"
            ? 0x84a94a
          : 0x66a05a,
  );
}

function ambientFoliageColor(visualVariant: string): THREE.Color {
  return new THREE.Color(
    visualVariant.startsWith("fern")
      ? 0x3f7142
      : visualVariant.startsWith("midstory")
        ? 0x285535
        : 0x35683b,
  );
}
