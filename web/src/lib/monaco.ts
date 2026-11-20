// Bundle Monaco locally (no CDN) so the editor works on slow or flaky Wi-Fi.
import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
// Monaco 0.57+ spawns its own language workers (bundled by Vite), so no MonacoEnvironment is needed.

// The student only sees one function, so imports look "missing" — silence semantic errors, keep syntax errors.
const quiet = { noSemanticValidation: true, noSyntaxValidation: false };
monaco.typescript.typescriptDefaults.setDiagnosticsOptions(quiet);
monaco.typescript.javascriptDefaults.setDiagnosticsOptions(quiet);
const jsx = { jsx: monaco.typescript.JsxEmit.Preserve, allowJs: true, allowNonTsExtensions: true };
monaco.typescript.typescriptDefaults.setCompilerOptions(jsx);
monaco.typescript.javascriptDefaults.setCompilerOptions(jsx);

monaco.editor.defineTheme("nirupi-dark", {
  base: "vs-dark",
  inherit: true,
  rules: [],
  colors: {
    "editor.background": "#1f1f1f",
    "editor.lineHighlightBackground": "#2a2a2a",
    "editorLineNumber.foreground": "#6b6f75",
    "editorLineNumber.activeForeground": "#c4c7c5",
    "editorCursor.foreground": "#8ab4f8",
    "editor.selectionBackground": "#4285f455",
  },
});

loader.config({ monaco });

const LANGUAGE_BY_EXT: Record<string, string> = {
  ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript",
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  py: "python", java: "java", kt: "kotlin", go: "go", rs: "rust", rb: "ruby", php: "php",
  cs: "csharp", cpp: "cpp", cc: "cpp", hpp: "cpp", c: "c", h: "c", swift: "swift", dart: "dart",
  scala: "scala", lua: "lua", r: "r", sql: "sql", sh: "shell", bash: "shell", ps1: "powershell",
  html: "html", vue: "html", svelte: "html", css: "css", scss: "scss", less: "less",
  json: "json", yaml: "yaml", yml: "yaml", xml: "xml", md: "markdown", graphql: "graphql", sol: "sol",
};

export function languageFor(path: string): string {
  return LANGUAGE_BY_EXT[path.split(".").pop()?.toLowerCase() ?? ""] ?? "plaintext";
}
