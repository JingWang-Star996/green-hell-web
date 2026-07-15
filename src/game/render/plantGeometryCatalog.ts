import * as THREE from "three";

export const RESOURCE_PLANT_GEOMETRY_SPECIES = [
  "medicinal-broadleaf",
  "antiparasitic-herb",
  "fiber-vine",
  "palm-fruit-shrub",
] as const;

export type ResourcePlantGeometrySpecies =
  (typeof RESOURCE_PLANT_GEOMETRY_SPECIES)[number];

export type ResourcePlantGeometryFamily =
  | "broadleaf-rosette"
  | "feathery-ground-herb"
  | "vertical-vine-ribbon"
  | "branched-fruit-shrub";

export interface PlantGeometryCatalogEntry {
  species: ResourcePlantGeometrySpecies;
  family: ResourcePlantGeometryFamily;
  /** Caller-owned geometry suitable for one shared InstancedMesh family. */
  geometry: THREE.BufferGeometry;
  /** Local-space focus height before instance scale is applied. */
  anchorHeight: number;
  /** Conservative local-space XZ interaction/collider radius. */
  footprint: number;
}

type Vertex = readonly [x: number, y: number, z: number];

class GeometryBuilder {
  readonly positions: number[] = [];
  readonly indices: number[] = [];

  addTriangle(a: Vertex, b: Vertex, c: Vertex): void {
    const offset = this.positions.length / 3;
    this.positions.push(...a, ...b, ...c);
    this.indices.push(offset, offset + 1, offset + 2);
  }

  addQuad(a: Vertex, b: Vertex, c: Vertex, d: Vertex): void {
    const offset = this.positions.length / 3;
    this.positions.push(...a, ...b, ...c, ...d);
    this.indices.push(
      offset,
      offset + 1,
      offset + 2,
      offset,
      offset + 2,
      offset + 3,
    );
  }

  build(name: string, family: ResourcePlantGeometryFamily): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.name = name;
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(this.positions, 3),
    );
    geometry.setIndex(this.indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    geometry.userData.family = family;
    return geometry;
  }
}

function radialPoint(
  angle: number,
  distance: number,
  height: number,
  lateral = 0,
): Vertex {
  const directionX = Math.cos(angle);
  const directionZ = Math.sin(angle);
  const sideX = -directionZ;
  const sideZ = directionX;
  return [
    directionX * distance + sideX * lateral,
    height,
    directionZ * distance + sideZ * lateral,
  ];
}

/** Eight broad, ground-hugging leaves with a readable pale-vein cross shape. */
function createBroadleafRosetteGeometry(): THREE.BufferGeometry {
  const builder = new GeometryBuilder();
  const leafCount = 8;
  for (let index = 0; index < leafCount; index += 1) {
    const angle = (index / leafCount) * Math.PI * 2 + (index % 2) * 0.07;
    const root = radialPoint(angle, 0.04, 0.08);
    const innerLeft = radialPoint(angle, 0.24, 0.14, 0.13);
    const broadLeft = radialPoint(angle, 0.53, 0.24, 0.21);
    const tip = radialPoint(angle, 0.82, 0.1);
    const broadRight = radialPoint(angle, 0.53, 0.24, -0.21);
    const innerRight = radialPoint(angle, 0.24, 0.14, -0.13);
    builder.addTriangle(root, innerLeft, broadLeft);
    builder.addTriangle(root, broadLeft, tip);
    builder.addTriangle(root, tip, broadRight);
    builder.addTriangle(root, broadRight, innerRight);
  }
  const center: Vertex = [0, 0.09, 0];
  for (let index = 0; index < leafCount; index += 1) {
    const angleA = (index / leafCount) * Math.PI * 2;
    const angleB = ((index + 1) / leafCount) * Math.PI * 2;
    builder.addTriangle(
      center,
      radialPoint(angleA, 0.17, 0.12),
      radialPoint(angleB, 0.17, 0.12),
    );
  }
  return builder.build(
    "plant-geometry-medicinal-broadleaf",
    "broadleaf-rosette",
  );
}

