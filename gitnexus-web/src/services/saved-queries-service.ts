/**
 * Saved Queries Service
 *
 * Persists user Cypher queries to localStorage.
 * On first load, seeds built-in example queries.
 */

const STORAGE_KEY = 'gitnexus-saved-queries';

export interface SavedQuery {
  id: string;
  label: string;
  query: string;
  isBuiltin: boolean;
  createdAt: number;
}

function generateId(): string {
  return `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function loadSavedQueries(): SavedQuery[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is SavedQuery =>
        typeof item?.id === 'string' &&
        typeof item?.label === 'string' &&
        typeof item?.query === 'string' &&
        typeof item?.isBuiltin === 'boolean' &&
        typeof item?.createdAt === 'number'
    );
  } catch {
    return [];
  }
}

function persistQueries(queries: SavedQuery[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queries));
  } catch (error) {
    console.error('Failed to persist saved queries:', error);
  }
}

/**
 * Initialize built-in queries on first load.
 * If localStorage already has data, does nothing.
 */
export function initializeBuiltins(
  builtins: { label: string; query: string }[]
): void {
  if (builtins.length === 0) return;
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored !== null) return; // already initialized

  const queries: SavedQuery[] = builtins.map((b) => ({
    id: generateId(),
    label: b.label,
    query: b.query,
    isBuiltin: true,
    createdAt: Date.now(),
  }));
  persistQueries(queries);
}

export function saveQuery(label: string, query: string): SavedQuery {
  const queries = loadSavedQueries();
  const newQuery: SavedQuery = {
    id: generateId(),
    label,
    query,
    isBuiltin: false,
    createdAt: Date.now(),
  };
  persistQueries([...queries, newQuery]);
  return newQuery;
}

export function deleteQuery(id: string): void {
  const queries = loadSavedQueries();
  persistQueries(queries.filter((q) => q.id !== id));
}
