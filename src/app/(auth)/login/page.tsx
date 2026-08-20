import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";

import { AuthShell } from "@/components/auth/auth-shell";
import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  // Async in Next 15+, and this is a hard error rather than a deprecation.
  searchParams: Promise<{ next?: string; reset?: string }>;
}) {
  const params = await searchParams;

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to your notes."
      footer={
        <>
          Don&apos;t have an account?{" "}
          <Link
            href="/signup"
            className="text-foreground font-medium underline-offset-4 hover:underline"
          >
            Sign up
          </Link>
        </>
      }
    >
      {params.reset === "success" ? (
        <div className="border-success/30 bg-success/10 mb-4 flex items-start gap-2 rounded-md border px-3 py-2.5 text-sm">
          <CheckCircle2 className="text-success mt-0.5 size-4 shrink-0" aria-hidden />
          <span>Your password has been changed. Sign in with your new password.</span>
        </div>
      ) : null}

      <LoginForm next={params.next} />
    </AuthShell>
  );
}
