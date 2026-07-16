import * as THREE from "three";
import {
  RAIN_COLLECTOR_LAYOUT,
  TORCH_WAYMARK_LAYOUT,
} from "../sim/structureGeometry";

export type PlaceableStructureKind =
  | "campfire"
  | "shelter"
  | "bed"
  | "radio-beacon"
  | "smoking-rack"
  | "rain-collector"
  | "torch-waymark";

export type PlacementPreviewStatus = "valid-high" | "valid-low" | "invalid";

/** A code-native placement ghost shared by mouse and touch placement flows. */
export class PlacementPreview {
  readonly root = new THREE.Group();
  private kind: PlaceableStructureKind | null = null;
  private status: PlacementPreviewStatus = "valid-high";

  constructor() {
    this.root.name = "structure-placement-preview";
    this.root.visible = false;
  }

  setKind(kind: PlaceableStructureKind | null): void {
    if (kind === this.kind) return;
    disposeChildren(this.root);
    this.root.clear();
    this.kind = kind;
    this.root.visible = Boolean(kind);
    if (kind) this.root.add(createGhost(kind));
    this.setStatus(this.status);
  }

  getKind(): PlaceableStructureKind | null {
    return this.kind;
  }

  setTransform(x: number, y: number, z: number): void {
    this.root.position.set(x, y, z);
  }

  rotateQuarterTurn(): void {
    this.root.rotation.y += Math.PI / 4;
  }

  getYaw(): number {
    return this.root.rotation.y;
  }

  setValid(valid: boolean): void {
    this.setStatus(valid ? "valid-high" : "invalid");
  }

  setStatus(status: PlacementPreviewStatus): void {
    this.status = status;
    const color =
      status === "invalid"
        ? 0xef655b
        : status === "valid-low"
          ? 0xe9a94a
          : 0x7ddc78;
    this.root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (material instanceof THREE.MeshBasicMaterial) material.color.setHex(color);
      }
    });
  }

  isValid(): boolean {
    return this.status !== "invalid";
  }

  getStatus(): PlacementPreviewStatus {
    return this.status;
  }

  dispose(): void {
    disposeChildren(this.root);
    this.root.clear();
  }
}

function previewMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: 0x7ddc78,
    transparent: true,
    opacity: 0.48,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

