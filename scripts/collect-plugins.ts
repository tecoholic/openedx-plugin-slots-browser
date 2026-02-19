import { writeFileSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { pathToFileURL } from 'url';
import { octokit, getTextFile, listDir, type GitRef } from './lib/github.js';
import { resolveComponentVersions } from './lib/requirements.js';
import { collectComponent } from './collect-components.js';

export interface ComponentInfo {
  id: string;
  name: string;
  version: string;
  pluginSlotsCount: number;
}

export interface MFE {
  id: string;
  name: string;
  description: string | null;
  repository: string;
  owner: string;
  topics: string[];
  pluginSlotsCount?: number;
  header?: ComponentInfo;
  footer?: ComponentInfo;
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
  type?: 'mfe' | 'header' | 'footer'; // Type of slot (mfe, header, footer)
  componentVersion?: string; // Version of the component (for header/footer slots)
}

export interface ComponentSlot extends PluginSlot {
  componentId: string;
  componentVersion: string;
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
  componentCache?: Record<string, Record<string, any>>;
}): Promise<PluginsData> {
  const outputPath = opts?.outputPath ?? 'data/plugin-slots.json';
  const limit = opts?.devLimit;
  const componentCache = opts?.componentCache ?? {};

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

         // Skip component repos - they will be collected as part of MFEs
         if (
           repo.name === 'frontend-component-header' ||
           repo.name === 'frontend-component-footer'
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
         } else {
           // Use the repository's default branch for component collection when no refForRepo is provided
           ref = repo.default_branch;
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
                  slotData.type = 'mfe';
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

        // Collect component (header/footer) data if componentCache is available
        if (opts?.componentCache !== undefined && ref) {
          try {
            const componentVersions = await resolveComponentVersions({
              mfeRef: ref,
              mfeRepo: repo.name,
            });

            if (!componentVersions?.headerVersion && !componentVersions?.footerVersion) {
              console.log(
                `      ℹ No component versions found in ${repo.name}`
              );
            }

            if (componentVersions?.headerVersion) {
              const headerKey = `header:${componentVersions.headerVersion}`;
              let headerData = componentCache[headerKey];

              if (!headerData) {
                headerData = await collectComponent({
                  componentId: 'frontend-component-header',
                  componentName: 'Header',
                  ref: `v${componentVersions.headerVersion}`,
                  repository: 'https://github.com/openedx/frontend-component-header',
                  owner: 'openedx',
                });
                if (headerData) {
                  componentCache[headerKey] = headerData;
                  // Add component slots to the global pluginSlots array
                  for (const slot of headerData.pluginSlots) {
                    pluginSlots.push({
                      id: slot.id,
                      mfeId: repo.name,
                      mfeName: formatName(repo.name),
                      filePath: slot.filePath,
                      description: slot.description,
                      readmeContent: slot.readmeContent,
                      sourceUrl: slot.sourceUrl,
                      lastUpdated: slot.lastUpdated,
                      readmePresent: slot.readmePresent,
                      hasExamples: slot.hasExamples,
                      type: 'header',
                      componentVersion: componentVersions.headerVersion,
                    });
                  }
                }
              } else {
                // Use cached component data
                for (const slot of headerData.pluginSlots) {
                  pluginSlots.push({
                    id: slot.id,
                    mfeId: repo.name,
                    mfeName: formatName(repo.name),
                    filePath: slot.filePath,
                    description: slot.description,
                    readmeContent: slot.readmeContent,
                    sourceUrl: slot.sourceUrl,
                    lastUpdated: slot.lastUpdated,
                    readmePresent: slot.readmePresent,
                    hasExamples: slot.hasExamples,
                    type: 'header',
                    componentVersion: componentVersions.headerVersion,
                  });
                }
              }

              if (headerData) {
                mfe.header = {
                  id: 'frontend-component-header',
                  name: 'Header',
                  version: componentVersions.headerVersion,
                  pluginSlotsCount: headerData.pluginSlots.length,
                };
              }
            }

            if (componentVersions?.footerVersion) {
              const footerKey = `footer:${componentVersions.footerVersion}`;
              let footerData = componentCache[footerKey];

              if (!footerData) {
                footerData = await collectComponent({
                  componentId: 'frontend-component-footer',
                  componentName: 'Footer',
                  ref: `v${componentVersions.footerVersion}`,
                  repository: 'https://github.com/openedx/frontend-component-footer',
                  owner: 'openedx',
                });
                if (footerData) {
                  componentCache[footerKey] = footerData;
                  // Add component slots to the global pluginSlots array
                  for (const slot of footerData.pluginSlots) {
                    pluginSlots.push({
                      id: slot.id,
                      mfeId: repo.name,
                      mfeName: formatName(repo.name),
                      filePath: slot.filePath,
                      description: slot.description,
                      readmeContent: slot.readmeContent,
                      sourceUrl: slot.sourceUrl,
                      lastUpdated: slot.lastUpdated,
                      readmePresent: slot.readmePresent,
                      hasExamples: slot.hasExamples,
                      type: 'footer',
                      componentVersion: componentVersions.footerVersion,
                    });
                  }
                }
              } else {
                // Use cached component data
                for (const slot of footerData.pluginSlots) {
                  pluginSlots.push({
                    id: slot.id,
                    mfeId: repo.name,
                    mfeName: formatName(repo.name),
                    filePath: slot.filePath,
                    description: slot.description,
                    readmeContent: slot.readmeContent,
                    sourceUrl: slot.sourceUrl,
                    lastUpdated: slot.lastUpdated,
                    readmePresent: slot.readmePresent,
                    hasExamples: slot.hasExamples,
                    type: 'footer',
                    componentVersion: componentVersions.footerVersion,
                  });
                }
              }

              if (footerData) {
                mfe.footer = {
                  id: 'frontend-component-footer',
                  name: 'Footer',
                  version: componentVersions.footerVersion,
                  pluginSlotsCount: footerData.pluginSlots.length,
                };
              }
            }
          } catch (err) {
            console.log(
              `    ⚠ Error collecting component data: ${
                err instanceof Error ? err.message : String(err)
              }`
            );
          }
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
    const componentCache: Record<string, Record<string, any>> = {};
    // Use the repository's default branch to collect component data
    collectPlugins(
      isDevMode
        ? { devLimit: 3, componentCache }
        : { componentCache }
    );
  }
}
