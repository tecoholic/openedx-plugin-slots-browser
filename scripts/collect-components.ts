import { writeFileSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { pathToFileURL } from 'url';
import { getTextFile, listDir, type GitRef } from './lib/github.js';

export interface ComponentData {
  id: string;
  name: string;
  version: string;
  repository: string;
  owner: string;
  pluginSlots: ComponentPluginSlot[];
  lastUpdated: string;
}

export interface ComponentPluginSlot {
  id: string;
  componentId: string;
  componentName: string;
  filePath: string;
  description: string;
  readmeContent?: string;
  sourceUrl: string;
  lastUpdated: string;
  readmePresent: boolean;
  hasExamples: boolean;
}

export interface ComponentsCache {
  [version: string]: ComponentData;
}

/**
 * Collect plugin slots from a specific component (header/footer) at a given ref
 */
export async function collectComponent(opts: {
  componentId: string;
  componentName: string;
  ref: GitRef;
  repository: string;
  owner: string;
}): Promise<ComponentData | null> {
  try {
    console.log(
      `    ↳ Collecting plugin slots from ${opts.componentName} at ref ${opts.ref}...`
    );

    const entries = await listDir({
      owner: opts.owner,
      repo: opts.componentId,
      path: 'src/plugin-slots',
      ref: opts.ref,
    });

    if (!entries) {
      console.log(
        `      ✗ No plugin-slots directory found in ${opts.componentName}`
      );
      return null;
    }

    console.log(
      `      ✓ Found plugin-slots directory (${entries.length} items)`
    );

    const pluginSlots: ComponentPluginSlot[] = [];

    for (const item of entries) {
      if (item.type === 'dir') {
        const slotData = await parseComponentPluginSlot(
          opts.componentId,
          opts.componentName,
          opts.repository,
          item.path,
          opts.ref
        );

        if (slotData) {
          pluginSlots.push(slotData);
        }
      }
    }

    if (pluginSlots.length === 0) {
      console.log(
        `      ✗ No plugin slots found in ${opts.componentName}`
      );
      return null;
    }

    // Extract version from ref (e.g., "v1.2.3" -> "1.2.3")
    const version = opts.ref.replace(/^v/, '');

    const componentData: ComponentData = {
      id: opts.componentId,
      name: opts.componentName,
      version,
      repository: opts.repository,
      owner: opts.owner,
      pluginSlots,
      lastUpdated: new Date().toISOString(),
    };

    console.log(
      `      ✓ Extracted ${pluginSlots.length} plugin slots from ${opts.componentName} v${version}`
    );

    return componentData;
  } catch (err) {
    console.log(
      `      ✗ Error collecting from ${opts.componentName}: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
    return null;
  }
}

/**
 * Parse a single component plugin slot
 */
async function parseComponentPluginSlot(
  componentId: string,
  componentName: string,
  repositoryUrl: string,
  slotPath: string,
  ref: GitRef
): Promise<ComponentPluginSlot | null> {
  try {
    const slotId = slotPath.split('/').pop() || 'Unknown';

    let readmeText = '';
    let readmePresent = false;

    const content = await getTextFile({
      owner: 'openedx',
      repo: componentId,
      path: `${slotPath}/README.md`,
      ref,
    });

    if (content !== null) {
      readmeText = content;
      readmePresent = true;
    } else {
      readmeText = `# ${slotId}\n\nPlugin slot for ${componentName}`;
    }

    const hasExamples = /^#+\s+examples?/im.test(readmeText);
    const treeRef = ref;

    return {
      id: slotId,
      componentId: componentId,
      componentName: componentName,
      filePath: `${slotPath}/README.md`,
      description: extractDescription(readmeText),
      readmeContent: readmePresent ? readmeText : undefined,
      sourceUrl: `${repositoryUrl}/tree/${treeRef}/${slotPath}`,
      lastUpdated: new Date().toISOString(),
      readmePresent,
      hasExamples,
    };
  } catch (err) {
    return null;
  }
}

function extractDescription(content: string): string {
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
  if (!entry) return false;
  return import.meta.url === pathToFileURL(resolve(entry)).href;
})();

if (isMain) {
  // Test script
  console.log('[TEST] Component collection utilities loaded successfully');
}
