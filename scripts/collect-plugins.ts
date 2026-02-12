import { writeFileSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { pathToFileURL } from 'url';
import { octokit, getTextFile, listDir, type GitRef } from './lib/github.js';

export interface MFE {
  id: string;
  name: string;
  description: string | null;
  repository: string;
  owner: string;
  topics: string[];
  pluginSlotsCount?: number;
}

export interface PluginSlot {
  id: string;
  mfeId: string;
  mfeName: string;
  filePath: string;
  description: string;
  readmeContent?: string;
  sourceUrl: string;
  lastUpdated: string;
  readmePresent: boolean;
  hasExamples: boolean;
}

export interface PluginsData {
  lastUpdated: string;
  mfes: MFE[];
  pluginSlots: PluginSlot[];
}

export async function collectPlugins(opts?: {
  refForRepo?: (repoName: string) => Promise<string | null>;
  outputPath?: string;
  devLimit?: number;
}): Promise<PluginsData> {
  const outputPath = opts?.outputPath ?? 'data/plugin-slots.json';
  const limit = opts?.devLimit;

  if (limit) {
    console.log(`[DEV MODE] Collecting first ${limit} MFEs only...`);
  } else {
    console.log('[START] Starting plugin data collection...');
  }

  const mfes: MFE[] = [];
  const pluginSlots: PluginSlot[] = [];

  try {
    console.log('[FETCH] Fetching repositories from openedx organization...');

    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const repos = await octokit.rest.repos.listForOrg({
        org: 'openedx',
        type: 'public',
        per_page: 100,
        page,
        sort: 'updated',
      });

      if (repos.data.length === 0) {
        hasMore = false;
        break;
      }

      for (const repo of repos.data) {
        if (
          !repo.name.startsWith('frontend-app-') &&
          !repo.name.startsWith('frontend-component-')
        ) {
          continue;
        }

        if (limit && mfes.length >= limit) {
          break;
        }

        let ref: string | undefined;
        if (opts?.refForRepo) {
          const resolved = await opts.refForRepo(repo.name);
          if (resolved === null) {
            console.log(`  ↳ Skipping ${repo.name} (no ref found)`);
            continue;
          }
          ref = resolved;
        }

        console.log(`  ↳ Processing ${repo.name}...`);

        const mfe: MFE = {
          id: repo.name,
          name: formatName(repo.name),
          description: repo.description,
          repository: repo.html_url,
          owner: repo.owner?.login || 'openedx',
          topics: repo.topics || [],
        };

        try {
          const entries = await listDir({
            owner: 'openedx',
            repo: repo.name,
            path: 'src/plugin-slots',
            ref,
          });

          if (entries) {
            console.log(
              `    ✓ Found plugin-slots directory (${entries.length} items)`
            );

            let slotCount = 0;

            for (const item of entries) {
              if (item.type === 'dir') {
                const slotData = await parsePluginSlot(
                  repo.name,
                  formatName(repo.name),
                  repo.html_url,
                  item.path,
                  ref
                );

                if (slotData) {
                  pluginSlots.push(slotData);
                  slotCount++;
                }
              }
            }

            if (slotCount > 0) {
              mfe.pluginSlotsCount = slotCount;
              mfes.push(mfe);
              console.log(`    ✓ Extracted ${slotCount} plugin slots`);
            }
          }
        } catch (err) {
          console.log(`    !! plugin-slots directory missing. Skipping repo.`);
        }
      }

      if (limit && mfes.length >= limit) {
        break;
      }

      page++;
    }

    const output: PluginsData = {
      lastUpdated: new Date().toISOString(),
      mfes,
      pluginSlots,
    };

    mkdirSync(dirname(outputPath), { recursive: true });

    writeFileSync(outputPath, JSON.stringify(output, null, 2));

    console.log('\n[SUCCESS] Collection complete!');
    console.log(`[RESULTS]:`);
    console.log(`  • MFEs with plugin slots: ${mfes.length}`);
    console.log(`  • Total plugin slots: ${pluginSlots.length}`);
    console.log(`  • Last updated: ${output.lastUpdated}`);

    return output;
  } catch (error) {
    if (error instanceof Error) {
      console.error('[ERROR] Error during collection:', error.message);
      if (error.message.includes('API rate limit')) {
        console.error('   [INFO] API rate limit exceeded. Try again in 1 hour.');
      }
    }
    process.exit(1);
  }
}

async function parsePluginSlot(
  repoName: string,
  mfeName: string,
  repoUrl: string,
  slotPath: string,
  ref?: string
): Promise<PluginSlot | null> {
  try {
    const slotId = slotPath.split('/').pop() || 'Unknown';

    let readmeText = '';
    let readmePresent = false;

    const content = await getTextFile({
      owner: 'openedx',
      repo: repoName,
      path: `${slotPath}/README.md`,
      ref,
    });

    if (content !== null) {
      readmeText = content;
      readmePresent = true;
    } else {
      readmeText = `# ${slotId}\n\nPlugin slot for ${mfeName}`;
    }

    const hasExamples = /^#+\s+examples?/im.test(readmeText);
    const treeRef = ref || 'master';

    return {
      id: slotId,
      mfeId: repoName,
      mfeName: mfeName,
      filePath: `${slotPath}/README.md`,
      description: extractDescription(readmeText),
      readmeContent: readmePresent ? readmeText : undefined,
      sourceUrl: `${repoUrl}/tree/${treeRef}/${slotPath}`,
      lastUpdated: new Date().toISOString(),
      readmePresent,
      hasExamples,
    };
  } catch (err) {
    return null;
  }
}

function formatName(repoName: string): string {
  return repoName
    .replace(/^frontend-(app|component)-/, '')
    .replace(/-/g, ' ')
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function extractDescription(content: string): string {
  const lines = content.split('\n');
  let description = '';
  let descTitleFound = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (line.startsWith('#')) {
      const heading = line.replace(/^#+\s*/, '').trim().toLowerCase();
      if (heading === 'description') {
        descTitleFound = true;
        continue;
      }
    }

    if (descTitleFound && line !== '') {
      description = line;
      break;
    }
  }

  return description.slice(0, 200);
}

const isMain = (() => {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  return import.meta.url === pathToFileURL(resolve(entry)).href;
})();

if (isMain) {
  const isTestMode = process.argv.includes('--test');
  const isDryRun = process.argv.includes('--dry-run');
  const isDevMode = process.argv.includes('--dev');

  if (!process.env.GITHUB_TOKEN && !isTestMode && !isDryRun) {
    console.warn('[WARNING] GITHUB_TOKEN environment variable not found');
    console.warn('   API calls will be rate-limited to 60/hour');
    console.warn('   Use: export GITHUB_TOKEN=your_token_here');
  }

  if (isDryRun) {
    console.log('[DRY RUN] No API calls will be made');
  } else {
    collectPlugins(isDevMode ? { devLimit: 3 } : undefined);
  }
}
