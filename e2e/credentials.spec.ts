import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";
import { USERS } from "./users";

// The admin credentials vault: website logins the team shares.

let admin: Page;
let member: Page;

const NAME = "Dealer portal (e2e)";
const PASSWORD = "correct-horse-battery-staple";

test.beforeAll(async ({ browser }) => {
  admin = await signIn(browser, USERS.admin);
  member = await signIn(browser, USERS.sam);
});

test("a member keeps their own, and the admin can see it", async ({ browser }) => {
  await member.goto("/credentials");
  await expect(member.getByText(/Nothing saved yet/)).toBeVisible();

  // Everyone has somewhere to put a login — this one is nobody else's.
  await member.getByRole("button", { name: "+ Add login" }).click();
  const form = member.getByRole("dialog", { name: "Add a login" });
  await form.getByRole("textbox", { name: /^Name/ }).fill("My own webmail");
  await form.getByLabel(/^Password/).fill("mine-alone");
  await form.getByRole("button", { name: "Add login" }).click();
  await expect(form).toBeHidden();
  await expect(member.getByText("Private — only you and admins")).toBeVisible();
  await expect(member.getByText("Saved by you")).toBeVisible();

  // An admin sees everything in here, which is the point of it being the
  // company's store rather than a private one.
  await admin.goto("/credentials");
  await expect(admin.getByText("My own webmail")).toBeVisible();
  await expect(admin.getByText(`Saved by ${USERS.sam.name}`)).toBeVisible();

  // …and another member does not.
  const other = await signIn(browser, USERS.olivia);
  await other.goto("/credentials");
  await expect(other.getByText("My own webmail")).toHaveCount(0);

  // Put it back as they found it, so the tests below see one entry.
  await member.goto("/credentials");
  await member.getByRole("button", { name: "Delete" }).click();
  await expect(member.getByText(/Nothing saved yet/)).toBeVisible();
});

test("an admin saves a login and reads it back", async () => {
  await admin.goto("/credentials");
  await admin.getByRole("button", { name: "+ Add login" }).click();

  const form = admin.getByRole("dialog", { name: "Add a login" });
  await form.getByRole("textbox", { name: /^Name/ }).fill(NAME);
  await form.getByLabel(/^Website/).fill("https://portal.example.com/login");
  await form.getByLabel(/^Username/).fill("race-admin");
  await form.getByLabel(/^Password/).fill(PASSWORD);
  await form.getByLabel(/^Notes/).fill("Security question: first car");
  await form.getByRole("button", { name: "Add login" }).click();
  await expect(form).toBeHidden();

  // Saved, but not on show: a list is seen far more often than it is needed.
  await expect(admin.getByText(NAME)).toBeVisible();
  await expect(admin.getByText(PASSWORD)).toHaveCount(0);
  await expect(admin.getByText("Never read")).toBeVisible();

  await admin.getByRole("button", { name: "Show password" }).click();
  await expect(admin.getByText(PASSWORD)).toBeVisible();
  await expect(admin.getByText("Security question: first car")).toBeVisible();

  await admin.getByRole("button", { name: "Hide" }).click();
  await expect(admin.getByText(PASSWORD)).toHaveCount(0);
});

test("reading it is recorded against the person who read it", async () => {
  await admin.goto("/credentials");
  // Read more than once by the time this runs; one entry per read.
  await expect(admin.getByText(`${USERS.admin.name} read ${NAME}`).first()).toBeVisible();
  await expect(admin.getByText(/Read 1 time/)).toBeVisible();
});

test("an edit with a blank password keeps the saved one", async () => {
  await admin.goto("/credentials");
  await admin.getByRole("button", { name: "Edit" }).click();
  const form = admin.getByRole("dialog", { name: "Edit login" });
  // The form cannot show the stored password, so it cannot send it back.
  await expect(form.getByLabel(/^Password/)).toHaveValue("");
  await form.getByLabel(/^Username/).fill("race-admin-2");
  await form.getByRole("button", { name: "Save" }).click();
  await expect(form).toBeHidden();

  await admin.getByRole("button", { name: "Show password" }).click();
  await expect(admin.getByText(PASSWORD)).toBeVisible();
  await expect(admin.getByText("race-admin-2", { exact: true })).toBeVisible();
});

test("sharing it with someone lets them open it themselves", async () => {
  // Saved admins-only, so it is not theirs to see yet.
  await member.goto("/credentials");
  await expect(member.getByText(NAME)).toHaveCount(0);

  await admin.goto("/credentials");
  await expect(admin.getByText("Private — only you and admins")).toBeVisible();
  await admin.getByRole("button", { name: "Edit" }).click();
  const form = admin.getByRole("dialog", { name: "Edit login" });
  await form.getByRole("radio", { name: /Named people/ }).check();
  await form.getByLabel(USERS.sam.name).check();
  await form.getByRole("button", { name: "Save" }).click();
  await expect(form).toBeHidden();
  await expect(admin.getByText(`Shared with ${USERS.sam.name}`)).toBeVisible();

  // And now it is: theirs to read, with no way to change it.
  await member.goto("/credentials");
  await expect(member.getByText(NAME)).toBeVisible();
  await expect(member.getByRole("button", { name: "Edit" })).toHaveCount(0);
  await member.getByRole("button", { name: "Show password" }).click();
  await expect(member.getByText(PASSWORD)).toBeVisible();

  // Their read is recorded like anyone else's.
  await admin.goto("/credentials");
  await expect(admin.getByText(`${USERS.sam.name} read ${NAME}`)).toBeVisible();
});

test("deleting it keeps the record of who read it", async () => {
  await admin.goto("/credentials");
  await admin.getByRole("button", { name: "Delete" }).click();
  await expect(admin.getByText("Nothing saved yet.")).toBeVisible();
  // The login is gone; the fact that someone read it is not.
  await expect(admin.getByText(`${USERS.admin.name} read ${NAME}`).first()).toBeVisible();
});
