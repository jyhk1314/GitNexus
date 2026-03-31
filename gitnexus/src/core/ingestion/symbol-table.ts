export interface SymbolDefinition {
  nodeId: string;
  filePath: string;
  type: string; // 'Function', 'Class', etc.
  parameterCount?: number;
  /** Raw return type text extracted from AST (e.g. 'User', 'Promise<User>') */
  returnType?: string;
  /** Links Method/Constructor to owning Class/Struct/Trait nodeId */
  ownerId?: string;
  /**
   * For C++ Property nodes: the base type name of the field
   * (e.g. 'TZmdbShmDSN' for `TZmdbShmDSN* m_pShmDSN`).
   * Stored so call resolution can look up receiver types for member variables.
   */
  fieldType?: string;
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
    metadata?: { parameterCount?: number; returnType?: string; ownerId?: string; fieldType?: string }
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
   * Look up the fieldType of a C++ member variable (Property node) by owner class id and variable name.
   * Returns the base type name (e.g. 'TZmdbShmDSN') or undefined if not found.
   */
  lookupMemberFieldType: (ownerClassId: string, varName: string) => string | undefined;

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

  // ownerClassId -> (varName -> fieldType) — for C++ member variable type lookup
  const memberFieldIndex = new Map<string, Map<string, string>>();

  const add = (
    filePath: string,
    name: string,
    nodeId: string,
    type: string,
    metadata?: { parameterCount?: number; returnType?: string; ownerId?: string; fieldType?: string }
  ) => {
    const def: SymbolDefinition = {
      nodeId,
      filePath,
      type,
      ...(metadata?.parameterCount !== undefined ? { parameterCount: metadata.parameterCount } : {}),
      ...(metadata?.returnType !== undefined ? { returnType: metadata.returnType } : {}),
      ...(metadata?.ownerId !== undefined ? { ownerId: metadata.ownerId } : {}),
      ...(metadata?.fieldType !== undefined ? { fieldType: metadata.fieldType } : {}),
    };

    // Index C++ member fields for cross-file receiver type resolution
    if (metadata?.ownerId && metadata?.fieldType) {
      let ownerMap = memberFieldIndex.get(metadata.ownerId);
      if (!ownerMap) { ownerMap = new Map(); memberFieldIndex.set(metadata.ownerId, ownerMap); }
      ownerMap.set(name, metadata.fieldType);
    }

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

  const lookupMemberFieldType = (ownerClassId: string, varName: string): string | undefined => {
    return memberFieldIndex.get(ownerClassId)?.get(varName);
  };

  const getStats = () => ({
    fileCount: fileIndex.size,
    globalSymbolCount: globalIndex.size,
  });

  const clear = () => {
    fileIndex.clear();
    globalIndex.clear();
    memberFieldIndex.clear();
  };

  return { add, lookupExact, lookupExactFull, lookupExactAllFull, lookupFuzzy, lookupMemberFieldType, getStats, clear };
};
