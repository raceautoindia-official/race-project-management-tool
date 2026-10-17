import { requireAdmin } from "@/lib/auth";
import { json, errorResponse, ApiError } from "@/lib/http";
import { emailLayout, mailerTransport, sendEmail, verifyMailer } from "@/lib/mailer";
import { checkRateLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

export interface EmailCheck {
  ok: boolean;
  transport: "smtp" | "ses" | "none";
  message: string;
}

/**
 * GET  /api/admin/email-check — can this server send email at all?
 * POST /api/admin/email-check — send a real one to the admin asking.
 *
 * Email fails quietly by design here: a notification that cannot be sent
 * must not break the action that triggered it. The cost of that is nobody
 * noticing it is broken, which is exactly what happened with the expired
 * SES key. This makes it a question you can ask.
 */
export async function GET() {
  try {
    await requireAdmin();
    const { ok, detail } = await verifyMailer();
    return json<EmailCheck>({ ok, transport: mailerTransport(), message: detail });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST() {
  try {
    const user = await requireAdmin();
    const rl = checkRateLimit(`email-check:${user.id}`, 5);
    if (!rl.ok) throw new ApiError(429, `Too many tests. Try again in ${rl.retryAfter}s.`);

    if (!user.email) {
      throw new ApiError(400, "Your account has no email address to send a test to.");
    }

    const transport = mailerTransport();
    if (transport === "none") {
      return json<EmailCheck>({
        ok: false,
        transport,
        message: "No email is configured — set SMTP_* (or SES_*) and restart.",
      });
    }

    const sent = await sendEmail({
      to: user.email,
      subject: "PMApp email test",
      html: emailLayout(
        "Email is working",
        `<p>This is a test from PMApp, sent over ${transport.toUpperCase()}.</p>
         <p>If you can read it, notifications and meeting invitations will go out too.</p>`
      ),
      text: `This is a test from PMApp, sent over ${transport.toUpperCase()}.`,
    });

    return json<EmailCheck>({
      ok: sent,
      transport,
      message: sent
        ? `Sent to ${user.email} over ${transport.toUpperCase()}. Check your inbox — and your spam folder, which is where a domain problem shows up.`
        : "The server refused it. The reason is in the app log: pm2 logs pm-app | grep mailer",
    });
  } catch (err) {
    return errorResponse(err);
  }
}
