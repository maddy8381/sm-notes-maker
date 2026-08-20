import { config as loadEnv } from "dotenv";
import { defineConfig } from "prisma/config";

// Next.js reads .env.local; the Prisma CLI is a plain Node process and only
// reads .env unless told otherwise. Loading both, in Next's precedence order,
// keeps `npm run dev` and `npm run db:migrate` pointed at the same database.
// `override: false` means the first file to define a variable wins, so a real
// shell environment (CI, Vercel) still takes priority over both.
loadEnv({ path: ".env.local", override: false, quiet: true });
loadEnv({ path: ".env", override: false, quiet: true });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Migrations run over a direct connection. Neon's pooler does not hold the
    // session state that DDL and Prisma's advisory migration lock rely on, so
    // pointing migrate at the pooled URL produces intermittent failures.
    // Runtime traffic still uses the pooled DATABASE_URL via src/lib/prisma.ts.
    url: process.env["DIRECT_URL"] ?? process.env["DATABASE_URL"],
  },
});
