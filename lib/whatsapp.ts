import "server-only";
import { query, DbRow } from "./db";
import { appBaseUrl } from "./mailer";

/**
 * WhatsApp alerts via Meta's WhatsApp Cloud API.
 *
 * Nothing is sent unless WHATSAPP_TOKEN + WHATSAPP_PHONE_NUMBER_ID are set and
 * the person opted in with a number on their profile — so this is a no-op in
 * development and in tests, exactly like the mailer.
 *
 * Meta only allows business-initiated messages through an approved *template*.
 * Set WHATSAPP_TEMPLATE_NAME to that template's name; it must have one body
 * parameter, which receives the notification text (with the link appended).
 * Without a template name a plain text message is sent instead, which Meta
 * only delivers inside a 24-hour customer-service window — useful for testing.
 */

const API_VERSION = process.env.WHATSAPP_API_VERSION ?? "v21.0";

export function whatsappConfigured(): boolean {
  return Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
}

/**
 * To E.164 digits (no "+"), assuming the default country code for local
 * numbers. Returns null if it can't be a phone number.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  const hadPlus = trimmed.startsWith("+");
  let digits = trimmed.replace(/\D+/g, "");
  if (!digits) return null;
  if (!hadPlus) {
    const cc = (process.env.WHATSAPP_DEFAULT_COUNTRY_CODE ?? "91").replace(/\D+/g, "");
    // A bare local number (e.g. 10 digits in India) gets the country code.
    if (cc && digits.length <= 10) digits = cc + digits;
  }
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

function body(to: string, text: string): Record<string, unknown> {
  const template = process.env.WHATSAPP_TEMPLATE_NAME;
  if (!template) {
    return { messaging_product: "whatsapp", to, type: "text", text: { body: text, preview_url: true } };
  }
  return {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: template,
      language: { code: process.env.WHATSAPP_TEMPLATE_LANG ?? "en" },
      components: [{ type: "body", parameters: [{ type: "text", text }] }],
    },
  };
}

/** Send one message. Never throws — a failure is logged and reported as false. */
export async function sendWhatsApp(opts: {
  to: string;
  message: string;
  link?: string | null;
}): Promise<boolean> {
  if (!whatsappConfigured()) return false;
  const to = normalizePhone(opts.to);
  if (!to) return false;

  const link = opts.link ? `${appBaseUrl()}${opts.link}` : "";
  // Meta rejects parameters containing newlines, tabs or runs of spaces.
  const text = `${opts.message}${link ? ` ${link}` : ""}`.replace(/\s+/g, " ").trim().slice(0, 900);

  try {
    const res = await fetch(
      `https://graph.facebook.com/${API_VERSION}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body(to, text)),
      }
    );
    if (!res.ok) {
      const detail = await res.json().catch(() => null);
      // Log why it failed, not who it was for: Meta echoes the number back.
      const reason =
        (detail as { error?: { message?: string; code?: number } } | null)?.error?.message ??
        "no details";
      console.error(`[whatsapp] send failed (${res.status}):`, String(reason).slice(0, 200));
      return false;
    }
    return true;
  } catch (err) {
    console.error("[whatsapp] send failed:", (err as Error).message);
    return false;
  }
}

/** Send to a user, if they are active, opted in and have a number. */
export async function sendWhatsAppToUser(
  userId: number,
  message: string,
  link?: string | null
): Promise<boolean> {
  if (!whatsappConfigured()) return false;
  try {
    const rows = await query<DbRow[]>(
      `SELECT phone FROM users
        WHERE id = ? AND is_active = TRUE AND whatsapp_opt_in = TRUE AND phone IS NOT NULL
        LIMIT 1`,
      [userId]
    );
    const phone = rows[0]?.phone as string | undefined;
    if (!phone) return false;
    return await sendWhatsApp({ to: phone, message, link });
  } catch (err) {
    console.error("[whatsapp] lookup failed:", (err as Error).message);
    return false;
  }
}
