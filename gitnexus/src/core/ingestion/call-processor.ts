import path from 'node:path';
import { KnowledgeGraph, type GraphRelationship } from '../graph/types.js';
import { ASTCache } from './ast-cache.js';
import type { SymbolDefinition, SymbolTable } from './symbol-table.js';
import Parser from 'tree-sitter';
import type { ResolutionContext } from './resolution-context.js';
import { TIER_CONFIDENCE, type ResolutionTier } from './resolution-context.js';
import { isLanguageAvailable, loadParser, loadLanguage } from '../tree-sitter/parser-loader.js';
import { LANGUAGE_QUERIES } from './tree-sitter-queries.js';
import { generateId } from '../../lib/utils.js';
import {
  getLanguageFromFilename,
  isVerboseIngestionEnabled,
  yieldToEventLoop,
  FUNCTION_NODE_TYPES,
  extractFunctionName,
  isBuiltInOrNoise,
  countCallArguments,
  inferCallForm,
  extractReceiverName,
  findEnclosingClassId,
  hashCppCallableOverloadSegment,
  cppInClassCallableLabel,
  getCallResolutionDebugMode,
  getCallResolutionDebugNameFilter,
} from './utils.js';
import { buildTypeEnv } from './type-env.js';
import type { ConstructorBinding } from './type-env.js';
import { getTreeSitterBufferSize } from './constants.js';
import { preprocessCppExportMacros } from './cpp-export-macro-preprocess.js';
import type { ExtractedCall, ExtractedHeritage, ExtractedRoute, FileConstructorBindings } from './workers/parse-worker.js';
import { callRouters } from './call-routing.js';
import { SupportedLanguages } from '../../config/supported-languages.js';

/**
 * Walk up the AST from a node to find the enclosing function/method.
 * Returns null if the call is at module/file level (top-level code).
 */
const findEnclosingFunction = (
  node: any,
  filePath: string,
  ctx: ResolutionContext
): string | null => {
  let current = node.parent;

  while (current) {
    if (FUNCTION_NODE_TYPES.has(current.type)) {
      const { funcName, label: extractedLabel } = extractFunctionName(current);

      if (funcName) {
        const lang = getLanguageFromFilename(filePath);
        const enclosingClassId =
          lang === SupportedLanguages.CPlusPlus
            ? findEnclosingClassId(current, filePath, lang)
            : null;
        const label = cppInClassCallableLabel(lang, extractedLabel, enclosingClassId);
        const cppStem =
          lang === SupportedLanguages.CPlusPlus &&
          enclosingClassId &&
          (label === 'Method' || label === 'Constructor')
            ? `${enclosingClassId}:${funcName}#${hashCppCallableOverloadSegment(current)}`
            : null;

        const resolved = ctx.resolve(funcName, filePath);
        if (resolved?.tier === 'same-file' && resolved.candidates.length > 0) {
          if (cppStem) {
            const expectedId = generateId(label, cppStem);
            const exact = resolved.candidates.find(c => c.nodeId === expectedId);
            if (exact) return exact.nodeId;
          }
          if (resolved.candidates.length === 1) {
            return resolved.candidates[0].nodeId;
          }
        }

        if (cppStem) {
          return generateId(label, cppStem);
        }

        return generateId(label, `${filePath}:${funcName}`);
      }
    }
    current = current.parent;
  }

  return null;
};

/**
 * Verify constructor bindings against SymbolTable and infer receiver types.
 * Shared between sequential (processCalls) and worker (processCallsFromExtracted) paths.
 */
const verifyConstructorBindings = (
  bindings: readonly ConstructorBinding[],
  filePath: string,
  ctx: ResolutionContext,
  graph?: KnowledgeGraph,
): Map<string, string> => {
  const verified = new Map<string, string>();

  for (const { scope, varName, calleeName, receiverClassName } of bindings) {
    const tiered = ctx.resolve(calleeName, filePath);
    const isClass = tiered?.candidates.some(def => def.type === 'Class') ?? false;

    if (isClass) {
      verified.set(receiverKey(extractFuncNameFromScope(scope), varName), calleeName);
    } else {
      let callableDefs = tiered?.candidates.filter(d =>
        d.type === 'Function' || d.type === 'Method'
      );

      // When receiver class is known (e.g. $this->method() in PHP), narrow
      // candidates to methods owned by that class to avoid false disambiguation failures.
      if (callableDefs && callableDefs.length > 1 && receiverClassName) {
        if (graph) {
          // Worker path: use graph.getNode (fast, already in-memory)
          const narrowed = callableDefs.filter(d => {
            if (!d.ownerId) return false;
            const owner = graph.getNode(d.ownerId);
            return owner?.properties.name === receiverClassName;
          });
          if (narrowed.length > 0) callableDefs = narrowed;
        } else {
          // Sequential path: use ctx.resolve (no graph available)
          const classResolved = ctx.resolve(receiverClassName, filePath);
          if (classResolved && classResolved.candidates.length > 0) {
            const classNodeIds = new Set(classResolved.candidates.map(c => c.nodeId));
            const narrowed = callableDefs.filter(d =>
              d.ownerId && classNodeIds.has(d.ownerId)
            );
            if (narrowed.length > 0) callableDefs = narrowed;
          }
        }
      }

      if (callableDefs && callableDefs.length === 1 && callableDefs[0].returnType) {
        const typeName = extractReturnTypeName(callableDefs[0].returnType);
        if (typeName) {
          verified.set(receiverKey(extractFuncNameFromScope(scope), varName), typeName);
        }
      }
    }
  }

  return verified;
};

