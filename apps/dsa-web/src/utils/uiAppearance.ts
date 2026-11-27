/**
 * 全局外观设置（字体 / 字号 / 行高）。
 *
 * 只使用本机已安装的字体，不加载任何在线 Web 字体：
 * - 字体来源是内置的常见中文字体清单 + （若环境支持）`queryLocalFonts()` 枚举到的本地字体；
 * - 最终通过 CSS 变量 `--app-font-family` / `--app-font-size` / `--app-line-height` 生效，
 *   样式定义在 `src/index.css`，因此全站统一受影响；
 * - 设置持久化在 localStorage，键名以 `dsa.ui` 开头；
 * - 旧版把三个值存在单个 `dsa.appearance` JSON 里，首次读取时会一次性迁移过来。
 */

export type UiFontChoice = {
  /** 存入 localStorage 的字体族名；空字符串表示系统默认 */
  value: string;
  labelZh: string;
  labelEn: string;
  /** 完整的 CSS font-family 值 */
  stack: string;
};

export type UiLineHeight = 'compact' | 'normal' | 'relaxed';

export type UiLineHeightChoice = {
  value: UiLineHeight;
  css: string;
  labelZh: string;
  labelEn: string;
};

export type UiAppearance = {
  fontFamily: string;
  fontSize: number;
  lineHeight: UiLineHeight;
};

const FALLBACK_STACK = '"Segoe UI", "Microsoft YaHei", system-ui, sans-serif';
const DEFAULT_STACK =
  '"Inter", "SF Pro Display", "Segoe UI", system-ui, -apple-system, sans-serif';

export const UI_FONT_STORAGE_KEY = 'dsa.uiFontFamily';
export const UI_FONT_SIZE_STORAGE_KEY = 'dsa.uiFontSize';
export const UI_LINE_HEIGHT_STORAGE_KEY = 'dsa.uiLineHeight';
/** 旧版单键存储，仅用于一次性迁移，不再写入。 */
export const LEGACY_UI_APPEARANCE_STORAGE_KEY = 'dsa.appearance';

/** 字体族名 -> 完整 stack。保留英文名，避免不同语言下的转义问题。 */
function fontStack(family: string): string {
  return `"${family}", ${FALLBACK_STACK}`;
}

/**
 * 内置候选清单。`queryLocalFonts()` 不可用时就是全部可选项；
 * 标注「本机未安装时自动回退」由浏览器字体回退机制保证，不需要额外探测。
 */
export const UI_FONT_CHOICES: UiFontChoice[] = [
  { value: '', labelZh: '系统默认', labelEn: 'System default', stack: DEFAULT_STACK },
  { value: 'Microsoft YaHei', labelZh: '微软雅黑', labelEn: 'Microsoft YaHei', stack: fontStack('Microsoft YaHei') },
  { value: 'Microsoft YaHei UI', labelZh: '微软雅黑 UI', labelEn: 'Microsoft YaHei UI', stack: fontStack('Microsoft YaHei UI') },
  { value: 'PingFang SC', labelZh: '苹方', labelEn: 'PingFang SC', stack: fontStack('PingFang SC') },
  { value: 'HarmonyOS Sans SC', labelZh: '鸿蒙字体', labelEn: 'HarmonyOS Sans SC', stack: fontStack('HarmonyOS Sans SC') },
  { value: 'MiSans', labelZh: 'MiSans', labelEn: 'MiSans', stack: fontStack('MiSans') },
  { value: 'Source Han Sans SC', labelZh: '思源黑体', labelEn: 'Source Han Sans SC', stack: fontStack('Source Han Sans SC') },
  { value: 'Noto Sans SC', labelZh: 'Noto Sans SC', labelEn: 'Noto Sans SC', stack: fontStack('Noto Sans SC') },
  { value: 'Alibaba PuHuiTi 3', labelZh: '阿里普惠体', labelEn: 'Alibaba PuHuiTi 3', stack: fontStack('Alibaba PuHuiTi 3') },
  { value: 'LXGW WenKai', labelZh: '霞鹜文楷', labelEn: 'LXGW WenKai', stack: fontStack('LXGW WenKai') },
  { value: 'SimHei', labelZh: '黑体', labelEn: 'SimHei', stack: fontStack('SimHei') },
  { value: 'SimSun', labelZh: '宋体', labelEn: 'SimSun', stack: fontStack('SimSun') },
  { value: 'KaiTi', labelZh: '楷体', labelEn: 'KaiTi', stack: fontStack('KaiTi') },
  { value: 'FangSong', labelZh: '仿宋', labelEn: 'FangSong', stack: fontStack('FangSong') },
  { value: 'DengXian', labelZh: '等线', labelEn: 'DengXian', stack: fontStack('DengXian') },
];

