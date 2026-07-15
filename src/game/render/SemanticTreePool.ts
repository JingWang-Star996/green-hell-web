import * as THREE from "three";

import {
  treeFallenGeometry,
  treeHarvestFinished,
  treeInteractionAnchor,
  type TreeGeometrySource,
} from "../sim/treeHarvest";
import { cloneTreeRegrowthState } from "../sim/treeRegrowthRuntime";
import type { WorldCollider } from "../world/interactionGeometry";
import type {
  SemanticLifecycle,
  SemanticRenderObject,
} from "../world/semanticRenderPlan";

type InstanceBinding = {
  mesh: THREE.InstancedMesh;
  index: number;
  baseColor: THREE.Color;
};

type InternalTreeRecord = SemanticTreePoolRecord & {
  bindings: InstanceBinding[];
  impactUntil: number;
  impactToken: number;
  slotGeneration: number;
  visualSignature: string;
};

export type SemanticTreePoolRecord = {
  id: string;
  chunkKey: string;
  batchKey: string;
  instanceIndex: number;
  lifecycle: SemanticLifecycle;
  interactive: boolean;
  focusPolicy: "capability" | "never-focus";
  anchor: Readonly<{ x: number; z: number; height: number }>;
  collider: WorldCollider;
};

export type SemanticTreePoolDiagnostics = {
  capacity: number;
  occupied: number;
  highWater: number;
  holes: number;
  submittedInstances: number;
  interactive: number;
  colliders: number;
  meshes: number;
  meshCreations: number;
  slotWrites: number;
  lastSyncSlotWrites: number;
  releases: number;
  overflows: number;
};

export type SemanticTreePoolOptions = {
  capacity: number;
  shadows: boolean;
  terrainHeight: (x: number, z: number) => number;
};

/** Fixed five-mesh active-ring pool for every deterministic semantic tree. */
export class SemanticTreePool {
  readonly root = new THREE.Group();

  private readonly capacity: number;
  private readonly terrainHeight: SemanticTreePoolOptions["terrainHeight"];
  private readonly slotIds: Array<string | null>;
  private readonly slotGenerations: Uint32Array;
  private readonly slotsById = new Map<string, number>();
  private readonly records = new Map<string, InternalTreeRecord>();
  private readonly dummy = new THREE.Object3D();
  private readonly vertical = new THREE.Vector3(0, 1, 0);
  private readonly direction = new THREE.Vector3();
  private readonly hiddenMatrix = new THREE.Matrix4().makeScale(
    0.001,
    0.001,
    0.001,
  );
  private focusedId: string | null = null;
  private focusTone = new THREE.Color(0x9fbe68);
  private disposed = false;
  private slotWrites = 0;
  private lastSyncSlotWrites = 0;
  private releases = 0;
  private overflows = 0;
  private nextImpactToken = 0;

  private readonly geometries = {
    trunk: new THREE.CylinderGeometry(1, 1.18, 1, 7),
    crown: new THREE.IcosahedronGeometry(1, 1),
  };

