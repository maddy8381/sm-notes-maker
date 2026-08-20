"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { fail, ok } from "@/lib/action-result";
import { verifyPassword } from "@/lib/password";
import { authedAction } from "@/lib/safe-action";
import { changePasswordSchema, nameSchema } from "@/lib/validation/auth";
import { revokeAllSessions, revokeSessionById } from "@/server/sessions";
import { getUserPasswordHash, updatePassword, updateProfile } from "@/server/users";

export const updateName = authedAction(
  z.object({ name: nameSchema }),
  async ({ user, input }) => {
    await updateProfile(user.id, { name: input.name });
    revalidatePath("/", "layout");
    return ok();
  },
);

export const changePassword = authedAction(
  changePasswordSchema,
  async ({ user, input }) => {
    const currentHash = await getUserPasswordHash(user.id);
    if (!currentHash) return fail("Account not found.", { code: "not_found" });

    // Requiring the current password is what stops someone who walked up to an
    // unlocked laptop from locking the owner out of their own account.
    if (!(await verifyPassword(input.currentPassword, currentHash))) {
      return fail("That is not your current password.", {
        code: "unauthorized",
        fieldErrors: { currentPassword: ["That is not your current password."] },
      });
    }

    await updatePassword(user.id, input.password);

    // Every other session dies. If the reason for changing the password was
    // that someone else had access, leaving their session alive defeats it.
    await revokeAllSessions(user.id, { exceptSessionId: user.sessionId });

    return ok();
  },
);

export const signOutOtherSessions = authedAction(z.object({}), async ({ user }) => {
  const count = await revokeAllSessions(user.id, {
    exceptSessionId: user.sessionId,
  });
  revalidatePath("/settings");
  return ok({ count });
});

export const revokeSession = authedAction(
  z.object({ sessionId: z.string().min(1).max(40) }),
  async ({ user, input }) => {
    // Signing out the session you are currently using would be confusing —
    // the Sign out button in the account menu is the way to do that.
    if (input.sessionId === user.sessionId) {
      return fail("That is the session you are using right now.", {
        code: "conflict",
      });
    }

    await revokeSessionById(user.id, input.sessionId);
    revalidatePath("/settings");
    return ok();
  },
);
