/**
 * Dashboard data for RLS-locked customer tables. verify_jwt is false: the
 * dashboard sends mh_token (HS256, MH_JWT_SECRET), which the handler verifies
 * itself before using the service role scoped to jwt.sub.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { DEFAULT_JWT_SECRET } from "../mh-v2-save/handler.ts";
import { handleRequest, type DataDb, type Filters, type Row } from "./handler.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const jwtSecret = Deno.env.get("MH_JWT_SECRET") || DEFAULT_JWT_SECRET;

const client = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// deno-lint-ignore no-explicit-any
function applyFilters(q: any, filters: Filters): any {
  let out = q;
  for (const [col, val] of Object.entries(filters)) out = out.eq(col, val);
  return out;
}

const db: DataDb = {
  async select(table, columns, filters, opts) {
    let q = applyFilters(client.from(table).select(columns), filters);
    if (opts?.order) q = q.order(opts.order.column, { ascending: opts.order.ascending, nullsFirst: false });
    if (opts?.limit) q = q.limit(opts.limit);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (Array.isArray(data) ? data : []) as Row[];
  },
  async update(table, patch, filters) {
    const { data, error } = await applyFilters(client.from(table).update(patch), filters).select();
    if (error) throw new Error(error.message);
    return (Array.isArray(data) ? data : []) as Row[];
  },
  async insert(table, rows) {
    const { data, error } = await client.from(table).insert(rows).select();
    if (error) throw new Error(error.message);
    return (Array.isArray(data) ? data : []) as Row[];
  },
  async remove(table, filters) {
    const { data, error } = await applyFilters(client.from(table).delete(), filters).select("id");
    if (error) throw new Error(error.message);
    return Array.isArray(data) ? data.length : 0;
  },
};

Deno.serve((req) =>
  handleRequest(req, {
    jwtSecret,
    now: () => new Date().toISOString(),
    db,
  }),
);
