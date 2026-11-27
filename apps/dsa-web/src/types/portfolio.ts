import type { DecisionSignalItem } from './decisionSignals';

export type PortfolioCostMethod = 'fifo' | 'avg';
export type PortfolioSide = 'buy' | 'sell';
export type PortfolioCashDirection = 'in' | 'out';
export type PortfolioCorporateActionType = 'cash_dividend' | 'split_adjustment';

export interface PortfolioAccountItem {
  id: number;
  ownerId?: string | null;
  name: string;
  broker?: string | null;
  market: 'cn' | 'hk' | 'us' | 'jp' | 'kr' | 'tw';
  baseCurrency: string;
  isActive: boolean;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface PortfolioAccountListResponse {
  accounts: PortfolioAccountItem[];
}

export interface PortfolioAccountCreateRequest {
  name: string;
  broker?: string;
  market: 'cn' | 'hk' | 'us' | 'jp' | 'kr' | 'tw';
  baseCurrency: string;
  ownerId?: string;
}

export interface PortfolioPositionItem {
  symbol: string;
  market: string;
  currency: string;
  quantity: number;
  avgCost: number;
  totalCost: number;
  lastPrice: number;
  marketValueBase: number;
  unrealizedPnlBase: number;
  unrealizedPnlPct?: number | null;
  valuationCurrency: string;
  priceSource?: 'realtime_quote' | 'history_close' | 'missing' | string;
  priceProvider?: string | null;
  priceDate?: string | null;
  priceStale?: boolean;
  priceAvailable?: boolean;
  dataQuality?: 'ok' | 'partial' | string;
  limitations?: string[];
}

export interface PortfolioPositionAnalysisRequest {
  accountId?: number;
  analysisPhase?: 'auto' | 'premarket' | 'intraday' | 'postmarket';
  force?: boolean;
}

export interface PortfolioAccountSnapshot {
  accountId: number;
  accountName: string;
  ownerId?: string | null;
  broker?: string | null;
  market: string;
  baseCurrency: string;
  asOf: string;
  costMethod: PortfolioCostMethod;
  totalCash: number;
  totalMarketValue: number;
  /** Account market value converted into the parent snapshot currency. */
  totalMarketValueAggregate?: number | null;
  totalEquity: number;
  realizedPnl: number;
  unrealizedPnl: number;
  feeTotal: number;
  taxTotal: number;
  fxStale: boolean;
  dataQuality?: 'ok' | 'partial' | string;
  limitations?: string[];
  positions: PortfolioPositionItem[];
}

export interface PortfolioSnapshotResponse {
  asOf: string;
  costMethod: PortfolioCostMethod;
  currency: string;
  accountCount: number;
  totalCash: number;
  totalMarketValue: number;
  totalEquity: number;
  realizedPnl: number;
  unrealizedPnl: number;
  feeTotal: number;
  taxTotal: number;
  fxStale: boolean;
  dataQuality?: 'ok' | 'partial' | string;
  limitations?: string[];
  accounts: PortfolioAccountSnapshot[];
}

export interface PortfolioConcentrationItem {
  symbol: string;
  marketValueBase: number;
  weightPct: number;
  isAlert: boolean;
}

export interface PortfolioSectorConcentrationItem {
  sector: string;
  marketValueBase: number;
  weightPct: number;
  symbolCount: number;
  isAlert: boolean;
}

export interface PortfolioDrawdownBlock {
  seriesPoints: number;
  maxDrawdownPct: number;
  currentDrawdownPct: number;
  alert: boolean;
  fxStale: boolean;
}

export interface PortfolioStopLossItem {
  accountId: number;
  symbol: string;
  avgCost: number;
  lastPrice: number;
  lossPct: number;
  nearThresholdPct: number;
  isTriggered: boolean;
}

export interface PortfolioDecisionSignalRiskItem {
  accountId?: number | null;
  symbol: string;
  market: string;
  signal: Partial<DecisionSignalItem>;
}

export interface PortfolioDecisionSignalRiskBlock {
  available: boolean;
  total: number;
  actions: {
    sell?: number;
    reduce?: number;
    alert?: number;
    [key: string]: number | undefined;
  };
  items: PortfolioDecisionSignalRiskItem[];
}

export interface PortfolioRiskResponse {
  asOf: string;
  accountId?: number | null;
  costMethod: PortfolioCostMethod;
  currency: string;
  thresholds: Record<string, number>;
  concentration: {
    totalMarketValue: number;
    topWeightPct: number;
    alert: boolean;
    topPositions: PortfolioConcentrationItem[];
  };
  sectorConcentration: {
    totalMarketValue: number;
    topWeightPct: number;
    alert: boolean;
    topSectors: PortfolioSectorConcentrationItem[];
    coverage: Record<string, number>;
    errors: string[];
  };
  drawdown: PortfolioDrawdownBlock;
  stopLoss: {
    nearAlert: boolean;
    triggeredCount: number;
    nearCount: number;
    items: PortfolioStopLossItem[];
  };
  decisionSignalRisk?: PortfolioDecisionSignalRiskBlock;
}

/** 持仓穿透：某只个股通过哪些 ETF/基金持有，以及各自贡献的权重。 */
export interface PortfolioLookThroughViaItem {
  symbol: string;
  name?: string;
  weightPct: number;
}

export interface PortfolioLookThroughStockItem {
  code: string;
  name?: string;
  weightPct: number;
  marketValue: number;
  via?: PortfolioLookThroughViaItem[];
}

export interface PortfolioLookThroughCoverage {
  penetratedPct: number;
  unpenetratedPct: number;
  fixedIncomePct: number;
  nonEquityPct: number;
}

/**
 * 持仓穿透（理论个股头寸）响应。
 *
 * 说明：该接口由外部持仓穿透数据服务提供，开源版后端默认没有实现；
 * 前端调用方必须按「不可用」优雅降级，不得假设字段一定存在。
 */
export interface PortfolioLookThroughResponse {
  asOf?: string;
  accountId?: number | null;
  generatedAt?: string;
  stockCount: number;
  penetratedWeightPct: number;
  totalMarketValue: number;
  stocks: PortfolioLookThroughStockItem[];
  coverage: PortfolioLookThroughCoverage;
}

export interface PortfolioTradeCreateRequest {
  accountId: number;
  symbol: string;
  tradeDate: string;
  side: PortfolioSide;
  quantity: number;
  price: number;
  fee?: number;
  tax?: number;
  market?: 'cn' | 'hk' | 'us' | 'jp' | 'kr' | 'tw';
  currency?: string;
  tradeUid?: string;
  note?: string;
}

export interface PortfolioCashLedgerCreateRequest {
  accountId: number;
  eventDate: string;
  direction: PortfolioCashDirection;
  amount: number;
  currency?: string;
  note?: string;
}

export interface PortfolioCorporateActionCreateRequest {
  accountId: number;
  symbol: string;
  effectiveDate: string;
  actionType: PortfolioCorporateActionType;
  market?: 'cn' | 'hk' | 'us' | 'jp' | 'kr' | 'tw';
  currency?: string;
  cashDividendPerShare?: number;
  splitRatio?: number;
  note?: string;
}

export interface PortfolioEventCreatedResponse {
  id: number;
}

export interface PortfolioDeleteResponse {
  deleted: number;
}

export interface PortfolioTradeListItem {
  id: number;
  accountId: number;
  tradeUid?: string | null;
  symbol: string;
  market: string;
  currency: string;
  tradeDate: string;
  side: PortfolioSide;
  quantity: number;
  price: number;
  fee: number;
  tax: number;
  note?: string | null;
  createdAt?: string | null;
}

export interface PortfolioTradeListResponse {
  items: PortfolioTradeListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PortfolioCashLedgerListItem {
  id: number;
  accountId: number;
  eventDate: string;
  direction: PortfolioCashDirection;
  amount: number;
  currency: string;
  note?: string | null;
  createdAt?: string | null;
}

export interface PortfolioCashLedgerListResponse {
  items: PortfolioCashLedgerListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PortfolioCorporateActionListItem {
  id: number;
  accountId: number;
  symbol: string;
  market: string;
  currency: string;
  effectiveDate: string;
  actionType: PortfolioCorporateActionType;
  cashDividendPerShare?: number | null;
  splitRatio?: number | null;
  note?: string | null;
  createdAt?: string | null;
}

export interface PortfolioCorporateActionListResponse {
  items: PortfolioCorporateActionListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PortfolioImportTradeItem {
  tradeDate: string;
  symbol: string;
  side: PortfolioSide;
  quantity: number;
  price: number;
  fee: number;
  tax: number;
  tradeUid?: string | null;
  dedupHash: string;
  currency?: string | null;
}

export interface PortfolioImportParseResponse {
  broker: string;
  recordCount: number;
  skippedCount: number;
  errorCount: number;
  records: PortfolioImportTradeItem[];
  errors: string[];
}

export interface PortfolioImportCommitResponse {
  accountId: number;
  recordCount: number;
  insertedCount: number;
  duplicateCount: number;
  failedCount: number;
  dryRun: boolean;
  errors: string[];
}

export interface PortfolioImportBrokerItem {
  broker: string;
  aliases: string[];
  displayName?: string;
}

export interface PortfolioAiGuideResponse {
  available: boolean;
  path?: string | null;
  filename: string;
  message?: string | null;
}

export interface PortfolioImportBrokerListResponse {
  brokers: PortfolioImportBrokerItem[];
}

export interface PortfolioFxRefreshResponse {
  asOf: string;
  accountCount: number;
  refreshEnabled?: boolean;
  disabledReason?: string | null;
  pairCount: number;
  updatedCount: number;
  staleCount: number;
  errorCount: number;
}
