import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useUiLanguage } from '../../contexts/UiLanguageContext';
import type { UiTextKey } from '../../i18n/uiText';
import {
  DEFAULT_UI_APPEARANCE,
  UI_FONT_SIZE_CHOICES,
  UI_LINE_HEIGHT_CHOICES,
  applyUiAppearance,
  listLocalFontFamilies,
  loadUiAppearance,
  mergeLocalFontChoices,
  persistUiAppearance,
  type UiAppearance,
  type UiFontChoice,
  type UiLineHeight,
} from '../../utils/uiAppearance';
import { cn } from '../../utils/cn';
import { Button } from '../common';
import { SettingsSectionCard } from './SettingsSectionCard';

type ThemeOption = 'light' | 'dark' | 'system';

const THEME_OPTIONS: Array<{ value: ThemeOption; labelKey: UiTextKey; icon: typeof Sun }> = [
  { value: 'light', labelKey: 'theme.light', icon: Sun },
  { value: 'dark', labelKey: 'theme.dark', icon: Moon },
  { value: 'system', labelKey: 'theme.system', icon: Monitor },
];

const selectClassName =
  'w-full rounded-xl border settings-border bg-background/50 px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-[hsl(var(--primary)/0.6)] focus:ring-2 focus:ring-[hsl(var(--primary)/0.18)]';

function sameAppearance(a: UiAppearance, b: UiAppearance): boolean {
  return (
    a.fontFamily === b.fontFamily &&
    a.fontSize === b.fontSize &&
    a.lineHeight === b.lineHeight
  );
}

