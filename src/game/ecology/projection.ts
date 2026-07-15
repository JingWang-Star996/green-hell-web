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
  EcologyDeterrenceProjection,
  EcologyEncounterProjection,
  EcologyEnvironmentFrame,
  EcologyFireDeterrent,
  EcologyIndividualState,
  EcologyRenderProjection,
  EcologySpeciesId,
  EcologyState,
  EcologyVector3,
} from "./types";

const PROCEDURAL_SPECIES_IDS = new Set<EcologySpeciesId>(ECOLOGY_SPECIES_IDS);
export const MAX_ECOLOGY_FRAME_DETERRENTS = 16;
const MAX_FIRE_DETERRENT_RADIUS = 64;
const MAX_DETERRENT_ID_LENGTH = 96;
const MAX_FIRE_RETREAT_DISPLACEMENT = 3.2;

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

function isFinitePosition(position: unknown): position is EcologyVector3 {
  if (!position || typeof position !== "object") return false;
  const candidate = position as Partial<EcologyVector3>;
  return (
    Number.isFinite(candidate.x) &&
    Number.isFinite(candidate.y) &&
    Number.isFinite(candidate.z)
  );
}

/**
 * The environment frame is an untrusted serialization boundary. Keep source
 * processing bounded, reject malformed values, and drop duplicate authority
 * ids instead of letting them stack potency.
 */
function validatedFireDeterrents(
  frame: EcologyEnvironmentFrame,
): EcologyFireDeterrent[] {
  if (frame.deterrents === undefined) return [];
  if (
    !Array.isArray(frame.deterrents) ||
    frame.deterrents.length > MAX_ECOLOGY_FRAME_DETERRENTS
  ) {
    return [];
  }
  const valid = frame.deterrents.filter(
    (deterrent): deterrent is EcologyFireDeterrent =>
      deterrent?.kind === "fire" &&
      typeof deterrent.id === "string" &&
      deterrent.id.length > 0 &&
      deterrent.id.length <= MAX_DETERRENT_ID_LENGTH &&
      deterrent.id.trim() === deterrent.id &&
      isFinitePosition(deterrent.position) &&
      Number.isFinite(deterrent.radius) &&
      deterrent.radius > 0 &&
      deterrent.radius <= MAX_FIRE_DETERRENT_RADIUS &&
      Number.isFinite(deterrent.strength) &&
      deterrent.strength > 0 &&
      deterrent.strength <= 1,
  );
  const idCounts = new Map<string, number>();
  for (const deterrent of valid) {
    idCounts.set(deterrent.id, (idCounts.get(deterrent.id) ?? 0) + 1);
  }
  return valid
    .filter((deterrent) => idCounts.get(deterrent.id) === 1)
    .sort((left, right) => left.id.localeCompare(right.id));
}

function smoothstep(value: number): number {
  const bounded = clamp(value);
  return bounded * bounded * (3 - 2 * bounded);
}

interface FireDeterrenceResponse {
  sourceId: string;
  sourceIds: string[];
  influence: number;
  directionX: number;
  directionZ: number;
}

