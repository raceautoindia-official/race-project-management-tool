import { avatarColorClass, initials } from "@/lib/colors";

const SIZES: Record<string, string> = {
  sm: "h-6 w-6 text-[10px]",
  md: "h-8 w-8 text-xs",
  lg: "h-10 w-10 text-sm",
};

export default function Avatar({
  name,
  size = "md",
  title,
}: {
  name: string;
  size?: "sm" | "md" | "lg";
  title?: string;
}) {
  return (
    <span
      title={title ?? name}
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${SIZES[size]} ${avatarColorClass(name)}`}
    >
      {initials(name)}
    </span>
  );
}
