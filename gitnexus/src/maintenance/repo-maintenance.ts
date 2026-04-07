/**
 * In-memory registry of repos currently undergoing scheduled re-index.
 * Used by HTTP API and LocalBackend to return 503 / explicit errors.
 */

const maintenanceByNameLower = new Set<string>();

export const setRepoMaintenance = (repoName: string, active: boolean): void => {
  const k = repoName.trim().toLowerCase();
  if (!k) return;
  if (active) maintenanceByNameLower.add(k);
  else maintenanceByNameLower.delete(k);
};

export const isRepoUnderMaintenance = (repoName: string): boolean =>
  maintenanceByNameLower.has(repoName.trim().toLowerCase());

export const getMaintenanceRepoNames = (): string[] => [...maintenanceByNameLower];
