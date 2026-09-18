/**
 * Incomplete-onboarding drip copy. Mike's voice — short, trades-friendly.
 * Pricing if mentioned: A$499/mo Small Business. Never the old sticker.
 */

import type { DripType } from "./windows.ts";

export const RESEND_FROM = "ManyHandz <noreply@manyhandz.ai>";
export const LOGIN_PATH = "/login";
export const VERIFY_PATH = "/verify";

export const SMALL_BUSINESS_PRICE = "A$499/mo";

export type DripCopy = {
  subject: string;
  heading: string;
  body: string[];
  cta: string;
  expiryNote: string;
};

export function escapeHtml(value: string): string {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function greetingName(businessName: string | null | undefined): string {
  const name = String(businessName || "").trim();
  return name || "there";
}

export function dripCopy(type: DripType): DripCopy {
  if (type === "day_1") {
    return {
      subject: "Your ManyHandz setup is still waiting",
      heading: "Your number is ready when you are",
      body: [
        "You started ManyHandz but haven't finished getting your number yet.",
        "Takes a couple of minutes — tap below and we'll pick up where you left off.",
      ],
      cta: "Get your number",
      expiryNote: "This link expires in 24 hours.",
    };
  }
  if (type === "day_3") {
    return {
      subject: "Need a hand finishing your ManyHandz setup?",
      heading: "Setup's still sitting there",
      body: [
        "Your ManyHandz account is still incomplete — no number yet.",
        "If you're stuck, reply to this email and we'll help. Otherwise tap below and we'll get it sorted.",
      ],
      cta: "Finish setup",
      expiryNote: "This link expires in 24 hours.",
    };
  }
  return {
    subject: "Last note on your ManyHandz setup",
    heading: "Won't keep chasing",
    body: [
      "Last nudge from us. Your 14-day free trial starts when you get your number — finish setup whenever you're ready.",
      `After that, Small Business is ${SMALL_BUSINESS_PRICE}. Cancel anytime.`,
    ],
    cta: "Finish setup",
    expiryNote: "This link expires in 24 hours.",
  };
}

export function dripEmailText(
  type: DripType,
  businessName: string | null | undefined,
  ctaUrl: string,
): string {
  const copy = dripCopy(type);
  const name = greetingName(businessName);
  return [
    `Hi ${name},`,
    "",
    ...copy.body,
    "",
    `${copy.cta}: ${ctaUrl}`,
    copy.expiryNote,
    "",
    "ManyHandz — app.manyhandz.ai",
  ].join("\n");
}

/** Navy / gold HTML — same family as live mh-trial-warnings. */
export function dripEmailHtml(
  type: DripType,
  businessName: string | null | undefined,
  ctaUrl: string,
): string {
  const copy = dripCopy(type);
  const name = escapeHtml(greetingName(businessName));
  const heading = escapeHtml(copy.heading);
  const cta = escapeHtml(copy.cta);
  const url = escapeHtml(ctaUrl);
  const paragraphs = copy.body
    .map((line) => `<p style="margin:0 0 16px;color:#94a3b8;font-size:16px;line-height:1.6;">${escapeHtml(line)}</p>`)
    .join("");

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#1e293b;border-radius:12px;overflow:hidden;max-width:600px;width:100%;">
        <tr>
          <td style="background:linear-gradient(135deg,#c9a84c,#f0c969);padding:32px 40px;text-align:center;">
            <h1 style="margin:0;color:#0f172a;font-size:24px;font-weight:700;">ManyHandz</h1>
            <p style="margin:6px 0 0;color:#3d2a00;font-size:14px;">Your AI receptionist</p>
          </td>
        </tr>
        <tr>
          <td style="padding:40px;">
            <h2 style="margin:0 0 16px;color:#f1f5f9;font-size:20px;">${heading}</h2>
            <p style="margin:0 0 16px;color:#f1f5f9;font-size:16px;">Hi ${name},</p>
            ${paragraphs}
            <table cellpadding="0" cellspacing="0" style="margin:8px auto 20px;">
              <tr>
                <td style="border-radius:8px;background:linear-gradient(135deg,#c9a84c,#f0c969);">
                  <a href="${url}"
                     style="display:inline-block;padding:14px 32px;color:#0f172a;font-size:16px;font-weight:700;text-decoration:none;border-radius:8px;">
                    ${cta} →
                  </a>
                </td>
              </tr>
            </table>
            <p style="margin:0;color:#64748b;font-size:13px;text-align:center;">${escapeHtml(copy.expiryNote)}</p>
          </td>
        </tr>
        <tr>
          <td style="border-top:1px solid #334155;padding:24px 40px;text-align:center;">
            <p style="margin:0;color:#475569;font-size:12px;">
              ManyHandz · <a href="https://app.manyhandz.ai" style="color:#c9a84c;text-decoration:none;">app.manyhandz.ai</a>
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
