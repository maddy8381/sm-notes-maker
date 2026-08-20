import { z } from "zod";

/**
 * Shared between the Server Actions and the client forms, so the rules the
 * user sees while typing are literally the rules the server enforces.
 */

export const emailSchema = z
  .string()
  .trim()
  // Lowercased before validation, not after, so the value that reaches the
  // unique constraint is already normalized — Ada@x.com and ada@x.com are one
  // account rather than two.
  .toLowerCase()
  .pipe(z.email("Enter a valid email address").max(254, "That email is too long"));

export const nameSchema = z
  .string()
  .trim()
  .min(1, "Name is required")
  .max(80, "Keep your name under 80 characters");

/**
 * Length is the requirement that actually correlates with resistance to
 * guessing, so it carries the weight here. A composition rule ("one uppercase,
 * one digit, one symbol") mostly produces Password1! and blocks good
 * passphrases, so instead we set a 12-character floor and reject the handful
 * of passwords that show up at the top of every breach corpus.
 */
export const passwordSchema = z
  .string()
  .min(12, "Use at least 12 characters")
  // bcrypt's 72-byte limit does not apply to argon2, but a cap keeps someone
  // from posting a megabyte of text into the hasher.
  .max(200, "That password is too long")
  .refine(
    (value) => !COMMON_PASSWORDS.has(value.toLowerCase()),
    "That password is too common — pick something less guessable",
  );

export const signupSchema = z
  .object({
    name: nameSchema,
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export const loginSchema = z.object({
  email: emailSchema,
  // Not `passwordSchema`: an existing account may predate a rule change, and
  // failing validation on the login form would lock them out with a confusing
  // "use at least 12 characters" on a password that is already correct.
  password: z.string().min(1, "Password is required"),
  rememberMe: z.boolean().default(false),
});

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z
  .object({
    token: z.string().min(1),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password"),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

/**
 * Deliberately tiny. A real deployment would check against a proper breach
 * list (k-anonymity against Have I Been Pwned, say); this covers the handful
 * that a 12-character minimum still lets through.
 */
const COMMON_PASSWORDS = new Set([
  "password1234",
  "password12345",
  "123456789012",
  "qwertyuiop12",
  "administrator",
  "letmeinplease",
  "iloveyou1234",
  "welcome12345",
  "passwordpassword",
  "qwerty123456",
  "111111111111",
  "aaaaaaaaaaaa",
]);

export type PasswordStrength = {
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
  suggestions: string[];
};

/**
 * Feedback for the signup meter only — the server never gates on this, it
 * gates on `passwordSchema`. Rough by design: a real estimator (zxcvbn) is
 * ~400KB of dictionaries, which is a poor trade for a hint.
 */
export function estimatePasswordStrength(password: string): PasswordStrength {
  const suggestions: string[] = [];
  let score = 0;

  if (password.length >= 12) score++;
  else suggestions.push("Use at least 12 characters");

  if (password.length >= 16) score++;
  else if (password.length >= 12) suggestions.push("Longer is stronger");

  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z0-9]/].filter((re) =>
    re.test(password),
  ).length;
  if (classes >= 3) score++;
  else suggestions.push("Mix in numbers or symbols");

  // Penalise a single repeated character or a straight run of digits.
  if (!/^(.)\1+$/.test(password) && !/^\d+$/.test(password) && password.length >= 10) {
    score++;
  }

  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    score = 0;
    suggestions.length = 0;
    suggestions.push("This password appears in breach lists");
  }

  const clamped = Math.min(4, score) as PasswordStrength["score"];
  const labels = ["Very weak", "Weak", "Fair", "Good", "Strong"] as const;

  return {
    score: clamped,
    label: labels[clamped],
    suggestions: suggestions.slice(0, 2),
  };
}
