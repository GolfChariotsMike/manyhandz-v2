/**
 * mh-v2-data — dashboard reads/writes for RLS-locked customer tables.
 *
 * The dashboard login token (mh_token) is an HS256 JWT signed with
 * MH_JWT_SECRET, not a Supabase JWT, so PostgREST sees the browser as `anon`
 * and RLS returns nothing. This function verifies mh_token, resolves the
 * mh_v2_customers row for jwt.sub, then uses the service role to touch ONLY
 * that customer's rows. Every query is filtered by the verified customer id;
 * customer ids in the request body are ignored.
 *
 * Explicit allowlist, no generic passthrough:
 *   GET  /knowledge              mh_knowledge_base row
 *   POST /knowledge              patch about/services/faqs/hours/tone/custom_instructions
 *   GET  /voice-config           mh_voice_config row
 *   POST /voice-config           patch allowlisted voice columns
 *   GET  /price-list             mh_price_list rows
 *   POST /price-list             save (insert/update) items
 *   POST /price-list/delete      delete one item by id
 *   GET  /staff                  mh_staff rows
 *   POST /staff                  replace staff list
 *   GET  /call-log               mh_call_log rows (latest 100)
 *   GET  /connection-platforms   active mh_crm_connections platforms
 *   GET  /usage-balance          mh_usage_balance row
 *   GET  /chat-config            mh_chat_config row
 *   POST /chat-config            patch widget settings
 *   POST /chat-config/create     create the widget row if missing
 *   POST /bug-report             insert mh_bug_reports for this customer
 */
import { bearerToken, verifyHs256Jwt } from "../mh-v2-save/handler.ts";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export type Row = Record<string, unknown>;
export type Filters = Record<string, string | number | boolean>;
export type SelectOpts = { order?: { column: string; ascending: boolean }; limit?: number };

/** Minimal DB surface (service role). Implementations must throw on error. */
export type DataDb = {
  select(table: string, columns: string, filters: Filters, opts?: SelectOpts): Promise<Row[]>;
  update(table: string, patch: Row, filters: Filters): Promise<Row[]>;
  insert(table: string, rows: Row[]): Promise<Row[]>;
  remove(table: string, filters: Filters): Promise<number>;
};

export type DataEnv = {
  jwtSecret: string;
  now: () => string;
  db: DataDb;
};

export class BadRequest extends Error {}

const STAFF_COLUMNS = "id,name,phone,role,notes,is_owner,active,sort_order";
const PRICE_COLUMNS =
  "id,customer_id,job_name,price_type,price_min,price_max,duration_hours_min,duration_hours_max,notes,sort_order,created_at";
const MAX_PRICE_ITEMS = 200;
const MAX_STAFF = 50;
const CALL_LOG_LIMIT = 100;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function parseDataRoute(url: URL): string {
  const parts = url.pathname.replace(/\/+$/, "").split("/").filter(Boolean);
  const idx = parts.lastIndexOf("mh-v2-data");
  const rest = idx >= 0 ? parts.slice(idx + 1) : parts;
  return rest.join("/");
}

function isObject(v: unknown): v is Row {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function first(rows: Row[]): Row | null {
  return rows.length > 0 ? rows[0] : null;
}

// ---------- field validators ----------

type FieldKind = "string" | "string_or_null" | "boolean" | "number" | "number_or_null" | "string_array" | "array" | "object";

function checkField(name: string, kind: FieldKind, value: unknown): unknown {
  switch (kind) {
    case "string":
      if (typeof value !== "string") throw new BadRequest(`${name} must be a string`);
      return value;
    case "string_or_null":
      if (value === null) return null;
      if (typeof value !== "string") throw new BadRequest(`${name} must be a string or null`);
      return value;
    case "boolean":
      if (typeof value !== "boolean") throw new BadRequest(`${name} must be a boolean`);
      return value;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) throw new BadRequest(`${name} must be a number`);
      return value;
    case "number_or_null":
      if (value === null || value === "") return null;
      if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
      if (typeof value !== "number" || !Number.isFinite(value)) throw new BadRequest(`${name} must be a number or null`);
      return value;
    case "string_array":
      if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
        throw new BadRequest(`${name} must be an array of strings`);
      }
      return value;
    case "array":
      if (!Array.isArray(value)) throw new BadRequest(`${name} must be an array`);
      return value;
    case "object":
      if (!isObject(value)) throw new BadRequest(`${name} must be an object`);
      return value;
  }
}

