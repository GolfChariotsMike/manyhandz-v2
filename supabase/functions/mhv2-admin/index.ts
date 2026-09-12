import {
  outreachKeyMissingError,
  outreachServiceRoleKeyFromEnv,
  outreachUrlFromEnv,
} from "../_shared/outreach-env.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const ADMIN_TOKEN = "mh_admin_mikek";
const DEMO_AGENT_ID = "agent_4701kzv3pb8sfkwrdbja7s22rk75";
const OUTBOUND_AGENT_ID = "agent_0301m07zpn6eebwvy5p25j7kzeqh";
const EL_API_KEY = Deno.env.get("ELEVENLABS_API_KEY") || Deno.env.get("EL_API_KEY") || "";

const getEnv = (key: string) => Deno.env.get(key);
const OUTREACH_SRK = outreachServiceRoleKeyFromEnv(getEnv);
const OUTREACH_URL = outreachUrlFromEnv(getEnv);

const TWILIO_ACCOUNTS = [
  {
    sid: Deno.env.get("TWILIO_ACCOUNT_SID") || Deno.env.get("MANYHANDZ_TWILIO_SID") || "",
    token: Deno.env.get("TWILIO_AUTH_TOKEN") || Deno.env.get("MANYHANDZ_TWILIO_TOKEN") || "",
    label: "ManyHandz",
  },
  {
    sid: Deno.env.get("OSSIE_TWILIO_SID") || "",
    token: Deno.env.get("OSSIE_TWILIO_TOKEN") || "",
    label: "Ossie",
  },
].filter((acct) => acct.sid && acct.token);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-admin-token",
};

function outreachHeaders(): Record<string, string> | null {
  if (!OUTREACH_SRK) return null;
  return { Authorization: `Bearer ${OUTREACH_SRK}`, apikey: OUTREACH_SRK };
}

