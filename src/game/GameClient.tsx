"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react";
import { AudioEngine } from "./audio/AudioEngine";
import {
  INITIAL_SAVE_STATUS,
  SaveCoordinator,
  ToyBridgeCloudKV,
  autosaveReasonForEvents,
  createSaveFileText,
  createSaveRepository,
  MAX_SAVE_FILE_BYTES,
  parseSaveFileText,
  runVerifiedCheckpointTransaction,
  saveFileFailureLabel,
  saveStatusLabel,
  type KVStorageDurability,
  type CheckpointMetadataDraft,
  type CheckpointReason,
  type CheckpointSlotId,
  type CheckpointTimelineEntry,
  type ManualCheckpointSlotId,
  type SaveReason,
  type SaveRepository,
  type SaveStatus,
} from "./persistence";
import { createToyBridgeClient, type ToyBridgeClient } from "./platform/toyBridge";
import type { RainforestRenderer } from "./render/RainforestRenderer";
import { resolvePersonalLightProfile } from "./render/NightLightRig";
import type { PlaceableStructureKind } from "./render/PlacementPreview";
import { projectWindPresentation } from "./render/windPresentation";
import {
  resolveEffectiveReducedMotion,
} from "./render/campfireFeedback";
import {
  createCampfireFeedbackCursor,
  resolveCampfireFeedbackFrame,
  type CampfireFeedbackCursorState,
} from "./render/campfireFeedbackFrame";
import type {
  ActionPhase,
  InteractionTarget,
  PlayerFrame,
  TouchInput,
} from "./render/types";
import {
  affordanceAcceptsInput,
  applyCommand,
  createInitialState,
  deriveDamageIncidents,
  deriveDeathReview,
  deriveStatusSignals,
  distanceBetween,
  migrateGameState,
  mergeTimedDamageIncidents,
  pruneExpiredDamageIncidents,
  RECIPE_IDS,
  nearestPlacedStructure,
  STRUCTURE_USE_RADII,
  TASKS,
  stepSimulation,
  type GameCommand,
  type GameState,
  type EquippableItemId,
  type TimedDamageIncident,
  type ItemId,
  type RecipeId,
  type StatusSignal,
} from "./sim";
import { getCampStructureById } from "./sim/selectors";
import {
  authoredSnakeIndividualId,
  isAuthoredSnakeEntity,
} from "./sim/authoredSnakes";
import { Hud } from "./ui/Hud";
import { EquipmentBar } from "./ui/EquipmentBar";
import { CheckpointTimelinePanel, Panels } from "./ui/Panels";
import { StartScreen } from "./ui/StartScreen";
import { TouchControls } from "./ui/TouchControls";
import { ActionFeedbackLayer } from "./ui/ActionFeedbackLayer";
import { DeathReview } from "./ui/DeathReview";
import { PlayerStateFeedback } from "./ui/PlayerStateFeedback";
import {
  nextActivePanel,
  normalizeMenuShortcutCode,
  resolveMenuKeyAction,
} from "./ui/menuShortcuts";
export { nextActivePanel } from "./ui/menuShortcuts";
import type {
  SaveImportPreview,
  SaveTransferState,
} from "./ui/SaveTransferControls";
import {
  createActionReceipt,
  enqueueActionReceipt,
  pruneExpiredActionReceipts,
  type ActionReceipt,
} from "./ui/actionReceipt";
import type { InventoryItemView, PanelId } from "./ui/types";
import {
  DEFAULT_UI_SETTINGS,
  normalizeUiScale,
  readUiSettings,
  uiScaleFactor,
  writeUiSettings,
} from "./ui/uiSettings";
import { createGameViewModel } from "./ui/viewModel";
import {
  BIOME_PROFILES,
  generateChunkDescriptor,
  worldToChunkCoordinate,
} from "./world/generation";
import { parseRiverWaterTargetId } from "./world/riverWater";

const SAVE_KEY = "canopy_first_night_v2";
const CONTENT_VERSION = "canopy-first-night@7";
const LEGACY_CONTENT_VERSIONS = [
  "canopy-first-night@6",
  "canopy-first-night@5",
  "canopy-first-night@4",
  "canopy-first-night@3",
] as const;
const KNOWLEDGE_KEY = "canopy_field_knowledge_v1";
const SIMULATION_INTERVAL_MS = 100;
const PERIODIC_SAVE_INTERVAL_MS = 60_000;
const SILENT_CAMPFIRE_AUDIO = {
  loopGain: 0,
  crackleRatePerSecond: 0,
  lowPassHertz: 800,
} as const;
const BUILD_RECIPE_IDS = new Set<RecipeId>([
  "campfire",
  "shelter",
  "bed",
  "smoking-rack",
  "rain-collector",
  "torch-waymark",
]);
const MANUAL_SLOT_NUMBER: Record<ManualCheckpointSlotId, number> = {
  "manual-1": 1,
  "manual-2": 2,
  "manual-3": 3,
};

type PendingSaveImport = {
  state: GameState;
  retainedRecipeIds: string[];
  preview: SaveImportPreview;
};

type PendingCheckpointRecovery = {
  slotId: CheckpointSlotId;
  state: GameState;
  entry: CheckpointTimelineEntry;
};

type CheckpointRecoveryState =
  | { phase: "idle" }
  | { phase: "preview"; entry: CheckpointTimelineEntry }
  | { phase: "loading"; entry: CheckpointTimelineEntry }
  | { phase: "complete"; message: string }
  | { phase: "error"; message: string };

type RestCheckpointBarrier =
  | { phase: "idle" }
  | { phase: "saving"; message: string }
  | { phase: "failed"; message: string };

/**
 * Maps a resolved world capability to an existing authoritative simulation
 * command. Unsupported actions intentionally return null instead of faking a
 * result in React or the renderer.
 */
export function commandForInteraction(
  state: GameState,
  target: InteractionTarget,
): GameCommand | null {
  const { affordance } = target;
  if (!affordanceAcceptsInput(affordance)) return null;

  const entity = state.world.entities[target.id];
  const semanticHarvest = Boolean(
    entity &&
      (entity.tags.includes("standing-tree") ||
        entity.semantic?.category === "tree" ||
        entity.semantic?.category === "mineable-rock" ||
        entity.semantic?.category === "harvestable-plant"),
  );
  switch (affordance.actionId) {
    case "pickup": {
      if (!entity || entity.kind !== "resource") return null;
      return semanticHarvest
        ? { type: "harvest", entityId: entity.id }
        : { type: "pick-up", entityId: entity.id, amount: 1 };
    }
    case "cut":
    case "chop":
    case "mine":
      return entity?.kind === "resource" && semanticHarvest
        ? {
            type: "physical-action",
            targetId: entity.id,
            actionId: affordance.actionId,
            poseRevision: Math.max(
              0,
              Math.floor(state.player.poseRevision ?? 0),
            ),
          }
        : null;
    case "collect-water":
      return entity?.kind === "water" || parseRiverWaterTargetId(target.id)
        ? { type: "collect-water", sourceEntityId: target.id }
        : null;
    case "inspect":
      return entity && (entity.kind === "landmark" || entity.kind === "radio")
        ? { type: "inspect-landmark", entityId: entity.id }
        : null;
    case "add-fuel":
      return { type: "add-fuel", structureId: target.id };
    case "load-smoking-rack":
    case "collect-smoking-rack":
    case "clear-smoking-rack":
    case "collect-rain-collector":
    case "insert-torch-waymark":
    case "relight-torch-waymark":
    case "top-up-torch-waymark":
      return { type: "use-structure", structureId: target.id };
    case "rest":
      return { type: "rest", structureId: target.id };
    case "transmit":
      return { type: "transmit", structureId: target.id };
    case "attack":
      if (
        affordance.semanticKind === "wildlife" &&
        target.id.startsWith("wildlife:")
      ) {
        return {
          type: "physical-action",
          targetId: target.id,
          actionId: "attack",
          poseRevision: Math.max(
            0,
            Math.floor(state.player.poseRevision ?? 0),
          ),
        };
      }
      return entity && isAuthoredSnakeEntity(entity)
        ? {
            type: "physical-action",
            targetId: `wildlife:${authoredSnakeIndividualId(entity.id)}`,
            actionId: "attack",
            poseRevision: Math.max(
              0,
              Math.floor(state.player.poseRevision ?? 0),
            ),
          }
        : null;
    case "collect-wildlife-loot":
      return target.id.startsWith("wildlife:")
        ? {
            type: "collect-wildlife-loot",
            individualId: target.id.slice("wildlife:".length),
          }
        : null;
    case "dismantle":
      return entity?.kind === "resource" && entity.itemId === "battery"
        ? { type: "pick-up", entityId: entity.id, amount: 1 }
        : null;
    case "repair":
    case "observe":
    case "avoid":
    case "none":
      return null;
  }
}

/**
 * Commits the renderer's latest camera/player pose before any spatial world
 * command is constructed. The simulation remains authoritative, but it judges
 * the exact frame that showed the focus instead of a 100ms-old timer sample.
 */
export function synchronizeInteractionPlayerFrame(
  state: GameState,
  frame: Pick<PlayerFrame, "x" | "z" | "yaw" | "pitch">,
): GameState {
  return applyCommand(state, {
    type: "move-player",
    position: { x: frame.x, y: 0, z: frame.z },
    look: { yaw: frame.yaw, pitch: frame.pitch },
  });
}

function hasUsableRestTarget(
  state: GameState,
  command: Extract<GameCommand, { type: "rest" }>,
): boolean {
  const bed = command.structureId
    ? getCampStructureById(state, command.structureId)
    : nearestPlacedStructure(state, "bed");
  return Boolean(
    bed &&
    bed.kind === "bed" &&
    distanceBetween(state.player.position, bed.position) <= STRUCTURE_USE_RADII.bed,
  );
}

type CheckpointedEvent = {
  id: number;
  type: string;
};

/**
 * The verified rest transaction already owns the post-rest recovery point.
 * Mark only that completion event so presentation/audio still consume it while
 * the generic event autosave path cannot rotate a third automatic slot.
 */
export function markRestCompletionAsCheckpointed(
  events: readonly CheckpointedEvent[],
  afterEventId: number,
  checkpointedEventIds: Set<number>,
): number | null {
  const completion = events.find(
    (event) => event.id > afterEventId && event.type === "rest-completed",
  );
  if (!completion) return null;
  checkpointedEventIds.add(completion.id);
  return completion.id;
}

/** Consumes one-shot checkpoint ownership markers while preserving all other events. */
export function eventsNeedingAutosave<T extends { id: number }>(
  events: readonly T[],
  checkpointedEventIds: Set<number>,
): T[] {
  return events.filter((event) => !checkpointedEventIds.delete(event.id));
}

/**
 * A successful timeline write includes the repository's same-slot readback and
 * checksum verification, so `ok` is the authority for the initial recovery
 * point rather than an optimistic React flag.
 */
export function writeVerifiedNewGameCheckpoint(
  repository: SaveRepository<GameState>,
  state: GameState,
) {
  return repository.saveAutoCheckpoint(
    state,
    { seed: state.seed, simTick: state.clock.tick },
    createCheckpointMetadata(state, "new-game"),
  );
}

export type DialogEscapeAction = "none" | "consume" | "close";

export function resolveDialogEscapeAction(
  key: string,
  hasEscapeHandler: boolean,
  escapeDisabled: boolean,
): DialogEscapeAction {
  if (key !== "Escape" || !hasEscapeHandler) return "none";
  return escapeDisabled ? "consume" : "close";
}

