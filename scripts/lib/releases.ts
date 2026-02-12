import { refExists } from './github.js';

export interface Release {
  slug: string;
  name: string;
}

export const KNOWN_RELEASES: Release[] = [
  { slug: 'sumac', name: 'Sumac' },
  { slug: 'teak', name: 'Teak' },
  { slug: 'ulmo', name: 'Ulmo' },
];

const BRANCH_CANDIDATES = (slug: string) => [
  `open-release/${slug}.master`,
  `release/${slug}.master`,
  `release/${slug}`,
];

export async function resolveEdxPlatformRef(slug: string): Promise<string | null> {
  for (const candidate of BRANCH_CANDIDATES(slug)) {
    const exists = await refExists({
      owner: 'openedx',
      repo: 'edx-platform',
      ref: candidate,
    });
    if (exists) return candidate;
  }
  return null;
}

export async function resolveMfeRef(repoName: string, slug: string): Promise<string | null> {
  for (const candidate of BRANCH_CANDIDATES(slug)) {
    const exists = await refExists({
      owner: 'openedx',
      repo: repoName,
      ref: candidate,
    });
    if (exists) return candidate;
  }
  return null;
}
