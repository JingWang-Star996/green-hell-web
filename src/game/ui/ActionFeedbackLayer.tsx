import { useEffect } from "react";
import type { ActionReceipt, ActionReceiptStatus } from "./actionReceipt";

type ActionFeedbackLayerProps = {
  receipts: readonly ActionReceipt[];
  onExpire: (nowMs: number) => void;
};

const STATUS_LABELS: Record<ActionReceiptStatus, string> = {
  accepted: "操作已接受",
  rejected: "无法执行",
  completed: "操作完成",
  interrupted: "操作中断",
};

export function ActionFeedbackLayer({
  receipts,
  onExpire,
}: ActionFeedbackLayerProps) {
  useEffect(() => {
    if (receipts.length === 0) return;
    const nextExpiry = Math.min(...receipts.map((receipt) => receipt.expiresAtMs));
    const timer = window.setTimeout(
      () => onExpire(Date.now()),
      Math.max(0, nextExpiry - Date.now()) + 16,
    );
    return () => window.clearTimeout(timer);
  }, [onExpire, receipts]);

  if (receipts.length === 0) return null;

  return (
    <section className="action-feedback-layer" aria-label="操作回执">
      {receipts.map((receipt) => {
        const hasDanger = receipt.dangerSideEffects.length > 0;
        return (
          <article
            key={receipt.id}
            className={`action-receipt receipt-${receipt.tone} receipt-${receipt.status}`}
            role={receipt.tone === "danger" ? "alert" : "status"}
            aria-live={receipt.tone === "danger" ? "assertive" : "polite"}
            aria-atomic="true"
          >
            {hasDanger && (
              <div className="action-receipt-danger">
                <small>同时发生的危险</small>
                {receipt.dangerSideEffects.map((event) => (
                  <strong key={event.id}>{event.message}</strong>
                ))}
                {receipt.dangerSideEffects.length > 1 && (
                  <span className="action-receipt-danger-more">
                    另有 {receipt.dangerSideEffects.length - 1} 项危险同时发生
                  </span>
                )}
              </div>
            )}
            <div className="action-receipt-primary">
              <small>{STATUS_LABELS[receipt.status]}</small>
              <strong>{receipt.primary.message}</strong>
            </div>
          </article>
        );
      })}
    </section>
  );
}
