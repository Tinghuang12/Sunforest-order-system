// 設定與快取（localStorage）。所有鍵都以 twsa: 開頭，避免與其他站台衝突。
const PREFIX = 'twsa:';
const SETTINGS_KEY = `${PREFIX}settings`;
const CACHE_PREFIX = `${PREFIX}cache:`;

export const DEFAULTS = Object.freeze({
  owner: 'Tinghuang12',
  repo: 'tw-stock-reports',
  branch: 'claude/stock-advisor-data',
  root: 'docs/stocks',
  token: '',
});

function safeGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function safeRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function loadSettings() {
  const raw = safeGet(SETTINGS_KEY);
  if (!raw) return { ...DEFAULTS };
  try {
    const parsed = JSON.parse(raw);
    return { ...DEFAULTS, ...parsed };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(settings) {
  const clean = {};
  for (const k of Object.keys(DEFAULTS)) clean[k] = String(settings[k] ?? DEFAULTS[k]).trim();
  clean.root = clean.root.replace(/^\/+|\/+$/g, '');
  return safeSet(SETTINGS_KEY, JSON.stringify(clean)) ? clean : null;
}

export function getCache(key) {
  const raw = safeGet(CACHE_PREFIX + key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    safeRemove(CACHE_PREFIX + key);
    return null;
  }
}

export function setCache(key, value) {
  const payload = JSON.stringify(value);
  if (safeSet(CACHE_PREFIX + key, payload)) return true;
  // 空間不足：清掉檔案快取後再試一次。
  pruneCache((k) => k.startsWith(`${CACHE_PREFIX}file:`));
  return safeSet(CACHE_PREFIX + key, payload);
}

export function removeCache(key) {
  safeRemove(CACHE_PREFIX + key);
}

export function cacheKeys() {
  const keys = [];
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k && k.startsWith(CACHE_PREFIX)) keys.push(k);
    }
  } catch {
    /* ignore */
  }
  return keys;
}

export function pruneCache(predicate) {
  for (const k of cacheKeys()) if (!predicate || predicate(k)) safeRemove(k);
}

export function clearCache() {
  pruneCache();
}

export function cacheSize() {
  let bytes = 0;
  for (const k of cacheKeys()) bytes += (safeGet(k) || '').length * 2;
  return bytes;
}
