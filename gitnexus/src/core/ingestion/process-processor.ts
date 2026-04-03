/**
 * Process Detection Processor
 * 
 * Detects execution flows (Processes) in the code graph by:
 * 1. Finding entry points (functions with no internal callers)
 * 2. Tracing forward via CALLS edges (BFS)
 * 3. Grouping and deduplicating similar paths
 * 4. Labeling with heuristic names
 * 
 * Processes help agents understand how features work through the codebase.
 */

import { KnowledgeGraph, GraphNode, GraphRelationship, NodeLabel } from '../graph/types.js';
import { CommunityMembership } from './community-processor.js';
import { calculateEntryPointScore, isTestFile } from './entry-point-scoring.js';
import { SupportedLanguages } from '../../config/supported-languages.js';
import {
  type ProcessFilterConfig,
  filePathMatchesProcessFilter,
  classNameMatchesProcessFilter,
} from './gitnexus-filter.js';

export type { ProcessFilterConfig } from './gitnexus-filter.js';

const isDev = process.env.NODE_ENV === 'development';

// ============================================================================
// CONFIGURATION
// ============================================================================

export interface ProcessDetectionConfig {
  maxTraceDepth: number;      // Maximum steps to trace (default: 10)
  maxBranching: number;       // Max branches to follow per node (default: 3)
  maxProcesses: number;       // Maximum processes to detect (default: 50)
  minSteps: number;           // Minimum steps for a valid process (default: 2)
}

const DEFAULT_CONFIG: ProcessDetectionConfig = {
  maxTraceDepth: 10,
  maxBranching: 4,
  maxProcesses: 75,
  minSteps: 3,       // 3+ steps = genuine multi-hop flow (2-step is just "A calls B")
};

// ============================================================================
// TYPES
// ============================================================================

export interface ProcessNode {
  id: string;                    // "proc_handleLogin_createSession"
  label: string;                 // "HandleLogin → CreateSession"
  heuristicLabel: string;
  processType: 'intra_community' | 'cross_community';
  stepCount: number;
  communities: string[];         // Community IDs touched
  entryPointId: string;
  terminalId: string;
  trace: string[];               // Ordered array of node IDs
}

export interface ProcessStep {
  nodeId: string;
  processId: string;
  step: number;                  // 1-indexed position in trace
}

export interface ProcessDetectionResult {
  processes: ProcessNode[];
  steps: ProcessStep[];
  stats: {
    totalProcesses: number;
    crossCommunityCount: number;
    avgStepCount: number;
    entryPointsFound: number;
  };
}

// ============================================================================
// MAIN PROCESSOR
// ============================================================================

/**
 * Detect processes (execution flows) in the knowledge graph
 * 
 * This runs AFTER community detection, using CALLS edges to trace flows.
 */
