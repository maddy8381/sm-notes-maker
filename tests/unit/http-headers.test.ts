import { describe, expect, it } from "vitest";

import { inlineDisposition, safeImageContentType } from "@/lib/http-headers";

/**
 * A header value is a ByteString. One character above U+00FF makes `new
 * Response(...)` throw, which reaches the client as a 500 with no explanation —
 * so every assertion here builds a real Response, because a string comparison
 * would pass on exactly the input that breaks in production.
 */

function buildable(headers: Record<string, string>): boolean {
  try {
    new Response("x", { headers });
    return true;
  } catch {
    return false;
  }
}

describe("inlineDisposition", () => {
  it("survives a macOS screenshot name", () => {
    // The space before "PM" is U+202F, a narrow no-break space. macOS puts it
    // in every screenshot filename, it looks identical to a space in every
    // editor, and it is what took the image route down.
    const name = "Screenshot 2026-07-13 at 2.18.51 PM (2).png";

    expect(buildable({ "Content-Disposition": inlineDisposition(name) })).toBe(true);

    const header = inlineDisposition(name);
    // The real name survives in the RFC 5987 parameter.
    expect(header).toContain(`filename*=UTF-8''${encodeURIComponent(name)}`);
    // And the fallback keeps it readable rather than dropping the character.
    expect(header).toContain('filename="Screenshot 2026-07-13 at 2.18.51 PM (2).png"');
  });

  it("survives names in other scripts and emoji", () => {
    for (const name of ["图表.png", "diagramme-français.jpg", "chart 📊.png"]) {
      expect(buildable({ "Content-Disposition": inlineDisposition(name) })).toBe(true);
    }
  });

  it("cannot be broken out of with quotes", () => {
    const header = inlineDisposition('evil".png');
    expect(header).toContain('filename="evil.png"');
    expect(buildable({ "Content-Disposition": header })).toBe(true);
  });

  it("falls back to a name when nothing usable is left", () => {
    expect(inlineDisposition("图")).toContain('filename="image"');
  });
});

describe("safeImageContentType", () => {
  it("passes the types the uploader accepts", () => {
    expect(safeImageContentType("image/png")).toBe("image/png");
    expect(safeImageContentType("image/JPEG; charset=binary")).toBe("image/jpeg");
  });

  it("refuses to serve anything else as itself", () => {
    // The attachment's mime type comes from the client. Echoing it back would
    // let an upload be served from our own origin as HTML.
    expect(safeImageContentType("text/html")).toBe("application/octet-stream");
    expect(safeImageContentType("image/svg+xml")).toBe("application/octet-stream");
    expect(safeImageContentType(null)).toBe("application/octet-stream");
  });
});
