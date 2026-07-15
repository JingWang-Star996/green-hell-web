import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  MANUAL_CHECKPOINT_SLOTS,
  saveStatusLabel,
  type CheckpointSlotId,
  type CheckpointTimelineEntry,
  type ManualCheckpointSlotId,
  type SaveStatus,
} from "../persistence";
import {
  SaveTransferControls,
  type SaveTransferState,
} from "./SaveTransferControls";
import { UI_SCALE_MAX, UI_SCALE_MIN, UI_SCALE_STEP } from "./uiSettings";
import {
  CRAFTING_SECTION_LABELS,
  craftingActionPolicy,
  groupCraftingRecipes,
} from "./actionUx";
import {
  createInventoryFilterOptions,
  groupInventoryItems,
  INVENTORY_SECTION_LABELS,
  inventorySectionForItem,
  isUrgentInventoryItem,
  type InventoryFilterId,
} from "./inventoryOrganization";
import type {
  BodyView,
  EventView,
  InventoryItemView,
  MapChunkView,
  MapLandmark,
  ObjectiveView,
  PanelId,
  RecipeRequirementView,
  RecipeView,
  WatchView,
} from "./types";

type PanelsProps = {
  active: PanelId | null;
  feedback: ReactNode;
  watch: WatchView;
  inventory: InventoryItemView[];
  recipes: RecipeView[];
  body: BodyView;
  objectives: ObjectiveView[];
  events: EventView[];
  landmarks: MapLandmark[];
  mapChunks: MapChunkView[];
  score: number;
  audioEnabled: boolean;
  reducedMotion: boolean;
  uiScale?: number;
  saveStatus: SaveStatus;
  saveTransferState?: SaveTransferState;
  localSaveDurability?: "persistent" | "ephemeral";
  hasPreImportSave?: boolean;
  checkpointEntries?: CheckpointTimelineEntry[];
  recommendedCheckpointSlotId?: CheckpointSlotId | null;
  manualCheckpointSlot?: ManualCheckpointSlotId | null;
  onClose: () => void;
  onCraft: (recipeId: string) => boolean;
  onItemAction: (item: InventoryItemView) => void;
  onTreatWound: () => void;
  onTreatParasites: () => void;
  onResume: () => void;
  onRestart: () => void;
  onManualSave: () => void;
  onSaveManualCheckpoint?: (slotId: ManualCheckpointSlotId) => void;
  onPreviewCheckpoint?: (slotId: CheckpointSlotId) => void;
  onPrepareSaveExport?: () => void;
  onSelectSaveImport?: (file: File) => void;
  onConfirmSaveImport?: () => void;
  onCancelSaveImport?: () => void;
  onPreparePreImportRestore?: () => void;
  onToggleAudio: () => void;
  onToggleReducedMotion: () => void;
  onUiScaleChange?: (value: number) => void;
};

export function Panels(props: PanelsProps) {
  return (
    <div
      className={props.active ? "panel-backdrop" : "panel-feedback-host"}
      role={props.active ? "dialog" : undefined}
      aria-modal={props.active ? "true" : undefined}
      aria-labelledby={props.active ? "panel-title" : undefined}
      onMouseDown={props.active ? props.onClose : undefined}
    >
      {props.active && <ActivePanel {...props} active={props.active} />}
      {props.feedback}
    </div>
  );
}

/**
 * Rest is a verified asynchronous transaction. Its panel is closed by
 * GameClient only after the post-rest recovery point and state commit succeed.
 */
export function shouldCloseCraftingPanelImmediately(
  recipeId: string,
  accepted: boolean,
): boolean {
  return (
    accepted &&
    recipeId !== "rest" &&
    craftingActionPolicy(recipeId).closePanel
  );
}