export const processProcesses = async (
  knowledgeGraph: KnowledgeGraph,
  memberships: CommunityMembership[],
  onProgress?: (message: string, progress: number) => void,
  config: Partial<ProcessDetectionConfig> = {},
  processFilter?: ProcessFilterConfig,
): Promise<ProcessDetectionResult> => {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  
  onProgress?.('Finding entry points...', 0);
  
  // Build lookup maps
  const membershipMap = new Map<string, string>();
  memberships.forEach(m => membershipMap.set(m.nodeId, m.communityId));
  
  const callsEdges = buildCallsGraph(knowledgeGraph);
  const reverseCallsEdges = buildReverseCallsGraph(knowledgeGraph);
  const nodeMap = new Map<string, GraphNode>();
  for (const n of knowledgeGraph.iterNodes()) nodeMap.set(n.id, n);

  const methodClassMap = buildMethodToClassNameMap(knowledgeGraph);
  
  // Step 1: Find entry points (functions that call others but have few callers)
  const entryPoints = findEntryPoints(
    knowledgeGraph,
    reverseCallsEdges,
    callsEdges,
    nodeMap,
    processFilter,
  );
  
  onProgress?.(`Found ${entryPoints.length} entry points, tracing flows...`, 20);
  
  // Step 2: Trace processes from each entry point
  const allTraces: string[][] = [];
  
  for (let i = 0; i < entryPoints.length && allTraces.length < cfg.maxProcesses * 2; i++) {
    const entryId = entryPoints[i];
    const traces = traceFromEntryPoint(
      entryId,
      callsEdges,
      cfg,
      nodeMap,
      processFilter,
      methodClassMap,
    );
    
    // Filter out traces that are too short
    traces.filter(t => t.length >= cfg.minSteps).forEach(t => allTraces.push(t));
    
    if (i % 10 === 0) {
      onProgress?.(`Tracing entry point ${i + 1}/${entryPoints.length}...`, 20 + (i / entryPoints.length) * 40);
    }
  }
  
  onProgress?.(`Found ${allTraces.length} traces, deduplicating...`, 60);
  
  // Step 3: Deduplicate similar traces (subset removal)
  const uniqueTraces = deduplicateTraces(allTraces);
  
  // Step 3b: Deduplicate by entry+terminal pair (keep longest path per pair)
  const endpointDeduped = deduplicateByEndpoints(uniqueTraces);
  
  onProgress?.(`Deduped ${uniqueTraces.length} → ${endpointDeduped.length} unique endpoint pairs`, 70);
  
  // Step 4: Limit to max processes (prioritize longer traces)
  const limitedTraces = endpointDeduped
    .sort((a, b) => b.length - a.length)
    .slice(0, cfg.maxProcesses);

  const tracesAfterFilter =
    processFilter &&
    (processFilter.filePatterns.length > 0 || processFilter.classPatterns.length > 0)
      ? limitedTraces.filter(
          trace =>
            !shouldDropTraceForFilter(trace, nodeMap, processFilter, methodClassMap),
        )
      : limitedTraces;
  
  onProgress?.(`Creating ${tracesAfterFilter.length} process nodes...`, 80);
  
  // Step 5: Create process nodes
  const processes: ProcessNode[] = [];
  const steps: ProcessStep[] = [];
  
  tracesAfterFilter.forEach((trace, idx) => {
    const entryPointId = trace[0];
    const terminalId = trace[trace.length - 1];
    
    // Get communities touched
    const communitiesSet = new Set<string>();
    trace.forEach(nodeId => {
      const comm = membershipMap.get(nodeId);
      if (comm) communitiesSet.add(comm);
    });
    const communities = Array.from(communitiesSet);
    
    // Determine process type
    const processType: 'intra_community' | 'cross_community' = 
      communities.length > 1 ? 'cross_community' : 'intra_community';
    
    // Generate label
    const entryNode = nodeMap.get(entryPointId);
    const terminalNode = nodeMap.get(terminalId);
    const entryName = entryNode?.properties.name || 'Unknown';
    const terminalName = terminalNode?.properties.name || 'Unknown';
    const heuristicLabel = `${capitalize(entryName)} → ${capitalize(terminalName)}`;
    
    const processId = `proc_${idx}_${sanitizeId(entryName)}`;
    
    processes.push({
      id: processId,
      label: heuristicLabel,
      heuristicLabel,
      processType,
      stepCount: trace.length,
      communities,
      entryPointId,
      terminalId,
      trace,
    });
    
    // Create step relationships
    trace.forEach((nodeId, stepIdx) => {
      steps.push({
        nodeId,
        processId,
        step: stepIdx + 1,  // 1-indexed
      });
    });
  });
  
  onProgress?.('Process detection complete!', 100);
  
  // Calculate stats
  const crossCommunityCount = processes.filter(p => p.processType === 'cross_community').length;
  const avgStepCount = processes.length > 0 
    ? processes.reduce((sum, p) => sum + p.stepCount, 0) / processes.length 
    : 0;
  
  return {
    processes,
    steps,
    stats: {
      totalProcesses: processes.length,
      crossCommunityCount,
      avgStepCount: Math.round(avgStepCount * 10) / 10,
      entryPointsFound: entryPoints.length,
    },
  };
};

// ============================================================================
// PROCESS filter: Method → owning Class (HAS_METHOD: Class → Method)
// ============================================================================

