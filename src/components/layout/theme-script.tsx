import { THEME_STORAGE_KEY } from "@/components/layout/theme-provider";

/**
 * Applies the saved theme before the page paints.
 *
 * This has to be a blocking inline script in the document, not an effect: by
 * the time React hydrates, the browser has already painted, and a dark-mode
 * user would see a white flash on every load. The script sets the class on
 * <html> synchronously, so the first paint is already correct.
 *
 * Rendered from a Server Component deliberately. React 19 does not execute
 * <script> elements rendered by Client Components — it warns instead — which
 * is exactly the trap next-themes falls into on Next 16.
 */
const script = `
(function () {
  try {
    var stored = localStorage.getItem('${THEME_STORAGE_KEY}');
    var theme = stored === 'light' || stored === 'dark' ? stored
      : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.classList.add(theme);
    document.documentElement.style.colorScheme = theme;
  } catch (e) {
    // Private mode, or storage disabled. Falling through leaves the light
    // theme, which is a fine default and better than not rendering.
  }
})();
`.trim();

export function ThemeScript() {
  return (
    <script
      // The content is a constant defined above — no user input reaches it.
      dangerouslySetInnerHTML={{ __html: script }}
      suppressHydrationWarning
    />
  );
}