/** 基准字号候选。16px 与 Tailwind 的 rem 基准一致，选它时视觉与默认完全一致。 */
export const UI_FONT_SIZE_CHOICES = [14, 15, 16, 17, 18, 20] as const;

export const UI_LINE_HEIGHT_CHOICES: UiLineHeightChoice[] = [
  { value: 'compact', css: '1.35', labelZh: '紧凑', labelEn: 'Compact' },
  { value: 'normal', css: '1.5', labelZh: '标准', labelEn: 'Normal' },
  { value: 'relaxed', css: '1.75', labelZh: '宽松', labelEn: 'Relaxed' },
];

export const DEFAULT_UI_APPEARANCE: UiAppearance = {
  fontFamily: '',
  fontSize: 16,
  lineHeight: 'normal',
};

/** 旧版字体 id -> 字体族名（迁移用）。 */
const LEGACY_FONT_FAMILIES: Record<string, string> = {
  system: '',
  inter: 'Inter',
  segoe: 'Segoe UI',
  'source-han': 'Source Han Sans SC',
  yahei: 'Microsoft YaHei',
  'noto-sans': 'Noto Sans SC',
};

export function resolveFontStack(family: string): string {
  const hit = UI_FONT_CHOICES.find((choice) => choice.value === family);
  if (hit) {
    return hit.stack;
  }
  // 用户自定义的字体族名（可能来自 queryLocalFonts）或旧版迁移过来的字体族
  return family ? fontStack(family) : DEFAULT_STACK;
}

export function resolveLineHeightCss(lineHeight: UiLineHeight): string {
  const hit = UI_LINE_HEIGHT_CHOICES.find((choice) => choice.value === lineHeight);
  return hit ? hit.css : '1.5';
}