const buildMethodToClassNameMap = (graph: KnowledgeGraph): Map<string, string> => {
  const map = new Map<string, string>();
  for (const rel of graph.iterRelationships()) {
    if (rel.type !== 'HAS_METHOD') continue;
    const cls = graph.getNode(rel.sourceId);
    if (cls?.label !== 'Class') continue;
    const name = cls.properties.name;
    if (typeof name === 'string' && name.length > 0) {
      map.set(rel.targetId, name);
    }
  }
  return map;
};

const shouldDropTraceForFilter = (
  trace: string[],
  nodeMap: Map<string, GraphNode>,
  filter: ProcessFilterConfig,
  methodClassMap: Map<string, string>,
): boolean => {
  const entry = nodeMap.get(trace[0]);
  const entryPath = entry?.properties.filePath || '';
  if (
    filter.filePatterns.length > 0 &&
    filePathMatchesProcessFilter(entryPath, filter.filePatterns)
  ) {
    return true;
  }
  if (filter.classPatterns.length === 0) return false;
  /** CLASS: middle hops skip filtered Methods in BFS; only entry can still be a filtered-class Method. */
  const n0 = nodeMap.get(trace[0]);
  if (n0?.label === 'Method') {
    const className = methodClassMap.get(trace[0]);
    if (
      className &&
      classNameMatchesProcessFilter(className, filter.classPatterns)
    ) {
      return true;
    }
  }
  return false;
};

// ============================================================================
// HELPER: Build CALLS adjacency list
// ============================================================================

type AdjacencyList = Map<string, string[]>;

/**
 * Minimum edge confidence for process tracing.
 * Filters out ambiguous fuzzy-global matches (0.3) that cause
 * traces to jump across unrelated code areas.
 */
const MIN_TRACE_CONFIDENCE = 0.5;

/** C++ process tracing: from a C++ caller, only follow CALLS into Function/Method (not Macro/Class/…). */
const CPP_TRACE_CALLEE_LABELS = new Set<NodeLabel>(['Function', 'Method']);

const isCppSymbolNode = (n: GraphNode | undefined): boolean =>
  n?.properties.language === SupportedLanguages.CPlusPlus;

const isCppTraceableCallee = (n: GraphNode | undefined): boolean =>
  !!n && CPP_TRACE_CALLEE_LABELS.has(n.label);

/**
 * Outgoing CALLS targets used for process detection. Non-C++ callers keep full adjacency;
 * C++ callers only see Function/Method targets so traces stay semantically meaningful.
 */
const getCalleesForProcessTrace = (
  sourceId: string,
  callsEdges: AdjacencyList,
  nodeMap: Map<string, GraphNode>,
): string[] => {
  const raw = callsEdges.get(sourceId) || [];
  const src = nodeMap.get(sourceId);
  if (!isCppSymbolNode(src)) return raw;
  return raw.filter(tid => isCppTraceableCallee(nodeMap.get(tid)));
};

/** True if this Method node's owning class matches CLASS filter patterns. */
const isMethodFilteredByClass = (
  nodeId: string,
  nodeMap: Map<string, GraphNode>,
  filter: ProcessFilterConfig | undefined,
  methodClassMap: Map<string, string>,
): boolean => {
  if (!filter || filter.classPatterns.length === 0) return false;
  const n = nodeMap.get(nodeId);
  if (n?.label !== 'Method') return false;
  const cn = methodClassMap.get(nodeId);
  return !!(cn && classNameMatchesProcessFilter(cn, filter.classPatterns));
};

/**
 * CLASS 过滤：若这一跳的直接 callee 是命中规则的 Method，则**不沿这条边扩展**（不进入 B）。
 * 例如 `main→A`、`main→B`、`main→B` 为过滤类时只丢掉 `main→B`，`main→A` / `main→C` 各自独立。
 */
const collectTargetsSkippingFilteredClassMethods = (
  calleeId: string,
  nodeMap: Map<string, GraphNode>,
  filter: ProcessFilterConfig,
  methodClassMap: Map<string, string>,
  path: string[],
  branchBudget: number,
): string[] => {
  if (branchBudget <= 0) return [];
  if (isMethodFilteredByClass(calleeId, nodeMap, filter, methodClassMap)) {
    return [];
  }
  if (path.includes(calleeId)) return [];
  return [calleeId];
};

