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

test("clear then get returns a fresh customer (assume-account)", async () => {
  const cache = createMeCache(memoryStore());
  await cache.get(async () => ({ customer: { id: "stik-stickers" } }));
  cache.clear();

  let calls = 0;
  const next = await cache.get(async () => {
    calls += 1;
    return { customer: { id: "rhen-electrical" } };
  });

  assert.equal(calls, 1);
  assert.deepEqual(next, { customer: { id: "rhen-electrical" } });
  assert.deepEqual(cache.peek(), next);
});

test("cache from customer A is not served after token switches to customer B", async () => {
  let token = "token-a";
  const store = memoryStore();
  const cache = createMeCache(store, 60_000, () => token);

  await cache.get(async () => ({ customer: { id: "A", business_name: "Stik Stickers" } }));
  token = "token-b";

  let calls = 0;
  const next = await cache.get(async () => {
    calls += 1;
    return { customer: { id: "B", business_name: "Rhen Electrical" } };
  });

  assert.equal(calls, 1);
  assert.deepEqual(next, { customer: { id: "B", business_name: "Rhen Electrical" } });
  assert.deepEqual(cache.peek(), next);
});

test("hydrated cache from customer A is not served after a token switch (forgotten clear)", async () => {
  let token = "token-a";
  const store = memoryStore();
  const first = createMeCache(store, 60_000, () => token);
  await first.get(async () => ({ customer: { id: "A", business_name: "Stik Stickers" } }));

  token = "token-b";
  const second = createMeCache(store, 60_000, () => token);
  let calls = 0;
  const next = await second.get(async () => {
    calls += 1;
    return { customer: { id: "B", business_name: "Rhen Electrical" } };
  });

  assert.equal(calls, 1);
  assert.deepEqual(next, { customer: { id: "B", business_name: "Rhen Electrical" } });
});

test("hydrate preserves stored TTL and does not reset at to Date.now()", async () => {
  const store = memoryStore();
  const realNow = Date.now;
  let now = 10_000;
  Date.now = () => now;
  try {
    const first = createMeCache(store, 60_000);
    await first.get(async () => ({ customer: { id: "A" } }));

    const persisted = JSON.parse(store.getItem("mh_me") ?? "null");
    assert.equal(persisted.at, 10_000);
    assert.deepEqual(persisted.data, { customer: { id: "A" } });

    now = 40_000;
    const second = createMeCache(store, 60_000);
    let calls = 0;
    const stillFresh = await second.get(async () => {
      calls += 1;
      return { customer: { id: "fresh" } };
    });
    assert.equal(calls, 0);
    assert.deepEqual(stillFresh, { customer: { id: "A" } });

    // If hydrate had stamped at=40000, this 35s-later peek would still hit.
    // Preserved at=10000 means the entry expired 5s ago.
    now = 75_000;
    assert.equal(second.peek(), null);
    const refetched = await second.get(async () => {
      calls += 1;
      return { customer: { id: "fresh" } };
    });
    assert.equal(calls, 1);
    assert.deepEqual(refetched, { customer: { id: "fresh" } });
  } finally {
    Date.now = realNow;
  }
});

test("legacy bare mh_me blob is not hydrated with a reset TTL", async () => {
  const store = memoryStore();
  store.setItem("mh_me", JSON.stringify({ customer: { id: "stale-legacy" } }));
  const cache = createMeCache(store, 60_000);

  let calls = 0;
  const next = await cache.get(async () => {
    calls += 1;
    return { customer: { id: "fresh" } };
  });

  assert.equal(calls, 1);
  assert.deepEqual(next, { customer: { id: "fresh" } });
});
