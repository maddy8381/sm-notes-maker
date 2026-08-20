"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Clock, Hash, LayoutDashboard, Plus, Star, Trash2 } from "lucide-react";

import { TechIcon } from "@/components/layout/tech-icon";
import { cn } from "@/lib/utils";

export type SidebarTechnology = {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
  isFavorite: boolean;
  pageCount: number;
};

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/favorites", label: "Favorites", icon: Star },
  { href: "/recent", label: "Recent", icon: Clock },
  { href: "/tags", label: "Tags", icon: Hash },
];

export function SidebarContent({
  technologies,
  onNavigate,
  onCreateTechnology,
}: {
  technologies: SidebarTechnology[];
  /** Closes the mobile drawer after a tap. Unused on desktop. */
  onNavigate?: () => void;
  onCreateTechnology: () => void;
}) {
  const pathname = usePathname();

  return (
    <nav className="flex h-full scrollbar-thin flex-col gap-1 overflow-y-auto px-3 py-4">
      <div className="space-y-0.5">
        {NAV_ITEMS.map((item) => (
          <SidebarLink
            key={item.href}
            href={item.href}
            active={pathname === item.href}
            onClick={onNavigate}
          >
            <item.icon className="text-muted-foreground size-4 shrink-0" aria-hidden />
            {item.label}
          </SidebarLink>
        ))}
      </div>

      <div className="mt-5 mb-1.5 flex items-center justify-between px-2">
        <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          My Notes
        </span>
        <button
          type="button"
          onClick={onCreateTechnology}
          className="text-muted-foreground hover:bg-muted hover:text-foreground rounded p-0.5 transition-colors"
          aria-label="Add technology"
        >
          <Plus className="size-3.5" aria-hidden />
        </button>
      </div>

      <div className="space-y-0.5">
        {technologies.length === 0 ? (
          <p className="text-muted-foreground px-2 py-1.5 text-xs">Nothing here yet.</p>
        ) : (
          technologies.map((tech) => (
            <SidebarLink
              key={tech.id}
              href={`/t/${tech.slug}`}
              active={pathname.startsWith(`/t/${tech.slug}`)}
              onClick={onNavigate}
            >
              <TechIcon
                name={tech.icon}
                className="text-muted-foreground size-4 shrink-0"
              />
              <span className="truncate">{tech.name}</span>
              {tech.isFavorite ? (
                <Star
                  className="fill-warning text-warning size-3 shrink-0"
                  aria-label="Pinned"
                />
              ) : null}
              <span className="text-muted-foreground ml-auto shrink-0 text-xs tabular-nums">
                {tech.pageCount}
              </span>
            </SidebarLink>
          ))
        )}
      </div>

      <button
        type="button"
        onClick={onCreateTechnology}
        className="text-muted-foreground hover:bg-muted hover:text-foreground mt-1 flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors"
      >
        <Plus className="size-4 shrink-0" aria-hidden />
        Add Tech
      </button>

      <div className="mt-auto pt-4">
        <SidebarLink href="/trash" active={pathname === "/trash"} onClick={onNavigate}>
          <Trash2 className="text-muted-foreground size-4 shrink-0" aria-hidden />
          Trash
        </SidebarLink>
      </div>
    </nav>
  );
}

function SidebarLink({
  href,
  active,
  onClick,
  children,
}: {
  href: string;
  active: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
        active
          ? "bg-muted text-foreground font-medium"
          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
      )}
    >
      {children}
    </Link>
  );
}
