import * as THREE from "three";
import {
  createHeldTorchModel,
  updateHeldTorchFlame,
} from "./HeldTorchModel";

export type HeldItemKind =
  | "stone-blade"
  | "axe"
  | "stone-pick"
  | "spear"
  | "torch"
  | null;

/**
 * Camera-local first-person equipment. The simulation owns which item is
 * equipped; this class owns only presentation and a short, interrupt-safe
 * action animation.
 */
export class HeldItemRig {
  readonly root = new THREE.Group();
  private model: THREE.Group | null = null;
  private kind: HeldItemKind = null;
  private torchFlame: THREE.Object3D | null = null;
  private elapsed = 0;
  private swingElapsed = Number.POSITIVE_INFINITY;
  private readonly swingDuration = 0.34;

  constructor() {
    this.root.name = "first-person-held-item";
    this.applyIdlePose();
  }

  setKind(kind: HeldItemKind): void {
    if (kind === this.kind) return;
    if (this.model) {
      this.root.remove(this.model);
      disposeObject(this.model);
    }
    this.kind = kind;
    this.model = kind ? createHeldItem(kind) : null;
    this.torchFlame = this.model?.getObjectByName("held-torch-flame") ?? null;
    if (this.model) this.root.add(this.model);
    this.root.visible = Boolean(this.model);
    this.cancelUse();
  }

  getKind(): HeldItemKind {
    return this.kind;
  }

  playUse(): void {
    if (!this.model) return;
    this.swingElapsed = 0;
  }

  cancelUse(): void {
    this.swingElapsed = Number.POSITIVE_INFINITY;
    this.applyIdlePose();
  }

  update(
    delta: number,
    moving: boolean,
    sprinting: boolean,
    reducedMotion: boolean,
  ): void {
    this.elapsed += delta;
    this.swingElapsed += delta;
    if (!this.model) return;

    const pace = sprinting ? 10.5 : 7.2;
    const motionScale = reducedMotion ? 0.18 : 1;
    const stride = moving ? Math.sin(this.elapsed * pace) : Math.sin(this.elapsed * 1.7) * 0.2;
    const bob = moving ? Math.abs(Math.cos(this.elapsed * pace)) : Math.sin(this.elapsed * 1.25) * 0.15;
    let swing = 0;
    if (this.swingElapsed < this.swingDuration) {
      const progress = THREE.MathUtils.clamp(this.swingElapsed / this.swingDuration, 0, 1);
      swing = Math.sin(progress * Math.PI);
    }

    this.root.position.set(
      0.43 + stride * 0.018 * motionScale - swing * 0.1,
      -0.42 - bob * 0.016 * motionScale + swing * 0.08,
      -0.72 + swing * 0.08,
    );
    this.root.rotation.set(
      -0.08 - swing * 0.72,
      -0.08 - swing * 0.16,
      -0.08 + stride * 0.025 * motionScale - swing * 0.34,
    );
    if (this.torchFlame) {
      updateHeldTorchFlame(this.torchFlame, this.elapsed, reducedMotion);
    }
  }

  dispose(): void {
    if (this.model) disposeObject(this.model);
    this.model = null;
    this.torchFlame = null;
    this.root.clear();
  }

  private applyIdlePose(): void {
    this.root.position.set(0.43, -0.42, -0.72);
    this.root.rotation.set(-0.08, -0.08, -0.08);
  }
}

function createHeldItem(kind: Exclude<HeldItemKind, null>): THREE.Group {
  const group = new THREE.Group();
  group.name = `held-${kind}`;
  const wood = new THREE.MeshStandardMaterial({ color: 0x6a452c, roughness: 0.94 });
  const stone = new THREE.MeshStandardMaterial({ color: 0x626b68, roughness: 0.72, metalness: 0.08 });
  const cord = new THREE.MeshStandardMaterial({ color: 0x8a7447, roughness: 1 });
  const skin = new THREE.MeshStandardMaterial({ color: 0x8a6045, roughness: 0.95 });

  const hand = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.19, 0.2), skin);
  hand.position.set(0.01, -0.3, 0.04);
  hand.rotation.set(0.18, 0.08, -0.12);
  group.add(hand);

  if (kind === "axe") {
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.048, 0.92, 7), wood);
    handle.position.y = 0.08;
    handle.rotation.z = -0.16;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.18, 0.11), stone);
    head.position.set(-0.065, 0.52, 0);
    head.rotation.z = -0.16;
    const binding = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.058, 0.2, 7), cord);
    binding.position.set(0.075, 0.42, 0);
    binding.rotation.z = -0.16;
    group.add(handle, head, binding);
  } else if (kind === "stone-pick") {
    const handle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.032, 0.046, 0.94, 7),
      wood,
    );
    handle.position.y = 0.07;
    handle.rotation.z = -0.14;
    const head = new THREE.Mesh(
      new THREE.ConeGeometry(0.11, 0.5, 4),
      stone,
    );
    head.position.set(-0.03, 0.57, 0);
    head.rotation.z = -Math.PI / 2 - 0.14;
    head.scale.set(0.72, 1, 0.72);
    const counterWeight = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.13, 0.11),
      stone,
    );
    counterWeight.position.set(0.13, 0.53, 0);
    counterWeight.rotation.z = -0.14;
    const binding = new THREE.Mesh(
      new THREE.CylinderGeometry(0.056, 0.056, 0.22, 7),
      cord,
    );
    binding.position.set(0.065, 0.43, 0);
    binding.rotation.z = -0.14;
    group.add(handle, head, counterWeight, binding);
  } else if (kind === "spear") {
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.034, 1.68, 7), wood);
    shaft.position.y = 0.36;
    shaft.rotation.z = -0.32;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.34, 4), stone);
    tip.position.set(-0.28, 1.19, 0);
    tip.rotation.z = 0.32;
    const binding = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.22, 7), cord);
    binding.position.set(-0.235, 1.02, 0);
    binding.rotation.z = -0.32;
    group.add(shaft, tip, binding);
  } else if (kind === "torch") {
    group.add(createHeldTorchModel());
  } else {
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.052, 0.34, 7), wood);
    grip.position.y = -0.08;
    grip.rotation.z = -0.18;
    const blade = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.48, 4), stone);
    blade.position.set(-0.055, 0.32, 0);
    blade.rotation.z = 0.18;
    const binding = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.058, 0.14, 7), cord);
    binding.position.set(0.035, 0.12, 0);
    binding.rotation.z = -0.18;
    group.add(grip, blade, binding);
  }

  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.castShadow = false;
    object.receiveShadow = false;
    object.renderOrder = 20;
    object.material.depthTest = false;
    object.material.depthWrite = false;
  });
  return group;
}

function disposeObject(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => material.dispose());
  });
}
