import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { pathToFileURL } from 'url';
import { clearCache } from './lib/github.js';
import { KNOWN_RELEASES, resolveEdxPlatformRef, resolveMfeRef, type Release } from './lib/releases.js';
import { resolvePinnedVersion, resolveLibRefFromVersion } from './lib/requirements.js';
import { collectPlugins } from './collect-plugins.js';
import { collectFilters } from './collect-filters.js';
import { collectEvents } from './collect-events.js';

interface ReleaseMeta {
  slug: string;
  name: string;
  edxPlatformRef: string;
  filtersVersion?: string;
  filtersRef?: string;
  eventsVersion?: string;
  eventsRef?: string;
  warnings: string[];
}

interface ReleaseManifestEntry {
  slug: string;
  name: string;
  edxPlatformRef: string;
  filtersRef?: string;
  eventsRef?: string;
}

interface ReleasesManifest {
  lastUpdated: string;
  releases: ReleaseManifestEntry[];
}

function loadExistingManifestEntries(path: string): ReleaseManifestEntry[] {
  if (!existsSync(path)) return [];

  try {
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<ReleasesManifest>;
    if (!Array.isArray(parsed.releases)) return [];
    return parsed.releases.filter(
      (entry): entry is ReleaseManifestEntry =>
        !!entry &&
        typeof entry === 'object' &&
        typeof entry.slug === 'string' &&
        typeof entry.name === 'string' &&
        typeof entry.edxPlatformRef === 'string'
    );
  } catch {
    return [];
  }
}

function mergeManifestEntries(
  existing: ReleaseManifestEntry[],
  updated: ReleaseManifestEntry[]
): ReleaseManifestEntry[] {
  const bySlug = new Map(existing.map((entry) => [entry.slug, entry]));
  for (const entry of updated) {
    bySlug.set(entry.slug, entry);
  }

  const knownOrder = KNOWN_RELEASES.map((release) => release.slug);
  const orderedKnown = knownOrder
    .map((slug) => bySlug.get(slug))
    .filter((entry): entry is ReleaseManifestEntry => !!entry);

  const unknown = Array.from(bySlug.values())
    .filter((entry) => !knownOrder.includes(entry.slug))
    .sort((a, b) => a.slug.localeCompare(b.slug));

  return [...orderedKnown, ...unknown];
}

async function collectForRelease(release: Release, devMode: boolean, componentCache?: Record<string, Record<string, any>>): Promise<ReleaseMeta | null> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`[RELEASE] Collecting data for ${release.name} (${release.slug})`);
  console.log('='.repeat(60));

  const warnings: string[] = [];
  const cache = componentCache || {};

  const platformRef = await resolveEdxPlatformRef(release.slug);
  if (!platformRef) {
    console.log(`  !! Could not find edx-platform branch for ${release.name}. Skipping.`);
    return null;
  }
  console.log(`  ✓ edx-platform ref: ${platformRef}`);

  const filtersPin = await resolvePinnedVersion({
    platformRef,
    packageName: 'openedx-filters',
  });
  let filtersRef: string | null = null;
  if (filtersPin?.version) {
    filtersRef = await resolveLibRefFromVersion('openedx-filters', filtersPin.version);
    if (filtersRef) {
      console.log(`  ✓ openedx-filters: ${filtersPin.version} → ref ${filtersRef}`);
    } else {
      const msg = `openedx-filters version ${filtersPin.version} found but no matching tag`;
      console.log(`  ⚠ ${msg}`);
      warnings.push(msg);
    }
  } else {
    const msg = 'openedx-filters not pinned in requirements/production.txt';
    console.log(`  ⚠ ${msg}`);
    warnings.push(msg);
  }

  const eventsPin = await resolvePinnedVersion({
    platformRef,
    packageName: 'openedx-events',
  });
  let eventsRef: string | null = null;
  if (eventsPin?.version) {
    eventsRef = await resolveLibRefFromVersion('openedx-events', eventsPin.version);
    if (eventsRef) {
      console.log(`  ✓ openedx-events: ${eventsPin.version} → ref ${eventsRef}`);
    } else {
      const msg = `openedx-events version ${eventsPin.version} found but no matching tag`;
      console.log(`  ⚠ ${msg}`);
      warnings.push(msg);
    }
  } else {
    const msg = 'openedx-events not pinned in requirements/production.txt';
    console.log(`  ⚠ ${msg}`);
    warnings.push(msg);
  }

  const outDir = `data/releases/${release.slug}`;

  console.log(`\n  → Collecting plugin slots for ${release.name}...`);
  await collectPlugins({
    refForRepo: (repoName) => resolveMfeRef(repoName, release.slug),
    outputPath: `${outDir}/plugin-slots.json`,
    componentCache: cache,
    ...(devMode ? { devLimit: 3 } : {}),
  });

  if (filtersRef) {
    console.log(`\n  → Collecting filters for ${release.name}...`);
    await collectFilters({
      ref: filtersRef,
      outputPath: `${outDir}/filters.json`,
    });
  } else {
    console.log(`\n  → Skipping filters for ${release.name} (no ref resolved)`);
  }

  if (eventsRef) {
    console.log(`\n  → Collecting events for ${release.name}...`);
    await collectEvents({
      ref: eventsRef,
      outputPath: `${outDir}/events.json`,
    });
  } else {
    console.log(`\n  → Skipping events for ${release.name} (no ref resolved)`);
  }

  const meta: ReleaseMeta = {
    slug: release.slug,
    name: release.name,
    edxPlatformRef: platformRef,
    filtersVersion: filtersPin?.version,
    filtersRef: filtersRef ?? undefined,
    eventsVersion: eventsPin?.version,
    eventsRef: eventsRef ?? undefined,
    warnings,
  };

  mkdirSync(outDir, { recursive: true });
  writeFileSync(`${outDir}/meta.json`, JSON.stringify(meta, null, 2));

  return meta;
}

