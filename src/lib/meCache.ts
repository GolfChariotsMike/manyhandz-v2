const STORAGE_KEY = "mh_me";
export const ME_CACHE_TTL_MS = 60_000;

export type MeCacheStore = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export function memoryStore(): MeCacheStore {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, value); },
    removeItem: (key) => { map.delete(key); },
  };
}

function browserSessionStore(): MeCacheStore | null {
  try {
    if (typeof sessionStorage === "undefined") return null;
    return sessionStorage;
  } catch {
    return null;
  }
}

export function createMeCache(store: MeCacheStore | null = null, ttlMs = ME_CACHE_TTL_MS) {
  let memory: { data: unknown; at: number } | null = null;
  let inflight: Promise<unknown> | null = null;

  function hydrate() {
    if (memory || !store) return;
    try {
      const raw = store.getItem(STORAGE_KEY);
      if (!raw) return;
      memory = { data: JSON.parse(raw), at: Date.now() };
    } catch {
      try { store.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    }
  }

  hydrate();

  return {
    peek(): unknown | null {
      if (memory && Date.now() - memory.at < ttlMs) return memory.data;
      return null;
    },

    clear() {
      memory = null;
      inflight = null;
      try { store?.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    },

    async get<T>(fetcher: () => Promise<T>): Promise<T> {
      if (memory && Date.now() - memory.at < ttlMs) return memory.data as T;
      if (inflight) return inflight as Promise<T>;

      inflight = fetcher()
        .then((data) => {
          memory = { data, at: Date.now() };
          try { store?.setItem(STORAGE_KEY, JSON.stringify(data)); } catch { /* ignore */ }
          return data;
        })
        .finally(() => {
          inflight = null;
        });

      return inflight as Promise<T>;
    },
  };
}

export const meCache = createMeCache(browserSessionStore());
