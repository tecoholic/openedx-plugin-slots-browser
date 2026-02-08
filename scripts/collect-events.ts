import { Octokit } from '@octokit/rest';
import { writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { pathToFileURL } from 'url';
import { resolve } from 'path';

const token = process.env.GITHUB_TOKEN;
const isTestMode = process.argv.includes('--test');
const isDryRun = process.argv.includes('--dry-run');

if (!token && !isTestMode && !isDryRun) {
  console.warn('[WARNING] GITHUB_TOKEN environment variable not found');
  console.warn('   API calls will be rate-limited to 60/hour');
  console.warn('   Use: export GITHUB_TOKEN=your_token_here');
}

const octokit = new Octokit({
  auth: token || 'test-token',
});

interface EventAttribute {
  name: string;
  type: string;
  description?: string;
}

interface Event {
  id: string;
  eventName: string;
  namespace: string;
  eventType?: string;
  description: string;
  attributes?: EventAttribute[];
  filePath: string;
  sourceUrl: string;
  lastUpdated: string;
}

interface EventsData {
  lastUpdated: string;
  repository: string;
  events: Event[];
}

async function collectEvents() {
  if (isDryRun) {
    console.log('[DRY RUN] No API calls will be made');
    return;
  }

  console.log('[START] Starting events data collection...');

  const events: Event[] = [];

  try {
    // 1. Fetch openedx-events repository structure
    console.log('[FETCH] Fetching openedx-events repository structure...');

    // Get the root directory to find domain directories
    const rootContents = await octokit.rest.repos.getContent({
      owner: 'openedx',
      repo: 'openedx-events',
      path: 'openedx_events',
    });

    if (!Array.isArray(rootContents.data)) {
      throw new Error('openedx_events directory not found or is not a directory');
    }

    console.log(`  ✓ Found openedx_events directory (${rootContents.data.length} items)`);

    // 2. Filter for domain directories (exclude __pycache__, tests, etc)
    const domainDirs = rootContents.data.filter(
      (item) => item.type === 'dir' && !item.name.startsWith('__') && item.name !== 'tests'
    );

    console.log(`  ✓ Found ${domainDirs.length} domain directories`);

    // 3. For each domain, look for signals.py
    for (const domain of domainDirs) {
      if (domain.type !== 'dir' || !domain.path) continue;

      try {
        console.log(`  → Processing domain: ${domain.name}...`);

        const signalsPath = `${domain.path}/signals.py`;
        const signalsContent = await octokit.rest.repos.getContent({
          owner: 'openedx',
          repo: 'openedx-events',
          path: signalsPath,
        });

        if (
          signalsContent &&
          signalsContent.data &&
          typeof signalsContent.data === 'object' &&
          !Array.isArray(signalsContent.data) &&
          'content' in signalsContent.data
        ) {
          const fileContent = Buffer.from(
            (signalsContent.data as any).content as string,
            'base64'
          ).toString('utf-8');

          // Parse events from signals.py
          const parsedEvents = parseEventFile(fileContent, signalsPath, domain.name);
          events.push(...parsedEvents);
          console.log(`    ✓ Found ${parsedEvents.length} events`);
        }
      } catch (err) {
        console.log(`  !! signals.py not found in ${domain.name}: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }

    // 4. Write output
    const output: EventsData = {
      lastUpdated: new Date().toISOString(),
      repository: 'https://github.com/openedx/openedx-events',
      events,
    };

    // Ensure data directory exists
    mkdirSync(dirname('data/events.json'), { recursive: true });

    writeFileSync('data/events.json', JSON.stringify(output, null, 2));

    console.log('\n[SUCCESS] Events collection complete!');
    console.log(`[RESULTS]:`);
    console.log(`  • Total events: ${events.length}`);
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

function parseEventFile(content: string, filePath: string, domainName: string): Event[] {
  const events: Event[] = [];

  // Extract variable assignments for OpenEdxPublicSignal instances
  // Pattern: VARIABLE_NAME = OpenEdxPublicSignal(event_type="...", ...)
  const signalRegex = /(\w+)\s*=\s*OpenEdxPublicSignal\s*\(\s*event_type="([^"]+)"/g;

  let match;
  while ((match = signalRegex.exec(content)) !== null) {
    const variableName = match[1];
    const eventType = match[2]; // e.g., "org.openedx.content_authoring.course.catalog_info.changed.v1"

    // Extract description from event type or surrounding comments
    const description = extractEventDescription(content, variableName, eventType);

    // Construct namespace from domain (replace underscores with hyphens)
    const namespace = domainName.replace(/_/g, '-');

    const event: Event = {
      id: `${namespace}.${variableName}`,
      eventName: variableName,
      namespace,
      eventType,
      description,
      filePath,
      sourceUrl: `https://github.com/openedx/openedx-events/tree/main/${filePath}`,
      lastUpdated: new Date().toISOString(),
    };

    events.push(event);
  }

  return events;
}

function extractEventDescription(content: string, variableName: string, eventType: string): string {
  // Extract description from the comment block above the variable
  // Look for: .. event_description: <description>
  const lines = content.split('\n');
  const varIndex = lines.findIndex((line) => line.includes(`${variableName} =`));

  if (varIndex > 0) {
    // Search backwards from the variable for event_description
    let descriptionLines: string[] = [];
    let foundDescription = false;

    for (let i = varIndex - 1; i >= Math.max(0, varIndex - 20); i--) {
      const line = lines[i];
      const trimmed = line.trim();

      // Look for the event_description line
      if (trimmed.includes('.. event_description:')) {
        foundDescription = true;
        // Extract everything after ".. event_description:"
        const description = trimmed
          .replace(/^#\s*/, '')
          .replace(/^\.\.\s+event_description:\s*/, '')
          .trim();
        
        if (description) {
          descriptionLines.unshift(description);
        }

        // Continue looking for continuation lines (lines with just #)
        for (let j = i + 1; j < Math.min(varIndex, i + 10); j++) {
          const nextLine = lines[j].trim();
          // Check if it's a continuation (starts with # but not .. event_)
          if (nextLine.startsWith('#') && !nextLine.includes('.. event_')) {
            const cont = nextLine.replace(/^#\s*/, '').trim();
            if (cont) {
              descriptionLines.push(cont);
            }
          } else if (nextLine.startsWith('.. event_') || nextLine === '' || !nextLine.startsWith('#')) {
            // Stop if we hit another directive, empty line, or non-comment
            break;
          }
        }
        break;
      }
    }

    if (foundDescription && descriptionLines.length > 0) {
      return descriptionLines.join(' ').slice(0, 500);
    }
  }

  // Fall back to extracting description from event type
  // Convert "org.openedx.content_authoring.course.catalog_info.changed.v1" to readable format
  const parts = eventType.split('.');
  if (parts.length > 0) {
    const lastParts = parts.slice(-2, -1)[0] || 'event';
    return lastParts.replace(/_/g, ' ').charAt(0).toUpperCase() + lastParts.slice(1).replace(/_/g, ' ');
  }

  return 'OpenEdX Event';
}

const isMain = (() => {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  return import.meta.url === pathToFileURL(resolve(entry)).href;
})();

// Run collection when invoked directly.
if (isMain) {
  collectEvents();
}
