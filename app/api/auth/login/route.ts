import { NextRequest } from "next/server";
import { signSession, setSessionCookie } from "@/lib/auth";
import { json, errorResponse, ApiError } from "@/lib/http";
import { loginSchema } from "@/lib/validation";
import { checkRateLimit, clearRateLimit } from "@/lib/ratelimit";
import { logActivity } from "@/lib/activity";
import {
  findEmployeeByEmpId,
  verifyEmployeePin,
  provisionPmUser,
  mapAttendanceRole,
  DUMMY_PIN_HASH,
} from "@/lib/attendance";

/**
 * POST /api/auth/login
 *
 * Credentials are federated to the parent Attendance app: the user signs in
 * with their attendance Employee ID + PIN. We verify the PIN against
 * `attendance.employees`, mirror the employee into `pm_app.users`, then issue
 * the normal PM session cookie.
 */
export async function POST(req: NextRequest) {
  try {
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
    const body = await req.json().catch(() => ({}));
    const { emp_id, pin } = loginSchema.parse(body);

    const rl = checkRateLimit(`login:${ip}:${emp_id}`);
    if (!rl.ok) {
      throw new ApiError(
        429,
        `Too many login attempts. Try again in ${rl.retryAfter}s.`
      );
    }

    // 1. Look up the employee in the parent Attendance DB.
    const employee = await findEmployeeByEmpId(emp_id);

    // 2. Always run one bcrypt compare (even when the employee is missing) to
    //    avoid leaking which Employee IDs exist via response timing.
    const pinOk = await verifyEmployeePin(
      pin,
      employee?.pin_hash ?? DUMMY_PIN_HASH
    );

    // Generic message so we don't reveal whether the ID or the PIN was wrong.
    if (!employee || !pinOk) {
      throw new ApiError(401, "Invalid Employee ID or PIN");
    }

    if (!employee.is_active) {
      throw new ApiError(403, "This account has been deactivated");
    }

    clearRateLimit(`login:${ip}:${emp_id}`);

    // 3. Mirror the employee into pm_app.users (JIT provisioning).
    const pmUserId = await provisionPmUser(employee);
    const role = mapAttendanceRole(employee.role);

    // 4. Issue the PM session.
    const token = await signSession({
      userId: pmUserId,
      role,
      name: employee.name,
    });
    await setSessionCookie(token);

    await logActivity({
      userId: pmUserId,
      action: "user.login",
      entityType: "user",
      entityId: pmUserId,
      metadata: { emp_id: employee.emp_id },
    });

    return json({
      user: {
        id: pmUserId,
        emp_id: employee.emp_id,
        name: employee.name,
        email: employee.email,
        role,
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