export const GeneralSettingsCard: React.FC = () => {
  const { t, language, setLanguage } = useUiLanguage();
  const { theme, setTheme } = useTheme();

  // savedAppearance = 已落盘的设置；draft = 正在编辑的草稿。
  // 字体/字号/行高是「改完点保存」的模式（语言和主题是开关，即时生效）。
  const [savedAppearance, setSavedAppearance] = useState<UiAppearance>(() => loadUiAppearance());
  const [draft, setDraft] = useState<UiAppearance>(() => loadUiAppearance());
  const [justSaved, setJustSaved] = useState(false);
  const [localFontFamilies, setLocalFontFamilies] = useState<string[]>([]);

  const dirty = !sameAppearance(draft, savedAppearance);

  // 草稿实时预览：改下拉就能立刻看到效果，但不落盘
  useEffect(() => {
    applyUiAppearance(draft);
  }, [draft]);

  // 页面离开且未保存时，回滚到已保存的值，避免「看起来变了其实没存」
  useEffect(() => {
    return () => {
      applyUiAppearance(loadUiAppearance());
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void listLocalFontFamilies().then((families) => {
      if (!cancelled) {
        setLocalFontFamilies(families);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!justSaved) {
      return undefined;
    }
    const timer = window.setTimeout(() => setJustSaved(false), 2000);
    return () => window.clearTimeout(timer);
  }, [justSaved]);

  const fontChoices = useMemo<UiFontChoice[]>(
    () => mergeLocalFontChoices(localFontFamilies),
    [localFontFamilies],
  );

  const patchDraft = useCallback((patch: Partial<UiAppearance>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setJustSaved(false);
  }, []);

  const handleSave = useCallback(() => {
    persistUiAppearance(draft);
    applyUiAppearance(draft);
    setSavedAppearance({ ...draft });
    setJustSaved(true);
  }, [draft]);

  const handleResetDraft = useCallback(() => {
    setDraft({ ...DEFAULT_UI_APPEARANCE });
    setJustSaved(false);
  }, []);

  const activeTheme = (theme as ThemeOption | undefined) ?? 'system';
  const fontLabel = (choice: UiFontChoice) => (language === 'en' ? choice.labelEn : choice.labelZh);

  return (
    <SettingsSectionCard
      title={t('settings.generalSectionTitle')}
      description={t('settings.generalSectionDescription')}
      actions={
        <div className="flex items-center gap-2">
          {justSaved ? (
            <span className="text-xs text-[hsl(var(--success,142_71%_45%))]">{t('settings.uiAppearanceSaved')}</span>
          ) : null}
          <Button
            type="button"
            variant="settings-secondary"
            size="sm"
            onClick={handleResetDraft}
            disabled={sameAppearance(draft, DEFAULT_UI_APPEARANCE)}
          >
            {t('settings.uiAppearanceReset')}
          </Button>
          <Button
            type="button"
            variant="settings-primary"
            size="sm"
            onClick={handleSave}
            disabled={!dirty}
          >
            {t('settings.uiAppearanceSave')}
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* 界面语言：开关型，即时生效 */}
        <label className="space-y-2">
          <span className="block text-sm font-medium text-foreground">{t('settings.uiLanguageLabel')}</span>
          <span className="block text-xs leading-5 text-muted-text">{t('settings.uiLanguageDescription')}</span>
          <select
            className={selectClassName}
            value={language}
            onChange={(event) => setLanguage(event.target.value === 'en' ? 'en' : 'zh')}
          >
            <option value="zh">中文</option>
            <option value="en">English</option>
          </select>
        </label>

        {/* 主题：开关型，即时生效 */}
        <div className="space-y-2">
          <span className="block text-sm font-medium text-foreground">{t('settings.uiThemeLabel')}</span>
          <span className="block text-xs leading-5 text-muted-text">{t('settings.uiThemeDescription')}</span>
          <div className="flex flex-wrap gap-2">
            {THEME_OPTIONS.map(({ value, labelKey, icon: Icon }) => {
              const active = activeTheme === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setTheme(value)}
                  aria-pressed={active}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm transition-colors',
                    active
                      ? 'border-[hsl(var(--primary)/0.5)] bg-[hsl(var(--primary)/0.12)] text-foreground'
                      : 'settings-border bg-background/40 text-secondary-text hover:bg-[var(--settings-surface-hover)]',
                  )}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  {t(labelKey)}
                </button>
              );
            })}
          </div>
        </div>

        {/* 界面字体：草稿 + 保存 */}
        <label className="space-y-2">
          <span className="block text-sm font-medium text-foreground">{t('settings.uiFontLabel')}</span>
          <span className="block text-xs leading-5 text-muted-text">{t('settings.uiFontDescription')}</span>
          <select
            className={selectClassName}
            value={draft.fontFamily}
            onChange={(event) => patchDraft({ fontFamily: event.target.value })}
          >
            {fontChoices.map((choice) => (
              <option key={choice.value || '__default__'} value={choice.value}>
                {fontLabel(choice)}
              </option>
            ))}
          </select>
          <span className="block text-[11px] leading-5 text-muted-text">
            {localFontFamilies.length > 0 ? t('settings.uiFontLocalHint') : t('settings.uiFontHint')}
          </span>
        </label>

        {/* 字号 + 行高：草稿 + 保存 */}
        <div className="space-y-4">
          <label className="block space-y-2">
            <span className="block text-sm font-medium text-foreground">{t('settings.uiFontSizeLabel')}</span>
            <span className="block text-xs leading-5 text-muted-text">{t('settings.uiFontSizeDescription')}</span>
            <select
              className={selectClassName}
              value={draft.fontSize}
              onChange={(event) => patchDraft({ fontSize: Number(event.target.value) })}
            >
              {UI_FONT_SIZE_CHOICES.map((size) => (
                <option key={size} value={size}>
                  {size}px{size === DEFAULT_UI_APPEARANCE.fontSize ? `（${t('settings.uiAppearanceDefault')}）` : ''}
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-2">
            <span className="block text-sm font-medium text-foreground">{t('settings.uiLineHeightLabel')}</span>
            <span className="block text-xs leading-5 text-muted-text">{t('settings.uiLineHeightDescription')}</span>
            <select
              className={selectClassName}
              value={draft.lineHeight}
              onChange={(event) => patchDraft({ lineHeight: event.target.value as UiLineHeight })}
            >
              {UI_LINE_HEIGHT_CHOICES.map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {language === 'en' ? choice.labelEn : choice.labelZh}（{choice.css}）
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {/* 实时预览 */}
      <div className="rounded-2xl border settings-border bg-background/40 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-text">
            {t('settings.uiAppearancePreview')}
          </p>
          {dirty ? (
            <span className="text-[11px] text-amber-500">{t('settings.uiAppearanceUnsaved')}</span>
          ) : null}
        </div>
        <p className="mt-2 text-sm text-foreground" style={{ fontFamily: 'var(--app-font-family)' }}>
          {t('settings.uiAppearanceSampleCjk')}
        </p>
        <p className="mt-1 text-xs text-muted-text" style={{ fontFamily: 'var(--app-font-family)' }}>
          {t('settings.uiAppearanceSampleLatin')}
        </p>
      </div>
    </SettingsSectionCard>
  );
};
