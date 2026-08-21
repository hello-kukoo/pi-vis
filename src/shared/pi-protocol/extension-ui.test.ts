import { describe, expect, it } from "vitest";
import {
  EXTENSION_UI_RESPONSE_ID_MAX_BYTES,
  EXTENSION_UI_RESPONSE_VALUE_MAX_BYTES,
  ExtensionUiResponseSchema,
} from "./extension-ui.js";

describe("ExtensionUiResponseSchema", () => {
  it("accepts values at the UTF-8 bounds", () => {
    expect(
      ExtensionUiResponseSchema.parse({
        type: "extension_ui_response",
        id: "i".repeat(EXTENSION_UI_RESPONSE_ID_MAX_BYTES),
        operationId: "o".repeat(EXTENSION_UI_RESPONSE_ID_MAX_BYTES),
        value: "v".repeat(EXTENSION_UI_RESPONSE_VALUE_MAX_BYTES),
      }),
    ).toBeTruthy();
  });

  it("rejects multibyte overflow and unknown fields", () => {
    expect(() =>
      ExtensionUiResponseSchema.parse({
        type: "extension_ui_response",
        id: "😀".repeat(EXTENSION_UI_RESPONSE_ID_MAX_BYTES / 4 + 1),
        value: "",
      }),
    ).toThrow();
    expect(() =>
      ExtensionUiResponseSchema.parse({
        type: "extension_ui_response",
        id: "dialog",
        value: "😀".repeat(EXTENSION_UI_RESPONSE_VALUE_MAX_BYTES / 4 + 1),
      }),
    ).toThrow();
    expect(() =>
      ExtensionUiResponseSchema.parse({
        type: "extension_ui_response",
        id: "dialog",
        cancelled: true,
        secret: "not part of the wire contract",
      }),
    ).toThrow();
  });
});
