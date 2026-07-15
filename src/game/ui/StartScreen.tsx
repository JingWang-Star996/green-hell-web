import { useState } from "react";

type StartScreenProps = {
  saveDiscoveryComplete: boolean;
  canContinue: boolean;
  onNewGame: () => void;
  onContinue: () => void;
};

export function StartScreen({ saveDiscoveryComplete, canContinue, onNewGame, onContinue }: StartScreenProps) {
  const [confirmNewGame, setConfirmNewGame] = useState(false);
  return (
    <section className="start-screen" aria-labelledby="game-title">
      <div className="start-atmosphere" aria-hidden="true">
        <span className="start-rain" />
        <span className="start-haze start-haze-one" />
        <span className="start-haze start-haze-two" />
      </div>
      <header className="start-header">
        <span className="wordmark-mark">C</span>
        <span><b>CANOPY</b><small>FIRST NIGHT / 雨林第一夜</small></span>
      </header>
      <div className="start-content">
        <p className="start-kicker">原创第一人称雨林生存纵切片</p>
        <h1 id="game-title">这里不会告诉你<br /><em>什么能救命。</em></h1>
        <p className="start-lede">
          暴雨将在日落前封住山谷。检查伤口、辨认植物、净化水源，沿坐标找到废弃气象站，
          再带着电池活着回到营地。
        </p>
        <div className="start-actions">
          <button className="button-primary" disabled={!saveDiscoveryComplete} onClick={() => canContinue ? setConfirmNewGame(true) : onNewGame()}>
            {saveDiscoveryComplete ? "开始新远征" : "正在检查存档…"} <span>→</span>
          </button>
          {canContinue && (
            <button
              className="button-ghost"
              disabled={!saveDiscoveryComplete}
              aria-busy={!saveDiscoveryComplete}
              onClick={onContinue}
            >
              {saveDiscoveryComplete ? "继续最近存档" : "正在核对 Toy 云存档…"}
            </button>
          )}
        </div>
        {confirmNewGame && (
          <div className="start-save-confirm" role="alert">
            <strong>要覆盖现有进度吗？</strong>
            <p>确认后会删除本地的主存档、备份与损坏隔离副本，并用新进度覆盖 Toy 云存档。配方知识仍会保留。</p>
            <div><button className="button-danger" onClick={onNewGame}>删除并开始</button><button className="button-ghost" onClick={() => setConfirmNewGame(false)}>取消</button></div>
          </div>
        )}
        <div className="control-primer" aria-label="基本操作">
          <div><kbd>WASD</kbd><span>移动</span></div>
          <div><kbd>鼠标</kbd><span>观察</span></div>
          <div><kbd>E</kbd><span>互动</span></div>
          <div><kbd>1–3</kbd><span>装备工具</span></div>
          <div><kbd>Tab</kbd><span>背包</span></div>
          <div><kbd>B</kbd><span>检查身体</span></div>
          <div><kbd>F</kbd><span>抬起手表</span></div>
        </div>
      </div>
      <aside className="start-brief">
        <div className="brief-status"><i /> 信标离线</div>
        <p>坐标记录</p><strong>03° 07&apos; S<br />61° 18&apos; W</strong>
        <dl>
          <div><dt>预计暴雨</dt><dd>01:40</dd></div>
          <div><dt>左臂</dt><dd className="danger-text">开放伤口</dd></div>
          <div><dt>无线电</dt><dd>缺少电池</dd></div>
        </dl>
      </aside>
      <footer className="start-footer">
        <span>非官方机制研究 · 不含原作素材、剧情或代码</span>
        <span>建议佩戴耳机 · 危险同时提供声音与文字预警</span>
        <span>在 Toy 宿主中，随机设备标识与存档可同步到云端，并上报开局/胜负事件</span>
      </footer>
    </section>
  );
}
