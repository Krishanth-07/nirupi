import { Link } from "react-router-dom";

function Mark() {
  return (
    <>
      <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="9" fill="#1A73E8" />
        <path d="M10 22V10l12 12V10" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="font-heading text-h3">Nirupi</span>
    </>
  );
}

/** During an exam the logo isn't a link, so it can't be used to leave the viva. */
export function Logo({ disabled = false }: { disabled?: boolean }) {
  if (disabled) {
    return (
      <span className="inline-flex items-center gap-2" aria-label="Nirupi">
        <Mark />
      </span>
    );
  }
  return (
    <Link to="/" className="inline-flex items-center gap-2 rounded-ctl" aria-label="Nirupi home">
      <Mark />
    </Link>
  );
}
