/**
 * 外观设置（界面字体 / 基础字号 / 行高）
 *
 * 这些偏好只保存在浏览器本地，不上传、不入库，切换设备不会跟随。
 * 应用方式：把样式写进 documentElement 的 CSS 变量，并同步根字号，
 * 页面里所有 rem 单位会按基础字号等比缩放。
 */

export type AppearanceFontId = 'system' | 'inter' | 'segoe' | 'source-han' | 'yahei' | 'noto-sans';

export interface AppearanceSettings {
  fontId: AppearanceFontId;
  baseFontSize: number;
  lineHeight: number;
}

export const APPEARANCE_STORAGE_KEY = 'dsa.appearance';

export const FONT_IDS: AppearanceFontId[] = [
  'system',
  'inter',
  'segoe',
  'source-han',
  'yahei',
  'noto-sans',
];

/**
 * 只使用本机可能已安装的字体，不下载任何 Web 字体。
 * 每一条都以通用族兜底，避免某个字体缺失时退化成衬线体。
 */
export const FONT_STACKS: Record<AppearanceFontId, string> = {
  system:
    '"Inter", "SF Pro Display", "Segoe UI", system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
  inter:
    '"Inter", "SF Pro Display", "Segoe UI", system-ui, -apple-system, sans-serif',
  segoe:
    '"Segoe UI", "SF Pro Display", "Inter", system-ui, -apple-system, sans-serif',
  'source-han':
    '"Source Han Sans SC", "Noto Sans CJK SC", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif',
  yahei:
    '"Microsoft YaHei", "PingFang SC", "Source Han Sans SC", "Noto Sans CJK SC", system-ui, sans-serif',
  'noto-sans':
    '"Noto Sans", "Noto Sans CJK SC", "Noto Sans SC", "Source Han Sans SC", system-ui, sans-serif',
};

export const BASE_FONT_SIZES = [14, 15, 16, 18, 20] as const;

export const LINE_HEIGHTS = [1.4, 1.5, 1.6, 1.8] as const;

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  fontId: 'system',
  baseFontSize: 16,
  lineHeight: 1.5,
};

const MIN_FONT_SIZE = 12;
const MAX_FONT_SIZE = 24;
const MIN_LINE_HEIGHT = 1.2;
const MAX_LINE_HEIGHT = 2.2;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function normalizeAppearance(input: Partial<AppearanceSettings> | null | undefined): AppearanceSettings {
  const fontId =
    input && input.fontId && FONT_IDS.includes(input.fontId as AppearanceFontId)
      ? (input.fontId as AppearanceFontId)
      : DEFAULT_APPEARANCE.fontId;

  const rawSize = Number(input?.baseFontSize);
  const baseFontSize = Number.isFinite(rawSize)
    ? clamp(Math.round(rawSize), MIN_FONT_SIZE, MAX_FONT_SIZE)
    : DEFAULT_APPEARANCE.baseFontSize;

  const rawLineHeight = Number(input?.lineHeight);
  const lineHeight = Number.isFinite(rawLineHeight)
    ? clamp(Math.round(rawLineHeight * 10) / 10, MIN_LINE_HEIGHT, MAX_LINE_HEIGHT)
    : DEFAULT_APPEARANCE.lineHeight;

  return { fontId, baseFontSize, lineHeight };
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function safeStorage(storage?: StorageLike | null): StorageLike | null {
  if (storage) return storage;
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function readAppearance(storage?: StorageLike | null): AppearanceSettings {
  const store = safeStorage(storage);
  if (!store) return { ...DEFAULT_APPEARANCE };
  try {
    const raw = store.getItem(APPEARANCE_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_APPEARANCE };
    return normalizeAppearance(JSON.parse(raw) as Partial<AppearanceSettings>);
  } catch {
    return { ...DEFAULT_APPEARANCE };
  }
}

export function persistAppearance(settings: AppearanceSettings, storage?: StorageLike | null): void {
  const store = safeStorage(storage);
  if (!store) return;
  try {
    store.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(normalizeAppearance(settings)));
  } catch {
    // 存储被禁用（隐私模式）时忽略，不影响当前会话里的样式
  }
}

export function clearAppearance(storage?: StorageLike | null): void {
  const store = safeStorage(storage);
  if (!store) return;
  try {
    store.removeItem(APPEARANCE_STORAGE_KEY);
  } catch {
    // ignore
  }
}

/**
 * 把外观设置写到文档根节点。
 * 传入 null / undefined 时回落到默认值并清理内联变量。
 */
export function applyAppearance(
  settings: AppearanceSettings | null | undefined,
  root: HTMLElement | null = typeof document !== 'undefined' ? document.documentElement : null,
): void {
  if (!root) return;
  const normalized = normalizeAppearance(settings ?? DEFAULT_APPEARANCE);
  root.style.setProperty('--app-font-family', FONT_STACKS[normalized.fontId]);
  root.style.setProperty('--app-base-font-size', `${normalized.baseFontSize}px`);
  root.style.setProperty('--app-line-height', String(normalized.lineHeight));
  root.style.fontSize = `${normalized.baseFontSize}px`;
}
