import { describe, expect, test } from "vitest";
import { buildCounts, buildSavedPdfName, chunk } from "../src/lib/utils";

describe("utils", () => {
  test("chunks arrays into batches of 50", () => {
    const items = Array.from({ length: 120 }, (_, index) => index);
    const result = chunk(items, 50);

    expect(result).toHaveLength(3);
    expect(result[0]).toHaveLength(50);
    expect(result[1]).toHaveLength(50);
    expect(result[2]).toHaveLength(20);
  });

  test("builds deterministic PDF names", () => {
    const fileName = buildSavedPdfName(3, "OC304631", "395388 RENASCER.pdf");
    expect(fileName).toBe("0003-oc304631-395388-renascer.pdf");
  });

  test("builds status counters from manifest items", () => {
    const counts = buildCounts([
      {
        id: "a",
        poNumber: "a",
        sourceRow: 1,
        downloadStatus: "downloaded",
        uploadStatus: "queued_for_upload",
        attempts: 1,
        createdAt: "",
        updatedAt: "",
      },
      {
        id: "b",
        poNumber: "b",
        sourceRow: 2,
        downloadStatus: "download_failed",
        uploadStatus: "upload_failed",
        attempts: 2,
        createdAt: "",
        updatedAt: "",
      },
    ]);

    expect(counts.total).toBe(2);
    expect(counts.downloaded).toBe(1);
    expect(counts.downloadFailed).toBe(1);
    expect(counts.queuedForUpload).toBe(1);
    expect(counts.uploadFailed).toBe(1);
  });
});
