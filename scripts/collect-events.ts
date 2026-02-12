import { writeFileSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { pathToFileURL } from 'url';
import { octokit, getTextFile, listDir } from './lib/github.js';
import type { GitRef } from './lib/github.js';

export interface EventAttribute {
  name: string;
  type: string;
  description?: string;
}

export interface DataClass {
  name: string;
  description: string;
  attributes: EventAttribute[];
  dataKey?: string;
}

export interface Event {
  id: string;
  eventName: string;
  namespace: string;
  eventType?: string;
  description: string;
  attributes?: EventAttribute[];
  dataClasses?: DataClass[];
  filePath: string;
  sourceUrl: string;
  lastUpdated: string;
}

export interface EventsData {
  lastUpdated: string;
  repository: string;
  events: Event[];
}

export async function collectEvents(opts?: {
  ref?: string;
  outputPath?: string;
}): Promise<EventsData> {
  const ref = opts?.ref;
  const outputPath = opts?.outputPath ?? 'data/events.json';
  const refForUrl = ref ?? 'main';

  console.log('[START] Starting events data collection...');

  const events: Event[] = [];

  try {
    console.log('[FETCH] Fetching openedx-events repository structure...');

    const rootContents = await listDir({
      owner: 'openedx',
      repo: 'openedx-events',
      path: 'openedx_events',
      ref,
    });

    if (!rootContents) {
      throw new Error('openedx_events directory not found or is not a directory');
    }

    console.log(`  ✓ Found openedx_events directory (${rootContents.length} items)`);

    const domainDirs = rootContents.filter(
      (item) => item.type === 'dir' && !item.name.startsWith('__') && item.name !== 'tests'
    );

    console.log(`  ✓ Found ${domainDirs.length} domain directories`);

    for (const domain of domainDirs) {
      if (domain.type !== 'dir' || !domain.path) continue;

      try {
        console.log(`  → Processing domain: ${domain.name}...`);

        const signalsPath = `${domain.path}/signals.py`;
        const fileContent = await getTextFile({
          owner: 'openedx',
          repo: 'openedx-events',
          path: signalsPath,
          ref,
        });

        let dataClasses: Map<string, DataClass> = new Map();

        try {
          const dataPath = `${domain.path}/data.py`;
          const dataFileContent = await getTextFile({
            owner: 'openedx',
            repo: 'openedx-events',
            path: dataPath,
            ref,
          });

          if (dataFileContent) {
            dataClasses = parseDataFile(dataFileContent, domain.name);
            console.log(`    ✓ Found ${dataClasses.size} data classes`);
          } else {
            console.log(`    → No data.py found for ${domain.name}`);
          }
        } catch (err) {
          console.log(`    → No data.py found for ${domain.name}`);
        }

        if (fileContent) {
          const parsedEvents = parseEventFile(fileContent, signalsPath, domain.name, refForUrl);

          const enrichedEvents = enrichEventsWithData(parsedEvents, dataClasses);
          events.push(...enrichedEvents);
          console.log(`    ✓ Found ${enrichedEvents.length} events`);
        } else {
          throw new Error('signals.py not found');
        }
      } catch (err) {
        console.log(`  !! signals.py not found in ${domain.name}: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }

    const output: EventsData = {
      lastUpdated: new Date().toISOString(),
      repository: 'https://github.com/openedx/openedx-events',
      events,
    };

    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, JSON.stringify(output, null, 2));

    console.log('\n[SUCCESS] Events collection complete!');
    console.log(`[RESULTS]:`);
    console.log(`  • Total events: ${events.length}`);
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

function parseEventFile(content: string, filePath: string, domainName: string, refForUrl: string): Event[] {
  const events: Event[] = [];

  const signalRegex = /(\w+)\s*=\s*OpenEdxPublicSignal\s*\(\s*event_type="([^"]+)"/g;

  let match;
  while ((match = signalRegex.exec(content)) !== null) {
    const variableName = match[1];
    const eventType = match[2];

    const description = extractEventDescription(content, variableName, eventType);
    const dataClassMappings = extractDataClassesFromSignal(content, variableName);
    const namespace = domainName.replace(/_/g, '-');

    const event: Event = {
      id: `${namespace}.${variableName}`,
      eventName: variableName,
      namespace,
      eventType,
      description,
      filePath,
      sourceUrl: `https://github.com/openedx/openedx-events/tree/${refForUrl}/${filePath}`,
      lastUpdated: new Date().toISOString(),
      attributes: dataClassMappings.length > 0 ? dataClassMappings as any : undefined,
    };

    events.push(event);
  }

  return events;
}

interface DataClassMapping {
  key: string;
  className: string;
}

function extractDataClassesFromSignal(content: string, variableName: string): DataClassMapping[] {
  const varIndex = content.indexOf(`${variableName} =`);
  if (varIndex === -1) return [];

  let parenCount = 0;
  let inDefinition = false;
  let endIndex = varIndex;

  for (let i = varIndex; i < content.length; i++) {
    if (content[i] === '(') {
      inDefinition = true;
      parenCount++;
    } else if (content[i] === ')' && inDefinition) {
      parenCount--;
      if (parenCount === 0) {
        endIndex = i;
        break;
      }
    }
  }

  const signalDefinition = content.substring(varIndex, endIndex + 1);

  const dataStart = signalDefinition.indexOf('data=');
  if (dataStart === -1) return [];

  let braceCount = 0;
  let bracketStart = -1;
  let dataContent = '';

  for (let i = dataStart; i < signalDefinition.length; i++) {
    const char = signalDefinition[i];
    if (char === '{') {
      braceCount++;
      if (bracketStart === -1) {
        bracketStart = i + 1;
      }
    } else if (char === '}') {
      braceCount--;
      if (braceCount === 0 && bracketStart !== -1) {
        dataContent = signalDefinition.substring(bracketStart, i);
        break;
      }
    }
  }

  if (!dataContent) return [];

  const keyClassRegex = /["\'](\w+)["\']:\s*([A-Z]\w*(?:Data|Type))/g;
  const mappings: DataClassMapping[] = [];

  let keyMatch;
  while ((keyMatch = keyClassRegex.exec(dataContent)) !== null) {
    const key = keyMatch[1];
    const className = keyMatch[2];
    mappings.push({ key, className });
  }

  return mappings;
}

function extractEventDescription(content: string, variableName: string, eventType: string): string {
  const lines = content.split('\n');
  const varIndex = lines.findIndex((line) => line.includes(`${variableName} =`));

  if (varIndex > 0) {
    let descriptionLines: string[] = [];
    let foundDescription = false;

    for (let i = varIndex - 1; i >= Math.max(0, varIndex - 20); i--) {
      const line = lines[i];
      const trimmed = line.trim();

      if (trimmed.includes('.. event_description:')) {
        foundDescription = true;
        const description = trimmed
          .replace(/^#\s*/, '')
          .replace(/^\.\.\s+event_description:\s*/, '')
          .trim();
        
        if (description) {
          descriptionLines.unshift(description);
        }

        for (let j = i + 1; j < Math.min(varIndex, i + 10); j++) {
          const nextLine = lines[j].trim();
          if (nextLine.startsWith('#') && !nextLine.includes('.. event_')) {
            const cont = nextLine.replace(/^#\s*/, '').trim();
            if (cont) {
              descriptionLines.push(cont);
            }
          } else if (nextLine.startsWith('.. event_') || nextLine === '' || !nextLine.startsWith('#')) {
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

  const parts = eventType.split('.');
  if (parts.length > 0) {
    const lastParts = parts.slice(-2, -1)[0] || 'event';
    return lastParts.replace(/_/g, ' ').charAt(0).toUpperCase() + lastParts.slice(1).replace(/_/g, ' ');
  }

  return 'OpenEdX Event';
}

function parseDataFile(content: string, domainName: string): Map<string, DataClass> {
  const dataClasses = new Map<string, DataClass>();

  const attrClassRegex = /@attr\.s[^\n]*\nclass\s+(\w+)[^\n]*:\s*\n\s*"""([\s\S]*?)"""/g;

  let match;
  while ((match = attrClassRegex.exec(content)) !== null) {
    const className = match[1];
    const description = match[2].trim().split('\n')[0];

    const attributes = parseDataClassAttributes(content, className);

    dataClasses.set(className, {
      name: className,
      description,
      attributes,
    });
  }

  return dataClasses;
}

function parseDataClassAttributes(content: string, className: string): EventAttribute[] {
  const attributes: EventAttribute[] = [];

  let classIndex = content.indexOf(`class ${className}(`);
  if (classIndex === -1) {
    classIndex = content.indexOf(`class ${className}:`);
  }
  if (classIndex === -1) return attributes;

  const nextClassIndex = content.indexOf('\nclass ', classIndex + 1);
  const classContent = nextClassIndex > 0 
    ? content.substring(classIndex, nextClassIndex) 
    : content.substring(classIndex);

  const docstringDescriptions = extractDocstringDescriptions(classContent);

  const lines = classContent.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const attrMatch = line.match(/^\s*(\w+)\s*=\s*attr\.ib\s*\([^)]*type=([^,)]+)/);

    if (attrMatch) {
      const attrName = attrMatch[1];
      const attrType = attrMatch[2].trim();

      const description = docstringDescriptions.get(attrName);

      attributes.push({
        name: attrName,
        type: attrType,
        description: description || undefined,
      });
    }
  }

  return attributes;
}

function extractDocstringDescriptions(classContent: string): Map<string, string> {
  const descriptions = new Map<string, string>();

  const tripleDoubleQuoteStart = classContent.indexOf('"""');
  const tripleSingleQuoteStart = classContent.indexOf("'''");
  
  let docStart = -1;
  let quoteType = '';
  
  if (tripleDoubleQuoteStart !== -1 && tripleSingleQuoteStart !== -1) {
    if (tripleDoubleQuoteStart < tripleSingleQuoteStart) {
      docStart = tripleDoubleQuoteStart;
      quoteType = '"""';
    } else {
      docStart = tripleSingleQuoteStart;
      quoteType = "'''";
    }
  } else if (tripleDoubleQuoteStart !== -1) {
    docStart = tripleDoubleQuoteStart;
    quoteType = '"""';
  } else if (tripleSingleQuoteStart !== -1) {
    docStart = tripleSingleQuoteStart;
    quoteType = "'''";
  }

  if (docStart === -1) return descriptions;

  const docEnd = classContent.indexOf(quoteType, docStart + 3);
  if (docEnd === -1) return descriptions;

  const docstring = classContent.substring(docStart + 3, docEnd);

  const lines = docstring.split('\n');
  let inAttributesSection = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.toLowerCase().startsWith('attributes') && trimmed.endsWith(':')) {
      inAttributesSection = true;
      continue;
    }

    if (inAttributesSection && trimmed) {
      const attrMatch = trimmed.match(/^(\w+)\s*(?:\([^)]*\))?\s*:\s*(.+)$/);
      
      if (attrMatch) {
        const attrName = attrMatch[1];
        let description = attrMatch[2].trim();

        for (let j = i + 1; j < lines.length; j++) {
          const nextLine = lines[j];
          const nextTrimmed = nextLine.trim();
          
          if (nextLine.startsWith('    ') && nextTrimmed && !nextTrimmed.match(/^\w+\s*(?:\([^)]*\))?\s*:/)) {
            description += ' ' + nextTrimmed;
            i = j;
          } else if (!nextTrimmed || nextLine.match(/^\s*\w+\s*(?:\([^)]*\))?\s*:/)) {
            break;
          } else if (!nextLine.startsWith('    ')) {
            break;
          }
        }

        descriptions.set(attrName, description.slice(0, 500));
      } else if (trimmed && !trimmed.match(/^\w+\s*(?:\([^)]*\))?\s*:/) && trimmed.match(/^\S/)) {
        inAttributesSection = false;
      }
    }
  }

  return descriptions;
}

function enrichEventsWithData(events: Event[], dataClasses: Map<string, DataClass>): Event[] {
  return events.map((event) => {
    const relatedDataClasses: DataClass[] = [];

    if (event.attributes && event.attributes.length > 0) {
      for (const attr of event.attributes as any) {
        const className = attr.className || attr.name;
        const dataClass = dataClasses.get(className);
        if (dataClass) {
          relatedDataClasses.push({
            ...dataClass,
            dataKey: attr.key,
          });
        }
      }
    }

    const cleanedEvent = {
      ...event,
      attributes: undefined,
    };

    if (relatedDataClasses.length > 0) {
      return {
        ...cleanedEvent,
        dataClasses: relatedDataClasses,
      };
    }

    return cleanedEvent;
  });
}

const isMain = (() => {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  return import.meta.url === pathToFileURL(resolve(entry)).href;
})();

if (isMain) {
  const isDryRun = process.argv.includes('--dry-run');

  if (isDryRun) {
    console.log('[DRY RUN] No API calls will be made');
  } else {
    collectEvents();
  }
}