export const processCalls = async (
  graph: KnowledgeGraph,
  files: { path: string; content: string }[],
  astCache: ASTCache,
  ctx: ResolutionContext,
  onProgress?: (current: number, total: number) => void,
): Promise<ExtractedHeritage[]> => {
  const parser = await loadParser();
  const collectedHeritage: ExtractedHeritage[] = [];
  const logSkipped = isVerboseIngestionEnabled();
  const skippedByLang = logSkipped ? new Map<string, number>() : null;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    onProgress?.(i + 1, files.length);
    if (i % 20 === 0) await yieldToEventLoop();

    const language = getLanguageFromFilename(file.path);
    if (!language) continue;
    if (!isLanguageAvailable(language)) {
      if (skippedByLang) {
        skippedByLang.set(language, (skippedByLang.get(language) ?? 0) + 1);
      }
      continue;
    }

    const queryStr = LANGUAGE_QUERIES[language];
    if (!queryStr) continue;

    await loadLanguage(language, file.path);

    let tree = astCache.get(file.path);
    if (!tree) {
      let content = file.content;
      if (language === SupportedLanguages.CPlusPlus) {
        content = preprocessCppExportMacros(content);
      }
      try {
        tree = parser.parse(content, undefined, { bufferSize: getTreeSitterBufferSize(content.length) });
      } catch (parseError) {
        continue;
      }
      astCache.set(file.path, tree);
    }

    let query;
    let matches;
    try {
      const language = parser.getLanguage();
      query = new Parser.Query(language, queryStr);
      matches = query.matches(tree.rootNode);
    } catch (queryError) {
      console.warn(`Query error for ${file.path}:`, queryError);
      continue;
    }

    const lang = getLanguageFromFilename(file.path);
    const typeEnv = lang ? buildTypeEnv(tree, lang, ctx.symbols) : null;
    const callRouter = callRouters[language];

    const verifiedReceivers = typeEnv && typeEnv.constructorBindings.length > 0
      ? verifyConstructorBindings(typeEnv.constructorBindings, file.path, ctx)
      : new Map<string, string>();

    ctx.enableCache(file.path);

    matches.forEach(match => {
      const captureMap: Record<string, any> = {};
      match.captures.forEach(c => captureMap[c.name] = c.node);

      if (!captureMap['call']) return;

      const nameNode = captureMap['call.name'];
      if (!nameNode) return;

      const calledName = nameNode.text;

      const routed = callRouter(calledName, captureMap['call']);
      if (routed) {
        switch (routed.kind) {
          case 'skip':
          case 'import':
            return;

          case 'heritage':
            for (const item of routed.items) {
              collectedHeritage.push({
                filePath: file.path,
                className: item.enclosingClass,
                parentName: item.mixinName,
                kind: item.heritageKind,
              });
            }
            return;

          case 'properties': {
            const fileId = generateId('File', file.path);
            const propEnclosingClassId = findEnclosingClassId(captureMap['call'], file.path);
            for (const item of routed.items) {
              const nodeId = generateId('Property', `${file.path}:${item.propName}`);
              graph.addNode({
                id: nodeId,
                label: 'Property' as any, // TODO: add 'Property' to graph node label union
                properties: {
                  name: item.propName, filePath: file.path,
                  startLine: item.startLine, endLine: item.endLine,
                  language, isExported: true,
                  description: item.accessorType,
                },
              });
              ctx.symbols.add(file.path, item.propName, nodeId, 'Property',
                propEnclosingClassId ? { ownerId: propEnclosingClassId } : undefined);
              const relId = generateId('DEFINES', `${fileId}->${nodeId}`);
              graph.addRelationship({
                id: relId, sourceId: fileId, targetId: nodeId,
                type: 'DEFINES', confidence: 1.0, reason: '',
              });
              if (propEnclosingClassId) {
                graph.addRelationship({
                  id: generateId('HAS_METHOD', `${propEnclosingClassId}->${nodeId}`),
                  sourceId: propEnclosingClassId, targetId: nodeId,
                  type: 'HAS_METHOD', confidence: 1.0, reason: '',
                });
              }
            }
            return;
          }

          case 'call':
            break;
        }
      }

      if (isBuiltInOrNoise(calledName)) return;

      const callNode = captureMap['call'];
      const callForm = inferCallForm(callNode, nameNode);
      const receiverName = callForm === 'member' ? extractReceiverName(nameNode) : undefined;
      let receiverTypeName = receiverName && typeEnv ? typeEnv.lookup(receiverName, callNode) : undefined;
      // Fall back to verified constructor bindings for return type inference
      if (!receiverTypeName && receiverName && verifiedReceivers.size > 0) {
        const enclosingFunc = findEnclosingFunction(callNode, file.path, ctx);
        const funcName = enclosingFunc ? extractFuncNameFromSourceId(enclosingFunc) : '';
        receiverTypeName = verifiedReceivers.get(receiverKey(funcName, receiverName))
          ?? verifiedReceivers.get(receiverKey('', receiverName));
      }

      // C++: extract qualifier type from qualified_identifier (e.g. Type::method → 'Type')
      let qualifierTypeName: string | undefined;
      if (callForm === 'free') {
        const nameParent = nameNode.parent;
        if (nameParent?.type === 'qualified_identifier') {
          const scopeNode = nameParent.childForFieldName('scope');
          if (scopeNode) {
            const text = scopeNode.type === 'qualified_identifier'
              ? scopeNode.lastNamedChild?.text
              : scopeNode.text;
            if (text && text.length > 0) qualifierTypeName = text;
          }
        }
      }

      const enclosingFuncId = findEnclosingFunction(callNode, file.path, ctx);
      const rawSourceId = enclosingFuncId || generateId('File', file.path);
      const sourceId =
        lang === SupportedLanguages.CPlusPlus
          ? remapCppCallableSourceId(graph, ctx.symbols, file.path, rawSourceId)
          : rawSourceId;
      const callerOwner = tryCppOwnerClassIdFromCallSourceId(sourceId);

      const dbgMode = getCallResolutionDebugMode();
      const resolved = resolveCallTarget(
        {
          calledName,
          argCount: countCallArguments(callNode),
          callForm,
          receiverTypeName,
          qualifierTypeName,
        },
        file.path,
        ctx,
        callerOwner,
        dbgMode === 'off'
          ? undefined
          : {
            filePath: file.path,
            line: callNode.startPosition.row + 1,
            sourceId,
            receiverName,
          },
      );

      if (!resolved) return;

      const relId = generateId('CALLS', `${sourceId}:${calledName}->${resolved.nodeId}`);

      graph.addRelationship({
        id: relId,
        sourceId,
        targetId: resolved.nodeId,
        type: 'CALLS',
        confidence: resolved.confidence,
        reason: resolved.reason,
      });
    });

    ctx.clearCache();
  }

  if (skippedByLang && skippedByLang.size > 0) {
    for (const [lang, count] of skippedByLang.entries()) {
      console.warn(
        `[ingestion] Skipped ${count} ${lang} file(s) in call processing — ${lang} parser not available.`
      );
    }
  }

  return collectedHeritage;
};

