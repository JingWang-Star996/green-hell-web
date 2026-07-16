import assert from "node:assert/strict";
import test from "node:test";

import {
  VISUAL_V0_CAMERAS,
  VISUAL_V0_PROFILES,
  VISUAL_V0_ROUTES,
  VISUAL_V0_SEEDS,
  createVisualV0Baseline,
  parseVisualV0CliOptions,
  sha256,
} from "../../scripts/visual-v0-baseline";
import {
  CURRENT_STATIC_INVENTORY_ARCHITECTURE,
  estimateSemanticDrawInventory,
  type VisualStaticInventoryArchitecture,
} from "../../scripts/visual-world-audit";

test("V0 fixture pins 20 seeds, 12 cameras, five routes, and two quality profiles", () => {
  const report = createVisualV0Baseline();

  assert.equal(VISUAL_V0_SEEDS.length, 20);
  assert.equal(new Set(VISUAL_V0_SEEDS).size, 20);
  assert.equal(VISUAL_V0_CAMERAS.length, 12);
  assert.equal(new Set(VISUAL_V0_CAMERAS.map((camera) => camera.id)).size, 12);
  assert.deepEqual(VISUAL_V0_ROUTES.map((route) => route.id), ["S0", "S1", "S2", "S3", "S4"]);
  assert.deepEqual(VISUAL_V0_PROFILES.map((profile) => profile.id), [
    "standard-1080p",
    "low-720p",
  ]);
  assert.equal(report.fixtures.contactSheetMatrix.expectedFrameCount, 240);
  assert.equal(report.deterministicData.cameraObservations.length, 240);
  assert.equal(report.deterministicData.worldAudits.length, 40);
  assert.equal(
    report.artifactContext.fixtureSha256,
    "9a9ac23bde0abfbff2496740b0606ce266c8925eb66088a42cf6f4b675708adc",
  );
  assert.match(report.artifactContext.deterministicDataSha256, /^[0-9a-f]{64}$/);
});

test("V0 static baseline is byte-stable for the same source model and provenance", () => {
  const options = {
    sourceRevision: "test-revision",
    productionBuildHash: "test-build",
  };
  const first = createVisualV0Baseline(options);
  const second = createVisualV0Baseline(options);

  assert.deepEqual(second, first);
  assert.equal(sha256(second), sha256(first));
  assert.equal(first.artifactContext.sourceRevision, "test-revision");
  assert.equal(first.artifactContext.productionBuildHash, "test-build");
  assert.equal(first.invariants.changesRuntimeRendering, false);
  assert.equal(first.invariants.changesWorldGeneratorIdentity, false);
  assert.equal(first.invariants.changesSaveIdentity, false);
});

test("V0 report never promotes static inventory or empty browser fields to measured evidence", () => {
  const report = createVisualV0Baseline();
  const seedOneStandard = report.deterministicData.worldAudits.find(
    (entry) => entry.profileId === "standard-1080p" && entry.seed === "1",
  );

  assert.ok(seedOneStandard);
  // C17's authored exclusion zone and two approach corridors deliberately clear
  // 30 semantic objects from the seed-1 standard ring (pre-C17: 2420).
  assert.equal(seedOneStandard.audit.activeRing.semanticObjectCount, 2390);
  assert.deepEqual(seedOneStandard.audit.activeRing.categoryCounts, {
    tree: 371,
    "mineable-rock": 145,
    "harvestable-plant": 270,
    "ambient-foliage": 1134,
    "micro-clutter": 470,
  });
  assert.equal(
    seedOneStandard.audit.activeRing.staticInventoryEstimate.knownMainDrawInventory,
    142,
  );
  assert.equal(
    seedOneStandard.audit.activeRing.staticInventoryEstimate.knownMainTriangleInventory,
    203912,
  );
  assert.equal(
    seedOneStandard.audit.activeRing.staticInventoryEstimate.architectureVersion,
    "semantic-post-v1a-rainforest-depth-fill-v2",
  );
  assert.equal(
    seedOneStandard.audit.activeRing.staticInventoryEstimate
      .semanticDrawScopeByCategory.tree,
    "per-active-ring",
  );
  assert.equal(
    seedOneStandard.audit.activeRing.staticInventoryEstimate
      .semanticDrawScopeByCategory["mineable-rock"],
    "per-active-ring",
  );
  const seedOneLow = report.deterministicData.worldAudits.find(
    (entry) => entry.profileId === "low-720p" && entry.seed === "1",
  );
  assert.ok(seedOneLow);
  assert.equal(
    seedOneLow.audit.activeRing.staticInventoryEstimate.knownMainDrawInventory,
    58,
  );
  assert.equal(
    seedOneLow.audit.activeRing.staticInventoryEstimate.knownMainTriangleInventory,
    54608,
  );
  assert.match(
    seedOneStandard.audit.activeRing.staticInventoryEstimate.caveat,
    /not WebGL profiling/i,
  );
  assert.equal(report.evidenceClassification.browserPerformance.startsWith("not-captured"), true);
  assert.deepEqual(report.browserCapture, {
    status: "not-captured",
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
  });
});

