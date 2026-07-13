"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react";
import { AudioEngine } from "./audio/AudioEngine";
import { ToyBridgeCloudKV, createSaveRepository, type SaveRepository } from "./persistence";
import { createToyBridgeClient, type ToyBridgeClient } from "./platform/toyBridge";
import type { RainforestRenderer } from "./render/RainforestRenderer";
import type { InteractionTarget, PlayerFrame, TouchInput } from "./render/types";
import {
  applyCommand,
  createInitialState,
  RECIPE_IDS,
  stepSimulation,
  type GameCommand,
  type GameState,
  type ItemId,
  type RecipeId,
} from "./sim";
import { Hud } from "./ui/Hud";
import { Panels } from "./ui/Panels";
import { StartScreen } from "./ui/StartScreen";
import { TouchControls } from "./ui/TouchControls";
import type { InventoryItemView, PanelId } from "./ui/types";
import { createGameViewModel } from "./ui/viewModel";

const SAVE_KEY = "canopy_first_night_v2";
const CONTENT_VERSION = "canopy-first-night@3";
const KNOWLEDGE_KEY = "canopy_field_knowledge_v1";
const SIMULATION_INTERVAL_MS = 100;

export default function GameClient() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<RainforestRenderer | null>(null);
  const audioRef = useRef<AudioEngine | null>(null);
  const repositoryRef = useRef<SaveRepository<GameState> | null>(null);
  const toyRef = useRef<ToyBridgeClient | null>(null);
  const stateRef = useRef<GameState | null>(null);
  const savedStateRef = useRef<GameState | null>(null);
  const activePanelRef = useRef<PanelId | null>(null);
  const playerFrameRef = useRef<PlayerFrame | null>(null);
  const commandRef = useRef<(command: GameCommand) => void>(() => undefined);
  const interactionRef = useRef<(target: InteractionTarget) => void>(() => undefined);
  const lastEventIdRef = useRef(0);
  const loadGenerationRef = useRef(0);
  const stepDistanceRef = useRef(0);
  const enteredGameRef = useRef(false);
  const rendererReadyRef = useRef(false);
  const lastHudFrameRef = useRef(0);
  const lastEnvironmentFrameRef = useRef(0);
  const reducedMotionRef = useRef(false);
  const hazardCaptionTimerRef = useRef<number | null>(null);

  const [screen, setScreen] = useState<"menu" | "game">("menu");
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [canContinue, setCanContinue] = useState(false);
  const [activePanel, setActivePanel] = useState<PanelId | null>(null);
  const [target, setTarget] = useState<InteractionTarget | null>(null);
  const [pointerLocked, setPointerLocked] = useState(false);
  const [compassDegrees, setCompassDegrees] = useState(180);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [rendererReady, setRendererReady] = useState(false);
  const [hurtFlash, setHurtFlash] = useState(0);
  const [compatibilityError, setCompatibilityError] = useState<string | null>(null);
  const [hazardCaption, setHazardCaption] = useState<string | null>(null);
  const [retainedRecipes, setRetainedRecipes] = useState<RecipeId[]>(readRetainedRecipes);

  const view = useMemo(() => gameState ? createGameViewModel(gameState, retainedRecipes) : null, [gameState, retainedRecipes]);
  const gameStatus = gameState?.status ?? null;

  const commitState = useCallback((next: GameState) => {
    stateRef.current = next;
    setGameState(next);
  }, []);

  const dispatchCommand = useCallback((command: GameCommand) => {
    const current = stateRef.current;
    if (!current || current.status !== "playing") return;
    commitState(applyCommand(current, command));
  }, [commitState]);
  useEffect(() => {
    commandRef.current = dispatchCommand;
  }, [dispatchCommand]);

  const openPanel = useCallback((panel: PanelId) => {
    const next = activePanelRef.current === panel ? null : panel;
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
    const state = stateRef.current;
    if (!state) return;
    const entity = state.world.entities[interaction.id];
    if (!entity || entity.depleted) return;
    if (entity.kind === "resource") {
      const axeHarvest = entity.itemId && ["stick", "vine", "broad-leaf", "dry-leaf"].includes(entity.itemId);
      commandRef.current({
        type: "pick-up",
        entityId: entity.id,
        amount: axeHarvest && state.inventory.axe > 0 ? 3 : 1,
      });
    } else if (entity.kind === "water") {
      commandRef.current({ type: "collect-water", sourceEntityId: entity.id });
    } else if (entity.kind === "radio") {
      commandRef.current(
        state.camp.beaconBuilt && state.objectives.currentTaskId === "transmit-signal"
          ? { type: "transmit" }
          : { type: "inspect-landmark", entityId: entity.id },
      );
    } else if (entity.kind === "landmark") {
      commandRef.current({ type: "inspect-landmark", entityId: entity.id });
    }
  }, []);
  useEffect(() => {
    interactionRef.current = handleInteraction;
  }, [handleInteraction]);

  useEffect(() => {
    let refreshTimer: number | null = null;
    const timer = window.setTimeout(() => {
      const toy = createToyBridgeClient({ timeoutMs: 1500 });
      toyRef.current = toy;
      const repository = createSaveRepository<GameState>({
        key: SAVE_KEY,
        schema: 1,
        content: CONTENT_VERSION,
        device: getDeviceId(),
        cloud: new ToyBridgeCloudKV(toy),
        payloadValidator: isGameState,
      });
      repositoryRef.current = repository;
      if (stateRef.current) {
        loadGenerationRef.current += 1;
        void repository.clear();
        return;
      }
      const generation = ++loadGenerationRef.current;
      void repository.load().then((result) => {
        if (generation !== loadGenerationRef.current || stateRef.current) return;
        if (result.ok && result.envelope.payload.status === "playing") {
          savedStateRef.current = result.envelope.payload;
          setCanContinue(true);
        }
        refreshTimer = window.setTimeout(() => {
          if (generation !== loadGenerationRef.current || stateRef.current) return;
          void repository.refreshFromCloud().then((refresh) => {
            if (generation !== loadGenerationRef.current || stateRef.current) return;
            if ((refresh.status === "updated" || refresh.status === "up-to-date") && refresh.envelope.payload.status === "playing") {
              savedStateRef.current = refresh.envelope.payload;
              setCanContinue(true);
            }
          });
        }, 2500);
      });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      loadGenerationRef.current += 1;
    };
  }, []);

  const startState = useCallback((state: GameState, eventId: string) => {
    stateRef.current = state;
    lastEventIdRef.current = state.eventLog.at(-1)?.id ?? 0;
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
    rendererRef.current?.resetRun();
    rendererRef.current?.setTouchInput({ forward: 0, right: 0, lookX: 0, lookY: 0, sprint: false });
    rendererRef.current?.setPlayerPosition(state.player.position.x, state.player.position.z, Math.PI);
    rendererRef.current?.setSnapshot(createGameViewModel(state).render);
    audioRef.current ??= new AudioEngine();
    void audioRef.current.unlock();
    void toyRef.current?.reportAction(eventId);
  }, []);

  const startNewGame = useCallback(() => {
    loadGenerationRef.current += 1;
    const seed = createSessionSeed();
    const state = createInitialState(seed);
    savedStateRef.current = null;
    setCanContinue(false);
    void repositoryRef.current?.clear();
    startState(state, "canopy_start_new_game");
  }, [startState]);

  const continueGame = useCallback(() => {
    if (!savedStateRef.current) return;
    loadGenerationRef.current += 1;
    startState(savedStateRef.current, "canopy_continue_game");
  }, [startState]);

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
          onInteract: (interaction) => interactionRef.current(interaction),
          onPlayerFrame: (frame) => {
            playerFrameRef.current = frame;
            const now = performance.now();
            if (now - lastHudFrameRef.current >= 100) {
              lastHudFrameRef.current = now;
              setCompassDegrees(normalizeDegrees(THREEYawToCompass(frame.yaw)));
            }
            stepDistanceRef.current += frame.distance;
            if (stepDistanceRef.current > (frame.sprinting ? 1.35 : 1.05)) {
              stepDistanceRef.current = 0;
              audioRef.current?.cue("step");
            }
            const state = stateRef.current;
            if (state && now - lastEnvironmentFrameRef.current >= 200) {
              lastEnvironmentFrameRef.current = now;
              audioRef.current?.setEnvironment(state.weather.rainIntensity, state.camp.fire.lit, frame.sheltered);
            }
          },
          onHazard: (hazardId) => {
            if (hazardCaptionTimerRef.current !== null) window.clearTimeout(hazardCaptionTimerRef.current);
            hazardCaptionTimerRef.current = null;
            setHazardCaption(null);
            commandRef.current({ type: "encounter-hazard", entityId: hazardId });
          },
          onHazardWarning: () => {
            audioRef.current?.cue("warning");
            setHazardCaption("附近草丛传来急促嘶声——放慢脚步，绕行或准备石矛。");
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
        renderer.setReducedMotion(reducedMotionRef.current);
        const player = stateRef.current.player.position;
        renderer.setPlayerPosition(player.x, player.z, Math.PI);
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
  }, [screen]);

  useEffect(() => {
    if (view) rendererRef.current?.setSnapshot(view.render);
  }, [view]);

  useEffect(() => {
    reducedMotionRef.current = reducedMotion;
    rendererRef.current?.setReducedMotion(reducedMotion);
  }, [reducedMotion]);

  useEffect(() => {
    if (screen !== "game") return;
    const interval = window.setInterval(() => {
      const current = stateRef.current;
      if (!current || current.status !== "playing" || !rendererReadyRef.current || !enteredGameRef.current || activePanelRef.current !== null || document.hidden) return;
      const frame = playerFrameRef.current;
      const movement = frame ? {
        x: frame.x - current.player.position.x,
        z: frame.z - current.player.position.z,
        sprint: frame.sprinting,
        inWater: frame.inWater,
        sheltered: frame.sheltered,
      } : undefined;
      let next = stepSimulation(current, { movement }, SIMULATION_INTERVAL_MS / 1000);
      if (frame) next = applyCommand(next, { type: "move-player", position: { x: frame.x, y: 0, z: frame.z } });
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
      if (event.type === "craft-succeeded" || event.type === "water-purified" || event.type === "wound-treated" || event.type === "rest-completed") audioRef.current?.cue("craft");
      if (event.type === "parasite-contracted" || event.type === "game-lost") {
        audioRef.current?.cue("hurt");
        setHurtFlash((value) => value + 1);
      }
      if (event.type === "snake-bite") {
        audioRef.current?.cue("hurt");
        setHurtFlash((value) => value + 1);
      }
      if (event.type === "threat-avoided") audioRef.current?.cue("success");
      if (event.type === "weather-changed" || event.type === "fire-extinguished") audioRef.current?.cue("warning");
      if (event.type === "task-completed" || event.type === "game-won") audioRef.current?.cue("success");
      if (event.type === "landmark-inspected") audioRef.current?.cue("success");
      if (event.type === "game-won") void toyRef.current?.reportAction("canopy_game_won");
      if (event.type === "game-lost") void toyRef.current?.reportAction("canopy_game_lost");
    }
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
  }, [gameState]);

  useEffect(() => {
    if (!gameStatus || gameStatus === "playing") return;
    rendererRef.current?.setPaused(true);
    rendererRef.current?.releasePointerLock();
  }, [gameStatus]);

  useEffect(() => {
    if (screen !== "game") return;
    const save = () => {
      const state = stateRef.current;
      const repository = repositoryRef.current;
      if (!state || !repository) return;
      void repository.save(state, { seed: state.seed, simTick: state.clock.tick });
    };
    const interval = window.setInterval(save, 5000);
    const onVisibility = () => { if (document.hidden) save(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
      save();
    };
  }, [screen]);

  useEffect(() => {
    if (screen !== "game") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;
      if (activePanelRef.current) {
        if (event.code === "Escape") {
          event.preventDefault();
          closePanel();
        }
        return;
      }
      if (stateRef.current?.status !== "playing") return;
      const panelByCode: Partial<Record<string, PanelId>> = {
        KeyF: "watch", Tab: "inventory", KeyC: "crafting", KeyB: "body", KeyN: "notebook", KeyM: "map",
      };
      const panel = panelByCode[event.code];
      if (panel) {
        event.preventDefault();
        openPanel(panel);
      } else if (event.code === "Escape") {
        event.preventDefault();
        openPanel("pause");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [screen, closePanel, openPanel]);

  useEffect(() => () => {
    if (hazardCaptionTimerRef.current !== null) window.clearTimeout(hazardCaptionTimerRef.current);
    audioRef.current?.dispose();
    audioRef.current = null;
  }, []);

  const handleCraft = useCallback((id: string) => {
    if (id === "boil-water") dispatchCommand({ type: "boil-water" });
    else if (id === "add-fuel") dispatchCommand({ type: "add-fuel" });
    else if (id === "collect-rainwater") dispatchCommand({ type: "collect-rainwater" });
    else if (id === "rest") dispatchCommand({ type: "rest" });
    else dispatchCommand({ type: "craft", recipeId: id as RecipeId });
  }, [dispatchCommand]);

  const handleItemAction = useCallback((item: InventoryItemView) => {
    if (item.action === "eat") dispatchCommand({ type: "eat", itemId: item.id as ItemId });
    else if (item.action === "drink") dispatchCommand({ type: "drink-water", itemId: item.id as "clean-water" | "dirty-water" });
    else if (item.id === "bandage") dispatchCommand({ type: "use-item", itemId: "bandage" });
    else if (item.id === "antiparasitic-herb") dispatchCommand({ type: "use-item", itemId: "antiparasitic-herb" });
  }, [dispatchCommand]);

  if (screen === "menu" || !gameState || !view) {
    return <StartScreen canContinue={canContinue} onNewGame={startNewGame} onContinue={continueGame} />;
  }

  const resolution = gameState.status !== "playing";
  return (
    <main className={`game-root ${reducedMotion ? "force-reduced-motion" : ""}`}>
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
      {hurtFlash > 0 && <div key={hurtFlash} className="danger-flash" aria-hidden="true" />}
      <Hud
        watch={view.watch}
        meters={view.hudMeters}
        objective={view.currentObjective}
        target={target}
        pointerLocked={pointerLocked}
        ready={rendererReady}
        events={view.events}
        compassDegrees={compassDegrees}
        onFocusGame={() => {
          if (!rendererReadyRef.current) return;
          enteredGameRef.current = true;
          rendererRef.current?.requestPointerLock();
        }}
        onOpenWatch={() => openPanel("watch")}
        onOpenBody={() => openPanel("body")}
      />
      {hazardCaption && <div className="hazard-caption" role="status">{hazardCaption}</div>}
      <Panels
        active={activePanel}
        watch={view.watch}
        inventory={view.inventory}
        recipes={view.recipes}
        body={view.body}
        objectives={view.objectives}
        events={view.events}
        landmarks={view.landmarks}
        score={view.score}
        audioEnabled={audioEnabled}
        reducedMotion={reducedMotion}
        onClose={closePanel}
        onCraft={handleCraft}
        onItemAction={handleItemAction}
        onTreatWound={() => dispatchCommand({ type: "use-item", itemId: "bandage" })}
        onTreatParasites={() => dispatchCommand({ type: "use-item", itemId: "antiparasitic-herb" })}
        onResume={closePanel}
        onRestart={startNewGame}
        onToggleAudio={() => {
          setAudioEnabled((value) => {
            audioRef.current?.setEnabled(!value);
            return !value;
          });
        }}
        onToggleReducedMotion={() => setReducedMotion((value) => !value)}
      />
      <TouchControls
        visible={rendererReady && !activePanel && !resolution}
        onInput={(input: Partial<TouchInput>) => {
          if (!rendererReadyRef.current) return;
          enteredGameRef.current = true;
          rendererRef.current?.setTouchInput(input);
        }}
        onInteract={() => {
          if (!rendererReadyRef.current) return;
          enteredGameRef.current = true;
          rendererRef.current?.interact();
        }}
        onOpenPack={() => openPanel("inventory")}
        onOpenBody={() => openPanel("body")}
      />
      {compatibilityError && <CompatibilityError message={compatibilityError} onRestart={() => setScreen("menu")} />}
      {resolution && activePanel !== "notebook" && <ResolutionScreen state={gameState} score={view.score} onRestart={startNewGame} onNotebook={() => openPanel("notebook")} />}
    </main>
  );
}

function ResolutionScreen({ state, score, onRestart, onNotebook }: { state: GameState; score: number; onRestart: () => void; onNotebook: () => void }) {
  const won = state.status === "won";
  const minutes = Math.max(1, Math.round(state.clock.elapsedSeconds / 60));
  const [dialogRef, handleDialogKeyDown] = useDialogFocus();
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
          <div><small>完成目标</small><strong>{state.objectives.completedTaskIds.length}/5</strong></div>
          <div><small>生存评分</small><strong>{score}</strong></div>
        </div>
        <div className="start-actions">
          <button className="button-primary" onClick={onRestart}>再次远征 <span>→</span></button>
          <button className="button-ghost" onClick={onNotebook}>查看因果日志</button>
        </div>
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

function useDialogFocus(): readonly [
  RefObject<HTMLElement | null>,
  (event: ReactKeyboardEvent<HTMLElement>) => void,
] {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = getFocusableElements(ref.current)[0] ?? ref.current;
    first?.focus();
    return () => previous?.focus();
  }, []);

  const onKeyDown = useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
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
  }, []);

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
  return candidate.version === 1 && typeof candidate.seed === "number" && ["playing", "won", "lost"].includes(candidate.status ?? "") && Boolean(candidate.clock && candidate.player && candidate.inventory && candidate.world);
}

function THREEYawToCompass(yaw: number): number {
  return (yaw * 180) / Math.PI;
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
