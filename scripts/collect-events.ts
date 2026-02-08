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

interface DataClass {
  name: string;
  description: string;
  attributes: EventAttribute[];
  dataKey?: string;
}

interface Event {
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

    // 3. For each domain, look for signals.py and data.py
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

         let dataClasses: Map<string, DataClass> = new Map();

         // Try to fetch data.py from the same domain
         try {
           const dataPath = `${domain.path}/data.py`;
           const dataContent = await octokit.rest.repos.getContent({
             owner: 'openedx',
             repo: 'openedx-events',
             path: dataPath,
           });

           if (
             dataContent &&
             dataContent.data &&
             typeof dataContent.data === 'object' &&
             !Array.isArray(dataContent.data) &&
             'content' in dataContent.data
           ) {
             const dataFileContent = Buffer.from(
               (dataContent.data as any).content as string,
               'base64'
             ).toString('utf-8');

             dataClasses = parseDataFile(dataFileContent, domain.name);
             console.log(`    ✓ Found ${dataClasses.size} data classes`);
           }
         } catch (err) {
           // data.py is optional
           console.log(`    → No data.py found for ${domain.name}`);
         }

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
           
           // Associate data classes with events
           const enrichedEvents = enrichEventsWithData(parsedEvents, dataClasses);
           events.push(...enrichedEvents);
           console.log(`    ✓ Found ${enrichedEvents.length} events`);
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

    // Extract data classes from the data={...} section
    const dataClassMappings = extractDataClassesFromSignal(content, variableName);

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
  // Find the signal definition for this variable
  const varIndex = content.indexOf(`${variableName} =`);
  if (varIndex === -1) return [];

  // Extract the full signal definition (find the closing parenthesis of OpenEdxPublicSignal)
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

  // Look for data={...} section (handle nested braces)
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

  // Extract key-class pairs: "key": ClassName
  // Pattern: "key_name": ClassName or 'key_name': ClassName
  const keyClassRegex = /["\'](\w+)["\']:\s*([A-Z]\w*(?:Data|Type))/g;
  const mappings: DataClassMapping[] = [];

  let match;
  while ((match = keyClassRegex.exec(dataContent)) !== null) {
    const key = match[1];
    const className = match[2];
    mappings.push({ key, className });
  }

  return mappings;
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

function parseDataFile(content: string, domainName: string): Map<string, DataClass> {
  const dataClasses = new Map<string, DataClass>();

  // Find all @attr.s decorated classes
  const attrClassRegex = /@attr\.s[^\n]*\nclass\s+(\w+)[^\n]*:\s*\n\s*"""([\s\S]*?)"""/g;

  let match;
  while ((match = attrClassRegex.exec(content)) !== null) {
    const className = match[1];
    const description = match[2].trim().split('\n')[0]; // Get first line of description

    // Parse attributes from the class
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

  // Find the class definition - look for both "class ClassName(" and "class ClassName:"
  let classIndex = content.indexOf(`class ${className}(`);
  if (classIndex === -1) {
    classIndex = content.indexOf(`class ${className}:`);
  }
  if (classIndex === -1) return attributes;

  // Find the end of the class (next class or EOF)
  const nextClassIndex = content.indexOf('\nclass ', classIndex + 1);
  const classContent = nextClassIndex > 0 
    ? content.substring(classIndex, nextClassIndex) 
    : content.substring(classIndex);

  // Extract the docstring from the class
  const docstringDescriptions = extractDocstringDescriptions(classContent);

  // Extract lines that define attributes (lines with attr.ib calls)
  const lines = classContent.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Match: attribute_name = attr.ib(type=SomeType...)
    const attrMatch = line.match(/^\s*(\w+)\s*=\s*attr\.ib\s*\([^)]*type=([^,)]+)/);

    if (attrMatch) {
      const attrName = attrMatch[1];
      const attrType = attrMatch[2].trim();

      // Get description from the extracted docstring descriptions
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

  // Find the docstring (first """ or ''')
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

  // Find the end of the docstring
  const docEnd = classContent.indexOf(quoteType, docStart + 3);
  if (docEnd === -1) return descriptions;

  // Extract the docstring content
  const docstring = classContent.substring(docStart + 3, docEnd);

  // Parse the docstring for attribute descriptions
  // Look for patterns like:
  // - attribute_name: Description
  // - attribute_name (type): Description
  // - attribute_name: Description with
  //     multiline content
  
  const lines = docstring.split('\n');
  let inAttributesSection = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Check if we're entering an Attributes section
    if (trimmed.toLowerCase().startsWith('attributes') && trimmed.endsWith(':')) {
      inAttributesSection = true;
      continue;
    }

    if (inAttributesSection && trimmed) {
      // Try to match: attribute_name: Description or attribute_name (type): Description
      const attrMatch = trimmed.match(/^(\w+)\s*(?:\([^)]*\))?\s*:\s*(.+)$/);
      
      if (attrMatch) {
        const attrName = attrMatch[1];
        let description = attrMatch[2].trim();

        // Collect continuation lines (indented lines following this attribute)
        for (let j = i + 1; j < lines.length; j++) {
          const nextLine = lines[j];
          const nextTrimmed = nextLine.trim();
          
          // If it's indented and not empty, it's a continuation
          if (nextLine.startsWith('    ') && nextTrimmed && !nextTrimmed.match(/^\w+\s*(?:\([^)]*\))?\s*:/)) {
            description += ' ' + nextTrimmed;
            i = j; // Move the outer loop index forward
          } else if (!nextTrimmed || nextLine.match(/^\s*\w+\s*(?:\([^)]*\))?\s*:/)) {
            // Stop at empty line or next attribute
            break;
          } else if (!nextLine.startsWith('    ')) {
            // Stop if indentation decreases
            break;
          }
        }

        descriptions.set(attrName, description.slice(0, 500)); // Limit to 500 chars
      } else if (trimmed && !trimmed.match(/^\w+\s*(?:\([^)]*\))?\s*:/) && trimmed.match(/^\S/)) {
        // Stop if we hit a non-indented line that's not an attribute definition
        inAttributesSection = false;
      }
    }
  }

  return descriptions;
}

function enrichEventsWithData(events: Event[], dataClasses: Map<string, DataClass>): Event[] {
  return events.map((event) => {
    const relatedDataClasses: DataClass[] = [];

    // If event has attributes field with data class mappings found in signal definition,
    // use those to look up the actual data class definitions
    if (event.attributes && event.attributes.length > 0) {
      for (const attr of event.attributes as any) {
        // attr is a DataClassMapping with { key, className }
        const className = attr.className || attr.name;
        const dataClass = dataClasses.get(className);
        if (dataClass) {
          // Add the dataKey from the signal definition
          relatedDataClasses.push({
            ...dataClass,
            dataKey: attr.key,
          });
        }
      }
    }

    // Clear the attributes field if we found data classes through it
    // (we'll use dataClasses field instead)
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

// Run collection when invoked directly.
if (isMain) {
  collectEvents();
}
