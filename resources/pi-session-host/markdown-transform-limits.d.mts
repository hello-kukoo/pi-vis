export const MARKDOWN_TRANSFORM_MAX_ITEMS: 100;
export const MARKDOWN_TRANSFORM_MAX_REQUEST_ID_BYTES: 128;
export const MARKDOWN_TRANSFORM_MAX_INPUT_BYTES: number;
export const MARKDOWN_TRANSFORM_MAX_REQUEST_BATCH_BYTES: number;
export const MARKDOWN_TRANSFORM_MAX_OUTPUT_BYTES: number;
export const MARKDOWN_TRANSFORM_MAX_RESPONSE_BATCH_BYTES: number;

export function markdownTransformUtf8Bytes(value: string): number;
export function markdownTransformJsonBytes(value: unknown): number;
