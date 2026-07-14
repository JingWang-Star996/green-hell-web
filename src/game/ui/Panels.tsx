import { useEffect, useRef } from "react";
import type {
  BodyView,
  EventView,
  InventoryItemView,
  MapChunkView,
  MapLandmark,
  ObjectiveView,
  PanelId,
  RecipeView,
  WatchView,
} from "./types";

type PanelsProps = {
  active: PanelId | null;
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
  onClose: () => void;
  onCraft: (recipeId: string) => void;
  onItemAction: (item: InventoryItemView) => void;
  onTreatWound: () => void;
  onTreatParasites: () => void;
  onResume: () => void;
  onRestart: () => void;
  onToggleAudio: () => void;
  onToggleReducedMotion: () => void;
};

export function Panels(props: PanelsProps) {
  const dialogRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!props.active) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLElement>("button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])")?.focus();
    });
    return () => {
      window.cancelAnimationFrame(frame);
      previous?.focus();
    };
  }, [props.active]);

  if (!props.active) return null;
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
    <div className="panel-backdrop" role="presentation" onMouseDown={props.onClose}>
      <section
        ref={dialogRef}
        className={`game-panel panel-${props.active}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="panel-title"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key !== "Tab" || !dialogRef.current) return;
          const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])"));
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
          {props.active === "crafting" && <CraftingPanel recipes={props.recipes} onCraft={props.onCraft} />}
          {props.active === "body" && <BodyPanel body={props.body} onTreatWound={props.onTreatWound} onTreatParasites={props.onTreatParasites} />}
          {props.active === "notebook" && <NotebookPanel objectives={props.objectives} events={props.events} score={props.score} />}
          {props.active === "map" && <MapPanel landmarks={props.landmarks} chunks={props.mapChunks} coordinates={props.watch.coordinates} biome={props.watch.biome} />}
          {props.active === "pause" && (
            <PausePanel
              audioEnabled={props.audioEnabled}
              reducedMotion={props.reducedMotion}
              onResume={props.onResume}
              onRestart={props.onRestart}
              onToggleAudio={props.onToggleAudio}
              onToggleReducedMotion={props.onToggleReducedMotion}
            />
          )}
        </div>
      </section>
    </div>
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
  const carried = items.filter((item) => item.count > 0);
  return (
    <div className="inventory-layout">
      <div className="inventory-summary"><span>已携带 <b>{carried.length}</b> 类物品</span><small>准备决定你能走多远，也决定你能否回来。</small></div>
      <div className="inventory-grid">
        {carried.length === 0 && <div className="empty-state">背包是空的。先在坠落点附近观察地面。</div>}
        {carried.map((item) => (
          <article key={item.id} className={`inventory-item item-${item.category}`}>
            <span className="item-symbol">{item.label.slice(0, 1)}</span>
            <div>
              <small>{item.category.toUpperCase()}</small>
              <strong>{item.label}</strong>
              <p>{item.description}</p>
              {item.statusLabel && (
                <small className={`item-lifecycle status-${item.statusTone ?? "stable"}`}>
                  {item.statusLabel}
                </small>
              )}
            </div>
            <b className="item-count">×{item.count}</b>
            {item.action && <button onClick={() => onAction(item)}>{item.actionLabel ?? "使用"}</button>}
          </article>
        ))}
      </div>
    </div>
  );
}

function CraftingPanel({ recipes, onCraft }: { recipes: RecipeView[]; onCraft: (recipeId: string) => void }) {
  return (
    <div className="recipe-grid">
      <div className="recipe-discovery-note"><b>{recipes.length}</b><span>条知识已写入笔记。观察材料、处理身体问题与经历危险，会揭示新的组合。</span></div>
      {recipes.map((recipe, index) => (
        <article key={recipe.id} className={`${recipe.available ? "can-craft" : ""} ${recipe.completed ? "is-complete" : ""}`}>
          <span className="recipe-number">{String(index + 1).padStart(2, "0")}</span>
          <div><small>{recipe.completed ? "已完成" : "已记录配方"}</small><h3>{recipe.label}</h3><p>{recipe.description}</p></div>
          <ul>{recipe.ingredients.map((ingredient) => <li key={ingredient}>{ingredient}</li>)}</ul>
          <button disabled={!recipe.available || recipe.completed} onClick={() => onCraft(recipe.id)}>
            {recipe.completed ? "已建造" : recipe.available ? "制作" : recipe.reason ?? "缺少材料"}
          </button>
        </article>
      ))}
    </div>
  );
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
          <span>{objective.completed ? "✓" : String(index + 1).padStart(2, "0")}</span><div><strong>{objective.label}</strong><p>{objective.progressLabel && <><b>{objective.progressLabel}</b><br /></>}{objective.description}{objective.blocker && <><br /><b>阻断条件：{objective.blocker}</b></>}</p></div>
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

function PausePanel({ audioEnabled, reducedMotion, onResume, onRestart, onToggleAudio, onToggleReducedMotion }: {
  audioEnabled: boolean; reducedMotion: boolean; onResume: () => void; onRestart: () => void; onToggleAudio: () => void; onToggleReducedMotion: () => void;
}) {
  return (
    <div className="pause-layout">
      <p>时间已经停下。返回后先确认方向和当前最危险的问题。</p>
      <button className="button-primary full-width" onClick={onResume}>返回雨林</button>
      <button className="setting-row" onClick={onToggleAudio}><span>环境音与提示音</span><b>{audioEnabled ? "开启" : "关闭"}</b></button>
      <button className="setting-row" onClick={onToggleReducedMotion}><span>减弱镜头与粒子运动</span><b>{reducedMotion ? "开启" : "关闭"}</b></button>
      <button className="button-danger full-width" onClick={onRestart}>放弃本局并重新开始</button>
    </div>
  );
}
