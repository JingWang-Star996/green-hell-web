import * as THREE from "three";

import {
  TORCH_WAYMARK_ACTIVE_LIGHT_LIMIT,
  TORCH_WAYMARK_LIGHT_ID_MAX_LENGTH,
  selectTorchWaymarkLightAssignments,
  type TorchWaymarkLightObserver,
} from "./torchWaymarkLightPolicy";
import { TORCH_WAYMARK_LAYOUT } from "../sim/structureGeometry";
import { TORCH_WAYMARK_MAX_FUEL_SLOTS } from "../sim/torchWaymarkRules";

/**
 * A hard renderer budget, deliberately above the 80-waymark save/load stress
 * scenario. Going beyond this number changes selection, never allocation.
 */
export const TORCH_WAYMARK_LAYER_CAPACITY = 128;

const BASE_STONES_PER_WAYMARK = 3;
const WAYMARK_LIGHT_HEIGHT = TORCH_WAYMARK_LAYOUT.poleHeight + 0.13;
const WAYMARK_LIGHT_RANGE = 6;

export interface TorchWaymarkVisualInput {
  id: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Authoritative simulation state; the layer never advances fuel itself. */
  lit: boolean;
  totalFuelSeconds: number;
  /** Actual queued torches (0..2): the first is the head, the second a reserve. */
  slotCount: number;
}

export type TorchWaymarkFrustumPredicate = (
  waymark: Readonly<TorchWaymarkVisualInput>,
) => boolean;

export interface TorchWaymarkLayerDiagnostics {
  readonly capacity: number;
  readonly activeWaymarks: number;
  readonly burningWaymarks: number;
  readonly reserveSlotWaymarks: number;
  /** Total live component instances across the fixed mesh pool. */
  readonly activeInstances: number;
  readonly instancedMeshObjects: number;
  readonly geometryObjects: number;
  readonly materialObjects: number;
  readonly lightObjectCount: number;
  readonly activeLightCount: number;
  readonly invalidInputCount: number;
  readonly duplicateInputCount: number;
  readonly overflowDroppedCount: number;
  readonly renderedIds: readonly string[];
  readonly lightIds: readonly string[];
  readonly disposed: boolean;
}

type RenderableWaymark = TorchWaymarkVisualInput & {
  inFrustum: boolean;
};

type ComponentMesh = THREE.InstancedMesh<
  THREE.BufferGeometry,
  THREE.Material
>;

type ComponentName =
  | "stoneBase"
  | "pole"
  | "crosspiece"
  | "torchHead"
  | "reserveSlot"
  | "ember"
  | "flame";

const BASE_STONE_LAYOUT = [
  { x: -0.39, z: 0.09, yaw: 0.18, sx: 0.59, sy: 0.39, sz: 0.48 },
  { x: 0.35, z: 0.17, yaw: -0.34, sx: 0.52, sy: 0.35, sz: 0.43 },
  { x: 0.02, z: -0.37, yaw: 0.72, sx: 0.48, sy: 0.3, sz: 0.54 },
] as const;

/**
 * Fixed-allocation, code-native low-poly torch waymarks.
 *
 * The layer owns seven InstancedMesh batches and exactly three shadowless
 * PointLights. A sync only changes matrices, draw counts and light bindings;
 * it never creates scene objects, geometries, materials, lights or per-waymark
 * Groups. Overflow is resolved by frustum lane, observer distance and stable
 * identity, so input ordering cannot grow or reshuffle the resource budget.
 */
export class TorchWaymarkLayer {
  readonly root = new THREE.Group();

  private readonly geometries = {
    stone: new THREE.DodecahedronGeometry(1, 0),
    timber: new THREE.CylinderGeometry(1, 1, 1, 6),
    ember: new THREE.DodecahedronGeometry(1, 0),
    flame: new THREE.ConeGeometry(1, 1, 6),
  };

