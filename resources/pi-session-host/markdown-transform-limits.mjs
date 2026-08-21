export const MARKDOWN_TRANSFORM_MAX_ITEMS = 100;
export const MARKDOWN_TRANSFORM_MAX_REQUEST_ID_BYTES = 128;
export const MARKDOWN_TRANSFORM_MAX_INPUT_BYTES = 256 * 1024;
export const MARKDOWN_TRANSFORM_MAX_REQUEST_BATCH_BYTES = 1024 * 1024;
export const MARKDOWN_TRANSFORM_MAX_OUTPUT_BYTES = 512 * 1024;
export const MARKDOWN_TRANSFORM_MAX_RESPONSE_BATCH_BYTES = 2 * 1024 * 1024;

const UTF8_ENCODER = new TextEncoder();

/** Browser/Node-stable UTF-8 accounting for the renderer↔SDK-host boundary. */
export function markdownTransformUtf8Bytes(value) {
  return UTF8_ENCODER.encode(value).byteLength;
}

/** Count serialized IPC data, including JSON quoting and escape expansion. */
export function markdownTransformJsonBytes(value) {
  const serialized = JSON.stringify(value);
  return serialized === undefined ? 0 : markdownTransformUtf8Bytes(serialized);
}
