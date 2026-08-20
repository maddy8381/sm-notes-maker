import nextPlugin from "eslint-config-next";
import prettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

export default [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "src/generated/**",
      "playwright-report/**",
      "test-results/**",
      "next-env.d.ts",
      // Throwaway diagnostic scripts, not part of the app.
      ".scratch/**",
    ],
  },

  ...nextPlugin,
  prettier,

  {
    files: ["**/*.{ts,tsx,mts}"],
    // The plugin has to be declared in the same config object as the rules
    // that reference it — flat config does not inherit plugin registrations
    // from other objects in the array.
    plugins: { "@typescript-eslint": tseslint.plugin },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      eqeqeq: ["error", "smart"],
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },

  // The structural half of this app's data-isolation guarantee.
  //
  // Every query that touches user data has to filter on `userId`. Rather than
  // trust each new component to remember that, the Prisma client is reachable
  // from exactly one directory — src/server/ — where every exported function
  // takes `userId` as a required first argument. A component that wanted to
  // skip the check would have to import prisma directly, and that fails lint.
  //
  // Keep this rule in place. If a new directory legitimately needs database
  // access, give it a function in src/server/ instead of an exemption here.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/server/**", "src/lib/prisma.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/lib/prisma",
              message:
                "Import a function from @/server/* instead. Only src/server/ may touch Prisma directly — that is what keeps every query scoped to the signed-in user.",
            },
          ],
          patterns: [
            {
              group: ["**/generated/prisma", "**/generated/prisma/**"],
              message:
                "Import types from @/server/* or @/lib/types instead of reaching into the generated client.",
            },
          ],
        },
      ],
    },
  },

  // Server-only modules must never leak into a client bundle.
  {
    files: ["src/server/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "react-dom",
              message: "src/server/ is server-only code.",
            },
          ],
        },
      ],
    },
  },

  {
    files: ["**/*.test.ts", "**/*.test.tsx", "tests/**/*.ts", "e2e/**/*.ts"],
    rules: {
      "no-console": "off",
      "no-restricted-imports": "off",
    },
  },

  // Scripts whose whole job is to print to a terminal.
  {
    files: ["prisma/seed.ts", "*.config.mjs", "*.config.ts"],
    rules: {
      "no-console": "off",
      "import/no-anonymous-default-export": "off",
    },
  },
];
