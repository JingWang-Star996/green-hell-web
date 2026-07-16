import { TORCH_BURN_SEGMENT_SECONDS } from "../sim/content";
import { getDurableToolInventoryStatus } from "../sim/lifecycle";
import { simulationSecondsToGameMinutes } from "../sim/time";
import type { DurableToolId, GameState } from "../sim/types";
import type {
  DurableToolUnitView,
  InventoryStatusTone,
  WaterContainerLifecycleView,
} from "./types";

type WaterContainerRole = WaterContainerLifecycleView["role"];

/**
 * Projects the single coconut-shell pool as a conserved lifecycle. If an old or
 * malformed payload records more occupied shells than its total, the view keeps
 * every occupied shell visible and derives the smallest physically possible
 * total without mutating the save.
 */
export function createWaterContainerLifecycleView(
  state: GameState,
  role: WaterContainerRole,
): WaterContainerLifecycleView {
  const recordedTotal = normalizedCount(state.inventory["coconut-shell"]);
  const dirtyWater = normalizedCount(state.inventory["dirty-water"]);
  const cleanWater = normalizedCount(state.inventory["clean-water"]);
  const total = Math.max(recordedTotal, dirtyWater + cleanWater);

  return {
    role,
    total,
    empty: total - dirtyWater - cleanWater,
    dirtyWater,
    cleanWater,
  };
}

/**
 * The lifecycle selector already returns weakest-first order, which is also the
 * order used by simulation ownership transfers. Every torch carries its own
 * exact remaining seconds, including while stowed or behind another unit.
 */
export function createDurableToolUnitViews(
  state: GameState,
  itemId: DurableToolId,
): DurableToolUnitView[] {
  const status = getDurableToolInventoryStatus(state, itemId);

  return status.durabilities.map((rawDurability, index) => {
    const remainingUseSeconds = status.remainingUseSeconds?.[index];
    const durability =
      itemId === "torch" && remainingUseSeconds !== undefined
        ? remainingUseSeconds / TORCH_BURN_SEGMENT_SECONDS
        : rawDurability;
    const statusTone = durabilityTone(durability, status.maxDurability);
    const role: DurableToolUnitView["role"] =
      index === 0
        ? state.player.equippedItem === itemId
          ? "equipped"
          : "next-use"
        : "reserve";

    if (itemId === "torch") {
      const remainingGameMinutes = simulationSecondsToGameMinutes(
        remainingUseSeconds ?? durability * TORCH_BURN_SEGMENT_SECONDS,
      );
      return {
        useOrder: index + 1,
        role,
        durability,
        maxDurability: status.maxDurability,
        remainingGameMinutes,
        statusLabel: `${formatTorchTime(remainingGameMinutes)} · ${formatDurability(durability)}/${status.maxDurability} 段`,
        statusTone,
      };
    }

    return {
      useOrder: index + 1,
      role,
      durability,
      maxDurability: status.maxDurability,
      statusLabel: `耐久 ${formatDurability(durability)}/${status.maxDurability}`,
      statusTone,
    };
  });
}

function normalizedCount(value: number): number {
  return Math.max(0, Math.floor(finiteNumber(value)));
}

function finiteNumber(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function durabilityTone(
  durability: number,
  maxDurability: number,
): InventoryStatusTone {
  const ratio = maxDurability > 0 ? durability / maxDurability : 0;
  return ratio <= 0.2 ? "danger" : ratio <= 0.5 ? "warning" : "stable";
}

function formatDurability(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatTorchTime(gameMinutes: number): string {
  if (gameMinutes <= 0) return "余燃已耗尽";
  if (gameMinutes >= 60) {
    return `余燃约 ${(gameMinutes / 60).toFixed(1)} 游戏小时`;
  }
  return `余燃约 ${Math.max(1, Math.ceil(gameMinutes))} 游戏分钟`;
}
