// Build-only entry used by the release benchmark. Keeping the benchmark on the
// production service/catalog/index classes prevents a worker-only microbenchmark
// from masking cold discovery or append-detection latency.
export { SessionCatalog } from "./session-catalog.js";
export { SessionSearchService } from "./session-search-service.js";
