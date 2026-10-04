# Implementation Plan: Scheduled Publishing for Journal

## Overview
Implement scheduled publishing for Captain's Log (`plugins/journal/`), enabling users to schedule unpublished notes for publication at a future date/time. At the scheduled time, a one-time job executed by the Job app broadcasts the pre-signed Kind 1 event to Nostr relays and updates the entry status.

---

## Architecture & Signing Decision
- **Author Identity**: Journal notes are authored by the master user (`BOT_MASTER_PUBKEY`).
- **Signing Mechanism**: Browser pre-signing at schedule time (`nostr.signEvent` clientAction). The active browser signer signs the Kind 1 event when the user clicks **Accept** in the Schedule modal.
- **Server Execution**: The one-time job created via `SchedulerV2.operations.create` runs with task type `plugin-tool` (`alias: 'journal'`, `toolName: 'publish_scheduled'`, `input: { id: entryId }`). At the scheduled time, [`executeTool`](file:///Users/baris/Projects/nostr/dm-bot-main/plugins/journal/ai.ts) broadcasts the pre-signed event using the shared Nostr pool without requiring browser presence or server-side private keys.
- **Contract Boundary**: All Journal scheduling interactions use `PluginContext.capabilities` and the `SchedulerV2` contract. No direct Job database access or Job implementation imports.

---

## Implementation Checklist

- [x] **1. Schema & Types**
  - [x] Add `'date'` and `'time'` to `inputType` enum in `src/web/ui-schema.ts`.
  - [x] Update `JournalEntryStatus` in `plugins/journal/db.ts` to `'private' | 'scheduled' | 'published'`.
  - [x] Update `JournalStatusSchema` in `plugins/journal/ai.ts` to include `'scheduled'`.
  - [x] Add `publish_scheduled` tool call schema to `plugins/journal/ai.ts`.

- [x] **2. Web Client Signing Action (`nostr.signEvent`)**
  - [x] Implement generic `handleNostrSignEventAction` in `web/src/nostr/signEventAction.ts`.
  - [x] Register `nostr.signEvent` in `web/src/commands/useCommands.ts`.
  - [x] Support future time validation in client action before requesting signature.

- [x] **3. Journal Web UI (Schedule Modal & Entry Meta)**
  - [x] Keep existing **Publish** button unchanged.
  - [x] Add **Schedule** button beside **Publish** in `plugins/journal/commands/today/component.ts` for unpublished entries.
  - [x] Render compact Schedule modal (`schedule-form` subcommand) with date input, time input, timezone label, preview, and **Accept** / **Cancel** buttons.
  - [x] For scheduled entries, render `scheduled ℹ` status badge with overflow menu (**Reschedule**, **Cancel schedule**, **Publish now**).
  - [x] On edit of an already-scheduled entry, display the schedule modal prefilled with existing date/time and rescheduling notification.

- [x] **4. Journal Adapter & Commands (`plugins/journal/adapter.ts`)**
  - [x] Implement `schedule-form` subcommand to render the schedule modal.
  - [x] Form submission requests browser signature via `nostr.signEvent`.
  - [x] Implement `schedule-confirm` subcommand: validates signed event, checks for duplicates, invokes `SchedulerV2.operations.create`, updates entry to `'scheduled'`, stores `jobResourceId` and `signedEvent` in metadata.
  - [x] Implement `schedule-cancel` subcommand: cancels scheduled job and resets entry status to `'private'`.
  - [x] Handle deletion of scheduled entries: cancel scheduled job if entry is deleted.

- [x] **5. Scheduled Execution Tool (`plugins/journal/ai.ts`)**
  - [x] Implement `publish_scheduled` in `executeTool`:
    - Checks entry exists and is still in `'scheduled'` status (aborts cleanly if deleted/unscheduled).
    - Broadcasts pre-signed event to author write relays using `fetchNip65WriteRelays` and `publishSignedEventToRelays`.
    - Handles relay rejection (reports failure, preserves scheduled state, does not mark published).
    - On relay success: constructs `nostrUrl` (`nostr://nevent...`), updates entry status to `'published'`, and saves relay outcomes to metadata.

- [ ] **6. Verification & Quality**
  - [ ] Scoped TypeScript typechecks (`bunx tsc --noEmit` on modified targets).
  - [ ] Targeted ESLint with `--fix` on all modified files.
  - [ ] Verify zero modification of real journal entries, jobs, or Nostr relays during static verification.
  - [ ] Verify `restart.requested` is NOT created or modified.
