import {
  MAX_ECOLOGY_FRAME_DETERRENTS,
  createEcologyState,
  projectEcologyForRender,
  type EcologyEnvironmentFrame,
  type EcologyFireDeterrent,
  type EcologyRenderProjection,
  type EcologyState,
} from "../ecology";
import {
  WORLD_CHUNK_SIZE,
  activeChunkCoordinates,
  generateChunkDescriptor,
  type ChunkDescriptor,
} from "../world/generation";
import { projectAuthoredSnakesForRender } from "./authoredSnakes";
import { getCampStructureTransform } from "./selectors";
import {
  campfireStateForStructure,
  placedStructuresOfKind,
} from "./campStructures";
import type { GameState } from "./types";
import { torchWaymarkTotalFuelSeconds } from "./torchWaymarkRules";

/** A lit camp protects the immediate work area, but its soft edge stays risky. */
export const CAMPFIRE_WILDLIFE_DETERRENT_RADIUS = 7.5;
export const CAMPFIRE_WILDLIFE_DETERRENT_STRENGTH = 0.92;
export const CAMPFIRE_WILDLIFE_DETERRENT_ID =
  "deterrent.campfire.active";
export const TORCH_WAYMARK_WILDLIFE_DETERRENT_RADIUS = 8;
export const TORCH_WAYMARK_WILDLIFE_DETERRENT_STRENGTH = 0.82;

export interface ActiveWildlifeProjection {
  /** The current ledger, or the exact fallback ledger used by the projection. */
  ecology: EcologyState;
  frame: EcologyEnvironmentFrame;
  wildlife: EcologyRenderProjection[];
}

/**
 * Converts the one authoritative, built campfire into an ecology input. The
 * source is deliberately session-derived rather than saved: old saves need no
 * new field, and extinguishing the fire removes the field on the same frame.
 */
function circleIntersectsActiveChunks(
  x: number,
  z: number,
  radius: number,
  activeChunks: readonly ChunkDescriptor[],
): boolean {
  return activeChunks.some((chunk) => {
    const minimumX = chunk.coordinate.x * WORLD_CHUNK_SIZE;
    const minimumZ = chunk.coordinate.z * WORLD_CHUNK_SIZE;
    const maximumX = minimumX + WORLD_CHUNK_SIZE;
    const maximumZ = minimumZ + WORLD_CHUNK_SIZE;
    const closestX = Math.max(minimumX, Math.min(maximumX, x));
    const closestZ = Math.max(minimumZ, Math.min(maximumZ, z));
    return Math.hypot(x - closestX, z - closestZ) <= radius;
  });
}

