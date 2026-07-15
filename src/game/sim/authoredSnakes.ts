import { ECOLOGY_SPECIES } from "../ecology";
import type {
  EcologyBehavior,
  EcologyRenderProjection,
} from "../ecology";
import {
  WORLD_CHUNK_SIZE,
  chunkKey,
  worldToChunkCoordinate,
} from "../world/generation";
import { gameHoursToTicks } from "./time";
import type { GameState, WorldEntity } from "./types";

export const AUTHORED_SNAKE_SPECIES_ID = "coiled-viper" as const;
export const AUTHORED_SNAKE_ID_PREFIX = "authored-snake:";
export const AUTHORED_SNAKE_CONTACT_RANGE = 1.65;
export const AUTHORED_SNAKE_DEATH_PRESENTATION_TICKS = 45;
export const AUTHORED_SNAKE_HURT_PRESENTATION_TICKS = 36;
export const AUTHORED_SNAKE_RECOVERY_TICKS = 90;

export function isAuthoredSnakeEntity(entity: WorldEntity): boolean {
  return (
    entity.kind === "hazard" &&
    (entity.id.includes("snake") ||
      (entity.tags.includes("animal") && entity.tags.includes("threat")))
  );
}

export function authoredSnakeIndividualId(entityId: string): string {
  return `${AUTHORED_SNAKE_ID_PREFIX}${entityId}`;
}

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function horizontalDistance(
  left: GameState["player"]["position"],
  right: WorldEntity["position"],
): number {
  return Math.hypot(left.x - right.x, left.z - right.z);
}

function behaviorAt(
  state: GameState,
  entity: WorldEntity,
  health: number,
): EcologyBehavior {
  const individual = state.ecology?.individuals?.[
    authoredSnakeIndividualId(entity.id)
  ];
  if (health <= 0) return "dead";
  if (
    individual?.lastContactTick !== undefined &&
    individual.lastContactTick !== null &&
    state.clock.tick - individual.lastContactTick <=
      AUTHORED_SNAKE_RECOVERY_TICKS
  ) {
    return "recover";
  }
  if (
    individual &&
    state.clock.tick - individual.lastHitTick <=
      AUTHORED_SNAKE_HURT_PRESENTATION_TICKS
  ) {
    return "hurt";
  }
  const distance = horizontalDistance(state.player.position, entity.position);
  if (distance <= AUTHORED_SNAKE_CONTACT_RANGE) return "coil";
  if (distance <= ECOLOGY_SPECIES[AUTHORED_SNAKE_SPECIES_ID].encounter.awarenessRadius) {
    return "defend";
  }
  return "shelter";
}

/**
 * Converts authored route anchors into stable ecology actors. The authored
 * entity supplies identity and home position; only player-authored injury,
 * death and contact memory occupy save bytes.
 */
export function projectAuthoredSnakesForRender(
  state: GameState,
): EcologyRenderProjection[] {
  const species = ECOLOGY_SPECIES[AUTHORED_SNAKE_SPECIES_ID];
  return Object.values(state.world.entities)
    .filter(isAuthoredSnakeEntity)
    .sort((left, right) => left.id.localeCompare(right.id))
    .flatMap((entity) => {
      const individualId = authoredSnakeIndividualId(entity.id);
      const condition = state.ecology?.individuals?.[individualId];
      const pendingMeat = Math.max(0, condition?.pendingMeat ?? 0);
      const pendingHide = Math.max(0, condition?.pendingHide ?? 0);
      const hasPendingLoot = pendingMeat + pendingHide > 0;
      const defeated = Boolean(
        condition &&
          condition.health <= 0 &&
          (hasPendingLoot ||
            condition.respawnAtTick === null ||
            condition.respawnAtTick > state.clock.tick),
      );
      const showDeath = Boolean(
        defeated &&
          (hasPendingLoot ||
            (condition?.defeatedAtTick !== null &&
              condition?.defeatedAtTick !== undefined &&
              state.clock.tick - condition.defeatedAtTick <=
                AUTHORED_SNAKE_DEATH_PRESENTATION_TICKS)),
      );
      if (defeated && !showDeath) return [];

      const distance = horizontalDistance(state.player.position, entity.position);
      if (distance > WORLD_CHUNK_SIZE * 3) return [];
      const health = defeated
        ? 0
        : condition && condition.health > 0
          ? clamp(condition.health, 0, condition.maxHealth)
          : species.combat.maxHealth;
      const awareness = clamp(1 - distance / species.encounter.awarenessRadius);
      const headingRadians = awareness > 0
        ? Math.atan2(
            state.player.position.x - entity.position.x,
            state.player.position.z - entity.position.z,
          )
        : 0;
      const homeChunkKey = chunkKey(
        worldToChunkCoordinate(entity.position.x, entity.position.z),
      );

      return [{
        individualId,
        populationKey: `authored|${entity.id}`,
        speciesId: AUTHORED_SNAKE_SPECIES_ID,
        label: entity.label,
        role: "predator" as const,
        chunkKey: homeChunkKey,
        position: { ...entity.position },
        headingRadians,
        scale: 0.9,
        activity: 1,
        visibility: 1,
        visible: true,
        behavior: behaviorAt(state, entity, health),
        awareness,
        health,
        maxHealth: species.combat.maxHealth,
        ...(pendingMeat > 0 ? { pendingMeat } : {}),
        ...(pendingHide > 0 ? { pendingHide } : {}),
        encounter: species.encounter,
      }];
    });
}

/** Converts one-shot legacy hazard depletion into the new sparse death memory. */
export function migrateLegacyAuthoredSnakes(state: GameState): void {
  state.ecology ??= {
    version: 1,
    worldSeed: String(state.seed),
    simulatedThroughTick: state.clock.tick,
    populations: {},
    individuals: {},
  };
  state.ecology.individuals ??= {};
  const species = ECOLOGY_SPECIES[AUTHORED_SNAKE_SPECIES_ID];
  for (const entity of Object.values(state.world.entities)) {
    if (!isAuthoredSnakeEntity(entity)) continue;
    const individualId = authoredSnakeIndividualId(entity.id);
    if (entity.depleted && !state.ecology.individuals[individualId]) {
      state.ecology.individuals[individualId] = {
        speciesId: AUTHORED_SNAKE_SPECIES_ID,
        health: 0,
        maxHealth: species.combat.maxHealth,
        lastHitTick: state.clock.tick,
        defeatedAtTick: state.clock.tick,
        respawnAtTick:
          state.clock.tick + gameHoursToTicks(species.combat.recoveryGameHours),
        lastContactTick: null,
      };
    }
    // The authored node is now immutable home-position data; ecology owns life.
    entity.depleted = false;
    entity.quantity = Math.max(1, entity.quantity);
  }
}
