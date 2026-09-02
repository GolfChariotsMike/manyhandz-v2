/**
 * mh-v2-auth — dashboard magic-link auth.
 * verify_jwt is false — we issue/verify mh_token ourselves (HMAC MH_JWT_SECRET).
 * Reads customers via supabase-js service role (SUPABASE_SERVICE_ROLE_KEY / MH_SERVICE_KEY).
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  DEFAULT_APP_URL,
  adminSecretsFromEnv,
  handleRequest,
  jwtSecretFromEnv,
  serviceKeyFromEnv,
  type AdminClient,
} from "./handler.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const serviceKey = serviceKeyFromEnv((k) => Deno.env.get(k));
const jwtSecret = jwtSecretFromEnv((k) => Deno.env.get(k));
const appUrl = Deno.env.get("MHV2_APP_URL") || DEFAULT_APP_URL;
const resendKey = Deno.env.get("RESEND_API_KEY") || "";

const admin = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
}) as unknown as AdminClient;

async function sendMagicLinkEmail(email: string, magicUrl: string, isNew: boolean) {
  if (!resendKey) throw new Error("Email is not configured");
  const subject = isNew ? "Welcome to ManyHandz — confirm your email" : "Your ManyHandz sign-in link";
  const body = isNew
    ? `<p>Thanks for signing up! Click below to confirm your email and set up your AI team.</p>`
    : `<p>Click below to sign in to your ManyHandz dashboard. This link expires in 15 minutes.</p>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "ManyHandz <noreply@manyhandz.ai>",
      to: [email],
      subject,
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px">
          <h2 style="color:#1a1a2e;margin-bottom:8px">ManyHandz</h2>
          ${body}
          <a href="${magicUrl}" style="display:inline-block;margin:24px 0;padding:14px 28px;background:#b45309;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">
            ${isNew ? "Confirm email & get started" : "Sign in to dashboard"}
          </a>
          <p style="color:#999;font-size:13px">If you didn't request this, you can safely ignore it.</p>
        </div>
      `,
    }),
  });
  const data = await res.json().catch(() => ({} as Record<string, unknown>));
  if (!res.ok) {
    const msg = (data && (data.message || data.error)) || `Email send failed (${res.status})`;
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
}

Deno.serve((req) =>
  handleRequest(req, {
    jwtSecret,
    appUrl,
    admin,
    adminSecrets: adminSecretsFromEnv((k) => Deno.env.get(k)),
    now: () => new Date(),
    randomToken: () => crypto.randomUUID() + crypto.randomUUID(),
    sendMagicLinkEmail,
  }),
);