function createGhost(kind: PlaceableStructureKind): THREE.Group {
  const group = new THREE.Group();
  const add = (geometry: THREE.BufferGeometry, position: readonly [number, number, number]) => {
    const mesh = new THREE.Mesh(geometry, previewMaterial());
    mesh.position.set(...position);
    group.add(mesh);
    return mesh;
  };
  if (kind === "campfire") {
    for (let index = 0; index < 8; index += 1) {
      const angle = (index / 8) * Math.PI * 2;
      add(new THREE.DodecahedronGeometry(0.14, 0), [Math.cos(angle) * 0.46, 0.13, Math.sin(angle) * 0.46]);
    }
    const logA = add(new THREE.CylinderGeometry(0.08, 0.1, 1.05, 6), [0, 0.2, 0]);
    logA.rotation.z = Math.PI / 2;
    logA.rotation.y = 0.6;
    const logB = add(new THREE.CylinderGeometry(0.08, 0.1, 1.05, 6), [0, 0.22, 0]);
    logB.rotation.z = Math.PI / 2;
    logB.rotation.y = -0.6;
  } else if (kind === "shelter") {
    for (const x of [-1.25, 1.25]) {
      add(new THREE.CylinderGeometry(0.07, 0.1, 2.35, 6), [x, 1.18, 0]);
    }
    const roof = add(new THREE.PlaneGeometry(3.3, 3), [0, 2.05, 0.45]);
    roof.rotation.x = -1.08;
  } else if (kind === "bed") {
    const bed = add(new THREE.BoxGeometry(2.2, 0.18, 0.95), [0, 0.12, 0]);
    bed.rotation.y = Math.PI / 2;
  } else if (kind === "smoking-rack") {
    for (const x of [-0.72, 0.72]) {
      const leg = add(new THREE.CylinderGeometry(0.055, 0.075, 1.45, 6), [x, 0.72, 0]);
      leg.rotation.z = x < 0 ? -0.08 : 0.08;
    }
    const rail = add(new THREE.CylinderGeometry(0.045, 0.055, 1.65, 6), [0, 1.36, 0]);
    rail.rotation.z = Math.PI / 2;
  } else if (kind === "rain-collector") {
    for (const leg of RAIN_COLLECTOR_LAYOUT.legPositions) {
      add(
        new THREE.CylinderGeometry(
          RAIN_COLLECTOR_LAYOUT.legRadius * 0.78,
          RAIN_COLLECTOR_LAYOUT.legRadius,
          RAIN_COLLECTOR_LAYOUT.frameHeight,
          6,
        ),
        [leg.x, RAIN_COLLECTOR_LAYOUT.frameHeight / 2, leg.z],
      );
    }
    for (const z of [-0.47, 0.47]) {
      const rail = add(
        new THREE.CylinderGeometry(0.045, 0.055, RAIN_COLLECTOR_LAYOUT.width, 6),
        [0, RAIN_COLLECTOR_LAYOUT.frameHeight, z],
      );
      rail.rotation.z = Math.PI / 2;
    }
    for (const x of [-0.47, 0.47]) {
      const leaf = add(new THREE.PlaneGeometry(0.78, 1.02), [x, 1.05, 0]);
      leaf.rotation.set(-Math.PI / 2, 0, x < 0 ? -0.28 : 0.28);
    }
    add(new THREE.CylinderGeometry(0.34, 0.28, 0.18, 10), [0, 0.74, 0]);
  } else if (kind === "torch-waymark") {
    const layout = TORCH_WAYMARK_LAYOUT;
    for (let index = 0; index < 3; index += 1) {
      const angle = (index / 3) * Math.PI * 2 + 0.18;
      const stone = add(
        new THREE.DodecahedronGeometry(layout.stoneBaseRadius * 0.62, 0),
        [
          Math.cos(angle) * layout.stoneBaseRadius * 0.52,
          layout.stoneBaseRadius * 0.22,
          Math.sin(angle) * layout.stoneBaseRadius * 0.52,
        ],
      );
      stone.name = "torch-waymark-preview-stone";
      stone.scale.set(1, 0.62, 0.84);
      stone.rotation.y = angle;
    }
    const pole = add(
      new THREE.CylinderGeometry(
        layout.stoneBaseRadius * 0.1,
        layout.stoneBaseRadius * 0.13,
        layout.poleHeight,
        6,
      ),
      [0, layout.poleHeight / 2, 0],
    );
    pole.name = "torch-waymark-preview-pole";
    const crosspiece = add(
      new THREE.CylinderGeometry(
        layout.stoneBaseRadius * 0.075,
        layout.stoneBaseRadius * 0.09,
        layout.stoneBaseRadius * 1.55,
        6,
      ),
      [0, layout.poleHeight * 0.78, 0],
    );
    crosspiece.name = "torch-waymark-preview-crosspiece";
    crosspiece.rotation.z = Math.PI / 2;
    const head = add(
      new THREE.CylinderGeometry(
        layout.stoneBaseRadius * 0.15,
        layout.stoneBaseRadius * 0.19,
        layout.poleHeight * 0.17,
        6,
      ),
      [0, layout.poleHeight * 0.96, 0],
    );
    head.name = "torch-waymark-preview-torch-slot";
    const reserve = add(
      new THREE.CylinderGeometry(
        layout.stoneBaseRadius * 0.065,
        layout.stoneBaseRadius * 0.08,
        layout.poleHeight * 0.31,
        6,
      ),
      [layout.stoneBaseRadius * 0.42, layout.poleHeight * 0.64, 0],
    );
    reserve.name = "torch-waymark-preview-reserve-slot";
    reserve.rotation.z = -0.13;
  } else {
    add(new THREE.CylinderGeometry(0.05, 0.09, 4.8, 6), [0, 2.4, 0]);
    const arm = add(new THREE.CylinderGeometry(0.025, 0.025, 1.6, 5), [0, 4.25, 0]);
    arm.rotation.z = Math.PI / 2;
  }
  return group;
}

function disposeChildren(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => material.dispose());
  });
}
