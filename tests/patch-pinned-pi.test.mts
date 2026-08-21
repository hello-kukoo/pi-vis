import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import {
  PINNED_PI_PATCH_FILES,
  PINNED_PI_PATCH_VERSION,
  patchPinnedPi,
} from "../scripts/patch-pinned-pi.mjs";

const roots: string[] = [];

const temporaryDirectory = (prefix: string): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  roots.push(root);
  return root;
};

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

const userMessage = (text: string) => ({
  role: "user" as const,
  content: text,
  timestamp: Date.now(),
});

const assistantMessage = (text: string) => ({
  role: "assistant" as const,
  content: [{ type: "text" as const, text }],
  api: "anthropic-messages" as const,
  provider: "pivis-test",
  model: "pivis-test",
  usage: {
    input: 1,
    output: 1,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 2,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  stopReason: "stop" as const,
  timestamp: Date.now(),
});

const createPersistedSession = (): { root: string; file: string } => {
  const root = temporaryDirectory("pivis-pi-tail-");
  const manager = SessionManager.create(root, root);
  manager.appendMessage(userMessage("u1"));
  manager.appendMessage(assistantMessage("a1"));
  const file = manager.getSessionFile();
  if (!file) throw new Error("expected a persisted Pi session");
  return { root, file };
};

const roles = (manager: SessionManager): string[] =>
  manager.getBranch().map((entry) => (entry.type === "message" ? entry.message.role : entry.type));

describe("exact Pi 0.84.2 runtime patch", () => {
  it("verifies every installed patch target by exact hash", () => {
    expect(PINNED_PI_PATCH_VERSION).toBe("0.84.2");
    expect(PINNED_PI_PATCH_FILES).toHaveLength(3);
    expect(patchPinnedPi({ verifyOnly: true })).toMatchObject({
      changed: false,
      verified: true,
    });
  });

  it("fails closed before reading patch targets for a different package version", () => {
    const root = temporaryDirectory("pivis-pi-patch-version-");
    const codingAgent = path.join(root, "pi-coding-agent");
    const piAi = path.join(root, "pi-ai");
    fs.mkdirSync(codingAgent, { recursive: true });
    fs.mkdirSync(piAi, { recursive: true });
    fs.writeFileSync(path.join(codingAgent, "package.json"), JSON.stringify({ version: "0.84.3" }));
    fs.writeFileSync(path.join(piAi, "package.json"), JSON.stringify({ version: "0.84.2" }));

    expect(() =>
      patchPinnedPi({
        packageDirectory: codingAgent,
        piAiPackageDirectory: piAi,
        verifyOnly: true,
      }),
    ).toThrow("requires coding-agent and pi-ai 0.84.2");
  });

  it("fails closed on unknown bytes in an exact-version dependency tree", () => {
    const root = temporaryDirectory("pivis-pi-patch-drift-");
    const codingAgent = path.join(root, "pi-coding-agent");
    const piAi = path.join(root, "pi-ai");
    for (const directory of [codingAgent, piAi]) {
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(path.join(directory, "package.json"), JSON.stringify({ version: "0.84.2" }));
    }
    for (const spec of PINNED_PI_PATCH_FILES) {
      const target = path.join(
        spec.owner === "coding-agent" ? codingAgent : piAi,
        spec.relativePath,
      );
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, "unrecognized runtime bytes");
    }

    expect(() =>
      patchPinnedPi({
        packageDirectory: codingAgent,
        piAiPackageDirectory: piAi,
        verifyOnly: true,
      }),
    ).toThrow("refused drifted");
  });

  it.each([
    ["invalid fragment", (file: string) => fs.appendFileSync(file, '{"type":"message"')],
    [
      "valid record without a delimiter",
      (file: string) => {
        const content = fs.readFileSync(file);
        expect(content.at(-1)).toBe(0x0a);
        fs.writeFileSync(file, content.subarray(0, content.length - 1));
      },
    ],
  ])("repairs an %s before the next SessionManager append", (_name, damage) => {
    const { root, file } = createPersistedSession();
    damage(file);

    const recovered = SessionManager.open(file, root);
    // Loading is read-only; the first following append performs the repair.
    recovered.appendMessage(userMessage("u2"));
    recovered.appendMessage(assistantMessage("a2"));
    recovered.appendMessage(userMessage("u3"));

    const reopened = SessionManager.open(file, root);
    expect(roles(reopened)).toEqual(["user", "assistant", "user", "assistant", "user"]);
    const content = fs.readFileSync(file, "utf8");
    expect(content.endsWith("\n")).toBe(true);
    for (const line of content.split("\n").filter(Boolean))
      expect(() => JSON.parse(line)).not.toThrow();
  });

  it("keeps fragmented Mistral tool-call deltas on one indexed call", async () => {
    const modulePath = path.resolve(
      "node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/api/mistral-conversations.js",
    );
    const { stream } = (await import(pathToFileURL(modulePath).href)) as {
      stream: (
        model: unknown,
        context: unknown,
        options: unknown,
      ) => {
        result(): Promise<{ stopReason: string; content: unknown[] }>;
      };
    };
    const chunks = [
      {
        id: "mistral-fragmented-tool",
        choices: [
          {
            delta: {
              content: null,
              tool_calls: [
                {
                  id: "chatcmpl-tool-pivis",
                  index: 0,
                  type: "function",
                  function: { name: "read", arguments: '{"path":"update' },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      },
      {
        id: "mistral-fragmented-tool",
        choices: [
          {
            delta: {
              content: null,
              tool_calls: [
                {
                  index: 0,
                  type: "function",
                  function: { name: "", arguments: '.sh"}' },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      },
    ];
    const sse = `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`;
    const model = {
      id: "pivis-mistral-test",
      name: "Pi-Vis Mistral Test",
      api: "mistral-conversations",
      provider: "mistral",
      baseUrl: "https://mistral.invalid",
      reasoning: false,
      input: ["text"],
      contextWindow: 8_192,
      maxTokens: 512,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    };
    const result = await stream(
      model,
      { messages: [] },
      {
        apiKey: "isolated-test-key",
        fetch: async () =>
          new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } }),
      },
    ).result();

    expect(result.stopReason).toBe("toolUse");
    expect(result.content).toEqual([
      {
        type: "toolCall",
        id: "chatcmpl-tool-pivis",
        name: "read",
        arguments: { path: "update.sh" },
      },
    ]);
  });
});
