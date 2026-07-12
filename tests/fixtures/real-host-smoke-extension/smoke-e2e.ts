// @ts-nocheck — loaded by the real Pi extension loader in an isolated agent dir.
export default function (pi) {
  pi.registerCommand("smoke-e2e", {
    description: "Verify the real SDK host command pipeline without model API usage",
    handler: async (_args, ctx) => {
      ctx.ui.notify("Real SDK host command completed", "info");
    },
  });
}