function outreachUnavailable(): Response {
  return new Response(JSON.stringify(outreachKeyMissingError()), {
    status: 503,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const adminToken = req.headers.get("x-admin-token");
  if (adminToken !== ADMIN_TOKEN) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: cors,
    });
  }

  const url = new URL(req.url);

  // Queue action — POST /mhv2-admin/queue
  if (req.method === "POST" && url.pathname.endsWith("/queue")) {
    const headers = outreachHeaders();
    if (!headers) return outreachUnavailable();
    const body = await req.json().catch(() => ({}));
    const { category, status = "new", limit = 50, clear, contact } = body;
    if (contact && typeof contact === "object") {
      const row = {
        contact_id: contact.id,
        name: contact.name,
        phone: contact.phone,
        business: contact.business,
        category: contact.category,
        status: "pending",
        position: 999,
      };
      await fetch(`${OUTREACH_URL}/rest/v1/outreach_call_queue`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify(row),
      });
      return new Response(JSON.stringify({ queued: 1 }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    if (clear) {
      await fetch(
        `${OUTREACH_URL}/rest/v1/outreach_call_queue?id=neq.00000000-0000-0000-0000-000000000000`,
        { method: "DELETE", headers },
      );
      return new Response(JSON.stringify({ cleared: true }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    let qurl =
      `${OUTREACH_URL}/rest/v1/outreach_contacts?select=id,name,phone,business,category&status=eq.${status}&limit=${limit}&order=created_at.asc`;
    if (category && category !== "all") qurl += `&category=eq.${category}`;
    const cRes = await fetch(qurl, { headers });
    const contacts = await cRes.json();
    if (!Array.isArray(contacts) || !contacts.length) {
      return new Response(
        JSON.stringify({ queued: 0, message: "No contacts found" }),
        { headers: { ...cors, "Content-Type": "application/json" } },
      );
    }
    await fetch(
      `${OUTREACH_URL}/rest/v1/outreach_call_queue?id=neq.00000000-0000-0000-0000-000000000000`,
      { method: "DELETE", headers },
    );
    const rows = contacts.map((c, i) => ({
      contact_id: c.id,
      name: c.name,
      phone: c.phone,
      business: c.business,
      category: c.category,
      status: "pending",
      position: i + 1,
    }));
    await fetch(`${OUTREACH_URL}/rest/v1/outreach_call_queue`, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(rows),
    });
    return new Response(JSON.stringify({ queued: contacts.length }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  // Save demo agent — PATCH only first_message + prompt fields (full config PATCH fails on ElevenLabs)
  if (req.method === "PATCH" && url.pathname.endsWith("/agent")) {
    const body = await req.json().catch(() => ({}));
    const { first_message, prompt } = body;
    const agentPatch: Record<string, unknown> = {};
    if (first_message !== undefined) agentPatch.first_message = first_message;
    if (prompt !== undefined) {
      agentPatch.prompt = { prompt };
    }
    if (!Object.keys(agentPatch).length) {
      return new Response(JSON.stringify({ ok: false, error: "Nothing to update" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    const patchRes = await fetch(
      `https://api.elevenlabs.io/v1/convai/agents/${DEMO_AGENT_ID}`,
      {
        method: "PATCH",
        headers: {
          "xi-api-key": EL_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          conversation_config: { agent: agentPatch },
        }),
      },
    );
    const result = await patchRes.json().catch(() => ({}));
    return new Response(
      JSON.stringify({
        ok: patchRes.ok,
        first_message:
          result?.conversation_config?.agent?.first_message ?? first_message ?? null,
        error: patchRes.ok
          ? null
          : (typeof result === "object"
            ? JSON.stringify(result).slice(0, 400)
            : String(result)),
      }),
      {
        status: patchRes.ok ? 200 : 500,
        headers: { ...cors, "Content-Type": "application/json" },
      },
    );
  }

  // Queue status — GET /mhv2-admin/queue
  if (req.method === "GET" && url.pathname.endsWith("/queue")) {
    const headers = outreachHeaders();
    if (!headers) return outreachUnavailable();
    const qRes = await fetch(
      `${OUTREACH_URL}/rest/v1/outreach_call_queue?select=*&order=position.asc&limit=500`,
      { headers },
    );
    const queue = await qRes.json();
    const list = Array.isArray(queue) ? queue : [];
    const pending = list.filter((q) => q.status === "pending").length;
    const done = list.filter((q) => q.status === "done").length;
    const noAnswer = list.filter((q) => q.status === "no_answer").length;
    const busy = list.filter((q) => q.status === "busy").length;
    const failed = list.filter((q) => q.status === "failed").length;
    return new Response(
      JSON.stringify({
        queue,
        pending,
        done,
        no_answer: noAnswer,
        busy,
        failed,
        total: list.length,
      }),
      { headers: { ...cors, "Content-Type": "application/json" } },
    );
  }

  try {
    const custRes = await fetch(
      `${SUPABASE_URL}/rest/v1/mh_v2_customers?select=id,email,business_name,industry,plan,subscription_status,stripe_customer_id,stripe_subscription_id,twilio_number,voice_active,onboarding_complete,el_agent_id,trial_started_at,trial_ends_at,created_at,last_login_at&order=created_at.desc&limit=500`,
      {
        headers: {
          Authorization: `Bearer ${SUPABASE_SRK}`,
          apikey: SUPABASE_SRK,
        },
      },
    );
    const customers = await custRes.json();
    const assignedNumbers = new Set(
      (Array.isArray(customers) ? customers : [])
        .map((c) => c.twilio_number)
        .filter(Boolean),
    );
    const unassigned = [];
    for (const acct of TWILIO_ACCOUNTS) {
      try {
        const r = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${acct.sid}/IncomingPhoneNumbers.json?PageSize=100`,
          {
            headers: {
              Authorization: "Basic " + btoa(`${acct.sid}:${acct.token}`),
            },
          },
        );
        const data = await r.json();
        for (const n of data.incoming_phone_numbers || []) {
          if (
            !assignedNumbers.has(n.phone_number) &&
            n.friendly_name?.startsWith("ManyHandz")
          ) {
            const isDemo = n.phone_number === "+61485021312";
            unassigned.push({
              number: n.phone_number,
              sid: n.sid,
              friendly_name: isDemo ? "Demo Line" : n.friendly_name,
              account: acct.label,
              isDemo,
            });
          }
        }
      } catch (e) {
        console.error(`Twilio fetch failed for ${acct.sid}:`, e);
      }
    }
    unassigned.sort((a, b) => (b.isDemo ? 1 : 0) - (a.isDemo ? 1 : 0));

    let outreachContacts = [];
    let outreachStats = { total: 0, new: 0, contacted: 0, not_interested: 0 };
    const outreachAuth = outreachHeaders();
    if (outreachAuth) {
      try {
        const ocRes = await fetch(
          `${OUTREACH_URL}/rest/v1/outreach_contacts?select=id,name,phone,business,city,category,rating,reviews,status,sms_sent&order=created_at.desc&limit=2000`,
          {
            headers: {
              ...outreachAuth,
              Range: "0-1999",
              Prefer: "count=none",
            },
          },
        );
        outreachContacts = await ocRes.json();
        if (Array.isArray(outreachContacts)) {
          outreachStats.total = outreachContacts.length;
          outreachStats.new = outreachContacts.filter((c) => c.status === "new").length;
          outreachStats.contacted = outreachContacts.filter((c) =>
            c.status === "contacted"
          ).length;
          outreachStats.not_interested = outreachContacts.filter((c) =>
            c.status === "not_interested"
          ).length;
        }
      } catch (e) {
        console.error("Outreach fetch failed:", e);
      }
    }

    let recentQueue = [];
    if (outreachAuth) {
      try {
        const rqRes = await fetch(
          `${OUTREACH_URL}/rest/v1/outreach_call_queue?select=*&called_at=not.is.null&order=called_at.desc&limit=50`,
          { headers: outreachAuth },
        );
        const rq = await rqRes.json();
        recentQueue = Array.isArray(rq) ? rq : [];
      } catch (e) {
        console.error("Queue fetch failed:", e);
      }
    }

    let outboundCalls = [];
    try {
      const obRes = await fetch(
        `https://api.elevenlabs.io/v1/convai/conversations?agent_id=${OUTBOUND_AGENT_ID}&page_size=50`,
        { headers: { "xi-api-key": EL_API_KEY } },
      );
      const obData = await obRes.json();
      const listed = obData.conversations || [];
      outboundCalls = await Promise.all(listed.slice(0, 12).map(async (c) => {
        let detail = {};
        try {
          const detailRes = await fetch(
            `https://api.elevenlabs.io/v1/convai/conversations/${c.conversation_id}`,
            { headers: { "xi-api-key": EL_API_KEY } },
          );
          detail = await detailRes.json();
        } catch {
          detail = {};
        }
        const analysis = detail.analysis || c.analysis || {};
        const phone = detail.metadata?.phone_call?.external_number ??
          detail.metadata?.phone_call?.to_number ??
          c.metadata?.phone_call?.external_number ??
          c.metadata?.phone_call?.to_number ??
          null;
        return {
          id: c.conversation_id,
          started_at: c.start_time_unix_secs
            ? new Date(c.start_time_unix_secs * 1000).toISOString()
            : null,
          duration_seconds: c.call_duration_secs,
          status: c.status,
          transcript_summary: analysis.transcript_summary ?? null,
          call_summary_title: c.call_summary_title ?? analysis.call_summary_title ?? null,
          phone,
        };
      }));
    } catch (e) {
      console.error("EL outbound fetch failed:", e);
    }

    let demoCalls = [];
    try {
      const elRes = await fetch(
        `https://api.elevenlabs.io/v1/convai/conversations?agent_id=${DEMO_AGENT_ID}&page_size=20`,
        { headers: { "xi-api-key": EL_API_KEY } },
      );
      const elData = await elRes.json();
      const convList = elData.conversations || [];
      demoCalls = await Promise.all(
        convList.map(async (c) => {
          try {
            const detailRes = await fetch(
              `https://api.elevenlabs.io/v1/convai/conversations/${c.conversation_id}`,
              { headers: { "xi-api-key": EL_API_KEY } },
            );
            const detail = await detailRes.json();
            const phone = detail.metadata?.phone_call?.external_number ?? null;
            const transcript = detail.transcript || [];
            const userLines = transcript
              .filter((t) => t.role === "user")
              .map((t) => t.message)
              .filter(Boolean);
            const summary = userLines.length > 0
              ? userLines
                .map((l) => l.trim())
                .filter((l) => l.length > 2)
                .join(" · ")
                .slice(0, 200)
              : c.call_summary_title ?? null;
            return {
              id: c.conversation_id,
              started_at: c.start_time_unix_secs
                ? new Date(c.start_time_unix_secs * 1000).toISOString()
                : null,
              duration_seconds: c.call_duration_secs,
              status: c.status,
              from_number: phone,
              transcript_summary: summary,
            };
          } catch {
            return {
              id: c.conversation_id,
              started_at: c.start_time_unix_secs
                ? new Date(c.start_time_unix_secs * 1000).toISOString()
                : null,
              duration_seconds: c.call_duration_secs,
              status: c.status,
              from_number: null,
              transcript_summary: c.call_summary_title ?? null,
            };
          }
        }),
      );
    } catch (e) {
      console.error("EL fetch failed:", e);
    }

    let demoAgent = {};
    try {
      const agentRes = await fetch(
        `https://api.elevenlabs.io/v1/convai/agents/${DEMO_AGENT_ID}`,
        { headers: { "xi-api-key": EL_API_KEY } },
      );
      const agentData = await agentRes.json();
      const agentConf = agentData.conversation_config?.agent || {};
      demoAgent = {
        first_message: agentConf.first_message ?? "",
        prompt: agentConf.prompt?.prompt ?? "",
      };
    } catch (e) {
      console.error("Agent config fetch failed:", e);
    }

    return new Response(
      JSON.stringify({
        customers,
        unassigned_numbers: unassigned,
        demo_calls: demoCalls,
        demo_agent: demoAgent,
        outreach_contacts: outreachContacts,
        outreach_stats: outreachStats,
        outbound_calls: outboundCalls,
        recent_queue: recentQueue,
      }),
      { headers: { ...cors, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: cors,
    });
  }
});
