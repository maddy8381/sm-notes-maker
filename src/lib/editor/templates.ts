import type { DocJSON, DocNode } from "@/lib/editor/content";

/**
 * Starting structures for common kinds of technical note.
 *
 * The value of a template here is the prompts, not the formatting: a blank
 * page invites a wall of prose, whereas "What did you expect to happen?"
 * produces a debugging note that is still useful in six months.
 */

export type TemplateId =
  | "blank"
  | "debugging"
  | "adr"
  | "howto"
  | "learning"
  | "api"
  | "interview"
  | "commands"
  | "snippet";

export type TemplateDefinition = {
  id: TemplateId;
  label: string;
  description: string;
};

export const TEMPLATES: TemplateDefinition[] = [
  { id: "blank", label: "Blank page", description: "Start from nothing." },
  {
    id: "debugging",
    label: "Bug / debugging note",
    description: "Symptoms, what you tried, what it actually was.",
  },
  {
    id: "adr",
    label: "Architecture decision",
    description: "Context, options weighed, what you chose and why.",
  },
  {
    id: "howto",
    label: "How-to guide",
    description: "Numbered steps someone else could follow.",
  },
  {
    id: "learning",
    label: "Learning notes",
    description: "Concepts, examples, things still unclear.",
  },
  {
    id: "api",
    label: "API documentation",
    description: "Endpoints, parameters, example requests.",
  },
  {
    id: "interview",
    label: "Interview question",
    description: "Problem, approach, complexity, follow-ups.",
  },
  {
    id: "commands",
    label: "Command reference",
    description: "Commands you keep having to look up.",
  },
  {
    id: "snippet",
    label: "Code snippet",
    description: "A block of code with a note on when to reach for it.",
  },
];

export function templateContent(id: string | undefined): DocJSON | undefined {
  if (!id || id === "blank") return undefined;
  const builder = BUILDERS[id as TemplateId];
  return builder ? { type: "doc", content: builder() } : undefined;
}

// --- helpers ---------------------------------------------------------------

function text(value: string): DocNode {
  return { type: "text", text: value };
}

function p(value?: string): DocNode {
  return value ? { type: "paragraph", content: [text(value)] } : { type: "paragraph" };
}

function h(level: number, value: string): DocNode {
  return { type: "heading", attrs: { level }, content: [text(value)] };
}

function code(language: string, value: string): DocNode {
  return { type: "codeBlock", attrs: { language }, content: [text(value)] };
}

function bullets(...items: string[]): DocNode {
  return {
    type: "bulletList",
    content: items.map((item) => ({
      type: "listItem",
      content: [p(item)],
    })),
  };
}

function numbered(...items: string[]): DocNode {
  return {
    type: "orderedList",
    attrs: { start: 1 },
    content: items.map((item) => ({
      type: "listItem",
      content: [p(item)],
    })),
  };
}

function checklist(...items: string[]): DocNode {
  return {
    type: "taskList",
    content: items.map((item) => ({
      type: "taskItem",
      attrs: { checked: false },
      content: [p(item)],
    })),
  };
}

const BUILDERS: Record<TemplateId, () => DocNode[]> = {
  blank: () => [p()],

  debugging: () => [
    h(2, "Symptom"),
    p("What you saw, and where."),
    h(2, "Expected"),
    p("What should have happened instead."),
    h(2, "Reproduction"),
    numbered("Step one", "Step two", "Observe the failure"),
    h(2, "Investigation"),
    p("What you ruled out, and how."),
    h(2, "Root cause"),
    p(),
    h(2, "Fix"),
    code("plaintext", ""),
    h(2, "How to catch it next time"),
    bullets("Test, alert or lint rule that would have surfaced this"),
  ],

  adr: () => [
    h(2, "Status"),
    p("Proposed / Accepted / Superseded"),
    h(2, "Context"),
    p("The forces at play. What makes this a decision rather than an obvious call?"),
    h(2, "Options considered"),
    bullets("Option A — trade-offs", "Option B — trade-offs"),
    h(2, "Decision"),
    p(),
    h(2, "Consequences"),
    bullets(
      "What this makes easier",
      "What this makes harder",
      "What it commits us to",
    ),
  ],

  howto: () => [
    h(2, "Goal"),
    p("What you will have at the end."),
    h(2, "Before you start"),
    checklist("Access or credentials needed", "Tools installed"),
    h(2, "Steps"),
    numbered("First step", "Second step", "Third step"),
    h(2, "Verify it worked"),
    p(),
    h(2, "If it goes wrong"),
    bullets("Common failure and what it means"),
  ],

  learning: () => [
    h(2, "The idea"),
    p("In your own words — not the documentation's."),
    h(2, "Example"),
    code("plaintext", ""),
    h(2, "Why it works this way"),
    p(),
    h(2, "Gotchas"),
    bullets("Something that surprised you"),
    h(2, "Still unclear"),
    checklist("Open question to come back to"),
  ],

  api: () => [
    h(2, "Endpoint"),
    code("plaintext", "GET /v1/resource/:id"),
    h(2, "Parameters"),
    bullets("id — required, the resource identifier"),
    h(2, "Example request"),
    code(
      "bash",
      'curl -H "Authorization: Bearer $TOKEN" \\\n  https://api.example.com/v1/resource/123',
    ),
    h(2, "Example response"),
    code("json", '{\n  "id": "123"\n}'),
    h(2, "Errors"),
    bullets("401 — token missing or expired", "404 — no such resource"),
    h(2, "Notes"),
    p("Rate limits, pagination, anything the docs get wrong."),
  ],

  interview: () => [
    h(2, "Question"),
    p(),
    h(2, "Clarifying questions"),
    bullets("Input size?", "Can the input be modified in place?"),
    h(2, "Approach"),
    p(),
    h(2, "Solution"),
    code("typescript", ""),
    h(2, "Complexity"),
    bullets("Time: O(?)", "Space: O(?)"),
    h(2, "Follow-ups"),
    bullets("What changes if the input does not fit in memory?"),
  ],

  commands: () => [
    h(2, "Everyday"),
    code("bash", ""),
    h(2, "Occasional"),
    code("bash", ""),
    h(2, "Dangerous — read twice"),
    code("bash", ""),
  ],

  snippet: () => [
    h(2, "What it does"),
    p(),
    h(2, "When to reach for it"),
    p(),
    code("typescript", ""),
    h(2, "Caveats"),
    bullets("Assumptions this makes"),
  ],
};
