import { NextRequest } from "next/server";
import { query } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { json, errorResponse, badRequest } from "@/lib/http";
import { updateProfileSchema } from "@/lib/validation";
import { logActivity } from "@/lib/activity";
import { normalizePhone } from "@/lib/whatsapp";

export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({}));
    const { name, phone, whatsappOptIn } = updateProfileSchema.parse(body);

    const sets = ["name = ?"];
    const values: unknown[] = [name];

    const clearingPhone = phone !== undefined && !(phone ?? "").trim();
    if (phone !== undefined) {
      const raw = (phone ?? "").trim();
      if (raw && !normalizePhone(raw)) {
        throw badRequest("Enter a valid mobile number, e.g. +91 98765 43210");
      }
      sets.push("phone = ?");
      values.push(raw || null);
    }
    if (whatsappOptIn !== undefined || clearingPhone) {
      // WhatsApp needs a number, so removing it also turns the alerts off.
      sets.push("whatsapp_opt_in = ?");
      values.push(!clearingPhone && whatsappOptIn ? 1 : 0);
    }

    values.push(user.id);
    await query(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`, values);
    await logActivity({
      userId: user.id,
      action: "user.profile_updated",
      entityType: "user",
      entityId: user.id,
    });

    return json({
      user: { id: user.id, name, email: user.email, role: user.role },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