/**
 * Resolution result with confidence scoring
 */
interface ResolveResult {
  nodeId: string;
  confidence: number;
  reason: string;
}

const CALLABLE_SYMBOL_TYPES = new Set([
  'Function',
  'Method',
  'Constructor',
  'Macro',
  'Delegate',
]);

const CONSTRUCTOR_TARGET_TYPES = new Set(['Constructor', 'Class', 'Struct', 'Record']);

/**
 * Whether a call site with `argCount` arguments can invoke this symbol, given optional
 * `parameterCount` / `minimumParameterCount` from the indexer (C++ trailing defaults).
 */
export const symbolArityAcceptsArgCount = (
  candidate: SymbolDefinition,
  argCount: number,
): boolean => {
  const max = candidate.parameterCount;
  if (max === undefined) return true;
  const min = candidate.minimumParameterCount;
  if (min !== undefined) {
    return argCount >= min && argCount <= max;
  }
  return argCount === max;
};

const filterCallableCandidates = (
  candidates: readonly SymbolDefinition[],
  argCount?: number,
  callForm?: 'free' | 'member' | 'constructor',
): SymbolDefinition[] => {
  let kindFiltered: SymbolDefinition[];

  if (callForm === 'constructor') {
    const constructors = candidates.filter(c => c.type === 'Constructor');
    if (constructors.length > 0) {
      kindFiltered = constructors;
    } else {
      const types = candidates.filter(c => CONSTRUCTOR_TARGET_TYPES.has(c.type));
      kindFiltered = types.length > 0 ? types : candidates.filter(c => CALLABLE_SYMBOL_TYPES.has(c.type));
    }
  } else {
    kindFiltered = candidates.filter(c => CALLABLE_SYMBOL_TYPES.has(c.type));
  }

  if (kindFiltered.length === 0) return [];
  if (argCount === undefined) return kindFiltered;

  const hasParameterMetadata = kindFiltered.some(candidate => candidate.parameterCount !== undefined);
  if (!hasParameterMetadata) return kindFiltered;

  return kindFiltered.filter(candidate => symbolArityAcceptsArgCount(candidate, argCount));
};

const toResolveResult = (
  definition: SymbolDefinition,
  tier: ResolutionTier,
): ResolveResult => ({
  nodeId: definition.nodeId,
  confidence: TIER_CONFIDENCE[tier],
  reason: tier === 'same-file' ? 'same-file' : tier === 'import-scoped' ? 'import-resolved' : 'global',
});

/** Optional row / caller context for `GITNEXUS_DEBUG_CALLS` logs (worker + sequential paths). */
export interface CallResolutionDebugContext {
  filePath: string;
  line?: number;
  sourceId: string;
  receiverName?: string;
}

const formatCandidateBrief = (c: SymbolDefinition): string => {
  const base = path.basename(c.filePath);
  const pc = c.parameterCount;
  const pmin = c.minimumParameterCount;
  const paramStr =
    pc === undefined ? 'n/a' : pmin !== undefined ? `${pmin}-${pc}` : String(pc);
  return `${c.nodeId} | kind=${c.type} | paramCount=${paramStr} | ownerId=${c.ownerId ?? 'n/a'} | file=${base}`;
};

const wantCallResolutionLog = (
  calledName: string,
  kind: 'entry' | 'failure' | 'success',
): boolean => {
  const mode = getCallResolutionDebugMode();
  if (mode === 'off') return false;
  const nf = getCallResolutionDebugNameFilter();
  if (nf && calledName !== nf) return false;
  if (kind === 'entry' || kind === 'success') return mode === 'all';
  return true;
};

const describeResolutionScenario = (
  call: Pick<ExtractedCall, 'callForm' | 'qualifierTypeName'>,
): string => {
  if (call.qualifierTypeName) {
    return '(1) Type::method / ns::func - qualifierTypeName narrows to class/namespace';
  }
  if (call.callForm === 'member') {
    return '(2)(3) obj.method / ptr->method - narrow via receiver static type (TypeEnv + member-field index)';
  }
  return 'unqualified call - tier + arity; optional caller-owner preference';
};

/**
 * Resolve a function call to its target node ID using priority strategy:
 * A. Narrow candidates by scope tier via ctx.resolve()
 * B. Filter to callable symbol kinds (constructor-aware when callForm is set)
 * C. Apply arity filtering when parameter metadata is available
 * C2. If C empties the tier but member+receiverTypeName (or qualifierTypeName) is set, widen to
 *     lookupFuzzy + same arity/kind filter so D/E can disambiguate (same-file wrong-class same-name).
 * D. Apply receiver-type filtering for member calls with typed receivers
 * E. Apply qualifier-type filtering for C++ qualified calls (Type::method)
 *
 * If filtering still leaves multiple candidates, refuse to emit a CALLS edge.
 *
 * Callee lookup uses the **short name** only (`ctx.resolve` / `lookupFuzzy`). The `#…` overload
 * segment in Method **node ids** is not used as a lookup key (future: class+name then hash tier).
 *
 * @param callerOwnerClassId — C++ `Class:Foo` / `Struct:Bar` for the calling method's owner; used to
 *   disambiguate unqualified calls (`helper()`) when several same-named symbols exist in one file.
 */
