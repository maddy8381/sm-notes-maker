import "server-only";

import type { DocJSON } from "@/lib/editor/content";
import { createPage } from "@/server/pages";
import { createTechnology } from "@/server/technologies";

/**
 * Gives a new account something to look at.
 *
 * An empty dashboard on first login is both a poor welcome and genuinely
 * unhelpful — nothing on screen explains what a "technology" is or that the
 * editor supports code blocks. One worked example does that better than any
 * empty-state copy.
 *
 * Failures here are swallowed: signup has already succeeded by this point,
 * and refusing to let someone in because their sample note could not be
 * written would be absurd.
 */
export async function seedStarterContent(userId: string): Promise<void> {
  try {
    const technology = await createTechnology(userId, {
      name: "Getting Started",
      description: "How this works — safe to delete once you have the hang of it.",
      icon: "Sparkles",
    });

    await createPage(userId, {
      technologyId: technology.id,
      title: "Welcome to your notes",
      content: welcomeDoc(),
    });
  } catch (error) {
    console.error("[onboarding] could not seed starter content", error);
  }
}

function text(value: string, marks?: { type: string; attrs?: object }[]) {
  return marks ? { type: "text", text: value, marks } : { type: "text", text: value };
}

function paragraph(...content: object[]) {
  return { type: "paragraph", content };
}

function heading(level: number, value: string) {
  return { type: "heading", attrs: { level }, content: [text(value)] };
}

function bullet(...items: string[]) {
  return {
    type: "bulletList",
    content: items.map((item) => ({
      type: "listItem",
      content: [paragraph(text(item))],
    })),
  };
}

function welcomeDoc(): DocJSON {
  return {
    type: "doc",
    content: [
      paragraph(
        text(
          "This is a page. Everything you write saves on its own — there is no save button.",
        ),
      ),

      heading(2, "Organising things"),
      paragraph(
        text("Notes live inside "),
        text("technologies", [{ type: "bold" }]),
        text(
          ": one per thing you are learning or maintaining. React, Postgres, a service you own, an interview prep list. Each holds as many pages as you like.",
        ),
      ),

      heading(2, "Writing"),
      paragraph(
        text("Press "),
        text("/", [{ type: "code" }]),
        text(
          " on an empty line for headings, lists, code blocks and images. Select text to format it, or use ",
        ),
        text("Cmd+B", [{ type: "code" }]),
        text(" and friends."),
      ),
      bullet(
        "Drag images anywhere in the page, and drag their corners to resize",
        "Paste code and the language is detected for you",
        "Copy a code block and it stays a code block when you paste it back",
      ),

      heading(2, "Code"),
      paragraph(text("Code blocks are syntax highlighted and have a copy button:")),
      {
        type: "codeBlock",
        attrs: { language: "typescript" },
        content: [
          text(
            'const user = await getUser();\n\nif (!user) {\n  redirect("/login");\n}',
          ),
        ],
      },

      heading(2, "Finding things later"),
      paragraph(
        text("Press "),
        text("Cmd+K", [{ type: "code" }]),
        text(
          " anywhere to search every page you have written, or to jump straight to a technology. Search looks inside the text of your notes, not just their titles.",
        ),
      ),
      paragraph(
        text("Tag pages with things like "),
        text("#debugging", [{ type: "code" }]),
        text(" or "),
        text("#architecture", [{ type: "code" }]),
        text(" to pull related notes together across technologies."),
      ),

      { type: "horizontalRule" },
      paragraph(
        text("Delete this technology whenever you like — nothing depends on it.", [
          { type: "italic" },
        ]),
      ),
    ] as DocJSON["content"],
  };
}
