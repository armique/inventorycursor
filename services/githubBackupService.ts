/**
 * GitHub backup: push app backup to a repo file and list/restore from commit history.
 * Uses GitHub REST API with a Personal Access Token (classic or fine-grained with repo contents read/write).
 */

const GITHUB_API = 'https://api.github.com';
const BACKUP_PATH = 'backup.json';

export interface GitHubBackupConfig {
  repo: string; // "owner/repo"
  token: string;
}

const STORAGE_KEY_REPO = 'github_backup_repo';
const STORAGE_KEY_TOKEN = 'github_backup_token';
const STORAGE_KEY_LOGIN = 'github_backup_login';

export function getStoredConfig(): GitHubBackupConfig | null {
  const repo = localStorage.getItem(STORAGE_KEY_REPO);
  const token = localStorage.getItem(STORAGE_KEY_TOKEN);
  if (!repo?.trim() || !token?.trim()) return null;
  return { repo: repo.trim(), token: token.trim() };
}

export function saveConfig(repo: string, token: string): void {
  localStorage.setItem(STORAGE_KEY_REPO, repo.trim());
  localStorage.setItem(STORAGE_KEY_TOKEN, token.trim());
}

/** Token only (e.g. from OAuth); repo may be set separately. */
export function getStoredToken(): string | null {
  return localStorage.getItem(STORAGE_KEY_TOKEN);
}

export function getStoredLogin(): string | null {
  return localStorage.getItem(STORAGE_KEY_LOGIN);
}

/** After OAuth: save token and login; repo unchanged. */
export function saveOAuthResult(accessToken: string, login: string | null): void {
  localStorage.setItem(STORAGE_KEY_TOKEN, accessToken);
  if (login != null) localStorage.setItem(STORAGE_KEY_LOGIN, login);
}

/** Clear GitHub token and login (e.g. Sign out). */
export function clearOAuth(): void {
  localStorage.removeItem(STORAGE_KEY_TOKEN);
  localStorage.removeItem(STORAGE_KEY_LOGIN);
}

/** Build GitHub OAuth authorize URL. Requires VITE_GITHUB_CLIENT_ID. */
export function getOAuthAuthorizeUrl(): string {
  const clientId = import.meta.env.VITE_GITHUB_CLIENT_ID;
  if (!clientId?.trim()) throw new Error('GitHub OAuth not configured (missing VITE_GITHUB_CLIENT_ID)');
  const redirectUri = `${typeof window !== 'undefined' ? window.location.origin : ''}/auth/github/callback`;
  const scope = 'repo';
  return `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(clientId.trim())}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}`;
}

