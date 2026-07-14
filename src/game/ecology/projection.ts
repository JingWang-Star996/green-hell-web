import { WORLD_CHUNK_SIZE } from "../world/generation";
import type { ChunkDescriptor } from "../world/generation";
import {
  DEFAULT_ECOLOGY_START_MINUTE,
  DEFAULT_ECOLOGY_TICKS_PER_DAY,
  ecologyPopulationKey,
} from "./population";
import { activityAtMinute, ECOLOGY_SPECIES } from "./species";
import { ECOLOGY_SPECIES_IDS } from "./types";
import type {
  EcologyBehavior,
  EcologyEncounterProjection,
  EcologyEnvironmentFrame,
  EcologyRenderProjection,
  EcologyState,
  EcologyVector3,
} from "./types";

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.min(maximum, Math.max(minimum, value));
}
function unitHash(...parts: readonly (string | number)[]): number {
  let hash = 0x811c9dc5;
  const input = parts.join("|");
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  hash ^= hash >>> 16;
  return (hash >>> 0) / 0x1_0000_0000;
}

function minuteAtTick(frame: EcologyEnvironmentFrame): number {
  const ticksPerDay = Math.max(
    1,
    Math.floor(frame.ticksPerDay ?? DEFAULT_ECOLOGY_TICKS_PER_DAY),
  );
  return (
    (frame.startMinuteOfDay ?? DEFAULT_ECOLOGY_START_MINUTE) +
    (frame.tick / ticksPerDay) * 1440
  ) % 1440;
}

function individualPosition(
  worldSeed: string,
  tick: number,
  chunk: ChunkDescriptor,
  individualId: string,
  movementRadius: number,
): { position: EcologyVector3; headingRadians: number } {
  const padding = 4;
  const usableSize = WORLD_CHUNK_SIZE - padding * 2;
  const originX = chunk.coordinate.x * WORLD_CHUNK_SIZE;
  const originZ = chunk.coordinate.z * WORLD_CHUNK_SIZE;
  const baseX = padding + unitHash(worldSeed, individualId, "x") * usableSize;
  const baseZ = padding + unitHash(worldSeed, individualId, "z") * usableSize;
  const phase = unitHash(worldSeed, individualId, "phase") * Math.PI * 2;
  const speed = 0.00045 + unitHash(worldSeed, individualId, "speed") * 0.00065;
  const headingRadians = phase + tick * speed;
  const x = clamp(baseX + Math.cos(headingRadians) * movementRadius, padding, WORLD_CHUNK_SIZE - padding);
  const z = clamp(baseZ + Math.sin(headingRadians * 0.83) * movementRadius, padding, WORLD_CHUNK_SIZE - padding);
  return {
    position: {
      x: originX + x,
      y: chunk.elevation * 5,
      z: originZ + z,
    },
    headingRadians,
  };
}

function behaviorFor(role: EcologyRenderProjection["role"], activity: number): EcologyBehavior {
  if (activity < 0.24) return "shelter";
  if (role === "predator") return "stalk";
  if (role === "large-herbivore") return "browse";
  return "forage";
}

/** Pure visual projection: repeated calls never consume simulation randomness. */
export function projectEcologyForRender(
  state: EcologyState,
  frame: EcologyEnvironmentFrame,
): EcologyRenderProjection[] {
  const minute = minuteAtTick(frame);
  const chunks = [...new Map(frame.activeChunks.map((chunk) => [chunk.key, chunk])).values()].sort(
    (left, right) => left.key.localeCompare(right.key),
  );
  const projections: EcologyRenderProjection[] = [];

  for (const chunk of chunks) {
    for (const speciesId of ECOLOGY_SPECIES_IDS) {
      const species = ECOLOGY_SPECIES[speciesId];
      const populationKey = ecologyPopulationKey(chunk.key, speciesId);
      const count = state.populations[populationKey]?.count ?? 0;
      const activity = activityAtMinute(species.activityPattern, minute);
      const rainPenalty =
        frame.rainIntensity > species.preferredRain[1]
          ? (frame.rainIntensity - species.preferredRain[1]) * 0.65
          : 0;
      const visibility = clamp(0.12 + activity * 0.88 - rainPenalty);

      for (let slot = 0; slot < count; slot += 1) {
        const individualId = `${populationKey}#${slot}`;
        const { position, headingRadians } = individualPosition(
          state.worldSeed,
          frame.tick,
          chunk,
          individualId,
          species.movementRadius,
        );
        const visible =
          unitHash(state.worldSeed, Math.floor(frame.tick / 90), individualId, "visible") <
          visibility;
        projections.push({
          individualId,
          populationKey,
          speciesId,
          label: species.label,
          role: species.role,
          chunkKey: chunk.key,
          position,
          headingRadians,
          scale:
            species.role === "small-prey"
              ? 0.55
              : species.role === "large-herbivore"
                ? 1.35
                : 1.05,
          activity,
          visibility,
          visible,
          behavior: behaviorFor(species.role, activity),
          encounter: species.encounter,
        });
      }
    }
  }
  return projections;
}

function distanceBetween(left: EcologyVector3, right: EcologyVector3): number {
  return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
}

/** Converts visible render snapshots into sorted proximity opportunities/threats. */
export function projectEcologyEncounters(
  projections: readonly EcologyRenderProjection[],
  observerPosition: EcologyVector3,
): EcologyEncounterProjection[] {
  return projections
    .filter((projection) => projection.visible)
    .map((projection) => {
      const distance = distanceBetween(projection.position, observerPosition);
      const urgency = clamp(1 - distance / projection.encounter.awarenessRadius);
      return {
        individualId: projection.individualId,
        speciesId: projection.speciesId,
        kind: projection.encounter.kind,
        distance,
        urgency,
        dangerLevel: projection.encounter.dangerLevel,
        awarenessRadius: projection.encounter.awarenessRadius,
        position: { ...projection.position },
      };
    })
    .filter((projection) => projection.distance <= projection.awarenessRadius)
    .sort(
      (left, right) =>
        right.urgency - left.urgency ||
        left.individualId.localeCompare(right.individualId),
    );
}