  private readonly materials = {
    trunk: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }),
    crown: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.98 }),
  };

  private readonly trunks: THREE.InstancedMesh;
  private readonly crowns: THREE.InstancedMesh;
  private readonly stumps: THREE.InstancedMesh;
  private readonly branchBundles: THREE.InstancedMesh;
  private readonly looseLogs: THREE.InstancedMesh;

  constructor(options: SemanticTreePoolOptions) {
    if (!Number.isSafeInteger(options.capacity) || options.capacity < 1) {
      throw new RangeError(
        "SemanticTreePool capacity must be a positive safe integer",
      );
    }
    this.capacity = options.capacity;
    this.terrainHeight = options.terrainHeight;
    this.slotIds = Array.from({ length: this.capacity }, () => null);
    this.slotGenerations = new Uint32Array(this.capacity);
    this.root.name = "semantic-tree-pool";
    this.trunks = this.createMesh(
      this.geometries.trunk,
      this.materials.trunk,
      "semantic-tree-trunks",
      options.shadows,
    );
    this.crowns = this.createMesh(
      this.geometries.crown,
      this.materials.crown,
      "semantic-tree-crowns",
      options.shadows,
    );
    this.stumps = this.createMesh(
      this.geometries.trunk,
      this.materials.trunk,
      "semantic-tree-stumps",
      options.shadows,
    );
    this.branchBundles = this.createMesh(
      this.geometries.trunk,
      this.materials.trunk,
      "semantic-tree-branch-bundles",
      options.shadows,
    );
    this.looseLogs = this.createMesh(
      this.geometries.trunk,
      this.materials.trunk,
      "semantic-tree-loose-logs",
      options.shadows,
    );
    for (const mesh of this.meshes()) mesh.count = 0;
    this.root.add(...this.meshes());
  }

  sync(objects: readonly SemanticRenderObject[]): void {
    if (this.disposed) return;
    const desiredById = new Map<string, SemanticRenderObject>();
    for (const object of objects) {
      if (object.category !== "tree") continue;
      desiredById.set(object.id, object);
    }
    const desired = [...desiredById.values()].sort((left, right) =>
      left.id.localeCompare(right.id),
    );
    this.assertCapacityForUniqueCount(desired.length);

    this.lastSyncSlotWrites = 0;
    const desiredIds = new Set(desired.map((object) => object.id));
    let touched = false;
    for (const id of [...this.slotsById.keys()]) {
      if (desiredIds.has(id)) continue;
      this.release(id);
      touched = true;
    }
    for (const object of desired) {
      const signature = treeVisualSignature(object);
      const current = this.records.get(object.id);
      if (current?.visualSignature === signature) continue;
      const slot = this.slotsById.get(object.id) ?? this.allocate(object.id);
      this.writeSlot(object, slot, signature, current);
      this.slotWrites += 1;
      this.lastSyncSlotWrites += 1;
      touched = true;
    }
    if (touched) this.finishMeshes();
  }

  assertCapacityForUniqueCount(uniqueTreeCount: number): void {
    if (!Number.isSafeInteger(uniqueTreeCount) || uniqueTreeCount < 0) {
      throw new RangeError(
        "Unique semantic tree count must be a non-negative safe integer",
      );
    }
    if (uniqueTreeCount > this.capacity) {
      throw new RangeError(
        `Semantic tree pool capacity ${this.capacity} cannot hold ${uniqueTreeCount} active trees`,
      );
    }
  }

  getRecord(id: string): SemanticTreePoolRecord | undefined {
    const record = this.records.get(id);
    if (!record) return undefined;
    return copyRecord(record);
  }

  getColliders(excludingId?: string): WorldCollider[] {
    const result: WorldCollider[] = [];
    for (const record of this.records.values()) {
      if (record.id === excludingId) continue;
      result.push({ ...record.collider });
    }
    return result;
  }

  setFocus(id: string | null, tone = this.focusTone): void {
    const previous = this.focusedId;
    this.focusedId = id && this.records.has(id) ? id : null;
    this.focusTone = tone.clone();
    if (previous) this.refreshRecordColor(previous);
    if (this.focusedId) this.refreshRecordColor(this.focusedId);
  }

  playImpact(id: string): boolean {
    const record = this.records.get(id);
    if (!record) return false;
    record.impactUntil = performance.now() + 150;
    record.impactToken = ++this.nextImpactToken;
    const slot = record.instanceIndex;
    const slotGeneration = record.slotGeneration;
    const impactToken = record.impactToken;
    this.refreshRecordColor(id);
    globalThis.setTimeout(() => {
      const current = this.records.get(id);
      if (
        !current ||
        current.instanceIndex !== slot ||
        current.slotGeneration !== slotGeneration ||
        current.impactToken !== impactToken
      ) {
        return;
      }
      current.impactUntil = 0;
      this.refreshRecordColor(id);
    }, 170);
    return true;
  }

  getDiagnostics(): SemanticTreePoolDiagnostics {
    let interactive = 0;
    for (const record of this.records.values()) {
      if (record.interactive) interactive += 1;
    }
    const highWater = this.trunks.count;
    return {
      capacity: this.capacity,
      occupied: this.records.size,
      highWater,
      holes: Math.max(0, highWater - this.records.size),
      submittedInstances: this.meshes().reduce(
        (sum, mesh) => sum + mesh.count,
        0,
      ),
      interactive,
      colliders: this.records.size,
      meshes: 5,
      meshCreations: 5,
      slotWrites: this.slotWrites,
      lastSyncSlotWrites: this.lastSyncSlotWrites,
      releases: this.releases,
      overflows: this.overflows,
    };
  }

  clear(): void {
    if (this.disposed) return;
    const hadRecords = this.records.size > 0;
    for (const id of [...this.slotsById.keys()]) this.release(id);
    this.focusedId = null;
    this.lastSyncSlotWrites = 0;
    if (hadRecords) this.finishMeshes();
  }

  dispose(): void {
    if (this.disposed) return;
    this.clear();
    this.disposed = true;
    this.root.remove(...this.meshes());
    for (const mesh of this.meshes()) mesh.dispose();
    Object.values(this.geometries).forEach((geometry) => geometry.dispose());
    Object.values(this.materials).forEach((material) => material.dispose());
    this.root.clear();
  }

  private allocate(id: string): number {
    const slot = this.slotIds.indexOf(null);
    if (slot < 0) {
      this.overflows += 1;
      throw new RangeError("Semantic tree pool has no free slot");
    }
    this.slotIds[slot] = id;
    this.slotGenerations[slot] =
      (this.slotGenerations[slot] + 1) >>> 0 || 1;
    this.slotsById.set(id, slot);
    return slot;
  }

  private release(id: string): void {
    const slot = this.slotsById.get(id);
    if (slot === undefined) return;
    this.writeHiddenSlot(slot);
    this.slotIds[slot] = null;
    this.slotsById.delete(id);
    this.records.delete(id);
    if (this.focusedId === id) this.focusedId = null;
    this.releases += 1;
  }

  private writeSlot(
    object: SemanticRenderObject,
    slot: number,
    visualSignature: string,
    previous: InternalTreeRecord | undefined,
  ): void {
    const dummy = this.dummy;
    const baseY = this.terrainHeight(object.transform.x, object.transform.z);
    const size = sizeScale(object.morphology.size);
    const growthStage = object.morphology.growthStage;
    const growthScale =
      growthStage === "sapling"
        ? 0.5
        : growthStage === "young"
          ? 0.76
          : growthStage === "stump"
            ? 0.68
            : 1;
    const standing =
      !object.treeHarvest &&
      object.lifecycle !== "depleted" &&
      growthStage !== "stump";
    const source = treeGeometrySource(object);
    const fallen = treeFallenGeometry(source);
    const hasFallenBody = Boolean(
      object.treeHarvest &&
        !treeHarvestFinished(object.treeHarvest) &&
        (object.treeHarvest.branches > 0 ||
          object.treeHarvest.trunkSegments > 0 ||
          object.treeHarvest.looseLog),
    );
    const height =
      (3.2 + size * 1.55) * object.transform.scale * growthScale;
    const radius =
      (0.16 + size * 0.055) *
      object.transform.scale *
      Math.max(0.58, growthScale);

    dummy.position.set(
      object.transform.x,
      baseY + height / 2,
      object.transform.z,
    );
    dummy.quaternion.identity();
    dummy.rotation.set(0, object.transform.yaw, 0);
    dummy.scale.set(radius, height, radius);
    if (fallen && hasFallenBody) {
      const midpointX = (fallen.start.x + fallen.end.x) / 2;
      const midpointZ = (fallen.start.z + fallen.end.z) / 2;
      this.direction.set(Math.cos(fallen.angle), 0, Math.sin(fallen.angle));
      dummy.position.set(midpointX, baseY + fallen.radius, midpointZ);
      dummy.quaternion.setFromUnitVectors(
        this.vertical,
        this.direction.normalize(),
      );
      dummy.scale.set(fallen.radius, fallen.length * 0.82, fallen.radius);
    } else if (!standing) {
      dummy.scale.setScalar(0.001);
    }
    dummy.updateMatrix();
    this.trunks.setMatrixAt(slot, dummy.matrix);

    dummy.quaternion.identity();
    if (standing) {
      dummy.position.set(
        object.transform.x,
        baseY + height * 0.9,
        object.transform.z,
      );
      dummy.scale.setScalar(
        (0.72 + size * 0.32) * object.transform.scale * growthScale,
      );
      dummy.rotation.set(0, object.transform.yaw + 0.31, 0);
    } else if (fallen && (object.treeHarvest?.branches ?? 0) > 0) {
      dummy.position.set(fallen.end.x, baseY + 0.42, fallen.end.z);
      dummy.rotation.set(0.35, -fallen.angle, 0.18);
      dummy.scale.set(
        (0.62 + size * 0.24) * object.transform.scale,
        0.48 * object.transform.scale,
        (0.78 + size * 0.2) * object.transform.scale,
      );
    } else {
      dummy.position.set(object.transform.x, baseY, object.transform.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(0.001);
    }
    dummy.updateMatrix();
    this.crowns.setMatrixAt(slot, dummy.matrix);

    const stumpHeight = 0.42 * object.transform.scale;
    dummy.quaternion.identity();
    dummy.rotation.set(0, object.transform.yaw, 0);
    dummy.position.set(
      object.transform.x,
      baseY + stumpHeight / 2,
      object.transform.z,
    );
    dummy.scale.set(
      standing ? 0.001 : radius * 1.2,
      standing ? 0.001 : stumpHeight,
      standing ? 0.001 : radius * 1.2,
    );
    dummy.updateMatrix();
    this.stumps.setMatrixAt(slot, dummy.matrix);

    const anchor = treeInteractionAnchor(source);
    dummy.quaternion.identity();
    if (fallen && (object.treeHarvest?.branches ?? 0) > 0) {
      this.direction.set(
        Math.cos(fallen.angle + 0.7),
        0,
        Math.sin(fallen.angle + 0.7),
      );
      dummy.position.set(anchor.x, baseY + 0.2, anchor.z);
      dummy.quaternion.setFromUnitVectors(
        this.vertical,
        this.direction.normalize(),
      );
      dummy.scale.set(0.075, 1.1, 0.075);
    } else {
      dummy.position.set(object.transform.x, baseY, object.transform.z);
      dummy.scale.setScalar(0.001);
    }
    dummy.updateMatrix();
    this.branchBundles.setMatrixAt(slot, dummy.matrix);

    dummy.quaternion.identity();
    if (fallen && object.treeHarvest?.looseLog) {
      const segmentLength = Math.max(
        1.05,
        fallen.length / Math.max(2, treeTrunkSegmentCapacity(object) + 1),
      );
      this.direction.set(Math.cos(fallen.angle), 0, Math.sin(fallen.angle));
      dummy.position.set(anchor.x, baseY + fallen.radius * 0.85, anchor.z);
      dummy.quaternion.setFromUnitVectors(
        this.vertical,
        this.direction.normalize(),
      );
      dummy.scale.set(
        fallen.radius * 0.9,
        segmentLength,
        fallen.radius * 0.9,
      );
    } else {
      dummy.position.set(object.transform.x, baseY, object.transform.z);
      dummy.scale.setScalar(0.001);
    }
    dummy.updateMatrix();
    this.looseLogs.setMatrixAt(slot, dummy.matrix);

    const trunkColor = lifecycleColor(
      treeTrunkColor(object.morphology.material),
      object.lifecycle,
      object.quantity,
      object.baselineQuantity,
    );
    const crownColor = lifecycleColor(
      treeCrownColor(object.morphology.species),
      object.lifecycle,
      object.quantity,
      object.baselineQuantity,
    );
    this.trunks.setColorAt(slot, trunkColor);
    this.crowns.setColorAt(slot, crownColor);
    this.stumps.setColorAt(
      slot,
      trunkColor.clone().lerp(new THREE.Color(0x3d2c20), 0.18),
    );
    this.branchBundles.setColorAt(
      slot,
      trunkColor.clone().lerp(new THREE.Color(0x80633f), 0.25),
    );
    this.looseLogs.setColorAt(
      slot,
      trunkColor.clone().lerp(new THREE.Color(0x9a7145), 0.2),
    );

    const collider: WorldCollider =
      fallen && hasFallenBody
        ? {
            kind: "capsule",
            startX: fallen.start.x,
            startZ: fallen.start.z,
            endX: fallen.end.x,
            endZ: fallen.end.z,
            radius: fallen.radius,
          }
        : {
            kind: "circle",
            x: object.transform.x,
            z: object.transform.z,
            radius: standing
              ? Math.max(0.34, radius * 1.8)
              : Math.max(0.2, radius * 1.15),
          };
    const record: InternalTreeRecord = {
      id: object.id,
      chunkKey: object.chunkKey,
      batchKey: object.batchKey,
      instanceIndex: slot,
      lifecycle: object.lifecycle,
      interactive: object.interactive,
      focusPolicy: object.focusPolicy,
      anchor: { ...anchor },
      collider,
      bindings: [
        { mesh: this.trunks, index: slot, baseColor: trunkColor },
        { mesh: this.crowns, index: slot, baseColor: crownColor },
        { mesh: this.stumps, index: slot, baseColor: trunkColor },
        { mesh: this.branchBundles, index: slot, baseColor: trunkColor },
        { mesh: this.looseLogs, index: slot, baseColor: trunkColor },
      ],
      impactUntil: previous?.impactUntil ?? 0,
      impactToken: previous?.impactToken ?? 0,
      slotGeneration: this.slotGenerations[slot]!,
      visualSignature,
    };
    this.records.set(object.id, record);
    if (
      this.focusedId === object.id ||
      record.impactUntil > performance.now()
    ) {
      this.refreshRecordColor(object.id);
    }
  }

  private writeHiddenSlot(slot: number): void {
    for (const mesh of this.meshes()) mesh.setMatrixAt(slot, this.hiddenMatrix);
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
      if (binding.mesh.instanceColor) {
        binding.mesh.instanceColor.needsUpdate = true;
      }
    }
  }

  private finishMeshes(): void {
    let highestSlot = -1;
    for (let index = this.slotIds.length - 1; index >= 0; index -= 1) {
      if (this.slotIds[index] !== null) {
        highestSlot = index;
        break;
      }
    }
    for (const mesh of this.meshes()) {
      mesh.count = highestSlot + 1;
      finishMesh(mesh);
    }
  }

  private createMesh(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    name: string,
    shadows: boolean,
  ): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geometry, material, this.capacity);
    mesh.name = name;
    mesh.castShadow = shadows;
    mesh.receiveShadow = true;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.userData.sharedSemanticResource = true;
    mesh.userData.semanticPool = "tree";
    return mesh;
  }

  private meshes(): readonly THREE.InstancedMesh[] {
    return [
      this.trunks,
      this.crowns,
      this.stumps,
      this.branchBundles,
      this.looseLogs,
    ];
  }
}

