export type VisualPieceTransform = Readonly<{
  x: number;
  y: number;
  z: number;
  yaw: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
}>;

const MAX_VISIBLE_LOOSE_STONES = 5;
const PEBBLES_PER_CLUSTER = 5;

/**
 * A pickup pile is made from flat hand-sized stones. Quantity only changes how
 * many of these stable pieces are visible, never the pile's interaction ID.
 */
export function looseStonePieceTransforms(
  quantity: number,
): readonly VisualPieceTransform[] {
  const count = Math.max(
    0,
    Math.min(MAX_VISIBLE_LOOSE_STONES, Math.floor(quantity)),
  );
  const layout: readonly VisualPieceTransform[] = [
    { x: -0.13, y: 0.055, z: 0.03, yaw: 0.18, scaleX: 0.14, scaleY: 0.055, scaleZ: 0.105 },
    { x: 0.13, y: 0.06, z: -0.04, yaw: 1.02, scaleX: 0.13, scaleY: 0.06, scaleZ: 0.1 },
    { x: 0.01, y: 0.075, z: 0.15, yaw: 2.1, scaleX: 0.15, scaleY: 0.07, scaleZ: 0.11 },
    { x: -0.03, y: 0.14, z: -0.01, yaw: 0.7, scaleX: 0.12, scaleY: 0.055, scaleZ: 0.095 },
    { x: 0.18, y: 0.11, z: 0.13, yaw: 2.72, scaleX: 0.11, scaleY: 0.05, scaleZ: 0.09 },
  ];
  return layout.slice(0, count);
}

/** Five low-contrast grains read as ground texture, never as one pickup. */
export function pebbleClusterTransforms(
  phase: number,
): readonly VisualPieceTransform[] {
  return Array.from({ length: PEBBLES_PER_CLUSTER }, (_, index) => {
    const angle = phase + index * 2.17;
    const radius = 0.11 + (index % 3) * 0.055;
    const halfWidth = 0.022 + (index % 3) * 0.006;
    return {
      x: Math.cos(angle) * radius,
      y: 0.01 + (index % 2) * 0.004,
      z: Math.sin(angle) * radius,
      yaw: angle * 1.7,
      scaleX: halfWidth,
      scaleY: 0.008 + (index % 2) * 0.004,
      scaleZ: halfWidth * (0.72 + (index % 2) * 0.12),
    };
  });
}

export const ROCK_VISUAL_LIMITS = {
  looseStone: {
    minimumWidth: 0.22,
    maximumWidth: 0.34,
    minimumHeight: 0.08,
    maximumHeight: 0.16,
  },
  pebble: { maximumWidth: 0.1, maximumHeight: 0.05 },
} as const;
