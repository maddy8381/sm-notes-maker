import Link from "next/link";
import { FileQuestion } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 text-center">
      <span
        className="bg-muted text-muted-foreground mb-4 flex size-12 items-center justify-center rounded-full"
        aria-hidden
      >
        <FileQuestion className="size-6" />
      </span>

      <h1 className="text-lg font-semibold tracking-tight">Not found</h1>
      <p className="text-muted-foreground mt-1.5 max-w-sm text-sm">
        This page does not exist, or it has been moved to the trash.
      </p>

      <div className="mt-6 flex gap-2">
        <Button asChild>
          <Link href="/dashboard">Go to dashboard</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/trash">Check trash</Link>
        </Button>
      </div>
    </div>
  );
}
