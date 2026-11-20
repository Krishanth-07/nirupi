/**
 * The signature element: a reference to a real place in the student's code,
 * styled like an examiner's margin tab. Everything Nirupi claims points back to one.
 */
export function Cite({
  file,
  line,
  tone = "light",
  full = false,
  className = "",
}: {
  file: string;
  line?: number;
  tone?: "light" | "dark" | "plain";
  /** Show the full path instead of just the file name. */
  full?: boolean;
  className?: string;
}) {
  const name = full ? file : file.split("/").pop() ?? file;
  const styles = {
    light: "border-accent bg-accent-soft/70 text-ink",
    dark: "border-[#8ab4f8] bg-white/5 text-[#e8eaed]",
    plain: "border-accent text-ink",
  }[tone];
  return (
    <span
      title={line ? `${file}, line ${line}` : file}
      className={`inline-flex max-w-full min-w-0 items-baseline gap-px border-l-2 py-0.5 pr-2 pl-2 font-mono text-[12.5px] leading-5 ${styles} ${className}`}
    >
      <span className="truncate font-medium">{name}</span>
      {line !== undefined && <span className="shrink-0 opacity-60">:{line}</span>}
    </span>
  );
}
