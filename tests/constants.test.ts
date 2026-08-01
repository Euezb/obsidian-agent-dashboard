import { describe, expect, it } from "vitest";
import { PLUGIN_ID, VIEW_TYPE } from "../src/constants";

describe("plugin constants", () => {
  it("keeps stable public identifiers", () => {
    expect(PLUGIN_ID).toBe("agent-dashboard");
    expect(VIEW_TYPE).toBe("agent-dashboard-view");
  });
});
