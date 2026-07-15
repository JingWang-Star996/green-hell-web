export const UI_SETTINGS_KEY = "canopy_ui_settings_v1";
export const UI_SCALE_MIN = 80;
export const UI_SCALE_MAX = 140;
export const UI_SCALE_STEP = 5;

export interface UiSettings {
  version: 1;
  uiScale: number;
  audioEnabled: boolean;
  reducedMotion: boolean;
}

export const DEFAULT_UI_SETTINGS: UiSettings = {
  version: 1,
  uiScale: 100,
  audioEnabled: true,
  reducedMotion: false,
};

interface SettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function storageFrom(globalObject: unknown): SettingsStorage | null {
  try {
    if (
      (typeof globalObject !== "object" || globalObject === null) &&
      typeof globalObject !== "function"
    ) {
      return null;
    }
    const candidate = Reflect.get(globalObject, "localStorage") as Partial<SettingsStorage> | null;
    return candidate &&
      typeof candidate.getItem === "function" &&
      typeof candidate.setItem === "function"
      ? candidate as SettingsStorage
      : null;
  } catch {
    return null;
  }
}

export function normalizeUiScale(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_UI_SETTINGS.uiScale;
  }
  const clamped = Math.max(UI_SCALE_MIN, Math.min(UI_SCALE_MAX, value));
  return Math.round(clamped / UI_SCALE_STEP) * UI_SCALE_STEP;
}

export function normalizeUiSettings(value: unknown): UiSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...DEFAULT_UI_SETTINGS };
  }
  const candidate = value as Partial<UiSettings>;
  if (candidate.version !== 1) return { ...DEFAULT_UI_SETTINGS };
  return {
    version: 1,
    uiScale: normalizeUiScale(candidate.uiScale),
    audioEnabled:
      typeof candidate.audioEnabled === "boolean"
        ? candidate.audioEnabled
        : DEFAULT_UI_SETTINGS.audioEnabled,
    reducedMotion:
      typeof candidate.reducedMotion === "boolean"
        ? candidate.reducedMotion
        : DEFAULT_UI_SETTINGS.reducedMotion,
  };
}

export function readUiSettings(globalObject: unknown = globalThis): UiSettings {
  const storage = storageFrom(globalObject);
  if (!storage) return { ...DEFAULT_UI_SETTINGS };
  try {
    const raw = storage.getItem(UI_SETTINGS_KEY);
    return raw ? normalizeUiSettings(JSON.parse(raw)) : { ...DEFAULT_UI_SETTINGS };
  } catch {
    return { ...DEFAULT_UI_SETTINGS };
  }
}

export function writeUiSettings(
  settings: UiSettings,
  globalObject: unknown = globalThis,
): boolean {
  const storage = storageFrom(globalObject);
  if (!storage) return false;
  try {
    storage.setItem(UI_SETTINGS_KEY, JSON.stringify(normalizeUiSettings(settings)));
    return true;
  } catch {
    return false;
  }
}

export function uiScaleFactor(uiScale: number): number {
  return normalizeUiScale(uiScale) / 100;
}
