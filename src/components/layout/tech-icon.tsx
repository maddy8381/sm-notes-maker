import {
  Boxes,
  Cloud,
  Code2,
  Container,
  Database,
  FileCode,
  Flame,
  GitBranch,
  Globe,
  Hexagon,
  Layers,
  Leaf,
  Lock,
  Network,
  Package,
  Rocket,
  Server,
  Settings2,
  Sparkles,
  Terminal,
  Workflow,
  Zap,
  type LucideIcon,
} from "lucide-react";

/**
 * Icons a technology may use.
 *
 * An explicit map rather than a dynamic lookup by name: `icon` is a
 * user-editable string, and resolving it straight into a component reference
 * would let a hand-crafted value pull in something unintended. Anything not on
 * this list falls back to a default.
 */
const ICONS = {
  Boxes,
  Cloud,
  Code2,
  Container,
  Database,
  FileCode,
  Flame,
  GitBranch,
  Globe,
  Hexagon,
  Layers,
  Leaf,
  Lock,
  Network,
  Package,
  Rocket,
  Server,
  Settings2,
  Sparkles,
  Terminal,
  Workflow,
  Zap,
} satisfies Record<string, LucideIcon>;

export type TechIconName = keyof typeof ICONS;

export const ICON_NAMES = Object.keys(ICONS) as TechIconName[];

export function isTechIconName(value: unknown): value is TechIconName {
  return typeof value === "string" && value in ICONS;
}

export function TechIcon({
  name,
  className,
}: {
  name: string | null | undefined;
  className?: string;
}) {
  const Icon = isTechIconName(name) ? ICONS[name] : Hexagon;
  return <Icon className={className} aria-hidden />;
}
