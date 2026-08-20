"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useTheme, type Theme } from "@/components/layout/theme-provider";
import { LogOut, Monitor, Moon, Settings, Sun } from "lucide-react";

import { signOut } from "@/app/(auth)/actions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function UserMenu({ name, email }: { name: string; email: string }) {
  const { theme, setTheme } = useTheme();
  const [pending, startTransition] = useTransition();

  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="bg-primary text-primary-foreground focus-visible:ring-ring focus-visible:ring-offset-background flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-opacity outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-offset-2"
        aria-label="Account menu"
      >
        {initials || "?"}
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="font-normal">
          <span className="text-foreground block text-sm font-medium">{name}</span>
          <span className="text-muted-foreground block truncate text-xs">{email}</span>
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={theme}
          onValueChange={(value) => setTheme(value as Theme)}
        >
          <DropdownMenuRadioItem value="light">
            <Sun /> Light
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <Moon /> Dark
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">
            <Monitor /> System
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>

        <DropdownMenuSeparator />

        <DropdownMenuItem asChild>
          <Link href="/settings">
            <Settings /> Settings
          </Link>
        </DropdownMenuItem>

        <DropdownMenuItem
          destructive
          disabled={pending}
          // Not a form: this menu item lives inside a Radix portal, where a
          // nested <form> would be closed by the menu before it submits.
          onSelect={(event) => {
            event.preventDefault();
            startTransition(() => {
              void signOut();
            });
          }}
        >
          <LogOut /> {pending ? "Signing out…" : "Sign out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