const resolveCallTarget = (
  call: Pick<ExtractedCall, 'calledName' | 'argCount' | 'callForm' | 'receiverTypeName' | 'qualifierTypeName'>,
  currentFile: string,
  ctx: ResolutionContext,
  callerOwnerClassId?: string,
  debugCtx?: CallResolutionDebugContext,
): ResolveResult | null => {
  const { calledName } = call;
  const mode = getCallResolutionDebugMode();

  if (mode === 'all' && wantCallResolutionLog(calledName, 'entry')) {
    console.log('[gitnexus:call-resolution]', JSON.stringify({
      event: 'resolve_start',
      lookupNote: 'Uses short callee name via ctx.resolve/lookupFuzzy; Method id #hash is NOT a lookup key.',
      scenario: describeResolutionScenario(call),
      file: path.basename(currentFile),
      ...debugCtx,
      calledName,
      argCount: call.argCount,
      callForm: call.callForm,
      receiverTypeName: call.receiverTypeName,
      qualifierTypeName: call.qualifierTypeName,
      callerOwnerClassId,
    }));
  }

  const fail = (reason: string, extra?: Record<string, unknown>): null => {
    if (wantCallResolutionLog(calledName, 'failure')) {
      console.warn('[gitnexus:call-resolution]', JSON.stringify({
        event: 'resolve_fail',
        reason,
        file: path.basename(currentFile),
        ...debugCtx,
        calledName,
        argCount: call.argCount,
        callForm: call.callForm,
        receiverTypeName: call.receiverTypeName,
        qualifierTypeName: call.qualifierTypeName,
        callerOwnerClassId,
        scenario: describeResolutionScenario(call),
        ...extra,
      }));
    }
    return null;
  };

  const tiered = ctx.resolve(call.calledName, currentFile);
  if (!tiered) {
    return fail('ctx.resolve(calledName) returned null - no symbols indexed for this short name');
  }

  let filteredCandidates = filterCallableCandidates(tiered.candidates, call.argCount, call.callForm);
  if (filteredCandidates.length === 0) {
    const recoverViaReceiver = call.callForm === 'member' && !!call.receiverTypeName;
    const recoverViaQualifier = !!call.qualifierTypeName;
    if (!recoverViaReceiver && !recoverViaQualifier) {
      return fail('no candidates after callable-kind + arity filter', {
        tier: tiered.tier,
        rawTierCount: tiered.candidates.length,
        rawTierSample: tiered.candidates.slice(0, 12).map(formatCandidateBrief),
      });
    }
    filteredCandidates = filterCallableCandidates(
      ctx.symbols.lookupFuzzy(call.calledName),
      call.argCount,
      call.callForm,
    );
    if (filteredCandidates.length === 0) {
      return fail('no candidates after callable-kind + arity filter (global fuzzy after same-file arity wipe)', {
        tier: tiered.tier,
        rawTierCount: tiered.candidates.length,
        rawTierSample: tiered.candidates.slice(0, 12).map(formatCandidateBrief),
        recoveryAttempted: recoverViaReceiver ? 'receiver+widen' : 'qualifier+widen',
      });
    }
  }

  // D. Receiver-type filtering: for member calls with a known receiver type,
  // resolve the type through the same tiered import infrastructure, then
  // filter method candidates to the type's defining file. Fall back to
  // fuzzy ownerId matching only when file-based narrowing is inconclusive.
  //
  // Applied regardless of candidate count — the sole same-file candidate may
  // belong to the wrong class (e.g. super.save() should hit the parent's save,
  // not the child's own save method in the same file).
  if (call.callForm === 'member' && call.receiverTypeName) {
    const typeResolved = ctx.resolve(call.receiverTypeName, currentFile);
    if (!typeResolved || typeResolved.candidates.length === 0) {
      if (mode === 'all' && wantCallResolutionLog(calledName, 'entry')) {
        console.log('[gitnexus:call-resolution]', JSON.stringify({
          event: 'trace',
          msg: 'member call: receiverTypeName present but type not resolved - receiver narrowing skipped',
          receiverTypeName: call.receiverTypeName,
          postArityCount: filteredCandidates.length,
          postAritySample: filteredCandidates.slice(0, 8).map(formatCandidateBrief),
        }));
      }
    } else if (typeResolved.candidates.length > 0) {
      const typeNodeIds = new Set(typeResolved.candidates.map(d => d.nodeId));
      const typeFiles = new Set(typeResolved.candidates.map(d => d.filePath));

      const methodPool = filteredCandidates.length <= 1
        ? filterCallableCandidates(ctx.symbols.lookupFuzzy(call.calledName), call.argCount, call.callForm)
        : filteredCandidates;

      const fileFiltered = methodPool.filter(c => typeFiles.has(c.filePath));
      if (fileFiltered.length === 1) {
        const r = toResolveResult(fileFiltered[0], tiered.tier);
        if (mode === 'all' && wantCallResolutionLog(calledName, 'success')) {
          console.log('[gitnexus:call-resolution]', JSON.stringify({
            event: 'resolve_ok',
            via: 'receiver_file_match',
            targetId: r.nodeId,
            ...debugCtx,
            calledName,
          }));
        }
        return r;
      }

      const pool = fileFiltered.length > 0 ? fileFiltered : methodPool;
      const ownerFiltered = pool.filter(c => c.ownerId && typeNodeIds.has(c.ownerId));
      if (ownerFiltered.length === 1) {
        const r = toResolveResult(ownerFiltered[0], tiered.tier);
        if (mode === 'all' && wantCallResolutionLog(calledName, 'success')) {
          console.log('[gitnexus:call-resolution]', JSON.stringify({
            event: 'resolve_ok',
            via: 'receiver_ownerId_match',
            targetId: r.nodeId,
            ...debugCtx,
            calledName,
          }));
        }
        return r;
      }
      if (fileFiltered.length > 1 || ownerFiltered.length > 1) {
        return fail('ambiguous after receiver-type narrowing (class+method not unique; next step: match owner/type then overload hash)', {
          receiverTypeName: call.receiverTypeName,
          typeCandidates: typeResolved.candidates.map(c => ({ id: c.nodeId, file: path.basename(c.filePath) })),
          methodPoolSize: methodPool.length,
          fileFilteredCount: fileFiltered.length,
          fileFilteredSample: fileFiltered.map(formatCandidateBrief),
          ownerFilteredCount: ownerFiltered.length,
          ownerFilteredSample: ownerFiltered.map(formatCandidateBrief),
        });
      }
    }
  }

  // E. Qualifier-type filtering: for C++ qualified calls (Type::method / NS::func),
  // treat the qualifier as the receiver type and narrow candidates to that class/namespace.
  if (call.qualifierTypeName) {
    const qualResolved = ctx.resolve(call.qualifierTypeName, currentFile);
    if (!qualResolved || qualResolved.candidates.length === 0) {
      if (mode === 'all' && wantCallResolutionLog(calledName, 'entry')) {
        console.log('[gitnexus:call-resolution]', JSON.stringify({
          event: 'trace',
          msg: 'qualified call: qualifierTypeName not resolved - qualifier narrowing skipped',
          qualifierTypeName: call.qualifierTypeName,
        }));
      }
    } else {
      const qualNodeIds = new Set(qualResolved.candidates.map(d => d.nodeId));
      const qualFiles = new Set(qualResolved.candidates.map(d => d.filePath));

      const methodPool = filteredCandidates.length <= 1
        ? filterCallableCandidates(ctx.symbols.lookupFuzzy(call.calledName), call.argCount, call.callForm)
        : filteredCandidates;

      const fileFiltered = methodPool.filter(c => qualFiles.has(c.filePath));
      if (fileFiltered.length === 1) {
        const r = toResolveResult(fileFiltered[0], tiered.tier);
        if (mode === 'all' && wantCallResolutionLog(calledName, 'success')) {
          console.log('[gitnexus:call-resolution]', JSON.stringify({
            event: 'resolve_ok',
            via: 'qualifier_file_match',
            targetId: r.nodeId,
            ...debugCtx,
            calledName,
          }));
        }
        return r;
      }

      const pool = fileFiltered.length > 0 ? fileFiltered : methodPool;
      const ownerFiltered = pool.filter(c => c.ownerId && qualNodeIds.has(c.ownerId));
      if (ownerFiltered.length === 1) {
        const r = toResolveResult(ownerFiltered[0], tiered.tier);
        if (mode === 'all' && wantCallResolutionLog(calledName, 'success')) {
          console.log('[gitnexus:call-resolution]', JSON.stringify({
            event: 'resolve_ok',
            via: 'qualifier_ownerId_match',
            targetId: r.nodeId,
            ...debugCtx,
            calledName,
          }));
        }
        return r;
      }
      if (fileFiltered.length > 1 || ownerFiltered.length > 1) {
        return fail('ambiguous after qualifier-type narrowing', {
          qualifierTypeName: call.qualifierTypeName,
          qualCandidates: qualResolved.candidates.map(c => ({ id: c.nodeId, file: path.basename(c.filePath) })),
          methodPoolSize: methodPool.length,
          fileFilteredSample: fileFiltered.map(formatCandidateBrief),
          ownerFilteredSample: ownerFiltered.map(formatCandidateBrief),
        });
      }
    }
  }

  // F. C++: prefer callee Method/Constructor owned by the caller's class when multiple
  //    candidates share the same name (e.g. same .cpp defines A::f and B::f, or `init()` overloads).
  if (callerOwnerClassId && filteredCandidates.length > 1) {
    const owned = filteredCandidates.filter(
      c => c.ownerId === callerOwnerClassId && (c.type === 'Method' || c.type === 'Constructor'),
    );
    if (owned.length === 1) {
      const r = toResolveResult(owned[0], tiered.tier);
      if (mode === 'all' && wantCallResolutionLog(calledName, 'success')) {
        console.log('[gitnexus:call-resolution]', JSON.stringify({
          event: 'resolve_ok',
          via: 'caller_owner_class',
          targetId: r.nodeId,
          ...debugCtx,
          calledName,
        }));
      }
      return r;
    }
  }

  if (filteredCandidates.length !== 1) {
    return fail(
      'multiple candidates remain; refusing ambiguous CALLS - narrow with receiver static type, Type::method qualifier, or unique arity/owner metadata',
      {
        tier: tiered.tier,
        finalCount: filteredCandidates.length,
        finalSample: filteredCandidates.map(formatCandidateBrief),
      },
    );
  }

  const r = toResolveResult(filteredCandidates[0], tiered.tier);
  if (mode === 'all' && wantCallResolutionLog(calledName, 'success')) {
    console.log('[gitnexus:call-resolution]', JSON.stringify({
      event: 'resolve_ok',
      via: 'single_tier_candidate',
      targetId: r.nodeId,
      ...debugCtx,
      calledName,
    }));
  }
  return r;
};

