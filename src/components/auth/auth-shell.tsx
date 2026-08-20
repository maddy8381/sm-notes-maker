import Link from "next/link";
import { NotebookPen } from "lucide-react";

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <Link
          href="/"
          className="text-foreground mb-8 flex items-center justify-center gap-2"
        >
          <NotebookPen className="text-primary size-5" aria-hidden />
          <span className="text-base font-semibold tracking-tight">SM Notes Maker</span>
        </Link>

        <div className="mb-6 space-y-1.5 text-center">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {subtitle ? (
            <p className="text-muted-foreground text-sm">{subtitle}</p>
          ) : null}
        </div>

        {children}

        {footer ? (
          <div className="text-muted-foreground mt-6 text-center text-sm">{footer}</div>
        ) : null}
      </div>
    </div>
  );
}