const buildCallsGraph = (graph: KnowledgeGraph): AdjacencyList => {
  const adj = new Map<string, string[]>();
  
  for (const rel of graph.iterRelationships()) {
    if (rel.type === 'CALLS' && rel.confidence >= MIN_TRACE_CONFIDENCE) {
      if (!adj.has(rel.sourceId)) {
        adj.set(rel.sourceId, []);
      }
      adj.get(rel.sourceId)!.push(rel.targetId);
    }
  }

  return adj;
};

const buildReverseCallsGraph = (graph: KnowledgeGraph): AdjacencyList => {
  const adj = new Map<string, string[]>();

  for (const rel of graph.iterRelationships()) {
    if (rel.type === 'CALLS' && rel.confidence >= MIN_TRACE_CONFIDENCE) {
      if (!adj.has(rel.targetId)) {
        adj.set(rel.targetId, []);
      }
      adj.get(rel.targetId)!.push(rel.sourceId);
    }
  }
  
  return adj;
};

/**
 * Find functions/methods that are good entry points for tracing.
 * 
 * Entry points are scored based on:
 * 1. Call ratio (calls many, called by few)
 * 2. Export status (exported/public functions rank higher)
 * 3. Name patterns (handle*, on*, *Controller, etc.)
 * 
 * Test files are excluded entirely.
 */
const findEntryPoints = (
  graph: KnowledgeGraph, 
  reverseCallsEdges: AdjacencyList,
  callsEdges: AdjacencyList,
  nodeMap: Map<string, GraphNode>,
  processFilter?: ProcessFilterConfig,
): string[] => {
  const symbolTypes = new Set<NodeLabel>(['Function', 'Method']);
  const entryPointCandidates: { 
    id: string; 
    score: number; 
    reasons: string[];
  }[] = [];
  
  for (const node of graph.iterNodes()) {
    if (!symbolTypes.has(node.label)) continue;
    
    const filePath = node.properties.filePath || '';

    if (
      processFilter &&
      processFilter.filePatterns.length > 0 &&
      filePathMatchesProcessFilter(filePath, processFilter.filePatterns)
    ) {
      continue;
    }
    
    // Skip test files entirely
    if (isTestFile(filePath)) continue;

    const callers = reverseCallsEdges.get(node.id) || [];
    const callees = getCalleesForProcessTrace(node.id, callsEdges, nodeMap);

    // Must have at least 1 outgoing call to trace forward
    if (callees.length === 0) continue;

    // Calculate entry point score using new scoring system
    const { score: baseScore, reasons } = calculateEntryPointScore(
      node.properties.name,
      node.properties.language ?? SupportedLanguages.JavaScript,
      node.properties.isExported ?? false,
      callers.length,
      callees.length,
      filePath  // Pass filePath for framework detection
    );

    let score = baseScore;
    const astFrameworkMultiplier = node.properties.astFrameworkMultiplier ?? 1.0;
    if (astFrameworkMultiplier > 1.0) {
      score *= astFrameworkMultiplier;
      reasons.push(`framework-ast:${node.properties.astFrameworkReason || 'decorator'}`);
    }

    if (score > 0) {
      entryPointCandidates.push({ id: node.id, score, reasons });
    }
  }
  
  // Sort by score descending and return top candidates
  const sorted = entryPointCandidates.sort((a, b) => b.score - a.score);
  
  // DEBUG: Log top candidates with new scoring details
  if (sorted.length > 0 && isDev) {
    console.log(`[Process] Top 10 entry point candidates (new scoring):`);
    sorted.slice(0, 10).forEach((c, i) => {
      const node = graph.getNode(c.id);
      const exported = node?.properties.isExported ? '✓' : '✗';
      const shortPath = node?.properties.filePath?.split('/').slice(-2).join('/') || '';
      console.log(`  ${i+1}. ${node?.properties.name} [exported:${exported}] (${shortPath})`);
      console.log(`     score: ${c.score.toFixed(2)} = [${c.reasons.join(' × ')}]`);
    });
  }
  
  return sorted
    .slice(0, 200)  // Limit to prevent explosion
    .map(c => c.id);
};

// ============================================================================
// HELPER: Trace from entry point (BFS)
// ============================================================================

