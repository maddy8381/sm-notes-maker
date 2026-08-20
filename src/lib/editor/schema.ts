/**
 * The single source of truth for what a stored document may contain.
 *
 * Content arrives from the browser as JSON, and the browser is not trusted:
 * anyone can POST a hand-written document to the autosave action. Because the
 * app later turns this JSON into HTML, an unvalidated node type or attribute
 * is a stored-XSS hole.
 *
 * So rather than sanitizing markup on the way out, the write path allowlists
 * structure on the way in. A node type that is not in this file cannot be
 * stored, and therefore can never be rendered.
 *
 * Adding an editor extension means adding it here too — otherwise its nodes
 * are silently dropped on save, which is the safe direction to fail.
 */

export const NODE_TYPES = [
  "doc",
  "paragraph",
  "text",
  "heading",
  "bulletList",
  "orderedList",
  "listItem",
  "taskList",
  "taskItem",
  "blockquote",
  "codeBlock",
  "horizontalRule",
  "hardBreak",
  "image",
] as const;

export const MARK_TYPES = [
  "bold",
  "italic",
  "underline",
  "strike",
  "code",
  "link",
  "textStyle",
  "highlight",
] as const;

export type NodeType = (typeof NODE_TYPES)[number];
export type MarkType = (typeof MARK_TYPES)[number];

/**
 * Schemes permitted on a link. The omissions are the point: `javascript:` and
 * `data:` both execute when clicked, and are the classic way a "harmless"
 * rich-text link becomes script execution.
 */
export const ALLOWED_LINK_PROTOCOLS = ["http:", "https:", "mailto:"] as const;

export const CODE_LANGUAGES = [
  "plaintext",
  "bash",
  "c",
  "cpp",
  "csharp",
  "css",
  "diff",
  "dockerfile",
  "go",
  "graphql",
  "html",
  "ini",
  "java",
  "javascript",
  "json",
  "kotlin",
  "lua",
  "makefile",
  "markdown",
  "nginx",
  "php",
  "python",
  "ruby",
  "rust",
  "scala",
  "scss",
  "sql",
  "swift",
  "toml",
  "typescript",
  "xml",
  "yaml",
] as const;

export type CodeLanguage = (typeof CODE_LANGUAGES)[number];

export function isCodeLanguage(value: unknown): value is CodeLanguage {
  return (
    typeof value === "string" && (CODE_LANGUAGES as readonly string[]).includes(value)
  );
}

/** Human labels for the code block's language picker. */
export const CODE_LANGUAGE_LABELS: Record<CodeLanguage, string> = {
  plaintext: "Plain text",
  bash: "Bash",
  c: "C",
  cpp: "C++",
  csharp: "C#",
  css: "CSS",
  diff: "Diff",
  dockerfile: "Dockerfile",
  go: "Go",
  graphql: "GraphQL",
  html: "HTML",
  ini: "INI",
  java: "Java",
  javascript: "JavaScript",
  json: "JSON",
  kotlin: "Kotlin",
  lua: "Lua",
  makefile: "Makefile",
  markdown: "Markdown",
  nginx: "Nginx",
  php: "PHP",
  python: "Python",
  ruby: "Ruby",
  rust: "Rust",
  scala: "Scala",
  scss: "SCSS",
  sql: "SQL",
  swift: "Swift",
  toml: "TOML",
  typescript: "TypeScript",
  xml: "XML",
  yaml: "YAML",
};

/**
 * Aliases seen on pasted markup. GitHub, VS Code and most markdown renderers
 * emit `language-ts` or `lang-sh`, and losing the language on paste is one of
 * the most visible ways a code block "breaks".
 */
const LANGUAGE_ALIASES: Record<string, CodeLanguage> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  console: "bash",
  py: "python",
  rb: "ruby",
  rs: "rust",
  kt: "kotlin",
  yml: "yaml",
  md: "markdown",
  "c++": "cpp",
  "c#": "csharp",
  cs: "csharp",
  golang: "go",
  postgres: "sql",
  postgresql: "sql",
  psql: "sql",
  mysql: "sql",
  docker: "dockerfile",
  text: "plaintext",
  txt: "plaintext",
  none: "plaintext",
};

/**
 * Best-effort mapping of a class name or fence info string onto a supported
 * language. Returns "plaintext" rather than null so a code block always has a
 * usable value.
 */
export function normalizeLanguage(raw: string | null | undefined): CodeLanguage {
  if (!raw) return "plaintext";

  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/^(language|lang)-/, "")
    // Fence info strings carry extras: ```ts title="x" showLineNumbers
    .split(/[\s{:,]/)[0];

  if (!cleaned) return "plaintext";
  if (isCodeLanguage(cleaned)) return cleaned;

  return LANGUAGE_ALIASES[cleaned] ?? "plaintext";
}
