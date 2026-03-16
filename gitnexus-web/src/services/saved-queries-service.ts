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
    return JSON.parse(stored) as SavedQuery[];
  } catch {
    return [];
  }
}

function persistQueries(queries: SavedQuery[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(queries));
}

/**
 * Initialize built-in queries on first load.
 * If localStorage already has data, does nothing.
 */
export function initializeBuiltins(
  builtins: { label: string; query: string }[]
): void {
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
