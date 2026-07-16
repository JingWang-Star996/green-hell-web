import type { SimulationClock } from "./types";

/** The deterministic simulation always advances at thirty fixed ticks per second. */
export const FIXED_HZ = 30;
export const FIXED_DT_SECONDS = 1 / FIXED_HZ;

/**
 * A full game day lasts forty-eight real/simulation minutes.
 *
 * Green Hell's roughly twenty-four minute baseline is deliberately doubled for
 * this browser game: reading panels and learning keyboard controls must not
 * consume half a day. All authored durations are converted through this value
 * so changing the accessibility preset later remains a data change.
 */
export const GAME_DAY_SIMULATION_SECONDS = 48 * 60;
export const GAME_MINUTES_PER_DAY = 24 * 60;
export const START_MINUTE_OF_DAY = 14 * 60;
export const REST_GAME_HOURS = 8;
export const FIRE_FUEL_PER_STICK_SECONDS = gameHoursToSimulationSeconds(2);
export const MAXIMUM_FIRE_FUEL_SECONDS = gameHoursToSimulationSeconds(12);

/** Removes harmless binary drift without rounding ordinary fractional minutes up. */
export function gameMinuteForDisplay(totalMinutes: number): number {
  return Math.floor(totalMinutes + 1e-6);
}

export function gameMinutesToSimulationSeconds(gameMinutes: number): number {
  return (gameMinutes / GAME_MINUTES_PER_DAY) * GAME_DAY_SIMULATION_SECONDS;
}

export function gameHoursToSimulationSeconds(gameHours: number): number {
  return gameMinutesToSimulationSeconds(gameHours * 60);
}

export function simulationSecondsToGameMinutes(seconds: number): number {
  return (seconds / GAME_DAY_SIMULATION_SECONDS) * GAME_MINUTES_PER_DAY;
}

export function gameHoursToTicks(gameHours: number): number {
  return Math.max(
    0,
    Math.round(gameHoursToSimulationSeconds(gameHours) * FIXED_HZ),
  );
}

/**
 * Legacy saves only stored day/minute. Recover the monotonic calendar offset
 * from those fields instead of reinterpreting elapsed real seconds at the new
 * time scale (which would visibly rewind the clock after an update).
 */
export function inferGameMinutesElapsed(clock: SimulationClock): number {
  if (
    typeof clock.gameMinutesElapsed === "number" &&
    Number.isFinite(clock.gameMinutesElapsed)
  ) {
    return Math.max(0, clock.gameMinutesElapsed);
  }
  const day = Number.isFinite(clock.day) ? Math.max(1, Math.floor(clock.day)) : 1;
  const minuteOfDay = Number.isFinite(clock.minuteOfDay)
    ? ((clock.minuteOfDay % GAME_MINUTES_PER_DAY) + GAME_MINUTES_PER_DAY) %
      GAME_MINUTES_PER_DAY
    : START_MINUTE_OF_DAY;
  return Math.max(
    0,
    (day - 1) * GAME_MINUTES_PER_DAY + minuteOfDay - START_MINUTE_OF_DAY,
  );
}

export function synchronizeCalendar(clock: SimulationClock): void {
  const gameMinutesElapsed = inferGameMinutesElapsed(clock);
  const absoluteMinutes = START_MINUTE_OF_DAY + gameMinutesElapsed;
  clock.gameMinutesElapsed = gameMinutesElapsed;
  clock.day = Math.floor(absoluteMinutes / GAME_MINUTES_PER_DAY) + 1;
  clock.minuteOfDay =
    ((absoluteMinutes % GAME_MINUTES_PER_DAY) + GAME_MINUTES_PER_DAY) %
    GAME_MINUTES_PER_DAY;
}

export function advanceClockOneTick(clock: SimulationClock): void {
  clock.tick += 1;
  clock.elapsedSeconds = clock.tick * FIXED_DT_SECONDS;
  clock.gameMinutesElapsed =
    inferGameMinutesElapsed(clock) +
    GAME_MINUTES_PER_DAY / (GAME_DAY_SIMULATION_SECONDS * FIXED_HZ);
  synchronizeCalendar(clock);
}
