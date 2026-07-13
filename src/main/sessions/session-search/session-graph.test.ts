import { describe, expect, it } from "vitest";
import { buildSessionGraph } from "./session-graph.js";

const entry = (id: string, fileOrdinal: number, parentId?: string) => ({
  id,
  fileOrdinal,
  ...(parentId ? { parentId } : {}),
});

describe("buildSessionGraph", () => {
  it("keeps all branches and chooses the latest persisted leaf deterministically", () => {
    const graph = buildSessionGraph(
      [entry("a", 1, "root"), entry("old", 2, "a"), entry("new", 3, "a")],
      ["root"],
    );
    expect(graph.paths.map((path) => path.map((item) => item.id))).toEqual([
      ["a", "old"],
      ["a", "new"],
    ]);
    expect(graph.latestPersistedPath.map((item) => item.id)).toEqual(["a", "new"]);
  });

  it("indexes duplicate IDs once and preserves orphan/cycle content safely", () => {
    const graph = buildSessionGraph([
      entry("duplicate", 1),
      entry("duplicate", 9),
      entry("orphan", 2, "gone"),
      entry("cycle-a", 3, "cycle-b"),
      entry("cycle-b", 4, "cycle-a"),
    ]);
    expect(graph.byId.get("duplicate")?.fileOrdinal).toBe(1);
    expect(graph.orphanIds).toContain("orphan");
    // The natural orphan leaf wins latest persisted ordering; cycle handling
    // must still terminate and retain all valid entries.
    expect(graph.entries).toHaveLength(4);
    expect([...graph.paths.flat()].map((item) => item.id)).toEqual(
      expect.arrayContaining(["orphan", "cycle-a", "cycle-b"]),
    );
    expect([...graph.cycleIds]).toEqual(expect.arrayContaining(["cycle-a", "cycle-b"]));
  });
});
