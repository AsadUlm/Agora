import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

// Exercises the pure document-status helpers that drive the upload UI counter.
// These guarantee the UI counter is derived from backend statuses and can never
// get stuck showing "0 ready, 4 processing" after the backend returns ready.

const vite = await createServer({
    root: process.cwd(),
    configFile: false,
    resolve: {
        alias: {
            "@": fileURLToPath(new URL("../src", import.meta.url)),
        },
    },
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true, hmr: false },
    appType: "custom",
});

try {
    const { computeDocCounts, formatDocSummary, hasPendingDocuments } =
        await vite.ssrLoadModule("/src/features/debate/model/document-status.ts");

    const doc = (id, status) => ({ id, filename: `${id}.md`, status });

    // 1. Temporary state: 4 files processing → "0 ready, 4 processing".
    const processing = [
        doc("a", "processing"),
        doc("b", "processing"),
        doc("c", "processing"),
        doc("d", "processing"),
    ];
    assert.deepEqual(computeDocCounts(processing), {
        ready: 0, processing: 4, failed: 0, total: 4,
    });
    assert.equal(formatDocSummary(computeDocCounts(processing)), "0 ready, 4 processing");
    assert.equal(hasPendingDocuments(processing), true);

    // 2. After backend returns final statuses → "4 ready, 0 processing".
    const ready = processing.map((d) => ({ ...d, status: "ready" }));
    assert.deepEqual(computeDocCounts(ready), {
        ready: 4, processing: 0, failed: 0, total: 4,
    });
    assert.equal(formatDocSummary(computeDocCounts(ready)), "4 ready, 0 processing");
    assert.equal(hasPendingDocuments(ready), false, "no stale processing must remain");

    // 3. Mixed result → "3 ready, 0 processing, 1 failed".
    const mixed = [
        doc("a", "ready"),
        doc("b", "ready"),
        doc("c", "ready"),
        doc("d", "failed"),
    ];
    assert.deepEqual(computeDocCounts(mixed), {
        ready: 3, processing: 0, failed: 1, total: 4,
    });
    assert.equal(formatDocSummary(computeDocCounts(mixed)), "3 ready, 0 processing, 1 failed");
    assert.equal(hasPendingDocuments(mixed), false);

    // 4. Client-only "uploading" counts as non-terminal (processing bucket).
    const uploading = [doc("a", "uploading"), doc("b", "ready")];
    assert.deepEqual(computeDocCounts(uploading), {
        ready: 1, processing: 1, failed: 0, total: 2,
    });
    assert.equal(hasPendingDocuments(uploading), true);

    // 5. Backend response replacing temporary rows leaves no stale processing.
    //    (mirrors handleUploadDocumentsBatch's id-keyed merge)
    const prev = [doc("a", "processing"), doc("b", "processing")];
    const uploaded = [doc("a", "ready"), doc("b", "failed")];
    const uploadedIds = new Set(uploaded.map((d) => d.id));
    const merged = [...uploaded, ...prev.filter((d) => !uploadedIds.has(d.id))];
    assert.deepEqual(computeDocCounts(merged), {
        ready: 1, processing: 0, failed: 1, total: 2,
    });
    assert.equal(hasPendingDocuments(merged), false, "merge must drop stale processing rows");

    console.log("RAG document count + status helper checks passed.");
} finally {
    await vite.close();
}
