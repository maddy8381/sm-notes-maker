import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PageEditor } from "@/components/editor/page-editor";
import { requireUser } from "@/lib/dal";
import { getPageBySlug } from "@/server/pages";
import { getTechnologyBySlug, listTechnologies } from "@/server/technologies";

type Params = { params: Promise<{ techSlug: string; pageSlug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { techSlug, pageSlug } = await params;
  const user = await requireUser();

  const technology = await getTechnologyBySlug(user.id, techSlug);
  if (!technology) return { title: "Not found" };

  const page = await getPageBySlug(user.id, technology.id, pageSlug);
  return { title: page?.title ?? "Not found" };
}

export default async function PageEditorRoute({ params }: Params) {
  const { techSlug, pageSlug } = await params;
  const user = await requireUser();

  const technology = await getTechnologyBySlug(user.id, techSlug);
  if (!technology) notFound();

  // Scoped to both the user and the technology, so guessing a page slug from
  // another account resolves to nothing rather than to somebody else's note.
  const page = await getPageBySlug(user.id, technology.id, pageSlug);
  if (!page) notFound();

  const allTechnologies = await listTechnologies(user.id, { sort: "manual" });
  const otherTechnologies = allTechnologies
    .filter((t) => t.id !== technology.id)
    .map((t) => ({ id: t.id, name: t.name }));

  // Keyed by page id so navigating between notes remounts the editor rather
  // than reusing its state. See the comment in use-autosave.ts: reusing it
  // would leave a window where a debounced save could fire with the previous
  // note's content against this note's id.
  return <PageEditor key={page.id} page={page} technologies={otherTechnologies} />;
}
