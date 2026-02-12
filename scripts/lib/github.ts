import { Octokit } from '@octokit/rest';

const token = process.env.GITHUB_TOKEN;

export const octokit = new Octokit({
  auth: token || 'test-token',
});

export type GitRef = string;

const cache = new Map<string, any>();

function cacheKey(owner: string, repo: string, path: string, ref?: string): string {
  return `${owner}/${repo}@${ref ?? 'default'}:${path}`;
}

export async function getTextFile(opts: {
  owner: string;
  repo: string;
  path: string;
  ref?: GitRef;
}): Promise<string | null> {
  const key = cacheKey(opts.owner, opts.repo, opts.path, opts.ref);
  if (cache.has(key)) return cache.get(key);

  try {
    const response = await octokit.rest.repos.getContent({
      owner: opts.owner,
      repo: opts.repo,
      path: opts.path,
      ...(opts.ref ? { ref: opts.ref } : {}),
    });

    if (
      response.data &&
      typeof response.data === 'object' &&
      !Array.isArray(response.data) &&
      'content' in response.data
    ) {
      const text = Buffer.from(
        (response.data as any).content as string,
        'base64'
      ).toString('utf-8');
      cache.set(key, text);
      return text;
    }
  } catch {
    cache.set(key, null);
  }

  return null;
}

export interface DirEntry {
  type: 'file' | 'dir';
  name: string;
  path: string;
}

export async function listDir(opts: {
  owner: string;
  repo: string;
  path: string;
  ref?: GitRef;
}): Promise<DirEntry[] | null> {
  const key = cacheKey(opts.owner, opts.repo, opts.path, opts.ref) + ':dir';
  if (cache.has(key)) return cache.get(key);

  try {
    const response = await octokit.rest.repos.getContent({
      owner: opts.owner,
      repo: opts.repo,
      path: opts.path,
      ...(opts.ref ? { ref: opts.ref } : {}),
    });

    if (Array.isArray(response.data)) {
      const entries: DirEntry[] = response.data.map((item) => ({
        type: item.type as 'file' | 'dir',
        name: item.name,
        path: item.path,
      }));
      cache.set(key, entries);
      return entries;
    }
  } catch {
    cache.set(key, null);
  }

  return null;
}

export async function refExists(opts: {
  owner: string;
  repo: string;
  ref: GitRef;
}): Promise<boolean> {
  const key = `refExists:${opts.owner}/${opts.repo}@${opts.ref}`;
  if (cache.has(key)) return cache.get(key);

  try {
    await octokit.rest.repos.getBranch({
      owner: opts.owner,
      repo: opts.repo,
      branch: opts.ref,
    });
    cache.set(key, true);
    return true;
  } catch {
    // Not a branch, try as a tag
  }

  try {
    await octokit.rest.git.getRef({
      owner: opts.owner,
      repo: opts.repo,
      ref: `tags/${opts.ref}`,
    });
    cache.set(key, true);
    return true;
  } catch {
    cache.set(key, false);
    return false;
  }
}

export function clearCache() {
  cache.clear();
}
