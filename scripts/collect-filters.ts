import { writeFileSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { pathToFileURL } from 'url';
import { octokit, getTextFile, listDir, type GitRef } from './lib/github.js';

export interface FilterArgument {
  name: string;
  type: string;
  description: string;
}

export interface FilterReturn {
  type: string;
  description: string;
}

export interface FilterException {
  name: string;
  description: string;
}

export interface Trigger {
  repository: string;
  path: string;
  function: string;
}

export interface Filter {
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

export interface FiltersData {
  lastUpdated: string;
  filters: Filter[];
  categories: string[];
}

export async function collectFilters(opts?: {
  ref?: string;
  outputPath?: string;
}): Promise<FiltersData> {
  const outputPath = opts?.outputPath ?? 'data/filters.json';
  const ref = opts?.ref;

  console.log('[START] Starting filter data collection...');

  const filters: Filter[] = [];
  const categoriesSet = new Set<string>();

  try {
    console.log('[FETCH] Fetching openedx-filters repository...');

    const effectiveRef = ref ?? await getDefaultBranch();

    const filterFiles = await findFilterFiles(effectiveRef);

    for (const filePath of filterFiles) {
      console.log(`  ↳ Processing ${filePath}...`);
      const fileFilters = await parseFilterFile(filePath, effectiveRef);

      for (const filter of fileFilters) {
        filters.push(filter);
        categoriesSet.add(filter.category);
      }
    }

    const output: FiltersData = {
      lastUpdated: new Date().toISOString(),
      filters: filters.sort((a, b) => a.filterType.localeCompare(b.filterType)),
      categories: Array.from(categoriesSet).sort(),
    };

    mkdirSync(dirname(outputPath), { recursive: true });

    writeFileSync(outputPath, JSON.stringify(output, null, 2));

    console.log('\n[SUCCESS] Filter collection complete!');
    console.log(`[RESULTS]:`);
    console.log(`  • Total filters: ${filters.length}`);
    console.log(`  • Categories: ${output.categories.join(', ')}`);
    console.log(`  • Last updated: ${output.lastUpdated}`);

    return output;
  } catch (error) {
    if (error instanceof Error) {
      console.error('[ERROR] Error during collection:', error.message);
    }
    process.exit(1);
  }
}

async function getDefaultBranch(): Promise<string> {
  const repo = await octokit.rest.repos.get({
    owner: 'openedx',
    repo: 'openedx-filters',
  });
  return repo.data.default_branch;
}

async function findFilterFiles(ref: string): Promise<string[]> {
  const filterFiles: string[] = [];

  const filterDirs = [
    'openedx_filters/learning',
    'openedx_filters/content_authoring',
  ];

  for (const dir of filterDirs) {
    try {
      const entries = await listDir({
        owner: 'openedx',
        repo: 'openedx-filters',
        path: dir,
        ref,
      });

      if (entries) {
        for (const item of entries) {
          if (item.type === 'file' && item.name === 'filters.py') {
            filterFiles.push(item.path);
          }
        }
      }
    } catch (err) {
      // Directory doesn't exist, skip
    }
  }

  return filterFiles;
}

async function parseFilterFile(filePath: string, ref: string): Promise<Filter[]> {
  const filters: Filter[] = [];

  try {
    const content = await getTextFile({
      owner: 'openedx',
      repo: 'openedx-filters',
      path: filePath,
      ref,
    });

    if (content) {
      const classMatches = extractFilterClasses(content, filePath, ref);
      filters.push(...classMatches);
    }
  } catch (err) {
    console.error(`Error parsing ${filePath}:`, err);
  }

  return filters;
}

function extractFilterClasses(content: string, filePath: string, ref: string): Filter[] {
  const filters: Filter[] = [];
  const lines = content.split('\n');

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    const classMatch = line.match(/^class\s+(\w+)\(OpenEdxPublicFilter\):/);
    if (classMatch) {
      const className = classMatch[1];
      const classStartLine = i;
      const classStartIndex = lines.slice(0, i).join('\n').length + (i > 0 ? 1 : 0);

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

      let filterType = `org.openedx.${className}`;
      for (const classLine of classLines) {
        const ftMatch = classLine.match(/filter_type\s*=\s*['"](.*?)['"]/);
        if (ftMatch) {
          filterType = ftMatch[1];
          break;
        }
      }

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

      let purpose = docstring;
      const purposeMatch = docstring.match(/Purpose:\s*([\s\S]*?)(?:Filter Type:|Trigger:|$)/);
      if (purposeMatch) {
        purpose = purposeMatch[1].trim();
      }
      purpose = purpose.substring(0, 300);

      let trigger: Trigger | undefined;
      const triggerMatch = docstring.match(/Trigger:\s*-\s*Repository:\s*(\S+)\s*-\s*Path:\s*(\S+)\s*-\s*Function\s+or\s+Method:\s*(\S+)/);
      if (triggerMatch) {
        trigger = {
          repository: triggerMatch[1],
          path: triggerMatch[2],
          function: triggerMatch[3],
        };
      }

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
          if (j > runFilterStart && rl.match(/^\s{4}def\s/) && !inRunFilterDocstring) {
            break;
          }
        }

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

      for (let j = i; j < classEndLine; j++) {
        const excLine = classLines[j - i];
        const excMatch = excLine.match(/^\s+class\s+(\w+)\(OpenEdxFilterException\):/);
        if (excMatch) {
          const excName = excMatch[1];

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

          excDocstring = excDocstring.trim();
          const descMatch = excDocstring.match(/^([\s\S]*?)(?:Attributes:|__init__|$)/);
          const description = descMatch ? descMatch[1].trim().substring(0, 300) : excDocstring.substring(0, 300);

          filterExceptions.push({
            name: excName,
            description,
          });
        }
      }

      const category = extractCategory(filterType);

      const filter: Filter = {
        id: className,
        filterType,
        name: className,
        category,
        description: purpose,
        repository: 'https://github.com/openedx/openedx-filters',
        filePath,
        sourceUrl: `https://github.com/openedx/openedx-filters/blob/${ref}/${filePath}#L${classStartLine + 1}`,
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
  const isDryRun = process.argv.includes('--dry-run');
  if (isDryRun) {
    console.log('[DRY RUN] No API calls will be made');
  } else {
    collectFilters();
  }
}
