import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { useUiLanguage } from '../../contexts/UiLanguageContext';
import type { UiTextKey } from '../../i18n/uiText';
import { Select } from '../common';
import { SettingsSectionCard } from './SettingsSectionCard';
import {
  BASE_FONT_SIZES,
  DEFAULT_APPEARANCE,
  FONT_IDS,
  LINE_HEIGHTS,
  applyAppearance,
  clearAppearance,
  normalizeAppearance,
  persistAppearance,
  readAppearance,
  type AppearanceFontId,
  type AppearanceSettings,
} from '../../utils/appearance';

const FONT_LABEL_KEYS: Record<AppearanceFontId, UiTextKey> = {
  system: 'appearance.font.system',
  inter: 'appearance.font.inter',
  segoe: 'appearance.font.segoe',
  'source-han': 'appearance.font.sourceHan',
  yahei: 'appearance.font.yahei',
  'noto-sans': 'appearance.font.notoSans',
};

const THEME_OPTIONS = [
  { value: 'light', labelKey: 'theme.light' },
  { value: 'dark', labelKey: 'theme.dark' },
  { value: 'system', labelKey: 'theme.system' },
] as const;

export const AppearanceSettingsCard: React.FC = () => {
  const { language, setLanguage, t } = useUiLanguage();
  const { theme, setTheme } = useTheme();
  const [appearance, setAppearance] = useState<AppearanceSettings>(() => readAppearance());
  const [resetDone, setResetDone] = useState(false);

  // 挂载时把已保存的外观写回根节点，避免直接访问非设置页时丢掉偏好
  useEffect(() => {
    applyAppearance(appearance);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const update = useCallback((patch: Partial<AppearanceSettings>) => {
    setAppearance((prev) => {
      const next = normalizeAppearance({ ...prev, ...patch });
      applyAppearance(next);
      persistAppearance(next);
      return next;
    });
    setResetDone(false);
  }, []);

  const handleReset = useCallback(() => {
    const next = { ...DEFAULT_APPEARANCE };
    setAppearance(next);
    applyAppearance(next);
    clearAppearance();
    setResetDone(true);
  }, []);

  const activeTheme = theme ?? 'dark';

  return (
    <SettingsSectionCard
      title={t('appearance.title')}
      description={t('appearance.description')}
    >
      <div className="space-y-5">
        <div className="grid gap-5 md:grid-cols-2">
          <div className="space-y-2">
            <label
              htmlFor="appearance-language"
              className="block text-sm font-medium text-foreground"
            >
              {t('appearance.language')}
            </label>
            <Select
              id="appearance-language"
              value={language}
              onChange={(value) => setLanguage(value as 'zh' | 'en')}
              options={[
                { value: 'zh', label: t('language.current') },
                { value: 'en', label: t('language.english') },
              ]}
            />
            <p className="text-xs text-muted-text">{t('appearance.languageHint')}</p>
          </div>

          <div className="space-y-2">
            <span className="block text-sm font-medium text-foreground">
              {t('theme.theme')}
            </span>
            <div className="flex flex-wrap gap-2">
              {THEME_OPTIONS.map((option) => {
                const isActive = activeTheme === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={isActive}
                    onClick={() => setTheme(option.value)}
                    className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                      isActive
                        ? 'border-cyan/60 bg-cyan/10 text-cyan'
                        : 'border-border/70 bg-background/60 text-secondary-text hover:text-foreground'
                    }`}
                  >
                    {t(option.labelKey)}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-text">{t('appearance.themeHint')}</p>
          </div>
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          <div className="space-y-2">
            <label
              htmlFor="appearance-font"
              className="block text-sm font-medium text-foreground"
            >
              {t('appearance.interfaceFont')}
            </label>
            <Select
              id="appearance-font"
              value={appearance.fontId}
              onChange={(value) => update({ fontId: value as AppearanceFontId })}
              options={FONT_IDS.map((id) => ({ value: id, label: t(FONT_LABEL_KEYS[id]) }))}
            />
            <p className="text-xs text-muted-text">{t('appearance.interfaceFontHint')}</p>
          </div>

          <div className="space-y-2">
            <label
              htmlFor="appearance-font-size"
              className="block text-sm font-medium text-foreground"
            >
              {t('appearance.baseFontSize')}
            </label>
            <Select
              id="appearance-font-size"
              value={String(appearance.baseFontSize)}
              onChange={(value) => update({ baseFontSize: Number(value) })}
              options={BASE_FONT_SIZES.map((size) => ({
                value: String(size),
                label: `${size}px${size === DEFAULT_APPEARANCE.baseFontSize ? t('appearance.defaultSuffix') : ''}`,
              }))}
            />
            <p className="text-xs text-muted-text">{t('appearance.baseFontSizeHint')}</p>
          </div>
        </div>

        <div className="space-y-2 md:max-w-sm">
          <label
            htmlFor="appearance-line-height"
            className="block text-sm font-medium text-foreground"
          >
            {t('appearance.lineHeight')}
          </label>
          <Select
            id="appearance-line-height"
            value={String(appearance.lineHeight)}
            onChange={(value) => update({ lineHeight: Number(value) })}
            options={LINE_HEIGHTS.map((value) => ({
              value: String(value),
              label: String(value),
            }))}
          />
          <p className="text-xs text-muted-text">{t('appearance.lineHeightHint')}</p>
        </div>

        <div
          data-testid="appearance-preview"
          className="rounded-xl border border-border/70 bg-background/60 px-5 py-4"
          style={{
            fontFamily: 'var(--app-font-family)',
            fontSize: 'calc(var(--app-base-font-size) * 0.95)',
            lineHeight: 'var(--app-line-height)',
          }}
        >
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-text">
            {t('appearance.preview')}
          </p>
          <p className="mt-2 font-medium text-foreground">{t('appearance.previewZh')}</p>
          <p className="mt-1 text-secondary-text">{t('appearance.previewEn')}</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleReset}
            className="rounded-lg border border-border/70 bg-background/60 px-3 py-1.5 text-sm font-medium text-secondary-text transition-colors hover:text-foreground"
          >
            {t('appearance.reset')}
          </button>
          <span className="text-xs text-muted-text">
            {resetDone ? t('appearance.resetDone') : t('appearance.storedLocally')}
          </span>
        </div>
      </div>
    </SettingsSectionCard>
  );
};
