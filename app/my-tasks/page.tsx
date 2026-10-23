import { redirect } from "next/navigation";

// My Tasks now lives inside My Work (the "My tasks & calendar" tab). The old
// address keeps working for bookmarks, emails and notifications.
export default function MyTasksPage() {
  redirect("/dashboard?view=tasks");
}
