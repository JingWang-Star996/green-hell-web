import type {
  EcologyActivityPattern,
  EcologySpeciesDefinition,
  EcologySpeciesId,
} from "./types";

/** Original species for this project; none of these names are taken from Green Hell. */
export const ECOLOGY_SPECIES: Readonly<
  Record<EcologySpeciesId, EcologySpeciesDefinition>
> = {
  "reedtail-scuttler": {
    id: "reedtail-scuttler",
    label: "芦尾窜兽",
    role: "small-prey",
    activityPattern: "crepuscular",
    biomeAffinity: {
      "evergreen-rainforest": 0.92,
      "river-wetland": 0.78,
      "palm-grove": 1,
      swamp: 0.52,
      "rocky-highland": 0.2,
    },
    preferredMoisture: [0.42, 0.88],
    preferredCanopy: [0.45, 0.92],
    preferredRain: [0.05, 0.68],
    baseCarryingCapacity: 9,
    birthChancePerStep: 0.2,
    immigrationChancePerStep: 0.12,
    departureChancePerStep: 0.025,
    migrationChancePerStep: 0.13,
    minimumResidentsBeforeMigration: 2,
    movementRadius: 4.8,
    encounter: {
      kind: "huntable-prey",
      awarenessRadius: 8,
      dangerLevel: 0,
    },
  },
  "mossback-grazer": {
    id: "mossback-grazer",
    label: "苔背阔吻兽",
    role: "large-herbivore",
    activityPattern: "diurnal",
    biomeAffinity: {
      "evergreen-rainforest": 0.82,
      "river-wetland": 0.86,
      "palm-grove": 1,
      swamp: 0.32,
      "rocky-highland": 0.46,
    },
    preferredMoisture: [0.3, 0.78],
    preferredCanopy: [0.24, 0.82],
    preferredRain: [0, 0.58],
    baseCarryingCapacity: 4,
    birthChancePerStep: 0.075,
    immigrationChancePerStep: 0.065,
    departureChancePerStep: 0.02,
    migrationChancePerStep: 0.085,
    minimumResidentsBeforeMigration: 1,
    movementRadius: 3.2,
    encounter: {
      kind: "wary-herbivore",
      awarenessRadius: 13,
      dangerLevel: 0.16,
    },
  },
  "glassfang-stalker": {
    id: "glassfang-stalker",
    label: "琥珀环猎兽",
    role: "predator",
    activityPattern: "nocturnal",
    biomeAffinity: {
      "evergreen-rainforest": 0.88,
      "river-wetland": 0.58,
      "palm-grove": 0.42,
      swamp: 1,
      "rocky-highland": 0.72,
    },
    preferredMoisture: [0.48, 1],
    preferredCanopy: [0.5, 1],
    preferredRain: [0.12, 0.92],
    baseCarryingCapacity: 2,
    birthChancePerStep: 0.035,
    immigrationChancePerStep: 0.045,
    departureChancePerStep: 0.035,
    migrationChancePerStep: 0.15,
    minimumResidentsBeforeMigration: 0,
    movementRadius: 6.2,
    encounter: {
      kind: "danger",
      awarenessRadius: 16,
      dangerLevel: 0.82,
    },
  },
};

function circularHourDistance(left: number, right: number): number {
  const direct = Math.abs(left - right) % 24;
  return Math.min(direct, 24 - direct);
}
function peakActivity(hour: number, peakHour: number, halfWidth: number): number {
  const distance = circularHourDistance(hour, peakHour);
  return Math.max(0, 1 - distance / halfWidth);
}

/** Returns a 0..1 activity score without changing population state. */
export function activityAtMinute(
  pattern: EcologyActivityPattern,
  minuteOfDay: number,
): number {
  const normalizedMinute = ((minuteOfDay % 1440) + 1440) % 1440;
  const hour = normalizedMinute / 60;
  switch (pattern) {
    case "diurnal":
      return 0.12 + 0.88 * peakActivity(hour, 13, 7);
    case "nocturnal":
      return 0.1 + 0.9 * peakActivity(hour, 0, 7);
    case "crepuscular":
      return (
        0.08 +
        0.92 *
          Math.max(peakActivity(hour, 6, 3.5), peakActivity(hour, 18, 3.5))
      );
  }
}
