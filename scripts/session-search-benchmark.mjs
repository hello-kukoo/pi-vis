import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

const require = createRequire(import.meta.url);
const {
  SessionCatalog,
  SessionSearchService,
} = require("../out/main/session-search-benchmark-api.js");

const targetMiB = Math.max(1, Number.parseInt(process.env.PIVIS_SEARCH_BENCH_MIB ?? "16", 10));
const root = fs.mkdtempSync(path.join(os.tmpdir(), "pivis-session-search-bench-"));
const workspace = path.join(root, "workspace");
const sessions = path.join(root, "sessions");
const file = path.join(sessions, "00-priority.jsonl");
const bulkFile = path.join(sessions, "99-bulk.jsonl");
fs.mkdirSync(workspace);
fs.mkdirSync(sessions);

const row = (value) => `${JSON.stringify(value)}\n`;
fs.writeFileSync(
  file,
  row({ type: "session", version: 3, id: "priority", timestamp: 1, cwd: workspace }) +
    row({ type: "session_info", id: "name", name: "Lifecycle benchmark" }) +
    row({
      type: "message",
      id: "gold-exact",
      parentId: "name",
      message: { role: "user", content: "old exact activation lifecycle phrase" },
    }) +
    row({
      type: "message",
      id: "gold-code",
      parentId: "gold-exact",
      message: {
        role: "assistant",
        content: "openSessionTab src/sessionRegistry/activation_visit.ts",
      },
    }),
);
const descriptor = fs.openSync(bulkFile, "w");
try {
  fs.writeSync(
    descriptor,
    row({ type: "session", version: 3, id: "bulk", timestamp: 1, cwd: workspace }),
  );
  let index = 0;
  const targetBytes = targetMiB * 1024 * 1024;
  const filler = "bounded local saved history filler ".repeat(24);
  let size = fs.fstatSync(descriptor).size + fs.statSync(file).size;
  while (size < targetBytes) {
    const value = row({
      type: "message",
      id: `fill-${index}`,
      parentId: index === 0 ? undefined : `fill-${index - 1}`,
      message: { role: index % 2 ? "assistant" : "user", content: `${filler}${index}` },
    });
    fs.writeSync(descriptor, value);
    size += Buffer.byteLength(value);
    index += 1;
  }
} finally {
  fs.closeSync(descriptor);
}

class BenchmarkRenderer {
  id = 1;
  destroyed = false;
  batches = [];
  waiters = new Set();

  isDestroyed() {
    return this.destroyed;
  }

  once() {}

  send(_channel, batch) {
    this.batches.push(batch);
    for (const waiter of [...this.waiters]) {
      if (!waiter.predicate(batch)) {
        if (!batch.error) continue;
        this.waiters.delete(waiter);
        clearTimeout(waiter.timer);
        waiter.reject(new Error(`Benchmark search failed: ${batch.error}`));
        continue;
      }
      this.waiters.delete(waiter);
      clearTimeout(waiter.timer);
      waiter.resolve(batch);
    }
  }

  waitFor(predicate, timeoutMs = 300_000) {
    const existing = [...this.batches].reverse().find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const waiter = {
        predicate,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.waiters.delete(waiter);
          const latest = this.batches.at(-1);
          reject(
            new Error(
              `Timed out waiting for benchmark search batch; latest=${JSON.stringify(latest)}`,
            ),
          );
        }, timeoutMs),
      };
      this.waiters.add(waiter);
    });
  }
}

const settings = {
  workspaceOrder: [workspace],
  worktrees: {},
  archivedSessions: [],
  pinnedSessions: [],
};
const renderer = new BenchmarkRenderer();
const catalog = new SessionCatalog({ sessionsRoot: sessions, getSettings: () => settings });
const service = new SessionSearchService({
  databaseDirectory: path.join(root, "index"),
  getSettings: () => settings,
  catalog,
  openValidatedSource: async () => {
    throw new Error("Benchmark must never open a session runtime");
  },
});
let clientSequence = 0;
const startSearch = (query) => {
  const clientQueryId = `bench-${++clientSequence}`;
  service.start(renderer, {
    rendererGeneration: 1,
    clientQueryId,
    workspacePath: workspace,
    query,
    pageSize: 20,
  });
  return clientQueryId;
};
const waitForResult = (clientQueryId, snippetNeedle, timeoutMs = 300_000) =>
  renderer.waitFor(
    (batch) =>
      batch.clientQueryId === clientQueryId &&
      batch.results.some((result) => result.snippet.includes(snippetNeedle)),
    timeoutMs,
  );
const waitForAnyBatch = (clientQueryId) =>
  renderer.waitFor((batch) => batch.clientQueryId === clientQueryId);

const rssBeforeWorker = process.memoryUsage().rss;
let peakRss = rssBeforeWorker;
const eventLoopDelays = [];
let lastEventLoopSample = performance.now();
const rssSampler = setInterval(() => {
  const now = performance.now();
  eventLoopDelays.push(Math.max(0, now - lastEventLoopSample - 10));
  lastEventLoopSample = now;
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
}, 10);

