"use client";

import { useMemo, useState } from "react";

type StatKey = "health" | "energy" | "sanity" | "hydration";
type Stats = Record<StatKey, number>;
type Inventory = Record<"stick" | "fruit" | "leaf" | "stone", number>;
type Action = "forage" | "water" | "inspect" | "fire" | "rest" | "explore";

const clamp = (value: number) => Math.max(0, Math.min(100, value));

const initialStats: Stats = { health: 82, energy: 67, sanity: 74, hydration: 58 };
const initialInventory: Inventory = { stick: 2, fruit: 1, leaf: 1, stone: 0 };

const statMeta: { key: StatKey; label: string; unit: string }[] = [
  { key: "health", label: "生命", unit: "HP" },
  { key: "energy", label: "体力", unit: "NRG" },
  { key: "sanity", label: "理智", unit: "SAN" },
  { key: "hydration", label: "水分", unit: "H₂O" },
];

const actionMeta: Record<Action, { label: string; hint: string; glyph: string }> = {
  forage: { label: "搜集物资", hint: "寻找食物与纤维", glyph: "✣" },
  water: { label: "寻找水源", hint: "补水，但可能感染", glyph: "◒" },
  inspect: { label: "检查身体", hint: "处理伤口与寄生虫", glyph: "⌁" },
  fire: { label: "生起营火", hint: "消耗 3 根木棍", glyph: "△" },
  rest: { label: "原地休息", hint: "恢复体力，时间流逝", glyph: "◐" },
  explore: { label: "深入雨林", hint: "高风险，高回报", glyph: "↗" },
};

