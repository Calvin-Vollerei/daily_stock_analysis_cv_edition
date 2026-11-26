import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { useUiLanguage } from '../contexts/UiLanguageContext';

/**
 * A 股宏观页：以内嵌方式展示外部追踪站点。
 *
 * 设计取舍：
 * - 使用 iframe 直接加载原始站点，保留其鸣谢、免责声明与版权信息，
 *   本站不搬运、不二次加工第三方数据。
 * - 该站点未设置 X-Frame-Options / CSP frame-ancestors，可直接嵌入；
 *   若对方日后收紧，页面会给出「在新窗口打开」的兜底入口。
 */

const MACRO_SOURCE_URL = 'https://wangwang-etf.com/';

/** 超过这个时间仍未 onLoad，就提示可能被站点限制嵌入 */
const SLOW_LOAD_HINT_MS = 15000;

const MacroPage: React.FC = () => {
  const { t } = useUiLanguage();
  const [reloadToken, setReloadToken] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), SLOW_LOAD_HINT_MS);
    return () => window.clearTimeout(timer);
  }, [reloadToken]);

  const handleReload = useCallback(() => {
    setLoaded(false);
    setSlow(false);
    setReloadToken((token) => token + 1);
  }, []);

  const handleOpenExternal = useCallback(() => {
    window.open(MACRO_SOURCE_URL, '_blank', 'noopener,noreferrer');
  }, []);

  return (
    <div className="flex h-[calc(100dvh-6rem)] min-h-[520px] flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-border/70 bg-card/60 px-4 py-3">
        <div className="min-w-0">
          <h1 className="text-base font-semibold text-foreground">{t('macro.title')}</h1>
          <p className="mt-1 text-xs leading-5 text-muted-text">{t('macro.description')}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={handleReload}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 bg-background/60 px-3 py-1.5 text-xs font-medium text-secondary-text transition-colors hover:text-foreground"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {t('macro.reload')}
          </button>
          <button
            type="button"
            onClick={handleOpenExternal}
            className="inline-flex items-center gap-1.5 rounded-lg border border-cyan/50 bg-cyan/10 px-3 py-1.5 text-xs font-medium text-cyan transition-colors hover:bg-cyan/15"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            {t('macro.openExternal')}
          </button>
        </div>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden rounded-2xl border border-border/70 bg-card/40">
        {!loaded ? (
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-3 px-4 py-3">
            <span className="rounded-full border border-border/70 bg-background/85 px-3 py-1 text-xs text-muted-text backdrop-blur-sm">
              {t('macro.loading')}
            </span>
            {slow ? (
              <button
                type="button"
                onClick={handleOpenExternal}
                className="pointer-events-auto rounded-full border border-warning/50 bg-warning/10 px-3 py-1 text-xs font-medium text-warning backdrop-blur-sm"
              >
                {t('macro.slowHint')}
              </button>
            ) : null}
          </div>
        ) : null}

        <iframe
          key={reloadToken}
          title={t('macro.title')}
          src={MACRO_SOURCE_URL}
          onLoad={() => setLoaded(true)}
          className="h-full w-full border-0 bg-background"
          referrerPolicy="no-referrer-when-downgrade"
          allow="clipboard-write"
        />
      </div>

      <p className="shrink-0 text-[11px] leading-4 text-muted-text">{t('macro.sourceNote')}</p>
    </div>
  );
};

export default MacroPage;