function pickPatch(body: unknown, fields: Record<string, FieldKind>): Row {
  if (!isObject(body)) throw new BadRequest("JSON object required");
  const patch: Row = {};
  for (const [key, kind] of Object.entries(fields)) {
    if (key in body && body[key] !== undefined) patch[key] = checkField(key, kind, body[key]);
  }
  if (Object.keys(patch).length === 0) throw new BadRequest("nothing to update");
  return patch;
}

export const KNOWLEDGE_FIELDS: Record<string, FieldKind> = {
  about: "string",
  services: "array",
  faqs: "array",
  hours: "object",
  tone: "string",
  custom_instructions: "object",
};

export const VOICE_CONFIG_FIELDS: Record<string, FieldKind> = {
  system_prompt: "string",
  ai_name: "string",
  greeting_script: "string",
  closing_message: "string_or_null",
  return_to_ai_prompt: "string_or_null",
  voice_id: "string",
  tts_stability: "number",
  tts_similarity: "number",
  tts_speed: "number",
  turn_eagerness: "string",
  turn_timeout: "number",
  whitelist: "string_array",
  bridge_to_number: "string_or_null",
  cap_confirm_bookings: "boolean",
  cap_quote_prices: "boolean",
  cap_transfer_calls: "boolean",
  cap_send_sms: "boolean",
  cap_create_simpro_job: "boolean",
  cap_create_servicem8_job: "boolean",
  cap_create_xero_invoice: "boolean",
  cap_disclose_ai: "boolean",
  cap_hangup_on_goodbye: "boolean",
};

export const CHAT_CONFIG_FIELDS: Record<string, FieldKind> = {
  widget_name: "string",
  widget_color: "string",
  greeting: "string",
  fallback_message: "string",
  suggested_prompts: "string_array",
  is_active: "boolean",
};

const PRICE_TYPES = new Set(["flat", "hourly", "range", "from", "inspect"]);

export function parsePriceItem(raw: unknown, index: number): { id: string | null; row: Row } {
  if (!isObject(raw)) throw new BadRequest(`items[${index}] must be an object`);
  const id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : null;
  const jobName = typeof raw.job_name === "string" ? raw.job_name : "";
  const priceType = typeof raw.price_type === "string" && raw.price_type ? raw.price_type : "flat";
  if (!PRICE_TYPES.has(priceType)) throw new BadRequest(`items[${index}].price_type is not allowed`);
  const row: Row = {
    job_name: jobName,
    price_type: priceType,
    price_min: checkField("price_min", "number_or_null", raw.price_min ?? null),
    price_max: checkField("price_max", "number_or_null", raw.price_max ?? null),
    duration_hours_min: checkField("duration_hours_min", "number_or_null", raw.duration_hours_min ?? null),
    duration_hours_max: checkField("duration_hours_max", "number_or_null", raw.duration_hours_max ?? null),
    notes: typeof raw.notes === "string" ? raw.notes : null,
    sort_order: typeof raw.sort_order === "number" && Number.isFinite(raw.sort_order) ? Math.floor(raw.sort_order) : index,
  };
  return { id, row };
}

export function parseStaffMember(raw: unknown, index: number): Row {
  if (!isObject(raw)) throw new BadRequest(`staff[${index}] must be an object`);
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  const phone = typeof raw.phone === "string" ? raw.phone.trim() : "";
  if (!name || !phone) throw new BadRequest(`staff[${index}] needs a name and phone`);
  return {
    name,
    phone,
    role: typeof raw.role === "string" && raw.role.trim() ? raw.role.trim() : "Staff",
    notes: typeof raw.notes === "string" && raw.notes.trim() ? raw.notes : null,
    is_owner: raw.is_owner === true,
    active: raw.active !== false,
    sort_order: index,
  };
}

// ---------- auth ----------

async function resolveCustomer(req: Request, env: DataEnv): Promise<Row | Response> {
  const token = bearerToken(req);
  if (!token) return jsonResponse({ error: "Unauthorized" }, 401);
  const payload = await verifyHs256Jwt(token, env.jwtSecret);
  if (!payload) return jsonResponse({ error: "Unauthorized" }, 401);
  const rows = await env.db.select("mh_v2_customers", "id,email,business_name", { id: payload.sub });
  const customer = first(rows);
  if (!customer || String(customer.id) !== payload.sub) return jsonResponse({ error: "Unauthorized" }, 401);
  return customer;
}

async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new BadRequest("JSON object required");
  }
}

