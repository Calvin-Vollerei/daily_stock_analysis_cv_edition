/* eslint-disable react-refresh/only-export-components -- Provider 与配套 hook 同文件导出，拆分会让调用方多一个 import */
/**
 * 角色主题的状态与落地。
 *
 * 只做三件事：读/存 localStorage、把 `data-character` 写到 `<html>`、
 * 把角色色板写成 CSS 变量。样式表里只保留「同一批变量按 data-character 取值」
 * 的覆盖块，因此任何组件都不需要知道自己处在哪个主题下。
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  CHARACTER_THEMES,
  DEFAULT_CHARACTER_THEME,
  findCharacterTheme,
  type CharacterTheme,
  type CharacterThemeId,
  type CharacterPalette,
} from './characterThemes';

const STORAGE_KEY = 'dsa.characterTheme';
/** 桌面端开机页（file:// 源）读不到 localStorage，只能由主进程读后端写的这个文件。 */
const UI_THEME_ENDPOINT = '/api/v1/system/ui-theme';

/**
 * 把选择同步给后端（桌面端据此在开机页画立绘）。
 * fire-and-forget：失败只告警，绝不影响主题切换本身。
 */
function persistCharacterTheme(id: CharacterThemeId | null): void {
  try {
    void fetch(UI_THEME_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ character: id }),
    })
      .then((response) => {
        if (!response.ok) {
          console.warn('[dsa-character-theme] persist failed: HTTP', response.status);
        }
      })
      .catch((error: unknown) => {
        console.warn('[dsa-character-theme] persist failed', error);
      });
  } catch (error) {
    console.warn('[dsa-character-theme] persist failed', error);
  }
}

export interface CharacterThemeContextValue {
  themeId: CharacterThemeId | null;
  theme: CharacterTheme | null;
  setThemeId: (id: CharacterThemeId | null) => void;
}

const CharacterThemeContext = createContext<CharacterThemeContextValue>({
  themeId: null,
  theme: null,
  setThemeId: () => {},
});

function readStoredThemeId(): CharacterThemeId | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (findCharacterTheme(raw)?.id ?? null) : DEFAULT_CHARACTER_THEME;
  } catch {
    return DEFAULT_CHARACTER_THEME;
  }
}

/** 把色板写成 CSS 变量；传 null 表示清空，回到样式表里的默认主题。 */
function applyPalette(palette: CharacterPalette | null): void {
  const root = document.documentElement;
  const tokens: Array<[string, string]> = palette
    ? [
        ['--character-primary', palette.primary],
        ['--character-primary-foreground', palette.primaryForeground],
        ['--character-primary-deep', palette.primaryDeep],
        ['--character-primary-soft', palette.primarySoft],
        ['--character-accent', palette.accent],
        ['--character-accent-deep', palette.accentDeep],
        ['--character-tint', palette.tint],
        ['--character-glow', palette.glow],
      ]
    : [];
  if (tokens.length === 0) {
    [
      '--character-primary',
      '--character-primary-foreground',
      '--character-primary-deep',
      '--character-primary-soft',
      '--character-accent',
      '--character-accent-deep',
      '--character-tint',
      '--character-glow',
    ].forEach((name) => root.style.removeProperty(name));
    return;
  }
  tokens.forEach(([name, value]) => root.style.setProperty(name, value));
}

export const CharacterThemeProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [themeId, setThemeIdState] = useState<CharacterThemeId | null>(() =>
    typeof window === 'undefined' ? DEFAULT_CHARACTER_THEME : readStoredThemeId(),
  );

  const theme = useMemo(() => findCharacterTheme(themeId), [themeId]);

  // 主题是按「亮/暗」两套色板存放的，运行时再挑当前那一套；
  // 因此主题切换与明暗切换都要重算一次。
  useEffect(() => {
    const root = document.documentElement;
    if (themeId) {
      root.dataset.character = themeId;
    } else {
      delete root.dataset.character;
    }
    const sync = () => {
      const isDark = root.classList.contains('dark');
      applyPalette(theme ? (isDark ? theme.dark : theme.light) : null);
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, [themeId, theme]);

  const setThemeId = useCallback((id: CharacterThemeId | null) => {
    const next = findCharacterTheme(id)?.id ?? null;
    setThemeIdState(next);
    try {
      if (next) {
        window.localStorage.setItem(STORAGE_KEY, next);
      } else {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      // 隐私模式下只影响持久化，不影响当前会话。
    }
    // 同步给后端文件，桌面端下次开机能画出对应立绘。
    persistCharacterTheme(next);
  }, []);

  const value = useMemo<CharacterThemeContextValue>(
    () => ({ themeId, theme, setThemeId }),
    [themeId, theme, setThemeId],
  );

  return <CharacterThemeContext.Provider value={value}>{children}</CharacterThemeContext.Provider>;
};

export function useCharacterTheme(): CharacterThemeContextValue {
  return useContext(CharacterThemeContext);
}

/** 全部可选主题，供设置页渲染。 */
export const CHARACTER_THEME_CHOICES = CHARACTER_THEMES;
