import test from "node:test";
import assert from "node:assert/strict";

import { WatermarkScheduler } from "../src/services/indexer-scheduler.js";
import {
  setIndexerSpanExporter,
  withIndexerSpan,
} from "../src/services/indexer-tracing.js";

class FakeClock {
  currentTime = 0;
  nextId = 1;
  timers = new Map();

  now = () => this.currentTime;

  setTimeout = (callback, delayMs) => {
    const id = this.nextId++;
    this.timers.set(id, { callback, dueAt: this.currentTime + delayMs });
    return id;
  };

  clearTimeout = (id) => {
    this.timers.delete(id);
  };

  advance(milliseconds) {
    const target = this.currentTime + milliseconds;
    while (true) {
      const next = [...this.timers.entries()]
        .filter(([, timer]) => timer.dueAt <= target)
        .sort((left, right) => left[1].dueAt - right[1].dueAt)[0];
      if (!next) break;
      const [id, timer] = next;
      this.currentTime = timer.dueAt;
      this.timers.delete(id);
      timer.callback();
    }
    this.currentTime = target;
  }
}

async function flushScheduler() {
  for (let index = 0; index < 4; index++) await Promise.resolve();
}

test("an overrun skips the tick and never overlaps indexer polls", async () => {
  const clock = new FakeClock();
  const resolvers = [];
  let calls = 0;
  let active = 0;
  let maxActive = 0;
  let skipped = 0;

  const scheduler = new WatermarkScheduler({
    intervalMs: 100,
    clock,
    runCycle: async () => {
      calls++;
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => resolvers.push(resolve));
      active--;
    },
    onOverrun: (count) => {
      skipped += count;
    },
  });

  scheduler.start();
  clock.advance(100);
  clock.advance(100);

  assert.equal(calls, 1);
  assert.equal(maxActive, 1);
  assert.equal(skipped, 1);

  resolvers.shift()();
  await flushScheduler();
  clock.advance(100);
  assert.equal(calls, 2);
  assert.equal(maxActive, 1);

  resolvers.shift()();
  await flushScheduler();
  await scheduler.stop();
});

test("stop cancels the timer and aborts the active cycle", async () => {
  const clock = new FakeClock();
  let aborted = false;
  const scheduler = new WatermarkScheduler({
    intervalMs: 25,
    clock,
    runCycle: (signal) =>
      new Promise((resolve) => {
        signal.addEventListener("abort", () => {
          aborted = true;
          resolve();
        });
      }),
  });

  scheduler.start();
  clock.advance(25);
  await scheduler.stop();

  assert.equal(aborted, true);
  assert.equal(clock.timers.size, 0);
  assert.equal(scheduler.isCycleActive, false);
});

test("one cycle exports W3C-linked indexer, database, and Stellar spans", async (t) => {
  const exported = [];
  setIndexerSpanExporter({ export: (span) => exported.push(span) });
  t.after(() => setIndexerSpanExporter(null));

  await withIndexerSpan(
    "indexer.poll_cycle",
    null,
    { start_ledger: 41 },
    async (root) => {
      await withIndexerSpan(
        "indexer.db.persist_watermark",
        root,
        { component: "database", ledger: 42 },
        () => undefined,
      );
      await withIndexerSpan(
        "indexer.stellar.latest_ledger",
        root,
        { component: "stellar" },
        () => ({ sequence: 42 }),
      );
    },
  );

  const root = exported.find((span) => span.name === "indexer.poll_cycle");
  const children = exported.filter((span) => span.parentSpanId === root.spanId);

  assert.equal(exported.length, 3);
  assert.equal(children.length, 2);
  assert.ok(exported.every((span) => span.traceId === root.traceId));
  assert.ok(
    exported.every((span) =>
      /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/.test(span.traceparent),
    ),
  );
});

test("accelerated soak keeps memory, timers, and watermark storage bounded", async () => {
  const clock = new FakeClock();
  const watermarkStore = new Map();
  const rssBefore = process.memoryUsage().rss;
  let cycles = 0;
  let active = 0;
  let maxActive = 0;

  const scheduler = new WatermarkScheduler({
    intervalMs: 1,
    clock,
    runCycle: async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      watermarkStore.set("lastLedger", ++cycles);
      active--;
    },
  });

  scheduler.start();
  for (let index = 0; index < 10_000; index++) {
    clock.advance(1);
    await flushScheduler();
    assert.ok(clock.timers.size <= 1);
  }
  await scheduler.stop();

  const rssGrowth = process.memoryUsage().rss - rssBefore;
  assert.equal(cycles, 10_000);
  assert.equal(maxActive, 1);
  assert.equal(watermarkStore.size, 1);
  assert.ok(rssGrowth < 96 * 1024 * 1024, `RSS grew by ${rssGrowth} bytes`);
  assert.equal(clock.timers.size, 0);
});