function readString(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function readNumber(key: string): number | null {
  const raw = readString(key);
  if (raw === null) {
    return null;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function writeValue(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // 隐私模式或存储配额不足时静默降级为「仅本次会话生效」
  }
}

function removeValue(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

function normalizeLineHeight(raw: string | null): UiLineHeight {
  const hit = UI_LINE_HEIGHT_CHOICES.find((choice) => choice.value === raw);
  return hit ? hit.value : DEFAULT_UI_APPEARANCE.lineHeight;
}

function normalizeFontSize(raw: number | null): number {
  if (raw === null) {
    return DEFAULT_UI_APPEARANCE.fontSize;
  }
  const allowed = UI_FONT_SIZE_CHOICES as readonly number[];
  if (allowed.includes(raw)) {
    return raw;
  }
  // 允许历史遗留的任意合理字号，但收敛到 12~24 的区间
  return Math.min(24, Math.max(12, Math.round(raw)));
}

function legacyLineHeight(raw: number): UiLineHeight {
  if (raw <= 1.45) {
    return 'compact';
  }
  if (raw >= 1.7) {
    return 'relaxed';
  }
  return 'normal';
}

/**
 * 把旧版 `dsa.appearance`（{ fontId, baseFontSize, lineHeight }）一次性迁移到新键。
 * 新键任意一个已有值时只清理旧键，不覆盖用户当前设置。
 * @returns 是否真的迁移了旧值
 */
export function migrateLegacyUiAppearance(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  const raw = readString(LEGACY_UI_APPEARANCE_STORAGE_KEY);
  if (raw === null) {
    return false;
  }
  const hasNewValue =
    readString(UI_FONT_STORAGE_KEY) !== null ||
    readString(UI_FONT_SIZE_STORAGE_KEY) !== null ||
    readString(UI_LINE_HEIGHT_STORAGE_KEY) !== null;
  if (hasNewValue) {
    removeValue(LEGACY_UI_APPEARANCE_STORAGE_KEY);
    return false;
  }

  let parsed: Partial<{ fontId: unknown; baseFontSize: unknown; lineHeight: unknown }> | null = null;
  try {
    parsed = JSON.parse(raw) as Partial<{ fontId: unknown; baseFontSize: unknown; lineHeight: unknown }>;
  } catch {
    parsed = null;
  }
  if (!parsed || typeof parsed !== 'object') {
    removeValue(LEGACY_UI_APPEARANCE_STORAGE_KEY);
    return false;
  }

  const fontId = typeof parsed.fontId === 'string' ? parsed.fontId : '';
  const baseFontSize = Number(parsed.baseFontSize);
  const lineHeight = Number(parsed.lineHeight);

  writeValue(UI_FONT_STORAGE_KEY, LEGACY_FONT_FAMILIES[fontId] ?? '');
  writeValue(
    UI_FONT_SIZE_STORAGE_KEY,
    String(normalizeFontSize(Number.isFinite(baseFontSize) && baseFontSize > 0 ? baseFontSize : null)),
  );
  writeValue(
    UI_LINE_HEIGHT_STORAGE_KEY,
    Number.isFinite(lineHeight) && lineHeight > 0
      ? legacyLineHeight(lineHeight)
      : DEFAULT_UI_APPEARANCE.lineHeight,
  );
  removeValue(LEGACY_UI_APPEARANCE_STORAGE_KEY);
  return true;
}

export function loadUiAppearance(): UiAppearance {
  if (typeof window === 'undefined') {
    return { ...DEFAULT_UI_APPEARANCE };
  }
  migrateLegacyUiAppearance();
  return {
    fontFamily: readString(UI_FONT_STORAGE_KEY) ?? DEFAULT_UI_APPEARANCE.fontFamily,
    fontSize: normalizeFontSize(readNumber(UI_FONT_SIZE_STORAGE_KEY)),
    lineHeight: normalizeLineHeight(readString(UI_LINE_HEIGHT_STORAGE_KEY)),
  };
}

export function applyUiAppearance(appearance: UiAppearance): void {
  if (typeof document === 'undefined') {
    return;
  }
  const root = document.documentElement;
  root.style.setProperty('--app-font-family', resolveFontStack(appearance.fontFamily));
  root.style.setProperty('--app-font-size', `${appearance.fontSize}px`);
  root.style.setProperty('--app-line-height', resolveLineHeightCss(appearance.lineHeight));
}

export function persistUiAppearance(appearance: UiAppearance): void {
  writeValue(UI_FONT_STORAGE_KEY, appearance.fontFamily);
  writeValue(UI_FONT_SIZE_STORAGE_KEY, String(appearance.fontSize));
  writeValue(UI_LINE_HEIGHT_STORAGE_KEY, appearance.lineHeight);
}

export function saveAndApplyUiAppearance(appearance: UiAppearance): void {
  persistUiAppearance(appearance);
  applyUiAppearance(appearance);
}

export function isDefaultUiAppearance(appearance: UiAppearance): boolean {
  return (
    appearance.fontFamily === DEFAULT_UI_APPEARANCE.fontFamily &&
    appearance.fontSize === DEFAULT_UI_APPEARANCE.fontSize &&
    appearance.lineHeight === DEFAULT_UI_APPEARANCE.lineHeight
  );
}

type LocalFontDataLike = { family?: unknown };
type LocalFontsApi = { queryLocalFonts?: () => Promise<LocalFontDataLike[]> };

/**
 * 枚举本机已安装的字体族。Chromium 需要 local-fonts 权限，桌面壳里可能不可用，
 * 因此调用方必须容忍返回空数组（此时只用内置清单）。
 */
export async function listLocalFontFamilies(): Promise<string[]> {
  const api = (globalThis as unknown as { window?: { queryLocalFonts?: unknown } }).window;
  const queryLocalFonts = (api as LocalFontsApi | undefined)?.queryLocalFonts;
  if (typeof queryLocalFonts !== 'function') {
    return [];
  }
  try {
    const fonts = await queryLocalFonts.call(api);
    const families = new Set<string>();
    for (const font of fonts) {
      const family = font && typeof font.family === 'string' ? font.family.trim() : '';
      if (family) {
        families.add(family);
      }
    }
    return Array.from(families).sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

/** 把额外枚举到的本地字体合并进候选清单（去重、跳过已内置的）。 */
export function mergeLocalFontChoices(extraFamilies: string[]): UiFontChoice[] {
  const known = new Set(UI_FONT_CHOICES.map((choice) => choice.value.toLowerCase()));
  const extras: UiFontChoice[] = [];
  for (const family of extraFamilies) {
    const key = family.toLowerCase();
    if (known.has(key)) {
      continue;
    }
    known.add(key);
    extras.push({
      value: family,
      labelZh: family,
      labelEn: family,
      stack: fontStack(family),
    });
  }
  return [...UI_FONT_CHOICES, ...extras];
}