  private readonly materials = {
    stone: new THREE.MeshStandardMaterial({
      color: 0x52564b,
      roughness: 1,
    }),
    timber: new THREE.MeshStandardMaterial({
      color: 0x5a3923,
      roughness: 1,
    }),
    charred: new THREE.MeshStandardMaterial({
      color: 0x171310,
      roughness: 1,
    }),
    ember: new THREE.MeshStandardMaterial({
      color: 0x7b1f09,
      emissive: 0xff4814,
      emissiveIntensity: 1.45,
      roughness: 0.82,
    }),
    flame: new THREE.MeshStandardMaterial({
      color: 0xff9b35,
      emissive: 0xff5a18,
      emissiveIntensity: 2.4,
      roughness: 0.7,
      transparent: true,
      opacity: 0.88,
      depthWrite: false,
    }),
  };

  private readonly meshes: Record<ComponentName, ComponentMesh>;
  private readonly lights: THREE.PointLight[];
  private readonly dummy = new THREE.Object3D();
  private readonly hiddenMatrix = new THREE.Matrix4().compose(
    new THREE.Vector3(0, -10_000, 0),
    new THREE.Quaternion(),
    new THREE.Vector3(0, 0, 0),
  );
  private readonly previousCounts: Record<ComponentName, number> = {
    stoneBase: 0,
    pole: 0,
    crosspiece: 0,
    torchHead: 0,
    reserveSlot: 0,
    ember: 0,
    flame: 0,
  };

  private activeWaymarks = 0;
  private burningWaymarks = 0;
  private reserveSlotWaymarks = 0;
  private invalidInputCount = 0;
  private duplicateInputCount = 0;
  private overflowDroppedCount = 0;
  private renderedIds: string[] = [];
  private lightIds: string[] = [];
  private disposed = false;

  constructor() {
    this.root.name = "torch-waymark-layer";

    this.meshes = {
      stoneBase: this.createMesh(
        "torch-waymark-stone-base",
        this.geometries.stone,
        this.materials.stone,
        TORCH_WAYMARK_LAYER_CAPACITY * BASE_STONES_PER_WAYMARK,
      ),
      pole: this.createMesh(
        "torch-waymark-poles",
        this.geometries.timber,
        this.materials.timber,
        TORCH_WAYMARK_LAYER_CAPACITY,
      ),
      crosspiece: this.createMesh(
        "torch-waymark-crosspieces",
        this.geometries.timber,
        this.materials.timber,
        TORCH_WAYMARK_LAYER_CAPACITY,
      ),
      torchHead: this.createMesh(
        "torch-waymark-charred-heads",
        this.geometries.timber,
        this.materials.charred,
        TORCH_WAYMARK_LAYER_CAPACITY,
      ),
      reserveSlot: this.createMesh(
        "torch-waymark-bound-reserves",
        this.geometries.timber,
        this.materials.charred,
        TORCH_WAYMARK_LAYER_CAPACITY,
      ),
      ember: this.createMesh(
        "torch-waymark-embers",
        this.geometries.ember,
        this.materials.ember,
        TORCH_WAYMARK_LAYER_CAPACITY,
      ),
      flame: this.createMesh(
        "torch-waymark-flames",
        this.geometries.flame,
        this.materials.flame,
        TORCH_WAYMARK_LAYER_CAPACITY,
      ),
    };

    this.lights = Array.from(
      { length: TORCH_WAYMARK_ACTIVE_LIGHT_LIMIT },
      (_, index) => {
        const light = new THREE.PointLight(
          0xff7a2d,
          0,
          WAYMARK_LIGHT_RANGE,
          2,
        );
        light.name = `torch-waymark-light-${index}`;
        light.castShadow = false;
        light.visible = false;
        light.userData.waymarkId = null;
        this.root.add(light);
        return light;
      },
    );
  }