/** Continuous radial field; source order never changes its replay result. */
function fireDeterrenceAt(
  position: EcologyVector3,
  individualId: string,
  deterrents: readonly EcologyFireDeterrent[],
): FireDeterrenceResponse | null {
  const contributors: Array<{
    source: EcologyFireDeterrent;
    influence: number;
    awayX: number;
    awayZ: number;
  }> = [];
  for (const source of deterrents) {
    let awayX = position.x - source.position.x;
    let awayZ = position.z - source.position.z;
    const distance = Math.hypot(awayX, awayZ);
    if (!Number.isFinite(distance) || distance >= source.radius) continue;
    if (distance <= 0.000001) {
      const phase =
        unitHash(individualId, source.id, "fire-deterrence-direction") *
        Math.PI *
        2;
      awayX = Math.sin(phase);
      awayZ = Math.cos(phase);
    } else {
      awayX /= distance;
      awayZ /= distance;
    }
    const influence =
      source.strength * smoothstep(1 - distance / source.radius);
    if (!Number.isFinite(influence) || influence <= 0) continue;
    contributors.push({ source, influence, awayX, awayZ });
  }
  if (contributors.length === 0) return null;

  let remainingInfluence = 1;
  let weightedX = 0;
  let weightedZ = 0;
  for (const contributor of contributors) {
    remainingInfluence *= 1 - contributor.influence;
    weightedX += contributor.awayX * contributor.influence;
    weightedZ += contributor.awayZ * contributor.influence;
  }
  const influence = clamp(1 - remainingInfluence);
  if (!Number.isFinite(influence) || influence <= 0) return null;

  const dominant = [...contributors].sort(
    (left, right) =>
      right.influence - left.influence ||
      left.source.id.localeCompare(right.source.id),
  )[0];
  const weightedLength = Math.hypot(weightedX, weightedZ);
  const directionX =
    weightedLength > 0.000001 ? weightedX / weightedLength : dominant.awayX;
  const directionZ =
    weightedLength > 0.000001 ? weightedZ / weightedLength : dominant.awayZ;
  if (!Number.isFinite(directionX) || !Number.isFinite(directionZ)) return null;

  return {
    sourceId: dominant.source.id,
    sourceIds: contributors.map((contributor) => contributor.source.id),
    influence,
    directionX,
    directionZ,
  };
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

function awareBehavior(
  role: EcologyRenderProjection["role"],
  base: EcologyBehavior,
  awareness: number,
  distance: number,
): EcologyBehavior {
  if (awareness <= 0) return base;
  if (role === "predator") return "stalk";
  if (role === "large-herbivore" && distance < 3.2) return "defend";
  return "flee";
}

function scaleForRole(role: EcologyRenderProjection["role"]): number {
  if (role === "small-prey") return 0.55;
  if (role === "large-herbivore") return 1.35;
  return 1.05;
}

function pendingLootQuantity(condition: EcologyIndividualState): number {
  return (
    Math.max(0, condition.pendingMeat ?? 0) +
    Math.max(0, condition.pendingHide ?? 0)
  );
}

function isAuthoritativeInjury(
  condition: EcologyIndividualState | undefined,
  speciesId: EcologySpeciesId,
): condition is EcologyIndividualState {
  return (
    condition?.speciesId === speciesId &&
    condition.health > 0 &&
    condition.health < condition.maxHealth
  );
}

/**
 * Population summaries are allowed to drift below a sparse, player-authored
 * injury. Keep those authored individuals and use anonymous population slots
 * only to fill the remaining living roster. This avoids both erasing an animal
 * the player just fought and double-counting it on top of the population total.
 */
function livingIndividualIds(
  state: EcologyState,
  populationKey: string,
  speciesId: EcologySpeciesId,
  populationCount: number,
): string[] {
  const count = Math.max(0, Math.floor(populationCount));
  const prefix = `${populationKey}#`;
  const individuals = state.individuals ?? {};
  const injuredIds = Object.entries(individuals)
    .filter(
      ([individualId, condition]) =>
        individualId.startsWith(prefix) &&
        isAuthoritativeInjury(condition, speciesId),
    )
    .map(([individualId]) => individualId)
    .sort((left, right) => left.localeCompare(right));
  let deadPopulationSlots = 0;
  for (let slot = 0; slot < count; slot += 1) {
    const condition = individuals[`${populationKey}#${slot}`];
    if (condition?.speciesId === speciesId && condition.health <= 0) {
      deadPopulationSlots += 1;
    }
  }
  const desiredLivingCount = Math.max(
    injuredIds.length,
    count - deadPopulationSlots,
  );
  const selected = new Set(injuredIds);
  for (let slot = 0; selected.size < desiredLivingCount; slot += 1) {
    const individualId = `${populationKey}#${slot}`;
    const condition = individuals[individualId];
    if (condition?.speciesId === speciesId && condition.health <= 0) continue;
    selected.add(individualId);
  }
  return [...selected];
}

function projectRetainedCorpse(
  individualId: string,
  condition: EcologyIndividualState,
): EcologyRenderProjection | null {
  const corpse = condition.corpse;
  if (
    condition.health > 0 ||
    pendingLootQuantity(condition) <= 0 ||
    !corpse ||
    !PROCEDURAL_SPECIES_IDS.has(condition.speciesId)
  ) {
    return null;
  }
  const species = ECOLOGY_SPECIES[condition.speciesId];
  return {
    individualId,
    populationKey: ecologyPopulationKey(corpse.chunkKey, condition.speciesId),
    speciesId: condition.speciesId,
    label: species.label,
    role: species.role,
    chunkKey: corpse.chunkKey,
    position: { ...corpse.position },
    headingRadians: corpse.headingRadians,
    scale: scaleForRole(species.role),
    activity: 0,
    visibility: 1,
    visible: true,
    behavior: "dead",
    awareness: 0,
    health: 0,
    maxHealth: condition.maxHealth,
    pendingMeat: Math.max(0, condition.pendingMeat ?? 0),
    pendingHide: Math.max(0, condition.pendingHide ?? 0),
    encounter: species.encounter,
  };
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
  const activeChunkKeys = new Set(chunks.map((chunk) => chunk.key));
  const fireDeterrents = validatedFireDeterrents(frame);
  const projections: EcologyRenderProjection[] = [];

  // Corpses are sparse authoritative state, not members of the current living
  // population count. Project them first so ecology departures and activity-
  // bubble exits cannot erase an unclaimed kill.
  for (const [individualId, condition] of Object.entries(
    state.individuals ?? {},
  ).sort(([left], [right]) => left.localeCompare(right))) {
    const corpse = projectRetainedCorpse(individualId, condition);
    if (corpse && activeChunkKeys.has(corpse.chunkKey)) {
      projections.push(corpse);
    }
  }

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

      for (const individualId of livingIndividualIds(
        state,
        populationKey,
        speciesId,
        count,
      )) {
        const condition = state.individuals?.[individualId];
        // Sparse death memory is authoritative until the simulation refresh
        // removes it. Render projection never turns a stale dead record live.
        if (condition?.health !== undefined && condition.health <= 0) continue;
        const { position, headingRadians: roamingHeading } = individualPosition(
          state.worldSeed,
          frame.tick,
          chunk,
          individualId,
          species.movementRadius,
        );
        const observerDistance = frame.observerPosition
          ? distanceBetween(position, frame.observerPosition)
          : Number.POSITIVE_INFINITY;
        const awareness = frame.observerPosition
          ? clamp(1 - observerDistance / species.encounter.awarenessRadius)
          : 0;
        const awarenessBehavior = awareBehavior(
          species.role,
          behaviorFor(species.role, activity),
          awareness,
          observerDistance,
        );
        if (frame.observerPosition && awareness > 0) {
          let awayX = position.x - frame.observerPosition.x;
          let awayZ = position.z - frame.observerPosition.z;
          const awayLength = Math.hypot(awayX, awayZ);
          if (awayLength <= 0.001) {
            awayX = Math.sin(roamingHeading);
            awayZ = Math.cos(roamingHeading);
          } else {
            awayX /= awayLength;
            awayZ /= awayLength;
          }
          const responseDistance =
            awarenessBehavior === "flee"
              ? awareness * 2.4
              : awarenessBehavior === "stalk"
                ? -Math.min(awareness * 1.35, Math.max(0, awayLength - 1.8))
                : 0;
          const originX = chunk.coordinate.x * WORLD_CHUNK_SIZE;
          const originZ = chunk.coordinate.z * WORLD_CHUNK_SIZE;
          position.x = clamp(
            position.x + awayX * responseDistance,
            originX + 4,
            originX + WORLD_CHUNK_SIZE - 4,
          );
          position.z = clamp(
            position.z + awayZ * responseDistance,
            originZ + 4,
            originZ + WORLD_CHUNK_SIZE - 4,
          );
        }
        const fireResponse =
          species.role === "predator"
            ? fireDeterrenceAt(position, individualId, fireDeterrents)
            : null;
        let deterrence: EcologyDeterrenceProjection | undefined;
        if (fireResponse) {
          const beforeFireX = position.x;
          const beforeFireZ = position.z;
          const requestedDisplacement =
            fireResponse.influence * MAX_FIRE_RETREAT_DISPLACEMENT;
          const originX = chunk.coordinate.x * WORLD_CHUNK_SIZE;
          const originZ = chunk.coordinate.z * WORLD_CHUNK_SIZE;
          position.x = clamp(
            position.x + fireResponse.directionX * requestedDisplacement,
            originX + 4,
            originX + WORLD_CHUNK_SIZE - 4,
          );
          position.z = clamp(
            position.z + fireResponse.directionZ * requestedDisplacement,
            originZ + 4,
            originZ + WORLD_CHUNK_SIZE - 4,
          );
          deterrence = {
            kind: "fire",
            sourceId: fireResponse.sourceId,
            sourceIds: fireResponse.sourceIds,
            influence: fireResponse.influence,
            displacement: Math.hypot(
              position.x - beforeFireX,
              position.z - beforeFireZ,
            ),
            retreatHeadingRadians: Math.atan2(
              fireResponse.directionX,
              fireResponse.directionZ,
            ),
          };
        }
        const behavior: EcologyBehavior = fireResponse
          ? "fire-avoid"
          : awarenessBehavior;
        const awarenessHeading = frame.observerPosition
          ? Math.atan2(
              frame.observerPosition.x - position.x,
              frame.observerPosition.z - position.z,
            )
          : roamingHeading;
        const headingRadians =
          fireResponse
            ? Math.atan2(fireResponse.directionX, fireResponse.directionZ)
            : behavior === "flee"
            ? awarenessHeading + Math.PI
            : behavior === "stalk" || behavior === "defend"
              ? awarenessHeading
              : roamingHeading;
        const maxHealth = species.combat.maxHealth;
        const health =
          condition && condition.health > 0
            ? clamp(condition.health, 0, condition.maxHealth)
            : maxHealth;
        projections.push({
          individualId,
          populationKey,
          speciesId,
          label: species.label,
          role: species.role,
          chunkKey: chunk.key,
          position,
          headingRadians,
          scale: scaleForRole(species.role),
          activity,
          visibility,
          // `visible` represents existence inside the active simulation bubble.
          // Weather and activity only affect the continuous readability scalar.
          visible: true,
          behavior,
          awareness,
          ...(deterrence ? { deterrence } : {}),
          health,
          maxHealth,
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
    .filter((projection) => projection.visible && projection.health > 0)
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
