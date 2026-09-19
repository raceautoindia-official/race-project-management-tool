import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";
import { USERS } from "./users";

/**
 * Scheduling a meeting with a video call, adding entries to a calendar, and
 * the profile settings behind calendar subscriptions and WhatsApp alerts.
 */
test.describe.configure({ mode: "serial" });

const MEETING = "E2E Sprint Review";

let lead: Page;

/** The card for our meeting in the list. */
const meetingCard = (page: Page) =>
  page.locator("div.rounded-xl", { hasText: MEETING }).first();

test.beforeAll(async ({ browser }) => {
  lead = await signIn(browser, USERS.lead);
});

test.afterAll(async () => {
  await lead?.context().close();
});

test("scheduling a meeting creates a video room everyone can join", async () => {
  await lead.goto("/meetings");
  await lead.getByRole("button", { name: "+ New meeting" }).click();
  const dialog = lead.getByRole("dialog", { name: "New meeting" });

  await dialog.getByLabel("Title").fill(MEETING);
  await dialog.getByLabel("Description").fill("Demo, then planning");
  await dialog.getByLabel("Start").fill("2026-12-02T15:30");
  await dialog.getByLabel("Duration").selectOption("45");
  await dialog.getByLabel("Reminder").selectOption("30");
  await expect(dialog.getByLabel("Video call")).toHaveValue("room");
  await dialog.getByRole("button", { name: "Schedule" }).click();
  await expect(dialog).toBeHidden();

  const card = meetingCard(lead);
  const join = card.getByRole("link", { name: /Join video call/ });
  await expect(join).toHaveAttribute(
    "href",
    /^https:\/\/meetings\.example\.test\/meeting\/pm-e2e-sprint-review-[a-z0-9]{6}$/
  );
});

test("a meeting can be added to Google, Outlook or Apple calendars", async () => {
  const card = meetingCard(lead);
  await card.getByText("Add to calendar").click();

  const google = card.getByRole("link", { name: "Google Calendar" });
  await expect(google).toHaveAttribute("href", /calendar\.google\.com.*dates=20261202T100000Z%2F20261202T104500Z/);
  await expect(card.getByRole("link", { name: /Outlook/ })).toHaveAttribute(
    "href",
    /outlook\.office\.com.*startdt=2026-12-02T10%3A00/
  );

  const [download] = await Promise.all([
    lead.waitForEvent("download"),
    card.getByRole("link", { name: /Apple Calendar/ }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^meeting-\d+\.ics$/);
});

test("the profile offers a private calendar subscription link", async () => {
  await lead.goto("/profile");
  await lead.getByRole("button", { name: "Create my calendar link" }).click();

  const link = lead.getByLabel("Your private calendar link");
  await expect(link).toHaveValue(/\/api\/calendar\/feed\/[a-f0-9]{32}\.ics$/);
  await expect(lead.getByRole("link", { name: /Apple Calendar/ })).toHaveAttribute(
    "href",
    /^webcal:\/\//
  );

  // The feed itself is fetchable without a session, and holds the meeting.
  const feedUrl = await link.inputValue();
  const res = await lead.request.get(feedUrl, { headers: { cookie: "" } });
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("text/calendar");
  const ics = await res.text();
  expect(ics).toContain("BEGIN:VCALENDAR");
  expect(ics).toContain(`SUMMARY:${MEETING}`);

  // "Check it works" answers in plain words. Here the test server runs on
  // localhost, which is exactly the case Google and Outlook cannot reach.
  await lead.getByRole("button", { name: "Check it works" }).click();
  await expect(lead.getByRole("status")).toContainText(/localhost|Working/);

  // Resetting it makes the old link stop working (the confirm is auto-accepted).
  await lead.getByRole("button", { name: "Reset link" }).click();
  await expect(link).not.toHaveValue(feedUrl);
  expect((await lead.request.get(feedUrl)).status()).toBe(404);
});

test("WhatsApp alerts are opt-in with your own number", async () => {
  await lead.goto("/profile");
  const optIn = lead.getByRole("checkbox", { name: /WhatsApp/ });
  await expect(optIn).toBeDisabled(); // no number yet

  await lead.getByLabel(/Mobile number/).fill("+91 98765 43210");
  await optIn.check();
  await lead.getByRole("button", { name: "Save" }).click();
  await expect(lead.getByText("Profile updated")).toBeVisible();

  await lead.reload();
  await expect(lead.getByLabel(/Mobile number/)).toHaveValue("+91 98765 43210");
  await expect(lead.getByRole("checkbox", { name: /WhatsApp/ })).toBeChecked();
});

test("the Calendar page offers Google, Outlook and Apple directly", async () => {
  await lead.goto("/calendar");
  await lead.getByRole("button", { name: /Add to Google, Outlook or Apple/ }).click();
  const dialog = lead.getByRole("dialog", { name: "Add to your calendar app" });

  const create = dialog.getByRole("button", { name: "Create my calendar link" });
  if (await create.isVisible()) await create.click();

  await expect(dialog.getByRole("link", { name: /Google Calendar/ })).toHaveAttribute(
    "href",
    /^https:\/\/calendar\.google\.com\/calendar\/r\?cid=webcal%3A%2F%2F.+%2Fapi%2Fcalendar%2Ffeed%2F[a-f0-9]{32}\.ics$/
  );
  await expect(dialog.getByRole("link", { name: /Outlook/ })).toHaveAttribute(
    "href",
    /^https:\/\/outlook\.office\.com\/calendar\/0\/addfromweb\?url=webcal%3A%2F%2F.+&name=PMApp$/
  );
  await expect(dialog.getByRole("link", { name: /Apple Calendar/ })).toHaveAttribute(
    "href",
    /^webcal:\/\/.+\/api\/calendar\/feed\/[a-f0-9]{32}\.ics$/
  );
});
