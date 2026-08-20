"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { fail, ok, type ActionResult } from "@/lib/action-result";
import { env } from "@/lib/env";
import { fakeVerify, verifyPassword } from "@/lib/password";
import { publicAction } from "@/lib/safe-action";
import {
  clearSessionCookie,
  readSessionCookie,
  setSessionCookie,
} from "@/lib/session-cookie";
import {
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
  signupSchema,
} from "@/lib/validation/auth";
import {
  checkRateLimit,
  describeRetryAfter,
  resetRateLimit,
} from "@/server/rate-limit";
import { createSession, revokeSession } from "@/server/sessions";
import {
  consumeResetToken,
  createPasswordResetToken,
  createUser,
  findUserByEmail,
  findValidResetToken,
} from "@/server/users";
import { seedStarterContent } from "@/server/onboarding";

/**
 * Where a successful sign-in lands. Kept as a constant so login, signup and
 * the post-reset redirect cannot drift apart.
 */
const AFTER_LOGIN = "/dashboard";

export const signUp = publicAction(signupSchema, async ({ input }) => {
  const { ip, userAgent } = await requestContext();

  const limit = await checkRateLimit("signup", ip);
  if (!limit.allowed) {
    return fail(
      `Too many sign-up attempts. Try again in ${describeRetryAfter(limit.resetAt)}.`,
      { code: "rate_limited" },
    );
  }

  const created = await createUser({
    name: input.name,
    email: input.email,
    password: input.password,
  });

  if (!created.ok) {
    // Signup is the one place where confirming an address exists is
    // unavoidable — the user has to be told why they cannot proceed. The
    // rate limit above is what keeps this from being a usable enumeration
    // oracle.
    return fail("An account with this email already exists.", {
      code: "conflict",
      fieldErrors: { email: ["An account with this email already exists."] },
    });
  }

  // A brand-new account with an empty dashboard is a bad first impression and
  // gives no hint of what the app is for.
  await seedStarterContent(created.user.id);

  const session = await createSession(created.user.id, {
    rememberMe: true,
    userAgent,
    ip,
  });
  await setSessionCookie(session.token, session.expiresAt);

  redirect(AFTER_LOGIN);
});

export const signIn = publicAction(loginSchema, async ({ input }) => {
  const { ip, userAgent } = await requestContext();

  // Two independent budgets. The per-email one stops an attacker grinding a
  // single account from many addresses; the per-IP one stops them spraying
  // many accounts from one. Neither alone is sufficient.
  const [byEmail, byIp] = await Promise.all([
    checkRateLimit("login", input.email),
    checkRateLimit("loginByIp", ip),
  ]);

  if (!byEmail.allowed || !byIp.allowed) {
    const resetAt = !byEmail.allowed ? byEmail.resetAt : byIp.resetAt;
    return fail(
      `Too many sign-in attempts. Try again in ${describeRetryAfter(resetAt)}.`,
      { code: "rate_limited" },
    );
  }

  const user = await findUserByEmail(input.email);

  if (!user) {
    // Spend the same time as a real verify would. Returning immediately here
    // makes "no such account" measurably faster than "wrong password", which
    // is enough to enumerate registered addresses.
    await fakeVerify();
    return invalidCredentials();
  }

  if (!(await verifyPassword(input.password, user.passwordHash))) {
    return invalidCredentials();
  }

  // Clear the counter so earlier typos do not throttle a legitimate user.
  await resetRateLimit("login", input.email);

  const session = await createSession(user.id, {
    rememberMe: input.rememberMe,
    userAgent,
    ip,
  });
  await setSessionCookie(session.token, session.expiresAt);

  redirect(AFTER_LOGIN);
});

export async function signOut(): Promise<never> {
  const token = await readSessionCookie();
  if (token) await revokeSession(token);
  await clearSessionCookie();
  redirect("/login");
}

/**
 * Always reports success, whether or not the address is registered. The
 * response is the one place a stranger could otherwise learn who has an
 * account here.
 */
export const requestPasswordReset = publicAction(
  forgotPasswordSchema,
  async ({ input }) => {
    const { ip } = await requestContext();

    const limit = await checkRateLimit("passwordReset", ip);
    if (!limit.allowed) {
      return fail(
        `Too many reset requests. Try again in ${describeRetryAfter(limit.resetAt)}.`,
        { code: "rate_limited" },
      );
    }

    const user = await findUserByEmail(input.email);

    if (user) {
      const token = await createPasswordResetToken(user.id);
      await deliverResetLink(user.email, token);
    }

    return ok();
  },
);

export const resetPassword = publicAction(
  resetPasswordSchema,
  async ({ input }): Promise<ActionResult<void>> => {
    const lookup = await findValidResetToken(input.token);

    if (!lookup.valid) {
      return fail("This reset link is invalid or has expired. Request a new one.", {
        code: "validation",
      });
    }

    // Also revokes every existing session for the account — see
    // consumeResetToken. If the reset happened because someone else had
    // access, leaving their session alive would defeat the purpose.
    const consumed = await consumeResetToken(
      lookup.resetId,
      lookup.userId,
      input.password,
    );

    if (!consumed) {
      return fail("This reset link has already been used. Request a new one.", {
        code: "conflict",
      });
    }

    await clearSessionCookie();
    redirect("/login?reset=success");
  },
);

function invalidCredentials(): ActionResult<never> {
  // One message for both "no such account" and "wrong password". Naming which
  // one it was would tell an attacker exactly which emails are worth grinding.
  return fail("Incorrect email or password.", { code: "unauthorized" });
}

/**
 * Client IP and user agent.
 *
 * On Vercel, x-forwarded-for is set by the platform and cannot be spoofed by
 * the client. Behind a different proxy this needs revisiting: a
 * self-reported header would let an attacker sidestep per-IP rate limiting by
 * varying it. The per-email budget still applies in that case.
 */
async function requestContext(): Promise<{ ip: string; userAgent: string | null }> {
  const headerList = await headers();
  const forwarded = headerList.get("x-forwarded-for");
  const ip =
    forwarded?.split(",")[0]?.trim() || headerList.get("x-real-ip") || "unknown";

  return { ip, userAgent: headerList.get("user-agent") };
}

/**
 * Sending real email is out of scope for the MVP — it would mean provisioning
 * a transactional provider and a verified sending domain before anyone can
 * use the app. Until that exists the link is logged, which works for a
 * self-hosted tool where the operator can read the logs.
 *
 * To make this real: swap in Resend/Postmark here. Nothing else changes —
 * the token, its expiry and its single-use redemption are already correct.
 */
async function deliverResetLink(email: string, token: string): Promise<void> {
  const url = `${env.NEXT_PUBLIC_APP_URL}/reset-password?token=${token}`;
  console.warn(
    `[password-reset] No email provider configured. Reset link for ${email}:\n  ${url}`,
  );
}