async function collectReleases() {
  const isDryRun = process.argv.includes('--dry-run');
  const isDevMode = process.argv.includes('--dev');
  const releaseArg = process.argv.find((a) => a.startsWith('--release='));
  const singleRelease = releaseArg?.split('=')[1];

  if (!process.env.GITHUB_TOKEN) {
    console.warn('[WARNING] GITHUB_TOKEN environment variable not found');
    console.warn('   API calls will be rate-limited to 60/hour');
    console.warn('   Use: export GITHUB_TOKEN=your_token_here');
  }

  if (isDryRun) {
    console.log('[DRY RUN] No API calls will be made');
    return;
  }

  console.log('[START] Starting release data collection...');

  const releases = singleRelease
    ? KNOWN_RELEASES.filter((r) => r.slug === singleRelease)
    : KNOWN_RELEASES;

  if (releases.length === 0) {
    console.error(`[ERROR] Unknown release: ${singleRelease}`);
    console.error(`   Known releases: ${KNOWN_RELEASES.map((r) => r.slug).join(', ')}`);
    process.exit(1);
  }

  const manifestEntries: ReleaseManifestEntry[] = [];
  const componentCache: Record<string, Record<string, any>> = {}; // Shared across all releases

  for (const release of releases) {
    const meta = await collectForRelease(release, isDevMode, componentCache);
    if (meta) {
      manifestEntries.push({
        slug: meta.slug,
        name: meta.name,
        edxPlatformRef: meta.edxPlatformRef,
        filtersRef: meta.filtersRef,
        eventsRef: meta.eventsRef,
      });
    }
    clearCache();
  }

  const allManifestEntries = singleRelease
    ? mergeManifestEntries(
        loadExistingManifestEntries('data/releases.json'),
        manifestEntries
      )
    : manifestEntries;

  const manifest: ReleasesManifest = {
    lastUpdated: new Date().toISOString(),
    releases: allManifestEntries,
  };

  mkdirSync('data', { recursive: true });
  writeFileSync('data/releases.json', JSON.stringify(manifest, null, 2));

  console.log(`\n${'='.repeat(60)}`);
  console.log('[SUCCESS] Release collection complete!');
  console.log(`[RESULTS]:`);
  console.log(`  • Releases collected this run: ${manifestEntries.length}`);
  console.log(`  • Releases in manifest: ${allManifestEntries.length}`);
  for (const entry of allManifestEntries) {
    console.log(`    - ${entry.name}: platform=${entry.edxPlatformRef}, filters=${entry.filtersRef ?? 'N/A'}, events=${entry.eventsRef ?? 'N/A'}`);
  }
}

const isMain = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(resolve(entry)).href;
})();

if (isMain) {
  collectReleases();
}
