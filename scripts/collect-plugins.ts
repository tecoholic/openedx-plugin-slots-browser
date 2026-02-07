import { Octokit } from '@octokit/rest';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';

const token = process.env.GITHUB_TOKEN;
const isTestMode = process.argv.includes('--test');
const isDryRun = process.argv.includes('--dry-run');
const isDevMode = process.argv.includes('--dev');

const DEV_LIMIT = 3; // Collect only first 3 MFEs for development

if (!token && !isTestMode && !isDryRun) {
  console.warn('[WARNING] GITHUB_TOKEN environment variable not found');
  console.warn('   API calls will be rate-limited to 60/hour');
  console.warn('   Use: export GITHUB_TOKEN=your_token_here');
}

const octokit = new Octokit({
  auth: token || 'test-token',
});

interface MFE {
  id: string;
  name: string;
  description: string | null;
  repository: string;
  owner: string;
  topics: string[];
  pluginSlotsCount?: number;
}

interface PluginSlot {
  id: string;
  mfeId: string;
  mfeName: string;
  filePath: string;
  description: string;
  readmeContent?: string;
  exampleCode?: string;
  sourceUrl: string;
  lastUpdated: string;
  readmePresent: boolean;
  hasExamples: boolean;
}

interface PluginsData {
  lastUpdated: string;
  mfes: MFE[];
  pluginSlots: PluginSlot[];
}

async function collectPlugins() {
  if (isDryRun) {
    console.log('[DRY RUN] No API calls will be made');
    return;
  }

  if (isDevMode) {
    console.log('[DEV MODE] Collecting first 3 MFEs only...');
  } else {
    console.log('[START] Starting plugin data collection...');
  }

  const mfes: MFE[] = [];
  const pluginSlots: PluginSlot[] = [];

  try {
    // 1. Fetch all repos from openedx org
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
        // Filter for frontend-app-* and frontend-component-* repos
        if (
          !repo.name.startsWith('frontend-app-') &&
          !repo.name.startsWith('frontend-component-')
        ) {
          continue;
        }

        // Dev mode: stop after 3 MFEs
        if (isDevMode && mfes.length >= DEV_LIMIT) {
          break;
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

        // 2. Check for plugin-slots directory
        try {
          const contents = await octokit.rest.repos.getContent({
            owner: 'openedx',
            repo: repo.name,
            path: 'src/plugin-slots',
          });

          if (Array.isArray(contents.data)) {
            console.log(
              `    ✓ Found plugin-slots directory (${contents.data.length} items)`
            );

            let slotCount = 0;

            // 3. Parse each slot directory
            for (const item of contents.data) {
              if (item.type === 'dir') {
                const slotData = await parsePluginSlot(
                  repo.name,
                  formatName(repo.name),
                  repo.html_url,
                  item.path,
                  octokit
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
          // Plugin-slots directory doesn't exist, skip this repo
          console.log(`    !! plugin-slots directory missing. Skipping repo.`);
        }
      }

      // Dev mode: stop after first page since we already have 3 MFEs
      if (isDevMode && mfes.length >= DEV_LIMIT) {
        break;
      }

      page++;
    }

    // 4. Write output
    const output: PluginsData = {
      lastUpdated: new Date().toISOString(),
      mfes,
      pluginSlots,
    };

    // Ensure data directory exists
    mkdirSync(dirname('data/plugin-slots.json'), { recursive: true });

    writeFileSync(
      'data/plugin-slots.json',
      JSON.stringify(output, null, 2)
    );

    console.log('\n[SUCCESS] Collection complete!');
    console.log(`[RESULTS]:`);
    console.log(`  • MFEs with plugin slots: ${mfes.length}`);
    console.log(`  • Total plugin slots: ${pluginSlots.length}`);
    console.log(`  • Last updated: ${output.lastUpdated}`);
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
  octokit: Octokit
): Promise<PluginSlot | null> {
  try {
    const slotId = slotPath.split('/').pop() || 'Unknown';

    // Try to read README.md (no retry - file likely doesn't exist)
    let readmeText = '';
    let readmePresent = false;
    try {
      const response = await octokit.rest.repos.getContent({
        owner: 'openedx',
        repo: repoName,
        path: `${slotPath}/README.md`,
      });

      if (
        response &&
        response.data &&
        typeof response.data === 'object' &&
        !Array.isArray(response.data) &&
        'content' in response.data
      ) {
        readmeText = Buffer.from(
          (response.data as any).content as string,
          'base64'
        ).toString('utf-8');
        readmePresent = true;
      } else {
        // README doesn't exist, but we can still create a slot from directory name
        readmeText = `# ${slotId}\n\nPlugin slot for ${mfeName}`;
      }
    } catch (err) {
      // README doesn't exist - create default from slot name
      readmeText = `# ${slotId}\n\nPlugin slot for ${mfeName}`;
    }

    // Check if Examples section exists in README
    const hasExamples = /^#+\s+examples?/im.test(readmeText);

    // Try to extract example code (no retry - file likely doesn't exist)
    let exampleCode: string | undefined;
    try {
      const response = await octokit.rest.repos.getContent({
        owner: 'openedx',
        repo: repoName,
        path: `${slotPath}/example.jsx`,
      });

      if (
        response &&
        response.data &&
        typeof response.data === 'object' &&
        !Array.isArray(response.data) &&
        'content' in response.data
      ) {
        exampleCode = Buffer.from(
          (response.data as any).content as string,
          'base64'
        ).toString('utf-8');
      }
    } catch (err) {
      // Example doesn't exist - that's fine
    }

    return {
      id: slotId,
      mfeId: repoName,
      mfeName: mfeName,
      filePath: `${slotPath}/README.md`,
      description: extractDescription(readmeText),
      readmeContent: readmePresent ? readmeText : undefined,
      exampleCode,
      sourceUrl: `${repoUrl}/tree/master/${slotPath}`,
      lastUpdated: new Date().toISOString(),
      readmePresent,
      hasExamples,
    };
  } catch (err) {
    // Error parsing slot
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

function extractDescription(content: string): string {
  // Extract first paragraph after heading
  const lines = content.split('\n');
  let description = '';
  let descTitleFound = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (line.startsWith('#') && line.toLowerCase() === "description") {
      descTitleFound = true;
      continue
    }

    if (descTitleFound && line !== '') {
      description = line;
      break;
    }
  }

  return description.slice(0, 200);
}

// Run collection
collectPlugins();