export default function GameClient() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<RainforestRenderer | null>(null);
  const audioRef = useRef<AudioEngine | null>(null);
  const repositoryRef = useRef<SaveRepository<GameState> | null>(null);
  const saveCoordinatorRef = useRef<SaveCoordinator<GameState> | null>(null);
  const toyRef = useRef<ToyBridgeClient | null>(null);
  const stateRef = useRef<GameState | null>(null);
  const savedStateRef = useRef<GameState | null>(null);
  const activePanelRef = useRef<PanelId | null>(null);
  const playerFrameRef = useRef<PlayerFrame | null>(null);
  const commandRef = useRef<(command: GameCommand) => GameState | null>(() => null);
  const interactionRef = useRef<(target: InteractionTarget) => void>(() => undefined);
  const placementRecipeRef = useRef<RecipeId | null>(null);
  const lastEventIdRef = useRef(0);
  const damageIncidentCursorRef = useRef(0);
  const damageIncidentTimerRef = useRef<number | null>(null);
  const loadGenerationRef = useRef(0);
  const pendingNewGameClearRef = useRef(false);
  const stepDistanceRef = useRef(0);
  const enteredGameRef = useRef(false);
  const rendererReadyRef = useRef(false);
  const lastHudFrameRef = useRef(0);
  const lastEnvironmentFrameRef = useRef(0);
  const reducedMotionRef = useRef(false);
  const hazardCaptionTimerRef = useRef<number | null>(null);
  const actionReceiptSequenceRef = useRef(0);
  const campfireFeedbackCursorRef = useRef<CampfireFeedbackCursorState>(
    createCampfireFeedbackCursor(),
  );
  const pendingSaveImportRef = useRef<PendingSaveImport | null>(null);
  const pendingCheckpointRecoveryRef = useRef<PendingCheckpointRecovery | null>(null);
  const checkpointRecoveryInFlightRef = useRef(false);
  const restCheckpointBarrierRef = useRef(false);
  const checkpointedEventIdsRef = useRef<Set<number>>(new Set());
  const exportObjectUrlRef = useRef<string | null>(null);
  const [screen, setScreen] = useState<"menu" | "game">("menu");
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [canContinue, setCanContinue] = useState(false);
  const [saveDiscoveryComplete, setSaveDiscoveryComplete] = useState(false);
  const [activePanel, setActivePanel] = useState<PanelId | null>(null);
  const [target, setTarget] = useState<InteractionTarget | null>(null);
  const [pointerLocked, setPointerLocked] = useState(false);
  const [compassDegrees, setCompassDegrees] = useState(180);
  const [audioEnabled, setAudioEnabled] = useState(
    DEFAULT_UI_SETTINGS.audioEnabled,
  );
  const [reducedMotion, setReducedMotion] = useState(
    DEFAULT_UI_SETTINGS.reducedMotion,
  );
  const [uiScale, setUiScale] = useState(DEFAULT_UI_SETTINGS.uiScale);
  const [uiSettingsLoaded, setUiSettingsLoaded] = useState(false);
  const [systemReducedMotion, setSystemReducedMotion] = useState(false);
  const [rendererReady, setRendererReady] = useState(false);
  const [hurtFlash, setHurtFlash] = useState(0);
  const [statusSignals, setStatusSignals] = useState<StatusSignal[]>([]);
  const [damageIncidents, setDamageIncidents] = useState<
    TimedDamageIncident[]
  >([]);
  const [compatibilityError, setCompatibilityError] = useState<string | null>(null);
  const [hazardCaption, setHazardCaption] = useState<string | null>(null);
  const [retainedRecipes, setRetainedRecipes] = useState<RecipeId[]>(readRetainedRecipes);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>(INITIAL_SAVE_STATUS);
  const [placementRecipe, setPlacementRecipe] = useState<RecipeId | null>(null);
  const [actionReceipts, setActionReceipts] = useState<ActionReceipt[]>([]);
  const [actionPhase, setActionPhase] = useState<ActionPhase | null>(null);
  const [localSaveDurability, setLocalSaveDurability] =
    useState<KVStorageDurability>("persistent");
  const [hasPreImportSave, setHasPreImportSave] = useState(false);
  const [saveTransferState, setSaveTransferState] = useState<SaveTransferState>({
    phase: "idle",
  });
  const [checkpointEntries, setCheckpointEntries] = useState<CheckpointTimelineEntry[]>([]);
  const [recommendedCheckpointSlotId, setRecommendedCheckpointSlotId] =
    useState<CheckpointSlotId | null>(null);
  const [checkpointRecoveryState, setCheckpointRecoveryState] =
    useState<CheckpointRecoveryState>({ phase: "idle" });
  const [checkpointPickerOpen, setCheckpointPickerOpen] = useState(false);
  const [manualCheckpointSlot, setManualCheckpointSlot] =
    useState<ManualCheckpointSlotId | null>(null);
  const [restCheckpointBarrier, setRestCheckpointBarrier] =
    useState<RestCheckpointBarrier>({ phase: "idle" });
  const [checkpointNotice, setCheckpointNotice] = useState<string | null>(null);
  const effectiveReducedMotion = resolveEffectiveReducedMotion(
    reducedMotion,
    systemReducedMotion,
  );

  useEffect(() => {
    // Server output and the first hydration render intentionally share the
    // defaults. Apply browser-only settings immediately after hydration so a
    // saved scale never causes a React markup/style mismatch.
    const hydrationTimer = window.setTimeout(() => {
      const settings = readUiSettings();
      setAudioEnabled(settings.audioEnabled);
      setReducedMotion(settings.reducedMotion);
      setUiScale(settings.uiScale);
      setUiSettingsLoaded(true);
    }, 0);
    return () => window.clearTimeout(hydrationTimer);
  }, []);

  useEffect(() => {
    if (!uiSettingsLoaded) return;
    writeUiSettings({
      version: 1,
      uiScale,
      audioEnabled,
      reducedMotion,
    });
  }, [audioEnabled, reducedMotion, uiScale, uiSettingsLoaded]);

  useEffect(() => {
    if (!checkpointNotice) return;
    const timer = window.setTimeout(() => setCheckpointNotice(null), 5_200);
    return () => window.clearTimeout(timer);
  }, [checkpointNotice]);

  useEffect(() => {
    if (damageIncidentTimerRef.current !== null) {
      window.clearTimeout(damageIncidentTimerRef.current);
      damageIncidentTimerRef.current = null;
    }
    if (damageIncidents.length === 0) return;
    const now = performance.now();
    const nextExpiry = Math.min(
      ...damageIncidents.map((incident) => incident.expiresAtMilliseconds),
    );
    damageIncidentTimerRef.current = window.setTimeout(() => {
      damageIncidentTimerRef.current = null;
      setDamageIncidents((current) =>
        pruneExpiredDamageIncidents(current, performance.now()),
      );
    }, Math.max(0, nextExpiry - now) + 1);
    return () => {
      if (damageIncidentTimerRef.current !== null) {
        window.clearTimeout(damageIncidentTimerRef.current);
        damageIncidentTimerRef.current = null;
      }
    };
  }, [damageIncidents]);

  const view = useMemo(() => gameState ? createGameViewModel(gameState, retainedRecipes) : null, [gameState, retainedRecipes]);
  const gameStatus = gameState?.status ?? null;

  const commitState = useCallback((next: GameState) => {
    stateRef.current = next;
    const freshDamage = deriveDamageIncidents(next, {
      afterEventId: damageIncidentCursorRef.current,
      maximumAgeSeconds: null,
    });
    if (freshDamage.length > 0) {
      damageIncidentCursorRef.current = Math.max(
        damageIncidentCursorRef.current,
        ...freshDamage.map((incident) => incident.eventId),
      );
      const now = performance.now();
      setDamageIncidents((previous) =>
        mergeTimedDamageIncidents(previous, freshDamage, now),
      );
    }
    setStatusSignals((previous) =>
      deriveStatusSignals(next, { previousSignals: previous }),
    );
    setGameState(next);
  }, []);

  const refreshCheckpointTimeline = useCallback(() => {
    const repository = repositoryRef.current;
    if (!repository) return;
    const timeline = repository.listCheckpoints();
    setCheckpointEntries(timeline.entries);
    setRecommendedCheckpointSlotId(timeline.recommendedSlotId);
  }, []);

  const requestSave = useCallback((reason: SaveReason) => {
    const state = stateRef.current;
    const coordinator = saveCoordinatorRef.current;
    const repository = repositoryRef.current;
    if (
      !state ||
      !coordinator ||
      !repository ||
      checkpointRecoveryInFlightRef.current
    ) return;
    const checkpointReason = checkpointReasonForSaveReason(reason);
    if (state.status === "playing" && checkpointReason) {
      const timelineSave = repository.saveAutoCheckpoint(
        state,
        { seed: state.seed, simTick: state.clock.tick },
        createCheckpointMetadata(state, checkpointReason),
      );
      if (!timelineSave.ok) {
        setCheckpointNotice("自动恢复点写入失败；当前活动档仍会继续尝试保存。");
      }
      refreshCheckpointTimeline();
    }
    void coordinator
      .save(state, { seed: state.seed, simTick: state.clock.tick }, reason)
      .then(refreshCheckpointTimeline);
  }, [refreshCheckpointTimeline]);

  const commitAppliedCommand = useCallback((
    current: GameState,
    command: GameCommand,
    next: GameState,
  ) => {
    const beforeEventId = current.eventLog.at(-1)?.id ?? 0;
    const nowMs = Date.now();
    const receipt = createActionReceipt({
      transactionId: `action-${current.seed}-${++actionReceiptSequenceRef.current}`,
      command,
      beforeEventId,
      events: next.eventLog,
      nowMs,
    });
    if (receipt) {
      setActionReceipts((receipts) =>
        enqueueActionReceipt(
          pruneExpiredActionReceipts(receipts, nowMs),
          receipt,
        ),
      );
    }
    commitState(next);
    if (command.type === "continue-expedition" && next.status === "playing") {
      enteredGameRef.current = false;
      rendererRef.current?.setPaused(false);
    }
    return next;
  }, [commitState]);

  const applyCommittedCommand = useCallback((
    current: GameState,
    command: GameCommand,
  ) => commitAppliedCommand(current, command, applyCommand(current, command)), [
    commitAppliedCommand,
  ]);

  const dispatchCommand = useCallback((command: GameCommand) => {
    const current = stateRef.current;
    if (!current || restCheckpointBarrierRef.current) return null;
    if (current.status !== "playing" && command.type !== "continue-expedition") return null;
    if (command.type !== "rest") return applyCommittedCommand(current, command);
    if (!hasUsableRestTarget(current, command)) {
      return applyCommittedCommand(current, command);
    }

    const repository = repositoryRef.current;
    if (!repository) {
      setRestCheckpointBarrier({
        phase: "failed",
        message: "存档系统尚未准备完成，休息没有开始。",
      });
      return null;
    }

    restCheckpointBarrierRef.current = true;
    setRestCheckpointBarrier({
      phase: "saving",
      message: "正在建立休息前恢复点…",
    });
    rendererRef.current?.setPaused(true);
    rendererRef.current?.releasePointerLock();

    const finishBarrier = (nextState: GameState | null) => {
      restCheckpointBarrierRef.current = false;
      const playing = (nextState ?? stateRef.current)?.status === "playing";
      const paused = Boolean(activePanelRef.current) || !playing;
      rendererRef.current?.setPaused(paused);
      if (paused) rendererRef.current?.releasePointerLock();
      else rendererRef.current?.requestPointerLock();
    };

    void (async () => {
      let stateChanged = false;
      const beforeEventId = current.eventLog.at(-1)?.id ?? 0;
      const transaction = await runVerifiedCheckpointTransaction(
        () => {
          if (stateRef.current !== current) {
            stateChanged = true;
            throw new Error("state changed before pre-rest checkpoint");
          }
          const saved = repository.saveAutoCheckpoint(
            current,
            { seed: current.seed, simTick: current.clock.tick },
            createCheckpointMetadata(current, "rest-before"),
          );
          refreshCheckpointTimeline();
          return saved;
        },
        () => applyCommand(current, command),
        (staged) => {
          const restCompleted = staged.eventLog.some(
            (event) => event.id > beforeEventId && event.type === "rest-completed",
          );
          if (!restCompleted) return null;

          const saved = repository.saveAutoCheckpoint(
            staged,
            { seed: staged.seed, simTick: staged.clock.tick },
            createCheckpointMetadata(staged, "rest-after"),
          );
          refreshCheckpointTimeline();
          return saved;
        },
        (staged) => {
          const committed = commitAppliedCommand(current, command, staged);
          markRestCompletionAsCheckpointed(
            committed.eventLog,
            beforeEventId,
            checkpointedEventIdsRef.current,
          );
          return committed;
        },
        // Yield one task so React paints the blocking state before synchronous
        // localStorage write/readback. Simulation and repeat input stay locked.
        () => new Promise<void>((resolve) => window.setTimeout(resolve, 0)),
      );
      if (!transaction.ok) {
        setRestCheckpointBarrier({
          phase: "failed",
          message: stateChanged
            ? "玩家状态在保存前发生变化，休息已取消。"
            : transaction.phase === "after-checkpoint"
              ? "无法验证休息后的恢复点；休息结算未提交，仍可从休息前恢复点继续。"
              : transaction.phase === "commit"
                ? "休息前后恢复点均已建立，但界面提交异常；请从恢复点时间线重新载入。"
                : transaction.phase === "stage"
                  ? "休息前恢复点已建立，但休息结算异常；请从恢复点时间线重新载入。"
                  : "无法验证休息前恢复点；休息没有开始，请先导出存档或检查浏览器存储。",
        });
        finishBarrier(null);
        return;
      }
      setRestCheckpointBarrier({ phase: "idle" });
      activePanelRef.current = null;
      setActivePanel(null);
      finishBarrier(transaction.value);
    })();
    return current;
  }, [applyCommittedCommand, commitAppliedCommand, refreshCheckpointTimeline]);

  const expireActionReceipts = useCallback((nowMs: number) => {
    setActionReceipts((receipts) => pruneExpiredActionReceipts(receipts, nowMs));
  }, []);
  useEffect(() => {
    commandRef.current = dispatchCommand;
  }, [dispatchCommand]);

  const showInteractionCaption = useCallback((message: string) => {
    setHazardCaption(message);
    if (hazardCaptionTimerRef.current !== null) {
      window.clearTimeout(hazardCaptionTimerRef.current);
    }
    hazardCaptionTimerRef.current = window.setTimeout(() => {
      hazardCaptionTimerRef.current = null;
      setHazardCaption(null);
    }, 2600);
  }, []);

  const openPanel = useCallback((panel: PanelId) => {
    if (restCheckpointBarrierRef.current) return;
    const next = nextActivePanel(activePanelRef.current, panel);
    const playing = stateRef.current?.status === "playing";
    activePanelRef.current = next;
    setActivePanel(next);
    rendererRef.current?.setPaused(Boolean(next) || !playing);
    if (next || !playing) rendererRef.current?.releasePointerLock();
    else rendererRef.current?.requestPointerLock();
  }, []);

  const closePanel = useCallback(() => {
    activePanelRef.current = null;
    setActivePanel(null);
    const playing = stateRef.current?.status === "playing";
    rendererRef.current?.setPaused(!playing);
    if (playing) rendererRef.current?.requestPointerLock();
    else rendererRef.current?.releasePointerLock();
  }, []);

  const handleInteraction = useCallback((interaction: InteractionTarget) => {
    let state = stateRef.current;
    if (!state) return;
    if (affordanceAcceptsInput(interaction.affordance)) {
      const frame = playerFrameRef.current;
      if (frame) {
        state = synchronizeInteractionPlayerFrame(state, frame);
        // One synchronous state swap keeps proximity, line-of-sight and any
        // physical poseRevision on the exact visual frame that committed.
        commitState(state);
      }
    }
    const command = commandForInteraction(state, interaction);
    if (!command) {
      showInteractionCaption(interaction.affordance.preview.detail);
      return;
    }
    commandRef.current(command);
  }, [commitState, showInteractionCaption]);
  useEffect(() => {
    interactionRef.current = handleInteraction;
  }, [handleInteraction]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setSystemReducedMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const toy = createToyBridgeClient({ timeoutMs: 1500 });
      toyRef.current = toy;
      const repository = createSaveRepository<GameState>({
        key: SAVE_KEY,
        schema: 1,
        content: CONTENT_VERSION,
        acceptedContent: LEGACY_CONTENT_VERSIONS,
        device: getDeviceId(),
        cloud: new ToyBridgeCloudKV(toy),
        payloadValidator: isGameState,
      });
      repositoryRef.current = repository;
      setLocalSaveDurability(repository.getLocalDurability());
      setHasPreImportSave(repository.hasPreImportSnapshot());
      const initialTimeline = repository.listCheckpoints();
      setCheckpointEntries(initialTimeline.entries);
      setRecommendedCheckpointSlotId(initialTimeline.recommendedSlotId);
      const coordinator = new SaveCoordinator(repository, {
        onStatus: (status) => {
          setSaveStatus(status);
          if (status.phase === "saved-cloud" || status.phase === "cloud-failed") {
            const timeline = repository.listCheckpoints();
            setCheckpointEntries(timeline.entries);
            setRecommendedCheckpointSlotId(timeline.recommendedSlotId);
          }
        },
      });
      saveCoordinatorRef.current = coordinator;
      if (stateRef.current) {
        loadGenerationRef.current += 1;
        const state = stateRef.current;
        const shouldClearForNewGame = pendingNewGameClearRef.current;
        const prepare = shouldClearForNewGame
          ? repository.clear()
          : Promise.resolve(null);
        pendingNewGameClearRef.current = false;
        if (shouldClearForNewGame) setHasPreImportSave(false);
        void prepare.then(() => {
          const current = stateRef.current;
          if (!current || current.seed !== state.seed) return;
          const initialCheckpoint = writeVerifiedNewGameCheckpoint(repository, current);
          if (!initialCheckpoint.ok) {
            setCheckpointNotice("远征开始恢复点写入失败；请立即使用手动槽或导出存档。");
          }
          const timeline = repository.listCheckpoints();
          setCheckpointEntries(timeline.entries);
          setRecommendedCheckpointSlotId(timeline.recommendedSlotId);
          void coordinator
            .save(
              current,
              { seed: current.seed, simTick: current.clock.tick },
              "new-game",
            )
            .then(() => {
              const updated = repository.listCheckpoints();
              setCheckpointEntries(updated.entries);
              setRecommendedCheckpointSlotId(updated.recommendedSlotId);
            });
        });
        return;
      }
      const generation = ++loadGenerationRef.current;
      void (async () => {
        try {
          // Recover the local primary/backup immediately, but keep Continue in
          // discovery state until the bounded first Toy cloud check settles.
          const result = await repository.load({ allowCloudFallback: false });
          if (generation !== loadGenerationRef.current || stateRef.current) return;
          if (result.ok && isContinuableSave(result.envelope.payload)) {
            try {
              savedStateRef.current = migrateGameState(result.envelope.payload);
              setCanContinue(true);
            } catch {
              // The repository keeps a quarantined primary and backup. A malformed
              // payload must never crash the title screen or erase either copy.
            }
          }

          // The SDK script can be injected after hydration. Give it one bounded
          // first-discovery window before deciding that this session is local.
          await toy.waitForCloudStorage({ timeoutMs: 1_500, pollIntervalMs: 25 });
          if (generation !== loadGenerationRef.current || stateRef.current) return;

          // Resolve a newer cross-device Toy checkpoint before enabling title
          // actions, so an older local session cannot race ahead and fork it.
          const refresh = await repository.refreshFromCloud();
          if (generation !== loadGenerationRef.current || stateRef.current) return;
          const refreshedTimeline = repository.listCheckpoints();
          setCheckpointEntries(refreshedTimeline.entries);
          setRecommendedCheckpointSlotId(refreshedTimeline.recommendedSlotId);
          if (refresh.status === "updated" || refresh.status === "up-to-date") {
            if (isContinuableSave(refresh.envelope.payload)) {
              try {
                savedStateRef.current = migrateGameState(refresh.envelope.payload);
                setCanContinue(true);
              } catch {
                // Leave the locally recovered candidate available.
              }
            } else {
              savedStateRef.current = null;
              setCanContinue(false);
            }
          }
        } catch {
          // A storage implementation must not strand the title screen.
        } finally {
          if (generation === loadGenerationRef.current && !stateRef.current) {
            setSaveDiscoveryComplete(true);
          }
        }
      })();
    }, 0);
    return () => {
      window.clearTimeout(timer);
      loadGenerationRef.current += 1;
      saveCoordinatorRef.current = null;
      repositoryRef.current = null;
    };
  }, []);

  const startState = useCallback((state: GameState, eventId: string) => {
    stateRef.current = state;
    lastEventIdRef.current = state.eventLog.at(-1)?.id ?? 0;
    damageIncidentCursorRef.current = lastEventIdRef.current;
    if (damageIncidentTimerRef.current !== null) {
      window.clearTimeout(damageIncidentTimerRef.current);
      damageIncidentTimerRef.current = null;
    }
    setDamageIncidents([]);
    setStatusSignals(deriveStatusSignals(state));
    actionReceiptSequenceRef.current = 0;
    campfireFeedbackCursorRef.current = createCampfireFeedbackCursor();
    checkpointedEventIdsRef.current.clear();
    setActionReceipts([]);
    setActionPhase(null);
    pendingCheckpointRecoveryRef.current = null;
    setCheckpointPickerOpen(false);
    setCheckpointRecoveryState({ phase: "idle" });
    restCheckpointBarrierRef.current = false;
    setRestCheckpointBarrier({ phase: "idle" });
    setManualCheckpointSlot(null);
    setGameState(state);
    setScreen("game");
    setActivePanel(null);
    activePanelRef.current = null;
    enteredGameRef.current = false;
    const hasRenderer = rendererRef.current !== null;
    rendererReadyRef.current = hasRenderer;
    setRendererReady(hasRenderer);
    setPointerLocked(false);
    playerFrameRef.current = null;
    stepDistanceRef.current = 0;
    setTarget(null);
    setCompatibilityError(null);
    placementRecipeRef.current = null;
    setPlacementRecipe(null);
    rendererRef.current?.cancelPlacement();
    setHazardCaption(null);
    rendererRef.current?.resetRun();
    audioRef.current?.resetCampfireFeedback();
    rendererRef.current?.setTouchInput({ forward: 0, right: 0, lookX: 0, lookY: 0, sprint: false });
    rendererRef.current?.setPlayerPosition(
      state.player.position.x,
      state.player.position.z,
      state.player.lookYaw ?? Math.PI,
      state.player.lookPitch ?? -0.05,
    );
    rendererRef.current?.setSnapshot(createGameViewModel(state).render);
    audioRef.current ??= new AudioEngine();
    audioRef.current.setEnabled(audioEnabled);
    void audioRef.current.unlock();
    void toyRef.current?.reportAction(eventId);
  }, [audioEnabled]);

  const startNewGame = useCallback(() => {
    loadGenerationRef.current += 1;
    const sessionSeed = createSessionSeed();
    const state = createInitialState(sessionSeed);
    // createInitialState hashes the external session seed before storing it in
    // GameState. Compare against that authoritative run seed after the async
    // clear, otherwise every new-game checkpoint is silently skipped.
    const runSeed = state.seed;
    const repository = repositoryRef.current;
    const coordinator = saveCoordinatorRef.current;
    coordinator?.beginNewRun();
    pendingNewGameClearRef.current = repository === null;
    savedStateRef.current = null;
    setCanContinue(false);
    pendingSaveImportRef.current = null;
    setHasPreImportSave(false);
    setSaveTransferState({ phase: "idle" });
    const clearing = repository?.clear();
    startState(state, "canopy_start_new_game");
    if (coordinator && repository) {
      void Promise.resolve(clearing).then((clearResult) => {
        const current = stateRef.current;
        if (!current || current.seed !== runSeed) return;
        if (clearResult && !clearResult.ok) {
          setCheckpointNotice("旧存档没有完整清除；新远征将继续尝试建立独立恢复点。");
        }
        const initialCheckpoint = writeVerifiedNewGameCheckpoint(repository, current);
        if (!initialCheckpoint.ok) {
          setCheckpointNotice("远征开始恢复点写入失败；请立即使用手动槽或导出存档。");
        }
        refreshCheckpointTimeline();
        void coordinator.save(
          current,
          { seed: current.seed, simTick: current.clock.tick },
          "new-game",
        );
      });
    }
  }, [refreshCheckpointTimeline, startState]);

  const continueGame = useCallback(() => {
    // A local candidate may be discovered before the bounded Toy cloud refresh
    // settles. Never let an imperative caller bypass the title-screen gate and
    // fork a stale cross-device checkpoint during that window.
    if (!saveDiscoveryComplete || !savedStateRef.current) return;
    loadGenerationRef.current += 1;
    startState(savedStateRef.current, "canopy_continue_game");
  }, [saveDiscoveryComplete, startState]);

  useEffect(() => {
    if (screen !== "game" || !canvasRef.current || !stateRef.current) return;
    let disposed = false;
    let renderer: RainforestRenderer | null = null;
    const canvas = canvasRef.current;
    rendererReadyRef.current = false;
    setRendererReady(false);

    void import("./render/RainforestRenderer").then(({ RainforestRenderer }) => {
      if (disposed || !stateRef.current) return;
      try {
        renderer = new RainforestRenderer(canvas, {
          onTargetChange: setTarget,
          onActionPhaseChange: setActionPhase,
          onInteract: (interaction) => interactionRef.current(interaction),
          onPlayerFrame: (frame) => {
            playerFrameRef.current = frame;
            const now = performance.now();
            if (now - lastHudFrameRef.current >= 100) {
              lastHudFrameRef.current = now;
              setCompassDegrees(yawToCompassDegrees(frame.yaw));
            }
            stepDistanceRef.current += frame.distance;
            if (stepDistanceRef.current > (frame.sprinting ? 1.35 : 1.05)) {
              stepDistanceRef.current = 0;
              audioRef.current?.cue("step");
            }
            const state = stateRef.current;
            if (state && now - lastEnvironmentFrameRef.current >= 200) {
              lastEnvironmentFrameRef.current = now;
              const audio = audioRef.current;
              audio?.setEnvironment(
                state.weather.rainIntensity,
                state.camp.fire.lit,
                frame.sheltered,
              );
              const windSoundscape = state.world.windField
                ? projectWindPresentation(state.world.windField, {
                    stableObjectId: "listener-wind",
                    reducedMotion: reducedMotionRef.current,
                  }).soundscape
                : null;
              audio?.setWindEnvironment(windSoundscape, frame.yaw);
            }
          },
          onHazard: (hazardId) => {
            if (hazardCaptionTimerRef.current !== null) window.clearTimeout(hazardCaptionTimerRef.current);
            hazardCaptionTimerRef.current = null;
            setHazardCaption(null);
            let current = stateRef.current;
            if (!current) return false;
            const frame = playerFrameRef.current;
            if (frame) {
              current = applyCommand(current, {
                type: "move-player",
                position: { x: frame.x, y: 0, z: frame.z },
                look: { yaw: frame.yaw, pitch: frame.pitch },
              });
              commitState(current);
            }
            const beforeEventId = current.eventLog.at(-1)?.id ?? 0;
            const next = commandRef.current(
              hazardId.startsWith("wildlife:")
                ? {
                    type: "encounter-wildlife",
                    individualId: hazardId.slice("wildlife:".length),
                  }
                : { type: "encounter-hazard", entityId: hazardId },
            );
            if (!next) return false;
            return next.eventLog.some(
              (event) =>
                event.id > beforeEventId &&
                (event.type === "snake-bite" ||
                  event.type === "wildlife-attack"),
            );
          },
          onHazardWarning: (hazardId) => {
            audioRef.current?.cue("warning");
            setHazardCaption(
              hazardId.includes("authored-snake:")
                ? "附近草丛传来急促嘶声——蛇已盘起警戒；后退绕行，或瞄准后用石矛先手。"
                : hazardId.startsWith("wildlife:")
                  ? "林下传来压低的喘息与断枝声——捕食者正在附近活动，保持距离。"
                  : "附近草丛传来急促嘶声——放慢脚步，绕行或准备石矛。",
            );
            if (hazardCaptionTimerRef.current !== null) window.clearTimeout(hazardCaptionTimerRef.current);
            hazardCaptionTimerRef.current = window.setTimeout(() => {
              hazardCaptionTimerRef.current = null;
              setHazardCaption(null);
            }, 2600);
          },
          onPlaceStructure: (placement) => {
            const recipeId = placementRecipeRef.current;
            if (!recipeId || recipeId !== placement.kind) return false;
            const next = commandRef.current({
              type: "craft",
              recipeId,
              placement: {
                // Terrain height is presentation-only; simulation distances are horizontal.
                position: { x: placement.x, y: 0, z: placement.z },
                yaw: placement.yaw,
              },
            });
            const lastEvent = next?.eventLog.at(-1);
            const accepted = Boolean(next) && !(
              lastEvent?.type === "craft-failed" &&
              lastEvent.details?.recipeId === recipeId
            );
            if (accepted) {
              placementRecipeRef.current = null;
              setPlacementRecipe(null);
            }
            return accepted;
          },
          onPlacementCancelled: () => {
            placementRecipeRef.current = null;
            setPlacementRecipe(null);
            setHazardCaption("已取消放置，材料没有消耗。");
            if (hazardCaptionTimerRef.current !== null) window.clearTimeout(hazardCaptionTimerRef.current);
            hazardCaptionTimerRef.current = window.setTimeout(() => {
              hazardCaptionTimerRef.current = null;
              setHazardCaption(null);
            }, 2200);
          },
          onPlacementFeedback: (message) => {
            setHazardCaption(message);
            if (hazardCaptionTimerRef.current !== null) window.clearTimeout(hazardCaptionTimerRef.current);
            hazardCaptionTimerRef.current = window.setTimeout(() => {
              hazardCaptionTimerRef.current = null;
              setHazardCaption(null);
            }, 2600);
          },
          onPointerLockChange: (locked) => {
            setPointerLocked(locked);
            if (!locked && activePanelRef.current === null && stateRef.current?.status === "playing") {
              activePanelRef.current = "pause";
              setActivePanel("pause");
              rendererRef.current?.setPaused(true);
            }
          },
        });
        rendererRef.current = renderer;
        renderer.setCampfireTransientListener((transient) => {
          audioRef.current?.presentCampfireTransient(transient);
        });
        renderer.setReducedMotion(reducedMotionRef.current);
        const player = stateRef.current.player.position;
        renderer.setPlayerPosition(
          player.x,
          player.z,
          stateRef.current.player.lookYaw ?? Math.PI,
          stateRef.current.player.lookPitch ?? -0.05,
        );
        renderer.setSnapshot(createGameViewModel(stateRef.current).render);
        renderer.start();
        rendererReadyRef.current = true;
        setRendererReady(true);
      } catch (error) {
        const message = error instanceof Error ? error.message : "无法初始化 WebGL 3D 场景";
        window.setTimeout(() => setCompatibilityError(message), 0);
      }
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "无法加载 WebGL 3D 场景";
      window.setTimeout(() => setCompatibilityError(message), 0);
    });

    return () => {
      disposed = true;
      rendererReadyRef.current = false;
      renderer?.dispose();
      rendererRef.current = null;
    };
  }, [screen, commitState]);

  useEffect(() => {
    if (view) rendererRef.current?.setSnapshot(view.render);
  }, [view]);

  useEffect(() => {
    if (!gameState) return;
    const frame = resolveCampfireFeedbackFrame(
      gameState,
      campfireFeedbackCursorRef.current,
      effectiveReducedMotion,
    );
    campfireFeedbackCursorRef.current = frame.cursor;
    if (rendererReady) {
      for (const [structureId, feedback] of frame.feedbackByStructureId) {
        rendererRef.current?.applyCampfireFeedback(structureId, feedback);
      }
    }
    const audibleFeedback = frame.audibleStructureId
      ? frame.feedbackByStructureId.get(frame.audibleStructureId)
      : null;
    audioRef.current?.applyCampfireFeedback(
      audibleFeedback?.audio ?? SILENT_CAMPFIRE_AUDIO,
    );
  }, [gameState, effectiveReducedMotion, rendererReady]);

  useEffect(() => {
    reducedMotionRef.current = effectiveReducedMotion;
    rendererRef.current?.setReducedMotion(effectiveReducedMotion);
  }, [effectiveReducedMotion]);

  useEffect(() => {
    if (screen !== "game") return;
    const interval = window.setInterval(() => {
      const current = stateRef.current;
      if (!current || current.status !== "playing" || restCheckpointBarrierRef.current || !rendererReadyRef.current || !enteredGameRef.current || activePanelRef.current !== null || document.hidden) return;
      const frame = playerFrameRef.current;
      const movement = frame ? {
        x: frame.x - current.player.position.x,
        z: frame.z - current.player.position.z,
        sprint: frame.sprinting,
        inWater: frame.inWater,
        sheltered: frame.sheltered,
      } : undefined;
      let next = stepSimulation(current, { movement }, SIMULATION_INTERVAL_MS / 1000);
      if (frame) {
        next = applyCommand(next, {
          type: "move-player",
          position: { x: frame.x, y: 0, z: frame.z },
          look: { yaw: frame.yaw, pitch: frame.pitch },
        });
      }
      commitState(next);
    }, SIMULATION_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [screen, commitState]);

  useEffect(() => {
    if (!gameState) return;
    const freshEvents = gameState.eventLog.filter((event) => event.id > lastEventIdRef.current);
    if (freshEvents.length === 0) return;
    lastEventIdRef.current = freshEvents.at(-1)!.id;
    for (const event of freshEvents) {
      if (event.type === "resource-picked") audioRef.current?.cue("pickup");
      if (event.type === "harvest-struck") {
        audioRef.current?.cue("pickup");
        const entityId = event.details?.entityId;
        if (typeof entityId === "string") {
          rendererRef.current?.playHarvestImpact(entityId, event.details?.depleted === true);
        }
      }
      if (event.type === "item-equipped" || event.type === "item-unequipped") {
        audioRef.current?.cue("craft");
      }
      if (event.type === "craft-succeeded" || event.type === "water-purified" || event.type === "wound-treated" || event.type === "rest-completed") audioRef.current?.cue("craft");
      if (event.type === "parasite-contracted" || event.type === "game-lost") {
        audioRef.current?.cue("hurt");
        setHurtFlash((value) => value + 1);
      }
      if (event.type === "snake-bite") {
        audioRef.current?.cue("hurt");
        setHurtFlash((value) => value + 1);
      }
      if (event.type === "wildlife-attack") {
        audioRef.current?.cue("hurt");
        setHurtFlash((value) => value + 1);
      }
      if (event.type === "wildlife-hit") audioRef.current?.cue("warning");
      if (event.type === "wildlife-defeated") audioRef.current?.cue("success");
      if (event.type === "threat-avoided") audioRef.current?.cue("success");
      if (event.type === "weather-changed") audioRef.current?.cue("warning");
      if (event.type === "task-completed" || event.type === "game-won") audioRef.current?.cue("success");
      if (event.type === "landmark-inspected") audioRef.current?.cue("success");
      if (event.type === "game-won") void toyRef.current?.reportAction("canopy_game_won");
      if (event.type === "game-lost") void toyRef.current?.reportAction("canopy_game_lost");
    }
    const autosaveEvents = eventsNeedingAutosave(
      freshEvents,
      checkpointedEventIdsRef.current,
    );
    const autosaveReason = autosaveReasonForEvents(autosaveEvents);
    if (autosaveReason) requestSave(autosaveReason);
    const learned = freshEvents.flatMap((event) => {
      const recipeId = event.type === "recipe-discovered" ? event.details?.recipeId : null;
      return typeof recipeId === "string" && RECIPE_IDS.includes(recipeId as RecipeId) ? [recipeId as RecipeId] : [];
    });
    if (learned.length > 0) {
      setRetainedRecipes((current) => {
        const next = RECIPE_IDS.filter((recipeId) => recipeId === "stone-blade" || current.includes(recipeId) || learned.includes(recipeId));
        writeRetainedRecipes(next);
        return next;
      });
    }
  }, [gameState, requestSave]);

  useEffect(() => {
    if (!gameStatus || gameStatus === "playing") return;
    rendererRef.current?.setPaused(true);
    rendererRef.current?.releasePointerLock();
  }, [gameStatus]);

  useEffect(() => {
    if (screen !== "game") return;
    const interval = window.setInterval(() => requestSave("periodic"), PERIODIC_SAVE_INTERVAL_MS);
    const onVisibility = () => { if (document.hidden) requestSave("hidden"); };
    const onPageExit = () => requestSave("page-exit");
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageExit);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageExit);
      requestSave("page-exit");
    };
  }, [screen, requestSave]);

  useEffect(() => {
    if (screen !== "game") return;
    const onKeyDown = (event: KeyboardEvent) => {
      const currentPanel = activePanelRef.current;
      const placementActive = Boolean(rendererRef.current?.isPlacementActive());
      const menuAction = resolveMenuKeyAction({
        code: normalizeMenuShortcutCode(event.code, event.key),
        currentPanel,
        placementActive,
        playing: stateRef.current?.status === "playing",
        focusTarget: event.target,
        repeat: event.repeat,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
      });
      if (menuAction.type === "bypass-game-hotkeys") return;
      if (menuAction.type === "release-control-focus") {
        event.preventDefault();
        const blur = (event.target as { blur?: () => void } | null)?.blur;
        if (typeof blur === "function") blur.call(event.target);
        return;
      }
      if (menuAction.type === "set-panel") {
        event.preventDefault();
        if (menuAction.panel === null) closePanel();
        else openPanel(menuAction.panel);
        return;
      }
      if (menuAction.type === "cancel-placement") {
        event.preventDefault();
        rendererRef.current?.cancelPlacement();
        return;
      }
      if (currentPanel) return;
      if (stateRef.current?.status !== "playing") return;
      if (placementActive) {
        if (event.code === "KeyR") {
          event.preventDefault();
          rendererRef.current?.rotatePlacement();
        }
        return;
      }
      const equipmentByCode: Partial<Record<string, EquippableItemId | null>> = {
        Digit1: "axe",
        Digit2: "spear",
        Digit3: "stone-blade",
        Digit4: "stone-pick",
        Digit5: "torch",
        KeyQ: null,
      };
      if (Object.prototype.hasOwnProperty.call(equipmentByCode, event.code)) {
        event.preventDefault();
        dispatchCommand({ type: "equip-item", itemId: equipmentByCode[event.code] ?? null });
        return;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [screen, closePanel, dispatchCommand, openPanel]);

  useEffect(() => () => {
    if (hazardCaptionTimerRef.current !== null) window.clearTimeout(hazardCaptionTimerRef.current);
    if (exportObjectUrlRef.current) URL.revokeObjectURL(exportObjectUrlRef.current);
    audioRef.current?.dispose();
    audioRef.current = null;
  }, []);

  const handleCraft = useCallback((id: string) => {
    const runCommand = (command: GameCommand) => {
      const beforeEventId = stateRef.current?.eventLog.at(-1)?.id ?? 0;
      const next = dispatchCommand(command);
      if (!next) return false;
      const freshEvents = next.eventLog.filter((event) => event.id > beforeEventId);
      return freshEvents.length > 0 && !freshEvents.some(
        (event) => event.type === "command-rejected" || event.type === "craft-failed",
      );
    };
    if (id === "boil-water") return runCommand({ type: "boil-water" });
    if (id === "add-fuel") return runCommand({ type: "add-fuel" });
    if (id === "collect-rainwater") return runCommand({ type: "collect-rainwater" });
    if (id === "rest") return dispatchCommand({ type: "rest" }) !== null;
    if (BUILD_RECIPE_IDS.has(id as RecipeId) && rendererRef.current) {
      placementRecipeRef.current = id as RecipeId;
      setPlacementRecipe(id as RecipeId);
      rendererRef.current.beginPlacement(id as PlaceableStructureKind);
      setHazardCaption("移动视角选择位置 · 左键/E确认 · R旋转 · 右键/Esc取消");
      if (hazardCaptionTimerRef.current !== null) window.clearTimeout(hazardCaptionTimerRef.current);
      hazardCaptionTimerRef.current = window.setTimeout(() => {
        hazardCaptionTimerRef.current = null;
        setHazardCaption(null);
      }, 4200);
      return true;
    }
    return runCommand({ type: "craft", recipeId: id as RecipeId });
  }, [dispatchCommand]);

  const handleItemAction = useCallback((item: InventoryItemView) => {
    if (item.action === "eat") dispatchCommand({ type: "eat", itemId: item.id as ItemId });
    else if (item.action === "drink") dispatchCommand({ type: "drink-water", itemId: item.id as "clean-water" | "dirty-water" });
    else if (item.action === "equip") {
      const itemId = item.id as EquippableItemId;
      dispatchCommand({
        type: "equip-item",
        itemId: stateRef.current?.player.equippedItem === itemId ? null : itemId,
      });
    }
    else if (item.id === "bandage") dispatchCommand({ type: "use-item", itemId: "bandage" });
    else if (item.id === "antiparasitic-herb") dispatchCommand({ type: "use-item", itemId: "antiparasitic-herb" });
  }, [dispatchCommand]);

  const prepareSaveExport = useCallback(() => {
    const state = stateRef.current;
    const coordinator = saveCoordinatorRef.current;
    const repository = repositoryRef.current;
    if (!state || !coordinator || !repository) {
      setSaveTransferState({ phase: "error", message: "存档系统尚未准备完成" });
      return;
    }
    setSaveTransferState({ phase: "preparing-export" });
    void (async () => {
      const status = await coordinator.save(
        state,
        { seed: state.seed, simTick: state.clock.tick },
        "manual",
      );
      if (status.phase === "failed") {
        setSaveTransferState({ phase: "error", message: "当前进度无法写入本地存档" });
        return;
      }
      const snapshot = repository.exportLocalSnapshot();
      if (!snapshot.ok) {
        setSaveTransferState({ phase: "error", message: "没有找到可导出的有效本地存档" });
        return;
      }
      try {
        const raw = createSaveFileText(snapshot.envelope, {
          retainedRecipeIds: retainedRecipes,
        });
        if (exportObjectUrlRef.current) URL.revokeObjectURL(exportObjectUrlRef.current);
        const url = URL.createObjectURL(new Blob([raw], { type: "application/json" }));
        exportObjectUrlRef.current = url;
        setSaveTransferState({
          phase: "export-ready",
          url,
          filename: createSaveFilename(state),
        });
      } catch {
        setSaveTransferState({ phase: "error", message: "生成存档文件失败" });
      }
    })();
  }, [retainedRecipes]);

  const selectSaveImport = useCallback((file: File) => {
    pendingSaveImportRef.current = null;
    if (file.size > MAX_SAVE_FILE_BYTES) {
      setSaveTransferState({ phase: "error", message: "存档文件超过 5 MiB 上限" });
      return;
    }
    setSaveTransferState({ phase: "validating-import" });
    void (async () => {
      try {
        const raw = await readSaveFileText(file);
        const parsed = parseSaveFileText<GameState>(raw, {
          schema: 1,
          content: [CONTENT_VERSION, ...LEGACY_CONTENT_VERSIONS],
          payloadValidator: isGameState,
          checkpointValidator: (envelope) =>
            envelope.seed === envelope.payload.seed &&
            envelope.simTick === envelope.payload.clock.tick,
        });
        if (!parsed.ok) {
          setSaveTransferState({
            phase: "error",
            message: saveFileFailureLabel(parsed),
          });
          return;
        }
        const imported = migrateGameState(parsed.envelope.payload);
        const preview = createSaveImportPreview(
          file.name || "本地存档文件",
          imported,
          formatExportedAt(parsed.exportedAt),
        );
        pendingSaveImportRef.current = {
          state: imported,
          retainedRecipeIds: parsed.profile.retainedRecipeIds,
          preview,
        };
        setSaveTransferState({ phase: "import-ready", preview });
      } catch {
        setSaveTransferState({ phase: "error", message: "读取存档文件失败" });
      }
    })();
  }, []);

  const preparePreImportRestore = useCallback(() => {
    const snapshot = repositoryRef.current?.getPreImportSnapshot();
    if (!snapshot?.ok) {
      setHasPreImportSave(false);
      setSaveTransferState({ phase: "error", message: "导入前恢复点已不可用" });
      return;
    }
    try {
      const restored = migrateGameState(snapshot.envelope.payload);
      if (
        snapshot.envelope.seed !== restored.seed ||
        snapshot.envelope.simTick !== restored.clock.tick
      ) {
        throw new TypeError("rollback checkpoint mismatch");
      }
      const preview = createSaveImportPreview("导入前恢复点", restored);
      pendingSaveImportRef.current = {
        state: restored,
        retainedRecipeIds: retainedRecipes,
        preview,
      };
      setSaveTransferState({ phase: "import-ready", preview });
    } catch {
      setSaveTransferState({ phase: "error", message: "导入前恢复点校验失败" });
    }
  }, [retainedRecipes]);

  const cancelSaveImport = useCallback(() => {
    pendingSaveImportRef.current = null;
    setSaveTransferState({ phase: "idle" });
  }, []);

  const confirmSaveImport = useCallback(() => {
    const pending = pendingSaveImportRef.current;
    const coordinator = saveCoordinatorRef.current;
    const repository = repositoryRef.current;
    const current = stateRef.current;
    if (!pending || !coordinator || !repository || !current) {
      setSaveTransferState({ phase: "error", message: "待导入存档已失效，请重新选择" });
      return;
    }
    setSaveTransferState({ phase: "importing", preview: pending.preview });
    void (async () => {
      // Preserve the exact current in-memory state before the repository makes
      // its local-only pre-import rollback copy.
      const protectedCurrent = await coordinator.save(
        current,
        { seed: current.seed, simTick: current.clock.tick },
        "manual",
      );
      if (protectedCurrent.phase === "failed") {
        setSaveTransferState({
          phase: "error",
          message: "无法先保护当前进度，已取消导入",
        });
        return;
      }
      const rollbackCheckpoint = repository.savePreImportCheckpoint(
        current,
        { seed: current.seed, simTick: current.clock.tick },
        createCheckpointMetadata(current, "preimport"),
      );
      if (!rollbackCheckpoint.ok) {
        setSaveTransferState({
          phase: "error",
          message: "无法建立导入前恢复点，已取消导入",
        });
        return;
      }
      refreshCheckpointTimeline();
      const imported = await coordinator.replaceFromImport(
        pending.state,
        { seed: pending.state.seed, simTick: pending.state.clock.tick },
      );
      if (imported.phase === "failed") {
        setSaveTransferState({
          phase: "error",
          message: "导入写入失败，当前进度没有被替换",
        });
        return;
      }

      const retained = RECIPE_IDS.filter(
        (recipeId) =>
          recipeId === "stone-blade" ||
          retainedRecipes.includes(recipeId) ||
          pending.retainedRecipeIds.includes(recipeId) ||
          pending.state.knowledge?.craftedRecipeIds.includes(recipeId),
      );
      writeRetainedRecipes(retained);
      setRetainedRecipes(retained);
      savedStateRef.current = pending.state;
      setCanContinue(isContinuableSave(pending.state));
      loadGenerationRef.current += 1;
      pendingSaveImportRef.current = null;
      setHasPreImportSave(true);
      setSaveTransferState({ phase: "complete", message: "存档已导入并写入本地" });
      startState(pending.state, "canopy_import_save");
    })();
  }, [refreshCheckpointTimeline, retainedRecipes, startState]);

  const saveManualCheckpoint = useCallback((slotId: ManualCheckpointSlotId) => {
    const state = stateRef.current;
    const repository = repositoryRef.current;
    const coordinator = saveCoordinatorRef.current;
    if (
      !state ||
      !repository ||
      !coordinator ||
      manualCheckpointSlot ||
      checkpointRecoveryInFlightRef.current
    ) return;
    setManualCheckpointSlot(slotId);
    const saved = repository.saveManualCheckpoint(
      slotId,
      state,
      { seed: state.seed, simTick: state.clock.tick },
      createCheckpointMetadata(state, "manual"),
    );
    refreshCheckpointTimeline();
    setManualCheckpointSlot(null);
    if (!saved.ok) {
      setCheckpointNotice("手动恢复点写入失败；原槽位没有被覆盖。");
      return;
    }
    const cloudNotice = saved.entry.cloudDurability === "pending"
      ? "正在同步到 Toy 云端"
      : saved.entry.cloudDurability === "synced"
        ? "Toy 云端已同步"
        : "当前仅保存在本地";
    setCheckpointNotice(
      `手动槽 ${MANUAL_SLOT_NUMBER[slotId]} 已保存在${saved.entry.localDurability === "persistent" ? "本机" : "本次会话"}；${cloudNotice}。`,
    );
    void coordinator
      .save(
        state,
        { seed: state.seed, simTick: state.clock.tick },
        "manual",
      )
      .then(refreshCheckpointTimeline);
  }, [manualCheckpointSlot, refreshCheckpointTimeline]);

  const previewCheckpoint = useCallback((slotId: CheckpointSlotId) => {
    const repository = repositoryRef.current;
    if (!repository) {
      setCheckpointRecoveryState({ phase: "error", message: "存档系统尚未准备完成" });
      setCheckpointPickerOpen(true);
      return;
    }
    const loaded = repository.loadCheckpoint(slotId);
    if (!loaded.ok) {
      pendingCheckpointRecoveryRef.current = null;
      refreshCheckpointTimeline();
      setCheckpointRecoveryState({
        phase: "error",
        message: "这个恢复点未通过校验；当前游戏状态没有改变，请选择其他槽位。",
      });
      setCheckpointPickerOpen(true);
      return;
    }
    try {
      const restored = migrateGameState(loaded.envelope.payload);
      if (
        loaded.envelope.seed !== restored.seed ||
        loaded.envelope.simTick !== restored.clock.tick ||
        !isContinuableSave(restored)
      ) {
        throw new TypeError("checkpoint payload mismatch");
      }
      pendingCheckpointRecoveryRef.current = {
        slotId,
        state: restored,
        entry: loaded.entry,
      };
      setCheckpointRecoveryState({ phase: "preview", entry: loaded.entry });
    } catch {
      pendingCheckpointRecoveryRef.current = null;
      setCheckpointRecoveryState({
        phase: "error",
        message: "恢复点内容与索引不一致；当前游戏状态没有改变。",
      });
    }
    refreshCheckpointTimeline();
    setCheckpointPickerOpen(true);
  }, [refreshCheckpointTimeline]);

  const openCheckpointPicker = useCallback(() => {
    pendingCheckpointRecoveryRef.current = null;
    setCheckpointRecoveryState({ phase: "idle" });
    refreshCheckpointTimeline();
    setCheckpointPickerOpen(true);
    rendererRef.current?.setPaused(true);
    rendererRef.current?.releasePointerLock();
  }, [refreshCheckpointTimeline]);

  const closeCheckpointPicker = useCallback(() => {
    if (checkpointRecoveryState.phase === "loading") return;
    pendingCheckpointRecoveryRef.current = null;
    setCheckpointRecoveryState({ phase: "idle" });
    setCheckpointPickerOpen(false);
    const playing = stateRef.current?.status === "playing";
    const paused = Boolean(activePanelRef.current) || !playing;
    rendererRef.current?.setPaused(paused);
    if (!paused) rendererRef.current?.requestPointerLock();
  }, [checkpointRecoveryState.phase]);

  const confirmCheckpointRecovery = useCallback(() => {
    const pending = pendingCheckpointRecoveryRef.current;
    const coordinator = saveCoordinatorRef.current;
    if (!pending || !coordinator || checkpointRecoveryInFlightRef.current) {
      setCheckpointRecoveryState({
        phase: "error",
        message: checkpointRecoveryInFlightRef.current
          ? "恢复事务正在进行，请等待本地校验完成。"
          : "待恢复的检查点已失效，请重新选择。",
      });
      return;
    }
    checkpointRecoveryInFlightRef.current = true;
    const recoveryGeneration = loadGenerationRef.current;
    setCheckpointRecoveryState({ phase: "loading", entry: pending.entry });
    void (async () => {
      try {
        const status = await coordinator.replaceFromCheckpoint(
          pending.state,
          { seed: pending.state.seed, simTick: pending.state.clock.tick },
        );
        if (status.phase === "failed") {
          setCheckpointRecoveryState({
            phase: "error",
            message: "恢复点无法提升为当前活动档；当前游戏状态没有改变。",
          });
          return;
        }
        if (
          recoveryGeneration !== loadGenerationRef.current ||
          pendingCheckpointRecoveryRef.current !== pending
        ) return;
        savedStateRef.current = pending.state;
        setCanContinue(isContinuableSave(pending.state));
        loadGenerationRef.current += 1;
        pendingCheckpointRecoveryRef.current = null;
        setCheckpointRecoveryState({ phase: "complete", message: "恢复点已载入" });
        startState(pending.state, "canopy_checkpoint_recovered");
        refreshCheckpointTimeline();
      } catch {
        if (recoveryGeneration === loadGenerationRef.current) {
          setCheckpointRecoveryState({
            phase: "error",
            message: "恢复事务意外中断；当前活动档没有改变。",
          });
        }
      } finally {
        checkpointRecoveryInFlightRef.current = false;
      }
    })();
  }, [refreshCheckpointTimeline, startState]);

  const changeUiScale = useCallback((value: number) => {
    setUiScale(normalizeUiScale(value));
  }, []);

  if (screen === "menu" || !gameState || !view) {
    return <StartScreen saveDiscoveryComplete={saveDiscoveryComplete} canContinue={canContinue} onNewGame={startNewGame} onContinue={continueGame} />;
  }

  const resolution = gameState.status !== "playing";
  const equipmentSlots = ([
    ["axe", "石斧"],
    ["spear", "石矛"],
    ["stone-blade", "石刃"],
    ["stone-pick", "石镐"],
    ["torch", "火把"],
  ] as const).map(([id, label]) => {
    const inventoryItem = view.inventory.find((item) => item.id === id);
    return {
      id,
      label,
      count: gameState.inventory[id],
      durabilityLabel: inventoryItem?.statusLabel,
    };
  });
  const personalLight = resolvePersonalLightProfile(
    view.render.minuteOfDay,
    gameState.player.equippedItem ?? null,
    view.render.rain,
  ).source;
  const recommendedCheckpoint = checkpointEntries.find(
    (entry) => entry.slotId === recommendedCheckpointSlotId,
  ) ?? null;
  return (
    <main
      className={`game-root ${effectiveReducedMotion ? "force-reduced-motion" : ""}`}
      style={{ "--ui-scale": uiScaleFactor(uiScale) } as CSSProperties}
    >
      <canvas
        ref={canvasRef}
        className="game-canvas"
        aria-label="可移动探索的第一人称低多边形雨林场景"
        onClick={() => {
          if (!rendererReadyRef.current) return;
          enteredGameRef.current = true;
          void audioRef.current?.unlock();
          if (!activePanelRef.current && !resolution) rendererRef.current?.requestPointerLock();
        }}
      >你的浏览器需要支持 WebGL 才能运行这款游戏。</canvas>
      <div className="game-shade" aria-hidden="true" />
      <div className="game-grain" aria-hidden="true" />
      <SaveStatusIndicator status={saveStatus} />
      {hurtFlash > 0 && <div key={hurtFlash} className="danger-flash" aria-hidden="true" />}
      <Hud
        watch={view.watch}
        meters={view.hudMeters}
        objective={view.currentObjective}
        target={target}
        actionPhase={actionPhase}
        pointerLocked={pointerLocked}
        ready={rendererReady}
        events={view.events}
        compassDegrees={compassDegrees}
        personalLight={personalLight}
        onFocusGame={() => {
          if (!rendererReadyRef.current) return;
          enteredGameRef.current = true;
          rendererRef.current?.requestPointerLock();
        }}
        onOpenWatch={() => openPanel("watch")}
        onOpenBody={() => openPanel("body")}
      />
      {!resolution && (
        <PlayerStateFeedback
          signals={activePanel
            ? statusSignals.filter((signal) => signal.severity === "critical")
            : statusSignals}
          incidents={damageIncidents}
          onOpenWatch={() => openPanel("watch")}
          onOpenBody={() => openPanel("body")}
        />
      )}
      <EquipmentBar
        slots={equipmentSlots}
        equipped={gameState.player.equippedItem ?? null}
        onEquip={(itemId) => dispatchCommand({ type: "equip-item", itemId })}
      />
      {hazardCaption && <div className="hazard-caption" role="status">{hazardCaption}</div>}
      {restCheckpointBarrier.phase !== "idle" && (
        <div
          className={`checkpoint-global-notice notice-${restCheckpointBarrier.phase}`}
          role={restCheckpointBarrier.phase === "failed" ? "alert" : "status"}
          aria-live="assertive"
        >
          <strong>{restCheckpointBarrier.phase === "saving" ? "休息尚未开始" : "休息已取消"}</strong>
          <span>{restCheckpointBarrier.message}</span>
        </div>
      )}
      {checkpointNotice && (
        <div className="checkpoint-toast" role="status" aria-live="polite">{checkpointNotice}</div>
      )}
      <Panels
        active={activePanel}
        feedback={(
          <ActionFeedbackLayer
            receipts={actionReceipts}
            onExpire={expireActionReceipts}
          />
        )}
        watch={view.watch}
        inventory={view.inventory}
        recipes={view.recipes}
        body={view.body}
        objectives={view.objectives}
        events={view.events}
        landmarks={view.landmarks}
        mapChunks={view.mapChunks}
        score={view.score}
        audioEnabled={audioEnabled}
        reducedMotion={reducedMotion}
        uiScale={uiScale}
        saveStatus={saveStatus}
        saveTransferState={saveTransferState}
        localSaveDurability={localSaveDurability}
        hasPreImportSave={hasPreImportSave}
        checkpointEntries={checkpointEntries}
        recommendedCheckpointSlotId={recommendedCheckpointSlotId}
        manualCheckpointSlot={manualCheckpointSlot}
        onClose={closePanel}
        onCraft={handleCraft}
        onItemAction={handleItemAction}
        onTreatWound={() => dispatchCommand({ type: "use-item", itemId: "bandage" })}
        onTreatParasites={() => dispatchCommand({ type: "use-item", itemId: "antiparasitic-herb" })}
        onResume={closePanel}
        onRestart={startNewGame}
        onManualSave={() => requestSave("manual")}
        onSaveManualCheckpoint={saveManualCheckpoint}
        onPreviewCheckpoint={previewCheckpoint}
        onPrepareSaveExport={prepareSaveExport}
        onSelectSaveImport={selectSaveImport}
        onConfirmSaveImport={confirmSaveImport}
        onCancelSaveImport={cancelSaveImport}
        onPreparePreImportRestore={preparePreImportRestore}
        onToggleAudio={() => {
          setAudioEnabled((value) => {
            audioRef.current?.setEnabled(!value);
            return !value;
          });
        }}
        onToggleReducedMotion={() => setReducedMotion((value) => !value)}
        onUiScaleChange={changeUiScale}
      />
      <TouchControls
        visible={rendererReady && !activePanel && !resolution && restCheckpointBarrier.phase !== "saving"}
        onInput={(input: Partial<TouchInput>) => {
          if (!rendererReadyRef.current || restCheckpointBarrierRef.current) return;
          enteredGameRef.current = true;
          rendererRef.current?.setTouchInput(input);
        }}
        onInteract={() => {
          if (!rendererReadyRef.current || restCheckpointBarrierRef.current) return;
          enteredGameRef.current = true;
          rendererRef.current?.performCurrentAction();
        }}
        actionLabel={placementRecipe ? "放置" : target?.affordance.verb ?? "互动"}
        actionTarget={placementRecipe ? "建筑蓝图" : target?.label}
        actionDetail={
          placementRecipe
            ? undefined
            : target?.affordance.preview.detail
        }
        interactionMode={
          placementRecipe
            ? "execute"
            : target?.affordance.interactionMode ?? "unavailable"
        }
        actionPhase={actionPhase}
        placementActive={placementRecipe !== null}
        onRotatePlacement={() => rendererRef.current?.rotatePlacement()}
        onCancelPlacement={() => rendererRef.current?.cancelPlacement()}
        equipmentSlots={equipmentSlots}
        equipped={gameState.player.equippedItem ?? null}
        onEquip={(itemId) => dispatchCommand({ type: "equip-item", itemId })}
        onOpenPanel={openPanel}
      />
      {compatibilityError && <CompatibilityError message={compatibilityError} onRestart={() => setScreen("menu")} />}
      {resolution && activePanel !== "notebook" && (
        <ResolutionScreen
          state={gameState}
          score={view.score}
          hasCheckpoints={checkpointEntries.length > 0}
          recommendedCheckpointLabel={recommendedCheckpoint ? checkpointSummaryLabel(recommendedCheckpoint) : null}
          onChooseCheckpoint={openCheckpointPicker}
          onRestart={startNewGame}
          onNotebook={() => openPanel("notebook")}
          onContinue={() => dispatchCommand({ type: "continue-expedition" })}
        />
      )}
      {checkpointPickerOpen && (
        <CheckpointRecoveryDialog
          entries={checkpointEntries}
          recommendedSlotId={recommendedCheckpointSlotId}
          recoveryState={checkpointRecoveryState}
          onPreview={previewCheckpoint}
          onConfirm={confirmCheckpointRecovery}
          onClose={closeCheckpointPicker}
        />
      )}
    </main>
  );
}

function ResolutionScreen({ state, score, hasCheckpoints, recommendedCheckpointLabel, onChooseCheckpoint, onRestart, onNotebook, onContinue }: { state: GameState; score: number; hasCheckpoints: boolean; recommendedCheckpointLabel: string | null; onChooseCheckpoint: () => void; onRestart: () => void; onNotebook: () => void; onContinue: () => void }) {
  const won = state.status === "won";
  const minutes = Math.max(1, Math.round(state.clock.elapsedSeconds / 60));
  const [dialogRef, handleDialogKeyDown] = useDialogFocus();
  if (!won) {
    const review = deriveDeathReview(state);
    return (
      <section
        ref={dialogRef}
        className="resolution-screen"
        role="dialog"
        aria-modal="true"
        aria-labelledby="death-review-title"
        tabIndex={-1}
        onKeyDown={handleDialogKeyDown}
      >
        <div className="resolution-card death-resolution-card">
          <DeathReview
            review={review}
            summaryStats={[
              { label: "生存时间", value: `${minutes} 分钟` },
              {
                label: "完成目标",
                value: `${state.objectives.completedTaskIds.length}/${Object.keys(TASKS).length}`,
              },
              { label: "生存评分", value: String(score) },
            ]}
            hasCheckpoints={hasCheckpoints}
            recommendedCheckpointLabel={recommendedCheckpointLabel ?? undefined}
            onChooseCheckpoint={onChooseCheckpoint}
            onStartNewRun={onRestart}
            onOpenNotebook={onNotebook}
          />
        </div>
      </section>
    );
  }
  return (
    <section
      ref={dialogRef}
      className="resolution-screen"
      role="dialog"
      aria-modal="true"
      aria-labelledby="resolution-title"
      aria-describedby="resolution-description"
      tabIndex={-1}
      onKeyDown={handleDialogKeyDown}
    >
      <div className="resolution-card">
        <small>{won ? "SIGNAL RECEIVED / EXPEDITION COMPLETE" : "VITAL SIGNAL LOST / EXPEDITION FAILED"}</small>
        <h2 id="resolution-title">{won ? "雨幕里传来了应答。" : "雨林记住了这次错误。"}</h2>
        <p id="resolution-description">{won ? "你没有征服这片雨林。你只是学会了在它的规则里，多活过一个夜晚。" : state.lossReason === "sanity" ? "黑暗、湿冷与孤立最终击穿了理智。查看因果日志，找到更早的那个错误决定。" : "伤口、饥渴或疾病耗尽了身体。死亡不是随机答案，日志里保留了完整因果。"}</p>
        <div className="resolution-stats">
          <div><small>生存时间</small><strong>{minutes} 分钟</strong></div>
          <div><small>完成目标</small><strong>{state.objectives.completedTaskIds.length}/{Object.keys(TASKS).length}</strong></div>
          <div><small>生存评分</small><strong>{score}</strong></div>
        </div>
        <div className="start-actions">
          {won && <button className="button-primary" onClick={onContinue}>继续留在雨林 <span>→</span></button>}
          {!won && (
            <button className="button-primary" disabled={!hasCheckpoints} onClick={onChooseCheckpoint}>
              选择恢复点 <span>→</span>
            </button>
          )}
          {!won && recommendedCheckpointLabel && <small className="resolution-recommendation">推荐：{recommendedCheckpointLabel}</small>}
          <button className="button-ghost" onClick={onRestart}>{won ? "再次远征" : "新的远征"} <span>→</span></button>
          <button className="button-ghost" onClick={onNotebook}>查看因果日志</button>
        </div>
        {!won && !hasCheckpoints && <p className="resolution-no-checkpoints">未找到通过校验的恢复点；你仍可查看日志或开始新的远征。</p>}
      </div>
    </section>
  );
}

function CheckpointRecoveryDialog({
  entries,
  recommendedSlotId,
  recoveryState,
  onPreview,
  onConfirm,
  onClose,
}: {
  entries: readonly CheckpointTimelineEntry[];
  recommendedSlotId: CheckpointSlotId | null;
  recoveryState: CheckpointRecoveryState;
  onPreview: (slotId: CheckpointSlotId) => void;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const selectedEntry = recoveryState.phase === "preview" || recoveryState.phase === "loading"
    ? recoveryState.entry
    : null;
  const loading = recoveryState.phase === "loading";
  const [dialogRef, handleDialogKeyDown] = useDialogFocus({
    onEscape: onClose,
    escapeDisabled: loading,
  });
  return (
    <section
      ref={dialogRef}
      className="checkpoint-recovery-screen"
      role="dialog"
      aria-modal="true"
      aria-labelledby="checkpoint-recovery-title"
      aria-describedby="checkpoint-recovery-description"
      tabIndex={-1}
      onKeyDown={handleDialogKeyDown}
    >
      <div className="checkpoint-recovery-card">
        <header>
          <div>
            <small>VERIFIED LOCAL CHECKPOINTS</small>
            <h2 id="checkpoint-recovery-title">选择恢复点</h2>
            <p id="checkpoint-recovery-description">先预览，再确认载入。校验或提升活动档失败时，当前游戏状态不会改变。</p>
          </div>
          <button className="panel-close" disabled={loading} onClick={onClose} aria-label="关闭恢复点选择">×</button>
        </header>
        {recoveryState.phase === "error" && <p className="checkpoint-recovery-message is-error" role="alert">{recoveryState.message}</p>}
        {recoveryState.phase === "complete" && <p className="checkpoint-recovery-message">{recoveryState.message}</p>}
        <CheckpointTimelinePanel
          entries={entries}
          recommendedSlotId={recommendedSlotId}
          selectedSlotId={selectedEntry?.slotId ?? null}
          mode="recover"
          onSelect={onPreview}
        />
        {selectedEntry && (
          <div className="checkpoint-recovery-confirm" role="status" aria-live="polite">
            <div>
              <strong>载入第 {selectedEntry.gameDay} 天 {formatCheckpointGameTime(selectedEntry.minuteOfDay)}？</strong>
              <small>当前活动档只会在这个恢复点再次校验并成功写入后被替换。</small>
            </div>
            <button className="button-primary" disabled={loading} aria-busy={loading} onClick={onConfirm}>
              {loading ? "正在校验并载入…" : "确认载入这个恢复点"}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function CompatibilityError({ message, onRestart }: { message: string; onRestart: () => void }) {
  const [dialogRef, handleDialogKeyDown] = useDialogFocus();
  return (
    <section
      ref={dialogRef}
      className="resolution-screen"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="compatibility-title"
      aria-describedby="compatibility-description"
      tabIndex={-1}
      onKeyDown={handleDialogKeyDown}
    >
      <div className="resolution-card"><small>WEBGL INITIALIZATION FAILED</small><h2 id="compatibility-title">这台设备无法进入雨林。</h2><p id="compatibility-description">{message}。请开启浏览器硬件加速，或使用当前版本的 Chrome、Edge、Firefox 或 Safari。</p><button className="button-ghost" onClick={onRestart}>返回标题</button></div>
    </section>
  );
}

function SaveStatusIndicator({ status }: { status: SaveStatus }) {
  if (status.phase === "idle") return null;
  const tone =
    status.phase === "failed" || status.phase === "cloud-failed"
      ? "warning"
      : status.phase === "saving" || status.phase === "saved-local"
        ? "pending"
        : "success";
  return (
    <div className={`save-status-indicator save-status-${tone}`} role="status" aria-live="polite">
      <i aria-hidden="true" />
      <span>{saveStatusLabel(status)}</span>
    </div>
  );
}

function useDialogFocus(options: {
  onEscape?: () => void;
  escapeDisabled?: boolean;
} = {}): readonly [
  RefObject<HTMLElement | null>,
  (event: ReactKeyboardEvent<HTMLElement>) => void,
] {
  const ref = useRef<HTMLElement>(null);
  const { onEscape, escapeDisabled = false } = options;

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = getFocusableElements(ref.current)[0] ?? ref.current;
    first?.focus();
    return () => previous?.focus();
  }, []);

  const onKeyDown = useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
    const escapeAction = resolveDialogEscapeAction(
      event.key,
      Boolean(onEscape),
      escapeDisabled,
    );
    if (escapeAction !== "none") {
      event.preventDefault();
      event.stopPropagation();
      if (escapeAction === "close") onEscape?.();
      return;
    }
    if (event.key !== "Tab") return;
    const dialog = ref.current;
    const focusable = getFocusableElements(dialog);
    if (!dialog || focusable.length === 0) {
      event.preventDefault();
      dialog?.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !dialog.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  }, [escapeDisabled, onEscape]);

  return [ref, onKeyDown] as const;
}

function getFocusableElements(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      "button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
    ),
  );
}

function readSaveFileText(file: File): Promise<string> {
  if (typeof file.text === "function") return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("File read failed"));
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new TypeError("Save file was not text"));
    reader.readAsText(file, "utf-8");
  });
}

