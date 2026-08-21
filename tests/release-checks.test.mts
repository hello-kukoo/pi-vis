import { describe, expect, it } from "vitest";
import { RELEASE_CHECKS } from "../scripts/release-checks.mjs";

describe("public release verification contract", () => {
  it("starts from a clean install and runs every automated release lane", () => {
    expect(RELEASE_CHECKS).toEqual([
      ["npm", ["ci"]],
      ["npm", ["audit", "--omit=dev"]],
      ["npm", ["run", "typecheck"]],
      ["npm", ["run", "lint"]],
      ["npm", ["test"]],
      ["npm", ["run", "test:render"]],
      ["npm", ["run", "test:e2e"]],
      ["npm", ["ls", "--all"]],
    ]);
  });
});
