import type { DeathReviewModel } from "../sim/playerStatus";

type DeathReviewProps = {
  review: DeathReviewModel;
  summaryStats?: readonly Readonly<{ label: string; value: string }>[];
  hasCheckpoints?: boolean;
  recommendedCheckpointLabel?: string;
  onChooseCheckpoint?: () => void;
  onStartNewRun: () => void;
  onOpenNotebook?: () => void;
};

function formatElapsed(seconds: number): string {
  const safe = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const minutes = Math.floor(safe / 60);
  return `${String(minutes).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

/** Death is a causal review and recovery decision, not a generic restart card. */
export function DeathReview({
  review,
  summaryStats = [],
  hasCheckpoints = false,
  recommendedCheckpointLabel,
  onChooseCheckpoint,
  onStartNewRun,
  onOpenNotebook,
}: DeathReviewProps) {
  return (
    <section className="death-review" aria-labelledby="death-review-title">
      <header>
        <small>DIRECT CAUSE / 直接死因</small>
        <h3 id="death-review-title">{review.directCauseLabel}</h3>
        <p>{review.summary}</p>
        {review.inferred && <em>根据当前身体状态与最近可信事件推断</em>}
      </header>

      <ol className="death-causal-chain" aria-label="死亡因果链">
        {review.chain.map((step) => (
          <li key={step.id}>
            <time>{formatElapsed(step.elapsedSeconds)}</time>
            <span>{step.label}</span>
          </li>
        ))}
      </ol>

      {review.advice && (
        <aside className="death-known-advice">
          <small>已掌握的改进方向</small>
          <p>{review.advice}</p>
        </aside>
      )}

      {summaryStats.length > 0 && (
        <dl className="death-review-stats">
          {summaryStats.map((stat) => (
            <div key={stat.label}>
              <dt>{stat.label}</dt>
              <dd>{stat.value}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="death-review-actions">
        {hasCheckpoints ? (
          <>
            <div className="death-review-primary-action">
              <button type="button" className="button-primary" onClick={onChooseCheckpoint}>
                选择恢复点 <span>→</span>
              </button>
              {recommendedCheckpointLabel && (
                <small>推荐：{recommendedCheckpointLabel}</small>
              )}
            </div>
            <button type="button" className="button-ghost" onClick={onStartNewRun}>
              新的远征
            </button>
          </>
        ) : (
          <button type="button" className="button-primary" onClick={onStartNewRun}>
            再次远征 <span>→</span>
          </button>
        )}
        {onOpenNotebook && (
          <button type="button" className="button-ghost" onClick={onOpenNotebook}>
            查看完整因果日志
          </button>
        )}
      </div>
    </section>
  );
}
