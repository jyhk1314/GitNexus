import { GraphNode, GraphRelationship, KnowledgeGraph } from './types.js';
import { SupportedLanguages } from '../../config/supported-languages.js';

/** C++ translation-unit suffixes: out-of-line method definitions live here. */
const CPP_IMPL_PATH = /\.(cpp|cc|cxx)$/i;

/**
 * Later ingest pass from a .cpp/.cc/.cxx wins over any earlier node with the same id for C++
 * Method/Constructor (declaration in .h or a prior .cpp). Overloads use distinct ids via the
 * type-only parameter fingerprint in parsing.
 */
const isCppMethodImplementationOverride = (node: GraphNode): boolean => {
  if (node.label !== 'Method' && node.label !== 'Constructor') return false;
  if (node.properties?.language !== SupportedLanguages.CPlusPlus) return false;
  const fp = node.properties?.filePath ?? '';
  return CPP_IMPL_PATH.test(fp);
};

export const createKnowledgeGraph = (): KnowledgeGraph => {
  const nodeMap = new Map<string, GraphNode>();
  const relationshipMap = new Map<string, GraphRelationship>();

  const addNode = (node: GraphNode) => {
    if (!nodeMap.has(node.id)) {
      nodeMap.set(node.id, node);
      return;
    }
    if (isCppMethodImplementationOverride(node)) {
      nodeMap.set(node.id, node);
    }
  };

  const addRelationship = (relationship: GraphRelationship) => {
    if (!relationshipMap.has(relationship.id)) {
      relationshipMap.set(relationship.id, relationship);
    }
  };

  /**
   * Remove a single node and all relationships involving it
   */
  const removeNode = (nodeId: string): boolean => {
    if (!nodeMap.has(nodeId)) return false;
    
    nodeMap.delete(nodeId);
    
    // Remove all relationships involving this node
    for (const [relId, rel] of relationshipMap) {
      if (rel.sourceId === nodeId || rel.targetId === nodeId) {
        relationshipMap.delete(relId);
      }
    }
    return true;
  };

  /**
   * Remove all nodes (and their relationships) belonging to a file
   */
  const removeNodesByFile = (filePath: string): number => {
    let removed = 0;
    for (const [nodeId, node] of nodeMap) {
      if (node.properties?.filePath === filePath) {
        removeNode(nodeId);
        removed++;
      }
    }
    return removed;
  };

  return{
    get nodes(){
      return Array.from(nodeMap.values())
    },

    get relationships(){
      return Array.from(relationshipMap.values())
    },

    iterNodes: () => nodeMap.values(),
    iterRelationships: () => relationshipMap.values(),
    forEachNode(fn: (node: GraphNode) => void) { nodeMap.forEach(fn); },
    forEachRelationship(fn: (rel: GraphRelationship) => void) { relationshipMap.forEach(fn); },
    getNode: (id: string) => nodeMap.get(id),

    // O(1) count getters - avoid creating arrays just for length
    get nodeCount() {
      return nodeMap.size;
    },

    get relationshipCount() {
      return relationshipMap.size;
    },

    addNode,
    addRelationship,
    removeNode,
    removeNodesByFile,

  };
};
