import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, EmptyState, Tooltip } from '../common';
import { portfolioApi } from '../../api/portfolio';
import { useUiLanguage } from '../../contexts/UiLanguageContext';
import { formatUiText } from '../../i18n/uiText';
import { LOOKTHROUGH_TEXT } from '../../locales/featureText';

const BAR_COLORS = [
  '#38bdf8', '#22d3ee', '#2dd4bf', '#34d399', '#a3e635',
  '#facc15', '#fb923c', '#f87171', '#f472b6', '#c084fc',
];

const BUCKET_COLORS = {
  penetrated: '#38bdf8',
  unpenetrated: 'rgba(148,163,184,0.55)',
  fixedIncome: 'rgba(56,189,248,0.28)',
  nonEquity: 'rgba(148,163,184,0.28)',
};

/** 展示前 N 只股票，其余合并为「其他个股」。 */
const TOP_N = 12;
/** 用户点「不再显示」后写本地，下次进入持仓页不再请求该接口。 */
const HIDDEN_STORAGE_KEY = 'dsa.portfolio.lookthroughHidden';

type ViaItem = { symbol: string; weightPct: number };

type LookthroughStock = {
  code: string;
  name: string;
  weightPct: number;
  via: ViaItem[];
};

type LookthroughData = {
  stockCount: number;
  penetratedWeightPct: number;
  totalMarketValue: number;
  generatedAt: string;
  stocks: LookthroughStock[];
  coverage: {
    penetratedPct: number;
    unpenetratedPct: number;
    fixedIncomePct: number;
    nonEquityPct: number;
  };
};

type ChartRow = {
  key: string;
  label: string;
  sub: string;
  weightPct: number;
  via: ViaItem[];
};

type RequestResult = {
  key: number | 'all';
  status: 'ready' | 'empty' | 'unavailable';
  data: LookthroughData | null;
};

type Props = {
  accountId?: number | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return value;
}

function clampPct(value: number): number {
  if (value <= 0) return 0;
  if (value >= 100) return 100;
  return value;
}

function normalizeVia(raw: unknown): ViaItem[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const items: ViaItem[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const symbol = typeof entry.symbol === 'string' ? entry.symbol.trim() : '';
    const weightPct = toFiniteNumber(entry.weightPct);
    if (!symbol || weightPct === null) continue;
    items.push({ symbol, weightPct });
  }
  return items;
}

/**
 * 把接口响应收敛成可安全渲染的结构。
 * 字段缺失 / 类型不符时返回 null，调用方按「接口不可用」降级。
 */
function normalizeLookthrough(raw: unknown): LookthroughData | null {
  if (!isRecord(raw)) {
    return null;
  }
  const stockCount = toFiniteNumber(raw.stockCount);
  const penetratedWeightPct = toFiniteNumber(raw.penetratedWeightPct);
  const totalMarketValue = toFiniteNumber(raw.totalMarketValue);
  if (stockCount === null || penetratedWeightPct === null || totalMarketValue === null) {
    return null;
  }
  if (!Array.isArray(raw.stocks) || !isRecord(raw.coverage)) {
    return null;
  }
  const penetratedPct = toFiniteNumber(raw.coverage.penetratedPct);
  const unpenetratedPct = toFiniteNumber(raw.coverage.unpenetratedPct);
  const fixedIncomePct = toFiniteNumber(raw.coverage.fixedIncomePct);
  const nonEquityPct = toFiniteNumber(raw.coverage.nonEquityPct);
  if (penetratedPct === null || unpenetratedPct === null || fixedIncomePct === null || nonEquityPct === null) {
    return null;
  }

  const stocks: LookthroughStock[] = [];
  for (const entry of raw.stocks) {
    if (!isRecord(entry)) continue;
    const code = typeof entry.code === 'string' ? entry.code.trim() : '';
    const name = typeof entry.name === 'string' ? entry.name.trim() : '';
    const weightPct = toFiniteNumber(entry.weightPct);
    if (!code && !name) continue;
    if (weightPct === null) continue;
    stocks.push({
      code,
      name: name || code,
      weightPct,
      via: normalizeVia(entry.via),
    });
  }

  return {
    stockCount,
    penetratedWeightPct,
    totalMarketValue,
    generatedAt: typeof raw.generatedAt === 'string' ? raw.generatedAt : '',
    stocks,
    coverage: {
      penetratedPct: clampPct(penetratedPct),
      unpenetratedPct: clampPct(unpenetratedPct),
      fixedIncomePct: clampPct(fixedIncomePct),
      nonEquityPct: clampPct(nonEquityPct),
    },
  };
}

