// Stands in for the `server-only` package under Vitest.
//
// The real package throws on import so that server code cannot be pulled into
// a client bundle. That check belongs to the bundler and `next build` still
// performs it; here it would just prevent the server modules from being tested
// at all.
export {};
