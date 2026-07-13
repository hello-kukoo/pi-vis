export interface SessionGraphEntry {
  id: string;
  parentId?: string | undefined;
  fileOrdinal: number;
}

export interface SessionGraph<T extends SessionGraphEntry> {
  /** One deterministic entry per persisted id (the first valid occurrence). */
  entries: readonly T[];
  byId: ReadonlyMap<string, T>;
  leaves: readonly T[];
  /** Every persisted leaf path, root first. Cycles are safely truncated. */
  paths: readonly (readonly T[])[];
  latestPersistedPath: readonly T[];
  latestPersistedPathIds: ReadonlySet<string>;
  orphanIds: ReadonlySet<string>;
  cycleIds: ReadonlySet<string>;
}

const persistedOrder = <T extends SessionGraphEntry>(a: T, b: T): number =>
  a.fileOrdinal - b.fileOrdinal || a.id.localeCompare(b.id);

/** Build branch metadata from persisted order, never timestamps or live state. */
export function buildSessionGraph<T extends SessionGraphEntry>(
  sourceEntries: readonly T[],
  knownRootIds: readonly string[] = [],
): SessionGraph<T> {
  const byId = new Map<string, T>();
  for (const entry of [...sourceEntries].sort(persistedOrder)) {
    if (!byId.has(entry.id)) byId.set(entry.id, entry);
  }
  const entries = [...byId.values()].sort(persistedOrder);
  const parentsWithChildren = new Set<string>();
  for (const entry of entries)
    if (entry.parentId && byId.has(entry.parentId)) parentsWithChildren.add(entry.parentId);
  let leaves = entries.filter((entry) => !parentsWithChildren.has(entry.id));
  // A pure cycle has no natural leaf, but its entries must remain visible and
  // have a deterministic path classification.
  if (!leaves.length && entries.length) leaves = [entries.at(-1) as T];

  const roots = new Set(knownRootIds);
  const orphanIds = new Set<string>();
  const cycleIds = new Set<string>();
  const walk = (leaf: T): T[] => {
    const reverse: T[] = [];
    const seen = new Set<string>();
    let current: T | undefined = leaf;
    while (current) {
      if (seen.has(current.id)) {
        for (const id of seen) cycleIds.add(id);
        break;
      }
      seen.add(current.id);
      reverse.push(current);
      if (!current.parentId || roots.has(current.parentId)) break;
      const parent = byId.get(current.parentId);
      if (!parent) {
        orphanIds.add(current.id);
        break;
      }
      current = parent;
    }
    return reverse.reverse();
  };
  const orderedLeaves = leaves.sort(persistedOrder);
  const paths: T[][] = orderedLeaves.map(walk);
  // A cycle has no leaf. Include one deterministic walk for every otherwise
  // unrepresented component so cycle entries remain available to callers.
  const represented = new Set(paths.flatMap((path) => path.map((entry) => entry.id)));
  for (const entry of [...entries].sort(persistedOrder).reverse()) {
    if (represented.has(entry.id)) continue;
    const path = walk(entry);
    paths.push(path);
    for (const item of path) represented.add(item.id);
  }
  const latestLeaf = [...orderedLeaves].at(-1);
  const latestPersistedPath = latestLeaf ? walk(latestLeaf) : [];
  return {
    entries,
    byId,
    leaves: orderedLeaves,
    paths,
    latestPersistedPath,
    latestPersistedPathIds: new Set(latestPersistedPath.map((entry) => entry.id)),
    orphanIds,
    cycleIds,
  };
}