function copyRecord(record: SemanticTreePoolRecord): SemanticTreePoolRecord {
  return {
    id: record.id,
    chunkKey: record.chunkKey,
    batchKey: record.batchKey,
    instanceIndex: record.instanceIndex,
    lifecycle: record.lifecycle,
    interactive: record.interactive,
    focusPolicy: record.focusPolicy,
    anchor: { ...record.anchor },
    collider: { ...record.collider },
  };
}

function finishMesh(mesh: THREE.InstancedMesh): void {
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  if (mesh.count > 0) mesh.computeBoundingSphere();
  else mesh.boundingSphere = new THREE.Sphere();
}

function treeVisualSignature(object: SemanticRenderObject): string {
  const harvest = object.treeHarvest;
  const regrowth = object.treeRegrowth;
  return [
    object.id,
    object.chunkKey,
    object.batchKey,
    object.lifecycle,
    object.interactive ? 1 : 0,
    object.focusPolicy,
    object.quantity ?? "-",
    object.baselineQuantity ?? "-",
    object.nextRegenerationTick ?? "-",
    object.transform.x,
    object.transform.y,
    object.transform.z,
    object.transform.yaw,
    object.transform.scale,
    object.morphology.species ?? "-",
    object.morphology.material ?? "-",
    object.morphology.growthStage ?? "-",
    object.morphology.size ?? "-",
    object.morphology.visualVariant,
    harvest?.fallDirection ?? "-",
    harvest?.branches ?? "-",
    harvest?.trunkSegments ?? "-",
    harvest?.looseLog ? 1 : 0,
    regrowth?.cycle ?? "-",
    regrowth?.stage ?? "-",
    regrowth?.stageStartedAtTick ?? "-",
    regrowth?.lastAdvancedTick ?? "-",
    regrowth?.schedule.matureAtTick ?? "-",
  ].join(":");
}

