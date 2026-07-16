import * as THREE from "three";

import {
  rockInteractionGeometry,
  rockLifecycle,
} from "../sim/rockHarvest";
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

type InternalRockRecord = SemanticRockPoolRecord & {
  bindings: InstanceBinding[];
  impactUntil: number;
  impactToken: number;
  slotGeneration: number;
  visualSignature: string;
};

export type SemanticRockPoolRecord = {
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

export type SemanticRockPoolDiagnostics = {
  /** Stable structural capacity; never grows while the layer is alive. */
  capacity: number;
  occupied: number;
  /** Logical slots submitted up to the highest occupied index. */
  highWater: number;
  /** Empty logical slots below highWater retained for generation safety. */
  holes: number;
  /** Sum of submitted body/accent/rubble instance counts. */
  submittedInstances: number;
  interactive: number;
  colliders: number;
  meshes: number;
  /** Stable resource creation count; remains three until disposal. */
  meshCreations: number;
  /** Cumulative deterministic counters since construction. */
  slotWrites: number;
  /** Transient telemetry for the most recent sync; excluded from equality gates. */
  lastSyncSlotWrites: number;
  releases: number;
  overflows: number;
};

export type SemanticRockPoolOptions = {
  capacity: number;
  shadows: boolean;
  terrainHeight: (x: number, z: number) => number;
};

/**
 * Fixed-capacity, active-ring-wide pool for deterministic mineable rocks.
 *
 * The pool owns exactly three InstancedMesh objects for its whole lifetime.
 * Streaming and lifecycle changes only update instance slots; they never
 * allocate or dispose Three.js resources. Simulation identity, collision and
 * persistence remain outside this presentation-only projection.
 */
export class SemanticRockPool {
  readonly root = new THREE.Group();

  private readonly capacity: number;
  private readonly terrainHeight: SemanticRockPoolOptions["terrainHeight"];
  private readonly slotIds: Array<string | null>;
  private readonly slotGenerations: Uint32Array;
  private readonly slotsById = new Map<string, number>();
  private readonly records = new Map<string, InternalRockRecord>();
  private readonly dummy = new THREE.Object3D();
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
    body: new THREE.DodecahedronGeometry(1, 0),
    accent: new THREE.BoxGeometry(1, 1, 1),
    rubble: new THREE.DodecahedronGeometry(1, 0),
  };

  private readonly materials = {
    body: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }),
    accent: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }),
    rubble: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }),
  };

  private readonly bodies: THREE.InstancedMesh;
  private readonly accents: THREE.InstancedMesh;
  private readonly rubble: THREE.InstancedMesh;

  constructor(options: SemanticRockPoolOptions) {
    if (!Number.isSafeInteger(options.capacity) || options.capacity < 1) {
      throw new RangeError("SemanticRockPool capacity must be a positive safe integer");
    }
    this.capacity = options.capacity;
    this.terrainHeight = options.terrainHeight;
    this.slotIds = Array.from({ length: this.capacity }, () => null);
    this.slotGenerations = new Uint32Array(this.capacity);
    this.root.name = "semantic-rock-pool";
    this.bodies = this.createMesh(
      this.geometries.body,
      this.materials.body,
      this.capacity,
      "semantic-rock-bodies",
      options.shadows,
    );
    this.accents = this.createMesh(
      this.geometries.accent,
      this.materials.accent,
      this.capacity * 2,
      "semantic-rock-accents",
      options.shadows,
    );
    this.rubble = this.createMesh(
      this.geometries.rubble,
      this.materials.rubble,
      this.capacity * 3,
      "semantic-rock-exhausted-rubble",
      options.shadows,
    );
    this.bodies.count = 0;
    this.accents.count = 0;
    this.rubble.count = 0;
    this.root.add(this.bodies, this.accents, this.rubble);
  }

  sync(objects: readonly SemanticRenderObject[]): void {
    if (this.disposed) return;
    const desiredById = new Map<string, SemanticRenderObject>();
    for (const object of objects) {
      if (object.category !== "mineable-rock") continue;
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
      const signature = rockVisualSignature(object);
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

  /** Pure capacity preflight used before the owning layer mutates chunks. */
  assertCapacityForUniqueCount(uniqueRockCount: number): void {
    if (!Number.isSafeInteger(uniqueRockCount) || uniqueRockCount < 0) {
      throw new RangeError("Unique semantic rock count must be a non-negative safe integer");
    }
    if (uniqueRockCount > this.capacity) {
      // No diagnostic or slot mutation here: a rejected sync is transactionally
      // invisible to callers inspecting the last committed layer snapshot.
      throw new RangeError(
        `Semantic rock pool capacity ${this.capacity} cannot hold ${uniqueRockCount} active rocks`,
      );
    }
  }

  has(id: string): boolean {
    return this.records.has(id);
  }

  getRecord(id: string): SemanticRockPoolRecord | undefined {
    const record = this.records.get(id);
    if (!record) return undefined;
    return copyRecord(record);
  }

  getRecords(): readonly SemanticRockPoolRecord[] {
    return [...this.records.values()].map(copyRecord);
  }

  getColliders(excludingId?: string): WorldCollider[] {
    const result: WorldCollider[] = [];
    for (const record of this.records.values()) {
      if (record.id === excludingId || !record.collider) continue;
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

  getDiagnostics(): SemanticRockPoolDiagnostics {
    let interactive = 0;
    let colliders = 0;
    for (const record of this.records.values()) {
      if (record.interactive) interactive += 1;
      if (record.collider) colliders += 1;
    }
    return {
      capacity: this.capacity,
      occupied: this.records.size,
      highWater: this.bodies.count,
      holes: Math.max(0, this.bodies.count - this.records.size),
      submittedInstances:
        this.bodies.count + this.accents.count + this.rubble.count,
      interactive,
      colliders,
      meshes: 3,
      meshCreations: 3,
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
    this.root.remove(this.bodies, this.accents, this.rubble);
    this.bodies.dispose();
    this.accents.dispose();
    this.rubble.dispose();
    Object.values(this.geometries).forEach((geometry) => geometry.dispose());
    Object.values(this.materials).forEach((material) => material.dispose());
    this.root.clear();
  }

  private allocate(id: string): number {
    const slot = this.slotIds.indexOf(null);
    if (slot < 0) {
      this.overflows += 1;
      throw new RangeError("Semantic rock pool has no free slot");
    }
    this.slotIds[slot] = id;
    this.slotGenerations[slot] = (this.slotGenerations[slot] + 1) >>> 0 || 1;
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
    previous: InternalRockRecord | undefined,
  ): void {
    const geometry = rockInteractionGeometry(object);
    const state = rockLifecycle(
      object.quantity ?? 0,
      object.baselineQuantity ?? 1,
    );
    const exhausted = state === "exhausted";
    const bodyScale = state === "partial" ? 0.94 : 1;
    const baseY = this.terrainHeight(object.transform.x, object.transform.z);
    const dummy = this.dummy;

    dummy.position.set(
      object.transform.x,
      baseY + geometry.bodyScale.y * bodyScale,
      object.transform.z,
    );
    dummy.rotation.set(
      object.transform.yaw * 0.08,
      object.transform.yaw,
      object.transform.yaw * 0.05,
    );
    dummy.scale.set(
      exhausted ? 0.001 : geometry.bodyScale.x * bodyScale,
      exhausted ? 0.001 : geometry.bodyScale.y * bodyScale,
      exhausted ? 0.001 : geometry.bodyScale.z * bodyScale,
    );
    dummy.updateMatrix();
    this.bodies.setMatrixAt(slot, dummy.matrix);
    const bodyColor = lifecycleColor(
      rockColor(object.morphology.material),
      object.lifecycle,
      object.quantity,
      object.baselineQuantity,
    );
    this.bodies.setColorAt(slot, bodyColor);

    const accentBase =
      state === "partial"
        ? new THREE.Color(0x251f1a)
        : rockAccentColor(object.morphology.material);
    const cosine = Math.cos(object.transform.yaw);
    const sine = Math.sin(object.transform.yaw);
    const accentBindings: InstanceBinding[] = [];
    for (let part = 0; part < 2; part += 1) {
      const accentIndex = slot * 2 + part;
      const localX = (part === 0 ? -0.13 : 0.19) * geometry.bodyScale.x;
      const localZ = -geometry.bodyScale.z * (0.84 + part * 0.035);
      dummy.quaternion.identity();
      dummy.position.set(
        object.transform.x + localX * cosine + localZ * sine,
        baseY + geometry.anchor.height * (part === 0 ? 0.82 : 1.2),
        object.transform.z - localX * sine + localZ * cosine,
      );
      dummy.rotation.set(
        state === "partial" ? 0.25 : 0.04,
        object.transform.yaw + (state === "partial" ? part * 0.55 : 0),
        state === "partial" ? (part === 0 ? 0.72 : -0.58) : 0.08,
      );
      if (exhausted) {
        dummy.scale.setScalar(0.001);
      } else if (object.morphology.material === "limestone") {
        dummy.scale.set(
          geometry.bodyScale.x * (0.72 - part * 0.08),
          state === "partial" ? 0.035 : 0.045,
          0.025,
        );
      } else {
        dummy.scale.set(
          state === "partial" ? 0.035 : 0.07,
          geometry.bodyScale.y * (state === "partial" ? 0.68 : 0.32),
          state === "partial" ? 0.025 : 0.04,
        );
      }
      dummy.updateMatrix();
      this.accents.setMatrixAt(accentIndex, dummy.matrix);
      this.accents.setColorAt(accentIndex, accentBase);
      accentBindings.push({
        mesh: this.accents,
        index: accentIndex,
        baseColor: accentBase,
      });
    }

    const rubbleBindings: InstanceBinding[] = [];
    for (let part = 0; part < 3; part += 1) {
      const rubbleIndex = slot * 3 + part;
      const angle = object.transform.yaw + part * 2.14;
      const radius = geometry.bodyScale.x * (0.2 + part * 0.04);
      dummy.quaternion.identity();
      dummy.position.set(
        object.transform.x + Math.cos(angle) * radius,
        baseY + geometry.bodyScale.y * 0.1,
        object.transform.z + Math.sin(angle) * radius,
      );
      dummy.rotation.set(0.05 * part, angle, 0.08 * (part - 1));
      dummy.scale.set(
        exhausted ? geometry.bodyScale.x * (0.19 + part * 0.025) : 0.001,
        exhausted ? geometry.bodyScale.y * 0.1 : 0.001,
        exhausted ? geometry.bodyScale.z * (0.15 + part * 0.02) : 0.001,
      );
      dummy.updateMatrix();
      this.rubble.setMatrixAt(rubbleIndex, dummy.matrix);
      const rubbleColor = bodyColor
        .clone()
        .lerp(new THREE.Color(0x3d3b34), 0.42);
      this.rubble.setColorAt(rubbleIndex, rubbleColor);
      rubbleBindings.push({
        mesh: this.rubble,
        index: rubbleIndex,
        baseColor: rubbleColor,
      });
    }

    const collider = exhausted
      ? undefined
      : {
          kind: "circle" as const,
          x: geometry.anchor.x,
          z: geometry.anchor.z,
          radius: geometry.colliderRadius,
        };
    const record: InternalRockRecord = {
      id: object.id,
      chunkKey: object.chunkKey,
      batchKey: object.batchKey,
      instanceIndex: slot,
      lifecycle: object.lifecycle,
      interactive: object.interactive,
      focusPolicy: object.focusPolicy,
      anchor: { ...geometry.anchor },
      ...(collider ? { collider } : {}),
      bindings: [
        { mesh: this.bodies, index: slot, baseColor: bodyColor },
        ...accentBindings,
        ...rubbleBindings,
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
    this.bodies.setMatrixAt(slot, this.hiddenMatrix);
    for (let part = 0; part < 2; part += 1) {
      this.accents.setMatrixAt(slot * 2 + part, this.hiddenMatrix);
    }
    for (let part = 0; part < 3; part += 1) {
      this.rubble.setMatrixAt(slot * 3 + part, this.hiddenMatrix);
    }
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
    this.bodies.count = highestSlot + 1;
    this.accents.count = (highestSlot + 1) * 2;
    this.rubble.count = (highestSlot + 1) * 3;
    finishMesh(this.bodies);
    finishMesh(this.accents);
    finishMesh(this.rubble);
  }

  private createMesh(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    capacity: number,
    name: string,
    shadows: boolean,
  ): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.name = name;
    mesh.castShadow = shadows;
    mesh.receiveShadow = true;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.userData.sharedSemanticResource = true;
    mesh.userData.semanticPool = "mineable-rock";
    return mesh;
  }
}

function copyRecord(record: SemanticRockPoolRecord): SemanticRockPoolRecord {
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

function finishMesh(mesh: THREE.InstancedMesh): void {
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  if (mesh.count > 0) mesh.computeBoundingSphere();
  else mesh.boundingSphere = new THREE.Sphere();
}

function rockVisualSignature(object: SemanticRenderObject): string {
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
    object.morphology.material ?? "-",
    object.morphology.size ?? "-",
    object.morphology.visualVariant,
  ].join(":");
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

function rockColor(material: string | undefined): THREE.Color {
  return new THREE.Color(
    material === "limestone"
      ? 0x8b8775
      : material === "flint"
        ? 0x4d5757
        : material === "laterite-clay"
          ? 0x985e42
          : 0x6f756d,
  );
}

function rockAccentColor(material: string | undefined): THREE.Color {
  return new THREE.Color(
    material === "limestone"
      ? 0xc1bda4
      : material === "flint"
        ? 0x273034
        : material === "laterite-clay"
          ? 0x633426
          : 0xb2b7ac,
  );
}
