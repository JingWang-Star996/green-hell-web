import type { ChunkDescriptor } from "../world/generation";
import { activityAtMinute, ECOLOGY_SPECIES } from "./species";
import { ECOLOGY_SPECIES_IDS } from "./types";
import type {
  EcologyAdvanceResult,
  EcologyEnvironmentFrame,
  EcologyPopulationState,
  EcologySpeciesDefinition,
  EcologySpeciesId,
  EcologyState,
  EcologyTransition,
  EcologyTransitionType,
} from "./types";

export const ECOLOGY_VERSION = 1 as const;
export const ECOLOGY_STEP_TICKS = 30 * 30;
export const DEFAULT_ECOLOGY_TICKS_PER_DAY = 30 * 20 * 60;
export const DEFAULT_ECOLOGY_START_MINUTE = 14 * 60;

const MAX_ADVANCE_STEPS = 20_000;

export function ecologyPopulationKey(
  chunkKey: string,
  speciesId: EcologySpeciesId,
): string {
  return `${chunkKey}|${speciesId}`;
}

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizeTick(tick: number): number {
  if (!Number.isFinite(tick) || tick < 0) {
    throw new RangeError("Ecology tick must be a finite, non-negative number");
  }
  return Math.floor(tick);
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

function rangeSuitability(
  value: number,
  preferredRange: readonly [number, number],
): number {
  const [minimum, maximum] = preferredRange;
  if (value >= minimum && value <= maximum) return 1;
  const distance = value < minimum ? minimum - value : value - maximum;
  return clamp(1 - distance / 0.45);
}

export function getHabitatSuitability(
  species: EcologySpeciesDefinition,
  chunk: ChunkDescriptor,
  rainIntensity: number,
): number {
  const biome = species.biomeAffinity[chunk.biome];
  const moisture = rangeSuitability(chunk.moisture, species.preferredMoisture);
  const canopy = rangeSuitability(chunk.canopy, species.preferredCanopy);
  const rain = rangeSuitability(clamp(rainIntensity), species.preferredRain);
  return clamp(biome * (0.22 + moisture * 0.31 + canopy * 0.29 + rain * 0.18));
}

export function getCarryingCapacity(
  species: EcologySpeciesDefinition,
  chunk: ChunkDescriptor,
  rainIntensity: number,
): number {
  const suitability = getHabitatSuitability(species, chunk, rainIntensity);
  if (suitability < 0.12) return 0;
  return Math.max(1, Math.round(species.baseCarryingCapacity * suitability));
}

function minuteAtTick(frame: EcologyEnvironmentFrame, tick: number): number {
  const ticksPerDay = Math.max(
    1,
    Math.floor(frame.ticksPerDay ?? DEFAULT_ECOLOGY_TICKS_PER_DAY),
  );
  const startMinute = frame.startMinuteOfDay ?? DEFAULT_ECOLOGY_START_MINUTE;
  return (startMinute + (tick / ticksPerDay) * 1440) % 1440;
}

function cloneEcologyState(state: EcologyState): EcologyState {
  return {
    ...state,
    populations: Object.fromEntries(
      Object.entries(state.populations).map(([key, population]) => [
        key,
        { ...population },
      ]),
    ),
  };
}

function normalizedChunks(
  chunks: readonly ChunkDescriptor[],
): ChunkDescriptor[] {
  return [...new Map(chunks.map((chunk) => [chunk.key, chunk])).values()].sort(
    (left, right) => left.key.localeCompare(right.key),
  );
}

function initialPopulationCount(
  worldSeed: string,
  tick: number,
  chunk: ChunkDescriptor,
  species: EcologySpeciesDefinition,
  rainIntensity: number,
): number {
  const capacity = getCarryingCapacity(species, chunk, rainIntensity);
  if (capacity === 0) return 0;
  const occupancy = 0.3 + unitHash(worldSeed, tick, chunk.key, species.id, "initial") * 0.5;
  return Math.min(capacity, Math.floor(capacity * occupancy));
}

function ensureActivePopulations(
  state: EcologyState,
  chunks: readonly ChunkDescriptor[],
  rainIntensity: number,
): void {
  for (const chunk of chunks) {
    for (const speciesId of ECOLOGY_SPECIES_IDS) {
      const key = ecologyPopulationKey(chunk.key, speciesId);
      if (state.populations[key]) continue;
      state.populations[key] = {
        speciesId,
        chunkKey: chunk.key,
        count: initialPopulationCount(
          state.worldSeed,
          state.simulatedThroughTick,
          chunk,
          ECOLOGY_SPECIES[speciesId],
          rainIntensity,
        ),
      };
    }
  }
}

function makeTransition(
  tick: number,
  type: EcologyTransitionType,
  speciesId: EcologySpeciesId,
  amount: number,
  fromChunkKey?: string,
  toChunkKey?: string,
): EcologyTransition {
  return {
    id: [tick, type, speciesId, fromChunkKey ?? "outside", toChunkKey ?? "outside"].join(
      ":",
    ),
    tick,
    type,
    speciesId,
    amount,
    ...(fromChunkKey ? { fromChunkKey } : {}),
    ...(toChunkKey ? { toChunkKey } : {}),
  };
}

function areNeighboring(left: ChunkDescriptor, right: ChunkDescriptor): boolean {
  if (left.key === right.key) return false;
  return (
    Math.abs(left.coordinate.x - right.coordinate.x) <= 1 &&
    Math.abs(left.coordinate.z - right.coordinate.z) <= 1
  );
}

function applyPopulationStep(
  state: EcologyState,
  frame: EcologyEnvironmentFrame,
  chunks: readonly ChunkDescriptor[],
  tick: number,
  transitions: EcologyTransition[],
): void {
  const rain = clamp(frame.rainIntensity);
  const minute = minuteAtTick(frame, tick);

  for (const speciesId of ECOLOGY_SPECIES_IDS) {
    const species = ECOLOGY_SPECIES[speciesId];
    const records = new Map<string, EcologyPopulationState>();
    const capacities = new Map<string, number>();
    const suitability = new Map<string, number>();

    for (const chunk of chunks) {
      const record = state.populations[ecologyPopulationKey(chunk.key, speciesId)];
      records.set(chunk.key, record);
      capacities.set(chunk.key, getCarryingCapacity(species, chunk, rain));
      suitability.set(chunk.key, getHabitatSuitability(species, chunk, rain));
    }

    const activity = activityAtMinute(species.activityPattern, minute);

    for (const chunk of chunks) {
      const record = records.get(chunk.key)!;
      const capacity = capacities.get(chunk.key)!;
      const habitat = suitability.get(chunk.key)!;
      let leaving = Math.max(0, record.count - capacity);

      if (
        record.count - leaving > 0 &&
        unitHash(state.worldSeed, tick, speciesId, chunk.key, "departure") <
          species.departureChancePerStep * (0.35 + (1 - habitat) * 1.8 + rain * 0.2)
      ) {
        leaving += 1;
      }
      leaving = Math.min(record.count, leaving);
      if (leaving > 0) {
        record.count -= leaving;
        transitions.push(
          makeTransition(tick, "departure", speciesId, leaving, chunk.key),
        );
      }

      if (
        record.count > 0 &&
        record.count < capacity &&
        unitHash(state.worldSeed, tick, speciesId, chunk.key, "birth") <
          species.birthChancePerStep * habitat * (0.7 + activity * 0.3)
      ) {
        record.count += 1;
        transitions.push(makeTransition(tick, "birth", speciesId, 1, chunk.key, chunk.key));
      }
    }

    // Freeze outbound budgets before evaluating migration so a newcomer cannot
    // cascade through several chunks during the same ecology step.
    const migrationBudgets = new Map(
      chunks.map((chunk) => [
        chunk.key,
        Math.max(
          0,
          records.get(chunk.key)!.count - species.minimumResidentsBeforeMigration,
        ),
      ]),
    );
    for (const sourceChunk of chunks) {
      const source = records.get(sourceChunk.key)!;
      if ((migrationBudgets.get(sourceChunk.key) ?? 0) <= 0) continue;
      const sourceSuitability = suitability.get(sourceChunk.key)!;
      const candidates = chunks
        .filter((targetChunk) => {
          if (!areNeighboring(sourceChunk, targetChunk)) return false;
          const target = records.get(targetChunk.key)!;
          return target.count < capacities.get(targetChunk.key)!;
        })
        .sort((left, right) => {
          const leftSpace = capacities.get(left.key)! - records.get(left.key)!.count;
          const rightSpace = capacities.get(right.key)! - records.get(right.key)!.count;
          const leftScore = suitability.get(left.key)! + leftSpace * 0.08;
          const rightScore = suitability.get(right.key)! + rightSpace * 0.08;
          return rightScore - leftScore || left.key.localeCompare(right.key);
        });
      const targetChunk = candidates[0];
      if (!targetChunk) continue;
      const targetSuitability = suitability.get(targetChunk.key)!;
      if (targetSuitability + 0.08 < sourceSuitability) continue;
      const chance =
        species.migrationChancePerStep *
        (0.55 + activity * 0.45) *
        (0.8 + Math.max(0, targetSuitability - sourceSuitability));
      if (
        unitHash(state.worldSeed, tick, speciesId, sourceChunk.key, "migration") >=
        chance
      ) {
        continue;
      }
      source.count -= 1;
      migrationBudgets.set(sourceChunk.key, migrationBudgets.get(sourceChunk.key)! - 1);
      records.get(targetChunk.key)!.count += 1;
      transitions.push(
        makeTransition(
          tick,
          "migration",
          speciesId,
          1,
          sourceChunk.key,
          targetChunk.key,
        ),
      );
    }

    for (const chunk of chunks) {
      const record = records.get(chunk.key)!;
      const capacity = capacities.get(chunk.key)!;
      if (record.count >= capacity || capacity === 0) continue;
      const emptyFraction = (capacity - record.count) / capacity;
      const chance =
        species.immigrationChancePerStep *
        suitability.get(chunk.key)! *
        (0.4 + emptyFraction * 0.9);
      if (
        unitHash(state.worldSeed, tick, speciesId, chunk.key, "immigration") < chance
      ) {
        record.count += 1;
        transitions.push(
          makeTransition(tick, "immigration", speciesId, 1, undefined, chunk.key),
        );
      }
    }
  }
}

/** Creates a compact ecology save, optionally seeding the first active chunks. */
export function createEcologyState(
  worldSeed: string | number,
  frame?: Partial<EcologyEnvironmentFrame> &
    Pick<EcologyEnvironmentFrame, "activeChunks">,
): EcologyState {
  const state: EcologyState = {
    version: ECOLOGY_VERSION,
    worldSeed: String(worldSeed),
    simulatedThroughTick: normalizeTick(frame?.tick ?? 0),
    populations: {},
  };
  ensureActivePopulations(state, normalizedChunks(frame?.activeChunks ?? []), clamp(frame?.rainIntensity ?? 0));
  return state;
}

/**
 * Advances active chunk summaries without mutating the supplied state. Inactive
 * chunk records remain frozen and compact, ready for a later revisit.
 */
export function advanceEcology(
  currentState: EcologyState,
  frame: EcologyEnvironmentFrame,
): EcologyAdvanceResult {
  const targetTick = normalizeTick(frame.tick);
  if (targetTick < currentState.simulatedThroughTick) {
    throw new RangeError("Ecology cannot advance backwards");
  }
  const startStep = Math.floor(currentState.simulatedThroughTick / ECOLOGY_STEP_TICKS);
  const endStep = Math.floor(targetTick / ECOLOGY_STEP_TICKS);
  if (endStep - startStep > MAX_ADVANCE_STEPS) {
    throw new RangeError("Ecology catch-up exceeds the supported step budget");
  }

  const state = cloneEcologyState(currentState);
  const chunks = normalizedChunks(frame.activeChunks);
  ensureActivePopulations(state, chunks, clamp(frame.rainIntensity));
  const transitions: EcologyTransition[] = [];

  for (let step = startStep + 1; step <= endStep; step += 1) {
    applyPopulationStep(
      state,
      frame,
      chunks,
      step * ECOLOGY_STEP_TICKS,
      transitions,
    );
  }
  state.simulatedThroughTick = targetTick;
  return { state, transitions };
}
