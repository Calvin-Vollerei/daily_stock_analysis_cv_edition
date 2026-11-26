import { describe, expect, it } from 'vitest';

import {
  APPEARANCE_STORAGE_KEY,
  DEFAULT_APPEARANCE,
  FONT_IDS,
  FONT_STACKS,
  applyAppearance,
  clearAppearance,
  normalizeAppearance,
  persistAppearance,
  readAppearance,
} from '../appearance';

function createStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => (map.has(key) ? (map.get(key) as string) : null),
    key: (index: number) => Array.from(map.keys())[index] ?? null,
    removeItem: (key: string) => {
      map.delete(key);
    },
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  } as Storage;
}

describe('appearance storage', () => {
  it('falls back to defaults when nothing is stored', () => {
    const storage = createStorage();
    expect(readAppearance(storage)).toEqual(DEFAULT_APPEARANCE);
  });

  it('round-trips a persisted setting', () => {
    const storage = createStorage();
    persistAppearance({ fontId: 'yahei', baseFontSize: 18, lineHeight: 1.6 }, storage);
    expect(readAppearance(storage)).toEqual({ fontId: 'yahei', baseFontSize: 18, lineHeight: 1.6 });
  });

  it('clears the stored setting', () => {
    const storage = createStorage();
    persistAppearance({ fontId: 'inter', baseFontSize: 14, lineHeight: 1.4 }, storage);
    clearAppearance(storage);
    expect(storage.getItem(APPEARANCE_STORAGE_KEY)).toBeNull();
    expect(readAppearance(storage)).toEqual(DEFAULT_APPEARANCE);
  });

  it('survives malformed storage content', () => {
    const storage = createStorage();
    storage.setItem(APPEARANCE_STORAGE_KEY, '{not json');
    expect(readAppearance(storage)).toEqual(DEFAULT_APPEARANCE);
  });
});

describe('normalizeAppearance', () => {
  it('rejects unknown font ids', () => {
    expect(normalizeAppearance({ fontId: 'comic-sans' as never }).fontId).toBe(DEFAULT_APPEARANCE.fontId);
  });

  it('clamps font size and line height into a safe range', () => {
    expect(normalizeAppearance({ baseFontSize: 2 }).baseFontSize).toBe(12);
    expect(normalizeAppearance({ baseFontSize: 400 }).baseFontSize).toBe(24);
    expect(normalizeAppearance({ lineHeight: 0.1 }).lineHeight).toBe(1.2);
    expect(normalizeAppearance({ lineHeight: 9 }).lineHeight).toBe(2.2);
  });

  it('rounds font size to whole pixels', () => {
    expect(normalizeAppearance({ baseFontSize: 17.6 }).baseFontSize).toBe(18);
  });

  it('every font id has a usable stack ending in a generic family', () => {
    for (const id of FONT_IDS) {
      const stack = FONT_STACKS[id];
      expect(stack.length).toBeGreaterThan(0);
      expect(stack).toMatch(/sans-serif$/);
    }
  });
});

describe('applyAppearance', () => {
  it('writes css variables and the root font size', () => {
    const root = document.createElement('div');
    applyAppearance({ fontId: 'segoe', baseFontSize: 18, lineHeight: 1.6 }, root);

    expect(root.style.getPropertyValue('--app-font-family')).toBe(FONT_STACKS.segoe);
    expect(root.style.getPropertyValue('--app-base-font-size')).toBe('18px');
    expect(root.style.getPropertyValue('--app-line-height')).toBe('1.6');
    expect(root.style.fontSize).toBe('18px');
  });

  it('uses defaults when called without settings', () => {
    const root = document.createElement('div');
    applyAppearance(undefined, root);

    expect(root.style.getPropertyValue('--app-base-font-size')).toBe(
      `${DEFAULT_APPEARANCE.baseFontSize}px`,
    );
    expect(root.style.getPropertyValue('--app-line-height')).toBe(String(DEFAULT_APPEARANCE.lineHeight));
  });
});