function readHiddenFlag(): boolean {
  try {
    return window.localStorage.getItem(HIDDEN_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeHiddenFlag(): void {
  try {
    window.localStorage.setItem(HIDDEN_STORAGE_KEY, '1');
  } catch {
    // 隐私模式或配额不可用时静默降级，只在本次会话隐藏。
  }
}

/**
 * 持仓穿透卡片：展示 ETF / 场外基金折算后的「理论个股头寸」。
 *
 * 数据接口（/api/v1/portfolio/lookthrough）由外部中间层提供，开源版通常不存在。
 * 因此 404 / 网络失败 / 字段缺失一律降级为「未启用持仓穿透」空态，不抛错、不白屏。
 */
export const LookThroughCard: React.FC<Props> = ({ accountId = null }) => {
  const { language } = useUiLanguage();
  const text = LOOKTHROUGH_TEXT[language];
  const requestKey = accountId ?? 'all';
  // 结果按请求键保存：键不匹配即视为「加载中」，避免在 effect 内同步 setState。
  const [result, setResult] = useState<RequestResult | null>(null);
  const [hidden, setHidden] = useState<boolean>(() => readHiddenFlag());

  useEffect(() => {
    if (hidden) {
      return;
    }
    let cancelled = false;
    const key = accountId ?? 'all';

    const load = async () => {
      try {
        const payload = await portfolioApi.getLookthrough(accountId ?? undefined);
        if (cancelled) return;
        const normalized = normalizeLookthrough(payload);
        if (!normalized) {
          setResult({ key, status: 'unavailable', data: null });
          return;
        }
        setResult({
          key,
          status: normalized.stocks.length > 0 ? 'ready' : 'empty',
          data: normalized,
        });
      } catch {
        if (!cancelled) {
          setResult({ key, status: 'unavailable', data: null });
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [accountId, hidden]);

  const current = result && result.key === requestKey ? result : null;
  const status: 'loading' | 'ready' | 'empty' | 'unavailable' = current ? current.status : 'loading';
  const data = current?.data ?? null;

  const handleDismiss = useCallback(() => {
    setHidden(true);
    writeHiddenFlag();
  }, []);

  const chartRows = useMemo<ChartRow[]>(() => {
    if (!data) {
      return [];
    }
    const top = data.stocks.slice(0, TOP_N);
    const rest = data.stocks.slice(TOP_N);
    const rows: ChartRow[] = top.map((item) => ({
      key: item.code || item.name,
      label: item.name || item.code,
      sub: item.name && item.code ? item.code : '',
      weightPct: item.weightPct,
      via: item.via,
    }));
    if (rest.length > 0) {
      rows.push({
        key: '__rest__',
        label: formatUiText(text.restStocks, { count: rest.length }),
        sub: '',
        weightPct: rest.reduce((sum, item) => sum + item.weightPct, 0),
        via: [],
      });
    }
    return rows;
  }, [data, text]);

  const maxWeight = useMemo(
    () => chartRows.reduce((max, row) => Math.max(max, row.weightPct), 0) || 1,
    [chartRows],
  );

  const coverageSegments = useMemo(() => {
    if (!data) {
      return [];
    }
    return [
      { key: 'penetrated', label: text.penetrated, pct: data.coverage.penetratedPct, color: BUCKET_COLORS.penetrated },
      { key: 'unpenetrated', label: text.unpenetrated, pct: data.coverage.unpenetratedPct, color: BUCKET_COLORS.unpenetrated },
      { key: 'fixedIncome', label: text.fixedIncome, pct: data.coverage.fixedIncomePct, color: BUCKET_COLORS.fixedIncome },
      { key: 'nonEquity', label: text.nonEquity, pct: data.coverage.nonEquityPct, color: BUCKET_COLORS.nonEquity },
    ];
  }, [data, text]);

  if (hidden) {
    return null;
  }

  return (
    <Card padding="md">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">{text.title}</h2>
        {status === 'ready' && data ? (
          <span className="text-xs text-secondary">
            {formatUiText(text.summary, {
              stocks: data.stockCount,
              pct: data.penetratedWeightPct.toFixed(2),
            })}
          </span>
        ) : null}
      </div>
      <p className="mb-3 text-xs leading-5 text-secondary">{text.description}</p>

      {status === 'loading' ? (
        <div className="py-10 text-center text-xs text-secondary">{text.loading}</div>
      ) : status === 'unavailable' ? (
        <EmptyState
          title={text.unavailableTitle}
          description={text.unavailableDescription}
          className="border-none bg-transparent px-4 py-8 shadow-none"
          action={(
            <button type="button" className="btn-secondary text-xs" onClick={handleDismiss}>
              {text.dismiss}
            </button>
          )}
        />
      ) : status === 'empty' || chartRows.length === 0 ? (
        <EmptyState
          title={text.emptyTitle}
          description={text.emptyDescription}
          className="border-none bg-transparent px-4 py-8 shadow-none"
        />
      ) : (
        <>
          {/* 覆盖结构条：已穿透 / 未披露 / 固收 / 非权益 */}
          <div className="mb-4">
            <div className="flex h-3 w-full overflow-hidden rounded-full bg-white/5">
              {coverageSegments.map((segment) => (
                // 覆盖结构条是纯视觉元素，具体数值由下方图例承担，避免重复朗读
                <div
                  key={segment.key}
                  aria-hidden="true"
                  style={{ width: `${segment.pct}%`, backgroundColor: segment.color }}
                  className="h-full"
                />
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-secondary">
              {coverageSegments.map((segment) => (
                <span key={segment.key} className="inline-flex items-center gap-1.5">
                  <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: segment.color }} />
                  {segment.label}
                  <span className="tabular-nums text-foreground/70">{segment.pct.toFixed(2)}%</span>
                </span>
              ))}
            </div>
          </div>

          {/* 理论个股头寸条形图 */}
          <div className="space-y-1.5">
            {chartRows.map((row, index) => {
              const viaText =
                row.via.length > 0
                  ? row.via
                      .slice(0, 4)
                      .map((via) => `${via.symbol} ${via.weightPct.toFixed(2)}%`)
                      .join(' · ')
                  : '';
              const labelNode = (
                <span className="truncate text-foreground">
                  {row.label}
                  {row.sub ? <span className="ml-1 text-[10px] text-muted-text">{row.sub}</span> : null}
                </span>
              );
              return (
              <div
                key={row.key}
                className="group grid grid-cols-[1.5rem_minmax(5rem,10rem)_1fr_4rem] items-center gap-2 text-xs"
              >
                <span className="text-right tabular-nums text-muted-text">{index + 1}</span>
                {viaText ? (
                  <Tooltip content={viaText} side="top" className="min-w-0">
                    <span className="block truncate text-foreground">{labelNode.props.children}</span>
                  </Tooltip>
                ) : (
                  labelNode
                )}
                <span className="h-2 w-full rounded-full bg-white/5">
                  <span
                    className="block h-full rounded-full transition-all"
                    style={{
                      width: `${Math.max(2, Math.min(100, (row.weightPct / maxWeight) * 100))}%`,
                      // 「其他个股」用灰条，避免和具体个股抢视觉
                      backgroundColor:
                        row.key === '__rest__'
                          ? BUCKET_COLORS.unpenetrated
                          : BAR_COLORS[index % BAR_COLORS.length],
                    }}
                  />
                </span>
                <span className="text-right tabular-nums text-secondary">{row.weightPct.toFixed(2)}%</span>
              </div>
              );
            })}
          </div>

          {data ? (
            <div className="mt-3 border-t border-white/10 pt-2 text-[11px] leading-5 text-muted-text">
              {formatUiText(text.footer, {
                total: data.totalMarketValue.toLocaleString(),
                time: data.generatedAt || '--',
              })}
            </div>
          ) : null}
        </>
      )}
    </Card>
  );
};
