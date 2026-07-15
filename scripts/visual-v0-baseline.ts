import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  generateChunkDescriptor,
  worldToChunkCoordinate,
  type WorldVisualDetail,
} from "../src/game/world/generation";
import { generateSemanticChunkPlan } from "../src/game/world/semanticGeneration";
import {
  riverDistance,
  terrainHeight,
} from "../src/game/world/terrain";
import {
  createVisualWorldAudit,
  type VisualWorldAuditOptions,
} from "./visual-world-audit";

export const VISUAL_V0_PROTOCOL_VERSION = "canopy-visual-v0-static-v1";
export const VISUAL_V0_SCHEMA_VERSION = 1 as const;

export type VisualV0CameraFixture = Readonly<{
  id: string;
  label: string;
  x: number;
  z: number;
  yawRadians: number;
  pitchRadians: number;
  timeMinute: number;
  weatherPhase: "clear" | "heavy-rain" | "post-rain";
  rainIntensity: number;
}>;

export type VisualV0Profile = Readonly<{
  id: "standard-1080p" | "low-720p";
  viewport: Readonly<{ width: number; height: number; dpr: number }>;
  detail: WorldVisualDetail;
  activeRadius: number;
  gridRadius: number;
  semanticShadowsExpected: boolean;
}>;

type RoutePoint = Readonly<{
  atSeconds: number;
  x: number;
  z: number;
  yawRadians: number;
  pitchRadians: number;
  event?: string;
}>;

export type VisualV0RouteFixture = Readonly<{
  id: "S0" | "S1" | "S2" | "S3" | "S4";
  label: string;
  durationSeconds: number;
  purpose: string;
  state: Readonly<{
    timeMinute: number;
    rainIntensity: number;
    buildingCount: number;
    localLightCount: number;
    ecologyLoad: "baseline" | "maximum-supported";
  }>;
  points: readonly RoutePoint[];
}>;

export const VISUAL_V0_SEEDS = Object.freeze(
  Array.from({ length: 20 }, (_, index) => String(index + 1)),
);

export const VISUAL_V0_CAMERAS: readonly VisualV0CameraFixture[] =
  Object.freeze([
    {
      id: "C00-spawn-clear",
      label: "出生点正午晴",
      x: 0,
      z: 5,
      yawRadians: 3.141593,
      pitchRadians: -0.05,
      timeMinute: 720,
      weatherPhase: "clear",
      rainIntensity: 0.05,
    },
    {
      id: "C01-spawn-backlook",
      label: "出生点反向林下",
      x: 0,
      z: -4,
      yawRadians: 0,
      pitchRadians: -0.03,
      timeMinute: 720,
      weatherPhase: "clear",
      rainIntensity: 0.05,
    },
    {
      id: "C02-river-west-bank",
      label: "河道西岸",
      x: -28,
      z: -15,
      yawRadians: 1.570796,
      pitchRadians: -0.06,
      timeMinute: 720,
      weatherPhase: "clear",
      rainIntensity: 0.08,
    },
    {
      id: "C03-river-east-bank",
      label: "河道东岸",
      x: 28,
      z: -19,
      yawRadians: -1.570796,
      pitchRadians: -0.06,
      timeMinute: 720,
      weatherPhase: "post-rain",
      rainIntensity: 0.22,
    },
    {
      id: "C04-ridge-approach",
      label: "岩脊上坡",
      x: 29,
      z: -23,
      yawRadians: 2.356194,
      pitchRadians: -0.04,
      timeMinute: 780,
      weatherPhase: "clear",
      rainIntensity: 0.06,
    },
    {
      id: "C05-ridge-overlook",
      label: "岩脊远眺",
      x: 39,
      z: -31,
      yawRadians: -0.785398,
      pitchRadians: -0.12,
      timeMinute: 780,
      weatherPhase: "clear",
      rainIntensity: 0.06,
    },
    {
      id: "C06-station-approach",
      label: "气象站接近",
      x: 20,
      z: 20,
      yawRadians: -2.356194,
      pitchRadians: -0.04,
      timeMinute: 840,
      weatherPhase: "post-rain",
      rainIntensity: 0.18,
    },
    {
      id: "C07-station-plateau",
      label: "气象站高地",
      x: 33,
      z: 27,
      yawRadians: 0.785398,
      pitchRadians: -0.08,
      timeMinute: 840,
      weatherPhase: "clear",
      rainIntensity: 0.08,
    },
    {
      id: "C08-understory-rain",
      label: "林下强雨",
      x: -35,
      z: 28,
      yawRadians: 2.8,
      pitchRadians: -0.02,
      timeMinute: 900,
      weatherPhase: "heavy-rain",
      rainIntensity: 0.9,
    },
    {
      id: "C09-forest-dusk",
      label: "林缘黄昏",
      x: 18,
      z: 39,
      yawRadians: 1.2,
      pitchRadians: -0.05,
      timeMinute: 1090,
      weatherPhase: "clear",
      rainIntensity: 0.1,
    },
    {
      id: "C10-river-night",
      label: "河岸夜间",
      x: 8,
      z: -14,
      yawRadians: -2.2,
      pitchRadians: -0.03,
      timeMinute: 1320,
      weatherPhase: "clear",
      rainIntensity: 0.08,
    },
    {
      id: "C11-route-night-rain",
      label: "夜间雨路",
      x: -12,
      z: 12,
      yawRadians: 3.141593,
      pitchRadians: -0.02,
      timeMinute: 1260,
      weatherPhase: "heavy-rain",
      rainIntensity: 0.86,
    },
  ] satisfies readonly VisualV0CameraFixture[]);