// ── Return type text helpers ─────────────────────────────────────────────
// extractSimpleTypeName works on AST nodes; this operates on raw return-type
// text already stored in SymbolDefinition (e.g. "User", "Promise<User>",
// "User | null", "*User").  Extracts the base user-defined type name.

/** Primitive / built-in types that should NOT produce a receiver binding. */
const PRIMITIVE_TYPES = new Set([
  'string', 'number', 'boolean', 'void', 'int', 'float', 'double', 'long',
  'short', 'byte', 'char', 'bool', 'str', 'i8', 'i16', 'i32', 'i64',
  'u8', 'u16', 'u32', 'u64', 'f32', 'f64', 'usize', 'isize',
  'undefined', 'null', 'None', 'nil',
]);

/**
 * Extract a simple type name from raw return-type text.
 * Handles common patterns:
 *   "User"                → "User"
 *   "Promise<User>"       → "User"   (unwrap wrapper generics)
 *   "Option<User>"        → "User"
 *   "Result<User, Error>" → "User"   (first type arg)
 *   "User | null"         → "User"   (strip nullable union)
 *   "User?"               → "User"   (strip nullable suffix)
 *   "*User"               → "User"   (Go pointer)
 *   "&User"               → "User"   (Rust reference)
 * Returns undefined for complex types or primitives.
 */
