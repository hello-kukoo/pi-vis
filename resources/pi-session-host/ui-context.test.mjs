import { describe, expect, it, vi } from "vitest";
import { createUIContext } from "./ui-context.mjs";

// The host's ExtensionUIContext must hand extensions the SAME return values pi's
// own uiContext does, or extension menu code breaks. The canonical contract
// (verified against pi-mcp-adapter + pi-subagents usage):
//   select → string  (the chosen option) | undefined (cancel)
//   confirm → boolean
//   input  → string | undefined (cancel)
//   editor → string | undefined (cancel)
// The bug this guards: createDialog resolves with the raw ExtensionUiResponse
// object ({type,id,value}), so the host was returning the OBJECT. pi-subagents
// does `choice.startsWith("Running agents (")` → TypeError on an object → the
// `/agents` handler dies before opening any submenu (e.g. Settings).

/** Build a uiContext whose createDialog resolves with a fixed wire response. */
function ctxWithDialog(response) {
  return createUIContext({
    theme: { fg: () => "" },
    panelBridge: {},
    createDialog: vi.fn(async () => response),
    sendToMain: vi.fn(),
    tuiModules: {},
  });
}

describe("uiContext dialog return-value contract", () => {
  it("select returns the chosen option STRING (not the response object)", async () => {
    const ui = ctxWithDialog({ type: "extension_ui_response", id: "s1", value: "Settings" });
    const choice = await ui.select("Agents", ["Settings"]);
    expect(choice).toBe("Settings");
    // The exact thing pi-subagents does — must not throw on the result.
    expect(typeof choice.startsWith).toBe("function");
  });

  it("select returns undefined on cancel (pi-mcp-adapter checks === undefined)", async () => {
    const ui = ctxWithDialog({ type: "extension_ui_response", id: "s1", cancelled: true });
    expect(await ui.select("Agents", ["a"])).toBeUndefined();
  });

  it("confirm returns a boolean true on confirm, false on cancel", async () => {
    expect(
      await ctxWithDialog({ type: "extension_ui_response", id: "c", confirmed: true }).confirm(
        "ok?",
      ),
    ).toBe(true);
    expect(
      await ctxWithDialog({ type: "extension_ui_response", id: "c", cancelled: true }).confirm(
        "ok?",
      ),
    ).toBe(false);
  });

  it("input returns the typed string, or undefined on cancel", async () => {
    expect(
      await ctxWithDialog({ type: "extension_ui_response", id: "i", value: "42" }).input("n"),
    ).toBe("42");
    expect(
      await ctxWithDialog({ type: "extension_ui_response", id: "i", cancelled: true }).input("n"),
    ).toBeUndefined();
  });

  it("editor returns the edited string, or undefined on cancel", async () => {
    expect(
      await ctxWithDialog({ type: "extension_ui_response", id: "e", value: "body" }).editor("t"),
    ).toBe("body");
    expect(
      await ctxWithDialog({ type: "extension_ui_response", id: "e", cancelled: true }).editor("t"),
    ).toBeUndefined();
  });

  it("passes the right method + args through to createDialog", async () => {
    const createDialog = vi.fn(async () => ({ value: "x" }));
    const ui = createUIContext({
      theme: {},
      panelBridge: {},
      createDialog,
      sendToMain: vi.fn(),
      tuiModules: {},
    });
    await ui.select("Pick", ["x", "y"], { timeout: 5 });
    expect(createDialog).toHaveBeenCalledWith("select", "Pick", {
      options: ["x", "y"],
      opts: { timeout: 5 },
    });
  });
});

describe("uiContext fire-and-forget + no-op methods", () => {
  it("notify/setStatus/setTitle/setWidget route to sendToMain without throwing", () => {
    const sendToMain = vi.fn();
    const ui = createUIContext({
      theme: {},
      panelBridge: {},
      createDialog: vi.fn(),
      sendToMain,
      tuiModules: {},
    });
    ui.notify("hi", "info");
    ui.setStatus("k", "v");
    ui.setTitle("T");
    ui.setWidget("w", ["line"]);
    expect(sendToMain).toHaveBeenCalledTimes(4);
    expect(sendToMain.mock.calls[0][0]).toMatchObject({ method: "notify", message: "hi" });
  });

  it("TUI-only methods are safe no-ops (must not throw)", () => {
    const ui = createUIContext({
      theme: {},
      panelBridge: {},
      createDialog: vi.fn(),
      sendToMain: vi.fn(),
      tuiModules: {},
    });
    expect(() => {
      ui.setFooter(() => {});
      ui.setHeader(() => {});
      ui.setWorkingIndicator({});
      ui.setEditorComponent(() => {});
      ui.getToolsExpanded();
      const dispose = ui.onTerminalInput(() => {});
      dispose();
    }).not.toThrow();
  });
});
