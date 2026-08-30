const STORAGE_KEY = "mh_me";
const TOKEN_KEY = "mh_token";
export const ME_CACHE_TTL_MS = 60_000;

export type MeCacheStore = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

type MeCacheEntry = {
  data: unknown;
  at: number;
  token: string | null;
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

function browserToken(): string | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function isEnvelope(parsed: unknown): parsed is MeCacheEntry {
  return (
    !!parsed &&
    typeof parsed === "object" &&
    "data" in parsed &&
    typeof (parsed as { at?: unknown }).at === "number"
  );
}

export function createMeCache(
  store: MeCacheStore | null = null,
  ttlMs = ME_CACHE_TTL_MS,
  getToken: () => string | null = () => null,
) {
  let memory: MeCacheEntry | null = null;
  let inflight: Promise<unknown> | null = null;

  function currentToken(): string | null {
    try {
      return getToken();
    } catch {
      return null;
    }
  }

  function dropPersisted() {
    try { store?.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  }

  function dropStaleIdentity() {
    if (!memory) return;
    if (memory.token === currentToken()) return;
    memory = null;
    inflight = null;
    dropPersisted();
  }

  function persist(entry: MeCacheEntry) {
    try { store?.setItem(STORAGE_KEY, JSON.stringify(entry)); } catch { /* ignore */ }
  }

  function hydrate() {
    if (memory || !store) return;
    try {
      const raw = store.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!isEnvelope(parsed)) {
        dropPersisted();
        return;
      }
      memory = {
        data: parsed.data,
        at: parsed.at,
        token: parsed.token ?? null,
      };
      dropStaleIdentity();
    } catch {
      dropPersisted();
    }
  }

  hydrate();

  return {
    peek(): unknown | null {
      dropStaleIdentity();
      if (memory && Date.now() - memory.at < ttlMs) return memory.data;
      return null;
    },

    clear() {
      memory = null;
      inflight = null;
      dropPersisted();
    },

    async get<T>(fetcher: () => Promise<T>): Promise<T> {
      dropStaleIdentity();
      if (memory && Date.now() - memory.at < ttlMs) return memory.data as T;
      if (inflight) return inflight as Promise<T>;

      inflight = fetcher()
        .then((data) => {
          memory = { data, at: Date.now(), token: currentToken() };
          persist(memory);
          return data;
        })
        .finally(() => {
          inflight = null;
        });

      return inflight as Promise<T>;
    },
  };
}

export const meCache = createMeCache(browserSessionStore(), ME_CACHE_TTL_MS, browserToken);
