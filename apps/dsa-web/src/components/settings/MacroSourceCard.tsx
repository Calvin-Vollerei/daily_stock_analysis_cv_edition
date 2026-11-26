import type React from 'react';
import { useCallback, useState } from 'react';
import { useUiLanguage } from '../../contexts/UiLanguageContext';
import { Button, Input } from '../common';
import { SettingsSectionCard } from './SettingsSectionCard';
import {
  DEFAULT_MACRO_SOURCE_URL,
  normalizeMacroSourceUrl,
  notifyMacroSourceChanged,
  persistMacroSourceUrl,
  readMacroSourceUrl,
} from '../../utils/macroSource';

/**
 * 「A股宏观」数据源设置。
 *
 * 只影响前端内嵌页的地址，不参与分析、抓取或落库；
 * 地址仅保存在本机浏览器，与账户凭据无关。
 */
export const MacroSourceCard: React.FC = () => {
  const { t } = useUiLanguage();
  const [current, setCurrent] = useState(() => readMacroSourceUrl());
  const [draft, setDraft] = useState(current);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const handleSave = useCallback(() => {
    const normalized = normalizeMacroSourceUrl(draft);
    if (!normalized) {
      setError(t('macroSource.invalid'));
      setSaved(false);
      return;
    }
    const next = persistMacroSourceUrl(normalized);
    setCurrent(next);
    setDraft(next);
    setError(null);
    setSaved(true);
    notifyMacroSourceChanged();
  }, [draft, t]);

  const handleReset = useCallback(() => {
    const next = persistMacroSourceUrl(DEFAULT_MACRO_SOURCE_URL);
    setCurrent(next);
    setDraft(next);
    setError(null);
    setSaved(true);
    notifyMacroSourceChanged();
  }, []);

  return (
    <SettingsSectionCard
      title={t('macroSource.title')}
      description={t('macroSource.description')}
    >
      <div className="space-y-3">
        <Input
          id="macro-source-url"
          label={t('macroSource.urlLabel')}
          hint={t('macroSource.urlHint')}
          placeholder={DEFAULT_MACRO_SOURCE_URL}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setSaved(false);
            setError(null);
          }}
          autoComplete="off"
          spellCheck={false}
        />

        {error ? (
          <p className="text-xs text-danger">{error}</p>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="primary" onClick={handleSave}>
            {t('macroSource.save')}
          </Button>
          <button
            type="button"
            onClick={handleReset}
            className="rounded-lg border border-border/70 bg-background/60 px-3 py-1.5 text-sm font-medium text-secondary-text transition-colors hover:text-foreground"
          >
            {t('macroSource.reset')}
          </button>
          {saved ? <span className="text-xs text-muted-text">{t('macroSource.saved')}</span> : null}
        </div>

        <p className="text-xs text-muted-text">
          {t('macroSource.current')}
          <code className="ml-1 break-all font-mono">{current}</code>
        </p>
      </div>
    </SettingsSectionCard>
  );
};
