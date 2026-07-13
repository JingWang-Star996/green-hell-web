import { useEffect, useRef } from "react";
import type { TouchInput } from "../render/types";

type TouchControlsProps = {
  visible: boolean;
  onInput: (input: Partial<TouchInput>) => void;
  onInteract: () => void;
  onOpenPack: () => void;
  onOpenBody: () => void;
};

export function TouchControls({ visible, onInput, onInteract, onOpenPack, onOpenBody }: TouchControlsProps) {
  const movePointer = useRef<number | null>(null);
  const moveOrigin = useRef({ x: 0, y: 0 });
  const lookPointer = useRef<number | null>(null);
  const lookLast = useRef({ x: 0, y: 0 });
  const lookResetTimer = useRef<number | null>(null);
  const inputRef = useRef(onInput);

  useEffect(() => {
    inputRef.current = onInput;
  }, [onInput]);

  useEffect(() => {
    if (visible) return;
    movePointer.current = null;
    lookPointer.current = null;
    if (lookResetTimer.current !== null) window.clearTimeout(lookResetTimer.current);
    lookResetTimer.current = null;
    inputRef.current({ forward: 0, right: 0, lookX: 0, lookY: 0, sprint: false });
  }, [visible]);

  useEffect(() => () => {
    if (lookResetTimer.current !== null) window.clearTimeout(lookResetTimer.current);
    inputRef.current({ forward: 0, right: 0, lookX: 0, lookY: 0, sprint: false });
  }, []);

  if (!visible) return null;
  return (
    <div className="touch-controls">
      <div
        className="touch-move"
        onPointerDown={(event) => {
          movePointer.current = event.pointerId;
          moveOrigin.current = { x: event.clientX, y: event.clientY };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (movePointer.current !== event.pointerId) return;
          const dx = Math.max(-42, Math.min(42, event.clientX - moveOrigin.current.x));
          const dy = Math.max(-42, Math.min(42, event.clientY - moveOrigin.current.y));
          onInput({ right: dx / 42, forward: -dy / 42 });
        }}
        onPointerUp={(event) => {
          if (movePointer.current !== event.pointerId) return;
          movePointer.current = null;
          onInput({ right: 0, forward: 0 });
        }}
        onPointerCancel={(event) => {
          if (movePointer.current !== event.pointerId) return;
          movePointer.current = null;
          onInput({ right: 0, forward: 0 });
        }}
        onLostPointerCapture={(event) => {
          if (movePointer.current !== event.pointerId) return;
          movePointer.current = null;
          onInput({ right: 0, forward: 0 });
        }}
      ><span>移动</span></div>
      <div
        className="touch-look"
        onPointerDown={(event) => {
          lookPointer.current = event.pointerId;
          lookLast.current = { x: event.clientX, y: event.clientY };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (lookPointer.current !== event.pointerId) return;
          const dx = event.clientX - lookLast.current.x;
          const dy = event.clientY - lookLast.current.y;
          lookLast.current = { x: event.clientX, y: event.clientY };
          onInput({ lookX: dx * 0.12, lookY: dy * 0.12 });
          if (lookResetTimer.current !== null) window.clearTimeout(lookResetTimer.current);
          lookResetTimer.current = window.setTimeout(() => {
            lookResetTimer.current = null;
            inputRef.current({ lookX: 0, lookY: 0 });
          }, 32);
        }}
        onPointerUp={(event) => {
          if (lookPointer.current !== event.pointerId) return;
          lookPointer.current = null;
          if (lookResetTimer.current !== null) window.clearTimeout(lookResetTimer.current);
          lookResetTimer.current = null;
          onInput({ lookX: 0, lookY: 0 });
        }}
        onPointerCancel={(event) => {
          if (lookPointer.current !== event.pointerId) return;
          lookPointer.current = null;
          if (lookResetTimer.current !== null) window.clearTimeout(lookResetTimer.current);
          lookResetTimer.current = null;
          onInput({ lookX: 0, lookY: 0 });
        }}
        onLostPointerCapture={(event) => {
          if (lookPointer.current !== event.pointerId) return;
          lookPointer.current = null;
          onInput({ lookX: 0, lookY: 0 });
        }}
      />
      <button className="touch-action" onClick={onInteract}>互动</button>
      <button className="touch-pack" onClick={onOpenPack}>背包</button>
      <button className="touch-body" onClick={onOpenBody}>身体</button>
      <button
        className="touch-sprint"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          onInput({ sprint: true });
        }}
        onPointerUp={() => onInput({ sprint: false })}
        onPointerCancel={() => onInput({ sprint: false })}
        onLostPointerCapture={() => onInput({ sprint: false })}
      >冲刺</button>
    </div>
  );
}
