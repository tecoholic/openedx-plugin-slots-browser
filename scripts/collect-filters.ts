import { Octokit } from '@octokit/rest';
import { writeFileSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { pathToFileURL } from 'url';

const token = process.env.GITHUB_TOKEN;
const isDryRun = process.argv.includes('--dry-run');

if (!token && !isDryRun) {
  console.warn('[WARNING] GITHUB_TOKEN environment variable not found');
  console.warn('   API calls will be rate-limited to 60/hour');
}

const octokit = new Octokit({
  auth: token || 'test-token',
});

interface FilterArgument {
  name: string;
  type: string;
  description: string;
}

interface FilterReturn {
  type: string;
  description: string;
}

interface FilterException {
  name: string;
  description: string;
}

interface Trigger {
  repository: string;
  path: string;
  function: string;
}

interface Filter {
  id: string;
  filterType: string;
  name: string;
  category: string;
  description: string;
  repository: string;
  filePath: string;
  sourceUrl: string;
  arguments: FilterArgument[];
  returns: FilterReturn[];
  exceptions: FilterException[];
  trigger?: Trigger;
  lastUpdated: string;
}

interface FiltersData {
  lastUpdated: string;
  filters: Filter[];
  categories: string[];
}

async function collectFilters() {
  if (isDryRun) {
    console.log('[DRY RUN] No API calls will be made');
    return;
  }

  console.log('[START] Starting filter data collection...');

  const filters: Filter[] = [];
  const categoriesSet = new Set<string>();

  try {
    // 1. Fetch openedx-filters repository
    console.log('[FETCH] Fetching openedx-filters repository...');

    const filterFiles = await findFilterFiles();

    // 2. Parse each filter file
    for (const filePath of filterFiles) {
      console.log(`  ↳ Processing ${filePath}...`);
      const fileFilters = await parseFilterFile(filePath);

      for (const filter of fileFilters) {
        filters.push(filter);
        categoriesSet.add(filter.category);
      }
    }

    // 3. Write output
    const output: FiltersData = {
      lastUpdated: new Date().toISOString(),
      filters: filters.sort((a, b) => a.filterType.localeCompare(b.filterType)),
      categories: Array.from(categoriesSet).sort(),
    };

    mkdirSync(dirname('data/filters.json'), { recursive: true });

    writeFileSync('data/filters.json', JSON.stringify(output, null, 2));

    console.log('\n[SUCCESS] Filter collection complete!');
    console.log(`[RESULTS]:`);
    console.log(`  • Total filters: ${filters.length}`);
    console.log(`  • Categories: ${output.categories.join(', ')}`);
    console.log(`  • Last updated: ${output.lastUpdated}`);
  } catch (error) {
    if (error instanceof Error) {
      console.error('[ERROR] Error during collection:', error.message);
    }
    process.exit(1);
  }
}

async function findFilterFiles(): Promise<string[]> {
  const filterFiles: string[] = [];

  try {
    // Get the default branch
    const repo = await octokit.rest.repos.get({
      owner: 'openedx',
      repo: 'openedx-filters',
    });

    const defaultBranch = repo.data.default_branch;

    // Search for filter definitions in the main filters directory
    const filterDirs = [
      'openedx_filters/learning',
      'openedx_filters/content_authoring',
    ];

    for (const dir of filterDirs) {
      try {
        const contents = await octokit.rest.repos.getContent({
          owner: 'openedx',
          repo: 'openedx-filters',
          path: dir,
        });

        if (Array.isArray(contents.data)) {
          for (const item of contents.data) {
            if (item.type === 'file' && item.name === 'filters.py') {
              filterFiles.push(item.path);
            }
          }
        }
      } catch (err) {
        // Directory doesn't exist, skip
      }
    }
  } catch (error) {
    console.error('Error finding filter files:', error);
  }

  return filterFiles;
}

async function parseFilterFile(filePath: string): Promise<Filter[]> {
  const filters: Filter[] = [];

  try {
    const response = await octokit.rest.repos.getContent({
      owner: 'openedx',
      repo: 'openedx-filters',
      path: filePath,
    });

    if (
      response &&
      response.data &&
      typeof response.data === 'object' &&
      !Array.isArray(response.data) &&
      'content' in response.data
    ) {
      const content = Buffer.from(
        (response.data as any).content as string,
        'base64'
      ).toString('utf-8');

      const classMatches = extractFilterClasses(content, filePath);
      filters.push(...classMatches);
    }
  } catch (err) {
    console.error(`Error parsing ${filePath}:`, err);
  }

  return filters;
}

function extractFilterClasses(content: string, filePath: string): Filter[] {
  const filters: Filter[] = [];
  const lines = content.split('\n');

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Look for class definition
    const classMatch = line.match(/^class\s+(\w+)\(OpenEdxPublicFilter\):/);
    if (classMatch) {
      const className = classMatch[1];
      const classStartLine = i;
      const classStartIndex = lines.slice(0, i).join('\n').length + (i > 0 ? 1 : 0);

      // Extract class block (up to next class or end of file)
      let classEndLine = i + 1;
      let indentLevel = 0;

      for (let j = i + 1; j < lines.length; j++) {
        const currentLine = lines[j];
        if (currentLine.match(/^class\s+\w+/)) {
          classEndLine = j;
          break;
        }
        if (j === lines.length - 1) {
          classEndLine = lines.length;
        }
      }

      const classLines = lines.slice(i, classEndLine);
      const classBlock = classLines.join('\n');

      // Extract filter_type
      let filterType = `org.openedx.${className}`;
      for (const classLine of classLines) {
        const ftMatch = classLine.match(/filter_type\s*=\s*['"](.*?)['"]/);
        if (ftMatch) {
          filterType = ftMatch[1];
          break;
        }
      }

      // Extract docstring
      let docstring = '';
      let inDocstring = false;
      for (let j = 0; j < classLines.length; j++) {
        if (classLines[j].includes('"""')) {
          if (inDocstring) {
            break;
          } else {
            inDocstring = true;
            continue;
          }
        }
        if (inDocstring) {
          docstring += classLines[j] + '\n';
        }
      }
      docstring = docstring.trim();

      // Extract purpose from docstring
      let purpose = docstring;
      const purposeMatch = docstring.match(/Purpose:\s*([\s\S]*?)(?:Filter Type:|Trigger:|$)/);
      if (purposeMatch) {
        purpose = purposeMatch[1].trim();
      }
      purpose = purpose.substring(0, 300);

      // Extract trigger info
      let trigger: Trigger | undefined;
      const triggerMatch = docstring.match(/Trigger:\s*-\s*Repository:\s*(\S+)\s*-\s*Path:\s*(\S+)\s*-\s*Function\s+or\s+Method:\s*(\S+)/);
      if (triggerMatch) {
        trigger = {
          repository: triggerMatch[1],
          path: triggerMatch[2],
          function: triggerMatch[3],
        };
      }

      // Find run_filter method
      let runFilterStart = -1;
      for (let j = 0; j < classLines.length; j++) {
        if (classLines[j].includes('def run_filter')) {
          runFilterStart = j;
          break;
        }
      }

      const filterArgs: FilterArgument[] = [];
      const filterReturns: FilterReturn[] = [];
      const filterExceptions: FilterException[] = [];

      if (runFilterStart !== -1) {
        // Extract arguments and returns from docstring in run_filter
        let inRunFilterDocstring = false;
        let runFilterDocstring = '';
        for (let j = runFilterStart; j < classLines.length; j++) {
          const rl = classLines[j];
          if (rl.includes('"""')) {
            if (inRunFilterDocstring) {
              break;
            } else {
              inRunFilterDocstring = true;
              continue;
            }
          }
          if (inRunFilterDocstring) {
            runFilterDocstring += rl + '\n';
          }
          // Stop if we hit next method
          if (j > runFilterStart && rl.match(/^\s{4}def\s/) && !inRunFilterDocstring) {
            break;
          }
        }

        // Parse arguments from docstring
        const argsMatch = runFilterDocstring.match(/Arguments:\s*([\s\S]*?)(?:Returns:|$)/);
        if (argsMatch) {
          const argsText = argsMatch[1];
          const argLineRegex = /^\s*(\w+)\s*\(([^)]+)\):\s*(.*?)$/gm;
          let argMatch;
          while ((argMatch = argLineRegex.exec(argsText)) !== null) {
            filterArgs.push({
              name: argMatch[1],
              type: argMatch[2].trim(),
              description: argMatch[3].trim().substring(0, 200),
            });
          }
        }

        // Parse returns from docstring
        const returnsMatch = runFilterDocstring.match(/Returns:\s*([\s\S]*?)$/);
        if (returnsMatch) {
          const returnsText = returnsMatch[1];
          const returnLineRegex = /^\s*-\s*(\w+(?:\[.*?\])?|\w+\|[\w\s|[\]]+):\s*(.*?)$/gm;
          let returnMatch;
          while ((returnMatch = returnLineRegex.exec(returnsText)) !== null) {
            filterReturns.push({
              type: returnMatch[1].trim(),
              description: returnMatch[2].trim().substring(0, 200),
            });
          }
        }
      }

      // Extract exceptions defined as nested classes
      for (let j = i; j < classEndLine; j++) {
        const excLine = classLines[j - i];
        const excMatch = excLine.match(/^\s+class\s+(\w+)\(OpenEdxFilterException\):/);
        if (excMatch) {
          const excName = excMatch[1];

          // Extract exception docstring
          let excDocstring = '';
          let inExcDocstring = false;
          for (let k = j + 1; k < classEndLine && k - i < classLines.length; k++) {
            const excDocLine = classLines[k - i];
            if (excDocLine.includes('"""')) {
              if (inExcDocstring) {
                break;
              } else {
                inExcDocstring = true;
                continue;
              }
            }
            if (inExcDocstring) {
              excDocstring += excDocLine + '\n';
            }
          }

          // Clean up docstring - remove attributes and init sections, keep first description
          excDocstring = excDocstring.trim();
          const descMatch = excDocstring.match(/^([\s\S]*?)(?:Attributes:|__init__|$)/);
          const description = descMatch ? descMatch[1].trim().substring(0, 300) : excDocstring.substring(0, 300);

          filterExceptions.push({
            name: excName,
            description,
          });
        }
      }

      // Extract category from filter_type
      const category = extractCategory(filterType);

      const filter: Filter = {
        id: className,
        filterType,
        name: className,
        category,
        description: purpose,
        repository: 'https://github.com/openedx/openedx-filters',
        filePath,
        sourceUrl: `https://github.com/openedx/openedx-filters/blob/main/${filePath}#L${classStartLine + 1}`,
        arguments: filterArgs,
        returns: filterReturns,
        exceptions: filterExceptions,
        trigger,
        lastUpdated: new Date().toISOString(),
      };

      filters.push(filter);
      i = classEndLine;
    } else {
      i++;
    }
  }

  return filters;
}



function extractCategory(filterType: string): string {
  // Extract category from filter_type string
  // org.openedx.{category}.{component}.{action}.v1
  const parts = filterType.split('.');
  if (parts.length >= 3) {
    return parts[2];
  }
  return 'general';
}

const isMain = (() => {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  return import.meta.url === pathToFileURL(resolve(entry)).href;
})();

if (isMain) {
  collectFilters();
}
