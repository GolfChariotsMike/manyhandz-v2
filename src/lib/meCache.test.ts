import assert from "node:assert/strict";
import { test } from "node:test";
import { createMeCache, memoryStore } from "./meCache.ts";

test("get caches a successful fetch", async () => {
  let calls = 0;
  const cache = createMeCache(memoryStore());
  const fetcher = async () => {
    calls += 1;
    return { customer: { id: "c1" } };
  };

  const first = await cache.get(fetcher);
  const second = await cache.get(fetcher);

  assert.equal(calls, 1);
  assert.deepEqual(first, second);
  assert.deepEqual(cache.peek(), first);
});

test("concurrent get calls share one in-flight request", async () => {
  let calls = 0;
  const cache = createMeCache(memoryStore());
  const fetcher = () => {
    calls += 1;
    return new Promise((resolve) => {
      setTimeout(() => resolve({ id: "c1" }), 15);
    });
  };

  const [a, b] = await Promise.all([cache.get(fetcher), cache.get(fetcher)]);
  assert.equal(calls, 1);
  assert.deepEqual(a, { id: "c1" });
  assert.deepEqual(b, { id: "c1" });
});

test("failed fetch is not cached", async () => {
  let calls = 0;
  const cache = createMeCache(memoryStore());
  const failThenOk = async () => {
    calls += 1;
    if (calls === 1) throw new Error("boom");
    return { id: "ok" };
  };

  await assert.rejects(() => cache.get(failThenOk), /boom/);
  assert.equal(cache.peek(), null);
  assert.deepEqual(await cache.get(failThenOk), { id: "ok" });
  assert.equal(calls, 2);
});

test("clear drops memory and persisted session", async () => {
  const store = memoryStore();
  const cache = createMeCache(store);
  await cache.get(async () => ({ id: "c1" }));
  assert.ok(store.getItem("mh_me"));

  cache.clear();
  assert.equal(cache.peek(), null);
  assert.equal(store.getItem("mh_me"), null);

  let calls = 0;
  await cache.get(async () => {
    calls += 1;
    return { id: "c2" };
  });
  assert.equal(calls, 1);
});

test("a new cache hydrates from the shared store", async () => {
  const store = memoryStore();
  const first = createMeCache(store);
  await first.get(async () => ({ customer: { id: "persisted" } }));

  const second = createMeCache(store);
  let calls = 0;
  const data = await second.get(async () => {
    calls += 1;
    return { customer: { id: "fresh" } };
  });

  assert.equal(calls, 0);
  assert.deepEqual(data, { customer: { id: "persisted" } });
});

test("expired entries refetch", async () => {
  let now = 1_000;
  const realNow = Date.now;
  Date.now = () => now;
  try {
    const cache = createMeCache(memoryStore(), 50);
    let calls = 0;
    await cache.get(async () => {
      calls += 1;
      return { n: calls };
    });
    now = 1_040;
    assert.deepEqual(cache.peek(), { n: 1 });
    now = 1_060;
    assert.equal(cache.peek(), null);
    const next = await cache.get(async () => {
      calls += 1;
      return { n: calls };
    });
    assert.deepEqual(next, { n: 2 });
  } finally {
    Date.now = realNow;
  }
});