  /**
   * Synchronizes authoritative visual state into the fixed pools.
   *
   * An invalid observer disables real lights but does not hide otherwise valid
   * silhouettes. A missing frustum predicate treats every valid waymark as
   * visible. Predicate failures fail closed into the offscreen lane.
   */
  sync(
    inputs: readonly TorchWaymarkVisualInput[] | null | undefined,
    observer: TorchWaymarkLightObserver | null | undefined,
    inFrustum?: TorchWaymarkFrustumPredicate,
  ): void {
    if (this.disposed) return;

    const source: readonly unknown[] = Array.isArray(inputs) ? inputs : [];
    this.invalidInputCount = !Array.isArray(inputs) && inputs != null ? 1 : 0;
    this.duplicateInputCount = 0;

    const identityCounts = new Map<string, number>();
    for (const value of source) {
      const id = validIdentity(value);
      if (!id) continue;
      identityCounts.set(id, (identityCounts.get(id) ?? 0) + 1);
    }

    const candidates: RenderableWaymark[] = [];
    for (const value of source) {
      if (!isValidVisualInput(value)) {
        this.invalidInputCount += 1;
        continue;
      }
      if (identityCounts.get(value.id) !== 1) {
        this.duplicateInputCount += 1;
        continue;
      }
      candidates.push({
        ...value,
        inFrustum: evaluateFrustum(inFrustum, value),
      });
    }

    const observerIsValid = isValidObserver(observer);
    candidates.sort((left, right) =>
      compareForVisualBudget(left, right, observerIsValid ? observer : null),
    );
    this.overflowDroppedCount = Math.max(
      0,
      candidates.length - TORCH_WAYMARK_LAYER_CAPACITY,
    );
    const rendered = candidates.slice(0, TORCH_WAYMARK_LAYER_CAPACITY);

    this.syncMatrices(rendered);
    this.syncLights(rendered, observerIsValid ? observer : null);
    this.renderedIds = rendered.map(({ id }) => id);
  }

  getDiagnostics(): TorchWaymarkLayerDiagnostics {
    return {
      capacity: TORCH_WAYMARK_LAYER_CAPACITY,
      activeWaymarks: this.activeWaymarks,
      burningWaymarks: this.burningWaymarks,
      reserveSlotWaymarks: this.reserveSlotWaymarks,
      activeInstances: Object.values(this.meshes).reduce(
        (sum, mesh) => sum + mesh.count,
        0,
      ),
      instancedMeshObjects: Object.keys(this.meshes).length,
      geometryObjects: Object.keys(this.geometries).length,
      materialObjects: Object.keys(this.materials).length,
      lightObjectCount: this.lights.length,
      activeLightCount: this.lightIds.length,
      invalidInputCount: this.invalidInputCount,
      duplicateInputCount: this.duplicateInputCount,
      overflowDroppedCount: this.overflowDroppedCount,
      renderedIds: [...this.renderedIds],
      lightIds: [...this.lightIds],
      disposed: this.disposed,
    };
  }