try {
  // Start before initialize so the production catalog receives the requested
  // workspace as a cold-discovery priority.
  const indexingStarted = performance.now();
  const firstClient = startSearch('"activation lifecycle"');
  await service.initialize();
  await waitForResult(firstClient, "activation lifecycle");
  const firstInitialResultMs = performance.now() - indexingStarted;

  // Append to the already-indexed priority source while the bulk source is
  // still reconciling. This exercises dirty-source promotion, not a direct
  // worker reconcile after the index has settled.
  const preAppendStatus = await service.status(renderer, {
    rendererGeneration: 1,
    workspacePath: workspace,
  });
  const appendDuringReconcile =
    preAppendStatus.state === "indexing" &&
    preAppendStatus.coverage.indexedSources < preAppendStatus.coverage.totalSources;
  if (targetMiB >= 16 && !appendDuringReconcile) {
    throw new Error("Benchmark append precondition failed: bulk indexing already settled");
  }
  const appendClient = startSearch("fresh benchmark visibility needle");
  await waitForAnyBatch(appendClient);
  const appendStarted = performance.now();
  fs.appendFileSync(
    file,
    row({
      type: "message",
      id: "fresh-benchmark-append",
      parentId: "gold-code",
      message: { role: "assistant", content: "fresh benchmark visibility needle" },
    }),
  );
  await waitForResult(appendClient, "fresh benchmark visibility needle", 2_000);
  const appendVisibilityMs = performance.now() - appendStarted;

  let status;
  do {
    status = await service.status(renderer, {
      rendererGeneration: 1,
      workspacePath: workspace,
    });
    if (status.state === "failed") throw new Error(status.message ?? "Indexing failed");
    if (
      status.state === "ready" &&
      status.coverage.totalSources === 2 &&
      status.coverage.indexedSources === 2
    ) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  } while (performance.now() - indexingStarted < 300_000);
  if (status.state !== "ready" || status.coverage.indexedSources !== 2) {
    throw new Error("Full-service indexing did not complete within five minutes");
  }
  const indexingMs = performance.now() - indexingStarted;

  const relevance = [
    { query: '"activation lifecycle"', expected: "gold-exact", needle: "activation lifecycle" },
    { query: "open session tab", expected: "gold-code", needle: "openSessionTab" },
    {
      query: "session registry activation",
      expected: "gold-exact",
      needle: "activation lifecycle",
    },
    { query: "lifecyle", expected: "gold-exact", needle: "activation lifecycle" },
  ];
  let reciprocalRank = 0;
  let dcg = 0;
  const relevanceRanks = [];
  for (const item of relevance) {
    const clientQueryId = startSearch(item.query);
    const batch = await waitForResult(clientQueryId, item.needle);
    const rank = batch.results.findIndex((result) => result.snippet.includes(item.needle)) + 1;
    relevanceRanks.push({ query: item.query, rank });
    reciprocalRank += rank > 0 ? 1 / rank : 0;
    dcg += rank > 0 ? 1 / Math.log2(rank + 1) : 0;
  }
  const mrr = reciprocalRank / relevance.length;
  const ndcg = dcg / relevance.length;

  const durations = [];
  for (let iteration = 0; iteration < 30; iteration++) {
    const started = performance.now();
    const clientQueryId = startSearch("activation lifecycle");
    await waitForResult(clientQueryId, "activation lifecycle");
    durations.push(performance.now() - started);
  }
  durations.sort((left, right) => left - right);
  const p95 = durations[Math.min(durations.length - 1, Math.floor(durations.length * 0.95))] ?? 0;

  peakRss = Math.max(peakRss, process.memoryUsage().rss);
  const peakRssMiB = (peakRss - rssBeforeWorker) / 1024 / 1024;
  const eventLoopDelayMax = eventLoopDelays.reduce((maximum, delay) => Math.max(maximum, delay), 0);
  const corpusBytes = fs.statSync(file).size + fs.statSync(bulkFile).size;
  const report = {
    corpusMiB: Number((corpusBytes / 1024 / 1024).toFixed(1)),
    indexingMs: Number(indexingMs.toFixed(1)),
    firstInitialResultMs: Number(firstInitialResultMs.toFixed(1)),
    warmQueryP95Ms: Number(p95.toFixed(2)),
    appendVisibilityMs: Number(appendVisibilityMs.toFixed(1)),
    appendDuringReconcile,
    workerProcessPeakRssDeltaMiB: Number(peakRssMiB.toFixed(1)),
    mainEventLoopDelayMaxMs: Number(eventLoopDelayMax.toFixed(2)),
    MRR: Number(mrr.toFixed(3)),
    nDCG: Number(ndcg.toFixed(3)),
    relevanceRanks,
  };
  console.log(JSON.stringify(report, null, 2));
  if (firstInitialResultMs >= 500)
    throw new Error(`First result ${firstInitialResultMs.toFixed(1)}ms exceeds 500ms`);
  if (p95 >= 150) throw new Error(`Warm query p95 ${p95.toFixed(1)}ms exceeds 150ms`);
  if (appendVisibilityMs >= 2_000)
    throw new Error(`Append visibility ${appendVisibilityMs.toFixed(1)}ms exceeds 2s`);
  if (peakRssMiB >= 192)
    throw new Error(`Peak worker-process RSS delta ${peakRssMiB.toFixed(1)}MiB exceeds 192MiB`);
  if (eventLoopDelayMax >= 16)
    throw new Error(`Main event-loop delay max ${eventLoopDelayMax.toFixed(1)}ms exceeds 16ms`);
  if (mrr < 0.9 || ndcg < 0.9) throw new Error("Golden relevance score fell below 0.9");
} finally {
  clearInterval(rssSampler);
  renderer.destroyed = true;
  await service.stop();
  fs.rmSync(root, { recursive: true, force: true });
}
