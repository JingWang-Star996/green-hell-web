import * as THREE from "three";

/**
 * Code-native first-person torch asset. The gameplay item and burn state live
 * in simulation; this model only makes the equipped state visible.
 */
export function createHeldTorchModel(): THREE.Group {
  const group = new THREE.Group();
  group.name = "held-torch";
  const wood = new THREE.MeshStandardMaterial({
    color: 0x6a452c,
    roughness: 0.94,
  });
  const wrapMaterial = new THREE.MeshStandardMaterial({
    color: 0x55452c,
    roughness: 1,
    emissive: 0x6f2d0f,
    emissiveIntensity: 0.42,
  });
  const flameMaterial = new THREE.MeshBasicMaterial({
    color: 0xffb35d,
    transparent: true,
    opacity: 0.92,
  });

  const handle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.038, 0.056, 0.94, 7),
    wood,
  );
  handle.position.y = 0.04;
  handle.rotation.z = -0.12;
  const wrap = new THREE.Mesh(
    new THREE.CylinderGeometry(0.105, 0.082, 0.29, 7),
    wrapMaterial,
  );
  wrap.position.set(-0.055, 0.56, 0);
  wrap.rotation.z = -0.12;
  const flame = new THREE.Mesh(
    new THREE.SphereGeometry(0.13, 7, 5),
    flameMaterial,
  );
  flame.name = "held-torch-flame";
  flame.position.set(-0.09, 0.79, 0);
  flame.scale.set(0.9, 1.45, 0.9);
  group.add(handle, wrap, flame);
  return group;
}

export function updateHeldTorchFlame(
  flame: THREE.Object3D,
  elapsedSeconds: number,
  reducedMotion: boolean,
): void {
  const pulse = reducedMotion
    ? 1
    : 0.94 +
      Math.sin(elapsedSeconds * 13.7) * 0.04 +
      Math.sin(elapsedSeconds * 23.1) * 0.025;
  flame.scale.set(0.88 + pulse * 0.12, pulse * 1.45, 0.88 + pulse * 0.12);
}
