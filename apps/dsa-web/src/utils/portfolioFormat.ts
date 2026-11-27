import type {
  PortfolioCashDirection,
  PortfolioCorporateActionType,
  PortfolioFxRefreshResponse,
  PortfolioImportCommitResponse,
  PortfolioImportParseResponse,
  PortfolioPositionItem,
  PortfolioSide,
} from '../types/portfolio';
import { toDateInputValue } from './format';

export type FxRefreshFeedback = {
  tone: 'neutral' | 'success' | 'warning';
  text: string;
};

export type PortfolioAlertVariant = 'info' | 'success' | 'warning' | 'danger';

export function getTodayIso(): string {
  return toDateInputValue(new Date());
}

export function formatMoney(value: number | undefined | null, currency = 'CNY'): string {
  if (value == null || Number.isNaN(value)) return '--';
  return `${currency} ${Number(value).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatPct(value: number | undefined | null): string {
  if (value == null || Number.isNaN(value)) return '--';
  return `${value.toFixed(2)}%`;
}

export function formatSignedPct(value: number | undefined | null): string {
  if (value == null || Number.isNaN(value)) return '--';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

export function hasPositionPrice(row: PortfolioPositionItem): boolean {
  return row.priceAvailable !== false && row.priceSource !== 'missing';
}

/**
 * 价格质量三态（外加实时价，共四种来源）。
 *
 * - `realtime`     实时行情，永远可用。
 * - `daily_close`  日线收盘价且只落后一个交易日（T-1），属于收盘后/开盘前的
 *                  **正常**状态，不能报「过期」。
 * - `stale`        日线收盘价落后 ≥2 个交易日，行情确实没刷新。
 * - `missing`      拿不到任何价格（缺价）。
 */
export type PositionPriceStatus = 'realtime' | 'daily_close' | 'stale' | 'missing';

export type PositionPriceAssessment = {
  status: PositionPriceStatus;
  /** 行情归属日期（YYYY-MM-DD），后端 `price_date` 透传。 */
  priceDate: string | null;
  /** 相对业务日期落后几个交易日；日期不可解析时为 null。 */
  lagBusinessDays: number | null;
};

/** T-1 收盘价属于正常状态；落后 ≥2 个交易日才算真的没刷新。 */
const MAX_DAILY_CLOSE_LAG_BUSINESS_DAYS = 1;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MAX_LAG_SCAN_DAYS = 400;

/**
 * 把 `YYYY-MM-DD` 解析成 UTC 零点时间戳。
 *
 * 刻意用 UTC：后端给的是「业务日期」，不含时分秒。用本地时区解析会让
 * 东八区以外的浏览器把同一天算成前一天/后一天，从而误判过期。
 */
function parseIsoDateUtc(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  const ts = Date.UTC(year, month - 1, day);
  return Number.isNaN(ts) ? null : ts;
}

/**
 * 数两个日期之间隔了几个交易日（只跳过周末）。
 *
 * 用交易日而不是日历日，是为了避免「周五收盘 → 周一」被算成落后 3 天。
 * 法定节假日不在数据里，这里不猜测，宁可少报也不要误报。
 */
function countBusinessDays(fromMs: number, toMs: number): number {
  if (toMs <= fromMs) return 0;
  const totalDays = Math.min(Math.floor((toMs - fromMs) / MS_PER_DAY), MAX_LAG_SCAN_DAYS);
  let businessDays = 0;
  for (let offset = 1; offset <= totalDays; offset += 1) {
    const weekday = new Date(fromMs + offset * MS_PER_DAY).getUTCDay();
    if (weekday !== 0 && weekday !== 6) businessDays += 1;
  }
  return businessDays;
}

/** 有价可用：后端 `price_available` 明确为 true，且价格真实存在。 */
export function isPositionPriceUsable(row: PortfolioPositionItem): boolean {
  return row.priceAvailable === true
    && hasPositionPrice(row)
    && Number.isFinite(row.lastPrice)
    && row.lastPrice > 0;
}

/**
 * 判定单个持仓的价格状态。
 *
 * @param row          持仓行（后端 `price_source` / `price_date` / `price_stale`）
 * @param businessDate 快照的业务日期（后端 `as_of`）。优先用它而不是浏览器
 *                     当天，避免时区把 T-1 误判成过期。
 */
export function assessPositionPrice(
  row: PortfolioPositionItem,
  businessDate?: string | null,
): PositionPriceAssessment {
  if (!isPositionPriceUsable(row)) {
    return { status: 'missing', priceDate: null, lagBusinessDays: null };
  }

  const priceDate = row.priceDate ?? null;

  if (row.priceSource === 'realtime_quote') {
    return { status: 'realtime', priceDate, lagBusinessDays: 0 };
  }

  const fromMs = parseIsoDateUtc(priceDate);
  const toMs = parseIsoDateUtc(businessDate ?? getTodayIso());
  if (fromMs === null || toMs === null) {
    // 日期不可解析时不要假装精确：退回后端给的 stale 标记。
    return {
      status: row.priceStale ? 'stale' : 'daily_close',
      priceDate,
      lagBusinessDays: null,
    };
  }

  const lagBusinessDays = countBusinessDays(fromMs, toMs);
  return {
    status: lagBusinessDays <= MAX_DAILY_CLOSE_LAG_BUSINESS_DAYS ? 'daily_close' : 'stale',
    priceDate,
    lagBusinessDays,
  };
}

export function formatPositionPrice(row: PortfolioPositionItem): string {
  if (!hasPositionPrice(row)) return '--';
  return row.lastPrice.toFixed(4);
}

export function formatPositionMoney(value: number, row: PortfolioPositionItem): string {
  if (!hasPositionPrice(row)) return '--';
  return formatMoney(value, row.valuationCurrency);
}

const POSITION_PRICE_LABELS = {
  zh: {
    missing: '缺价',
    realtime: '实时价',
    dailyClose: '日线收盘',
    stale: '未刷新',
  },
  en: {
    missing: 'No price',
    realtime: 'Realtime',
    dailyClose: 'Daily close',
    stale: 'Not refreshed',
  },
} as const;

export type PositionPriceLabelOptions = {
  language?: 'zh' | 'en';
  /** 快照业务日期；用于算「落后几个交易日」。 */
  businessDate?: string | null;
};

/**
 * 持仓行下方的价格来源标签，中英双语。
 *
 * 三种状态给三种文案：缺价 / 日线收盘（T-1，正常）/ 日线收盘 + 未刷新（真的过期）。
 */
export function getPositionPriceLabel(
  row: PortfolioPositionItem,
  options: PositionPriceLabelOptions = {},
): string {
  const labels = POSITION_PRICE_LABELS[options.language === 'en' ? 'en' : 'zh'];
  const assessment = assessPositionPrice(row, options.businessDate);

  if (assessment.status === 'missing') return labels.missing;

  if (assessment.status === 'realtime') {
    return row.priceProvider ? `${labels.realtime} · ${row.priceProvider}` : labels.realtime;
  }

  const parts: string[] = [labels.dailyClose];
  if (assessment.priceDate) parts.push(assessment.priceDate);
  if (assessment.status === 'stale') parts.push(labels.stale);
  return parts.join(' · ');
}

export function formatSideLabel(value: PortfolioSide): string {
  return value === 'buy' ? '买入' : '卖出';
}

export function formatCashDirectionLabel(value: PortfolioCashDirection): string {
  return value === 'in' ? '流入' : '流出';
}

export function formatCorporateActionLabel(value: PortfolioCorporateActionType): string {
  return value === 'cash_dividend' ? '现金分红' : '拆并股调整';
}

export function formatBrokerLabel(value: string, displayName?: string): string {
  if (displayName && displayName.trim()) return `${value}（${displayName.trim()}）`;
  if (value === 'huatai') return 'huatai（华泰）';
  if (value === 'citic') return 'citic（中信）';
  if (value === 'cmb') return 'cmb（招商）';
  return value;
}

export function buildFxRefreshFeedback(data: PortfolioFxRefreshResponse): FxRefreshFeedback {
  if (data.refreshEnabled === false) {
    return {
      tone: 'neutral',
      text: '汇率在线刷新已被禁用。',
    };
  }

  if (data.pairCount === 0) {
    return {
      tone: 'neutral',
      text: '当前范围无可刷新的汇率对。',
    };
  }

  if (data.updatedCount > 0 && data.staleCount === 0 && data.errorCount === 0) {
    return {
      tone: 'success',
      text: `汇率已刷新，共更新 ${data.updatedCount} 对。`,
    };
  }

  const summary = `更新 ${data.updatedCount} 对，仍过期 ${data.staleCount} 对，失败 ${data.errorCount} 对。`;
  if (data.staleCount > 0) {
    return {
      tone: 'warning',
      text: `已尝试刷新，但仍有部分货币对使用 stale/fallback 汇率。${summary}`,
    };
  }

  return {
    tone: 'warning',
    text: `在线刷新未完全成功。${summary}`,
  };
}

export function getFxRefreshFeedbackVariant(tone: FxRefreshFeedback['tone']): PortfolioAlertVariant {
  if (tone === 'success') return 'success';
  if (tone === 'warning') return 'warning';
  return 'info';
}

export function getCsvParseVariant(result: PortfolioImportParseResponse): PortfolioAlertVariant {
  return result.errorCount > 0 || result.skippedCount > 0 ? 'warning' : 'info';
}

export function getCsvCommitVariant(result: PortfolioImportCommitResponse, isDryRun: boolean): PortfolioAlertVariant {
  if (isDryRun) return 'info';
  return result.failedCount > 0 || result.duplicateCount > 0 ? 'warning' : 'success';
}
