import type { BiomeId } from "../world/generation";
import { gameHoursToSimulationSeconds } from "./time";

export const SMOKING_RACK_FIRE_RADIUS = 4.5;
export const SMOKING_RACK_BASE_GAME_HOURS = 2;
export const SMOKING_RACK_REQUIRED_PROGRESS_SECONDS =
  gameHoursToSimulationSeconds(SMOKING_RACK_BASE_GAME_HOURS);

export type SmokingRackEnvironmentBlocker =
  | "fire-unlit"
  | "fire-too-far"
  | "rain-exposed";

export interface SmokingRackBiomeRule {
  rateMultiplier: number;
  exposedRainPauseThreshold: number;
}
export const SMOKING_RACK_BIOME_RULES: Readonly<
  Record<BiomeId, SmokingRackBiomeRule>
> = {
  "rocky-highland": {
    rateMultiplier: 1.3,
    exposedRainPauseThreshold: 0.55,
  },
  "palm-grove": {
    rateMultiplier: 1.1,
    exposedRainPauseThreshold: 0.45,
  },
  "evergreen-rainforest": {
    rateMultiplier: 0.9,
    exposedRainPauseThreshold: 0.35,
  },
  "river-wetland": {
    rateMultiplier: 0.7,
    exposedRainPauseThreshold: 0.25,
  },
  swamp: {
    rateMultiplier: 0.55,
    exposedRainPauseThreshold: 0.2,
  },
};

export interface SmokingRackEnvironmentInput {
  biome: BiomeId;
  rainIntensity: number;
  sheltered: boolean;
  fireLit: boolean;
  distanceToFire: number | null;
}

export interface ResolvedSmokingRackEnvironment {
  biome: BiomeId;
  active: boolean;
  blocker: SmokingRackEnvironmentBlocker | null;
  rateMultiplier: number;
  exposedRainPauseThreshold: number;
  estimatedSimulationSeconds: number;
}

/**
 * Pure environment contract shared by simulation, affordance text and tests.
 * Shelter removes direct rain interruption but never erases a biome's humidity
 * rate, so choosing a drier camp remains a real systemic advantage.
 */
export function resolveSmokingRackEnvironment(
  input: SmokingRackEnvironmentInput,
): ResolvedSmokingRackEnvironment {
  const rule = SMOKING_RACK_BIOME_RULES[input.biome];
  let blocker: SmokingRackEnvironmentBlocker | null = null;
  if (!input.fireLit) blocker = "fire-unlit";
  else if (
    input.distanceToFire === null ||
    input.distanceToFire > SMOKING_RACK_FIRE_RADIUS
  ) {
    blocker = "fire-too-far";
  } else if (
    !input.sheltered &&
    input.rainIntensity >= rule.exposedRainPauseThreshold
  ) {
    blocker = "rain-exposed";
  }
  return {
    biome: input.biome,
    active: blocker === null,
    blocker,
    rateMultiplier: rule.rateMultiplier,
    exposedRainPauseThreshold: rule.exposedRainPauseThreshold,
    estimatedSimulationSeconds:
      SMOKING_RACK_REQUIRED_PROGRESS_SECONDS / rule.rateMultiplier,
  };
}