export const VISUAL_V0_PROFILES: readonly VisualV0Profile[] = Object.freeze([
  {
    id: "standard-1080p",
    viewport: { width: 1920, height: 1080, dpr: 1 },
    detail: "standard",
    activeRadius: 2,
    gridRadius: 20,
    semanticShadowsExpected: true,
  },
  {
    id: "low-720p",
    viewport: { width: 1280, height: 720, dpr: 1 },
    detail: "low",
    activeRadius: 1,
    gridRadius: 20,
    semanticShadowsExpected: false,
  },
]);

function crossingPoints(): readonly RoutePoint[] {
  const outbound = Array.from({ length: 11 }, (_, index) => ({
    atSeconds: index * 4.5,
    x: index * 48,
    z: 5 + Math.sin(index * 0.7) * 8,
    yawRadians: 1.570796,
    pitchRadians: -0.04,
    event: index === 0 ? "route-start" : `outbound-chunk-${index}`,
  }));
  const inbound = Array.from({ length: 10 }, (_, offset) => {
    const index = 9 - offset;
    return {
      atSeconds: 49.5 + offset * 4.5,
      x: index * 48,
      z: 5 + Math.sin(index * 0.7) * 8,
      yawRadians: -1.570796,
      pitchRadians: -0.04,
      event: index === 0 ? "route-return" : `inbound-chunk-${index}`,
    };
  });
  return [...outbound, ...inbound];
}

export const VISUAL_V0_ROUTES: readonly VisualV0RouteFixture[] = Object.freeze([
  {
    id: "S0",
    label: "forest-still",
    durationSeconds: 90,
    purpose: "Fixed forest camera; no player input after settling.",
    state: {
      timeMinute: 720,
      rainIntensity: 0.05,
      buildingCount: 0,
      localLightCount: 0,
      ecologyLoad: "baseline",
    },
    points: [
      { atSeconds: 0, x: 0, z: 5, yawRadians: 3.141593, pitchRadians: -0.05 },
      { atSeconds: 90, x: 0, z: 5, yawRadians: 3.141593, pitchRadians: -0.05 },
    ],
  },
  {
    id: "S1",
    label: "crossing",
    durationSeconds: 94.5,
    purpose: "Cross ten chunk widths and return along the same deterministic path.",
    state: {
      timeMinute: 780,
      rainIntensity: 0.12,
      buildingCount: 0,
      localLightCount: 0,
      ecologyLoad: "baseline",
    },
    points: crossingPoints(),
  },
  {
    id: "S2",
    label: "camp-50",
    durationSeconds: 90,
    purpose: "Orbit the fixed 50-building camp fixture with three local lights.",
    state: {
      timeMinute: 1260,
      rainIntensity: 0.18,
      buildingCount: 50,
      localLightCount: 3,
      ecologyLoad: "baseline",
    },
    points: [
      { atSeconds: 0, x: 0, z: 17, yawRadians: 3.141593, pitchRadians: -0.04 },
      { atSeconds: 22.5, x: 12, z: 5, yawRadians: -1.570796, pitchRadians: -0.04 },
      { atSeconds: 45, x: 0, z: -7, yawRadians: 0, pitchRadians: -0.04 },
      { atSeconds: 67.5, x: -12, z: 5, yawRadians: 1.570796, pitchRadians: -0.04 },
      { atSeconds: 90, x: 0, z: 17, yawRadians: 3.141593, pitchRadians: -0.04 },
    ],
  },
  {
    id: "S3",
    label: "ecology",
    durationSeconds: 90,
    purpose: "Maximum supported ecology/carcass/drop load with one fixed combat beat.",
    state: {
      timeMinute: 900,
      rainIntensity: 0.24,
      buildingCount: 0,
      localLightCount: 0,
      ecologyLoad: "maximum-supported",
    },
    points: [
      { atSeconds: 0, x: -18, z: 6, yawRadians: 1.3, pitchRadians: -0.03 },
      { atSeconds: 30, x: -6, z: 2, yawRadians: 1.1, pitchRadians: -0.06, event: "combat" },
      { atSeconds: 60, x: 8, z: -2, yawRadians: 1.35, pitchRadians: -0.08, event: "collect" },
      { atSeconds: 90, x: 18, z: -5, yawRadians: 1.5, pitchRadians: -0.03 },
    ],
  },
  {
    id: "S4",
    label: "weather-night",
    durationSeconds: 90,
    purpose: "One fixed camera with clear, heavy-rain, post-rain, dusk, and night marks.",
    state: {
      timeMinute: 720,
      rainIntensity: 0.05,
      buildingCount: 0,
      localLightCount: 1,
      ecologyLoad: "baseline",
    },
    points: [
      { atSeconds: 0, x: 8, z: -14, yawRadians: -2.2, pitchRadians: -0.03, event: "clear-noon" },
      { atSeconds: 18, x: 8, z: -14, yawRadians: -2.2, pitchRadians: -0.03, event: "heavy-rain" },
      { atSeconds: 36, x: 8, z: -14, yawRadians: -2.2, pitchRadians: -0.03, event: "post-rain" },
      { atSeconds: 54, x: 8, z: -14, yawRadians: -2.2, pitchRadians: -0.03, event: "dusk" },
      { atSeconds: 72, x: 8, z: -14, yawRadians: -2.2, pitchRadians: -0.03, event: "night" },
      { atSeconds: 90, x: 8, z: -14, yawRadians: -2.2, pitchRadians: -0.03, event: "route-end" },
    ],
  },
]);

