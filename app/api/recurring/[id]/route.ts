import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { json, errorResponse, ApiError } from "@/lib/http";
import { recurringActionSchema, recurringRuleSchema } from "@/lib/validation";
import { actOnRule, deleteRule, listRules, updateRule } from "@/lib/recurring";

type Params = { params: Promise<{ id: string }> };

async function ruleId(params: Params["params"]): Promise<number> {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, "Invalid id");
  return id;
}

async function current(user: Awaited<ReturnType<typeof requireUser>>, id: number) {
  const [rule] = await listRules(user, { ruleId: id });
  return json({ rule: rule ?? null });
}

/** PUT — edit the rule; copies already made stay as they are. */
export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const id = await ruleId(params);
    await updateRule(user, id, recurringRuleSchema.parse(await req.json().catch(() => ({}))));
    return current(user, id);
  } catch (err) {
    return errorResponse(err);
  }
}

/** PATCH { action } — pause, resume, skip_next, unskip, end; approve / reject (admin). */
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const id = await ruleId(params);
    await actOnRule(user, id, recurringActionSchema.parse(await req.json().catch(() => ({}))));
    return current(user, id);
  } catch (err) {
    return errorResponse(err);
  }
}

/** DELETE — remove the rule for good (admin). Its copies stay. */
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    await deleteRule(user, await ruleId(params));
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
