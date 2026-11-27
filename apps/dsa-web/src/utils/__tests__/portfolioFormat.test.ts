import { describe, expect, it } from 'vitest';
import {
  assessPositionPrice,
  buildFxRefreshFeedback,
  formatBrokerLabel,
  formatMoney,
  formatPositionMoney,
  formatPositionPrice,
  formatSignedPct,
  getCsvCommitVariant,
  getCsvParseVariant,
  getPositionPriceLabel,
} from '../portfolioFormat';
import type { PortfolioPositionItem } from '../../types/portfolio';

const pricedPosition: PortfolioPositionItem = {
  symbol: 'HK00700',
  market: 'hk',
  currency: 'HKD',
  quantity: 100,
  avgCost: 300,
  totalCost: 30000,
  lastPrice: 321.12345,
  marketValueBase: 32112.345,
  unrealizedPnlBase: 2112.345,
  unrealizedPnlPct: 7.04,
  valuationCurrency: 'CNY',
  priceSource: 'realtime_quote',
  priceProvider: 'longbridge',
  priceAvailable: true,
};

describe('portfolioFormat', () => {
  it('formats money and signed percentages consistently', () => {
    expect(formatMoney(1234.5, 'USD')).toBe('USD 1,234.50');
    expect(formatMoney(null)).toBe('--');
    expect(formatSignedPct(3.456)).toBe('+3.46%');
    expect(formatSignedPct(-1.2)).toBe('-1.20%');
  });

  it('formats position price fields based on price availability', () => {
    expect(formatPositionPrice(pricedPosition)).toBe('321.1234');
    expect(formatPositionMoney(123, pricedPosition)).toBe('CNY 123.00');
    expect(getPositionPriceLabel(pricedPosition)).toBe('实时价 · longbridge');

    const missingPosition = { ...pricedPosition, priceAvailable: false, priceSource: 'missing' };
    expect(formatPositionPrice(missingPosition)).toBe('--');
    expect(formatPositionMoney(123, missingPosition)).toBe('--');
    expect(getPositionPriceLabel(missingPosition)).toBe('缺价');
  });

  it('formats broker labels and CSV result variants', () => {
    expect(formatBrokerLabel('huatai')).toBe('huatai（华泰）');
    expect(formatBrokerLabel('custom', ' 自定义 ')).toBe('custom（自定义）');
    expect(getCsvParseVariant({ broker: 'huatai', recordCount: 1, skippedCount: 1, errorCount: 0, records: [], errors: [] })).toBe('warning');
    expect(getCsvCommitVariant({ accountId: 1, recordCount: 1, insertedCount: 1, duplicateCount: 0, failedCount: 0, dryRun: false, errors: [] }, false)).toBe('success');
  });

  it('builds FX refresh feedback from refresh outcomes', () => {
    expect(buildFxRefreshFeedback({
      asOf: '2026-03-19',
      accountCount: 1,
      refreshEnabled: false,
      disabledReason: 'disabled',
      pairCount: 1,
      updatedCount: 0,
      staleCount: 0,
      errorCount: 0,
    })).toMatchObject({ tone: 'neutral' });

    expect(buildFxRefreshFeedback({
      asOf: '2026-03-19',
      accountCount: 1,
      refreshEnabled: true,
      disabledReason: null,
      pairCount: 1,
      updatedCount: 1,
      staleCount: 0,
      errorCount: 0,
    })).toMatchObject({ tone: 'success' });
  });
});

describe('assessPositionPrice', () => {
  const dailyClose = (priceDate: string | null, businessDate = '2026-03-19') => (
    assessPositionPrice(
      { ...pricedPosition, priceSource: 'history_close', priceDate, priceStale: true },
      businessDate,
    )
  );

  it('treats a T-1 daily close as normal instead of stale', () => {
    // 2026-03-19 is a Thursday, so 03-18 is the previous trading day.
    expect(dailyClose('2026-03-18')).toMatchObject({
      status: 'daily_close',
      lagBusinessDays: 1,
      priceDate: '2026-03-18',
    });
  });

  it('does not count weekend days as price lag', () => {
    // Friday close read on Monday is still the previous trading day.
    expect(dailyClose('2026-03-13', '2026-03-16')).toMatchObject({
      status: 'daily_close',
      lagBusinessDays: 1,
    });
  });

  it('only reports stale once two or more trading days are behind', () => {
    expect(dailyClose('2026-03-17')).toMatchObject({ status: 'stale', lagBusinessDays: 2 });
  });

  it('trusts the backend stale flag when the price date is unusable', () => {
    expect(dailyClose(null)).toMatchObject({ status: 'stale', lagBusinessDays: null });
    expect(assessPositionPrice(
      { ...pricedPosition, priceSource: 'history_close', priceDate: 'not-a-date', priceStale: false },
      '2026-03-19',
    )).toMatchObject({ status: 'daily_close' });
  });

  it('classifies realtime quotes and missing prices separately', () => {
    expect(assessPositionPrice(pricedPosition, '2026-03-19')).toMatchObject({ status: 'realtime' });
    expect(assessPositionPrice(
      { ...pricedPosition, priceAvailable: false, priceSource: 'missing', lastPrice: 0 },
      '2026-03-19',
    )).toMatchObject({ status: 'missing' });
    // price_available 缺失时按不可用处理，不让 0 价混进「有价」。
    expect(assessPositionPrice(
      { ...pricedPosition, priceAvailable: undefined, priceSource: 'history_close', lastPrice: 0 },
      '2026-03-19',
    )).toMatchObject({ status: 'missing' });
  });

  it('labels each state in both languages and shows the as-of date', () => {
    const stale = { ...pricedPosition, priceSource: 'history_close', priceDate: '2026-03-17', priceAvailable: true };
    const daily = { ...pricedPosition, priceSource: 'history_close', priceDate: '2026-03-18', priceAvailable: true };
    expect(getPositionPriceLabel(stale, { businessDate: '2026-03-19' })).toBe('日线收盘 · 2026-03-17 · 未刷新');
    expect(getPositionPriceLabel(daily, { businessDate: '2026-03-19' })).toBe('日线收盘 · 2026-03-18');
    expect(getPositionPriceLabel(stale, { language: 'en', businessDate: '2026-03-19' })).toBe('Daily close · 2026-03-17 · Not refreshed');
    expect(getPositionPriceLabel(daily, { language: 'en', businessDate: '2026-03-19' })).toBe('Daily close · 2026-03-18');
    expect(getPositionPriceLabel(pricedPosition, { language: 'en' })).toBe('Realtime · longbridge');
    const missing = { ...pricedPosition, priceAvailable: false, priceSource: 'missing' };
    expect(getPositionPriceLabel(missing, { language: 'en' })).toBe('No price');
  });
});