// ---------- handlers ----------

type Handler = (ctx: { req: Request; env: DataEnv; customerId: string; customer: Row }) => Promise<Response>;

const GET_ROUTES: Record<string, Handler> = {
  "knowledge": async ({ env, customerId }) => {
    const rows = await env.db.select("mh_knowledge_base", "*", { customer_id: customerId });
    return jsonResponse({ knowledge: first(rows) });
  },
  "voice-config": async ({ env, customerId }) => {
    const rows = await env.db.select("mh_voice_config", "*", { customer_id: customerId });
    return jsonResponse({ voice_config: first(rows) });
  },
  "price-list": async ({ env, customerId }) => {
    const rows = await env.db.select("mh_price_list", PRICE_COLUMNS, { customer_id: customerId }, {
      order: { column: "sort_order", ascending: true },
    });
    return jsonResponse({ items: rows });
  },
  "staff": async ({ env, customerId }) => {
    const rows = await env.db.select("mh_staff", STAFF_COLUMNS, { customer_id: customerId }, {
      order: { column: "sort_order", ascending: true },
    });
    return jsonResponse({ staff: rows });
  },
  "call-log": async ({ env, customerId }) => {
    const rows = await env.db.select("mh_call_log", "*", { customer_id: customerId }, {
      order: { column: "started_at", ascending: false },
      limit: CALL_LOG_LIMIT,
    });
    return jsonResponse({ calls: rows });
  },
  "connection-platforms": async ({ env, customerId }) => {
    const rows = await env.db.select("mh_crm_connections", "platform", { customer_id: customerId, is_active: true });
    const platforms = rows.map((r) => String(r.platform || "")).filter(Boolean);
    return jsonResponse({ platforms });
  },
  "usage-balance": async ({ env, customerId }) => {
    const rows = await env.db.select("mh_usage_balance", "*", { customer_id: customerId });
    return jsonResponse({ balance: first(rows) });
  },
  "chat-config": async ({ env, customerId }) => {
    const rows = await env.db.select("mh_chat_config", "*", { customer_id: customerId });
    return jsonResponse({ chat_config: first(rows) });
  },
};