/** Low radial fronds with paired triangular leaflets and a small flower crown. */
function createFeatheryGroundHerbGeometry(): THREE.BufferGeometry {
  const builder = new GeometryBuilder();
  const frondCount = 5;
  for (let frond = 0; frond < frondCount; frond += 1) {
    const angle = (frond / frondCount) * Math.PI * 2 + 0.18;
    const directionX = Math.cos(angle);
    const directionZ = Math.sin(angle);
    const sideX = -directionZ;
    const sideZ = directionX;
    const root: Vertex = [directionX * 0.03, 0.06, directionZ * 0.03];
    const end: Vertex = [directionX * 0.55, 0.48, directionZ * 0.55];
    builder.addQuad(
      [root[0] + sideX * 0.025, root[1], root[2] + sideZ * 0.025],
      [end[0] + sideX * 0.018, end[1], end[2] + sideZ * 0.018],
      [end[0] - sideX * 0.018, end[1], end[2] - sideZ * 0.018],
      [root[0] - sideX * 0.025, root[1], root[2] - sideZ * 0.025],
    );
    for (let leaflet = 1; leaflet <= 4; leaflet += 1) {
      const progress = leaflet / 5;
      const centerX = root[0] + (end[0] - root[0]) * progress;
      const centerY = root[1] + (end[1] - root[1]) * progress;
      const centerZ = root[2] + (end[2] - root[2]) * progress;
      const reach = 0.13 - leaflet * 0.012;
      const back = 0.055;
      const center: Vertex = [centerX, centerY, centerZ];
      builder.addTriangle(
        center,
        [
          centerX - directionX * back,
          centerY - 0.025,
          centerZ - directionZ * back,
        ],
        [centerX + sideX * reach, centerY + 0.035, centerZ + sideZ * reach],
      );
      builder.addTriangle(
        center,
        [centerX - sideX * reach, centerY + 0.035, centerZ - sideZ * reach],
        [
          centerX - directionX * back,
          centerY - 0.025,
          centerZ - directionZ * back,
        ],
      );
    }
  }
  const crownY = 0.61;
  for (let petal = 0; petal < 6; petal += 1) {
    const angleA = (petal / 6) * Math.PI * 2;
    const angleB = ((petal + 1) / 6) * Math.PI * 2;
    builder.addTriangle(
      [0, crownY + 0.03, 0],
      [Math.cos(angleA) * 0.16, crownY, Math.sin(angleA) * 0.16],
      [Math.cos(angleB) * 0.16, crownY, Math.sin(angleB) * 0.16],
    );
  }
  return builder.build(
    "plant-geometry-antiparasitic-herb",
    "feathery-ground-herb",
  );
}

/** A tall helical ribbon; width alternates slightly to avoid a pole silhouette. */
function createVerticalVineRibbonGeometry(): THREE.BufferGeometry {
  const builder = new GeometryBuilder();
  const segments = 20;
  const turns = 1.65;
  for (let index = 0; index < segments; index += 1) {
    const progressA = index / segments;
    const progressB = (index + 1) / segments;
    const angleA = progressA * Math.PI * 2 * turns;
    const angleB = progressB * Math.PI * 2 * turns;
    const radiusA = 0.2 + Math.sin(progressA * Math.PI) * 0.1;
    const radiusB = 0.2 + Math.sin(progressB * Math.PI) * 0.1;
    const halfWidthA = 0.055 + (index % 2) * 0.012;
    const halfWidthB = 0.055 + ((index + 1) % 2) * 0.012;
    const centerA: Vertex = [
      Math.cos(angleA) * radiusA,
      progressA * 2.2,
      Math.sin(angleA) * radiusA,
    ];
    const centerB: Vertex = [
      Math.cos(angleB) * radiusB,
      progressB * 2.2,
      Math.sin(angleB) * radiusB,
    ];
    const sideA: Vertex = [
      -Math.sin(angleA) * halfWidthA,
      0,
      Math.cos(angleA) * halfWidthA,
    ];
    const sideB: Vertex = [
      -Math.sin(angleB) * halfWidthB,
      0,
      Math.cos(angleB) * halfWidthB,
    ];
    builder.addQuad(
      [centerA[0] + sideA[0], centerA[1], centerA[2] + sideA[2]],
      [centerB[0] + sideB[0], centerB[1], centerB[2] + sideB[2]],
      [centerB[0] - sideB[0], centerB[1], centerB[2] - sideB[2]],
      [centerA[0] - sideA[0], centerA[1], centerA[2] - sideA[2]],
    );
  }
  // Three short loose fiber ends make the upper silhouette forked, not conical.
  for (let fork = 0; fork < 3; fork += 1) {
    const angle = (fork / 3) * Math.PI * 2;
    const root: Vertex = [Math.cos(angle) * 0.16, 1.82, Math.sin(angle) * 0.16];
    const tip: Vertex = [Math.cos(angle) * 0.42, 2.05, Math.sin(angle) * 0.42];
    const sideX = -Math.sin(angle) * 0.035;
    const sideZ = Math.cos(angle) * 0.035;
    builder.addQuad(
      [root[0] + sideX, root[1], root[2] + sideZ],
      [tip[0] + sideX * 0.35, tip[1], tip[2] + sideZ * 0.35],
      [tip[0] - sideX * 0.35, tip[1], tip[2] - sideZ * 0.35],
      [root[0] - sideX, root[1], root[2] - sideZ],
    );
  }
  return builder.build("plant-geometry-fiber-vine", "vertical-vine-ribbon");
}

function addCrossedBranch(
  builder: GeometryBuilder,
  root: Vertex,
  tip: Vertex,
  width: number,
): void {
  builder.addQuad(
    [root[0] - width, root[1], root[2]],
    [tip[0] - width * 0.45, tip[1], tip[2]],
    [tip[0] + width * 0.45, tip[1], tip[2]],
    [root[0] + width, root[1], root[2]],
  );
  builder.addQuad(
    [root[0], root[1], root[2] - width],
    [tip[0], tip[1], tip[2] - width * 0.45],
    [tip[0], tip[1], tip[2] + width * 0.45],
    [root[0], root[1], root[2] + width],
  );
}

