/**
 * A 股宏观页的数据源地址。
 *
 * 地址不写死在组件里：默认值集中在这里，用户可以在设置页改成任意可嵌入的站点。
 * 偏好保存在浏览器本地，不上传服务端。
 */

export const MACRO_SOURCE_STORAGE_KEY = 'dsa.macroSourceUrl';

/** 默认数据源：汇金/证金持仓追踪 */
export const DEFAULT_MACRO_SOURCE_URL = 'https://wangwang-etf.com/';

/** 设置变更后广播，宏观页据此实时切换，无需刷新整页 */
export const MACRO_SOURCE_CHANGED_EVENT = 'dsa:macro-source-changed';

/**
 * 只接受 http/https 绝对地址，并强制补全末尾斜杠。
 * 返回 null 表示不是可用地址。
 */
export function normalizeMacroSourceUrl(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  // URL 构造器已把裸域名补成带尾斜杠的形式；带路径的地址保持原样。
  return parsed.toString();
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function safeStorage(storage?: StorageLike | null): StorageLike | null {
  if (storage) return storage;
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** 读取已保存的地址；未设置或非法时回落到默认值 */
export function readMacroSourceUrl(storage?: StorageLike | null): string {
  const store = safeStorage(storage);
  if (!store) return DEFAULT_MACRO_SOURCE_URL;
  try {
    const normalized = normalizeMacroSourceUrl(store.getItem(MACRO_SOURCE_STORAGE_KEY));
    return normalized ?? DEFAULT_MACRO_SOURCE_URL;
  } catch {
    return DEFAULT_MACRO_SOURCE_URL;
  }
}

/** 保存地址；传入空值或非法值等价于恢复默认 */
export function persistMacroSourceUrl(raw: string | null | undefined, storage?: StorageLike | null): string {
  const store = safeStorage(storage);
  const normalized = normalizeMacroSourceUrl(raw);
  if (!store) return normalized ?? DEFAULT_MACRO_SOURCE_URL;
  try {
    if (normalized) {
      store.setItem(MACRO_SOURCE_STORAGE_KEY, normalized);
    } else {
      store.removeItem(MACRO_SOURCE_STORAGE_KEY);
    }
  } catch {
    // 隐私模式下写入失败时忽略，本轮会话仍以返回值生效
  }
  return normalized ?? DEFAULT_MACRO_SOURCE_URL;
}

/** 通知其他已挂载的页面（如宏观页）地址已变化 */
export function notifyMacroSourceChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(MACRO_SOURCE_CHANGED_EVENT));
}
