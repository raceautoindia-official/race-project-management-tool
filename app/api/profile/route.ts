import { NextRequest } from "next/server";
import { query } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { json, errorResponse } from "@/lib/http";
import { updateProfileSchema } from "@/lib/validation";
import { logActivity } from "@/lib/activity";

export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({}));
    const { name } = updateProfileSchema.parse(body);

    await query(`UPDATE users SET name = ? WHERE id = ?`, [name, user.id]);
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