const WRAPPER_GENERICS = new Set([
  'Promise', 'Observable', 'Future', 'CompletableFuture', 'Task', 'ValueTask',  // async wrappers
  'Option', 'Some', 'Optional', 'Maybe',                                         // nullable wrappers
  'Result', 'Either',                                                             // result wrappers
  // Rust smart pointers (Deref to inner type)
  'Rc', 'Arc', 'Weak',                                                          // pointer types
  'MutexGuard', 'RwLockReadGuard', 'RwLockWriteGuard',                          // guard types
  'Ref', 'RefMut',                                                               // RefCell guards
  'Cow',                                                                         // copy-on-write
  // Containers (List, Array, Vec, Set, etc.) are intentionally excluded —
  // methods are called on the container, not the element type.
  // Non-wrapper generics return the base type (e.g., List) via the else branch.
]);

/**
 * Extracts the first type argument from a comma-separated generic argument string,
 * respecting nested angle brackets. For example:
 *   "Result<User, Error>"  → "Result<User, Error>"  (no top-level comma)
 *   "User, Error"          → "User"
 *   "Map<K, V>, string"    → "Map<K, V>"
 */
function extractFirstGenericArg(args: string): string {
  let depth = 0;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '<') depth++;
    else if (args[i] === '>') depth--;
    else if (args[i] === ',' && depth === 0) return args.slice(0, i).trim();
  }
  return args.trim();
}

/**
 * Extract the first non-lifetime type argument from a generic argument string.
 * Skips Rust lifetime parameters (e.g., `'a`, `'_`) to find the actual type.
 *   "'_, User"       → "User"
 *   "'a, User"       → "User"
 *   "User, Error"    → "User"  (no lifetime — delegates to extractFirstGenericArg)
 */
function extractFirstTypeArg(args: string): string {
  let remaining = args;
  while (remaining) {
    const first = extractFirstGenericArg(remaining);
    if (!first.startsWith("'")) return first;
    // Skip past this lifetime arg + the comma separator
    const commaIdx = remaining.indexOf(',', first.length);
    if (commaIdx < 0) return first; // only lifetimes — fall through
    remaining = remaining.slice(commaIdx + 1).trim();
  }
  return args.trim();
}

export const extractReturnTypeName = (raw: string): string | undefined => {
  let text = raw.trim();
  if (!text) return undefined;

  // Strip pointer/reference prefixes: *User, &User, &mut User
  text = text.replace(/^[&*]+\s*(mut\s+)?/, '');

  // Strip nullable suffix: User?
  text = text.replace(/\?$/, '');

  // Handle union types: "User | null" → "User"
  if (text.includes('|')) {
    const parts = text.split('|').map(p => p.trim()).filter(p =>
      p !== 'null' && p !== 'undefined' && p !== 'void' && p !== 'None' && p !== 'nil'
    );
    if (parts.length === 1) text = parts[0];
    else return undefined; // genuine union — too complex
  }

  // Handle generics: Promise<User> → unwrap if wrapper, else take base
  const genericMatch = text.match(/^(\w+)\s*<(.+)>$/);
  if (genericMatch) {
    const [, base, args] = genericMatch;
    if (WRAPPER_GENERICS.has(base)) {
      // Take the first non-lifetime type argument, using bracket-balanced splitting
      // so that nested generics like Result<User, Error> are not split at the inner
      // comma. Lifetime parameters (Rust 'a, '_) are skipped.
      const firstArg = extractFirstTypeArg(args);
      return extractReturnTypeName(firstArg);
    }
    // Non-wrapper generic: return the base type (e.g., Map<K,V> → Map)
    return PRIMITIVE_TYPES.has(base.toLowerCase()) ? undefined : base;
  }

  // Bare wrapper type without generic argument (e.g. Task, Promise, Option)
  // should not produce a binding — these are meaningless without a type parameter
  if (WRAPPER_GENERICS.has(text)) return undefined;

  // Handle qualified names: models.User → User, Models::User → User, \App\Models\User → User
  if (text.includes('::') || text.includes('.') || text.includes('\\')) {
    text = text.split(/::|[.\\]/).pop()!;
  }

  // Final check: skip primitives
  if (PRIMITIVE_TYPES.has(text) || PRIMITIVE_TYPES.has(text.toLowerCase())) return undefined;

  // Must start with uppercase (class/type convention) or be a valid identifier
  if (!/^[A-Z_]\w*$/.test(text)) return undefined;

  return text;
};

// ── Scope key helpers ────────────────────────────────────────────────────
// Scope keys use the format "funcName@startIndex" (produced by type-env.ts).
// Source IDs use "Label:filepath:funcName" (produced by parse-worker.ts).
// NUL (\0) is used as a composite-key separator because it cannot appear
// in source-code identifiers, preventing ambiguous concatenation.

/** Extract the function name from a scope key ("funcName@startIndex" → "funcName"). */
const extractFuncNameFromScope = (scope: string): string =>
  scope.slice(0, scope.indexOf('@'));

/**
 * Enclosing symbol name from sourceId (e.g. `Function:a/b.cpp:foo` → `foo`,
 * `Method:Class:C:bar#deadbeef` → `bar`).
 */
const extractFuncNameFromSourceId = (sourceId: string): string => {
  const lastColon = sourceId.lastIndexOf(':');
  let tail = lastColon >= 0 ? sourceId.slice(lastColon + 1) : sourceId;
  const hashIdx = tail.indexOf('#');
  if (hashIdx >= 0) tail = tail.slice(0, hashIdx);
  return tail;
};

/** For C++ member-field lookup: `Method:Class:Owner:fn#…` / `Constructor:…` → `Class:Owner` id. */
const tryCppOwnerClassIdFromCallSourceId = (sourceId: string): string | undefined => {
  if (!sourceId.startsWith('Method:') && !sourceId.startsWith('Constructor:')) return undefined;
  const stem = sourceId.slice(sourceId.indexOf(':') + 1);
  const stemNoHash = stem.split('#')[0] ?? '';
  const parts = stemNoHash.split(':');
  if (parts.length < 3) return undefined;
  if (parts[0] !== 'Class' && parts[0] !== 'Struct') return undefined;
  return `${parts[0]}:${parts[1]}`;
};