export function activeFireDeterrents(
  state: GameState,
  suppliedActiveChunks?: readonly ChunkDescriptor[],
): readonly EcologyFireDeterrent[] {
  const activeChunks = suppliedActiveChunks ?? activeChunkCoordinates(
    state.player.position.x,
    state.player.position.z,
    1,
  ).map((coordinate) =>
    generateChunkDescriptor(String(state.seed), coordinate),
  );
  const deterrents: EcologyFireDeterrent[] = [];
  const activeCampfires = placedStructuresOfKind(state, "campfire")
    .filter(
      (structure) =>
        campfireStateForStructure(state, structure).lit &&
        circleIntersectsActiveChunks(
          structure.position.x,
          structure.position.z,
          CAMPFIRE_WILDLIFE_DETERRENT_RADIUS,
          activeChunks,
        ),
    )
    .sort(
      (left, right) =>
        Math.hypot(
          left.position.x - state.player.position.x,
          left.position.z - state.player.position.z,
        ) -
          Math.hypot(
            right.position.x - state.player.position.x,
            right.position.z - state.player.position.z,
          ) || left.id.localeCompare(right.id),
    );
  for (const [index, fire] of activeCampfires.entries()) {
    if (deterrents.length >= MAX_ECOLOGY_FRAME_DETERRENTS) break;
    deterrents.push({
      kind: "fire",
      id:
        index === 0
          ? CAMPFIRE_WILDLIFE_DETERRENT_ID
          : `${CAMPFIRE_WILDLIFE_DETERRENT_ID}.${fire.id}`,
      position: { ...fire.position },
      radius: CAMPFIRE_WILDLIFE_DETERRENT_RADIUS,
      strength: CAMPFIRE_WILDLIFE_DETERRENT_STRENGTH,
    });
  }
  if (
    activeCampfires.length === 0 &&
    state.camp.fire.built &&
    state.camp.fire.lit
  ) {
    const fire = getCampStructureTransform(state, "campfire");
    if (
      fire &&
      circleIntersectsActiveChunks(
        fire.x,
        fire.z,
        CAMPFIRE_WILDLIFE_DETERRENT_RADIUS,
        activeChunks,
      )
    ) {
      deterrents.push({
        kind: "fire",
        id: CAMPFIRE_WILDLIFE_DETERRENT_ID,
        position: { x: fire.x, y: 0, z: fire.z },
        radius: CAMPFIRE_WILDLIFE_DETERRENT_RADIUS,
        strength: CAMPFIRE_WILDLIFE_DETERRENT_STRENGTH,
      });
    }
  }

  const waymarks = (state.camp.structures ?? []).filter(
    (structure) => structure.kind === "torch-waymark",
  );
  const idCounts = new Map<string, number>();
  for (const structure of waymarks) {
    idCounts.set(structure.id, (idCounts.get(structure.id) ?? 0) + 1);
  }
  const eligibleWaymarks = waymarks
    .filter((structure) => {
      const deterrentId = `deterrent.torch-waymark.${structure.id}`;
      return (
        idCounts.get(structure.id) === 1 &&
        structure.id.length > 0 &&
        structure.id.trim() === structure.id &&
        deterrentId.length <= 96 &&
        Number.isFinite(structure.position.x) &&
        Number.isFinite(structure.position.y) &&
        Number.isFinite(structure.position.z) &&
        structure.lit === true &&
        torchWaymarkTotalFuelSeconds(structure) > 0 &&
        circleIntersectsActiveChunks(
          structure.position.x,
          structure.position.z,
          TORCH_WAYMARK_WILDLIFE_DETERRENT_RADIUS,
          activeChunks,
        )
      );
    })
    .sort(
      (left, right) =>
        Math.hypot(
          left.position.x - state.player.position.x,
          left.position.z - state.player.position.z,
        ) -
          Math.hypot(
            right.position.x - state.player.position.x,
            right.position.z - state.player.position.z,
          ) || left.id.localeCompare(right.id),
    );
  for (const structure of eligibleWaymarks) {
    if (deterrents.length >= MAX_ECOLOGY_FRAME_DETERRENTS) break;
    deterrents.push({
      kind: "fire",
      id: `deterrent.torch-waymark.${structure.id}`,
      position: { ...structure.position },
      radius: TORCH_WAYMARK_WILDLIFE_DETERRENT_RADIUS,
      strength: TORCH_WAYMARK_WILDLIFE_DETERRENT_STRENGTH,
    });
  }
  return deterrents;
}

/**
 * Single projection seam for renderer focus, combat and contact validation.
 * Callers may retain `ecology` when migrating a legacy state, but projection
 * itself remains pure and does not mutate a render snapshot request.
 */
export function projectActiveWildlife(
  state: GameState,
): ActiveWildlifeProjection {
  const activeChunks = activeChunkCoordinates(
    state.player.position.x,
    state.player.position.z,
    1,
  ).map((coordinate) =>
    generateChunkDescriptor(String(state.seed), coordinate),
  );
  const frame: EcologyEnvironmentFrame = {
    tick: state.clock.tick,
    rainIntensity: state.weather.rainIntensity,
    activeChunks,
    observerPosition: state.player.position,
    deterrents: activeFireDeterrents(state, activeChunks),
  };
  const ecology =
    state.ecology ??
    createEcologyState(state.seed, frame);
  return {
    ecology,
    frame,
    wildlife: [
      ...projectEcologyForRender(ecology, frame),
      ...projectAuthoredSnakesForRender(state),
    ],
  };
}