test("V0 CLI provenance is optional and does not invent an environment or build hash", () => {
  assert.deepEqual(parseVisualV0CliOptions([]), {
    output: null,
    sourceRevision: null,
    productionBuildHash: null,
  });
  assert.deepEqual(
    parseVisualV0CliOptions([
      "--output",
      "outputs/v0.json",
      "--source-revision",
      "abc123",
      "--production-build-hash",
      "build456",
    ]),
    {
      output: "outputs/v0.json",
      sourceRevision: "abc123",
      productionBuildHash: "build456",
    },
  );

  const report = createVisualV0Baseline();
  assert.equal(report.artifactContext.sourceRevision, null);
  assert.equal(report.artifactContext.productionBuildHash, null);
});

test("post-V1A tree and rock estimators replace their per-chunk draws with active-ring pools", () => {
  const chunks = {
    tree: 25,
    "mineable-rock": 25,
    "harvestable-plant": 25,
    "ambient-foliage": 25,
    "micro-clutter": 25,
  } as const;
  const legacyPerChunk: VisualStaticInventoryArchitecture = {
    version: "test-only-pre-v1a-per-chunk-tree-rocks",
    categories: {
      ...CURRENT_STATIC_INVENTORY_ARCHITECTURE.categories,
      tree: { draws: 5, scope: "per-nonempty-chunk" },
      "mineable-rock": { draws: 3, scope: "per-nonempty-chunk" },
    },
  };
  const globalRockOnly: VisualStaticInventoryArchitecture = {
    version: "test-only-global-rock-only",
    categories: {
      ...legacyPerChunk.categories,
      "mineable-rock": { draws: 3, scope: "per-active-ring" },
    },
  };
  const legacy = estimateSemanticDrawInventory(legacyPerChunk, chunks);
  const rockOnly = estimateSemanticDrawInventory(globalRockOnly, chunks);
  const current = estimateSemanticDrawInventory(
    CURRENT_STATIC_INVENTORY_ARCHITECTURE,
    chunks,
  );
  const lowLegacy = estimateSemanticDrawInventory(legacyPerChunk, {
    ...chunks,
    tree: 9,
    "mineable-rock": 9,
  });
  const lowCurrent = estimateSemanticDrawInventory(
    CURRENT_STATIC_INVENTORY_ARCHITECTURE,
    { ...chunks, tree: 9, "mineable-rock": 9 },
  );

  assert.equal(legacy.byCategory.tree, 125);
  assert.equal(legacy.byCategory["mineable-rock"], 75);
  assert.equal(rockOnly.byCategory.tree, 125);
  assert.equal(rockOnly.byCategory["mineable-rock"], 3);
  assert.equal(current.byCategory.tree, 5);
  assert.equal(current.byCategory["mineable-rock"], 3);
  assert.equal(legacy.total - rockOnly.total, 3 * (25 - 1));
  assert.equal(rockOnly.total - current.total, 5 * (25 - 1));
  assert.equal(legacy.total - current.total, (5 + 3) * (25 - 1));
  assert.equal(lowLegacy.byCategory.tree, 45);
  assert.equal(lowLegacy.byCategory["mineable-rock"], 27);
  assert.equal(lowCurrent.byCategory.tree, 5);
  assert.equal(lowCurrent.byCategory["mineable-rock"], 3);
  assert.equal(lowLegacy.total - lowCurrent.total, (5 + 3) * (9 - 1));
});
