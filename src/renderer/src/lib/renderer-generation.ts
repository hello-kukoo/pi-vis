/** Stable for one renderer document; changes across reloads. */
export const RENDERER_GENERATION = Math.floor(performance.timeOrigin * 1000 + Math.random() * 1000);
