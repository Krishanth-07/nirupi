import path from "node:path";

export const MAX_FILE_BYTES = 100 * 1024; // skip any single file over 100 KB
export const MAX_TOTAL_BYTES = 500 * 1024; // keep at most ~500 KB of code per repo
export const MAX_ZIP_BYTES = 80 * 1024 * 1024; // refuse giant downloads

const SKIP_DIRS = new Set([
  "node_modules", "bower_components", "jspm_packages", "dist", "build", "out", "output", ".output",
  ".git", ".github", ".next", ".nuxt", ".svelte-kit", ".turbo", ".cache", ".parcel-cache", ".vercel",
  ".expo", ".gradle", ".idea", ".vscode", "coverage", "vendor", "venv", ".venv", "env", "__pycache__",
  ".pytest_cache", ".mypy_cache", "target", "bin", "obj", "Pods", "DerivedData", "public/build",
  "site-packages", ".dart_tool", "migrations-generated", "generated", "__generated__",
]);

const LOCKFILES = new Set([
  "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb", "bun.lock", "npm-shrinkwrap.json",
  "poetry.lock", "Pipfile.lock", "Cargo.lock", "Gemfile.lock", "composer.lock", "go.sum",
  "pubspec.lock", "Podfile.lock", "packages.lock.json", "flake.lock", "uv.lock",
]);

/** Extension → language. Only these (plus KNOWN_FILES) are kept, so binaries never get in. */
const LANGUAGES: Record<string, string> = {
  ".ts": "TypeScript", ".tsx": "TypeScript", ".mts": "TypeScript", ".cts": "TypeScript",
  ".js": "JavaScript", ".jsx": "JavaScript", ".mjs": "JavaScript", ".cjs": "JavaScript",
  ".vue": "Vue", ".svelte": "Svelte", ".astro": "Astro",
  ".py": "Python", ".java": "Java", ".kt": "Kotlin", ".kts": "Kotlin", ".scala": "Scala",
  ".go": "Go", ".rs": "Rust", ".rb": "Ruby", ".php": "PHP", ".cs": "C#", ".fs": "F#",
  ".swift": "Swift", ".m": "Objective-C", ".mm": "Objective-C", ".c": "C", ".h": "C",
  ".cpp": "C++", ".cc": "C++", ".cxx": "C++", ".hpp": "C++", ".dart": "Dart", ".lua": "Lua",
  ".r": "R", ".jl": "Julia", ".ex": "Elixir", ".exs": "Elixir", ".erl": "Erlang", ".hs": "Haskell",
  ".clj": "Clojure", ".elm": "Elm", ".ml": "OCaml", ".sol": "Solidity", ".zig": "Zig",
  ".sh": "Shell", ".bash": "Shell", ".zsh": "Shell", ".ps1": "PowerShell",
  ".sql": "SQL", ".prisma": "Prisma", ".graphql": "GraphQL", ".gql": "GraphQL", ".proto": "Protobuf",
  ".html": "HTML", ".htm": "HTML", ".css": "CSS", ".scss": "SCSS", ".sass": "SCSS", ".less": "CSS",
  ".json": "JSON", ".yaml": "YAML", ".yml": "YAML", ".toml": "TOML", ".ini": "Config", ".cfg": "Config",
  ".xml": "XML", ".gradle": "Gradle", ".tf": "Terraform", ".hcl": "Terraform",
  ".md": "Markdown", ".mdx": "Markdown", ".rst": "Docs",
};

const KNOWN_FILES: Record<string, string> = {
  Dockerfile: "Docker", Makefile: "Make", Procfile: "Config", Gemfile: "Ruby", Rakefile: "Ruby",
  "requirements.txt": "Python", ".env.example": "Config", "docker-compose.yml": "Docker",
};

export type SkipReason = "ignored" | "tooLarge" | "binary" | "overCap";

/** Decide whether a zip entry is worth reading, before we decompress it. */
export function classify(relPath: string, size: number): { keep: true; language: string } | { keep: false; reason: SkipReason } {
  const parts = relPath.split("/");
  const base = parts[parts.length - 1];
  for (let i = 0; i < parts.length - 1; i++) {
    if (SKIP_DIRS.has(parts[i]) || SKIP_DIRS.has(parts.slice(i, i + 2).join("/"))) return { keep: false, reason: "ignored" };
  }
  if (LOCKFILES.has(base)) return { keep: false, reason: "ignored" };
  if (/\.(min\.(js|css)|map|lock)$/i.test(base)) return { keep: false, reason: "ignored" };

  const language = KNOWN_FILES[base] ?? (base.startsWith("Dockerfile") ? "Docker" : LANGUAGES[path.extname(base).toLowerCase()]);
  if (!language) return { keep: false, reason: "binary" };
  if (size > MAX_FILE_BYTES) return { keep: false, reason: "tooLarge" };
  return { keep: true, language };
}

/** Lower = more important. Real code first, then config, then docs/data; shallow before deep. */
export function priority(relPath: string, language: string): number {
  const depth = relPath.split("/").length;
  const base = relPath.split("/").pop()!.toLowerCase();
  let tier = 0;
  if (base.startsWith("readme")) tier = 0.5;
  else if (/(^|\/)(examples?|samples?|demos?|fixtures?|__fixtures__|benchmarks?|docs?|scripts)\//i.test(relPath)) tier = 2.5;
  else if (/(\.test\.|\.spec\.|__tests__|(^|\/)tests?\/)/i.test(relPath)) tier = 2;
  else if (["JSON", "YAML", "TOML", "Config", "XML", "Gradle", "Docker", "Make"].includes(language)) tier = 1.5;
  else if (["Markdown", "Docs"].includes(language)) tier = 3;
  else if (["HTML", "CSS", "SCSS"].includes(language)) tier = 1;
  return tier * 100 + depth;
}