/**
 * When AST-derived id (overload hash) does not match the symbol table / graph node id
 * (e.g. .h vs .cpp fingerprint drift), remap to a registered node id so Ladybug COPY succeeds.
 */
const remapCppCallableSourceId = (
  graph: KnowledgeGraph,
  symbols: SymbolTable,
  filePath: string,
  sourceId: string,
): string => {
  if (graph.getNode(sourceId)) return sourceId;

  const label = sourceId.split(':')[0];
  if (label !== 'Method' && label !== 'Constructor') return sourceId;

  const rest = sourceId.slice(sourceId.indexOf(':') + 1);
  const hashIdx = rest.lastIndexOf('#');
  const stem = hashIdx >= 0 ? rest.slice(0, hashIdx) : rest;
  const hashSeg = hashIdx >= 0 ? rest.slice(hashIdx + 1) : '';

  const parts = stem.split(':');
  if (parts.length < 3) return sourceId;
  if (parts[0] !== 'Class' && parts[0] !== 'Struct') return sourceId;
  const ownerClassId = `${parts[0]}:${parts[1]}`;
  const callableName = parts.slice(2).join(':');

  const defs = symbols.lookupExactAllFull(filePath, callableName).filter(
    d =>
      d.ownerId === ownerClassId &&
      (d.type === 'Method' || d.type === 'Constructor'),
  );
  if (defs.length === 0) return sourceId;

  if (defs.length === 1) return defs[0].nodeId;

  if (hashSeg) {
    const byHash = defs.find(d => d.nodeId.endsWith(`#${hashSeg}`));
    if (byHash) return byHash.nodeId;
  }

  const inGraph = defs.find(d => graph.getNode(d.nodeId));
  if (inGraph) return inGraph.nodeId;

  return defs[0].nodeId;
};

/** Build a scope-aware composite key for receiver type lookup. */
const receiverKey = (funcName: string, varName: string): string =>
  `${funcName}\0${varName}`;

/**
 * Fast path: resolve pre-extracted call sites from workers.
 * No AST parsing — workers already extracted calledName + sourceId.
 */
export const processCallsFromExtracted = async (
  graph: KnowledgeGraph,
  extractedCalls: ExtractedCall[],
  ctx: ResolutionContext,
  onProgress?: (current: number, total: number) => void,
  constructorBindings?: FileConstructorBindings[],
) => {
  // Scope-aware receiver types: keyed by filePath → "funcName\0varName" → typeName.
  // The scope dimension prevents collisions when two functions in the same file
  // have same-named locals pointing to different constructor types.
  const fileReceiverTypes = new Map<string, Map<string, string>>();
  if (constructorBindings) {
    for (const { filePath, bindings } of constructorBindings) {
      const verified = verifyConstructorBindings(bindings, filePath, ctx, graph);
      if (verified.size > 0) {
        fileReceiverTypes.set(filePath, verified);
      }
    }
  }

  const byFile = new Map<string, ExtractedCall[]>();
  for (const call of extractedCalls) {
    let list = byFile.get(call.filePath);
    if (!list) { list = []; byFile.set(call.filePath, list); }
    list.push(call);
  }

  const totalFiles = byFile.size;
  let filesProcessed = 0;

  for (const [filePath, calls] of byFile) {
    filesProcessed++;
    if (filesProcessed % 100 === 0) {
      onProgress?.(filesProcessed, totalFiles);
      await yieldToEventLoop();
    }

    ctx.enableCache(filePath);
    const receiverMap = fileReceiverTypes.get(filePath);

    for (const call of calls) {
      let effectiveCall = call;
      if (!call.receiverTypeName && call.receiverName && receiverMap) {
        const callFuncName = extractFuncNameFromSourceId(call.sourceId);
        const resolvedType = receiverMap.get(receiverKey(callFuncName, call.receiverName))
          ?? receiverMap.get(receiverKey('', call.receiverName)); // fall back to file-level scope
        if (resolvedType) {
          effectiveCall = { ...call, receiverTypeName: resolvedType };
        }
      }

      // C++: cross-TU member variables (declared in .h) — SymbolTable memberFieldIndex, not available in worker TypeEnv
      if (
        !effectiveCall.receiverTypeName &&
        effectiveCall.receiverName &&
        getLanguageFromFilename(filePath) === SupportedLanguages.CPlusPlus
      ) {
        const ownerId = tryCppOwnerClassIdFromCallSourceId(effectiveCall.sourceId);
        if (ownerId) {
          const ft = ctx.symbols.lookupMemberFieldType(ownerId, effectiveCall.receiverName);
          if (ft) {
            effectiveCall = { ...effectiveCall, receiverTypeName: ft };
          }
        }
      }

      const langFile = getLanguageFromFilename(filePath);
      let sourceId = effectiveCall.sourceId;
      if (langFile === SupportedLanguages.CPlusPlus) {
        sourceId = remapCppCallableSourceId(graph, ctx.symbols, filePath, sourceId);
      }
      const callerOwner = tryCppOwnerClassIdFromCallSourceId(sourceId);
      const callForResolve = sourceId === effectiveCall.sourceId ? effectiveCall : { ...effectiveCall, sourceId };

      const dbgMode = getCallResolutionDebugMode();
      const resolved = resolveCallTarget(
        callForResolve,
        effectiveCall.filePath,
        ctx,
        callerOwner,
        dbgMode === 'off'
          ? undefined
          : {
            filePath,
            line: effectiveCall.line,
            sourceId,
            receiverName: effectiveCall.receiverName,
          },
      );
      if (!resolved) continue;

      const relId = generateId('CALLS', `${sourceId}:${effectiveCall.calledName}->${resolved.nodeId}`);
      graph.addRelationship({
        id: relId,
        sourceId,
        targetId: resolved.nodeId,
        type: 'CALLS',
        confidence: resolved.confidence,
        reason: resolved.reason,
      });
    }

    ctx.clearCache();
  }

  onProgress?.(totalFiles, totalFiles);
};

/**
 * Resolve pre-extracted Laravel routes to CALLS edges from route files to controller methods.
 */
