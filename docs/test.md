# src/test.mjs

Automated documentation generator that diffs a Git repository for changed source files and uses the Anthropic API (Claude) to produce markdown documentation for each one, then maintains an index file (`docs/README.md`) linking to all generated docs. Intended to run as a CI script (e.g., in a GitHub Actions workflow) triggered by push/PR events.

## Overview

The script:

1. Loads a system prompt built from style-guidance files in `prompts/`.
2. Computes the set of changed files under a watched directory using `git diff` (falling back to a full file listing if the diff fails).
3. Sends each changed file's contents to Claude, requesting markdown documentation.
4. Writes the generated markdown to a mirrored path under `docs/`.
5. Updates `docs/README.md` with links to all known generated docs (merging with existing entries).

## Environment Variables

| Name | Type | Description |
|---|---|---|
| `WATCH_PATH` | string | Root directory to scan for changed files. Defaults to `src`. |
| `BEFORE_SHA` | string | Git SHA representing the pre-change state. If all zeros (e.g. `0000000...`, as GitHub sends for new branches), the script diffs against `AFTER_SHA~1` instead. |
| `AFTER_SHA` | string | Git SHA representing the post-change state. Required for diffing and as the fallback `ls-tree` ref. |
| `ANTHROPIC_API_KEY` | string | API key used to construct the `Anthropic` client. |

**Note:** `BEFORE_SHA` and `AFTER_SHA` have no defaults — if unset, `getChangedFiles` will produce invalid git commands and likely fall through to the `ls-tree` fallback path (or throw, depending on git's behavior with undefined refs interpolated as the literal string `"undefined"`).

## Constants

| Name | Value | Description |
|---|---|---|
| `DOCS_DIR` | `'docs'` | Output directory for generated documentation. |
| `PROMPTS_DIR` | `'prompts'` | Directory containing style-guidance markdown files consumed by `loadSystemPrompt`. |

## Functions

### loadSystemPrompt

Builds the **system prompt** sent to Claude by concatenating a fixed instruction header with the contents of `prompts/formatting.md`, `prompts/detail-level.md`, and `prompts/audience.md`.

```js
function loadSystemPrompt(): string
```

- **Returns:** A single string combining the base instruction with each found prompt file's trimmed contents, separated by blank lines.
- **Behavior:** Missing prompt files are skipped with a `console.warn`, not treated as fatal errors. If all three files are missing, the returned prompt still contains the base instruction line.

### getChangedFiles

Determines which files under `WATCH_PATH` changed between `BEFORE_SHA` and `AFTER_SHA`.

```js
function getChangedFiles(): string[]
```

- **Returns:** Array of file paths (relative to repo root) that changed and still exist on disk at `AFTER_SHA`. Deleted files are filtered out via `existsSync`.
- **Behavior:**
  - If `BEFORE_SHA` matches `/^0+$/` (all zeros), the diff base becomes `${AFTER_SHA}~1` — this handles the case of a brand-new branch/commit with no real "before" state.
  - Runs `git diff --name-only <before> <after> -- <WATCH_PATH>`. If this command throws (e.g., invalid refs, shallow clone missing history), it falls back to `git ls-tree -r --name-only <AFTER_SHA> -- <WATCH_PATH>`, which lists *all* tracked files at that ref rather than just changed ones.
- **Gotcha:** The fallback path silently changes semantics from "changed files" to "all files" — callers should be aware the doc set may be much larger than expected when this path triggers.

### generateDocForFile

Sends a file's contents to Claude and returns the generated markdown documentation.

```js
async function generateDocForFile(filePath: string, systemPrompt: string): Promise<string>
```

| Name | Type | Description |
|---|---|---|
| `filePath` | `string` | Path to the source file to document (read via `readFileSync`). |
| `systemPrompt` | `string` | System prompt produced by `loadSystemPrompt`. |

- **Returns:** The text content of the first `text`-type block in Claude's response, or an empty string if no text block is present.
- **Throws:** Propagates any error from `readFileSync` (e.g., file not found) or from the Anthropic API call (e.g., network failure, invalid API key, rate limiting).
- **Model:** Hardcoded to `claude-sonnet-5` with `max_tokens: 4096`.

### docPathFor

Maps a source file path to its corresponding output path under `docs/`, preserving directory structure relative to `WATCH_PATH`.

```js
function docPathFor(sourceFile: string): string
```

**Example:**

```js
// WATCH_PATH = 'src'
docPathFor('src/utils/parse.mjs');
// => 'docs/utils/parse.md'
```

### updateIndex

Regenerates `docs/README.md` as a sorted, de-duplicated list of links to every known generated doc file, merging newly generated paths with any links already present in the existing index.

```js
function updateIndex(newPaths: string[]): void
```

| Name | Type | Description |
|---|---|---|
| `newPaths` | `string[]` | Output paths (as returned by `docPathFor`) generated during the current run. |

- **Behavior:** Parses existing markdown links (`[text](href)`) out of the current `docs/README.md` via regex, adds the new paths (converted to be relative to `DOCS_DIR`), sorts the union alphabetically, and overwrites the file.
- **Gotcha:** This mutates `docs/README.md` on disk. It does not deduplicate by content — if a doc file is deleted from disk but its link remains in the old index, that stale link persists in the regenerated index (no existence check is performed on prior entries).

### main

Entry point that orchestrates the full run: computes changed files, generates docs for each, writes them to disk, and updates the index.

```js
async function main(): Promise<void>
```

- **Behavior:**
  - Exits early (logging a message) if no changed files are found.
  - Loads the system prompt once and reuses it for every file in the run.
  - For each changed file, wraps generation/writing in a `try/catch` so a single file's failure (e.g., API error) doesn't abort the whole run — the error is logged via `console.error` and processing continues with the next file.
  - Calls `updateIndex` once at the end with only the paths that were **successfully** generated.

**Usage** (as a script, not imported):

```bash
WATCH_PATH=src \
BEFORE_SHA=$OLD_SHA \
AFTER_SHA=$NEW_SHA \
ANTHROPIC_API_KEY=sk-ant-xxxx \
node src/test.mjs
```

## Top-Level Execution

The module invokes `main()` immediately on load and attaches a `.catch` handler that logs the error and exits with status code `1`:

```js
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

This means importing this file (rather than running it directly) will trigger the full generation pipeline as a side effect — it is not designed to be imported as a library module.