import type { SessionId } from "@shared/ids.js";
import { MARKDOWN_TRANSFORM_MAX_INPUT_BYTES } from "@shared/pi-protocol/markdown-transform.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ querySession: vi.fn() }));
vi.mock("./session-intent.js", () => ({ querySession: mocks.querySession }));

import { requestExtensionMarkdownTransform } from "./extension-markdown.js";

const SID = "session-a" as SessionId;

describe("extension Markdown batching", () => {
  beforeEach(() => mocks.querySession.mockReset());

  it("coalesces requests by exact owner and correlates reordered results", async () => {
    const owner = { hostInstanceId: "host-a", sessionEpoch: 2 };
    let resolveQuery: (value: unknown) => void = () => {};
    const queryResult = new Promise((resolve) => {
      resolveQuery = resolve;
    });
    mocks.querySession.mockImplementation(() => queryResult);
    const transformed = Promise.all([
      requestExtensionMarkdownTransform(SID, owner, {
        markdown: "one",
        messageType: "user",
        isStreaming: false,
        availableWidth: 80,
      }),
      requestExtensionMarkdownTransform(SID, owner, {
        markdown: "two",
        messageType: "assistant",
        isStreaming: true,
        availableWidth: 80,
      }),
    ]);
    await vi.waitFor(() => expect(mocks.querySession).toHaveBeenCalledOnce());
    const query = mocks.querySession.mock.calls[0]?.[1] as {
      items: Array<{ requestId: string; markdown: string }>;
    };
    const [first, second] = query.items;
    resolveQuery({
      status: "ok",
      queryId: "query-a",
      owner,
      queryType: "transform_markdown",
      response: {
        type: "response",
        command: "transform_markdown",
        success: true,
        data: {
          items: [
            { requestId: second?.requestId, markdown: "transformed-two" },
            { requestId: first?.requestId, markdown: "transformed-one" },
          ],
        },
      },
    });
    await expect(transformed).resolves.toEqual(["transformed-one", "transformed-two"]);
    expect(mocks.querySession).toHaveBeenCalledOnce();
    expect(mocks.querySession.mock.calls[0]?.[1]).toMatchObject({
      type: "transform_markdown",
      items: [{ markdown: "one" }, { markdown: "two" }],
    });
    expect(mocks.querySession.mock.calls[0]?.[2]).toEqual({ owner });
  });

  it("falls back to the original Markdown when the owner query is stale", async () => {
    mocks.querySession.mockResolvedValue({
      status: "stale_owner",
      queryId: "query-stale",
      owner: { hostInstanceId: "host-b", sessionEpoch: 0 },
      queryType: "transform_markdown",
    });
    await expect(
      requestExtensionMarkdownTransform(
        SID,
        { hostInstanceId: "host-a", sessionEpoch: 3 },
        {
          markdown: "original",
          messageType: "assistant-thinking",
          isStreaming: false,
          availableWidth: 72,
        },
      ),
    ).resolves.toBe("original");
  });

  it("bypasses the host for one oversized UTF-8 input", async () => {
    const markdown = "😀".repeat(MARKDOWN_TRANSFORM_MAX_INPUT_BYTES / 4 + 1);
    await expect(
      requestExtensionMarkdownTransform(
        SID,
        { hostInstanceId: "host-a", sessionEpoch: 4 },
        {
          markdown,
          messageType: "assistant",
          isStreaming: false,
          availableWidth: 80,
        },
      ),
    ).resolves.toBe(markdown);
    expect(mocks.querySession).not.toHaveBeenCalled();
  });

  it("splits one owner queue at the serialized request byte budget", async () => {
    const owner = { hostInstanceId: "host-a", sessionEpoch: 5 };
    mocks.querySession.mockImplementation(async (...args: unknown[]) => {
      const query = args[1] as { items: Array<{ requestId: string }> } | undefined;
      const items = query?.items ?? [];
      return {
        status: "ok",
        queryId: `query-${mocks.querySession.mock.calls.length}`,
        owner,
        queryType: "transform_markdown",
        response: {
          type: "response",
          command: "transform_markdown",
          success: false,
          error: `${items.length} raw fallbacks`,
        },
      };
    });
    const pending = Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        requestExtensionMarkdownTransform(SID, owner, {
          markdown: `${index}:${"x".repeat(220 * 1024)}`,
          messageType: "assistant",
          isStreaming: false,
          availableWidth: 80,
        }),
      ),
    );

    await expect(pending).resolves.toEqual([
      expect.stringMatching(/^0:/),
      expect.stringMatching(/^1:/),
      expect.stringMatching(/^2:/),
      expect.stringMatching(/^3:/),
      expect.stringMatching(/^4:/),
    ]);
    expect(mocks.querySession).toHaveBeenCalledTimes(2);
    expect(mocks.querySession.mock.calls[0]?.[1].items).toHaveLength(4);
    expect(mocks.querySession.mock.calls[1]?.[1].items).toHaveLength(1);
  });
});
