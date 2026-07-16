import { useEffect, useRef, type KeyboardEvent } from "react";
import { ITEMS, type ItemId, type StructureDismantlePlan } from "../sim";

type DismantleConfirmationProps = {
  plan: StructureDismantlePlan;
  onConfirm: () => void;
  onCancel: () => void;
};

export function DismantleConfirmation({
  plan,
  onConfirm,
  onCancel,
}: DismantleConfirmationProps) {
  const refund = Object.entries(plan.refund) as Array<[ItemId, number]>;
  const backdropRef = useRef<HTMLDivElement | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const backdrop = backdropRef.current;
    const previousActiveElement =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    cancelRef.current?.focus({ preventScroll: true });

    const siblings = backdrop?.parentElement
      ? Array.from(backdrop.parentElement.children).filter(
          (candidate): candidate is HTMLElement =>
            candidate instanceof HTMLElement && candidate !== backdrop,
        )
      : [];
    const siblingState = siblings.map((element) => ({
      element,
      inert: element.hasAttribute("inert"),
      ariaHidden: element.getAttribute("aria-hidden"),
    }));
    for (const { element } of siblingState) {
      element.setAttribute("inert", "");
      element.setAttribute("aria-hidden", "true");
    }

    return () => {
      for (const { element, inert, ariaHidden } of siblingState) {
        if (!inert) element.removeAttribute("inert");
        if (ariaHidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", ariaHidden);
      }
      if (previousActiveElement?.isConnected) {
        previousActiveElement.focus({ preventScroll: true });
      }
    };
  }, []);

  const handleDialogKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
      return;
    }
    if (event.key !== "Tab") return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((element) => !element.hasAttribute("hidden"));
    if (focusable.length === 0) {
      event.preventDefault();
      dialog.focus({ preventScroll: true });
      return;
    }
    const first = focusable[0];
    const last = focusable.at(-1)!;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !dialog.contains(active))) {
      event.preventDefault();
      last.focus({ preventScroll: true });
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus({ preventScroll: true });
    }
  };

  return (
    <div
      ref={backdropRef}
      className="dismantle-dialog-backdrop"
      role="presentation"
      onMouseDown={onCancel}
    >
      <section
        ref={dialogRef}
        className="dismantle-dialog"
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby="dismantle-dialog-title"
        aria-describedby="dismantle-dialog-detail"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={handleDialogKeyDown}
      >
        <header>
          <div>
            <small>OUTPOST RELOCATION / 前哨迁营</small>
            <h2 id="dismantle-dialog-title">拆除{plan.label}？</h2>
          </div>
          <button type="button" onClick={onCancel} aria-label="取消拆除">×</button>
        </header>
        <div className="dismantle-dialog-body">
          <p id="dismantle-dialog-detail">
            拆除会推进约 {plan.workSeconds} 秒游戏时间。材料按既定返还表结算，操作完成后会立即建立自动恢复点。
          </p>
          {refund.length > 0 && (
            <div className="dismantle-refund" aria-label="预计返还材料">
              <strong>预计返还</strong>
              <ul>
                {refund.map(([itemId, amount]) => (
                  <li key={itemId}>
                    <span>{ITEMS[itemId].label}</span>
                    <b>×{amount}</b>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {!plan.ok && (
            <p className="dismantle-blocker" role="alert">{plan.message}</p>
          )}
        </div>
        <footer>
          <button ref={cancelRef} type="button" className="secondary" onClick={onCancel}>
            保留建筑
          </button>
          <button type="button" onClick={onConfirm} disabled={!plan.ok}>
            确认拆除
          </button>
        </footer>
      </section>
    </div>
  );
}
