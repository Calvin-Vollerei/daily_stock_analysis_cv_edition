import { fireEvent, render, screen } from '@testing-library/react';
import type React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LookThroughCard } from '../LookThroughCard';
import { UiLanguageProvider } from '../../../contexts/UiLanguageContext';
import { UI_LANGUAGE_STORAGE_KEY } from '../../../utils/uiLanguage';

const { getLookthrough } = vi.hoisted(() => ({
  getLookthrough: vi.fn(),
}));

vi.mock('../../../api/portfolio', () => ({
  portfolioApi: {
    getLookthrough,
  },
}));

const payload = {
  stockCount: 2,
  penetratedWeightPct: 41.2,
  totalMarketValue: 1234567,
  generatedAt: '2026-11-26 17:40',
  stocks: [
    { code: '600519', name: '贵州茅台', weightPct: 12.5, marketValue: 250000, via: [{ symbol: '510300', weightPct: 3.2 }] },
    { code: '000001', name: '平安银行', weightPct: 8.75, marketValue: 120000, via: [] },
  ],
  coverage: { penetratedPct: 41.2, unpenetratedPct: 30.8, fixedIncomePct: 18, nonEquityPct: 10 },
};

function renderCard(ui: React.ReactElement) {
  return render(<UiLanguageProvider>{ui}</UiLanguageProvider>);
}

describe('LookThroughCard', () => {
  beforeEach(() => {
    window.localStorage.setItem(UI_LANGUAGE_STORAGE_KEY, 'zh');
    window.localStorage.removeItem('dsa.portfolio.lookthroughHidden');
    getLookthrough.mockReset();
  });

  afterEach(() => {
    window.localStorage.removeItem('dsa.portfolio.lookthroughHidden');
  });

  it('renders stock positions when the look-through endpoint is available', async () => {
    getLookthrough.mockResolvedValueOnce(payload);

    renderCard(<LookThroughCard accountId={7} />);

    await screen.findByText('贵州茅台');
    expect(getLookthrough).toHaveBeenCalledWith(7);
    expect(screen.getByText('持仓穿透（理论个股头寸）')).toBeInTheDocument();
    expect(screen.getByText(/共 2 只个股/)).toBeInTheDocument();
    expect(screen.getAllByText('已穿透').length).toBeGreaterThan(0);
    expect(screen.getByText('12.50%')).toBeInTheDocument();
  });

  it('degrades to a non-error empty state when the endpoint is missing (404)', async () => {
    getLookthrough.mockRejectedValueOnce(Object.assign(new Error('Not Found'), { response: { status: 404 } }));

    renderCard(<LookThroughCard />);

    await screen.findByText('未启用持仓穿透');
    expect(screen.getByText(/不影响其他持仓信息/)).toBeInTheDocument();
    expect(screen.queryByText('贵州茅台')).not.toBeInTheDocument();
  });

  it('degrades when the payload misses required fields', async () => {
    getLookthrough.mockResolvedValueOnce({ stocks: [], coverage: undefined });

    renderCard(<LookThroughCard />);

    await screen.findByText('未启用持仓穿透');
  });

  it('shows the empty state when nothing can be looked through', async () => {
    getLookthrough.mockResolvedValueOnce({ ...payload, stockCount: 0, stocks: [] });

    renderCard(<LookThroughCard />);

    await screen.findByText('暂无穿透数据');
    expect(screen.queryByText('未启用持仓穿透')).not.toBeInTheDocument();
  });

  it('collapses to a restore row after the user dismisses the unavailable card', async () => {
    getLookthrough.mockRejectedValueOnce(new Error('network down'));

    renderCard(<LookThroughCard />);

    const dismiss = await screen.findByText('不再显示');
    fireEvent.click(dismiss);

    // 隐藏后保留一行可恢复的入口，避免误点后再也回不到卡片。
    expect(await screen.findByText('持仓穿透卡片已隐藏')).toBeInTheDocument();
    expect(window.localStorage.getItem('dsa.portfolio.lookthroughHidden')).toBe('1');

    getLookthrough.mockResolvedValueOnce({
      stock_count: 2,
      penetrated_weight_pct: 12.5,
      total_market_value: 1000,
      generated_at: '2026-11-27 10:00',
      coverage: {
        penetrated_pct: 12.5,
        unpenetrated_pct: 87.5,
        fixed_income_pct: 0,
        non_equity_pct: 0,
      },
      stocks: [
        { code: 'NVDA', name: '英伟达', weight_pct: 1.2, via: [] },
        { code: 'AAPL', name: '苹果', weight_pct: 0.8, via: [] },
      ],
    });

    fireEvent.click(screen.getByText('恢复显示'));

    expect(await screen.findByText('持仓穿透（理论个股头寸）')).toBeInTheDocument();
    expect(window.localStorage.getItem('dsa.portfolio.lookthroughHidden')).toBeNull();
  });
});
