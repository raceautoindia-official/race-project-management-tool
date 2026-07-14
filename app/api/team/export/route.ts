import { NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { requireUser } from "@/lib/auth";
import { errorResponse, forbidden } from "@/lib/http";
import { getTeamPerformance, ontimePct, effortPct } from "@/lib/performance";
import { formatHM } from "@/lib/tz";

export const dynamic = "force-dynamic";

/** GET /api/team/export — team performance report (.xlsx). Admin/lead only;
 *  scoped exactly like the /team page. */
export async function GET(_req: NextRequest) {
  try {
    const user = await requireUser();
    const { scope, members } = await getTeamPerformance(user);
    if (scope === "self") {
      throw forbidden("Only an admin or project lead can export the team report");
    }

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Team performance (30d)");
    ws.addRow([
      "Employee ID",
      "Name",
      "Role",
      "Open tasks",
      "In progress",
      "In review",
      "Overdue now",
      "Completed (30d)",
      "On-time / with due date",
      "On-time %",
      "Hours logged (30d)",
      "Effort vs estimate %",
      "Currently working on",
    ]);
    ws.columns = [
      { width: 14 }, { width: 24 }, { width: 10 }, { width: 12 }, { width: 12 },
      { width: 10 }, { width: 12 }, { width: 15 }, { width: 20 }, { width: 11 },
      { width: 17 }, { width: 19 }, { width: 50 },
    ];
    const header = ws.getRow(1);
    header.font = { bold: true, color: { argb: "FFFFFFFF" } };
    header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4F46E5" } };

    for (const m of members) {
      const otp = ontimePct(m);
      const eff = effortPct(m);
      ws.addRow([
        m.emp_id,
        m.name,
        m.role,
        m.open_tasks,
        m.in_progress,
        m.in_review,
        m.overdue_now,
        m.completed_30d,
        `${m.ontime_30d}/${m.due_completed_30d}`,
        otp === null ? "" : otp,
        formatHM(m.minutes_30d / 60),
        eff === null ? "" : eff,
        m.working_on.map((w) => `${w.title} (${w.project_name})`).join("; "),
      ]);
    }

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="team-performance.xlsx"`,
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
