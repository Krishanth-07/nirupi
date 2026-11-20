import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowDown, ArrowUp, RotateCcw, Search } from "lucide-react";
import { Logo } from "../components/ui/Logo";
import { Button } from "../components/ui/Button";
import { getCandidates, startDemo, type CandidateRow } from "../lib/api";

type SortKey = "createdAt" | "technical" | "communication" | "ownerShare" | "flags";
const KEY_STORAGE = "nirupi.recruiterKey";

const OWNERSHIP = {
  strong: { label: "Strong", tone: "bg-good-soft text-[#137333]" },
  moderate: { label: "Moderate", tone: "bg-warn-soft text-[#8a5300]" },
  weak: { label: "Weak", tone: "bg-bad-soft text-[#b3261e]" },
} as const;
const BUG = { solved: "Solved", partial: "Partly solved", not_solved: "Not solved", not_attempted: "Not attempted" } as const;

function readKey(): string {
  try {
    return sessionStorage.getItem(KEY_STORAGE) ?? "";
  } catch {
    return "";
  }
}

export default function Recruiter() {
  const [key, setKey] = useState(readKey);
  const [state, setState] = useState<"loading" | "locked" | "ready" | "error">("loading");
  const [rows, setRows] = useState<CandidateRow[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "createdAt", dir: -1 });
  const [ownership, setOwnership] = useState<"all" | "strong" | "moderate" | "weak">("all");
  const [hideDemo, setHideDemo] = useState(false);
  const [query, setQuery] = useState("");

  const load = useCallback(async (k: string) => {
    setState("loading");
    try {
      const data = await getCandidates(k);
      setRows(data.candidates);
      setOpen(data.open);
      setState("ready");
      try {
        if (k) sessionStorage.setItem(KEY_STORAGE, k);
      } catch {
        /* storage blocked */
      }
    } catch (e) {
      if ((e as { unauthorised?: boolean }).unauthorised) {
        setError(k ? "That access key isn't right." : "");
        setState("locked");
      } else {
        setError((e as Error).message);
        setState("error");
      }
    }
  }, []);

  useEffect(() => {
    void load(key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const val = (r: CandidateRow): number => {
      switch (sort.key) {
        case "technical":
          return r.technical ?? -1;
        case "communication":
          return r.communication ?? -1;
        case "ownerShare":
          return r.git?.ownerShare ?? -1;
        case "flags":
          return r.flags.length;
        default:
          return Date.parse(r.createdAt);
      }
    };
    return rows
      .filter((r) => (ownership === "all" ? true : r.ownership === ownership))
      .filter((r) => !(hideDemo && r.isDemo))
      .filter((r) => !q || r.repoName.toLowerCase().includes(q) || r.owner.toLowerCase().includes(q))
      .sort((a, b) => (val(a) - val(b)) * sort.dir);
  }, [rows, sort, ownership, hideDemo, query]);

  const toggleSort = (k: SortKey) => setSort((s) => (s.key === k ? { key: k, dir: (s.dir * -1) as 1 | -1 } : { key: k, dir: -1 }));

  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-[1200px] items-center justify-between gap-4 px-4 py-5 sm:px-6">
        <Logo />
        <span className="font-heading text-body text-muted">Hiring dashboard</span>
      </header>

      <main id="main" tabIndex={-1} className="mx-auto max-w-[1200px] px-4 pb-20 sm:px-6">
        {state === "locked" ? (
          <KeyGate
            error={error}
            onSubmit={(k) => {
              setKey(k);
              void load(k);
            }}
          />
        ) : state === "error" ? (
          <div className="mt-10 max-w-[560px] border-l-2 border-warn pl-6">
            <h1 className="font-display text-[2.25rem] leading-tight">Candidates couldn't load</h1>
            <p className="mt-3 text-h3 text-muted">{error}</p>
            <Button size="lg" className="mt-6" onClick={() => void load(key)} icon={<RotateCcw size={18} strokeWidth={1.5} />}>
              Try again
            </Button>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h1 className="font-display text-[clamp(2.25rem,5vw,3rem)] leading-[1.02]">Candidates</h1>
                <p className="mt-2 text-muted">
                  {state === "loading"
                    ? "Loading…"
                    : rows.length === 0
                      ? "Every finished assessment lands here, with the evidence behind its scores."
                      : `${shown.length} of ${rows.length} assessments. Scores are evidence for your interviewers, not a decision.`}
                </p>
              </div>
            </div>

            {state === "ready" && rows.length > 0 && <Kpis rows={hideDemo ? rows.filter((r) => !r.isDemo) : rows} />}

            {state === "ready" && rows.length === 0 ? (
              <EmptyDashboard />
            ) : (
            <>
            {/* Filters */}
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <label className="flex h-10 min-w-[220px] flex-1 items-center gap-2 rounded-ctl bg-surface px-3 shadow-soft ring-1 ring-line focus-within:ring-2 focus-within:ring-accent-strong sm:flex-none">
                <Search size={16} strokeWidth={1.5} className="text-muted" />
                <span className="sr-only">Search by repo or GitHub user</span>
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search repo or user" className="w-full bg-transparent outline-none placeholder:text-muted" />
              </label>
              <label className="flex items-center gap-2 text-small">
                <span className="text-muted">Understanding</span>
                <select
                  value={ownership}
                  onChange={(e) => setOwnership(e.target.value as typeof ownership)}
                  className="h-10 rounded-ctl bg-surface px-3 shadow-soft ring-1 ring-line"
                >
                  <option value="all">All</option>
                  <option value="strong">Strong</option>
                  <option value="moderate">Moderate</option>
                  <option value="weak">Weak</option>
                </select>
              </label>
              <label className="tap-target flex items-center gap-2 text-small">
                <input type="checkbox" checked={hideDemo} onChange={(e) => setHideDemo(e.target.checked)} className="size-4 accent-[#1a73e8]" />
                Hide demo assessments
              </label>
            </div>

            {state === "ready" && shown.length === 0 ? (
              <p className="mt-10 text-muted">No candidates match these filters.</p>
            ) : (
              <>
                {/* Desktop table */}
                <div className="mt-6 hidden overflow-hidden rounded-card bg-surface shadow-soft md:block">
                  <table className="w-full text-left">
                    <thead className="border-b border-line text-small text-muted">
                      <tr>
                        <th className="px-5 py-3 font-medium">Candidate</th>
                        <SortHead label="Technical" k="technical" sort={sort} onSort={toggleSort} />
                        <SortHead label="Communication" k="communication" sort={sort} onSort={toggleSort} />
                        <th className="px-3 py-3 font-medium">Understanding</th>
                        <th className="px-3 py-3 font-medium">Bug hunt</th>
                        <SortHead label="Owner's commits" k="ownerShare" sort={sort} onSort={toggleSort} />
                        <SortHead label="Integrity" k="flags" sort={sort} onSort={toggleSort} />
                        <SortHead label="Date" k="createdAt" sort={sort} onSort={toggleSort} />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {shown.map((r) => (
                        <tr key={r.id} className="align-middle transition-colors hover:bg-subtle/50">
                          <td className="px-5 py-4">
                            <div className="flex items-center gap-3">
                              <Avatar name={r.owner} />
                              <div className="min-w-0">
                                <Link to={`/report/${encodeURIComponent(r.id)}`} className="font-medium text-ink hover:text-accent-strong hover:underline">
                                  @{r.owner}
                                </Link>
                                <p className="truncate text-small text-muted">
                                  {r.repoName.split("/")[1] ?? r.repoName}
                                  {r.attempt > 1 ? `, attempt ${r.attempt}` : ""}
                                  {r.isDemo ? ", demo" : ""}
                                </p>
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-4">{r.status === "unscored" ? <Unscored /> : <Score v={r.technical} />}</td>
                          <td className="px-3 py-4">{r.status === "unscored" ? null : <Score v={r.communication} />}</td>
                          <td className="px-3 py-4">{r.ownership && <Pill {...OWNERSHIP[r.ownership]} />}</td>
                          <td className="px-3 py-4 text-small">{BUG[r.bug]}</td>
                          <td className="px-3 py-4 text-small">{gitLabel(r)}</td>
                          <td className="px-3 py-4">
                            <Signals flags={r.flags} integrity={r.integrity} />
                          </td>
                          <td className="px-3 py-4 text-small whitespace-nowrap text-muted">{new Date(r.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Mobile cards */}
                <ul className="mt-6 flex flex-col gap-3 md:hidden">
                  {shown.map((r) => (
                    <li key={r.id}>
                      <Link to={`/report/${encodeURIComponent(r.id)}`} className="block rounded-card bg-surface p-4 shadow-soft">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate font-medium">{r.repoName}</p>
                            <p className="text-small text-muted">
                              @{r.owner}
                              {r.attempt > 1 ? `, attempt ${r.attempt}` : ""}
                            </p>
                          </div>
                          {r.ownership && <Pill {...OWNERSHIP[r.ownership]} />}
                        </div>
                        {r.status === "unscored" ? (
                          <p className="mt-3 text-small text-muted">Not scored yet. Open it to score.</p>
                        ) : (
                          <p className="mt-3 text-small">
                            Technical <strong className="tabular-nums">{r.technical}</strong>, communication{" "}
                            <strong className="tabular-nums">{r.communication}</strong>, bug hunt {BUG[r.bug].toLowerCase()}
                          </p>
                        )}
                        <p className="mt-1 text-small text-muted">
                          {gitLabel(r)}
                          {r.flags.length ? `, ${r.flags.length} signal${r.flags.length === 1 ? "" : "s"}` : ""}
                        </p>
                      </Link>
                    </li>
                  ))}
                </ul>
              </>
            )}
            </>
            )}
          </>
        )}
      </main>
    </div>
  );
}

/** First visit: an empty answer sheet that says what will land here and how to get the first one. */
function EmptyDashboard() {
  const navigate = useNavigate();
  const [demo, setDemo] = useState<"idle" | "loading" | "error">("idle");
  const openDemo = async () => {
    setDemo("loading");
    try {
      const { repoId } = await startDemo();
      navigate(`/analyse?repoId=${encodeURIComponent(repoId)}&mode=assessment`);
    } catch {
      setDemo("error");
    }
  };
  return (
    <section className="sheet relative mt-10 overflow-hidden" aria-labelledby="empty-title">
      <div aria-hidden="true" className="absolute inset-y-0 left-0 w-10 bg-paper-margin sm:w-20" />
      <div aria-hidden="true" className="absolute inset-y-0 left-10 w-px bg-margin/50 sm:left-20" />
      <div className="relative py-12 pr-6 pl-16 sm:py-16 sm:pr-12 sm:pl-28">
        <h2 id="empty-title" className="font-heading text-h2">
          No candidates yet
        </h2>
        <p className="mt-3 max-w-[560px] text-muted">
          Send a candidate through an assessment and their report appears here: technical and communication scores, their own words
          quoted against their code, the bug hunt, git history and integrity signals.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link
            to="/"
            className="tap-target inline-flex h-11 items-center rounded-ctl bg-accent-strong px-5 font-medium text-white hover:bg-[#1765cc] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-strong"
          >
            Start an assessment
          </Link>
          <Button variant="secondary" onClick={openDemo} disabled={demo === "loading"}>
            {demo === "loading" ? "Opening the demo…" : "Try a demo assessment"}
          </Button>
        </div>
        {demo === "error" && (
          <p role="alert" className="mt-3 text-small text-[#b3261e]">
            The demo isn't ready yet. Try again in a few seconds.
          </p>
        )}
      </div>
    </section>
  );
}

function gitLabel(r: CandidateRow): string {
  if (!r.git) return "No Git data";
  const share = r.git.ownerShare === null ? "?" : `${Math.round(r.git.ownerShare * 100)}%`;
  return `${share} of ${r.git.commits ?? "?"}${r.git.isFork ? ", fork" : ""}`;
}

function SortHead({
  label,
  k,
  sort,
  onSort,
}: {
  label: string;
  k: SortKey;
  sort: { key: SortKey; dir: 1 | -1 };
  onSort: (k: SortKey) => void;
}) {
  const active = sort.key === k;
  return (
    <th className="px-3 py-3 font-medium" aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button type="button" onClick={() => onSort(k)} className={`inline-flex items-center gap-1 rounded hover:text-ink ${active ? "text-ink" : ""}`}>
        {label}
        {active && (sort.dir === 1 ? <ArrowUp size={13} strokeWidth={1.75} /> : <ArrowDown size={13} strokeWidth={1.75} />)}
      </button>
    </th>
  );
}

function Score({ v }: { v: number | null }) {
  if (v === null) return null;
  const color = v >= 75 ? "var(--color-good)" : v >= 50 ? "var(--color-warn)" : "var(--color-bad)";
  return (
    <div className="flex w-[104px] flex-col gap-1.5">
      <span className="font-display text-h3 leading-none tabular-nums">{v}</span>
      <span className="h-1.5 w-full overflow-hidden rounded-full bg-subtle" aria-hidden="true">
        <span className="block h-full rounded-full" style={{ width: `${Math.max(3, v)}%`, background: color }} />
      </span>
    </div>
  );
}

/** Initials in a soft circle; colour is stable per person so a candidate is recognisable across rows. */
function Avatar({ name }: { name: string }) {
  const palette = ["#e8f0fe:#1a73e8", "#e6f4ea:#137333", "#fef7e0:#8a5300", "#fce8e6:#b3261e", "#f3e8fd:#7b1fa2", "#e4f7fb:#00796b"];
  const [bg, fg] = palette[[...name].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7) % palette.length].split(":");
  const initials = name.replace(/[^a-zA-Z0-9]+/g, " ").trim().split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();
  return (
    <span className="grid size-9 shrink-0 place-items-center rounded-full text-small font-semibold" style={{ background: bg, color: fg }} aria-hidden="true">
      {initials || "?"}
    </span>
  );
}

/** At-a-glance summary of the pipeline. */
function Kpis({ rows }: { rows: CandidateRow[] }) {
  const scored = rows.filter((r) => r.status === "scored");
  const avg = scored.length ? Math.round(scored.reduce((s, r) => s + (r.technical ?? 0), 0) / scored.length) : null;
  const strong = scored.filter((r) => r.ownership === "strong").length;
  const flagged = rows.filter((r) => r.integrity === "flagged").length;
  const items: [string, string | number, string][] = [
    ["Assessments", rows.length, `${scored.length} scored`],
    ["Average technical score", avg ?? "–", "out of 100"],
    ["Strong understanding", strong, "ready for a human interview"],
    ["Integrity flagged", flagged, flagged ? "review before deciding" : "nothing flagged"],
  ];
  return (
    <dl className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-card bg-line shadow-soft lg:grid-cols-4">
      {items.map(([label, value, sub]) => (
        <div key={label} className="bg-surface px-5 py-5">
          <dt className="text-small text-muted">{label}</dt>
          <dd className="mt-2 font-display text-[2.25rem] leading-none tabular-nums">{value}</dd>
          <dd className="mt-2 text-small text-muted">{sub}</dd>
        </div>
      ))}
    </dl>
  );
}
function Pill({ label, tone }: { label: string; tone: string }) {
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-small font-semibold whitespace-nowrap ${tone}`}>{label}</span>;
}

function Unscored() {
  return <span className="text-small text-muted">Not scored yet</span>;
}

function Signals({ flags, integrity }: { flags: string[]; integrity: CandidateRow["integrity"] }) {
  const badge =
    integrity === "flagged" ? (
      <Pill label="Flagged" tone="bg-bad-soft text-[#b3261e]" />
    ) : integrity === "warnings" ? (
      <Pill label="Warnings" tone="bg-warn-soft text-[#8a5300]" />
    ) : integrity === "clear" ? (
      <Pill label="Clear" tone="bg-good-soft text-[#137333]" />
    ) : null;
  if (!flags.length) return badge ?? <span className="text-small text-muted">None</span>;
  return (
    <div className="flex flex-col items-start gap-1.5">
      {badge}
      <SignalList flags={flags} />
    </div>
  );
}

function SignalList({ flags }: { flags: string[] }) {
  return (
    <details className="text-small">
      <summary className="font-medium text-[#8a5300]">
        {flags.length} signal{flags.length === 1 ? "" : "s"}
      </summary>
      <ul className="mt-2 flex max-w-[260px] flex-col gap-1 text-muted">
        {flags.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
    </details>
  );
}

function KeyGate({ error, onSubmit }: { error: string; onSubmit: (key: string) => void }) {
  const [value, setValue] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (value.trim()) onSubmit(value.trim());
  };
  return (
    <form onSubmit={submit} className="mt-10 max-w-[440px]">
      <h1 className="font-display text-[2.25rem] leading-tight">Hiring dashboard access</h1>
      <p className="mt-3 text-muted">Enter the access key your hiring team set up for Nirupi.</p>
      <label htmlFor="key" className="mt-8 mb-2 block text-small font-medium">
        Access key
      </label>
      <div className="flex gap-2">
        <input
          id="key"
          type="password"
          autoComplete="current-password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-invalid={!!error}
          aria-describedby={error ? "key-error" : undefined}
          className="h-12 flex-1 rounded-ctl bg-surface px-4 shadow-soft ring-1 ring-line outline-none focus:ring-2 focus:ring-accent-strong"
        />
        <Button type="submit" size="lg">
          Open
        </Button>
      </div>
      {error && (
        <p id="key-error" role="alert" className="mt-3 text-small text-[#b3261e]">
          {error}
        </p>
      )}
    </form>
  );
}
