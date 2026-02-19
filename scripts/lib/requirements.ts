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

/**
 * Resolve component versions from an MFE's package.json
 * Looks for @openedx/frontend-component-header and @openedx/frontend-component-footer
 * Also checks for @edx scoped versions for backwards compatibility
 */
export async function resolveComponentVersions(opts: {
  mfeRef: string;
  mfeRepo: string;
}): Promise<{
  headerVersion?: string;
  footerVersion?: string;
} | null> {
  const content = await getTextFile({
    owner: 'openedx',
    repo: opts.mfeRepo,
    path: 'package.json',
    ref: opts.mfeRef,
  });

  if (!content) return null;

  try {
    const packageJson = JSON.parse(content);
    const dependencies = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
      ...packageJson.peerDependencies,
    };

    // Check both @openedx and @edx scoped versions
    const headerVersion =
      dependencies['@openedx/frontend-component-header'] ||
      dependencies['@edx/frontend-component-header'];
    const footerVersion =
      dependencies['@openedx/frontend-component-footer'] ||
      dependencies['@edx/frontend-component-footer'];

    return {
      headerVersion: headerVersion ? cleanVersion(headerVersion) : undefined,
      footerVersion: footerVersion ? cleanVersion(footerVersion) : undefined,
    };
  } catch (err) {
    return null;
  }
}

/**
 * Clean version string from package.json constraints
 * E.g., "^1.2.3" -> "1.2.3", "1.2.3" -> "1.2.3"
 */
function cleanVersion(versionSpec: string): string {
  // Remove leading version operators like ^, ~, >, <, =, etc.
  const cleaned = versionSpec.replace(/^[\^~>=<\s]*/, '').trim();
  
  // Split by dots and extract major.minor.patch
  const parts = cleaned.split('.');
  const major = parts[0] || '0';
  const minor = parts[1] || '0';
  // Remove any non-numeric characters from patch version
  const patch = (parts[2] || '0').replace(/[^\d]/g, '');
  
  return `${major}.${minor}.${patch}`;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
