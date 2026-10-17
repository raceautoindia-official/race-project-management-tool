import PlatformShell from "@/components/preview/platform/PlatformShell";

// The platform owner's console: every company on the system, plans, billing,
// security defaults and the audit trail. Separate from the company shell.
export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  return <PlatformShell>{children}</PlatformShell>;
}
