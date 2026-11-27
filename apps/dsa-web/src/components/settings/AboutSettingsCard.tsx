import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useUiLanguage } from '../../contexts/UiLanguageContext';
import { formatUiText } from '../../i18n/uiText';
import { ABOUT_TEXT } from '../../locales/featureText';
import { systemAboutApi, type AboutResponse, type UpdateCheckResponse } from '../../api/systemAbout';
import { Button } from '../common';
import { SettingsSectionCard } from './SettingsSectionCard';

type CheckState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'done'; result: UpdateCheckResponse };

/**
 * 「设置 → 关于」：当前版本、更新检查与作者声明。
 *
 * 版本号由桌面端注入后端，后端再通过 /api/v1/system/about 返回；更新检查问的是
 * 本发行版自己的仓库，而不是上游，因为两个渠道的版本号并不通用。
 */
export const AboutSettingsCard: React.FC = () => {
  const { language } = useUiLanguage();
  const text = ABOUT_TEXT[language];
  const [about, setAbout] = useState<AboutResponse | null>(null);
  const [state, setState] = useState<CheckState>({ kind: 'idle' });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const payload = await systemAboutApi.getAbout();
        if (!cancelled) {
          setAbout(payload);
        }
      } catch {
        if (!cancelled) {
          setAbout(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleCheck = useCallback(async () => {
    setState({ kind: 'checking' });
    try {
      const result = await systemAboutApi.checkUpdate();
      setState({ kind: 'done', result });
    } catch {
      setState({
        kind: 'done',
        result: {
          current: about?.version ?? '',
          latest: '',
          updateAvailable: false,
          repo: about?.repo ?? '',
          error: 'network',
        },
      });
    }
  }, [about]);

  const version = about?.version?.trim() || '';
  const sourceLabel = about?.versionSource === 'desktop' ? text.sourceDesktop : about?.versionSource === 'backend' ? text.sourceBackend : '';
  const done = state.kind === 'done' ? state.result : null;
  const errorReason = done?.error === 'no_release' ? text.errorNoRelease : text.errorNetwork;

  return (
    <div className="space-y-4">
      <SettingsSectionCard title={text.versionTitle} description={text.description}>
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span className="text-muted-text">{text.versionLabel}</span>
            <code className="rounded-md border settings-border bg-background/60 px-2 py-0.5 font-mono text-[13px] text-foreground">
              {version || text.versionUnknown}
            </code>
            {version && sourceLabel ? <span className="text-[11px] text-muted-text">· {sourceLabel}</span> : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="settings-secondary"
              size="sm"
              onClick={() => void handleCheck()}
              disabled={state.kind === 'checking'}
            >
              <RefreshCw className={state.kind === 'checking' ? 'mr-1.5 h-3.5 w-3.5 animate-spin' : 'mr-1.5 h-3.5 w-3.5'} />
              {state.kind === 'checking' ? text.checking : text.checkButton}
            </Button>
            {done && !done.error ? (
              <span className={done.updateAvailable ? 'text-xs font-medium text-[hsl(var(--warning))]' : 'text-xs text-muted-text'}>
                {done.updateAvailable
                  ? formatUiText(text.updateAvailable, { version: done.latest || '--' })
                  : formatUiText(text.upToDate, { version: done.current || version || '--' })}
              </span>
            ) : null}
            {done?.error ? (
              <span className="text-xs text-[hsl(var(--danger))]">{formatUiText(text.checkFailed, { reason: errorReason })}</span>
            ) : null}
            {done?.updateAvailable && done.url ? (
              <a
                className="text-xs font-medium text-[hsl(var(--primary))] hover:underline"
                href={done.url}
                target="_blank"
                rel="noreferrer"
              >
                {text.openRelease}
              </a>
            ) : null}
          </div>
        </div>
      </SettingsSectionCard>

      <SettingsSectionCard title={text.creditsTitle}>
        <dl className="space-y-3 text-sm">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <dt className="w-28 shrink-0 text-xs text-muted-text">{text.originalLabel}</dt>
            <dd className="text-foreground">
              {about?.authors?.find((item) => item.role === 'original')?.name ?? 'ZhuLinsen'}
              <span className="ml-2 text-xs text-muted-text">{text.upstreamLabel}</span>
              <a
                className="ml-1 text-xs text-[hsl(var(--primary))] hover:underline"
                href={about?.upstreamUrl || 'https://github.com/ZhuLinsen/daily_stock_analysis'}
                target="_blank"
                rel="noreferrer"
              >
                {about?.upstreamRepo || 'ZhuLinsen/daily_stock_analysis'}
              </a>
            </dd>
          </div>

          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <dt className="w-28 shrink-0 text-xs text-muted-text">{text.adapterLabel}</dt>
            <dd className="text-foreground">
              {about?.authors?.find((item) => item.role === 'adapter')?.name ?? 'Calvin Vollerei Studio'}
              <span className="ml-2 text-xs text-muted-text">{text.repoLabel}</span>
              <a
                className="ml-1 text-xs text-[hsl(var(--primary))] hover:underline"
                href={about?.repoUrl || 'https://github.com/Calvin-Vollerei/daily_stock_analysis_cv_edition'}
                target="_blank"
                rel="noreferrer"
              >
                {about?.repo || 'Calvin-Vollerei/daily_stock_analysis_cv_edition'}
              </a>
            </dd>
          </div>

          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <dt className="w-28 shrink-0 text-xs text-muted-text">{text.licenseLabel}</dt>
            <dd className="text-foreground">
              {about?.license || 'MIT'}
              <span className="ml-2 text-xs text-muted-text">{text.licenseNote}</span>
            </dd>
          </div>
        </dl>
      </SettingsSectionCard>
    </div>
  );
};