export const processRoutesFromExtracted = async (
  graph: KnowledgeGraph,
  extractedRoutes: ExtractedRoute[],
  ctx: ResolutionContext,
  onProgress?: (current: number, total: number) => void,
) => {
  for (let i = 0; i < extractedRoutes.length; i++) {
    const route = extractedRoutes[i];
    if (i % 50 === 0) {
      onProgress?.(i, extractedRoutes.length);
      await yieldToEventLoop();
    }

    if (!route.controllerName || !route.methodName) continue;

    const controllerResolved = ctx.resolve(route.controllerName, route.filePath);
    if (!controllerResolved || controllerResolved.candidates.length === 0) continue;
    if (controllerResolved.tier === 'global' && controllerResolved.candidates.length > 1) continue;

    const controllerDef = controllerResolved.candidates[0];
    const confidence = TIER_CONFIDENCE[controllerResolved.tier];

    const methodResolved = ctx.resolve(route.methodName, controllerDef.filePath);
    const methodId = methodResolved?.tier === 'same-file' ? methodResolved.candidates[0]?.nodeId : undefined;
    const sourceId = generateId('File', route.filePath);

    if (!methodId) {
      // Use controller's nodeId as scope to match the merged nodeId scheme (class-scoped, not file-scoped).
      const guessedId = generateId('Method', `${controllerDef.nodeId}:${route.methodName}`);
      const relId = generateId('CALLS', `${sourceId}:route->${guessedId}`);
      graph.addRelationship({
        id: relId,
        sourceId,
        targetId: guessedId,
        type: 'CALLS',
        confidence: confidence * 0.8,
        reason: 'laravel-route',
      });
      continue;
    }

    const relId = generateId('CALLS', `${sourceId}:route->${methodId}`);
    graph.addRelationship({
      id: relId,
      sourceId,
      targetId: methodId,
      type: 'CALLS',
      confidence,
      reason: 'laravel-route',
    });
  }

  onProgress?.(extractedRoutes.length, extractedRoutes.length);
};

// ── C++ CALLS: add direct CALLS → Class/Struct when only Method/Constructor edges exist ──
// Example: caller has Method:Class:TZmdbStrFunc:StrCmpNoCase and Class:TZmdbCCryptDES but no
// CALLS → Class:TZmdbStrFunc — emit synthetic CALLS to the owner class node for completeness.

/** `Method:` / `Constructor:` id stem starts with `Class:` or `Struct:` (not file-path TU stem). */
const cppMethodLikeTargetIdHasClassOrStructScope = (nodeId: string): boolean => {
  if (!nodeId.startsWith('Method:') && !nodeId.startsWith('Constructor:')) return false;
  const rest = nodeId.slice(nodeId.indexOf(':') + 1);
  const stem = rest.split('#')[0] ?? '';
  const first = stem.split(':')[0];
  return first === 'Class' || first === 'Struct';
};

/** `Function:path/to/file.cpp:funcName` → file path (everything before last `:`). */
const cppFilePathFromFunctionSourceId = (sourceId: string): string | undefined => {
  if (!sourceId.startsWith('Function:')) return undefined;
  const rest = sourceId.slice('Function:'.length);
  const lastColon = rest.lastIndexOf(':');
  if (lastColon <= 0) return undefined;
  return rest.slice(0, lastColon);
};

const isCppFunctionLikeCaller = (graph: KnowledgeGraph, sourceId: string): boolean => {
  const n = graph.getNode(sourceId);
  if (!n) return false;
  if (n.label !== 'Function' && n.label !== 'Method' && n.label !== 'Constructor') return false;
  if (n.properties.language === SupportedLanguages.CPlusPlus) return true;
  const fp = n.properties.filePath;
  if (fp && getLanguageFromFilename(fp) === SupportedLanguages.CPlusPlus) return true;
  const fromFunc = cppFilePathFromFunctionSourceId(sourceId);
  if (fromFunc && getLanguageFromFilename(fromFunc) === SupportedLanguages.CPlusPlus) return true;
  return false;
};

/**
 * For each C++ Function/Method/Constructor caller: if a CALLS target is a class-scoped
 * Method/Constructor, ensure there is also a CALLS edge to its owner `Class:X` / `Struct:X`
 * when that class node exists and is not already a CALLS target from the same caller.
 */
export const enrichCppCallsTargetsFromSiblingClassScope = (graph: KnowledgeGraph): void => {
  const bySource = new Map<string, GraphRelationship[]>();
  for (const rel of graph.relationships) {
    if (rel.type !== 'CALLS') continue;
    let list = bySource.get(rel.sourceId);
    if (!list) {
      list = [];
      bySource.set(rel.sourceId, list);
    }
    list.push(rel);
  }

  for (const [sourceId, rels] of bySource) {
    if (!isCppFunctionLikeCaller(graph, sourceId)) continue;

    const callTargets = new Set(rels.filter(r => r.type === 'CALLS').map(r => r.targetId));
    const ownersMissingClassEdge = new Set<string>();

    for (const r of rels) {
      if (r.type !== 'CALLS') continue;
      if (!cppMethodLikeTargetIdHasClassOrStructScope(r.targetId)) continue;
      const ownerId = tryCppOwnerClassIdFromCallSourceId(r.targetId);
      if (!ownerId) continue;
      const callee = graph.getNode(r.targetId);
      if (!callee) continue;
      if (callee.label !== 'Method' && callee.label !== 'Constructor') continue;
      if (callTargets.has(ownerId)) continue;
      if (!graph.getNode(ownerId)) continue;
      ownersMissingClassEdge.add(ownerId);
    }

    for (const ownerId of ownersMissingClassEdge) {
      const pseudoCallee = `<cpp-owner-class>${ownerId}`;
      graph.addRelationship({
        id: generateId('CALLS', `${sourceId}:${pseudoCallee}->${ownerId}`),
        sourceId,
        targetId: ownerId,
        type: 'CALLS',
        confidence: 0.85,
        reason: 'cpp-method-implies-owner-class',
      });
      callTargets.add(ownerId);
    }
  }
};