function createSaveImportPreview(
  sourceLabel: string,
  state: GameState,
  exportedAt?: string,
): SaveImportPreview {
  const minute = Math.max(0, Math.floor(state.clock.minuteOfDay));
  const hours = Math.floor(minute / 60) % 24;
  const minutes = minute % 60;
  return {
    sourceLabel: sourceLabel.slice(0, 160),
    exportedAt,
    day: Math.max(1, Math.floor(state.clock.day)),
    time: `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`,
    completedObjectives: state.objectives.completedTaskIds.length,
    statusLabel:
      state.status === "playing" ? "进行中" : state.status === "won" ? "已完成，可继续" : "远征已结束",
  };
}

function formatExportedAt(value: string): string {
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function createSaveFilename(state: GameState): string {
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    "-",
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
  ].join("");
  return `CANOPY-day${String(Math.max(1, state.clock.day)).padStart(2, "0")}-${stamp}.canopy-save.json`;
}

function checkpointSummaryLabel(entry: CheckpointTimelineEntry): string {
  return `第 ${entry.gameDay} 天 ${formatCheckpointGameTime(entry.minuteOfDay)} · ${entry.biomeLabel} · 生命 ${Math.round(entry.health)}`;
}

function formatCheckpointGameTime(minuteOfDay: number): string {
  const minute = Math.max(0, Math.round(minuteOfDay)) % (24 * 60);
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

export function checkpointReasonForSaveReason(reason: SaveReason): CheckpointReason | null {
  switch (reason) {
    case "new-game":
    case "rest-before":
    case "rest-after":
    case "task":
    case "milestone":
      return reason;
    default:
      return null;
  }
}

export function createCheckpointMetadata(
  state: GameState,
  reason: CheckpointReason,
  createdAt = Date.now(),
): CheckpointMetadataDraft {
  const descriptor = generateChunkDescriptor(
    String(state.seed),
    worldToChunkCoordinate(state.player.position.x, state.player.position.z),
  );
  const wound = state.player.conditions.wound;
  const statuses: Array<CheckpointMetadataDraft["majorStatuses"][number] & { priority: number }> = [];
  const addStatus = (
    label: string,
    severity: "observe" | "warning" | "critical",
    priority: number,
  ) => statuses.push({ label, severity, priority });
  if (wound.open) {
    addStatus(
      wound.treated ? "伤口已处理" : "开放伤口",
      !wound.treated && wound.severity >= 65 ? "critical" : "warning",
      !wound.treated ? 100 : 45,
    );
  }
  if (wound.infection > 5) {
    addStatus(
      `感染 ${Math.round(wound.infection)}%`,
      wound.infection >= 55 ? "critical" : "warning",
      95,
    );
  }
  if (state.player.conditions.parasites > 0) {
    addStatus(
      `寄生虫 ${state.player.conditions.parasites}`,
      state.player.conditions.parasites >= 2 ? "critical" : "warning",
      80,
    );
  }
  if (state.player.nutrition.hydration < 40) {
    addStatus(
      `水分 ${Math.round(state.player.nutrition.hydration)}`,
      state.player.nutrition.hydration < 20 ? "critical" : "warning",
      75,
    );
  }
  if (state.player.vitals.energy < 35) {
    addStatus(
      `能量 ${Math.round(state.player.vitals.energy)}`,
      state.player.vitals.energy < 15 ? "critical" : "warning",
      55,
    );
  }
  if (state.player.vitals.sanity < 40) {
    addStatus(
      `理智 ${Math.round(state.player.vitals.sanity)}`,
      state.player.vitals.sanity < 20 ? "critical" : "warning",
      85,
    );
  }
  if (state.player.conditions.wetness > 70) {
    addStatus(
      `湿冷 ${Math.round(state.player.conditions.wetness)}%`,
      state.player.conditions.wetness > 90 ? "critical" : "observe",
      35,
    );
  }
  const combat = state.eventLog.slice(-20).some((event) =>
    state.clock.tick - event.tick <= 300 &&
    ["snake-bite", "wildlife-attack", "wildlife-hit"].includes(event.type),
  );
  const severeCondition =
    (!wound.treated && wound.severity >= 65) ||
    wound.infection >= 55 ||
    state.player.conditions.parasites >= 2 ||
    state.player.nutrition.hydration < 20 ||
    state.player.vitals.sanity < 20;
  const danger =
    combat ||
    state.weather.storm ||
    severeCondition ||
    state.player.vitals.health < 45;
  const safety =
    state.status !== "playing" || state.player.vitals.health <= 20
      ? "unsafe"
      : danger
        ? "caution"
        : "safe";
  const currentTask = state.objectives.currentTaskId;
  const objectiveLabel = currentTask && TASKS[currentTask]
    ? TASKS[currentTask].label
    : state.objectives.flags.sandboxContinued
      ? "持续探索活体雨林"
      : "自由远征";

  return {
    reason,
    createdAt: Math.max(1, Math.floor(createdAt)),
    gameDay: Math.max(1, Math.floor(state.clock.day)),
    minuteOfDay: Math.max(0, Math.min(1439.999, state.clock.minuteOfDay)),
    elapsedSeconds: Math.max(0, state.clock.elapsedSeconds),
    objectiveLabel,
    position: {
      x: state.player.position.x,
      z: state.player.position.z,
    },
    biomeLabel: BIOME_PROFILES[descriptor.biome].label,
    health: Math.max(0, Math.min(100, state.player.vitals.health)),
    majorStatuses: statuses
      .sort((left, right) => right.priority - left.priority)
      .slice(0, 2)
      .map(({ label, severity }) => ({ label, severity })),
    storm: state.weather.storm,
    combat,
    danger,
    safety,
  };
}

function createSessionSeed(): number {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0] || 1;
}

