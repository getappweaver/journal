import type { Database } from 'bun:sqlite';

import type { PluginIdentity } from '@src/core/plugin';
import type { MessageSource } from '@src/messaging';
import type { WebHandlerResult } from '@src/web/ui-schema';

import { renderJournalTodayWeb } from './commands/today/renderers/web';
import {
  createJournalEntry,
  deleteJournalEntry,
  deleteJournalDraft,
  getJournalEntry,
  getJournalConfig,
  getJournalDraft,
  listJournalDrafts,
  listJournalEntries,
  listTodayJournalEntries,
  searchJournalEntries,
  type CreateJournalEntryInput,
  updateJournalEntry,
} from './db';
import {
  formatJournalDrafts,
  formatJournalEntries,
  formatJournalEntry,
} from './format';

type HandleJournalProps = {
  args: string[];
  source: MessageSource;
  prefix: string;
  alias: string;
  db: Database;
  identity: PluginIdentity;
};

type ParseDraftIdProps = {
  args: string[];
  prefix: string;
  alias: string;
  subcommand: string;
};

function help(prefix: string, alias: string): string {
  return [
    "Captain's Log",
    '',
    `${prefix}${alias} add <note>       Add a journal entry`,
    `${prefix}${alias} today            Show today's entries`,
    `${prefix}${alias} list             Show recent entries`,
    `${prefix}${alias} search <query>   Search entries`,
    `${prefix}${alias} edit <id> <note> Edit an entry`,
    `${prefix}${alias} delete <id>      Delete an entry`,
    `${prefix}${alias} publish <id> <nostr://nevent...> Mark an entry published`,
    `${prefix}${alias} config           Show config`,
    `${prefix}${alias} drafts           Show AI-created drafts`,
    `${prefix}${alias} accept <id>      Accept a draft`,
    `${prefix}${alias} decline <id>     Decline a draft`,
  ].join('\n');
}

