import { getTextFile, refExists } from './github.js';

export async function resolvePinnedVersion(opts: {
  platformRef: string;
  packageName: string;
}): Promise<{ version?: string; rawSpec?: string } | null> {
  const content = await getTextFile({
    owner: 'openedx',
    repo: 'edx-platform',
    path: 'requirements/edx/base.txt',
    ref: opts.platformRef,
  });

  if (!content) return null;

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#') || trimmed === '') continue;

    // Match: package==1.2.3 or package===1.2.3
    const pinMatch = trimmed.match(
      new RegExp(`^${escapeRegex(opts.packageName)}\\s*={2,3}\\s*([^\\s;#]+)`, 'i')
    );
    if (pinMatch) {
      return { version: pinMatch[1] };
    }

    // Match: git+https://...@v1.2.3#egg=package
    const vcsMatch = trimmed.match(
      new RegExp(`git\\+https?://[^@]+@([^#]+)#egg=${escapeRegex(opts.packageName)}`, 'i')
    );
    if (vcsMatch) {
      return { version: vcsMatch[1].replace(/^v/, ''), rawSpec: trimmed };
    }

    // Match: package @ git+https://...@v1.2.3
    const pep440Match = trimmed.match(
      new RegExp(`^${escapeRegex(opts.packageName)}\\s*@\\s*git\\+https?://[^@]+@([^\\s;#]+)`, 'i')
    );
    if (pep440Match) {
      return { version: pep440Match[1].replace(/^v/, ''), rawSpec: trimmed };
    }
  }

  return null;
}

export async function resolveLibRefFromVersion(
  repo: string,
  version: string | undefined
): Promise<string | null> {
  if (!version) return null;

  for (const candidate of [`v${version}`, version]) {
    const exists = await refExists({
      owner: 'openedx',
      repo,
      ref: candidate,
    });
    if (exists) return candidate;
  }

  return null;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
