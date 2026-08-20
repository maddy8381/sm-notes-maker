"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import {
  Clock,
  FileText,
  Hash,
  Loader2,
  Plus,
  Search,
  Star,
  Trash2,
} from "lucide-react";

import { TechIcon } from "@/components/layout/tech-icon";
import type { SidebarTechnology } from "@/components/layout/sidebar";
import { cn } from "@/lib/utils";

type SearchResponse = {
  technologies: { id: string; name: string; slug: string; pageCount: number }[];
  pages: {
    id: string;
    title: string;
    slug: string;
    technologyName: string;
    technologySlug: string;
    snippet: string;
  }[];
  tags: { id: string; name: string; slug: string }[];
};

const EMPTY: SearchResponse = { technologies: [], pages: [], tags: [] };

export function CommandPalette({
  open,
  onOpenChange,
  technologies,
  onCreateTechnology,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  technologies: SidebarTechnology[];
  onCreateTechnology: () => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResponse>(EMPTY);
  const [loading, setLoading] = useState(false);

  // Cmd/Ctrl+K from anywhere.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        onOpenChange(!open);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  // Reset when the palette closes, adjusted during render rather than in an
  // effect — see the same pattern in app-shell.tsx.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (!open) {
      setQuery("");
      setResults(EMPTY);
    }
  }

  const abortRef = useRef<AbortController | null>(null);

  // A query shorter than two characters has no results to show. Derived here
  // rather than pushed into state from an effect — it is a pure function of
  // `query`, and storing it would mean a render with the old value first.
  const searching = query.trim().length >= 2;

  // The effect's only job is fetching. It runs solely when there is something
  // to fetch, so it never sets state synchronously on the way in — the short-
  // query case is handled by `visibleResults` below, derived rather than
  // stored.
  useEffect(() => {
    if (!searching) return;

    const trimmed = query.trim();
    const controller = new AbortController();
    abortRef.current = controller;

    // Debounced, and the in-flight request is cancelled on every keystroke.
    // Without the abort, responses can arrive out of order and a slow earlier
    // query overwrites the results for what was typed last.
    const timer = setTimeout(async () => {
      setLoading(true);

      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Search failed");
        setResults((await response.json()) as SearchResponse);
      } catch (error) {
        if ((error as Error).name !== "AbortError") setResults(EMPTY);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 180);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, searching]);

  // Results belong to whatever was last fetched. While the query is too short
  // — or has been cleared — show nothing rather than the previous query's
  // matches.
  const visibleResults = searching ? results : EMPTY;

  function go(href: string) {
    onOpenChange(false);
    router.push(href);
  }

  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label="Command palette"
      // cmdk filters its own items by default, which would fight the
      // server-side ranking. The results are already in relevance order.
      shouldFilter={!searching}
      className="data-[state=open]:animate-in data-[state=open]:fade-in-0 fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh]"
      overlayClassName="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px]"
      contentClassName="relative z-50 w-full max-w-xl overflow-hidden rounded-xl border border-border bg-popover shadow-2xl"
    >
      <div className="border-border flex items-center gap-2.5 border-b px-3.5">
        {loading ? (
          <Loader2 className="text-muted-foreground size-4 shrink-0 animate-spin" />
        ) : (
          <Search className="text-muted-foreground size-4 shrink-0" aria-hidden />
        )}
        <Command.Input
          value={query}
          onValueChange={setQuery}
          placeholder="Search notes, or jump to…"
          className="placeholder:text-muted-foreground h-12 flex-1 bg-transparent text-sm outline-none"
        />
        <kbd className="border-border text-muted-foreground shrink-0 rounded border px-1.5 py-0.5 text-[10px]">
          esc
        </kbd>
      </div>

      <Command.List className="max-h-[min(28rem,60vh)] scrollbar-thin overflow-y-auto p-1.5">
        <Command.Empty className="text-muted-foreground py-8 text-center text-sm">
          {searching
            ? loading
              ? "Searching…"
              : `Nothing matches “${query.trim()}”.`
            : "Type to search."}
        </Command.Empty>

        {searching && visibleResults.pages.length > 0 ? (
          <Group heading="Pages">
            {visibleResults.pages.map((page) => (
              <Item
                key={page.id}
                value={`page-${page.id}`}
                onSelect={() => go(`/t/${page.technologySlug}/${page.slug}`)}
              >
                <FileText className="text-muted-foreground size-4 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{page.title}</span>
                  {page.snippet ? (
                    <span
                      className="text-muted-foreground [&_mark]:bg-warning/30 [&_mark]:text-foreground block truncate text-xs"
                      // Safe: `snippet` has already been through
                      // `renderSnippet` on the server, which HTML-escapes the
                      // note text and then inserts the <mark> tags itself. The
                      // only markup here is the highlighting we added. See the
                      // comment on MARK_START in src/server/search.ts for why
                      // Postgres must not emit those tags directly.
                      dangerouslySetInnerHTML={{ __html: page.snippet }}
                    />
                  ) : null}
                </span>
                <span className="text-muted-foreground shrink-0 text-xs">
                  {page.technologyName}
                </span>
              </Item>
            ))}
          </Group>
        ) : null}

        {searching && visibleResults.technologies.length > 0 ? (
          <Group heading="Technologies">
            {visibleResults.technologies.map((tech) => (
              <Item
                key={tech.id}
                value={`tech-${tech.id}`}
                onSelect={() => go(`/t/${tech.slug}`)}
              >
                <TechIcon
                  name={null}
                  className="text-muted-foreground size-4 shrink-0"
                />
                <span className="flex-1 truncate">{tech.name}</span>
                <span className="text-muted-foreground shrink-0 text-xs">
                  {tech.pageCount}
                </span>
              </Item>
            ))}
          </Group>
        ) : null}

        {searching && visibleResults.tags.length > 0 ? (
          <Group heading="Tags">
            {visibleResults.tags.map((tag) => (
              <Item
                key={tag.id}
                value={`tag-${tag.id}`}
                onSelect={() => go(`/tags/${tag.slug}`)}
              >
                <Hash className="text-muted-foreground size-4 shrink-0" />
                <span className="flex-1 truncate">{tag.name}</span>
              </Item>
            ))}
          </Group>
        ) : null}

        {!searching ? (
          <>
            <Group heading="Actions">
              <Item
                value="new technology"
                onSelect={() => {
                  onOpenChange(false);
                  onCreateTechnology();
                }}
              >
                <Plus className="text-muted-foreground size-4 shrink-0" />
                New technology
              </Item>
              <Item value="favorites" onSelect={() => go("/favorites")}>
                <Star className="text-muted-foreground size-4 shrink-0" />
                Favorites
              </Item>
              <Item value="recent" onSelect={() => go("/recent")}>
                <Clock className="text-muted-foreground size-4 shrink-0" />
                Recently viewed
              </Item>
              <Item value="tags" onSelect={() => go("/tags")}>
                <Hash className="text-muted-foreground size-4 shrink-0" />
                Tags
              </Item>
              <Item value="trash" onSelect={() => go("/trash")}>
                <Trash2 className="text-muted-foreground size-4 shrink-0" />
                Trash
              </Item>
            </Group>

            {technologies.length > 0 ? (
              <Group heading="Jump to">
                {technologies.slice(0, 8).map((tech) => (
                  <Item
                    key={tech.id}
                    value={tech.name}
                    onSelect={() => go(`/t/${tech.slug}`)}
                  >
                    <TechIcon
                      name={tech.icon}
                      className="text-muted-foreground size-4 shrink-0"
                    />
                    <span className="flex-1 truncate">{tech.name}</span>
                  </Item>
                ))}
              </Group>
            ) : null}
          </>
        ) : null}
      </Command.List>
    </Command.Dialog>
  );
}

function Group({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <Command.Group
      heading={heading}
      className="[&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium"
    >
      {children}
    </Command.Group>
  );
}

function Item({
  value,
  onSelect,
  children,
}: {
  value: string;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className={cn(
        "flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-2 text-sm outline-none",
        "data-[selected=true]:bg-muted data-[selected=true]:text-foreground",
      )}
    >
      {children}
    </Command.Item>
  );
}