export type VisualV0BaselineOptions = Readonly<{
  sourceRevision?: string | null;
  productionBuildHash?: string | null;
}>;

function rounded(value: number): number {
  return Number(value.toFixed(6));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

export function stableJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function sha256(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function cameraObservation(seed: string, camera: VisualV0CameraFixture) {
  const coordinate = worldToChunkCoordinate(camera.x, camera.z);
  const descriptor = generateChunkDescriptor(seed, coordinate);
  const plan = generateSemanticChunkPlan(seed, coordinate);
  const categoryCounts: Record<string, number> = {};
  for (const object of plan.objects) {
    categoryCounts[object.category] = (categoryCounts[object.category] ?? 0) + 1;
  }
  const groundY = terrainHeight(camera.x, camera.z);
  return {
    seed,
    cameraId: camera.id,
    chunk: coordinate,
    resolvedPose: {
      x: camera.x,
      y: rounded(groundY + 1.68),
      z: camera.z,
      yawRadians: camera.yawRadians,
      pitchRadians: camera.pitchRadians,
    },
    groundY: rounded(groundY),
    riverDistance: rounded(riverDistance(camera.x, camera.z)),
    descriptor: {
      biome: descriptor.biome,
      elevation: rounded(descriptor.elevation),
      moisture: rounded(descriptor.moisture),
      canopy: rounded(descriptor.canopy),
    },
    semanticObjectCount: plan.objects.length,
    categoryCounts,
  };
}

function summarize(values: readonly number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
      : (sorted[middle] ?? 0);
  return {
    minimum: rounded(sorted[0] ?? 0),
    median: rounded(median),
    maximum: rounded(sorted.at(-1) ?? 0),
  };
}

export function createVisualV0Baseline(
  options: VisualV0BaselineOptions = {},
) {
  const fixtures = {
    seeds: VISUAL_V0_SEEDS,
    cameras: VISUAL_V0_CAMERAS,
    profiles: VISUAL_V0_PROFILES,
    routes: VISUAL_V0_ROUTES,
    contactSheetMatrix: {
      seedCount: VISUAL_V0_SEEDS.length,
      cameraCount: VISUAL_V0_CAMERAS.length,
      expectedFrameCount: VISUAL_V0_SEEDS.length * VISUAL_V0_CAMERAS.length,
      captureStatus: "not-captured" as const,
    },
  };
  const worldAudits = VISUAL_V0_PROFILES.flatMap((profile) =>
    VISUAL_V0_SEEDS.map((seed) => {
      const auditOptions: VisualWorldAuditOptions = {
        seed,
        gridRadius: profile.gridRadius,
        activeRadius: profile.activeRadius,
        detail: profile.detail,
      };
      return {
        profileId: profile.id,
        seed,
        audit: createVisualWorldAudit(auditOptions),
      };
    }),
  );
  const cameraObservations = VISUAL_V0_SEEDS.flatMap((seed) =>
    VISUAL_V0_CAMERAS.map((camera) => cameraObservation(seed, camera)),
  );
  const profileSummaries = VISUAL_V0_PROFILES.map((profile) => {
    const reports = worldAudits.filter((entry) => entry.profileId === profile.id);
    return {
      profileId: profile.id,
      sampledSeeds: reports.length,
      sameBiomeEdgeRatio: summarize(
        reports.map((entry) => entry.audit.descriptorContinuity.sameBiomeEdgeRatio ?? 0),
      ),
      oneCellIslandRatio: summarize(
        reports.map((entry) => entry.audit.descriptorContinuity.oneCellIslandRatio ?? 0),
      ),
      semanticObjectCount: summarize(
        reports.map((entry) => entry.audit.activeRing.semanticObjectCount),
      ),
      knownMainDrawInventory: summarize(
        reports.map(
          (entry) =>
            entry.audit.activeRing.staticInventoryEstimate.knownMainDrawInventory,
        ),
      ),
      knownMainTriangleInventory: summarize(
        reports.map(
          (entry) =>
            entry.audit.activeRing.staticInventoryEstimate.knownMainTriangleInventory,
        ),
      ),
    };
  });
  const deterministicData = {
    worldAudits,
    cameraObservations,
    profileSummaries,
  };
  return {
    schemaVersion: VISUAL_V0_SCHEMA_VERSION,
    reportKind: "canopy.visual-v0.static-simulation-baseline",
    protocolVersion: VISUAL_V0_PROTOCOL_VERSION,
    evidenceClassification: {
      fixtureAndDescriptorMetrics: "F: deterministic current-code observations",
      drawAndTriangleInventory:
        "I: source-model estimate; it is not renderer.info, GPU profiling, or a browser trace",
      browserPerformance: "not-captured; no M claim is present in this report",
    },
    invariants: {
      changesRuntimeRendering: false,
      changesWorldGeneratorIdentity: false,
      changesSaveIdentity: false,
    },
    artifactContext: {
      sourceRevision: options.sourceRevision ?? null,
      productionBuildHash: options.productionBuildHash ?? null,
      fixtureSha256: sha256(fixtures),
      deterministicDataSha256: sha256(deterministicData),
    },
    fixtures,
    deterministicData,
    browserCapture: {
      status: "not-captured" as const,
      rendererDiagnostics: null,
      frameIntervals: null,
      longTasks: null,
      jsHeap: null,
      gpuTime: null,
      residentTextureBytes: null,
      screenshots: null,
      packageBytes: null,
      missingReason:
        "This offline command does not create WebGLRenderer, run requestAnimationFrame, inspect Long Tasks, or access browser/GPU memory APIs.",
      existingHudLimitation:
        "The renderer HUD keeps only 90 rolling frame intervals and samples renderer.info every 500ms; it is useful for anomaly discovery but is not V0 benchmark evidence.",
    },
  };
}

type CliOptions = VisualV0BaselineOptions & Readonly<{ output: string | null }>;

export function parseVisualV0CliOptions(args: readonly string[]): CliOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    const value = args[index + 1];
    if (!name?.startsWith("--") || value === undefined) continue;
    values.set(name.slice(2), value);
    index += 1;
  }
  return {
    output: values.get("output") ?? null,
    sourceRevision: values.get("source-revision") ?? null,
    productionBuildHash: values.get("production-build-hash") ?? null,
  };
}

export async function writeVisualV0Baseline(
  outputPath: string,
  options: VisualV0BaselineOptions = {},
): Promise<string> {
  const absolutePath = resolve(outputPath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(
    absolutePath,
    `${JSON.stringify(createVisualV0Baseline(options), null, 2)}\n`,
    "utf8",
  );
  return absolutePath;
}

function isDirectExecution(metaUrl: string): boolean {
  const entry = process.argv[1];
  return entry !== undefined && pathToFileURL(resolve(entry)).href === metaUrl;
}

async function main(): Promise<void> {
  const options = parseVisualV0CliOptions(process.argv.slice(2));
  const reportOptions: VisualV0BaselineOptions = {
    sourceRevision: options.sourceRevision,
    productionBuildHash: options.productionBuildHash,
  };
  if (options.output) {
    const absolutePath = await writeVisualV0Baseline(options.output, reportOptions);
    console.log(absolutePath);
    return;
  }
  console.log(JSON.stringify(createVisualV0Baseline(reportOptions), null, 2));
}

if (isDirectExecution(import.meta.url)) {
  void main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
