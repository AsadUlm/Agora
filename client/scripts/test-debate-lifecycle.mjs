import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const view = readFileSync(new URL("../src/features/debate/model/debate-view-state.ts", import.meta.url), "utf8");
const store = readFileSync(new URL("../src/features/debate/model/debate.store.ts", import.meta.url), "utf8");
const execution = readFileSync(new URL("../src/features/debate/model/execution-state.ts", import.meta.url), "utf8");
const workspacePage = readFileSync(new URL("../src/pages/DebateWorkspacePage.tsx", import.meta.url), "utf8");

assert.match(view, /status === "partially_completed"/, "partial debates must have a dedicated view state");
assert.match(view, /graphState:[\s\S]*"preserved_partial"/, "partial debates must preserve graph state");
assert.match(view, /Final synthesis failed/, "partial synthesis failure must have a specific banner");
assert.match(view, /error\?\.partialResultsAvailable/, "partial metadata must override an inconsistent fatal snapshot");
assert.match(view, /status === "interrupted"/, "stream interruption must have a non-fatal view state");
assert.match(store, /status === "interrupted"[\s\S]*loadDebate\(state\.debateId, \{ silent: true \}\)/, "stream close must reconcile REST once");
assert.doesNotMatch(store, /status === "interrupted"[\s\S]{0,300}turnStatus: "failed"/, "stream close must not mark the debate failed");
assert.match(execution, /Stage 5: Final Synthesis/, "five-stage labels must be canonical");
assert.doesNotMatch(execution, /1 \| 2 \| 3/, "execution state must not use legacy 1|2|3 types");
assert.doesNotMatch(workspacePage, /\.turnStatus\)/, "workspace polling must use the shared view selector");

const uiDir = new URL("../src/features/debate/ui/", import.meta.url);
for (const file of readdirSync(uiDir).filter((name) => name.endsWith(".tsx"))) {
    const source = readFileSync(new URL(file, uiDir), "utf8");
    assert.doesNotMatch(
        source,
        /useDebateStore\(\(s(?:tate)?\) => s(?:tate)?\.turnStatus\)/,
        `${file} must use deriveDebateViewState instead of inferring lifecycle from turnStatus`,
    );
}

console.log("Frontend lifecycle checks passed.");
