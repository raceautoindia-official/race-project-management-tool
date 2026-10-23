import { redirect } from "next/navigation";

// Outstanding is now the "Overdue & in review" tab of Reviews. The old
// address keeps working for bookmarks, emails and notifications.
export default function OutstandingPage() {
  redirect("/reviews?tab=overdue");
}
