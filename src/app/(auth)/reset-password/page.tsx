import type { Metadata } from "next";
import Link from "next/link";

import { AuthShell } from "@/components/auth/auth-shell";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

export const metadata: Metadata = { title: "Set a new password" };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  // The token is not validated here, only checked for presence. Verifying it
  // on render would mean a database read on every load of this URL, and would
  // tell anyone with a guessed token whether it was real before they submit
  // anything. The action checks it at redemption time, which is the only
  // moment it matters.
  if (!token) {
    return (
      <AuthShell
        title="Link is incomplete"
        subtitle="That reset link is missing its token."
        footer={
          <Link
            href="/forgot-password"
            className="text-foreground font-medium underline-offset-4 hover:underline"
          >
            Request a new link
          </Link>
        }
      >
        <p className="text-muted-foreground text-center text-sm">
          Copy the whole link from your email, or request a fresh one.
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Set a new password" subtitle="Choose something you'll remember.">
      <ResetPasswordForm token={token} />
    </AuthShell>
  );
}