function treeGeometrySource(object: SemanticRenderObject): TreeGeometrySource {
  return {
    id: object.id,
    position: {
      x: object.transform.x,
      y: object.transform.y,
      z: object.transform.z,
    },
    quantity: object.quantity ?? object.baselineQuantity ?? 0,
    semantic: {
      category: "tree",
      species: object.morphology.species,
      material: object.morphology.material ?? "wood",
      growthStage: object.morphology.growthStage,
      size:
        object.morphology.size === "large" ||
        object.morphology.size === "medium"
          ? object.morphology.size
          : "small",
      scale: object.transform.scale,
    },
    ...(object.treeHarvest
      ? { treeHarvest: { ...object.treeHarvest } }
      : {}),
    ...(object.treeRegrowth
      ? { treeRegrowth: cloneTreeRegrowthState(object.treeRegrowth) }
      : {}),
  };
}

function treeTrunkSegmentCapacity(object: SemanticRenderObject): number {
  return object.morphology.growthStage === "old-growth"
    ? 3
    : object.morphology.growthStage === "mature"
      ? 2
      : object.morphology.growthStage === "sapling"
        ? 0
        : 1;
}

function sizeScale(size: string | undefined): number {
  return size === "large" ? 1.25 : size === "medium" ? 0.88 : 0.56;
}

