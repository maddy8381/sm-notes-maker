import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { disconnect, hasTestDatabase, prisma, resetDatabase } from "../helpers/db";

import { hashPassword, verifyPassword } from "@/lib/password";
import { hashToken } from "@/lib/tokens";
import {
  createSession,
  deleteExpiredSessions,
  listSessions,
  revokeAllSessions,
  revokeSession,
  revokeSessionById,
  validateSessionToken,
} from "@/server/sessions";
import {
  consumeResetToken,
  createPasswordResetToken,
  createUser,
  findUserByEmail,
  findValidResetToken,
} from "@/server/users";
import { checkRateLimit, resetRateLimit } from "@/server/rate-limit";

const describeIfDb = hasTestDatabase ? describe : describe.skip;

describeIfDb("authentication", () => {
  beforeAll(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await disconnect();
  });

  let counter = 0;
  const email = () => `auth-${Date.now()}-${counter++}@test.local`;

  describe("sign up", () => {
    it("creates an account and hashes the password", async () => {
      const address = email();
      const result = await createUser({
        name: "New User",
        email: address,
        password: "a-long-enough-password",
      });

      expect(result.ok).toBe(true);

      const stored = await findUserByEmail(address);
      // The plaintext must never appear in the row.
      expect(stored?.passwordHash).not.toContain("a-long-enough-password");
      expect(stored?.passwordHash.startsWith("$argon2id$")).toBe(true);
      expect(await verifyPassword("a-long-enough-password", stored!.passwordHash)).toBe(
        true,
      );
    });

    it("rejects a duplicate email through the unique constraint", async () => {
      const address = email();
      await createUser({ name: "First", email: address, password: "password-one-x" });

      const second = await createUser({
        name: "Second",
        email: address,
        password: "password-two-x",
      });

      expect(second).toEqual({ ok: false, reason: "email_taken" });
    });
  });

  describe("sessions", () => {
    async function makeUser() {
      const result = await createUser({
        name: "Session User",
        email: email(),
        password: "a-long-enough-password",
      });
      if (!result.ok) throw new Error("could not create user");
      return result.user;
    }

    it("stores only the hash of the token", async () => {
      const user = await makeUser();
      const { token } = await createSession(user.id, { rememberMe: false });

      const rows = await prisma.session.findMany({
        where: { userId: user.id },
        select: { tokenHash: true },
      });

      // Someone reading this table cannot mint a working cookie from it.
      expect(rows[0]!.tokenHash).not.toBe(token);
      expect(rows[0]!.tokenHash).toBe(hashToken(token));
    });

    it("resolves a valid token to its owner", async () => {
      const user = await makeUser();
      const { token } = await createSession(user.id, { rememberMe: false });

      const session = await validateSessionToken(token);
      expect(session?.user.id).toBe(user.id);
    });

    it("rejects a token that was never issued", async () => {
      expect(await validateSessionToken("not-a-real-token")).toBeNull();
    });

    it("rejects an expired session", async () => {
      const user = await makeUser();
      const { token } = await createSession(user.id, { rememberMe: false });

      await prisma.session.updateMany({
        where: { userId: user.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      // Expiry is filtered in SQL, so a skewed server clock cannot revive it.
      expect(await validateSessionToken(token)).toBeNull();
    });

    it("gives a longer life to remember-me sessions", async () => {
      const user = await makeUser();
      const short = await createSession(user.id, { rememberMe: false });
      const long = await createSession(user.id, { rememberMe: true });

      expect(long.expiresAt.getTime()).toBeGreaterThan(short.expiresAt.getTime());
    });

    it("revokes a session on sign out", async () => {
      const user = await makeUser();
      const { token } = await createSession(user.id, { rememberMe: false });

      await revokeSession(token);
      expect(await validateSessionToken(token)).toBeNull();
    });

    it("signing out twice is not an error", async () => {
      const user = await makeUser();
      const { token } = await createSession(user.id, { rememberMe: false });

      await revokeSession(token);
      await expect(revokeSession(token)).resolves.toBeUndefined();
    });

    it("signs out everywhere except the current session", async () => {
      const user = await makeUser();
      const keep = await createSession(user.id, { rememberMe: false });
      await createSession(user.id, { rememberMe: false });
      await createSession(user.id, { rememberMe: false });

      const current = await validateSessionToken(keep.token);
      const removed = await revokeAllSessions(user.id, {
        exceptSessionId: current!.sessionId,
      });

      expect(removed).toBe(2);
      expect(await validateSessionToken(keep.token)).not.toBeNull();
      expect(await listSessions(user.id)).toHaveLength(1);
    });

    it("cannot revoke a session belonging to another account", async () => {
      const owner = await makeUser();
      const attacker = await makeUser();
      const { token } = await createSession(owner.id, { rememberMe: false });
      const session = await validateSessionToken(token);

      // A correct session id is not enough — the query is scoped by userId.
      await revokeSessionById(attacker.id, session!.sessionId);
      expect(await validateSessionToken(token)).not.toBeNull();
    });

    it("only lists its own sessions", async () => {
      const a = await makeUser();
      const b = await makeUser();
      await createSession(a.id, { rememberMe: false });

      expect(await listSessions(b.id)).toHaveLength(0);
    });

    it("sweeps expired sessions", async () => {
      const user = await makeUser();
      await createSession(user.id, { rememberMe: false });
      await prisma.session.updateMany({
        where: { userId: user.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      expect(await deleteExpiredSessions()).toBeGreaterThan(0);
    });
  });

  describe("password reset", () => {
    async function makeUser() {
      const result = await createUser({
        name: "Reset User",
        email: email(),
        password: "the-original-password",
      });
      if (!result.ok) throw new Error("could not create user");
      return result.user;
    }

    it("stores only the hash of the reset token", async () => {
      const user = await makeUser();
      const token = await createPasswordResetToken(user.id);

      const row = await prisma.passwordReset.findFirst({
        where: { userId: user.id },
        select: { tokenHash: true },
      });

      expect(row!.tokenHash).toBe(hashToken(token));
      expect(row!.tokenHash).not.toBe(token);
    });

    it("redeems a valid token and changes the password", async () => {
      const user = await makeUser();
      const token = await createPasswordResetToken(user.id);
      const lookup = await findValidResetToken(token);

      expect(lookup.valid).toBe(true);
      if (!lookup.valid) return;

      expect(
        await consumeResetToken(lookup.resetId, user.id, "a-brand-new-password"),
      ).toBe(true);

      const stored = await findUserByEmail(user.email);
      expect(await verifyPassword("a-brand-new-password", stored!.passwordHash)).toBe(
        true,
      );
      expect(await verifyPassword("the-original-password", stored!.passwordHash)).toBe(
        false,
      );
    });

    it("works exactly once", async () => {
      const user = await makeUser();
      const token = await createPasswordResetToken(user.id);
      const lookup = await findValidResetToken(token);
      if (!lookup.valid) throw new Error("expected a valid token");

      expect(
        await consumeResetToken(lookup.resetId, user.id, "first-new-password"),
      ).toBe(true);
      // A forwarded or logged link must not be replayable.
      expect(
        await consumeResetToken(lookup.resetId, user.id, "second-new-password"),
      ).toBe(false);

      const stored = await findUserByEmail(user.email);
      expect(await verifyPassword("first-new-password", stored!.passwordHash)).toBe(
        true,
      );
    });

    it("signs out every session when the password changes", async () => {
      const user = await makeUser();
      const { token: sessionToken } = await createSession(user.id, {
        rememberMe: true,
      });

      const resetToken = await createPasswordResetToken(user.id);
      const lookup = await findValidResetToken(resetToken);
      if (!lookup.valid) throw new Error("expected a valid token");

      await consumeResetToken(lookup.resetId, user.id, "a-brand-new-password");

      // If the reset happened because someone else had access, leaving their
      // session alive would defeat the point.
      expect(await validateSessionToken(sessionToken)).toBeNull();
    });

    it("retires an outstanding token when a new one is requested", async () => {
      const user = await makeUser();
      const first = await createPasswordResetToken(user.id);
      await createPasswordResetToken(user.id);

      expect((await findValidResetToken(first)).valid).toBe(false);
    });

    it("rejects an expired token", async () => {
      const user = await makeUser();
      const token = await createPasswordResetToken(user.id);

      await prisma.passwordReset.updateMany({
        where: { userId: user.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      expect((await findValidResetToken(token)).valid).toBe(false);
    });

    it("rejects a token that was never issued", async () => {
      expect((await findValidResetToken("invented")).valid).toBe(false);
    });
  });

  describe("rate limiting", () => {
    it("allows up to the limit and then refuses", async () => {
      const key = `login-test-${Date.now()}`;

      // The login budget is 8 per window.
      for (let i = 0; i < 8; i++) {
        expect((await checkRateLimit("login", key)).allowed).toBe(true);
      }

      const blocked = await checkRateLimit("login", key);
      expect(blocked.allowed).toBe(false);
      expect(blocked.remaining).toBe(0);
      expect(blocked.resetAt.getTime()).toBeGreaterThan(Date.now());
    });

    it("counts each identifier separately", async () => {
      const a = `a-${Date.now()}`;
      const b = `b-${Date.now()}`;

      for (let i = 0; i < 8; i++) await checkRateLimit("login", a);

      expect((await checkRateLimit("login", a)).allowed).toBe(false);
      // One person locking themselves out must not lock out everyone else.
      expect((await checkRateLimit("login", b)).allowed).toBe(true);
    });

    it("clears the counter after a successful sign in", async () => {
      const key = `reset-${Date.now()}`;

      for (let i = 0; i < 8; i++) await checkRateLimit("login", key);
      expect((await checkRateLimit("login", key)).allowed).toBe(false);

      await resetRateLimit("login", key);

      // Otherwise four typos would keep throttling someone who then got it
      // right.
      expect((await checkRateLimit("login", key)).allowed).toBe(true);
    });

    it("keeps separate budgets per scope", async () => {
      const key = `scope-${Date.now()}`;

      for (let i = 0; i < 8; i++) await checkRateLimit("login", key);

      expect((await checkRateLimit("login", key)).allowed).toBe(false);
      expect((await checkRateLimit("signup", key)).allowed).toBe(true);
    });
  });

  describe("password hashing", () => {
    it("produces a different hash for the same password", async () => {
      const a = await hashPassword("the-same-password");
      const b = await hashPassword("the-same-password");

      // Distinct salts. Identical hashes would reveal which accounts share a
      // password.
      expect(a).not.toBe(b);
      expect(await verifyPassword("the-same-password", a)).toBe(true);
      expect(await verifyPassword("the-same-password", b)).toBe(true);
    });

    it("returns false rather than throwing on a corrupted hash", async () => {
      // A corrupted row should read as "wrong password", not a 500 that tells
      // an attacker the account exists.
      expect(await verifyPassword("anything", "not-a-hash")).toBe(false);
      expect(await verifyPassword("anything", "")).toBe(false);
    });
  });
});