const POST_ROUTES: Record<string, Handler> = {
  "knowledge": async ({ req, env, customerId }) => {
    const patch = pickPatch(await readJson(req), KNOWLEDGE_FIELDS);
    patch.updated_at = env.now();
    const updated = await env.db.update("mh_knowledge_base", patch, { customer_id: customerId });
    if (updated.length > 0) return jsonResponse({ knowledge: updated[0] });
    const inserted = await env.db.insert("mh_knowledge_base", [{ ...patch, customer_id: customerId }]);
    return jsonResponse({ knowledge: first(inserted) });
  },
  "voice-config": async ({ req, env, customerId }) => {
    const patch = pickPatch(await readJson(req), VOICE_CONFIG_FIELDS);
    if ("turn_eagerness" in patch && !["patient", "normal", "eager"].includes(String(patch.turn_eagerness))) {
      throw new BadRequest("turn_eagerness must be patient, normal or eager");
    }
    if (Array.isArray(patch.whitelist)) {
      patch.whitelist = (patch.whitelist as string[]).map((s) => s.trim()).filter(Boolean);
    }
    patch.updated_at = env.now();
    const updated = await env.db.update("mh_voice_config", patch, { customer_id: customerId });
    if (updated.length === 0) return jsonResponse({ error: "Voice settings not found" }, 404);
    return jsonResponse({ voice_config: updated[0] });
  },
  "price-list": async ({ req, env, customerId }) => {
    const body = await readJson(req);
    if (!isObject(body) || !Array.isArray(body.items)) throw new BadRequest("items array required");
    if (body.items.length > MAX_PRICE_ITEMS) throw new BadRequest(`at most ${MAX_PRICE_ITEMS} items`);
    const parsed = body.items.map((raw, i) => parsePriceItem(raw, i));
    const saved: Row[] = [];
    for (const { id, row } of parsed) {
      if (id) {
        const rows = await env.db.update("mh_price_list", row, { id, customer_id: customerId });
        if (rows.length === 0) throw new BadRequest("price item not found");
        saved.push(rows[0]);
      } else {
        const rows = await env.db.insert("mh_price_list", [{ ...row, customer_id: customerId }]);
        if (rows[0]) saved.push(rows[0]);
      }
    }
    return jsonResponse({ items: saved });
  },
  "price-list/delete": async ({ req, env, customerId }) => {
    const body = await readJson(req);
    const id = isObject(body) && typeof body.id === "string" ? body.id.trim() : "";
    if (!id) throw new BadRequest("id required");
    const deleted = await env.db.remove("mh_price_list", { id, customer_id: customerId });
    return jsonResponse({ deleted });
  },
  "staff": async ({ req, env, customerId }) => {
    const body = await readJson(req);
    if (!isObject(body) || !Array.isArray(body.staff)) throw new BadRequest("staff array required");
    if (body.staff.length > MAX_STAFF) throw new BadRequest(`at most ${MAX_STAFF} staff`);
    const rows = body.staff.map((raw, i) => ({ ...parseStaffMember(raw, i), customer_id: customerId }));
    // Insert the new list first, then drop the old rows by id, so a failed
    // insert never leaves the customer with no staff (transfers depend on it).
    const previous = await env.db.select("mh_staff", "id", { customer_id: customerId });
    const inserted = rows.length > 0 ? await env.db.insert("mh_staff", rows) : [];
    for (const old of previous) {
      if (old.id == null) continue;
      await env.db.remove("mh_staff", { id: String(old.id), customer_id: customerId });
    }
    return jsonResponse({ staff: inserted });
  },
  "chat-config": async ({ req, env, customerId }) => {
    const patch = pickPatch(await readJson(req), CHAT_CONFIG_FIELDS);
    if (Array.isArray(patch.suggested_prompts) && (patch.suggested_prompts as string[]).length > 6) {
      throw new BadRequest("at most 6 suggested prompts");
    }
    patch.updated_at = env.now();
    const updated = await env.db.update("mh_chat_config", patch, { customer_id: customerId });
    if (updated.length === 0) return jsonResponse({ error: "Chat widget not found" }, 404);
    return jsonResponse({ chat_config: updated[0] });
  },
  "chat-config/create": async ({ req, env, customerId, customer }) => {
    const existing = await env.db.select("mh_chat_config", "*", { customer_id: customerId });
    if (existing.length > 0) return jsonResponse({ chat_config: existing[0] });
    const body = await readJson(req);
    const src = isObject(body) ? body : {};
    const businessName = typeof customer.business_name === "string" ? customer.business_name.trim() : "";
    const row: Row = {
      customer_id: customerId,
      widget_name: typeof src.widget_name === "string" && src.widget_name.trim()
        ? src.widget_name.trim()
        : businessName ? `${businessName} Chat` : "Chat Assistant",
    };
    if (src.suggested_prompts !== undefined) {
      const prompts = checkField("suggested_prompts", "string_array", src.suggested_prompts) as string[];
      row.suggested_prompts = prompts.slice(0, 6);
    }
    const inserted = await env.db.insert("mh_chat_config", [row]);
    return jsonResponse({ chat_config: first(inserted) });
  },
  "bug-report": async ({ req, env, customerId, customer }) => {
    const body = await readJson(req);
    const src = isObject(body) ? body : {};
    const message = typeof src.message === "string" ? src.message.trim() : "";
    if (!message) throw new BadRequest("message required");
    await env.db.insert("mh_bug_reports", [{
      customer_id: customerId,
      email: typeof customer.email === "string" ? customer.email : null,
      business_name: typeof customer.business_name === "string" ? customer.business_name : null,
      message: message.slice(0, 5000),
      page: typeof src.page === "string" ? src.page.slice(0, 500) : null,
      user_agent: typeof src.user_agent === "string" ? src.user_agent.slice(0, 500) : null,
    }]);
    return jsonResponse({ ok: true });
  },
};

export async function handleRequest(req: Request, env: DataEnv): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const route = parseDataRoute(new URL(req.url));
  const table = req.method === "GET" ? GET_ROUTES : req.method === "POST" ? POST_ROUTES : null;
  if (!table) return jsonResponse({ error: "Method not allowed" }, 405);
  const handler = Object.prototype.hasOwnProperty.call(table, route) ? table[route] : undefined;
  if (!handler) return jsonResponse({ error: "Not found" }, 404);

  try {
    const customer = await resolveCustomer(req, env);
    if (customer instanceof Response) return customer;
    return await handler({ req, env, customerId: String(customer.id), customer });
  } catch (e) {
    if (e instanceof BadRequest) return jsonResponse({ error: e.message }, 400);
    console.error("mh-v2-data error", route, e instanceof Error ? e.message : String(e));
    return jsonResponse({ error: "Server error" }, 500);
  }
}
