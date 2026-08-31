/**
 * Signup nurture email sent to /try demo leads.
 * ManyHandz facts only — no DraftPilot, Tradify, SimPRO, or invoicing claims.
 */

export const VISITOR_FROM = "ManyHandz <info@manyhandz.ai>";
export const VISITOR_SUBJECT = "You're one step away from never missing a job";
export const SIGNUP_URL = "https://app.manyhandz.ai/signup";
export const SITE_URL = "https://manyhandz.ai";
export const TRY_URL = "https://manyhandz.ai/try";
export const PRIVACY_URL = "https://manyhandz.ai/privacy";

export function visitorFirstName(name: string): string {
  const first = (name || "").trim().split(/\s+/)[0];
  return first || "there";
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function ctaButton(): string {
  return (
    `<a href="${SIGNUP_URL}" style="display:inline-block;background:#c9a84c;color:#0f1f3d;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:700;text-decoration:none;padding:14px 28px;border-radius:8px;">Get started free →</a>`
  );
}

export function visitorEmailText(name: string): string {
  const first = visitorFirstName(name);
  return [
    `Hey ${first},`,
    "",
    "You just asked ManyHandz to call you. That's the receptionist your customers get — an Australian number, a voice that knows the business, and an answer when you can't pick up.",
    "",
    "Don't just hear it. Put it on your phones and your website.",
    "",
    `Get started free (about 5 minutes): ${SIGNUP_URL}`,
    "",
    "Never miss a call",
    "AI answers 24/7 on a dedicated AU number. It screens callers, handles FAQs, takes a message, and transfers VIPs to you. Jobs don't go to the competitor because you were on the tools.",
    "",
    "Finish the day actually finished",
    "After-hours and weekend calls still get answered. You get the message, not a pile of missed-call voicemails to wade through in the morning.",
    "",
    "One setup, phone and chat",
    "Enter your services, hours, and FAQs once in the ManyHandz dashboard. Voice and the website chat widget share the same knowledge base. We scan your site and you're live in about five minutes.",
    "",
    "Small Business is $199/mo AUD with 600 minutes, a dedicated AU number, SMS notifications, staff transfers, and cancel anytime. Need more? Reply to this email for Enterprise.",
    "",
    "Australian owned, built in Perth. Your data stays isolated and is never used to train models.",
    "",
    `Signup: ${SIGNUP_URL}`,
    `Hear another live demo: ${TRY_URL}`,
    `Site: ${SITE_URL}`,
    "",
    "You're getting this because you requested a live demo at manyhandz.ai/try. Reply if you don't want another follow-up.",
    "ManyHandz — Perth, Australia — info@manyhandz.ai",
  ].join("\n");
}

export function visitorEmailHtml(name: string): string {
  const first = escapeHtml(visitorFirstName(name));
  const button = ctaButton();
  return `<!DOCTYPE html>
<html lang="en">
<body style="margin:0;padding:0;background:#f8f9fb;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8f9fb;font-family:Arial,Helvetica,sans-serif;">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
          <tr>
            <td style="background:#0f1f3d;padding:22px 32px;">
              <span style="font-size:22px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;">ManyHandz<span style="color:#c9a84c;">.</span></span>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 32px 8px;color:#0f1f3d;font-size:24px;font-weight:800;line-height:1.3;">
              You're one step away from never missing a job
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px 0;color:#334155;font-size:16px;line-height:1.7;">
              <p style="margin:0 0 16px;">Hey ${first},</p>
              <p style="margin:0 0 16px;">You just asked ManyHandz to call you. That's the receptionist your customers get — an Australian number, a voice that knows the business, and an answer when you can't pick up.</p>
              <p style="margin:0 0 24px;font-weight:600;color:#0f1f3d;">Don't just hear it. Put it on your phones and your website.</p>
              <p style="margin:0 0 28px;">${button}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 8px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding:18px 0;border-top:1px solid #e2e8f0;">
                    <p style="margin:0 0 6px;color:#c9a84c;font-size:12px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;">Never miss a call</p>
                    <p style="margin:0;color:#334155;font-size:15px;line-height:1.65;">AI answers 24/7 on a dedicated AU number. It screens callers, handles FAQs, takes a message, and transfers VIPs straight to you. Jobs don't go to the competitor because you were on the tools.</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:18px 0;border-top:1px solid #e2e8f0;">
                    <p style="margin:0 0 6px;color:#c9a84c;font-size:12px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;">Finish the day actually finished</p>
                    <p style="margin:0;color:#334155;font-size:15px;line-height:1.65;">After-hours and weekend calls still get answered. You get the message — not a pile of missed-call voicemails to wade through in the morning.</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:18px 0;border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;">
                    <p style="margin:0 0 6px;color:#c9a84c;font-size:12px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;">One setup, phone and chat</p>
                    <p style="margin:0;color:#334155;font-size:15px;line-height:1.65;">Enter your services, hours, and FAQs once in the dashboard. Voice and the website chat widget share the same knowledge base. We scan your site and you're live in about five minutes.</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 32px 8px;color:#334155;font-size:15px;line-height:1.7;">
              <p style="margin:0 0 8px;color:#0f1f3d;font-weight:700;">Simple pricing</p>
              <p style="margin:0 0 16px;">Small Business is <strong>$199/mo AUD</strong> with 600 minutes, a dedicated AU number, SMS notifications, staff transfers, and cancel anytime. Need more? Reply to this email for Enterprise.</p>
              <p style="margin:0 0 24px;">Australian owned, built in Perth. Your data stays isolated and is never used to train models.</p>
              <p style="margin:0 0 8px;">${button}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 32px 32px;color:#64748b;font-size:12px;line-height:1.6;">
              You're getting this because you requested a live demo at <a href="${TRY_URL}" style="color:#b8963e;">manyhandz.ai/try</a>. Reply to this email if you don't want another follow-up.<br/><br/>
              <a href="${SITE_URL}" style="color:#b8963e;">manyhandz.ai</a> · <a href="${PRIVACY_URL}" style="color:#b8963e;">Privacy</a> · info@manyhandz.ai<br/>
              ManyHandz — Perth, Australia
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
