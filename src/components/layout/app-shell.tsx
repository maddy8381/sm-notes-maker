"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, NotebookPen, Plus, Search, X } from "lucide-react";

import { SidebarContent, type SidebarTechnology } from "@/components/layout/sidebar";
import { UserMenu } from "@/components/layout/user-menu";
import { CommandPalette } from "@/components/layout/command-palette";
import { CreateTechnologyDialog } from "@/components/technology/create-technology-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The persistent chrome around every authenticated page.
 *
 * A Client Component because it owns UI state — drawer open, palette open —
 * but it renders `children` as a slot, so the pages themselves stay Server
 * Components and their data never has to cross the boundary as props.
 */
export function AppShell({
  user,
  technologies,
  children,
}: {
  user: { name: string; email: string };
  technologies: SidebarTechnology[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  // Navigating should always close the drawer — otherwise it stays open over
  // the page you just asked for.
  //
  // Adjusted during render rather than in an effect. React documents this
  // pattern for "reset state when a prop changes": it re-renders immediately
  // with the corrected value, where an effect would paint the stale state
  // first and then correct it.
  const [lastPathname, setLastPathname] = useState(pathname);
  if (pathname !== lastPathname) {
    setLastPathname(pathname);
    setDrawerOpen(false);
  }

  // Body scroll lock while the drawer is open, or the page behind it scrolls
  // under your finger on iOS.
  useEffect(() => {
    if (!drawerOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [drawerOpen]);

  const openCreate = useCallback(() => {
    setDrawerOpen(false);
    setCreateOpen(true);
  }, []);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-border bg-background/85 sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b px-3 backdrop-blur-md md:px-4">
        <button
          type="button"
          onClick={() => setDrawerOpen((open) => !open)}
          className="text-muted-foreground hover:bg-muted hover:text-foreground rounded-md p-1.5 transition-colors md:hidden"
          aria-label={drawerOpen ? "Close navigation" : "Open navigation"}
          aria-expanded={drawerOpen}
        >
          {drawerOpen ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>

        <Link href="/dashboard" className="flex items-center gap-2">
          <NotebookPen className="text-primary size-5 shrink-0" aria-hidden />
          <span className="hidden text-sm font-semibold tracking-tight sm:inline">
            SM Notes Maker
          </span>
        </Link>

        {/* Opens the palette rather than being a real input: one search
            surface, reachable identically by click and by Cmd+K. */}
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          className="border-border bg-muted/40 text-muted-foreground hover:bg-muted ml-2 flex h-8 max-w-md flex-1 items-center gap-2 rounded-md border px-2.5 text-sm transition-colors"
        >
          <Search className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">Search notes…</span>
          <kbd className="border-border bg-background text-muted-foreground ml-auto hidden shrink-0 rounded border px-1.5 py-0.5 font-sans text-[10px] sm:block">
            ⌘K
          </kbd>
        </button>

        <div className="ml-auto flex items-center gap-1.5">
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={openCreate}
            aria-label="New technology"
          >
            <Plus className="size-4" />
          </Button>
          <UserMenu name={user.name} email={user.email} />
        </div>
      </header>

      <div className="flex flex-1">
        <aside className="border-border hidden w-60 shrink-0 border-r md:block">
          <div className="sticky top-14 h-[calc(100dvh-3.5rem)]">
            <SidebarContent
              technologies={technologies}
              onCreateTechnology={openCreate}
            />
          </div>
        </aside>

        {/* Mobile drawer */}
        <div
          className={cn(
            "fixed inset-0 z-40 md:hidden",
            drawerOpen ? "pointer-events-auto" : "pointer-events-none",
          )}
        >
          <div
            className={cn(
              "absolute inset-0 bg-black/50 transition-opacity",
              drawerOpen ? "opacity-100" : "opacity-0",
            )}
            onClick={() => setDrawerOpen(false)}
            aria-hidden
          />
          <div
            className={cn(
              "border-border bg-background absolute top-14 bottom-0 left-0 w-64 border-r transition-transform duration-200",
              drawerOpen ? "translate-x-0" : "-translate-x-full",
            )}
            role="dialog"
            aria-modal={drawerOpen}
            aria-label="Navigation"
            aria-hidden={!drawerOpen}
          >
            <SidebarContent
              technologies={technologies}
              onNavigate={() => setDrawerOpen(false)}
              onCreateTechnology={openCreate}
            />
          </div>
        </div>

        <main className="min-w-0 flex-1">{children}</main>
      </div>

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        technologies={technologies}
        onCreateTechnology={openCreate}
      />

      <CreateTechnologyDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
