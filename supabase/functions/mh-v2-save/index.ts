/**
 * Persist onboarding profile + knowledge, and list / load chat sessions, for
 * the signed-in dashboard customer. verify_jwt is false — we verify mh_token
 * ourselves (same HMAC secret as mh-v2-auth /me). List returns preview +
 * message_count only; GET /chat-sessions/:id returns messages for jwt.sub.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { jwtSecretFromEnv } from "../_shared/jwt-secret.ts";
import {
  handleRequest,
  type AdminClient,
} from "./handler.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const jwtSecret = jwtSecretFromEnv((key) => Deno.env.get(key));

const admin = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
}) as unknown as AdminClient;

Deno.serve((req) =>
  handleRequest(req, {
    jwtSecret,
    now: () => new Date().toISOString(),
    admin,
  }),
);
