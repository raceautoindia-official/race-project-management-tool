import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizePhone, sendWhatsApp, whatsappConfigured } from "@/lib/whatsapp";

interface SentBody {
  messaging_product: string;
  to: string;
  type: string;
  text?: { body: string };
  template?: {
    name: string;
    language: { code: string };
    components: { type: string; parameters: { type: string; text: string }[] }[];
  };
}

function lastCall(): { url: string; init: RequestInit; body: SentBody } {
  const mock = vi.mocked(fetch).mock.calls.at(-1)!;
  const init = mock[1] as RequestInit;
  return { url: String(mock[0]), init, body: JSON.parse(String(init.body)) as SentBody };
}

describe("phone numbers", () => {
  it("normalizes to E.164 digits, adding the default country code", () => {
    expect(normalizePhone("+91 98765 43210")).toBe("919876543210");
    expect(normalizePhone("98765 43210")).toBe("919876543210");
    expect(normalizePhone("+1 (555) 010-9999")).toBe("15550109999");
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone("not a number")).toBeNull();
    expect(normalizePhone("123")).toBeNull();
  });
});

describe("WhatsApp sending", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("is off, and silent, until it is configured", async () => {
    expect(whatsappConfigured()).toBe(false);
    expect(await sendWhatsApp({ to: "+919876543210", message: "hi" })).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sends an approved template with the message as its parameter", async () => {
    vi.stubEnv("WHATSAPP_TOKEN", "tok");
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "12345");
    vi.stubEnv("WHATSAPP_TEMPLATE_NAME", "pm_alert");
    vi.stubEnv("APP_BASE_URL", "https://pm.example.test");

    expect(
      await sendWhatsApp({ to: "98765 43210", message: 'Task "Fix\n totals" is due', link: "/projects/8" })
    ).toBe(true);

    const { url, init, body } = lastCall();
    expect(url).toContain("/12345/messages");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(body).toMatchObject({
      messaging_product: "whatsapp",
      to: "919876543210",
      type: "template",
      template: { name: "pm_alert", language: { code: "en" } },
    });
    const text = body.template!.components[0].parameters[0].text;
    // Meta rejects newlines and runs of spaces in parameters; the link is appended.
    expect(text).toBe('Task "Fix totals" is due https://pm.example.test/projects/8');
  });

  it("falls back to a plain text message when no template is set", async () => {
    vi.stubEnv("WHATSAPP_TOKEN", "tok");
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "12345");
    expect(await sendWhatsApp({ to: "+919876543210", message: "hello" })).toBe(true);
    expect(lastCall().body).toMatchObject({ type: "text", text: { body: "hello" } });
  });

  it("reports a rejected send instead of throwing", async () => {
    vi.stubEnv("WHATSAPP_TOKEN", "tok");
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "12345");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('{"error":{"message":"bad number"}}', { status: 400 }))
    );
    expect(await sendWhatsApp({ to: "+919876543210", message: "hello" })).toBe(false);
  });

  it("does not send to an unusable number", async () => {
    vi.stubEnv("WHATSAPP_TOKEN", "tok");
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "12345");
    expect(await sendWhatsApp({ to: "abc", message: "hello" })).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
});