/**
 * Trace forward from an entry point using BFS.
 * Returns all distinct paths up to maxDepth.
 *
 * `PROCESS.CLASS`：命中规则的 Method 作为直接 callee 时不扩展该分支，其它出边不受影响。
 */
const traceFromEntryPoint = (
  entryId: string,
  callsEdges: AdjacencyList,
  config: ProcessDetectionConfig,
  nodeMap: Map<string, GraphNode>,
  processFilter?: ProcessFilterConfig,
  methodClassMap?: Map<string, string>,
): string[][] => {
  const traces: string[][] = [];
  
  // BFS with path tracking
  // Each queue item: [currentNodeId, pathSoFar]
  const queue: [string, string[]][] = [[entryId, [entryId]]];

  while (queue.length > 0 && traces.length < config.maxBranching * 3) {
    const [currentId, path] = queue.shift()!;
    
    // Get outgoing calls (C++ callers: Function/Method targets only)
    const callees = getCalleesForProcessTrace(currentId, callsEdges, nodeMap);
    
    if (callees.length === 0) {
      // Terminal node - this is a complete trace
      if (path.length >= config.minSteps) {
        traces.push([...path]);
      }
    } else if (path.length >= config.maxTraceDepth) {
      // Max depth reached - save what we have
      if (path.length >= config.minSteps) {
        traces.push([...path]);
      }
    } else {
      // Continue tracing - limit branching
      const limitedCallees = callees.slice(0, config.maxBranching);
      let addedBranch = false;
      let remaining = config.maxBranching;
      const useClassSkip =
        processFilter &&
        methodClassMap &&
        processFilter.classPatterns.length > 0;

      for (const calleeId of limitedCallees) {
        if (remaining <= 0) break;
        const targets = useClassSkip
          ? collectTargetsSkippingFilteredClassMethods(
              calleeId,
              nodeMap,
              processFilter,
              methodClassMap,
              path,
              remaining,
            )
          : path.includes(calleeId)
            ? []
            : [calleeId];

        for (const targetId of targets) {
          if (remaining <= 0) break;
          if (!path.includes(targetId)) {
            queue.push([targetId, [...path, targetId]]);
            addedBranch = true;
            remaining--;
          }
        }
      }

      // If all branches were cycles, save current path as terminal
      if (!addedBranch && path.length >= config.minSteps) {
        traces.push([...path]);
      }
    }
  }
  
  return traces;
};

// ============================================================================
// HELPER: Deduplicate traces
// ============================================================================

/**
 * Merge traces that are subsets of other traces.
 * Keep longer traces, remove redundant shorter ones.
 */
const deduplicateTraces = (traces: string[][]): string[][] => {
  if (traces.length === 0) return [];
  
  // Sort by length descending
  const sorted = [...traces].sort((a, b) => b.length - a.length);
  const unique: string[][] = [];
  
  for (const trace of sorted) {
    // Check if this trace is a subset of any already-added trace
    const traceKey = trace.join('->');
    const isSubset = unique.some(existing => {
      const existingKey = existing.join('->');
      return existingKey.includes(traceKey);
    });
    
    if (!isSubset) {
      unique.push(trace);
    }
  }
  
  return unique;
};

// ============================================================================
// HELPER: Deduplicate by entry+terminal endpoints
// ============================================================================

/**
 * Keep only the longest trace per unique entry→terminal pair.
 * Multiple paths between the same two endpoints are redundant for agents.
 */
const deduplicateByEndpoints = (traces: string[][]): string[][] => {
  if (traces.length === 0) return [];
  
  const byEndpoints = new Map<string, string[]>();
  // Sort longest first so the first seen per key is the longest
  const sorted = [...traces].sort((a, b) => b.length - a.length);
  
  for (const trace of sorted) {
    const key = `${trace[0]}::${trace[trace.length - 1]}`;
    if (!byEndpoints.has(key)) {
      byEndpoints.set(key, trace);
    }
  }
  
  return Array.from(byEndpoints.values());
};

// ============================================================================
// HELPER: String utilities
// ============================================================================

const capitalize = (s: string): string => {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
};

const sanitizeId = (s: string): string => {
  return s.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 20).toLowerCase();
};