function authHeaders(token: string): HeadersInit {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

function parseRepo(repo: string): { owner: string; repo: string } {
  const [owner, name] = repo.split('/').map((s) => s.trim()).filter(Boolean);
  if (!owner || !name) throw new Error('Repository must be "owner/repo" (e.g. myuser/inventory-backups)');
  return { owner, repo: name };
}

/** Push backup content to the repo. Creates or updates backup.json. Returns commit sha. */
export async function pushBackup(
  config: GitHubBackupConfig,
  backupPayload: object,
  message?: string
): Promise<{ sha: string; committedAt: string }> {
  const { owner, repo } = parseRepo(config.repo);
  const content = JSON.stringify(backupPayload, null, 2);
  const contentBase64 = btoa(unescape(encodeURIComponent(content)));
  const commitMessage = message || `Backup ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`;

  // Get current file to get sha if it exists (required for update)
  let sha: string | undefined;
  try {
    const getRes = await fetch(
      `${GITHUB_API}/repos/${owner}/${repo}/contents/${BACKUP_PATH}`,
      { headers: authHeaders(config.token) }
    );
    if (getRes.ok) {
      const data = await getRes.json();
      sha = data.sha;
    }
  } catch {
    // New file, no sha
  }

  const body: { message: string; content: string; sha?: string } = {
    message: commitMessage,
    content: contentBase64,
  };
  if (sha) body.sha = sha;

  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/contents/${BACKUP_PATH}`, {
    method: 'PUT',
    headers: { ...authHeaders(config.token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = (err as any).message || res.statusText;
    if (res.status === 401) throw new Error('Invalid token or expired. Check your GitHub token.');
    if (res.status === 404) throw new Error('Repo not found or no write access. Check repo name and token scope.');
    throw new Error(msg || `GitHub API error ${res.status}`);
  }

  const data = await res.json();
  return {
    sha: data.commit.sha,
    committedAt: data.commit.committer?.date || new Date().toISOString(),
  };
}

export interface BackupCommit {
  sha: string;
  message: string;
  date: string;
  author?: string;
}

/** List commits that touched backup.json (version history). */
export async function listBackupCommits(config: GitHubBackupConfig, max = 30): Promise<BackupCommit[]> {
  const { owner, repo } = parseRepo(config.repo);
  const res = await fetch(
    `${GITHUB_API}/repos/${owner}/${repo}/commits?path=${BACKUP_PATH}&per_page=${max}`,
    { headers: authHeaders(config.token) }
  );
  if (!res.ok) {
    if (res.status === 404) return [];
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).message || `Failed to list commits: ${res.status}`);
  }
  const commits = await res.json();
  return (commits || []).map((c: any) => ({
    sha: c.sha,
    message: c.commit?.message || '',
    date: c.commit?.committer?.date || c.commit?.author?.date || '',
    author: c.commit?.author?.name,
  }));
}

/** Get backup.json content at a specific commit (for rollback). */
export async function getBackupAtCommit(config: GitHubBackupConfig, commitSha: string): Promise<string> {
  const { owner, repo } = parseRepo(config.repo);
  const res = await fetch(
    `${GITHUB_API}/repos/${owner}/${repo}/contents/${BACKUP_PATH}?ref=${commitSha}`,
    { headers: authHeaders(config.token) }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).message || `Failed to get backup: ${res.status}`);
  }
  const data = await res.json();
  if (!data.content) throw new Error('No content in backup file');
  try {
    return decodeURIComponent(escape(atob((data.content as string).replace(/\s/g, ''))));
  } catch {
    throw new Error('Invalid backup file encoding');
  }
}

export interface GitHubRepoItem {
  full_name: string;
  name: string;
  private: boolean;
  html_url: string;
}

/** List repos the authenticated user can push to (owner/repo). */
export async function listUserRepos(token: string, max = 100): Promise<GitHubRepoItem[]> {
  const res = await fetch(
    `${GITHUB_API}/user/repos?sort=updated&per_page=${max}`,
    { headers: authHeaders(token) }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).message || `Failed to list repos: ${res.status}`);
  }
  const list = await res.json();
  return (list || []).map((r: any) => ({
    full_name: r.full_name,
    name: r.name,
    private: r.private === true,
    html_url: r.html_url || '',
  }));
}

/** Create a new repo under the authenticated user. Returns full_name (owner/repo). */
export async function createRepo(
  token: string,
  name: string,
  options?: { private?: boolean; description?: string }
): Promise<{ full_name: string; html_url: string }> {
  const body: { name: string; private?: boolean; description?: string; auto_init?: boolean } = {
    name: name.trim().replace(/[^\w.-]/g, '-').slice(0, 100) || 'repo',
    auto_init: true,
  };
  if (options?.private !== undefined) body.private = options.private;
  if (options?.description) body.description = options.description.slice(0, 350);
  const res = await fetch(`${GITHUB_API}/user/repos`, {
    method: 'POST',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = (err as any).message || err.errors?.[0]?.message || res.statusText;
    if (res.status === 422 && String(msg).toLowerCase().includes('exist')) throw new Error('A repo with that name already exists.');
    throw new Error(msg || `Failed to create repo: ${res.status}`);
  }
  const data = await res.json();
  return { full_name: data.full_name, html_url: data.html_url || data.clone_url || '' };
}