function addDiamondLeaf(
  builder: GeometryBuilder,
  center: Vertex,
  angle: number,
  length: number,
  width: number,
): void {
  const directionX = Math.cos(angle);
  const directionZ = Math.sin(angle);
  const sideX = -directionZ;
  const sideZ = directionX;
  builder.addQuad(
    [
      center[0] - directionX * length * 0.45,
      center[1] - 0.025,
      center[2] - directionZ * length * 0.45,
    ],
    [center[0] + sideX * width, center[1] + 0.04, center[2] + sideZ * width],
    [
      center[0] + directionX * length * 0.55,
      center[1],
      center[2] + directionZ * length * 0.55,
    ],
    [center[0] - sideX * width, center[1] + 0.04, center[2] - sideZ * width],
  );
}

function addTetraFruit(
  builder: GeometryBuilder,
  center: Vertex,
  radius: number,
): void {
  const top: Vertex = [center[0], center[1] + radius, center[2]];
  const a: Vertex = [center[0] + radius, center[1] - radius * 0.55, center[2]];
  const b: Vertex = [
    center[0] - radius * 0.5,
    center[1] - radius * 0.55,
    center[2] + radius * 0.866,
  ];
  const c: Vertex = [
    center[0] - radius * 0.5,
    center[1] - radius * 0.55,
    center[2] - radius * 0.866,
  ];
  builder.addTriangle(top, a, b);
  builder.addTriangle(top, b, c);
  builder.addTriangle(top, c, a);
  builder.addTriangle(a, c, b);
}

/** Five forked stems, broad leaves and hanging low-poly fruit clusters. */
function createBranchedFruitShrubGeometry(): THREE.BufferGeometry {
  const builder = new GeometryBuilder();
  const branchCount = 5;
  for (let branch = 0; branch < branchCount; branch += 1) {
    const angle = (branch / branchCount) * Math.PI * 2 + 0.12;
    const distance = branch === 0 ? 0.18 : 0.48 + (branch % 2) * 0.08;
    const root: Vertex = [0, 0.03, 0];
    const tip: Vertex = [
      Math.cos(angle) * distance,
      branch === 0 ? 1.36 : 0.92 + (branch % 2) * 0.18,
      Math.sin(angle) * distance,
    ];
    addCrossedBranch(builder, root, tip, branch === 0 ? 0.07 : 0.045);
    addDiamondLeaf(builder, tip, angle + 0.38, 0.48, 0.16);
    addDiamondLeaf(
      builder,
      [tip[0] * 0.72, tip[1] * 0.78, tip[2] * 0.72],
      angle - 0.72,
      0.4,
      0.14,
    );
    if (branch !== 0) {
      addTetraFruit(
        builder,
        [tip[0] * 0.88, tip[1] - 0.16, tip[2] * 0.88],
        0.1,
      );
    }
  }
  addTetraFruit(builder, [0.08, 1.13, 0.02], 0.115);
  return builder.build(
    "plant-geometry-palm-fruit-shrub",
    "branched-fruit-shrub",
  );
}

const METADATA = {
  "medicinal-broadleaf": {
    family: "broadleaf-rosette",
    anchorHeight: 0.22,
    footprint: 0.84,
    create: createBroadleafRosetteGeometry,
  },
  "antiparasitic-herb": {
    family: "feathery-ground-herb",
    anchorHeight: 0.36,
    footprint: 0.66,
    create: createFeatheryGroundHerbGeometry,
  },
  "fiber-vine": {
    family: "vertical-vine-ribbon",
    anchorHeight: 1.05,
    footprint: 0.44,
    create: createVerticalVineRibbonGeometry,
  },
  "palm-fruit-shrub": {
    family: "branched-fruit-shrub",
    anchorHeight: 0.72,
    footprint: 0.84,
    create: createBranchedFruitShrubGeometry,
  },
} as const satisfies Readonly<
  Record<
    ResourcePlantGeometrySpecies,
    Readonly<{
      family: ResourcePlantGeometryFamily;
      anchorHeight: number;
      footprint: number;
      create: () => THREE.BufferGeometry;
    }>
  >
>;

function isResourcePlantGeometrySpecies(
  species: string,
): species is ResourcePlantGeometrySpecies {
  return Object.prototype.hasOwnProperty.call(METADATA, species);
}

/** Returns a fresh caller-owned geometry; unsupported species fail closed. */
export function createPlantGeometryCatalogEntry(
  species: string,
): PlantGeometryCatalogEntry | null {
  if (!isResourcePlantGeometrySpecies(species)) return null;
  const metadata = METADATA[species];
  const geometry = metadata.create();
  geometry.userData.species = species;
  return {
    species,
    family: metadata.family,
    geometry,
    anchorHeight: metadata.anchorHeight,
    footprint: metadata.footprint,
  };
}
