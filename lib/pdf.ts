import "server-only";
import {
  PDFDocument,
  PDFFont,
  PDFPage,
  PageSizes,
  StandardFonts,
  rgb,
  type RGB,
} from "pdf-lib";
import { formatDate } from "./format";
import { formatIst, formatMinutes } from "./tz";
import { TASK_STATUS_LABELS, type Task } from "./types";
import { specFieldsFor, WORK_TYPE_LABELS } from "./workflow";

/** Everything printed on a task's PDF — plain data, so it's testable without a DB. */
export interface TaskPdfData {
  task: Task;
  subtasks: { title: string; is_done: boolean }[];
  comments: { user_name: string | null; body: string; created_at: string }[];
  attachments: { filename: string; size_bytes: number; uploader_name: string | null }[];
  loggedMinutes: number;
  generatedBy: string;
  generatedAt?: Date;
}

const MARGIN = 48;
const [PAGE_W, PAGE_H] = PageSizes.A4;
const CONTENT_W = PAGE_W - MARGIN * 2;
const FOOTER_H = 28;

const INK = rgb(0.12, 0.16, 0.23); // slate-800
const MUTED = rgb(0.39, 0.45, 0.55); // slate-500
const RULE = rgb(0.89, 0.91, 0.94); // slate-200
const ACCENT = rgb(0.31, 0.27, 0.9); // indigo-600
const GREEN = rgb(0.09, 0.4, 0.2);
const GREEN_BG = rgb(0.94, 0.99, 0.96);

// Standard PDF fonts only cover WinAnsi; map common characters and replace the
// rest so user text (₹, arrows, emoji, other scripts) never breaks generation.
const REPLACEMENTS: Record<string, string> = {
  "	": "    ",
  " ": " ", // no-break space
  " ": " ", // figure space
  " ": " ", // thin space
  " ": " ", // narrow no-break space (some ICU versions use it before "am/pm")
  "​": "", // zero-width space
  "‑": "-", // non-breaking hyphen
  "−": "-", // minus sign
  "₹": "Rs.",
  "→": "->",
  "←": "<-",
  "⇒": "=>",
  "≥": ">=",
  "≤": "<=",
  "≠": "!=",
  "✓": "v",
  "✔": "v",
  "✗": "x",
  "✕": "x",
};

class Writer {
  private page!: PDFPage;
  private y = 0;
  private charset: Set<number>;

  constructor(
    private doc: PDFDocument,
    private font: PDFFont,
    private bold: PDFFont
  ) {
    this.charset = new Set(font.getCharacterSet());
    this.addPage();
  }

  addPage() {
    this.page = this.doc.addPage([PAGE_W, PAGE_H]);
    this.y = PAGE_H - MARGIN;
  }

  /** Start a new page unless `height` more points fit above the footer. */
  ensure(height: number) {
    if (this.y - height < MARGIN + FOOTER_H) this.addPage();
  }

  clean(text: string): string {
    let out = "";
    for (const ch of text.replace(/\r\n?/g, "\n")) {
      if (ch === "\n" || this.charset.has(ch.codePointAt(0)!)) out += ch;
      else out += ch in REPLACEMENTS ? REPLACEMENTS[ch] : "?";
    }
    return out;
  }

  /** Word-wrap one paragraph to `width`, hard-breaking words that don't fit. */
  wrap(text: string, font: PDFFont, size: number, width: number): string[] {
    const lines: string[] = [];
    for (const para of this.clean(text).split("\n")) {
      let line = "";
      for (const word of para.split(" ")) {
        const candidate = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(candidate, size) <= width) {
          line = candidate;
          continue;
        }
        if (line) lines.push(line);
        line = "";
        // Hard-break a word wider than the line, measuring one glyph at a time
        // (linear — re-measuring shrinking slices is quadratic on long input).
        let chunk = "";
        let chunkWidth = 0;
        for (const ch of word) {
          const w = font.widthOfTextAtSize(ch, size);
          if (chunk && chunkWidth + w > width) {
            lines.push(chunk);
            chunk = "";
            chunkWidth = 0;
          }
          chunk += ch;
          chunkWidth += w;
        }
        line = chunk;
      }
      lines.push(line);
    }
    return lines;
  }

  text(
    text: string,
    opts: { size?: number; bold?: boolean; color?: RGB; x?: number; width?: number; gap?: number } = {}
  ) {
    const size = opts.size ?? 10;
    const font = opts.bold ? this.bold : this.font;
    const x = opts.x ?? MARGIN;
    const lineH = size * 1.35;
    for (const line of this.wrap(text, font, size, opts.width ?? CONTENT_W - (x - MARGIN))) {
      this.ensure(lineH);
      this.y -= lineH;
      this.page.drawText(line, { x, y: this.y + size * 0.25, size, font, color: opts.color ?? INK });
    }
    this.y -= opts.gap ?? 0;
  }

  space(h: number) {
    this.y -= h;
  }

  heading(label: string) {
    // Room for the heading and its first lines, so it isn't stranded at a page end.
    this.ensure(70);
    this.space(14);
    this.text(label.toUpperCase(), { size: 9, bold: true, color: ACCENT });
    this.space(3);
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: PAGE_W - MARGIN, y: this.y },
      thickness: 0.75,
      color: RULE,
    });
    this.space(6);
  }

  /** Label / value rows in two columns, each row kept on one page. */
  fields(rows: [string, string][]) {
    const labelW = 130;
    for (const [label, rawValue] of rows) {
      const value = rawValue || "—";
      const labelLines = this.wrap(label, this.font, 9, labelW - 8);
      const valueLines = this.wrap(value, this.font, 10, CONTENT_W - labelW);
      const rowH = Math.max(labelLines.length * 9, valueLines.length * 10) * 1.35 + 3;
      if (rowH > PAGE_H - MARGIN * 2 - FOOTER_H - 40) {
        // Too tall to keep together: stack the label above the flowing value.
        this.text(label, { size: 9, color: MUTED });
        this.text(value, { gap: 3 });
        continue;
      }
      this.ensure(rowH);
      const top = this.y;
      labelLines.forEach((line, i) =>
        this.page.drawText(line, {
          x: MARGIN,
          y: top - (i + 1) * 9 * 1.35 + 9 * 0.25,
          size: 9,
          font: this.font,
          color: MUTED,
        })
      );
      valueLines.forEach((line, i) =>
        this.page.drawText(line, {
          x: MARGIN + labelW,
          y: top - (i + 1) * 10 * 1.35 + 10 * 0.25,
          size: 10,
          font: this.font,
          color: INK,
        })
      );
      this.y = top - rowH;
    }
  }

  /** A shaded banner (used for the signed-off stamp). */
  banner(lines: string[], color: RGB, bg: RGB) {
    const size = 10;
    const wrapped = lines.flatMap((l, i) =>
      this.wrap(l, i === 0 ? this.bold : this.font, size, CONTENT_W - 24).map(
        (w) => [w, i === 0] as const
      )
    );
    const h = wrapped.length * size * 1.4 + 16;
    this.ensure(h + 6);
    this.page.drawRectangle({
      x: MARGIN,
      y: this.y - h,
      width: CONTENT_W,
      height: h,
      color: bg,
      borderColor: color,
      borderWidth: 1,
    });
    let y = this.y - 8;
    for (const [line, isBold] of wrapped) {
      y -= size * 1.4;
      this.page.drawText(line, {
        x: MARGIN + 12,
        y: y + size * 0.3,
        size,
        font: isBold ? this.bold : this.font,
        color,
      });
    }
    this.y -= h + 6;
  }

  footer(text: string) {
    const pages = this.doc.getPages();
    pages.forEach((p, i) => {
      const label = this.clean(`${text}  ·  Page ${i + 1} of ${pages.length}`);
      p.drawLine({
        start: { x: MARGIN, y: MARGIN + 14 },
        end: { x: PAGE_W - MARGIN, y: MARGIN + 14 },
        thickness: 0.5,
        color: RULE,
      });
      p.drawText(label, { x: MARGIN, y: MARGIN, size: 8, font: this.font, color: MUTED });
    });
  }
}

function person(name: string | null | undefined, when?: string | null): string {
  if (!name) return "—";
  return when ? `${name}  ·  ${formatIst(String(when))} IST` : name;
}

function dateOnly(v: string | null | undefined): string {
  return v ? formatDate(String(v).slice(0, 10)) : "—";
}

function hours(v: number | string | null | undefined): string {
  return v == null ? "—" : `${Number(v)} h`;
}