function ActivePanel(props: PanelsProps & { active: PanelId }) {
  const dialogRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLElement>("button:not([disabled]), summary, [href], [tabindex]:not([tabindex='-1'])")?.focus();
    });
    return () => {
      window.cancelAnimationFrame(frame);
      previous?.focus();
    };
  }, [props.active]);

  const titleMap: Record<PanelId, [string, string]> = {
    watch: ["生物手表", "BIOMETRIC WATCH / F"],
    inventory: ["野外背包", "FIELD PACK / TAB"],
    crafting: ["手工制作", "CRAFTING / C"],
    body: ["身体检查", "BODY INSPECTION / B"],
    notebook: ["生存笔记", "FIELD NOTES / N"],
    map: ["防水纸图", "TOPOGRAPHIC MAP / M"],
    pause: ["远征暂停", "SESSION PAUSED / ESC"],
  };
  const [title, kicker] = titleMap[props.active];
  return (
    <section
      ref={dialogRef}
      className={`game-panel panel-${props.active}`}
      onMouseDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key !== "Tab" || !dialogRef.current) return;
        const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), summary, [href], [tabindex]:not([tabindex='-1'])"));
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
    >
      <header className="panel-header">
        <div><small>{kicker}</small><h2 id="panel-title">{title}</h2></div>
        <button className="panel-close" onClick={props.onClose} aria-label="关闭面板">×</button>
      </header>
      <div className="panel-body">
        {props.active === "watch" && <WatchPanel watch={props.watch} />}
        {props.active === "inventory" && <InventoryPanel items={props.inventory} onAction={props.onItemAction} />}
        {props.active === "crafting" && (
          <CraftingPanel
            recipes={props.recipes}
            onCraft={(recipe) => {
              const accepted = props.onCraft(recipe.id);
              if (shouldCloseCraftingPanelImmediately(recipe.id, accepted)) {
                props.onClose();
              }
            }}
          />
        )}
        {props.active === "body" && <BodyPanel body={props.body} onTreatWound={props.onTreatWound} onTreatParasites={props.onTreatParasites} />}
        {props.active === "notebook" && <NotebookPanel objectives={props.objectives} events={props.events} score={props.score} />}
        {props.active === "map" && <MapPanel landmarks={props.landmarks} chunks={props.mapChunks} coordinates={props.watch.coordinates} biome={props.watch.biome} />}
        {props.active === "pause" && (
          <PausePanel
            audioEnabled={props.audioEnabled}
            reducedMotion={props.reducedMotion}
            uiScale={props.uiScale ?? 100}
            saveStatus={props.saveStatus}
            saveTransferState={props.saveTransferState ?? { phase: "idle" }}
            localSaveDurability={props.localSaveDurability ?? "persistent"}
            hasPreImportSave={props.hasPreImportSave ?? false}
            checkpointEntries={props.checkpointEntries ?? []}
            recommendedCheckpointSlotId={props.recommendedCheckpointSlotId ?? null}
            manualCheckpointSlot={props.manualCheckpointSlot ?? null}
            onResume={props.onResume}
            onRestart={props.onRestart}
            onManualSave={props.onManualSave}
            onSaveManualCheckpoint={props.onSaveManualCheckpoint ?? (() => undefined)}
            onPreviewCheckpoint={props.onPreviewCheckpoint ?? (() => undefined)}
            onPrepareSaveExport={props.onPrepareSaveExport ?? (() => undefined)}
            onSelectSaveImport={props.onSelectSaveImport ?? (() => undefined)}
            onConfirmSaveImport={props.onConfirmSaveImport ?? (() => undefined)}
            onCancelSaveImport={props.onCancelSaveImport ?? (() => undefined)}
            onPreparePreImportRestore={props.onPreparePreImportRestore ?? (() => undefined)}
            onToggleAudio={props.onToggleAudio}
            onToggleReducedMotion={props.onToggleReducedMotion}
            onUiScaleChange={props.onUiScaleChange ?? (() => undefined)}
          />
        )}
      </div>
    </section>
  );
}

function WatchPanel({ watch }: { watch: WatchView }) {
  return (
    <div className="watch-layout">
      <div className="watch-face">
        <div className="watch-time"><small>DAY {watch.day}</small><strong>{watch.time}</strong><span>{watch.weather}</span></div>
        <div className="watch-coordinates"><small>GPS / COMPASS · {watch.biome}</small><b>{watch.coordinates}</b></div>
        <div className="watch-rain"><i style={{ width: `${watch.rain * 100}%` }} /><span>降雨强度 {Math.round(watch.rain * 100)}%</span></div>
      </div>
      <div className="macro-grid">
        {watch.meters.map((meter) => (
          <article key={meter.id} className={`macro macro-${meter.tone}`}>
            <div className="macro-ring" style={{ "--meter": `${meter.value * 3.6}deg` } as React.CSSProperties}><span>{Math.round(meter.value)}</span></div>
            <div><strong>{meter.label}</strong><small>{meter.value < 25 ? "危险水平" : meter.value < 50 ? "需要补充" : "储备稳定"}</small></div>
          </article>
        ))}
      </div>
    </div>
  );
}

