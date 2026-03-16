import path from 'path';
import { Command } from 'commander';
import { existsSync } from 'fs';
import { writeFile } from 'fs/promises';
import { generateStructure } from '../core/wiki/structure-generator.js';
import { resolveLLMConfig } from '../core/wiki/llm-client.js';
import { loadCLIConfig, saveCLIConfig } from '../storage/repo-manager.js';

export interface StructureCommandOptions {
  model?: string;
  output?: string;
  baseUrl?: string;
  apiKey?: string;
}

export const structureCommand = new Command('wiki-structure')
  .description('Generate project structure description from directory tree (uses same LLM config as wiki)')
  .argument('<repo-path>', 'Path to the repository')
  .option('-o, --output <file>', 'Output JSON file path', 'structure.json')
  .option('--model <model>', 'LLM model name (same default as wiki)')
  .option('--base-url <url>', 'LLM API base URL')
  .option('--api-key <key>', 'LLM API key (saved to ~/.gitnexus/config.json)')
  .action(async (repoPath: string, options: StructureCommandOptions) => {
    const resolvedPath = path.resolve(repoPath);
    if (!existsSync(resolvedPath)) {
      console.error(`Error: Path does not exist: ${resolvedPath}`);
      process.exit(1);
    }

    if (options?.apiKey || options?.model || options?.baseUrl) {
      const existing = await loadCLIConfig();
      const updates: Record<string, string> = {};
      if (options.apiKey) updates.apiKey = options.apiKey;
      if (options.model) updates.model = options.model;
      if (options.baseUrl) updates.baseUrl = options.baseUrl;
      await saveCLIConfig({ ...existing, ...updates });
      console.log('Config saved to ~/.gitnexus/config.json\n');
    }

    const llmConfig = await resolveLLMConfig({
      model: options?.model,
      baseUrl: options?.baseUrl,
      apiKey: options?.apiKey,
    });
    if (!llmConfig.apiKey) {
      console.error('Error: No LLM API key. Set GITNEXUS_API_KEY or OPENAI_API_KEY, or pass --api-key.');
      process.exit(1);
    }

    console.log(`Analyzing structure of: ${resolvedPath}`);
    console.log('This may take a while...\n');

    try {
      const result = await generateStructure(resolvedPath, {
        output: options.output,
        llmConfig,
      });

      await writeFile(options.output ?? 'structure.json', JSON.stringify(result.structure, null, 2));
      console.log(`Structure saved to: ${options.output ?? 'structure.json'}`);

      console.log('\nDirectory structure:\n');
      for (const [dir, desc] of Object.entries(result.structure)) {
        console.log(`  ${dir}`);
        console.log(`    -> ${desc}\n`);
      }
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });
