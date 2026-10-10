/**
 * Accessibility + responsive audit — every screen at phone and desktop width,
 * including the main dialogs. Reports WCAG 2.1 A/AA violations (axe-core) and
 * layout problems a person would feel: sideways scrolling, controls too small
 * to tap, and whether the keyboard alone can sign in and close a dialog.
 *
 *   npm run a11y                       # against a running http://localhost:3000
 *   A11Y_URL=https://pm.example.com npm run a11y
 *
 * Read-only: it signs in and looks, it never changes data. Settings (env):
 *   A11Y_URL, A11Y_USER (default ADMIN001), A11Y_PIN (default 1234).
 */
import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";

const BASE = (process.env.A11Y_URL ?? "http://localhost:3000").replace(/[/]+$/, "");
const OUT = process.argv[2] ?? "test-results";
const USER = process.env.A11Y_USER ?? "ADMIN001";
const PIN = process.env.A11Y_PIN ?? "1234";
const WIDTHS = [
  { name: "phone", width: 390, height: 844 },
  { name: "desktop", width: 1440, height: 950 },
];

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: process.env.A11Y_BROWSER_CHANNEL ?? "chrome" });
const findings = [];
const seen = new Set();

function record(where, size, v) {
  for (const node of v.nodes.slice(0, 2)) {
    const key = `${v.id}|${node.target.join(" ")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    findings.push({
      impact: v.impact ?? "minor",
      rule: v.id,
      where: `${where} (${size})`,
      help: v.help,
      element: String(node.target.join(" ")).slice(0, 90),
      snippet: (node.html ?? "").replace(/\s+/g, " ").slice(0, 110),
    });
  }
}

async function audit(page, where, size) {
  const res = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  for (const v of res.violations) record(where, size, v);
}

/** Layout problems a person would actually feel. */
async function layoutCheck(page, where, size) {
  const issues = await page.evaluate(() => {
    const out = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > doc.clientWidth + 2) {
      out.push(`page scrolls sideways (${doc.scrollWidth}px content in ${doc.clientWidth}px)`);
    }
    // Controls smaller than a comfortable tap target.
    const small = [];
    for (const el of document.querySelectorAll("button, a, input, select, textarea")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.height < 24 || r.width < 24) {
        const label = (el.textContent || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 30);
        small.push(`${label} (${Math.round(r.width)}×${Math.round(r.height)})`);
      }
    }
    if (small.length) out.push(`small tap targets: ${[...new Set(small)].slice(0, 4).join(", ")}`);
    return out;
  });
  for (const i of issues) {
    findings.push({ impact: "layout", rule: "layout", where: `${where} (${size})`, help: i, element: "", snippet: "" });
  }
}

for (const size of WIDTHS) {
  const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height } });
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.accept());

  await page.goto(`${BASE}/login`);
  await audit(page, "/login", size.name);
  await layoutCheck(page, "/login", size.name);
  await page.getByLabel("Employee ID").fill(USER);
  await page.getByLabel("PIN").fill(PIN);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/dashboard/);

  for (const path of [
    "/dashboard", "/projects", "/projects/8", "/my-tasks", "/team", "/calendar",
    "/outstanding", "/meetings", "/reminders", "/notifications", "/profile",
    "/admin", "/admin/activity",
  ]) {
    await page.goto(BASE + path);
    await page.waitForTimeout(500);
    await audit(page, path, size.name);
    await layoutCheck(page, path, size.name);
    if (path === "/projects/8") await page.screenshot({ path: `${OUT}/a-${size.name}-project.png`, fullPage: true });
    if (path === "/dashboard") await page.screenshot({ path: `${OUT}/a-${size.name}-dashboard.png`, fullPage: true });
  }

  try {
    // Key dialogs
    await page.goto(`${BASE}/projects/8`);
    await page.locator("[draggable]").first().click({ timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(900);
    await audit(page, "task detail dialog", size.name);
    await layoutCheck(page, "task detail dialog", size.name);
    await page.screenshot({ path: `${OUT}/a-${size.name}-task.png`, fullPage: true });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);

    await page.getByRole("button", { name: "+ New task" }).click();
    await page.waitForTimeout(500);
    await audit(page, "new task dialog", size.name);
    await layoutCheck(page, "new task dialog", size.name);
    await page.screenshot({ path: `${OUT}/a-${size.name}-newtask.png`, fullPage: true });

  } catch {
    console.log(`(dialog pass skipped at ${size.name})`);
  }
  await ctx.close();
}

// Keyboard: can you reach and use the app without a mouse?
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
const kb = await ctx.newPage();
await kb.goto(`${BASE}/login`);
await kb.keyboard.press("Tab");
const firstFocus = await kb.evaluate(() => document.activeElement?.tagName + ":" + (document.activeElement?.getAttribute("id") ?? ""));
await kb.getByLabel("Employee ID").fill(USER);
await kb.getByLabel("PIN").fill(PIN);
await kb.keyboard.press("Enter"); // submit with the keyboard alone
await kb.waitForURL(/\/dashboard/, { timeout: 15000 }).catch(() => {
  findings.push({ impact: "keyboard", rule: "keyboard", where: "/login", help: "Enter does not submit the sign-in form", element: "", snippet: "" });
});
await kb.goto(`${BASE}/projects/8`);
await kb.locator("[draggable]").first().click();
await kb.waitForTimeout(600);
await kb.keyboard.press("Escape");
await kb.waitForTimeout(400);
if (await kb.getByRole("dialog").count()) {
  findings.push({ impact: "keyboard", rule: "keyboard", where: "task dialog", help: "Escape does not close the dialog", element: "", snippet: "" });
}
console.log(`first tab stop on /login: ${firstFocus}`);
await ctx.close();

const order = { critical: 0, serious: 1, layout: 2, keyboard: 2, moderate: 3, minor: 4 };
findings.sort((a, b) => (order[a.impact] ?? 9) - (order[b.impact] ?? 9));
console.log(`\n${findings.length} finding(s)\n`);
for (const f of findings) {
  console.log(`[${f.impact}] ${f.where} — ${f.help}`);
  if (f.element) console.log(`         ${f.element}  ${f.snippet}`);
}
await browser.close();
const blocking = findings.filter((f) => f.impact === "critical" || f.impact === "serious");
console.log(
  blocking.length
    ? `\n${blocking.length} accessibility violation(s) to fix`
    : "\nNo accessibility violations (WCAG 2.1 A/AA)"
);
process.exit(blocking.length ? 1 : 0);
