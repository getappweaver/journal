# Captain's Log

Core contracts: [AI draft sessions](../../../docs/AI_DRAFT_SESSIONS.md) and
[plugin system](../../../docs/PLUGIN_SYSTEM.md).

Captain's Log is a general-purpose journaling plugin for AppWeaver. The plugin alias is `journal`.

The goal is to make personal notes, development logs, ideas, and publishable raw material easy to capture while context is fresh. It should be useful for AppWeaver development, but it must not be AppWeaver-specific.

## Product Shape

- Product name: Captain's Log
- Plugin alias: `journal`
- Default storage: private local SQLite
- Default writing mode: quick, low-friction, one note at a time
- Publishing mode: explicit user action that signs and publishes to Nostr

## Core Concepts

- Entry: a saved note with optional title, tags, publication status, and metadata.
- Status: entry lifecycle, currently `private` or `published`.
- Published URL: a `nostr://nevent...` link stored after successful Nostr publish.
- Draft: an AI-proposed entry that the user must accept before it becomes a saved note.
- Config: opt-in settings for future reminders and git-hook behavior.

## Phase 1: Local Journal MVP

Implement the smallest useful plugin:

- Add `plugins/journal` with product name Captain's Log.
- Register alias `journal` in `plugins.json` and generated plugin registries.
- Store entries in `plugins/journal/db.sqlite`.
- Support direct commands: `/journal add <note>`, `/journal list`, `/journal today`, `/journal search <query>`, `/journal edit <id> <note>`, `/journal delete <id>`, `/journal publish <id> <nostr://nevent...>`, and `/journal config`.
- Support AI tools: `list`, `today`, `search`, and `add` as a draft-producing tool so agents do not silently mutate journal data.
- Provide a web interface through the `today` command: quick capture form, diary pages, entry actions, and widget help/stories.
- Use lightweight `LIKE` search first; keep the DB boundary ready for SQLite FTS5 later.

## Phase 2: Drafts And Nostr Publishing

- Add first-class draft commands if phase 1 draft flow proves useful: `/journal drafts`, `/journal accept <id>`, and `/journal decline <id>`.
- Publish from the web client with the connected Nostr signer.
- Discover the user's NIP-65 write relays before publishing, with fallback relays when needed.
- Store the resulting `nostr://nevent...` URL and show `published` as a link in the entry metadata.
- Add AI skill guidance for weekly digests, Nostr thread drafts, and long-form blog drafts from selected private entries.

## Phase 3: Configurable Reminders

- Add opt-in daily reminder config if real usage shows it is needed.
- Reminders should notify the user to write; they should not create entries automatically.
- Keep journal entries user-written by default.

## Phase 4: Git Commit Hook

- Add explicit hook installation commands: `/journal install-git-hook` and `/journal uninstall-git-hook`.
- Use a `post-commit` hook.
- The hook should not block `git commit` with interactive questions.
- The hook should notify the user after commits and suggest writing an entry.
- The hook should not create journal entries automatically.
- Hook behavior must be opt-in through config.

## Phase 5: Search Upgrade

- Verify whether Bun's SQLite build has FTS5 enabled.
- If available, add an FTS5 virtual table for title, body, and tags.
- Keep `/journal search` stable so the implementation can move from `LIKE` to FTS without changing user behavior.

## Generalization Notes

- Do not hardcode AppWeaver development concepts into the entry schema.
- Mood, energy, and friction should start as tags. Structured custom fields can come later if real usage demands them.
- Publishing should remain explicit. Journal entries are private unless the user selects Publish.
- Avoid source-type complexity. Journal entries should be written by the user, with AI only proposing drafts that require acceptance.
