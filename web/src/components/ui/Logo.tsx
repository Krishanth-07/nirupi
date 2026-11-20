import { Link } from "react-router-dom";

export function Logo() {
  return (
    <Link to="/" className="inline-flex items-center gap-2 rounded-ctl" aria-label="Nirupi home">
      <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="9" fill="#1A73E8" />
        <path
          d="M10 22V10l12 12V10"
          fill="none"
          stroke="#fff"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="font-heading text-h3">Nirupi</span>
    </Link>
  );
}
