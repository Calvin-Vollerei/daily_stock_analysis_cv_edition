/**
 * 持仓页的「上次刷新结果」缓存。
 *
 * 打开页面时快照要等后端取价（1~2 秒），这段时间用上一轮结果渲染，等新数据
 * 回来再替换。只缓存快照与风险两块，不含穿透（穿透卡片自己带加载态）。
 */
import type { PortfolioRiskResponse, PortfolioSnapshotResponse } from '../types/portfolio';

const CACHE_VERSION = 2;
const KEY_PREFIX = 'dsa.portfolio.view';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface PortfolioViewCacheEntry {
  savedAt: number;
  snapshot: PortfolioSnapshotResponse;
  risk: PortfolioRiskResponse | null;
}

function cacheKey(scope: string): string {
  return `${KEY_PREFIX}.${CACHE_VERSION}.${scope}`;
}

function isSnapshotLike(value: unknown): value is PortfolioSnapshotResponse {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return Array.isArray(candidate.accounts) && typeof candidate.totalEquity === 'number';
}

export function readPortfolioViewCache(scope: string): PortfolioViewCacheEntry | null {
  try {
    const raw = window.localStorage.getItem(cacheKey(scope));
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<PortfolioViewCacheEntry>;
    if (!parsed || typeof parsed.savedAt !== 'number' || !isSnapshotLike(parsed.snapshot)) {
      return null;
    }
    if (Date.now() - parsed.savedAt > MAX_AGE_MS) {
      window.localStorage.removeItem(cacheKey(scope));
      return null;
    }
    return {
      savedAt: parsed.savedAt,
      snapshot: parsed.snapshot,
      risk: (parsed.risk as PortfolioRiskResponse | null | undefined) ?? null,
    };
  } catch {
    return null;
  }
}

export function writePortfolioViewCache(
  scope: string,
  snapshot: PortfolioSnapshotResponse,
  risk: PortfolioRiskResponse | null,
): void {
  try {
    const entry: PortfolioViewCacheEntry = { savedAt: Date.now(), snapshot, risk };
    window.localStorage.setItem(cacheKey(scope), JSON.stringify(entry));
  } catch {
    // 配额或隐私模式下静默降级：只是失去「打开即有数据」的加速。
  }
}

export function clearPortfolioViewCache(): void {
  try {
    const stale: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key && key.startsWith(`${KEY_PREFIX}.`)) {
        stale.push(key);
      }
    }
    stale.forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // 同上。
  }
}

/** 把时间戳格式化成「HH:mm」，用于「显示的是 x 点的数据」提示。 */
export function formatCacheStamp(savedAt: number): string {
  const date = new Date(savedAt);
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}
