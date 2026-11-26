import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MACRO_SOURCE_URL,
  MACRO_SOURCE_STORAGE_KEY,
  normalizeMacroSourceUrl,
  persistMacroSourceUrl,
  readMacroSourceUrl,
} from '../macroSource';

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

describe('normalizeMacroSourceUrl', () => {
  it('accepts http and https absolute urls', () => {
    expect(normalizeMacroSourceUrl('https://example.com')).toBe('https://example.com/');
    expect(normalizeMacroSourceUrl('http://example.com/a')).toBe('http://example.com/a');
  });

  it('keeps a trailing slash stable', () => {
    expect(normalizeMacroSourceUrl('https://example.com/')).toBe('https://example.com/');
  });

  it('rejects empty, relative and non-http schemes', () => {
    expect(normalizeMacroSourceUrl('')).toBeNull();
    expect(normalizeMacroSourceUrl('   ')).toBeNull();
    expect(normalizeMacroSourceUrl('/relative/path')).toBeNull();
    expect(normalizeMacroSourceUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeMacroSourceUrl('file:///etc/passwd')).toBeNull();
    expect(normalizeMacroSourceUrl(null)).toBeNull();
    expect(normalizeMacroSourceUrl(undefined)).toBeNull();
  });
});

describe('macro source storage', () => {
  it('falls back to the default when nothing is stored', () => {
    const storage = createStorage();
    expect(readMacroSourceUrl(storage)).toBe(DEFAULT_MACRO_SOURCE_URL);
  });

  it('round-trips a custom url', () => {
    const storage = createStorage();
    persistMacroSourceUrl('https://example.com/macro', storage);
    expect(readMacroSourceUrl(storage)).toBe('https://example.com/macro');
  });

  it('drops an invalid value back to the default', () => {
    const storage = createStorage();
    storage.setItem(MACRO_SOURCE_STORAGE_KEY, 'not-a-url');
    expect(readMacroSourceUrl(storage)).toBe(DEFAULT_MACRO_SOURCE_URL);
  });

  it('persisting an invalid value clears the override', () => {
    const storage = createStorage();
    persistMacroSourceUrl('https://example.com/', storage);
    expect(persistMacroSourceUrl('nonsense', storage)).toBe(DEFAULT_MACRO_SOURCE_URL);
    expect(storage.getItem(MACRO_SOURCE_STORAGE_KEY)).toBeNull();
    expect(readMacroSourceUrl(storage)).toBe(DEFAULT_MACRO_SOURCE_URL);
  });
});