export default function Home() {
  const [started, setStarted] = useState(false);
  const [stats, setStats] = useState<Stats>(initialStats);
  const [inventory, setInventory] = useState<Inventory>(initialInventory);
  const [turn, setTurn] = useState(0);
  const [fire, setFire] = useState(false);
  const [wounded, setWounded] = useState(true);
  const [parasite, setParasite] = useState(false);
  const [activeTab, setActiveTab] = useState<"pack" | "journal" | "guide">("pack");
  const [inspecting, setInspecting] = useState(false);
  const [logs, setLogs] = useState([
    "14:20  雨势正在增强。日落前需要找到安全地点。",
    "14:08  左臂有一道撕裂伤，尚未感染。",
    "13:46  无线电只剩下断续的噪声。",
  ]);

  const day = Math.floor(turn / 8) + 1;
  const hour = 14 + (turn % 8);
  const night = hour >= 19;
  const score = day * 180 + turn * 35 + Object.values(inventory).reduce((a, b) => a + b * 8, 0);
  const gameOver = stats.health <= 0 || stats.sanity <= 0;

  const condition = useMemo(() => {
    if (gameOver) return stats.sanity <= 0 ? "意识崩溃" : "生命体征消失";
    if (stats.hydration < 25) return "严重脱水";
    if (stats.sanity < 35) return "幻听加剧";
    if (wounded) return "左臂撕裂伤";
    return "状态稳定";
  }, [gameOver, stats, wounded]);

  const log = (message: string, atTurn = turn + 1) => {
    const nextHour = 14 + (atTurn % 8);
    setLogs((items) => [`${String(nextHour).padStart(2, "0")}:00  ${message}`, ...items].slice(0, 8));
  };

  const applyTurn = (delta: Partial<Stats>, message: string) => {
    const nextTurn = turn + 1;
    const darkness = 14 + (nextTurn % 8) >= 19 && !fire;
    setStats((current) => ({
      health: clamp(current.health + (delta.health ?? 0) - (current.hydration < 18 ? 5 : 0)),
      energy: clamp(current.energy + (delta.energy ?? 0) - 3),
      sanity: clamp(current.sanity + (delta.sanity ?? 0) - (darkness ? 7 : 0) - (parasite ? 3 : 0)),
      hydration: clamp(current.hydration + (delta.hydration ?? 0) - 5),
    }));
    setTurn(nextTurn);
    log(message, nextTurn);
  };

  const act = (action: Action) => {
    if (!started || gameOver) return;
    if (action === "inspect") {
      setInspecting(true);
      return;
    }
    if (action === "forage") {
      const foundFruit = Math.random() > 0.42;
      setInventory((bag) => ({ ...bag, stick: bag.stick + 1, leaf: bag.leaf + 1, fruit: bag.fruit + (foundFruit ? 1 : 0) }));
      applyTurn({ energy: -5, sanity: 2 }, foundFruit ? "发现可食用的棕榈果，并收集了干燥材料。" : "只找到藤叶和一根干木棍。雨林不会每次都给出答案。");
    }
    if (action === "water") {
      const caughtParasite = Math.random() > 0.72;
      if (caughtParasite) setParasite(true);
      applyTurn({ hydration: 34, health: caughtParasite ? -7 : 0 }, caughtParasite ? "溪水解了渴，但腹部传来不安的绞痛。" : "在宽叶上收集到干净雨水。" );
    }
    if (action === "fire") {
      if (inventory.stick < 3) {
        log("木棍不足。营火至少需要 3 根干木棍。", turn);
        return;
      }
      setInventory((bag) => ({ ...bag, stick: bag.stick - 3 }));
      setFire(true);
      applyTurn({ sanity: 18, energy: -2 }, "火焰终于站稳。黑暗退到了树线之后。" );
    }
    if (action === "rest") {
      applyTurn({ energy: fire ? 32 : 21, sanity: fire ? 8 : -3 }, fire ? "靠着营火休息片刻，雨声不再那么逼近。" : "你蜷在潮湿的树根旁休息，睡眠浅而破碎。" );
    }
    if (action === "explore") {
      const danger = Math.random() > 0.62;
      setInventory((bag) => ({ ...bag, stone: bag.stone + 1, fruit: bag.fruit + (danger ? 0 : 1) }));
      if (danger) setWounded(true);
      applyTurn({ health: danger ? -18 : 0, energy: -14, sanity: danger ? -7 : 4 }, danger ? "灌木中传来低吼。你逃开了，但伤口重新裂开。" : "在废弃营地找到一块锋利石片和半枚果实。" );
    }
  };

  const treatWound = () => {
    if (!wounded || inventory.leaf < 1) return;
    setInventory((bag) => ({ ...bag, leaf: bag.leaf - 1 }));
    setWounded(false);
    setStats((current) => ({ ...current, health: clamp(current.health + 10), sanity: clamp(current.sanity + 5) }));
    setInspecting(false);
    log("用草药叶和纤维包扎了左臂。出血已经止住。", turn);
  };

  const eatFruit = () => {
    if (inventory.fruit < 1 || gameOver) return;
    setInventory((bag) => ({ ...bag, fruit: bag.fruit - 1 }));
    setStats((current) => ({ ...current, energy: clamp(current.energy + 14), hydration: clamp(current.hydration + 8) }));
    log("吃下棕榈果。碳水和少量水分让视线重新清晰。", turn);
  };

  const restart = () => {
    setStats(initialStats); setInventory(initialInventory); setTurn(0); setFire(false);
    setWounded(true); setParasite(false); setStarted(true); setInspecting(false);
    setLogs(["14:20  雨势正在增强。日落前需要找到安全地点。", "14:08  左臂有一道撕裂伤，尚未感染。"]);
  };

  return (
    <main className={`game ${night ? "is-night" : ""} ${fire ? "has-fire" : ""}`}>
      <div className="canopy" aria-hidden="true"><i /><i /><i /><i /><i /></div>
      <div className="rain" aria-hidden="true" />
      <div className="mist mist-one" aria-hidden="true" />
      <div className="mist mist-two" aria-hidden="true" />
      {fire && <div className="campfire" aria-hidden="true"><span /><span /><b /></div>}

      <header className="topbar">
        <a className="brand" href="#survival" aria-label="绿色地狱网页版首页">
          <span className="brand-mark">GH</span><span>绿色地狱<small>网页版生存实验</small></span>
        </a>
        <div className="mission">
          <span className="signal"><i />信号微弱</span>
          <span>第 {String(day).padStart(2, "0")} 天</span>
          <strong>{String(hour).padStart(2, "0")}:00</strong>
        </div>
      </header>

      <section className="survival" id="survival" aria-label="雨林生存控制台">
        <div className="hero-copy">
          <p className="eyebrow"><span>亚马逊 · 未标记区域</span><b>坐标 2°18&apos;S / 60°01&apos;W</b></p>
          <h1>雨林不会<br />原谅<span>错误。</span></h1>
          <p className="lede">观察身体，平衡营养，在黑暗吞没理智之前生起火。每次行动都会让时间向前，也让雨林更靠近一步。</p>
          <div className="hero-actions">
            <button className="primary" onClick={() => setStarted(true)}>{started ? "继续求生" : "开始求生"}<span>↗</span></button>
            <button className="secondary" onClick={() => document.getElementById("field-log")?.scrollIntoView({ behavior: "smooth" })}>查看生存档案</button>
          </div>
          <div className="objective"><span>当前目标</span><strong>{fire ? "熬过第一个雨夜" : "日落前生起营火"}</strong><em>{Math.min(100, Math.round((inventory.stick / 3) * 100))}%</em></div>
        </div>

        <aside className="hud" aria-label="生命状态">
          <div className="hud-head"><div><small>BIOMETRIC FEED</small><strong>生命监测</strong></div><span className={gameOver ? "critical" : "live"}>{gameOver ? "失去信号" : "实时"}</span></div>
          <div className="pulse" aria-hidden="true"><i /></div>
          <div className="stat-list">
            {statMeta.map(({ key, label, unit }) => <div className="stat" key={key}>
              <div><span>{label}<small>{unit}</small></span><strong>{Math.round(stats[key])}</strong></div>
              <div className="meter"><i style={{ width: `${stats[key]}%` }} /></div>
            </div>)}
          </div>
          <button className="condition" onClick={() => setInspecting(true)}><span className={wounded ? "condition-dot warning" : "condition-dot"} /><span><small>身体状态</small><strong>{condition}</strong></span><b>检查 ↗</b></button>
        </aside>
      </section>

      <section className={`console ${started ? "is-active" : ""}`} aria-label="生存行动">
        <div className="action-grid">
          {(Object.keys(actionMeta) as Action[]).map((key) => {
            const item = actionMeta[key];
            const disabled = key === "fire" && inventory.stick < 3;
            return <button key={key} onClick={() => act(key)} disabled={!started || gameOver} className={disabled ? "needs-resource" : ""}>
              <span className="action-glyph">{item.glyph}</span><span><strong>{item.label}</strong><small>{item.hint}</small></span><b>→</b>
            </button>;
          })}
        </div>
        <div className="pack-panel">
          <div className="tabs" role="tablist" aria-label="生存资料">
            {([['pack','背包'],['journal','日志'],['guide','守则']] as const).map(([key,label]) => <button key={key} role="tab" aria-selected={activeTab === key} onClick={() => setActiveTab(key)}>{label}</button>)}
          </div>
          {activeTab === "pack" && <div className="pack-content" role="tabpanel">
            <div className="pack-items">
              <button onClick={eatFruit} disabled={inventory.fruit < 1}><i className="item fruit" /><span>棕榈果<small>食用 +14 体力</small></span><b>×{inventory.fruit}</b></button>
              <div><i className="item stick" /><span>干木棍<small>营火材料</small></span><b>×{inventory.stick}</b></div>
              <div><i className="item leaf" /><span>草药叶<small>包扎材料</small></span><b>×{inventory.leaf}</b></div>
              <div><i className="item stone" /><span>锋利石片<small>基础工具</small></span><b>×{inventory.stone}</b></div>
            </div>
          </div>}
          {activeTab === "journal" && <div className="journal" id="field-log" role="tabpanel">{logs.map((entry, index) => <p key={`${entry}-${index}`}>{entry}</p>)}</div>}
          {activeTab === "guide" && <div className="guide" role="tabpanel"><p><b>01</b> 雨水比浑浊溪水安全。</p><p><b>02</b> 黑暗会快速消耗理智。</p><p><b>03</b> 每次睡眠前先检查四肢。</p></div>}
        </div>
      </section>

      <section className="survival-rules" aria-label="三条生存法则">
        <article><span>01</span><div><h2>检查每一道伤口</h2><p>撕裂、感染与寄生虫不会自行消失。</p></div></article>
        <article><span>02</span><div><h2>管理四项营养</h2><p>蛋白质、脂肪、碳水和水分决定行动上限。</p></div></article>
        <article><span>03</span><div><h2>别在黑暗里独处</h2><p>营火不仅提供热量，也守住最后一点理智。</p></div></article>
      </section>

      <footer><span>一个受《绿色地狱》生存机制启发的非官方网页实验</span><span>原游戏及商标归 Creepy Jar S.A. 所有</span><strong>生存分数 {score}</strong></footer>

      {!started && <div className="start-veil" aria-hidden="true"><span>按下「开始求生」进入行动阶段</span></div>}
      {gameOver && <div className="game-over" role="dialog" aria-modal="true" aria-labelledby="game-over-title"><div><small>EXPEDITION FAILED</small><h2 id="game-over-title">雨林记住了你。</h2><p>{condition}。你坚持了 {day} 天，生存分数 {score}。</p><button className="primary" onClick={restart}>重新开始 <span>↻</span></button></div></div>}
      {inspecting && <div className="modal-backdrop" role="presentation" onMouseDown={() => setInspecting(false)}><section className="body-modal" role="dialog" aria-modal="true" aria-labelledby="body-title" onMouseDown={(event) => event.stopPropagation()}>
        <button className="modal-close" aria-label="关闭身体检查" onClick={() => setInspecting(false)}>×</button>
        <div className="body-figure" aria-hidden="true"><span className="head" /><span className="torso" /><i className="arm left" /><i className="arm right wounded" /><i className="leg left" /><i className="leg right" /><b>!</b></div>
        <div className="body-copy"><small>BODY INSPECTION / 左臂</small><h2 id="body-title">{wounded ? "开放性撕裂伤" : "包扎完整"}</h2><p>{wounded ? "伤口边缘有泥沙，需要清洁并使用草药敷料。拖延可能造成感染。" : "敷料保持干燥，未观察到感染迹象。"}</p>
          <dl><div><dt>感染风险</dt><dd>{wounded ? "中等" : "低"}</dd></div><div><dt>寄生虫</dt><dd>{parasite ? "检测到" : "未检测到"}</dd></div><div><dt>可用草药叶</dt><dd>{inventory.leaf}</dd></div></dl>
          <button className="primary treatment" onClick={treatWound} disabled={!wounded || inventory.leaf < 1}>{wounded ? (inventory.leaf ? "使用草药敷料" : "缺少草药叶") : "处理完成"}<span>+</span></button>
        </div>
      </section></div>}
    </main>
  );
}
