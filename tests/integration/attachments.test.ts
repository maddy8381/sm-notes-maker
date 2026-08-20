import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestUser, disconnect, hasTestDatabase, prisma } from "../helpers/db";

/**
 * Reading a private blob.
 *
 * With a private store, `Attachment` stops being mere bookkeeping and becomes
 * the authorization record: it is the only thing standing between a signed-in
 * account and every other account's screenshots. So what matters here is not
 * just that a stranger gets null back — it is that storage is never even asked.
 * A check that happens after the read would still leak through timing, cost and
 * logs, and would be one refactor away from leaking the bytes themselves.
 */

const blobGet = vi.hoisted(() => vi.fn());

vi.mock("@vercel/blob", () => ({
  get: blobGet,
  del: vi.fn(),
}));

// Imported after the mock so the module under test picks it up.
const { readAttachmentBytes } = await import("@/server/attachments");

// The owner path reads through the Blob SDK, which `readAttachmentBytes`
// declines to attempt without a token — so a run without one would fail for a
// reason that has nothing to do with what these tests are about.
const canRun = hasTestDatabase && Boolean(process.env.BLOB_READ_WRITE_TOKEN);
const describeIfDb = canRun ? describe : describe.skip;

function fakeBlob(bytes: Uint8Array) {
  return {
    statusCode: 200,
    stream: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
    headers: {},
    blob: { contentType: "image/png", size: bytes.byteLength },
  };
}

describeIfDb("readAttachmentBytes", () => {
  beforeEach(() => {
    blobGet.mockReset();
  });

  afterAll(async () => {
    await disconnect();
  });

  async function seed() {
    const alice = await createTestUser("Alice");
    const mallory = await createTestUser("Mallory");

    const attachment = await prisma.attachment.create({
      data: {
        userId: alice.id,
        url: "https://store.private.blob.vercel-storage.com/notes/diagram-abc.png",
        pathname: `notes/diagram-${Date.now()}.png`,
        filename: "diagram.png",
        mimeType: "image/png",
        size: 4,
      },
      select: { pathname: true },
    });

    return { alice, mallory, pathname: attachment.pathname };
  }

  it("streams the blob to its owner", async () => {
    const { alice, pathname } = await seed();
    blobGet.mockResolvedValue(fakeBlob(new Uint8Array([1, 2, 3, 4])));

    const result = await readAttachmentBytes(alice.id, pathname);

    expect(result).not.toBeNull();
    expect(result?.contentType).toBe("image/png");
    expect(result?.filename).toBe("diagram.png");
    expect(blobGet).toHaveBeenCalledWith(pathname, { access: "private" });
  });

  it("refuses another account's blob without touching storage", async () => {
    const { mallory, pathname } = await seed();

    expect(await readAttachmentBytes(mallory.id, pathname)).toBeNull();
    expect(blobGet).not.toHaveBeenCalled();
  });

  it("refuses a pathname that was never recorded", async () => {
    const { alice } = await seed();

    expect(await readAttachmentBytes(alice.id, "notes/never-uploaded.png")).toBeNull();
    expect(blobGet).not.toHaveBeenCalled();
  });

  it("reports a missing blob as missing rather than throwing", async () => {
    const { alice, pathname } = await seed();
    blobGet.mockRejectedValue(new Error("BlobNotFoundError"));

    expect(await readAttachmentBytes(alice.id, pathname)).toBeNull();
  });
});
