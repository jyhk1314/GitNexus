import fs from 'fs/promises';
import path from 'path';
import { callLLM, resolveLLMConfig, type LLMConfig } from './llm-client.js';
import {
  STRUCTURE_SYSTEM_PROMPT,
  STRUCTURE_USER_PROMPT,
  formatDirectoryTree,
  formatFileListForGrouping,
} from './prompts.js';
import { shouldIgnorePath } from '../../config/ignore-service.js';

export interface StructureResult {
  rootDir: string;
  structure: Record<string, string>;
  timestamp: string;
}

/**
 * Recursively collect relative file paths under dir, skipping ignored paths.
 */
async function collectFilePaths(rootDir: string, dir: string): Promise<string[]> {
  const entries = await fs.readdir(path.join(rootDir, dir), { withFileTypes: true }).catch(() => []);
  const out: string[] = [];
  for (const e of entries) {
    const rel = dir ? `${dir}/${e.name}` : e.name;
    if (shouldIgnorePath(rel)) continue;
    if (e.isDirectory()) {
      out.push(...(await collectFilePaths(rootDir, rel)));
    } else {
      out.push(rel);
    }
  }
  return out;
}

export interface GenerateStructureOptions {
  model?: string;
  output?: string;
  baseUrl?: string;
  apiKey?: string;
  /** When set, overrides resolve from model/baseUrl/apiKey (e.g. from CLI) */
  llmConfig?: LLMConfig;
}

export async function generateStructure(
  repoPath: string,
  options?: GenerateStructureOptions
): Promise<StructureResult> {
  const rootDir = repoPath;

  const filePaths = await collectFilePaths(rootDir, '');
  const dirTree = formatDirectoryTree(filePaths);
  const files = filePaths.map((filePath) => ({ filePath, symbols: [] as Array<{ name: string; type: string }> }));
  const fileList = formatFileListForGrouping(files);

  const userPrompt = STRUCTURE_USER_PROMPT.replace('{{ROOT_DIR}}', rootDir)
    .replace('{{DIRECTORY_TREE}}', dirTree)
    .replace('{{FILE_LIST}}', fileList);

  const config: LLMConfig = options?.llmConfig ?? await resolveLLMConfig({
    model: options?.model,
    baseUrl: options?.baseUrl,
    apiKey: options?.apiKey,
  });
  const response = await callLLM(userPrompt, config, STRUCTURE_SYSTEM_PROMPT);

  let structure: Record<string, string>;
  try {
    const jsonMatch =
      response.content.match(/```json\n?([\s\S]*?)\n?```/) || response.content.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch ? (jsonMatch[1] ?? jsonMatch[0]) : response.content;
    structure = JSON.parse(jsonStr);
  } catch (e) {
    console.error('Failed to parse LLM response:', response.content);
    throw new Error('Failed to parse structure response');
  }

  return {
    rootDir,
    structure,
    timestamp: new Date().toISOString(),
  };
}