function lifecycleColor(
  base: THREE.Color,
  lifecycle: SemanticLifecycle,
  quantity: number | null,
  baselineQuantity: number | null,
): THREE.Color {
  const color = base.clone();
  if (lifecycle === "depleted") {
    return color.lerp(new THREE.Color(0x3f4038), 0.68);
  }
  if (lifecycle === "regrowing") {
    return color.lerp(new THREE.Color(0x83b35c), 0.34);
  }
  if (lifecycle === "felled") {
    return color.lerp(new THREE.Color(0x6f5137), 0.18);
  }
  if (lifecycle === "partial") {
    const fraction = Math.max(
      0,
      Math.min(1, (quantity ?? 0) / Math.max(1, baselineQuantity ?? 1)),
    );
    return color.lerp(
      new THREE.Color(0x795b3f),
      0.2 + (1 - fraction) * 0.32,
    );
  }
  return color;
}

function treeTrunkColor(material: string | undefined): THREE.Color {
  return new THREE.Color(
    material === "hardwood"
      ? 0x49382d
      : material === "palmwood"
        ? 0x725239
        : 0x68503b,
  );
}

function treeCrownColor(species: string | undefined): THREE.Color {
  return new THREE.Color(
    species === "ironwood"
      ? 0x214a2d
      : species === "rain-palm"
        ? 0x397847
        : 0x2d6338,
  );
}