function InventoryPanel({ items, onAction }: { items: InventoryItemView[]; onAction: (item: InventoryItemView) => void }) {
  const [selectedFilter, setSelectedFilter] = useState<InventoryFilterId>("all");
  const carried = items.filter((item) => item.count > 0);
  const filters = createInventoryFilterOptions(items);
  const activeFilter = filters.some((filter) => filter.id === selectedFilter) ? selectedFilter : "all";
  const sections = groupInventoryItems(items, activeFilter);
  const urgentCount = carried.filter(isUrgentInventoryItem).length;
  return (
    <div className="inventory-layout">
      <div className="inventory-summary">
        <span>已携带 <b>{carried.length}</b> 类物品</span>
        <small>
          {urgentCount > 0 ? <><b>{urgentCount}</b> 类补给或状态需要优先查看。</> : "准备决定你能走多远，也决定你能否回来。"}
        </small>
      </div>

      <aside className="inventory-quick-equipment" aria-label="快捷装备说明">
        <span aria-hidden="true">1–3</span>
        <div>
          <strong>快捷装备区</strong>
          <p>装备由底部快捷栏管理；背包内的“装备 / 收起”与快捷栏使用同一状态。</p>
        </div>
      </aside>

      {carried.length > 0 && (
        <nav className="inventory-filters" aria-label="背包物品分类">
          {filters.map((filter) => (
            <button
              key={filter.id}
              type="button"
              className={activeFilter === filter.id ? "is-selected" : ""}
              aria-pressed={activeFilter === filter.id}
              aria-controls="inventory-filter-results"
              onClick={() => setSelectedFilter(filter.id)}
            >
              <span>{filter.label}</span>
              <small aria-label={`${filter.count} 类`}>{filter.count}</small>
            </button>
          ))}
        </nav>
      )}

      <div className="inventory-sections" id="inventory-filter-results" aria-live="polite">
        {carried.length === 0 && <div className="empty-state">背包是空的。先在坠落点附近观察地面。</div>}
        {sections.map((section) => {
          const sectionLabel = INVENTORY_SECTION_LABELS[section.id];
          return (
            <section className={`inventory-section inventory-section-${section.id}`} key={section.id} aria-labelledby={`inventory-section-${section.id}`}>
              <header>
                <div>
                  <h3 id={`inventory-section-${section.id}`}>{sectionLabel.title}</h3>
                  <p>{sectionLabel.description}</p>
                </div>
                <span>{section.items.length} 类</span>
              </header>
              <div className="inventory-grid">
                {section.items.map((item) => {
                  const urgent = isUrgentInventoryItem(item);
                  return (
                    <article key={item.id} className={`inventory-item item-${item.category} ${urgent ? "is-urgent" : ""}`}>
                      <span className="item-symbol" aria-hidden="true">{item.label.slice(0, 1)}</span>
                      <div>
                        <small>{INVENTORY_SECTION_LABELS[inventorySectionForItem(item)].title}</small>
                        <strong>{item.label}</strong>
                        <p>{item.description}</p>
                        {item.statusLabel && (
                          <small className={`item-lifecycle status-${item.statusTone ?? "stable"}`}>
                            <span>状态</span>{item.statusLabel}
                          </small>
                        )}
                        {item.waterContainer && <WaterContainerLifecycle item={item} />}
                        {item.durableUnits && item.durableUnits.length > 0 && (
                          <DurableToolUnits item={item} />
                        )}
                        {urgent && <small className="item-priority">优先处理</small>}
                      </div>
                      <b className="item-count" aria-label={`数量 ${item.count}`}>×{item.count}</b>
                      {item.action && (
                        <button type="button" aria-label={`${item.actionLabel ?? "使用"}${item.label}`} onClick={() => onAction(item)}>
                          {item.actionLabel ?? "使用"}
                        </button>
                      )}
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function WaterContainerLifecycle({ item }: { item: InventoryItemView }) {
  const lifecycle = item.waterContainer;
  if (!lifecycle) return null;
  const roleExplanation =
    lifecycle.role === "container"
      ? "这里的数量是全部物理椰壳，不只是空壳。"
      : lifecycle.role === "dirty-water"
        ? "每份浑浊水正占用一个椰壳；饮用或煮沸会改变占用状态。"
        : "每份净水正占用一个椰壳；饮用后该椰壳重新变空。";

  return (
    <aside className="container-lifecycle" aria-label="椰壳容器占用">
      <strong>同一组物理椰壳</strong>
      <p>{roleExplanation}</p>
      <dl>
        <div><dt>总数</dt><dd>{lifecycle.total}</dd></div>
        <div><dt>空壳</dt><dd>{lifecycle.empty}</dd></div>
        <div><dt>装浑浊水</dt><dd>{lifecycle.dirtyWater}</dd></div>
        <div><dt>装净水</dt><dd>{lifecycle.cleanWater}</dd></div>
      </dl>
    </aside>
  );
}

function DurableToolUnits({ item }: { item: InventoryItemView }) {
  const units = item.durableUnits ?? [];
  return (
    <div className="durable-unit-group">
      <small>从上到下按实际消耗顺序</small>
      <ol aria-label={`${item.label}按实际使用顺序`}>
        {units.map((unit) => {
          const roleLabel =
            unit.role === "equipped"
              ? "已装备 · 当前使用"
              : unit.role === "next-use"
                ? "下次使用 · 当前未装备"
                : "备用";
          return (
            <li
              key={`${item.id}-${unit.useOrder}`}
              className={`durable-unit durable-unit-${unit.role} status-${unit.statusTone}`}
              aria-current={unit.role === "equipped" ? "true" : undefined}
            >
              <span>第 {unit.useOrder} 件</span>
              <b>{roleLabel}</b>
              <strong>{unit.statusLabel}</strong>
              <meter
                min={0}
                max={unit.maxDurability}
                low={unit.maxDurability * 0.2}
                high={unit.maxDurability * 0.5}
                optimum={unit.maxDurability}
                value={unit.durability}
                aria-label={`${item.label}第 ${unit.useOrder} 件，${roleLabel}，${unit.statusLabel}`}
              />
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function CraftingPanel({ recipes, onCraft }: { recipes: RecipeView[]; onCraft: (recipe: RecipeView) => void }) {
  const groups = groupCraftingRecipes(recipes);
  return (
    <div className="crafting-layout">
      <div className="recipe-discovery-note"><b>{recipes.length}</b><span>条知识已写入笔记。观察材料、处理身体问题与经历危险，会揭示新的组合。</span></div>
      {groups.map((group) => (
        <section className={`recipe-section recipe-section-${group.id}`} key={group.id} aria-labelledby={`recipe-section-${group.id}`}>
          <header>
            <small>{String(group.recipes.length).padStart(2, "0")} ACTIONS</small>
            <h3 id={`recipe-section-${group.id}`}>{CRAFTING_SECTION_LABELS[group.id].title}</h3>
            <p>{CRAFTING_SECTION_LABELS[group.id].description}</p>
          </header>
          <div className="recipe-grid">
            {group.recipes.map((recipe, index) => (
              <article key={recipe.id} className={`${recipe.available ? "can-craft" : ""} ${recipe.completed ? "is-complete" : ""}`}>
                <span className="recipe-number">{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <small>{recipe.completed ? "已完成" : "已记录配方"}</small>
                  <h3>{recipe.label}</h3>
                  <p>{recipe.description}</p>
                  {recipe.statusLabel && <b className="recipe-status">{recipe.statusLabel}</b>}
                </div>
                {recipe.requirements?.length ? (
                  <RecipeRequirements requirements={recipe.requirements} />
                ) : (
                  <ul>{recipe.ingredients.map((ingredient) => <li key={ingredient}>{ingredient}</li>)}</ul>
                )}
                <button disabled={!recipe.available || recipe.completed} onClick={() => onCraft(recipe)}>
                  {recipe.completed ? "已建造" : recipe.available ? craftingActionLabel(recipe.id) : recipe.reason ?? "缺少材料"}
                </button>
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function RecipeRequirements({ requirements }: { requirements: RecipeRequirementView[] }) {
  return (
    <ul className="recipe-requirements" aria-label="配方需求">
      {requirements.map((requirement) => {
        const stateLabel = requirement.kind === "time"
          ? "耗时"
          : requirement.satisfied
            ? requirement.kind === "condition" ? "满足" : "充足"
            : requirement.kind === "condition" ? "未满足" : "缺少";
        const countLabel = requirement.current !== undefined && requirement.required !== undefined
          ? `已有 ${requirement.current} / 所需 ${requirement.required}${requirement.kind === "tool" ? " · 工具不消耗" : ""}`
          : requirement.statusLabel ?? stateLabel;
        const content = (
          <>
            <span className="recipe-requirement-heading">
              <b>{requirement.label}</b>
              <em>{stateLabel}</em>
            </span>
            <span className="recipe-requirement-count">{countLabel}</span>
          </>
        );
        const canRevealHint = !requirement.satisfied && Boolean(requirement.acquisitionHint);
        return (
          <li
            key={requirement.id}
            className={`recipe-requirement requirement-${requirement.satisfied ? "ready" : "missing"} requirement-${requirement.kind}`}
          >
            {canRevealHint ? (
              <details>
                <summary>
                  {content}
                  <span className="recipe-requirement-hint-action">查看获取提示</span>
                </summary>
                <p>{requirement.acquisitionHint}</p>
              </details>
            ) : (
              <div>{content}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function craftingActionLabel(recipeId: string): string {
  if (recipeId === "rest") return "休息";
  if (recipeId === "add-fuel") return "添柴";
  if (recipeId === "boil-water") return "煮沸";
  if (recipeId === "collect-rainwater") return "接取雨水";
  if (["campfire", "shelter", "bed", "smoking-rack", "rain-collector", "torch-waymark"].includes(recipeId)) return "搭建";
  if (recipeId === "radio-beacon") return "修复";
  return "制作";
}

function BodyPanel({ body, onTreatWound, onTreatParasites }: { body: BodyView; onTreatWound: () => void; onTreatParasites: () => void }) {
  return (
    <div className="body-layout">
      <div className="body-figure" aria-label="人体正面示意">
        <span className="body-head" /><span className="body-torso" />
        <i className={`body-arm body-arm-left ${body.woundOpen ? "is-wounded" : ""}`} />
        <i className="body-arm body-arm-right" /><i className="body-leg body-leg-left" /><i className="body-leg body-leg-right" />
        {body.woundOpen && <b className="wound-marker">!</b>}
        {body.parasites > 0 && <b className="parasite-marker">×{body.parasites}</b>}
      </div>
      <div className="body-diagnosis">
        <small>左前臂 / 检查结果</small>
        <h3>{body.woundOpen ? "开放性撕裂伤" : body.woundTreated ? "绷带固定良好" : "未发现外伤"}</h3>
        <p>{body.woundOpen ? "伤口仍在渗血。拖延会提高感染，并持续消耗身体状态。" : "处理及时。保持干燥并观察感染变化。"}</p>
        <dl>
          <div><dt>感染</dt><dd>{Math.round(body.infection)}%</dd></div>
          <div><dt>湿度</dt><dd>{Math.round(body.wetness)}%</dd></div>
          <div><dt>寄生虫</dt><dd>{body.parasites > 0 ? `${body.parasites} 层` : "未发现"}</dd></div>
          <div><dt>清洁度</dt><dd>{body.dirty ? "污染" : "尚可"}</dd></div>
        </dl>
        <button className="button-primary full-width" disabled={!body.woundOpen || body.bandages < 1} onClick={onTreatWound}>
          {body.woundOpen ? (body.bandages > 0 ? "使用草药绷带" : "缺少草药绷带") : "伤口已处理"}
        </button>
        {body.parasites > 0 && <button className="button-ghost full-width" disabled={body.antiparasiticHerbs < 1} onClick={onTreatParasites}>服用驱虫草药</button>}
      </div>
    </div>
  );
}

function NotebookPanel({ objectives, events, score }: { objectives: ObjectiveView[]; events: EventView[]; score: number }) {
  return (
    <div className="notebook-layout">
      <section><small className="section-kicker">目标链</small><div className="notebook-objectives">
        {objectives.map((objective, index) => <article key={objective.id} className={`${objective.completed ? "done" : ""} ${objective.current ? "current" : ""}`}>
          <span>{objective.completed ? "✓" : String(index + 1).padStart(2, "0")}</span><div><strong>{objective.label}</strong><p>{objective.progressLabel && <><b>{objective.progressLabel}</b><br /></>}{objective.description}{objective.blocker && <><br /><b>阻断条件：{objective.blocker}</b></>}</p>{objective.steps && <ol className="objective-fact-steps">{objective.steps.map((step) => <li key={step.id} className={step.completed ? "done" : ""}>{step.completed ? "✓" : "○"} {step.label}</li>)}</ol>}</div>
        </article>)}
      </div></section>
      <section><small className="section-kicker">因果日志 · 生存评分 {score}</small><div className="field-log">
        {events.map((event) => <p key={event.id} className={`event-${event.tone}`}><time>{event.time}</time>{event.message}</p>)}
      </div></section>
    </div>
  );
}

function MapPanel({ landmarks, chunks, coordinates, biome }: { landmarks: MapLandmark[]; chunks: MapChunkView[]; coordinates: string; biome: string }) {
  const xValues = chunks.map((chunk) => chunk.x);
  const zValues = chunks.map((chunk) => chunk.z);
  const minX = Math.min(...xValues);
  const maxX = Math.max(...xValues);
  const minZ = Math.min(...zValues);
  const maxZ = Math.max(...zValues);
  const width = Math.max(1, maxX - minX + 1);
  const height = Math.max(1, maxZ - minZ + 1);
  return (
    <div className="map-layout">
      <div className="paper-map dynamic-map" aria-label={`已经探索 ${chunks.length} 个动态区块的地形图`}>
        {chunks.map((chunk) => (
          <span
            key={chunk.key}
            className={`map-chunk ${chunk.current ? "is-current" : ""}`}
            title={`${chunk.biome} · 区块 ${chunk.key}`}
            style={{
              left: `${((chunk.x - minX) / width) * 100}%`,
              top: `${((maxZ - chunk.z) / height) * 100}%`,
              width: `${100 / width}%`,
              height: `${100 / height}%`,
              backgroundColor: chunk.color,
            }}
          />
        ))}
        {landmarks.filter((landmark) => landmark.discovered).map((landmark) => (
          <i key={landmark.id} className={`map-marker marker-${landmark.kind}`} style={{ left: `${((landmark.x / 48 - minX) / width) * 100}%`, top: `${((maxZ + 1 - landmark.z / 48) / height) * 100}%` }}>
            <b>{landmark.kind === "camp" ? "⌂" : landmark.kind === "water" ? "≈" : "×"}</b><em>{landmark.label}</em>
          </i>
        ))}
        <small className="map-note">亮框表示当前 48m 区块；纸图会随探索向外扩展，标记仍需结合手表坐标判断。</small>
      </div>
      <aside><small>手表坐标 · 当前生态</small><strong>{coordinates}</strong><p>{biome} · 已勘测 {chunks.length} 个区块。越过区块边界后，地形、资源承载力和动物种群会按世界种子继续生成。</p><p className="pencil-note">“把返程路线当作资源。食物会坏，工具会损耗，天气会改变安全路径。”</p></aside>
    </div>
  );
}

function PausePanel({ audioEnabled, reducedMotion, uiScale, saveStatus, saveTransferState, localSaveDurability, hasPreImportSave, checkpointEntries, recommendedCheckpointSlotId, manualCheckpointSlot, onResume, onRestart, onManualSave, onSaveManualCheckpoint, onPreviewCheckpoint, onPrepareSaveExport, onSelectSaveImport, onConfirmSaveImport, onCancelSaveImport, onPreparePreImportRestore, onToggleAudio, onToggleReducedMotion, onUiScaleChange }: {
  audioEnabled: boolean; reducedMotion: boolean; uiScale: number; saveStatus: SaveStatus; saveTransferState: SaveTransferState; localSaveDurability: "persistent" | "ephemeral"; hasPreImportSave: boolean; checkpointEntries: CheckpointTimelineEntry[]; recommendedCheckpointSlotId: CheckpointSlotId | null; manualCheckpointSlot: ManualCheckpointSlotId | null; onResume: () => void; onRestart: () => void; onManualSave: () => void; onSaveManualCheckpoint: (slotId: ManualCheckpointSlotId) => void; onPreviewCheckpoint: (slotId: CheckpointSlotId) => void; onPrepareSaveExport: () => void; onSelectSaveImport: (file: File) => void; onConfirmSaveImport: () => void; onCancelSaveImport: () => void; onPreparePreImportRestore: () => void; onToggleAudio: () => void; onToggleReducedMotion: () => void; onUiScaleChange: (value: number) => void;
}) {
  const [confirmRestart, setConfirmRestart] = useState(false);
  const savedTime = saveStatus.savedAt
    ? new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(saveStatus.savedAt)
    : null;
  return (
    <div className="pause-layout">
      <p>时间已经停下。返回后先确认方向和当前最危险的问题。</p>
      <button className="button-primary full-width" onClick={onResume}>返回雨林</button>
      <div className={`pause-save-card save-phase-${saveStatus.phase}`} role="status" aria-live="polite">
        <div><span>{saveStatusLabel(saveStatus)}</span>{savedTime && <small>最近保存 {savedTime}</small>}</div>
        <button className="button-ghost" disabled={saveStatus.phase === "saving"} onClick={onManualSave}>保存当前活动档</button>
      </div>
      <CheckpointTimelinePanel
        entries={checkpointEntries}
        recommendedSlotId={recommendedCheckpointSlotId}
        busyManualSlot={manualCheckpointSlot}
        mode="manage"
        onSaveManual={onSaveManualCheckpoint}
        onSelect={onPreviewCheckpoint}
      />
      <button className="setting-row" onClick={onToggleAudio}><span>环境音与提示音</span><b>{audioEnabled ? "开启" : "关闭"}</b></button>
      <button className="setting-row" onClick={onToggleReducedMotion}><span>减弱镜头与粒子运动</span><b>{reducedMotion ? "开启" : "关闭"}</b></button>
      <div className="setting-range-row">
        <div><label htmlFor="ui-scale-range">UI 控件大小</label><output htmlFor="ui-scale-range">{uiScale}%</output></div>
        <input
          id="ui-scale-range"
          type="range"
          min={UI_SCALE_MIN}
          max={UI_SCALE_MAX}
          step={UI_SCALE_STEP}
          value={uiScale}
          aria-valuetext={`${uiScale}%`}
          onChange={(event) => onUiScaleChange(Number(event.currentTarget.value))}
        />
        <small>只保存在当前设备；不会改变画面分辨率、操作灵敏度或游戏存档。</small>
      </div>
      <SaveTransferControls
        localDurability={localSaveDurability}
        state={saveTransferState}
        hasPreImport={hasPreImportSave}
        onPrepareExport={onPrepareSaveExport}
        onSelectImport={onSelectSaveImport}
        onConfirmImport={onConfirmSaveImport}
        onCancelImport={onCancelSaveImport}
        onPreparePreImportRestore={onPreparePreImportRestore}
      />
      {!confirmRestart ? (
        <button className="button-danger full-width" onClick={() => setConfirmRestart(true)}>放弃本局并重新开始</button>
      ) : (
        <div className="save-reset-confirm" role="alert">
          <p>新游戏会删除本地的主存档、备份与损坏隔离副本，并用新进度覆盖 Toy 云存档。已解锁的配方知识会保留。</p>
          <div><button className="button-danger" onClick={onRestart}>确认删除并开始</button><button className="button-ghost" onClick={() => setConfirmRestart(false)}>取消</button></div>
        </div>
      )}
    </div>
  );
}

export function CheckpointTimelinePanel({
  entries,
  recommendedSlotId,
  selectedSlotId = null,
  busyManualSlot = null,
  mode = "recover",
  onSaveManual,
  onSelect,
}: {
  entries: readonly CheckpointTimelineEntry[];
  recommendedSlotId: CheckpointSlotId | null;
  selectedSlotId?: CheckpointSlotId | null;
  busyManualSlot?: ManualCheckpointSlotId | null;
  mode?: "manage" | "recover";
  onSaveManual?: (slotId: ManualCheckpointSlotId) => void;
  onSelect: (slotId: CheckpointSlotId) => void;
}) {
  const sortedEntries = [...entries].sort((left, right) => right.sequence - left.sequence);
  const bySlot = new Map(sortedEntries.map((entry) => [entry.slotId, entry]));
  return (
    <section className={`checkpoint-timeline checkpoint-mode-${mode}`} aria-label="恢复点时间线">
      <header>
        <div>
          <strong>恢复点时间线</strong>
          <small>手动档独立保留；自动档轮转且不会覆盖手动档</small>
        </div>
        <span>{sortedEntries.length} 个已校验</span>
      </header>
      {mode === "manage" && onSaveManual && (
        <div className="checkpoint-manual-slots" aria-label="手动恢复点槽位">
          {MANUAL_CHECKPOINT_SLOTS.map((slotId, index) => {
            const occupied = bySlot.get(slotId);
            return (
              <button
                key={slotId}
                className="button-ghost"
                disabled={busyManualSlot !== null}
                aria-busy={busyManualSlot === slotId}
                onClick={() => onSaveManual(slotId)}
              >
                {busyManualSlot === slotId
                  ? `正在写入手动槽 ${index + 1}`
                  : `${occupied ? "覆盖" : "保存到"}手动槽 ${index + 1}`}
              </button>
            );
          })}
        </div>
      )}
      {sortedEntries.length === 0 ? (
        <p className="checkpoint-empty">还没有可用恢复点。完成任务、休息或保存到手动槽后会出现在这里。</p>
      ) : (
        <div className="checkpoint-card-list">
          {sortedEntries.map((entry) => (
            <CheckpointCard
              key={entry.slotId}
              entry={entry}
              recommended={entry.slotId === recommendedSlotId}
              selected={entry.slotId === selectedSlotId}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function CheckpointCard({
  entry,
  recommended,
  selected,
  onSelect,
}: {
  entry: CheckpointTimelineEntry;
  recommended: boolean;
  selected: boolean;
  onSelect: (slotId: CheckpointSlotId) => void;
}) {
  const slotLabel = checkpointSlotLabel(entry);
  const statusLabel = entry.majorStatuses.length > 0
    ? entry.majorStatuses.map((status) => `${statusSeverityLabel(status.severity)}：${status.label}`).join(" · ")
    : "无显著状态";
  const dangerLabels = [
    entry.storm ? "暴雨" : null,
    entry.combat ? "交战中" : null,
    entry.danger ? "危险区" : null,
  ].filter(Boolean);
  return (
    <article className={`checkpoint-card safety-${entry.safety} ${selected ? "is-selected" : ""}`}>
      <header>
        <div>
          <span>{slotLabel}</span>
          <strong>第 {entry.gameDay} 天 · {formatGameTime(entry.minuteOfDay)}</strong>
        </div>
        <div className="checkpoint-card-tags">
          {recommended && <b>推荐安全点</b>}
          <i>{checkpointSafetyLabel(entry.safety)}</i>
        </div>
      </header>
      <dl>
        <div><dt>保存原因</dt><dd>{checkpointReasonLabel(entry.reason)}</dd></div>
        <div><dt>现实时间</dt><dd>{formatRealTime(entry.createdAt)}</dd></div>
        <div><dt>游玩时长</dt><dd>{formatElapsed(entry.elapsedSeconds)}</dd></div>
        <div><dt>地点</dt><dd>{entry.biomeLabel} · X {Math.round(entry.position.x)} / Z {Math.round(entry.position.z)}</dd></div>
        <div><dt>当前目标</dt><dd>{entry.objectiveLabel}</dd></div>
        <div><dt>身体状态</dt><dd>生命 {Math.round(entry.health)} · {statusLabel}</dd></div>
      </dl>
      {dangerLabels.length > 0 && <p className="checkpoint-danger">保存时：{dangerLabels.join(" · ")}</p>}
      <footer>
        <div className="checkpoint-durability" aria-label="存档耐久性与校验状态">
          <span>{entry.localDurability === "persistent" ? "本地持久" : "本次会话"}</span>
          <span>{checkpointCloudDurabilityLabel(entry.cloudDurability)}</span>
          <span>{entry.recoveredFromBackup ? "由同槽备份恢复并校验" : "校验通过"}</span>
        </div>
        <button className={recommended ? "button-primary" : "button-ghost"} onClick={() => onSelect(entry.slotId)}>
          {selected ? "已选择，查看确认" : "预览并选择"}
        </button>
      </footer>
    </article>
  );
}

function checkpointSlotLabel(entry: CheckpointTimelineEntry): string {
  if (entry.kind === "manual") return `手动槽 ${Number(entry.slotId.slice(-1))}`;
  if (entry.kind === "preimport") return "导入前恢复点";
  return `自动恢复点 ${Number(entry.slotId.slice(5))}`;
}

function checkpointReasonLabel(reason: CheckpointTimelineEntry["reason"]): string {
  const labels: Record<CheckpointTimelineEntry["reason"], string> = {
    manual: "玩家手动保存",
    "rest-before": "休息前",
    "rest-after": "休息结算后",
    task: "任务阶段完成",
    milestone: "关键进展",
    periodic: "周期自动保存",
    hidden: "切到后台",
    "page-exit": "离开页面",
    "new-game": "远征开始",
    preimport: "导入文件前",
  };
  return labels[reason];
}

function checkpointSafetyLabel(safety: CheckpointTimelineEntry["safety"]): string {
  return safety === "safe" ? "安全" : safety === "caution" ? "需观察" : "高风险";
}

function checkpointCloudDurabilityLabel(
  durability: CheckpointTimelineEntry["cloudDurability"],
): string {
  if (durability === "synced") return "Toy 云端已同步";
  if (durability === "pending") return "Toy 云端同步中";
  return "仅本地 · 云端未同步";
}

function statusSeverityLabel(severity: CheckpointTimelineEntry["majorStatuses"][number]["severity"]): string {
  return severity === "critical" ? "危急" : severity === "warning" ? "警告" : "观察";
}

function formatGameTime(minuteOfDay: number): string {
  const minute = Math.max(0, Math.round(minuteOfDay)) % (24 * 60);
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

function formatRealTime(createdAt: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(createdAt);
}

function formatElapsed(elapsedSeconds: number): string {
  const totalMinutes = Math.max(0, Math.floor(elapsedSeconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours} 小时 ${minutes} 分` : `${minutes} 分钟`;
}
