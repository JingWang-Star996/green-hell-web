import type { HeldItemKind } from "../render/HeldItemRig";

export type EquipmentSlotView = {
  id: Exclude<HeldItemKind, null>;
  label: string;
  count: number;
  durabilityLabel?: string;
};

export function EquipmentBar({
  slots,
  equipped,
  onEquip,
}: {
  slots: readonly EquipmentSlotView[];
  equipped: HeldItemKind;
  onEquip: (itemId: HeldItemKind) => void;
}) {
  return (
    <div className="equipment-bar" role="toolbar" aria-label="快捷装备栏">
      {slots.map((slot, index) => {
        const selected = equipped === slot.id;
        return (
          <button
            key={slot.id}
            type="button"
            className={selected ? "is-equipped" : ""}
            aria-pressed={selected}
            disabled={slot.count <= 0}
            title={slot.durabilityLabel ? `${slot.label} · ${slot.durabilityLabel}` : slot.label}
            onClick={() => onEquip(selected ? null : slot.id)}
          >
            <kbd>{index + 1}</kbd>
            <span>{slot.label}</span>
            <small>{slot.count > 0 ? slot.durabilityLabel ?? `×${slot.count}` : "未持有"}</small>
          </button>
        );
      })}
      <button
        type="button"
        className="equipment-stow"
        aria-pressed={equipped === null}
        onClick={() => onEquip(null)}
      >
        <kbd>Q</kbd>
        <span>收起</span>
        <small>空手交互</small>
      </button>
    </div>
  );
}
