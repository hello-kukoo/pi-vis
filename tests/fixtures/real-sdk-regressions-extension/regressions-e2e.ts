import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

// Keep this fixture self-contained when Pi loads it from the throwaway agent
// directory. This is the public pi-tui matchesKey Escape behavior for the
// bytes delivered by the panel bridge; importing pi-tui from an extension
// would incorrectly depend on a developer/host module-resolution layout.
const matchesKey = (data: string, key: "escape"): boolean =>
  key === "escape" && (data === "\u001b" || data === "\u001b[27;1;27~");

export const STATIC_DOCK_SENTINEL = "REAL-REGRESSION-STATIC-DOCK";
export const ABOVE_SENTINEL = "REAL-REGRESSION-FACTORY-ABOVE";
export const BELOW_SENTINEL = "REAL-REGRESSION-FACTORY-BELOW";
export const REPLACED_SENTINEL = "REAL-REGRESSION-FACTORY-REPLACED";
export const CUSTOM_SENTINEL = "REAL-REGRESSION-CUSTOM-OVERLAY";
export const CUSTOM_DONE_SENTINEL = "REAL-REGRESSION-CUSTOM-DONE";
export const NAME_SENTINEL = "REAL-REGRESSION-EXACT-SESSION-NAME";
export const WRONG_COMPACT_SENTINEL = "REAL-REGRESSION-WRONG-COMPACT-COLLISION";
export const SCOPED_MODELS_SENTINEL = "REAL-REGRESSION-SCOPED-MODELS";
export const TERMINATING_TOOL_SENTINEL = "REAL-REGRESSION-TERMINATE-BLOCKED";
export const TERMINATING_TOOL_REASON = "REAL-REGRESSION-TERMINATING-POLICY";
export const MARKDOWN_SOURCE_SENTINEL = "REAL-REGRESSION-MARKDOWN-SOURCE";
export const MARKDOWN_TRANSFORMED_SENTINEL = "REAL-REGRESSION-MARKDOWN-TRANSFORMED";
export const EXPANDED_COMMAND_SENTINEL = "REAL-REGRESSION-EXPANDED-COMMAND";
export const DEFERRED_CUSTOM_SENTINEL = "REAL-REGRESSION-DEFERRED-CUSTOM";
export const DEFERRED_CUSTOM_TOOL_COMMAND = "REAL-REGRESSION-DEFER-CUSTOM-DURING-TOOL";

// Keep the copied fixture dependency-free at runtime. This is the ordinary
// TypeBox empty-object record shape Pi expects for a no-argument tool.
const EMPTY_TOOL_PARAMETERS = {
  type: "object",
  properties: {},
  "~kind": "Object",
} as never;

const staticWidget = (ctx: ExtensionContext) => {
  ctx.ui.setWidget("real-regression-static-dock", [STATIC_DOCK_SENTINEL]);
};

const factory = (label: string, ctx: ExtensionContext) => () => ({
  render: () => [`${label} session=${ctx.sessionManager.getSessionId().slice(-8)}`],
  invalidate() {},
  dispose() {},
});

const installFactories = (ctx: ExtensionContext) => {
  ctx.ui.setWidget("real-regression-above", factory(ABOVE_SENTINEL, ctx), {
    placement: "aboveEditor",
  });
  ctx.ui.setWidget("real-regression-below", factory(BELOW_SENTINEL, ctx), {
    placement: "belowEditor",
  });
};

export default function realSdkRegressions(pi: ExtensionAPI) {
  pi.registerTool({
    name: "regression-custom-tool",
    label: "Regression custom tool",
    description: "Deterministic custom tool used to verify defaultTools preservation.",
    parameters: EMPTY_TOOL_PARAMETERS,
    async execute() {
      return {
        content: [{ type: "text", text: "REAL-REGRESSION-CUSTOM-TOOL-RESULT" }],
        details: {},
      };
    },
  });

  pi.registerMarkdownTransformer((markdown, context) =>
    markdown.replace(
      MARKDOWN_SOURCE_SENTINEL,
      `${MARKDOWN_TRANSFORMED_SENTINEL}:${context.messageType}`,
    ),
  );

  pi.on("tool_call", (event) => {
    const command = (event.input as { command?: unknown }).command;
    if (event.toolName === "bash" && command === DEFERRED_CUSTOM_TOOL_COMMAND) {
      pi.sendMessage(
        {
          customType: "real-regression-deferred-custom",
          content: DEFERRED_CUSTOM_SENTINEL,
          display: true,
        },
        { triggerTurn: false },
      );
    }
    if (event.toolName === "bash" && command === TERMINATING_TOOL_SENTINEL) {
      return { block: true, reason: TERMINATING_TOOL_REASON, terminate: true };
    }
  });

  pi.on("session_start", (_event, ctx) => {
    if (!ctx.hasUI) return;
    staticWidget(ctx);
    installFactories(ctx);
    if (ctx.scopedModels.length > 0) {
      const scope = ctx.scopedModels
        .map(
          ({ model, thinkingLevel }) =>
            `${model.provider}/${model.id}:${thinkingLevel ?? "inherit"}`,
        )
        .join(",");
      ctx.ui.setWidget("real-regression-scoped-models", [
        `${SCOPED_MODELS_SENTINEL} current=${ctx.model?.provider}/${ctx.model?.id} thinking=${ctx.thinkingLevel} scope=${scope}`,
      ]);
    }
  });

  pi.registerCommand("regression-replace-factory", {
    description: "Replace the real factory widget",
    handler: async (_args, ctx) => {
      ctx.ui.setWidget("real-regression-below", factory(REPLACED_SENTINEL, ctx), {
        placement: "belowEditor",
      });
    },
  });
  pi.registerCommand("regression-remove-above", {
    description: "Remove the above real factory widget",
    handler: async (_args, ctx) => ctx.ui.setWidget("real-regression-above", undefined),
  });
  pi.registerCommand("regression-remove-below", {
    description: "Remove the below real factory widget",
    handler: async (_args, ctx) => ctx.ui.setWidget("real-regression-below", undefined),
  });
  pi.registerCommand("regression-custom", {
    description: "Open a real custom overlay which completes on Escape",
    handler: async (_args, ctx) => {
      let completed = false;
      await ctx.ui.custom<void>(
        (_tui, _theme, _keybindings, done) => ({
          render: () => [CUSTOM_SENTINEL, "Press Escape to finish"],
          invalidate() {},
          handleInput(data) {
            if (matchesKey(data, "escape") && !completed) {
              completed = true;
              done();
            }
          },
        }),
        { overlay: true },
      );
      ctx.ui.notify(CUSTOM_DONE_SENTINEL, "info");
    },
  });
  pi.registerCommand("regression-name", {
    description: "Set the exact real regression session name",
    handler: async () => pi.setSessionName(NAME_SENTINEL),
  });
  pi.registerCommand("regression-expand-target", {
    description: "Notify when expandPromptTemplates dispatches this command",
    handler: async (_args, ctx) => ctx.ui.notify(EXPANDED_COMMAND_SENTINEL, "info"),
  });
  pi.registerCommand("regression-expand-source", {
    description: "Dispatch another extension command through sendUserMessage expansion",
    handler: async () => {
      pi.sendUserMessage("/regression-expand-target", { expandPromptTemplates: true });
    },
  });
  // Pi's native /compact must win this discovered collision.
  pi.registerCommand("compact", {
    description: "Must be shadowed by Pi's built-in compact command",
    handler: async (_args, ctx) => ctx.ui.notify(WRONG_COMPACT_SENTINEL, "error"),
  });
}
