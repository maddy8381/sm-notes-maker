/**
 * Client-side file downloads.
 *
 * Fetching and then clicking a synthetic anchor, rather than pointing the
 * browser at the URL directly: a plain navigation would replace the app with
 * the server's JSON error page whenever an export fails, and there would be no
 * way to show a toast or a spinner while it renders.
 */

export async function downloadFromApi(
  url: string,
  fallbackFilename: string,
): Promise<void> {
  const response = await fetch(url, {
    // The session cookie is same-origin, but being explicit keeps this working
    // if the app is ever served from another origin.
    credentials: "same-origin",
  });

  if (!response.ok) {
    throw new Error(await errorMessage(response));
  }

  const blob = await response.blob();
  saveBlob(blob, filenameFromResponse(response) ?? fallbackFilename);
}

export function saveBlob(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();

  // Revoking immediately can cancel the download in Safari; one tick is
  // enough for the click to have been handled.
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === "string") return body.error;
  } catch {
    // Not JSON — fall through to a generic message.
  }
  return response.status === 401
    ? "Your session expired. Sign in again."
    : "Export failed. Try again.";
}

/** Prefers the server's filename so the PDF is named the same everywhere. */
function filenameFromResponse(response: Response): string | null {
  const header = response.headers.get("content-disposition");
  if (!header) return null;

  const encoded = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (encoded?.[1]) {
    try {
      return decodeURIComponent(encoded[1]);
    } catch {
      // Malformed encoding; try the plain parameter instead.
    }
  }

  return header.match(/filename="([^"]+)"/i)?.[1] ?? null;
}
