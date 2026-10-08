// GitHub Contents / Trees API 客戶端，含 ETag 與 sha 快取。
import { getCache, setCache, pruneCache } from './store.js';

const API = 'https://api.github.com';
const TREE_TTL_MS = 60 * 1000;

export class GitHubError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.name = 'GitHubError';
    this.status = status;
    Object.assign(this, extra);
  }
}

function describeError(status, body, headers) {
  const remaining = headers && headers.get('x-ratelimit-remaining');
  if (status === 401) return 'Token 無效或已過期，請到「設定」重新填入。';
  if (status === 403 && remaining === '0') {
    const reset = headers.get('x-ratelimit-reset');
    const when = reset ? new Date(Number(reset) * 1000).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' }) : '稍後';
    return `已達 GitHub API 速率上限，${when} 後恢復；設定 Token 可提高上限。`;
  }
  if (status === 403) return 'GitHub 拒絕存取：Token 權限不足（需要 Contents 讀取權限）。';
  if (status === 404) return '找不到 repo 或分支。私有 repo 必須填入 Token；也請確認分支名稱。';
  if (status === 0) return '無法連線到 GitHub，請檢查網路。';
  const msg = body && body.message ? `：${body.message}` : '';
  return `GitHub 回應 ${status}${msg}`;
}

export class GitHubSource {
  constructor(cfg) {
    this.cfg = cfg;
  }

  get key() {
    return `${this.cfg.owner}/${this.cfg.repo}@${this.cfg.branch}`;
  }

  get repoUrl() {
    return `https://github.com/${this.cfg.owner}/${this.cfg.repo}`;
  }

  blobUrl(path) {
    return `${this.repoUrl}/blob/${encodeURIComponent(this.cfg.branch)}/${path.split('/').map(encodeURIComponent).join('/')}`;
  }

  headers(accept, extra = {}) {
    const h = {
      Accept: accept || 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...extra,
    };
    if (this.cfg.token) h.Authorization = `Bearer ${this.cfg.token}`;
    return h;
  }

  async request(url, { accept, etag, as = 'json' } = {}) {
    let res;
    try {
      res = await fetch(url, { headers: this.headers(accept, etag ? { 'If-None-Match': etag } : {}) });
    } catch (err) {
      throw new GitHubError(0, describeError(0), { cause: err });
    }
    if (res.status === 304) return { notModified: true, headers: res.headers };
    if (!res.ok) {
      let body = null;
      try {
        body = await res.json();
      } catch {
        /* ignore */
      }
      throw new GitHubError(res.status, describeError(res.status, body, res.headers), { body });
    }
    const rate = {
      remaining: Number(res.headers.get('x-ratelimit-remaining')),
      limit: Number(res.headers.get('x-ratelimit-limit')),
    };
    let data;
    if (as === 'text') data = await res.text();
    else if (as === 'blob') data = await res.blob();
    else data = await res.json();
    return { data, etag: res.headers.get('etag'), headers: res.headers, rate };
  }

  contentsUrl(path) {
    const encoded = path.split('/').map(encodeURIComponent).join('/');
    return `${API}/repos/${this.cfg.owner}/${this.cfg.repo}/contents/${encoded}?ref=${encodeURIComponent(this.cfg.branch)}`;
  }

  /** 不連網，直接取上次快取的檔案樹（離線用）。 */
  cachedTree() {
    const cached = getCache(`tree:${this.key}`);
    return cached ? { files: cached.files, fetchedAt: cached.fetchedAt } : null;
  }

  /** 檔案樹（只保留 root 底下的 blob）。 */
  async tree({ force = false } = {}) {
    const cacheKey = `tree:${this.key}`;
    const cached = getCache(cacheKey);
    if (!force && cached && Date.now() - cached.fetchedAt < TREE_TTL_MS) {
      return { files: cached.files, fromCache: true, fetchedAt: cached.fetchedAt };
    }
    const url = `${API}/repos/${this.cfg.owner}/${this.cfg.repo}/git/trees/${encodeURIComponent(this.cfg.branch)}?recursive=1`;
    const res = await this.request(url, { etag: cached ? cached.etag : null });
    if (res.notModified && cached) {
      const fetchedAt = Date.now();
      setCache(cacheKey, { ...cached, fetchedAt });
      return { files: cached.files, fromCache: false, fetchedAt, unchanged: true };
    }
    const root = this.cfg.root ? `${this.cfg.root}/` : '';
    const files = (res.data.tree || [])
      .filter((n) => n.type === 'blob' && n.path.startsWith(root))
      .map((n) => ({ path: n.path, sha: n.sha, size: n.size || 0 }));
    const fetchedAt = Date.now();
    setCache(cacheKey, { etag: res.etag, files, fetchedAt, truncated: !!res.data.truncated });
    // 移除已不存在檔案的快取。
    const live = new Set(files.map((f) => f.path));
    pruneCache((k) => {
      const m = k.match(/:file:[^:]+:(.+)$/);
      return m && m[1].startsWith(root) && !live.has(m[1]);
    });
    return { files, fromCache: false, fetchedAt, rate: res.rate };
  }

  /** 讀取文字檔；sha 相同時直接用快取。 */
  async text(path, sha) {
    const cacheKey = `file:${this.key}:${path}`;
    const cached = getCache(cacheKey);
    if (cached && (!sha || cached.sha === sha)) return cached.text;
    const res = await this.request(this.contentsUrl(path), { accept: 'application/vnd.github.raw+json', as: 'text' });
    setCache(cacheKey, { sha: sha || null, text: res.data });
    return res.data;
  }

  /** 讀取二進位檔（PDF）。 */
  async blob(path) {
    const res = await this.request(this.contentsUrl(path), { accept: 'application/vnd.github.raw+json', as: 'blob' });
    return res.data;
  }

  /** 檔案最近一次提交時間。 */
  async lastCommit(path, sha) {
    const cacheKey = `commit:${this.key}:${path}`;
    const cached = getCache(cacheKey);
    if (cached && sha && cached.sha === sha) return cached.info;
    const url = `${API}/repos/${this.cfg.owner}/${this.cfg.repo}/commits?path=${encodeURIComponent(path)}&sha=${encodeURIComponent(this.cfg.branch)}&per_page=1`;
    const res = await this.request(url);
    const c = res.data && res.data[0];
    const info = c
      ? { date: c.commit.committer.date, message: c.commit.message.split('\n')[0], url: c.html_url }
      : null;
    if (info) setCache(cacheKey, { sha: sha || null, info });
    return info;
  }

  /** 連線測試：repo 基本資料與速率上限。 */
  async ping() {
    const res = await this.request(`${API}/repos/${this.cfg.owner}/${this.cfg.repo}`);
    return {
      fullName: res.data.full_name,
      isPrivate: !!res.data.private,
      defaultBranch: res.data.default_branch,
      rate: res.rate,
    };
  }
}
