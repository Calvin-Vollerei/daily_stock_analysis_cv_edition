import { beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_UI_APPEARANCE,
  LEGACY_UI_APPEARANCE_STORAGE_KEY,
  UI_FONT_CHOICES,
  UI_FONT_SIZE_STORAGE_KEY,
  UI_FONT_STORAGE_KEY,
  UI_LINE_HEIGHT_STORAGE_KEY,
  applyUiAppearance,
  isDefaultUiAppearance,
  loadUiAppearance,
  mergeLocalFontChoices,
  migrateLegacyUiAppearance,
  persistUiAppearance,
  resolveFontStack,
  resolveLineHeightCss,
} from '../uiAppearance';

beforeEach(() => {
  window.localStorage.clear();
});

describe('uiAppearance storage', () => {
  it('falls back to defaults when nothing is stored', () => {
    expect(loadUiAppearance()).toEqual(DEFAULT_UI_APPEARANCE);
  });

  it('round-trips the three dedicated keys', () => {
    persistUiAppearance({ fontFamily: 'Microsoft YaHei', fontSize: 18, lineHeight: 'relaxed' });

    expect(window.localStorage.getItem(UI_FONT_STORAGE_KEY)).toBe('Microsoft YaHei');
    expect(window.localStorage.getItem(UI_FONT_SIZE_STORAGE_KEY)).toBe('18');
    expect(window.localStorage.getItem(UI_LINE_HEIGHT_STORAGE_KEY)).toBe('relaxed');
    expect(loadUiAppearance()).toEqual({
      fontFamily: 'Microsoft YaHei',
      fontSize: 18,
      lineHeight: 'relaxed',
    });
  });

  it('normalizes unknown or out-of-range stored values', () => {
    window.localStorage.setItem(UI_FONT_SIZE_STORAGE_KEY, '88');
    window.localStorage.setItem(UI_LINE_HEIGHT_STORAGE_KEY, 'whatever');

    const loaded = loadUiAppearance();
    expect(loaded.fontSize).toBe(24);
    expect(loaded.lineHeight).toBe(DEFAULT_UI_APPEARANCE.lineHeight);
  });

  it('detects the default appearance', () => {
    expect(isDefaultUiAppearance({ ...DEFAULT_UI_APPEARANCE })).toBe(true);
    expect(isDefaultUiAppearance({ ...DEFAULT_UI_APPEARANCE, fontSize: 18 })).toBe(false);
  });
});

describe('legacy dsa.appearance migration', () => {
  it('migrates the single-key JSON into the new keys once', () => {
    window.localStorage.setItem(
      LEGACY_UI_APPEARANCE_STORAGE_KEY,
      JSON.stringify({ fontId: 'yahei', baseFontSize: 18, lineHeight: 1.6 }),
    );

    expect(loadUiAppearance()).toEqual({
      fontFamily: 'Microsoft YaHei',
      fontSize: 18,
      lineHeight: 'normal',
    });
    expect(window.localStorage.getItem(LEGACY_UI_APPEARANCE_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(UI_FONT_STORAGE_KEY)).toBe('Microsoft YaHei');

    // Second load reads the new keys, not the legacy value again.
    expect(migrateLegacyUiAppearance()).toBe(false);
  });

  it('maps the system font id to the default stack', () => {
    window.localStorage.setItem(
      LEGACY_UI_APPEARANCE_STORAGE_KEY,
      JSON.stringify({ fontId: 'system', baseFontSize: 14, lineHeight: 1.4 }),
    );

    expect(loadUiAppearance()).toEqual({ fontFamily: '', fontSize: 14, lineHeight: 'compact' });
  });

  it('maps the noto font id and relaxed line height', () => {
    window.localStorage.setItem(
      LEGACY_UI_APPEARANCE_STORAGE_KEY,
      JSON.stringify({ fontId: 'noto-sans', baseFontSize: 20, lineHeight: 1.8 }),
    );

    expect(loadUiAppearance()).toEqual({
      fontFamily: 'Noto Sans SC',
      fontSize: 20,
      lineHeight: 'relaxed',
    });
  });

  it('never overwrites values already stored under the new keys', () => {
    window.localStorage.setItem(UI_FONT_STORAGE_KEY, 'SimHei');
    window.localStorage.setItem(
      LEGACY_UI_APPEARANCE_STORAGE_KEY,
      JSON.stringify({ fontId: 'yahei', baseFontSize: 18, lineHeight: 1.6 }),
    );

    expect(loadUiAppearance().fontFamily).toBe('SimHei');
    expect(window.localStorage.getItem(LEGACY_UI_APPEARANCE_STORAGE_KEY)).toBeNull();
  });

  it('drops malformed legacy content and keeps defaults', () => {
    window.localStorage.setItem(LEGACY_UI_APPEARANCE_STORAGE_KEY, '{not json');

    expect(loadUiAppearance()).toEqual(DEFAULT_UI_APPEARANCE);
    expect(window.localStorage.getItem(LEGACY_UI_APPEARANCE_STORAGE_KEY)).toBeNull();
  });
});

describe('applying the appearance', () => {
  it('writes the three CSS variables on the document root', () => {
    applyUiAppearance({ fontFamily: 'Microsoft YaHei', fontSize: 18, lineHeight: 'relaxed' });

    const root = document.documentElement;
    expect(root.style.getPropertyValue('--app-font-family')).toBe(
      '"Microsoft YaHei", "Segoe UI", "Microsoft YaHei", system-ui, sans-serif',
    );
    expect(root.style.getPropertyValue('--app-font-size')).toBe('18px');
    expect(root.style.getPropertyValue('--app-line-height')).toBe('1.75');
  });

  it('falls back to the default stack for the system default font', () => {
    applyUiAppearance({ ...DEFAULT_UI_APPEARANCE });

    expect(resolveFontStack('')).toBe(
      '"Inter", "SF Pro Display", "Segoe UI", system-ui, -apple-system, sans-serif',
    );
    expect(document.documentElement.style.getPropertyValue('--app-font-size')).toBe('16px');
  });
});

describe('resolve helpers', () => {
  it('resolves known families through the built-in choice list', () => {
    expect(resolveFontStack('SimHei')).toBe('"SimHei", "Segoe UI", "Microsoft YaHei", system-ui, sans-serif');
    expect(resolveLineHeightCss('compact')).toBe('1.35');
    expect(resolveLineHeightCss('normal')).toBe('1.5');
    expect(resolveLineHeightCss('relaxed')).toBe('1.75');
  });

  it('builds a stack for a family discovered from queryLocalFonts', () => {
    expect(resolveFontStack('Some Local Font')).toBe(
      '"Some Local Font", "Segoe UI", "Microsoft YaHei", system-ui, sans-serif',
    );
  });
});

describe('mergeLocalFontChoices', () => {
  it('keeps the built-in list and appends unknown families without duplicates', () => {
    const merged = mergeLocalFontChoices(['Microsoft YaHei', 'Some Local Font']);

    expect(merged).toHaveLength(UI_FONT_CHOICES.length + 1);
    expect(merged[merged.length - 1].value).toBe('Some Local Font');
    expect(merged.filter((choice) => choice.value === 'Microsoft YaHei')).toHaveLength(1);
  });
});
