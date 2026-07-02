import { requireUser } from "@/lib/auth";
import { json, errorResponse } from "@/lib/http";

export async function GET() {
  try {
    const user = await requireUser();
    return json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        must_change_password: user.must_change_password,
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