function getDeviceId(): string {
  const key = "canopy_device_id";
  try {
    const existing = window.localStorage.getItem(key);
    if (existing) return existing;
    const created = createRandomId();
    window.localStorage.setItem(key, created);
    return created;
  } catch {
    return `ephemeral-${createRandomId()}`;
  }
}

function createRandomId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function isGameState(payload: unknown): payload is GameState {
  if (!payload || typeof payload !== "object") return false;
  const candidate = payload as Partial<GameState>;
  if (
    candidate.version !== 1 ||
    !Number.isSafeInteger(candidate.seed) ||
    (candidate.seed ?? 0) <= 0 ||
    !["playing", "won", "lost"].includes(candidate.status ?? "") ||
    !candidate.clock ||
    !Number.isSafeInteger(candidate.clock.tick) ||
    candidate.clock.tick < 0 ||
    !candidate.player ||
    !candidate.player.position ||
    !Number.isFinite(candidate.player.position.x) ||
    !Number.isFinite(candidate.player.position.z) ||
    !candidate.inventory ||
    !candidate.world ||
    !candidate.world.entities ||
    Object.keys(candidate.world.entities).length > 100_000 ||
    !candidate.objectives ||
    !Array.isArray(candidate.objectives.completedTaskIds) ||
    !Array.isArray(candidate.eventLog) ||
    candidate.eventLog.length > 20_000
  ) {
    return false;
  }
  try {
    const migrated = migrateGameState(candidate as GameState);
    return (
      Number.isSafeInteger(migrated.clock.tick) &&
      migrated.clock.tick >= 0 &&
      Number.isFinite(migrated.player.position.x) &&
      Number.isFinite(migrated.player.position.z)
    );
  } catch {
    return false;
  }
}

function isContinuableSave(state: GameState): boolean {
  return state.status === "playing" || state.status === "won";
}

export function yawToCompassDegrees(yaw: number): number {
  // Three.js looks down -Z at yaw 0, while the authored paper map uses +Z as
  // north. The 180-degree offset keeps the compass, map and task directions in sync.
  return normalizeDegrees((yaw * 180) / Math.PI + 180);
}

function readRetainedRecipes(): RecipeId[] {
  if (typeof window === "undefined") return ["stone-blade"];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(KNOWLEDGE_KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return ["stone-blade"];
    return RECIPE_IDS.filter((recipeId) => recipeId === "stone-blade" || parsed.includes(recipeId));
  } catch {
    return ["stone-blade"];
  }
}

function writeRetainedRecipes(recipes: readonly RecipeId[]): void {
  try {
    window.localStorage.setItem(KNOWLEDGE_KEY, JSON.stringify(recipes));
  } catch {
    // Knowledge still remains available for the current session.
  }
}

function normalizeDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}
