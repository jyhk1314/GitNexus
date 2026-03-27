export interface SymbolDefinition {
  nodeId: string;
  filePath: string;
  type: string; // 'Function', 'Class', etc.
  parameterCount?: number;
  /** Raw return type text extracted from AST (e.g. 'User', 'Promise<User>') */
  returnType?: string;
  /** Links Method/Constructor to owning Class/Struct/Trait nodeId */
  ownerId?: string;
}

export interface SymbolTable {
  /**
   * Register a new symbol definition
   */
  add: (
    filePath: string,
    name: string,
    nodeId: string,
    type: string,
    metadata?: { parameterCount?: number; returnType?: string; ownerId?: string }
  ) => void;

  /**
   * High Confidence: Look for a symbol specifically inside a file
   * Returns the Node ID if found
   */
  lookupExact: (filePath: string, name: string) => string | undefined;

  /**
   * High Confidence: Look for a symbol in a specific file, returning full definition.
   * When multiple overloads share a name, returns the first registered entry.
   */
  lookupExactFull: (filePath: string, name: string) => SymbolDefinition | undefined;

  /**
   * All definitions in a file under a given symbol name (e.g. C++ overloads).
   */
  lookupExactAllFull: (filePath: string, name: string) => SymbolDefinition[];

  /**
   * Low Confidence: Look for a symbol anywhere in the project
   * Used when imports are missing or for framework magic
   */
  lookupFuzzy: (name: string) => SymbolDefinition[];

  /**
   * Debugging: See how many symbols are tracked
   */
  getStats: () => { fileCount: number; globalSymbolCount: number };

  /**
   * Cleanup memory
   */
  clear: () => void;
}

export const createSymbolTable = (): SymbolTable => {
  // FilePath -> (SymbolName -> [definitions]) — supports overloads in one TU
  const fileIndex = new Map<string, Map<string, SymbolDefinition[]>>();

  // SymbolName -> [definitions across files]
  const globalIndex = new Map<string, SymbolDefinition[]>();

  const add = (
    filePath: string,
    name: string,
    nodeId: string,
    type: string,
    metadata?: { parameterCount?: number; returnType?: string; ownerId?: string }
  ) => {
    const def: SymbolDefinition = {
      nodeId,
      filePath,
      type,
      ...(metadata?.parameterCount !== undefined ? { parameterCount: metadata.parameterCount } : {}),
      ...(metadata?.returnType !== undefined ? { returnType: metadata.returnType } : {}),
      ...(metadata?.ownerId !== undefined ? { ownerId: metadata.ownerId } : {}),
    };

    if (!fileIndex.has(filePath)) {
      fileIndex.set(filePath, new Map());
    }
    const nameMap = fileIndex.get(filePath)!;
    if (!nameMap.has(name)) {
      nameMap.set(name, []);
    }
    const fileSyms = nameMap.get(name)!;
    const dupIdx = fileSyms.findIndex(d => d.nodeId === def.nodeId);
    if (dupIdx >= 0) fileSyms[dupIdx] = def;
    else fileSyms.push(def);

    const gList = globalIndex.get(name) ?? [];
    const gFiltered = gList.filter(d => d.nodeId !== def.nodeId);
    gFiltered.push(def);
    globalIndex.set(name, gFiltered);
  };

  const lookupExactAllFull = (filePath: string, name: string): SymbolDefinition[] => {
    const list = fileIndex.get(filePath)?.get(name);
    return list ? [...list] : [];
  };

  const lookupExact = (filePath: string, name: string): string | undefined => {
    return lookupExactAllFull(filePath, name)[0]?.nodeId;
  };

  const lookupExactFull = (filePath: string, name: string): SymbolDefinition | undefined => {
    return lookupExactAllFull(filePath, name)[0];
  };

  const lookupFuzzy = (name: string): SymbolDefinition[] => {
    return globalIndex.get(name) || [];
  };

  const getStats = () => ({
    fileCount: fileIndex.size,
    globalSymbolCount: globalIndex.size,
  });

  const clear = () => {
    fileIndex.clear();
    globalIndex.clear();
  };

  return { add, lookupExact, lookupExactFull, lookupExactAllFull, lookupFuzzy, getStats, clear };
};