function parseEntryInput(textRaw: string): CreateJournalEntryInput {
  const tags = Array.from(textRaw.matchAll(/(?:^|\s)#([a-zA-Z0-9_-]+)/g)).map(
    (match) => match[1]!,
  );

  return {
    title: null,
    body: textRaw.trim(),
    tags,
    status: 'private',
    metadata: {},
  };
}

function parseDraftId({
  args,
  prefix,
  alias,
  subcommand,
}: ParseDraftIdProps): number | string {
  const id = Number(args[1]);

  if (!Number.isInteger(id) || id <= 0) {
    return `Usage: ${prefix}${alias} ${subcommand} <draft_id>`;
  }

  return id;
}

export async function handleJournal({
  args,
  source,
  prefix,
  alias,
  db,
  identity,
}: HandleJournalProps): Promise<WebHandlerResult> {
  void identity;

  const subcommand = (args[0] ?? 'help').toLowerCase();
  const rest = args.slice(1).join(' ').trim();
  const cmd = `${prefix}${alias}`;

  if (subcommand === 'help') {
    return help(prefix, alias);
  }

  if (subcommand === 'add') {
    if (!rest) {
      return `Usage: ${cmd} add <note>`;
    }

    const entry = createJournalEntry(db, parseEntryInput(rest));

    return `Created journal entry #${entry.id}\n${formatJournalEntry(entry)}`;
  }

  if (subcommand === 'list') {
    const entries = listJournalEntries(db, 10);

    if (source === 'web') {
      return renderJournalTodayWeb({
        alias,
        entries: listTodayJournalEntries(db),
        recentEntries: listJournalEntries(db, 20),
        editingEntry: null,
      });
    }

    return formatJournalEntries(entries, 'No journal entries yet.');
  }

  if (subcommand === 'today') {
    const entries = listTodayJournalEntries(db);

    if (source === 'web') {
      return renderJournalTodayWeb({
        alias,
        entries,
        recentEntries: listJournalEntries(db, 20),
        editingEntry: null,
      });
    }

    return formatJournalEntries(entries, 'No journal entries today.');
  }

  if (subcommand === 'search') {
    if (!rest) {
      return `Usage: ${cmd} search <query>`;
    }

    return formatJournalEntries(
      searchJournalEntries(db, rest, 20),
      `No journal entries matched: ${rest}`,
    );
  }

  if (subcommand === 'edit') {
    const id = Number(args[1]);
    const textRaw = args.slice(2).join(' ').trim();

    if (!Number.isInteger(id) || id <= 0 || !textRaw) {
      return `Usage: ${cmd} edit <id> <note>`;
    }

    const existing = getJournalEntry(db, id);

    if (!existing) {
      return `Journal entry not found: ${id}`;
    }

    const nextInput = parseEntryInput(textRaw);

    const entry = updateJournalEntry({
      db,
      id,
      input: {
        ...nextInput,
        status: existing.status,
        metadata: existing.metadata,
      },
    });

    return entry
      ? `Updated journal entry #${entry.id}\n${formatJournalEntry(entry)}`
      : `Journal entry not found: ${id}`;
  }

  if (subcommand === 'edit-form') {
    const id = Number(args[1]);

    if (!Number.isInteger(id) || id <= 0) {
      return `Usage: ${cmd} edit-form <id>`;
    }

    const entry = getJournalEntry(db, id);

    if (!entry) {
      return `Journal entry not found: ${id}`;
    }

    return renderJournalTodayWeb({
      alias,
      entries: listTodayJournalEntries(db),
      recentEntries: listJournalEntries(db, 20),
      editingEntry: entry,
    });
  }

  if (subcommand === 'delete') {
    const id = Number(args[1]);

    if (!Number.isInteger(id) || id <= 0) {
      return `Usage: ${cmd} delete <id>`;
    }

    return deleteJournalEntry(db, id)
      ? `Deleted journal entry #${id}`
      : `Journal entry not found: ${id}`;
  }

  if (subcommand === 'publish') {
    const id = Number(args[1]);
    const nostrUrl = String(args[2] ?? '').trim();

    if (!Number.isInteger(id) || id <= 0 || !nostrUrl) {
      return `Usage: ${cmd} publish <id> <nostr://nevent...>`;
    }

    if (!nostrUrl.startsWith('nostr://nevent')) {
      return 'Publish URL must start with nostr://nevent';
    }

    const existing = getJournalEntry(db, id);

    if (!existing) {
      return `Journal entry not found: ${id}`;
    }

    const entry = updateJournalEntry({
      db,
      id,
      input: {
        title: existing.title,
        body: existing.body,
        tags: existing.tags,
        status: 'published',
        metadata: { ...existing.metadata, nostrUrl },
      },
    });

    return entry
      ? `Marked journal entry #${id} as published: ${nostrUrl}`
      : `Journal entry not found: ${id}`;
  }

  if (subcommand === 'config') {
    const config = getJournalConfig(db);

    return Object.entries(config)
      .map(([key, value]) => `${key}: ${value}`)
      .join('\n');
  }

  if (subcommand === 'drafts') {
    return formatJournalDrafts(listJournalDrafts(db), cmd);
  }

  if (subcommand === 'accept') {
    const id = parseDraftId({ args, prefix, alias, subcommand: 'accept' });

    if (typeof id === 'string') {
      return id;
    }

    const draft = getJournalDraft(db, id);

    if (!draft) {
      return `Journal draft not found: ${id}`;
    }

    const entry = createJournalEntry(db, draft.input);
    deleteJournalDraft(db, id);

    return `Accepted draft #${id}; created journal entry #${entry.id}`;
  }

  if (subcommand === 'decline') {
    const id = parseDraftId({ args, prefix, alias, subcommand: 'decline' });

    if (typeof id === 'string') {
      return id;
    }

    return deleteJournalDraft(db, id)
      ? `Declined journal draft #${id}`
      : `Journal draft not found: ${id}`;
  }

  return `Unknown command: ${cmd} ${subcommand}`;
}