  /** Releases the fixed GPU resources exactly once. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.hideAllComponents();
    for (const light of this.lights) this.hideLight(light);
    for (const geometry of Object.values(this.geometries)) geometry.dispose();
    for (const material of Object.values(this.materials)) material.dispose();
    this.activeWaymarks = 0;
    this.burningWaymarks = 0;
    this.reserveSlotWaymarks = 0;
    this.renderedIds = [];
    this.lightIds = [];
    this.root.clear();
  }

  private createMesh(
    name: string,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    allocation: number,
  ): ComponentMesh {
    const mesh = new THREE.InstancedMesh(geometry, material, allocation);
    mesh.name = name;
    mesh.count = 0;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let index = 0; index < allocation; index += 1) {
      mesh.setMatrixAt(index, this.hiddenMatrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.root.add(mesh);
    return mesh;
  }

  private syncMatrices(rendered: readonly RenderableWaymark[]): void {
    let stoneIndex = 0;
    let poleIndex = 0;
    let crosspieceIndex = 0;
    let headIndex = 0;
    let reserveIndex = 0;
    let emberIndex = 0;
    let flameIndex = 0;

    for (const waymark of rendered) {
      for (const stone of BASE_STONE_LAYOUT) {
        this.writeMatrix(
          this.meshes.stoneBase,
          stoneIndex,
          waymark,
          stone.x * TORCH_WAYMARK_LAYOUT.stoneBaseRadius,
          TORCH_WAYMARK_LAYOUT.stoneBaseRadius * 0.24,
          stone.z * TORCH_WAYMARK_LAYOUT.stoneBaseRadius,
          0,
          stone.yaw,
          0,
          stone.sx * TORCH_WAYMARK_LAYOUT.stoneBaseRadius,
          stone.sy * TORCH_WAYMARK_LAYOUT.stoneBaseRadius,
          stone.sz * TORCH_WAYMARK_LAYOUT.stoneBaseRadius,
        );
        stoneIndex += 1;
      }

      this.writeMatrix(
        this.meshes.pole,
        poleIndex,
        waymark,
        0,
        TORCH_WAYMARK_LAYOUT.poleHeight / 2,
        0,
        0,
        0,
        0,
        0.055,
        TORCH_WAYMARK_LAYOUT.poleHeight,
        0.055,
      );
      poleIndex += 1;

      this.writeMatrix(
        this.meshes.crosspiece,
        crosspieceIndex,
        waymark,
        0,
        TORCH_WAYMARK_LAYOUT.poleHeight * 0.781,
        0,
        0,
        0,
        Math.PI / 2,
        0.042,
        0.72,
        0.042,
      );
      crosspieceIndex += 1;

      if (waymark.slotCount > 0) {
        this.writeMatrix(
          this.meshes.torchHead,
          headIndex,
          waymark,
          0,
          TORCH_WAYMARK_LAYOUT.poleHeight * 0.963,
          0,
          0.04,
          0,
          -0.08,
          0.085,
          0.36,
          0.085,
        );
        headIndex += 1;
      }

      if (waymark.slotCount > 1) {
        this.writeMatrix(
          this.meshes.reserveSlot,
          reserveIndex,
          waymark,
          0.19,
          TORCH_WAYMARK_LAYOUT.poleHeight * 0.642,
          0.02,
          0.06,
          0,
          -0.13,
          0.045,
          0.68,
          0.045,
        );
        reserveIndex += 1;
      }

      if (isBurning(waymark)) {
        this.writeMatrix(
          this.meshes.ember,
          emberIndex,
          waymark,
          0,
          TORCH_WAYMARK_LAYOUT.poleHeight * 1.019,
          0,
          0,
          0,
          0,
          0.12,
          0.09,
          0.12,
        );
        emberIndex += 1;
        this.writeMatrix(
          this.meshes.flame,
          flameIndex,
          waymark,
          0,
          TORCH_WAYMARK_LAYOUT.poleHeight * 1.13,
          0,
          0,
          0,
          0,
          0.15,
          0.43,
          0.15,
        );
        flameIndex += 1;
      }
    }

    this.commitCount("stoneBase", stoneIndex);
    this.commitCount("pole", poleIndex);
    this.commitCount("crosspiece", crosspieceIndex);
    this.commitCount("torchHead", headIndex);
    this.commitCount("reserveSlot", reserveIndex);
    this.commitCount("ember", emberIndex);
    this.commitCount("flame", flameIndex);
    this.activeWaymarks = rendered.length;
    this.burningWaymarks = flameIndex;
    this.reserveSlotWaymarks = reserveIndex;
  }

  private syncLights(
    rendered: readonly RenderableWaymark[],
    observer: TorchWaymarkLightObserver | null,
  ): void {
    const assignments = selectTorchWaymarkLightAssignments(
      rendered,
      observer,
    );
    this.lightIds = assignments.map(({ id }) => id);
    for (let index = 0; index < this.lights.length; index += 1) {
      const light = this.lights[index];
      const assignment = assignments[index];
      if (!assignment) {
        this.hideLight(light);
        continue;
      }
      light.position.set(
        assignment.x,
        assignment.y + WAYMARK_LIGHT_HEIGHT,
        assignment.z,
      );
      light.color.set(0xff7a2d);
      light.intensity = 2.15;
      light.distance = WAYMARK_LIGHT_RANGE;
      light.decay = 2;
      light.visible = true;
      light.userData.waymarkId = assignment.id;
    }
  }

  private writeMatrix(
    mesh: ComponentMesh,
    index: number,
    waymark: TorchWaymarkVisualInput,
    localX: number,
    localY: number,
    localZ: number,
    rotationX: number,
    rotationY: number,
    rotationZ: number,
    scaleX: number,
    scaleY: number,
    scaleZ: number,
  ): void {
    const cosine = Math.cos(waymark.yaw);
    const sine = Math.sin(waymark.yaw);
    this.dummy.position.set(
      waymark.x + localX * cosine + localZ * sine,
      waymark.y + localY,
      waymark.z - localX * sine + localZ * cosine,
    );
    this.dummy.rotation.order = "YXZ";
    this.dummy.rotation.set(
      rotationX,
      waymark.yaw + rotationY,
      rotationZ,
    );
    this.dummy.scale.set(scaleX, scaleY, scaleZ);
    this.dummy.updateMatrix();
    mesh.setMatrixAt(index, this.dummy.matrix);
  }

  private commitCount(name: ComponentName, nextCount: number): void {
    const mesh = this.meshes[name];
    const previousCount = this.previousCounts[name];
    for (let index = nextCount; index < previousCount; index += 1) {
      mesh.setMatrixAt(index, this.hiddenMatrix);
    }
    mesh.count = nextCount;
    mesh.instanceMatrix.needsUpdate = true;
    this.previousCounts[name] = nextCount;
  }

  private hideAllComponents(): void {
    for (const name of Object.keys(this.meshes) as ComponentName[]) {
      this.commitCount(name, 0);
    }
  }

  private hideLight(light: THREE.PointLight): void {
    light.visible = false;
    light.intensity = 0;
    light.userData.waymarkId = null;
  }
}

function validIdentity(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const id = (value as { id?: unknown }).id;
  if (
    typeof id !== "string" ||
    id.length === 0 ||
    id.trim() !== id ||
    id.length > TORCH_WAYMARK_LIGHT_ID_MAX_LENGTH
  ) {
    return null;
  }
  return id;
}

function isValidVisualInput(value: unknown): value is TorchWaymarkVisualInput {
  if (!validIdentity(value)) return false;
  const candidate = value as Partial<TorchWaymarkVisualInput>;
  return (
    Number.isFinite(candidate.x) &&
    Number.isFinite(candidate.y) &&
    Number.isFinite(candidate.z) &&
    Number.isFinite(candidate.yaw) &&
    typeof candidate.lit === "boolean" &&
    Number.isFinite(candidate.totalFuelSeconds) &&
    (candidate.totalFuelSeconds ?? -1) >= 0 &&
    Number.isSafeInteger(candidate.slotCount) &&
    (candidate.slotCount ?? -1) >= 0 &&
    (candidate.slotCount ?? TORCH_WAYMARK_MAX_FUEL_SLOTS + 1) <=
      TORCH_WAYMARK_MAX_FUEL_SLOTS &&
    ((candidate.slotCount === 0 && candidate.totalFuelSeconds === 0) ||
      ((candidate.slotCount ?? 0) > 0 &&
        (candidate.totalFuelSeconds ?? 0) > 0)) &&
    !(candidate.lit === true && candidate.slotCount === 0)
  );
}

function isValidObserver(
  observer: TorchWaymarkLightObserver | null | undefined,
): observer is TorchWaymarkLightObserver {
  return Boolean(
    observer && Number.isFinite(observer.x) && Number.isFinite(observer.z),
  );
}

function evaluateFrustum(
  predicate: TorchWaymarkFrustumPredicate | undefined,
  waymark: Readonly<TorchWaymarkVisualInput>,
): boolean {
  if (!predicate) return true;
  try {
    return predicate(waymark) === true;
  } catch {
    return false;
  }
}

function isBurning(
  waymark: Pick<TorchWaymarkVisualInput, "lit" | "totalFuelSeconds">,
): boolean {
  return waymark.lit && waymark.totalFuelSeconds > 0;
}

function compareForVisualBudget(
  left: RenderableWaymark,
  right: RenderableWaymark,
  observer: TorchWaymarkLightObserver | null,
): number {
  if (left.inFrustum !== right.inFrustum) return left.inFrustum ? -1 : 1;
  if (observer) {
    const distanceDelta =
      horizontalDistanceSquared(left, observer) -
      horizontalDistanceSquared(right, observer);
    if (distanceDelta !== 0) return distanceDelta;
  }
  return stableIdCompare(left.id, right.id);
}

function horizontalDistanceSquared(
  waymark: Pick<TorchWaymarkVisualInput, "x" | "z">,
  observer: TorchWaymarkLightObserver,
): number {
  const dx = waymark.x - observer.x;
  const dz = waymark.z - observer.z;
  return dx * dx + dz * dz;
}

function stableIdCompare(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
