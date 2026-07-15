import { useRef, type ChangeEvent } from "react";
import type { KVStorageDurability } from "../persistence";

export interface SaveImportPreview {
  sourceLabel: string;
  exportedAt?: string;
  day: number;
  time: string;
  completedObjectives: number;
  statusLabel: string;
}

export type SaveTransferState =
  | { phase: "idle" }
  | { phase: "preparing-export" }
  | { phase: "export-ready"; url: string; filename: string }
  | { phase: "validating-import" }
  | { phase: "import-ready"; preview: SaveImportPreview }
  | { phase: "importing"; preview: SaveImportPreview }
  | { phase: "complete"; message: string }
  | { phase: "error"; message: string };

type SaveTransferControlsProps = {
  localDurability: KVStorageDurability;
  state: SaveTransferState;
  hasPreImport: boolean;
  onPrepareExport: () => void;
  onSelectImport: (file: File) => void;
  onConfirmImport: () => void;
  onCancelImport: () => void;
  onPreparePreImportRestore: () => void;
};

export function SaveTransferControls({
  localDurability,
  state,
  hasPreImport,
  onPrepareExport,
  onSelectImport,
  onConfirmImport,
  onCancelImport,
  onPreparePreImportRestore,
}: SaveTransferControlsProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const busy =
    state.phase === "preparing-export" ||
    state.phase === "validating-import" ||
    state.phase === "importing";
  const chooseFile = () => {
    if (busy) return;
    fileInputRef.current?.click();
  };
  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (file) onSelectImport(file);
  };

  return (
    <section className="save-transfer" aria-labelledby="save-transfer-title">
      <header>
        <div>
          <strong id="save-transfer-title">存档文件</strong>
          <small>
            {localDurability === "persistent"
              ? "浏览器本地存档可用 · Toy 云端按保存进度同步"
              : "本机持久存储不可用 · 请导出文件作为恢复副本"}
          </small>
        </div>
        <span className={`storage-capability storage-${localDurability}`}>
          {localDurability === "persistent" ? "本机可持久化" : "仅本次页面"}
        </span>
      </header>

      <div className="save-transfer-actions">
        <button
          type="button"
          className="button-ghost"
          disabled={busy}
          onClick={onPrepareExport}
        >
          {state.phase === "preparing-export" ? "正在准备…" : "准备导出文件"}
        </button>
        <button
          type="button"
          className="button-ghost"
          disabled={busy}
          onClick={chooseFile}
        >
          选择文件导入
        </button>
        <input
          ref={fileInputRef}
          className="sr-only"
          type="file"
          accept=".canopy-save.json,.json,application/json"
          onChange={onFileChange}
        />
      </div>

      {state.phase === "export-ready" && (
        <div className="save-transfer-result" role="status">
          <span>文件已准备完成。请点击下方链接保存到设备。</span>
          <a className="button-primary save-download-link" href={state.url} download={state.filename}>
            下载存档文件
          </a>
        </div>
      )}

      {(state.phase === "import-ready" || state.phase === "importing") && (
        <div className="save-import-confirm" role="alert">
          <strong>确认替换当前远征？</strong>
          <dl>
            <div><dt>来源</dt><dd>{state.preview.sourceLabel}</dd></div>
            <div><dt>游戏时间</dt><dd>DAY {state.preview.day} · {state.preview.time}</dd></div>
            <div><dt>任务进度</dt><dd>{state.preview.completedObjectives} 项完成</dd></div>
            <div><dt>远征状态</dt><dd>{state.preview.statusLabel}</dd></div>
            {state.preview.exportedAt && (
              <div><dt>导出时间</dt><dd>{state.preview.exportedAt}</dd></div>
            )}
          </dl>
          <p>确认后会先保留“导入前恢复点”，再替换本地进度并同步 Toy 云端。</p>
          <div>
            <button
              type="button"
              className="button-danger"
              disabled={state.phase === "importing"}
              onClick={onConfirmImport}
            >
              {state.phase === "importing" ? "正在验证并替换…" : "确认替换并同步"}
            </button>
            <button
              type="button"
              className="button-ghost"
              disabled={state.phase === "importing"}
              onClick={onCancelImport}
            >
              取消
            </button>
          </div>
        </div>
      )}

      {(state.phase === "validating-import" || state.phase === "complete" || state.phase === "error") && (
        <p
          className={`save-transfer-message message-${state.phase}`}
          role="status"
          aria-live="polite"
        >
          {state.phase === "validating-import"
            ? "正在离线校验文件，不会修改当前存档…"
            : state.message}
        </p>
      )}

      {hasPreImport && state.phase !== "import-ready" && state.phase !== "importing" && (
        <button
          type="button"
          className="save-rollback-button"
          disabled={busy}
          onClick={onPreparePreImportRestore}
        >
          预览并恢复导入前进度
        </button>
      )}
    </section>
  );
}
