// A plain download link to a CSV API endpoint. Uses a real <a> (not next/link)
// because the target streams a file rather than navigating to a page.
export default function ExportButton({
  href,
  children = "Export CSV",
  tone = "band-out",
}: {
  href: string;
  children?: React.ReactNode;
  /** Which colour it carries on the band. */
  tone?: string;
}) {
  return (
    <a
      href={href}
      className={`on-band ${tone} rounded-lg border px-3 py-1.5 text-sm font-medium`}
    >
      {children}
    </a>
  );
}