function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Render a task (spec, approval trail, checklist, files, comments) as a PDF. */
export async function buildTaskPdf(data: TaskPdfData): Promise<Uint8Array> {
  const { task } = data;
  const generatedAt = data.generatedAt ?? new Date();
  const doc = await PDFDocument.create();
  doc.setTitle(`Task #${task.id} — ${task.title}`);
  doc.setSubject(task.project_name ?? "Task");
  doc.setAuthor(data.generatedBy);
  doc.setCreator("PMApp");
  doc.setCreationDate(generatedAt);

  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const w = new Writer(doc, font, bold);
  const type = task.task_type ?? "general";

  // ── Header ────────────────────────────────────────────────────────────
  w.text(`${task.project_name ?? "Project"}  ·  Task #${task.id}`, { size: 9, color: MUTED });
  w.space(2);
  w.text(task.title, { size: 18, bold: true, gap: 4 });
  w.text(
    [
      WORK_TYPE_LABELS[type],
      `Status: ${TASK_STATUS_LABELS[task.status] ?? task.status}`,
      `Priority: ${task.priority.charAt(0).toUpperCase()}${task.priority.slice(1)}`,
      task.is_additional ? "Additional work" : null,
    ]
      .filter(Boolean)
      .join("   ·   "),
    { size: 10, color: MUTED, gap: 8 }
  );

  if (task.signed_off_at) {
    w.banner(
      [
        "SIGNED OFF — READ-ONLY",
        `Signed off by ${task.signer_name ?? "—"} on ${formatIst(String(task.signed_off_at))} IST.` +
          (task.signoff_note ? ` Note: ${task.signoff_note}` : ""),
      ],
      GREEN,
      GREEN_BG
    );
  }

  // ── Approval trail ────────────────────────────────────────────────────
  w.heading("Approval trail");
  w.fields([
    ["Requested by", person(task.requester_name, task.requested_at)],
    ["Approved by", person(task.request_approver_name, task.request_approved_at)],
    ["Assigned owner", task.assignee_name ?? "—"],
    [
      "Completed",
      task.status === "done" && task.completed_at
        ? person(task.done_by_name ?? "Done", task.completed_at)
        : "—",
    ],
    ["Signed off by", task.signed_off_at ? person(task.signer_name, task.signed_off_at) : "Not signed off"],
    ...(task.signoff_note ? ([["Sign-off note", task.signoff_note]] as [string, string][]) : []),
  ]);

  // ── Specification ─────────────────────────────────────────────────────
  const fields = specFieldsFor(type);
  w.heading(fields.length ? `Specification — ${WORK_TYPE_LABELS[type]}` : "Description");
  if (fields.length === 0) {
    w.text(task.description || "No description.", { color: task.description ? INK : MUTED });
  }
  for (const f of fields) {
    const value = task[f.key];
    w.ensure(34);
    w.text(`${f.label}${f.required ? "" : " (optional)"}`, { size: 9, bold: true, color: MUTED });
    w.text(value || "—", { color: value ? INK : MUTED, gap: 7 });
  }
  if (fields.length && task.description) {
    w.text("Notes", { size: 9, bold: true, color: MUTED });
    w.text(task.description, { gap: 7 });
  }

  // ── Details ───────────────────────────────────────────────────────────
  w.heading("Details");
  w.fields([
    ["Start date", dateOnly(task.start_date)],
    ["Due date", dateOnly(task.due_date)],
    ["Estimated", hours(task.estimated_hours)],
    ["Time logged", formatMinutes(data.loggedMinutes)],
    ["Labels", (task.labels ?? []).map((l) => l.name).join(", ") || "—"],
    ["Created by", task.creator_name ?? "—"],
    ...(task.parent_task_id
      ? ([["Follow-up of", `Task #${task.parent_task_id}`]] as [string, string][])
      : []),
  ]);

  // ── Checklist ─────────────────────────────────────────────────────────
  if (data.subtasks.length) {
    const doneCount = data.subtasks.filter((s) => s.is_done).length;
    w.heading(`Checklist (${doneCount}/${data.subtasks.length})`);
    for (const s of data.subtasks) {
      w.text(`[${s.is_done ? "x" : "  "}]  ${s.title}`, { color: s.is_done ? MUTED : INK, gap: 1 });
    }
  }

  // ── Attachments ───────────────────────────────────────────────────────
  if (data.attachments.length) {
    w.heading(`Attachments (${data.attachments.length})`);
    for (const a of data.attachments) {
      w.text(
        `${a.filename}  (${bytes(Number(a.size_bytes))}${a.uploader_name ? `, ${a.uploader_name}` : ""})`,
        { gap: 1 }
      );
    }
  }

  // ── Comments ──────────────────────────────────────────────────────────
  if (data.comments.length) {
    w.heading(`Comments (${data.comments.length})`);
    for (const c of data.comments) {
      w.ensure(30);
      w.text(`${c.user_name ?? "Unknown"}  ·  ${formatIst(String(c.created_at))} IST`, {
        size: 9,
        bold: true,
        color: MUTED,
      });
      w.text(c.body, { gap: 7 });
    }
  }

  w.footer(
    `Generated ${formatIst(generatedAt.toISOString().slice(0, 19).replace("T", " "))} IST by ${data.generatedBy}  ·  PMApp`
  );
  return doc.save();
}
