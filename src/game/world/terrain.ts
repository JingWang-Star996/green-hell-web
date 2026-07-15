/**
 * Shared low-cost terrain truth used by rendering, movement and authoritative
 * interactions. Keep the river dimensions here so a visible bank cannot
 * disagree with placement, wading, focus, or simulation reach.
 */
export const RIVER_SURFACE_HALF_WIDTH = 2.25;
export const RIVER_WADING_HALF_WIDTH = 1.65;
export const RIVER_MUD_HALF_WIDTH = 3.1;
export const RIVER_SURFACE_Y_OFFSET = 0.18;
export const RIVER_USE_RANGE = 2.6;

export function riverCenter(x: number): number {
  return -17 + Math.sin(x * 0.09) * 3;
}

export function riverDistance(x: number, z: number): number {
  return Math.abs(z - riverCenter(x));
}

export function terrainHeight(x: number, z: number): number {
  const broad = Math.sin(x * 0.075) * 0.55 + Math.cos(z * 0.068) * 0.62;
  const detail =
    Math.sin((x + z) * 0.16) * 0.18 +
    Math.cos((x - z) * 0.11) * 0.22;
  const ridge = Math.max(0, 1 - Math.hypot(x - 39, z + 31) / 26) * 4.4;
  const stationPlateau =
    Math.max(0, 1 - Math.hypot(x - 33, z - 27) / 12) * 1.3;
  const riverCut = Math.max(0, 1 - riverDistance(x, z) / 4.3) * 2.1;
  return broad + detail + ridge + stationPlateau - riverCut;
}

/** The river is level across each cross-section and follows the carved bed. */
export function riverSurfaceHeight(x: number, levelMeters = 0): number {
  return terrainHeight(x, riverCenter(x)) + RIVER_SURFACE_Y_OFFSET + levelMeters;
}

export function terrainSlopeAcross(
  x: number,
  z: number,
  radius: number,
): number {
  const heights = [
    terrainHeight(x - radius, z),
    terrainHeight(x + radius, z),
    terrainHeight(x, z - radius),
    terrainHeight(x, z + radius),
  ];
  return Math.max(...heights) - Math.min(...heights);
}
