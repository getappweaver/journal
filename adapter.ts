import type { Database } from 'bun:sqlite';
import { verifyEvent, type VerifiedEvent } from 'nostr-tools';

import { SchedulerV4 } from '@src/capabilities/scheduler.v4';
import type { PluginContext, PluginIdentity } from '@src/core/plugin';
import type { MessageSource } from '@src/messaging';
import type { WebHandlerResult } from '@src/web/ui-schema';

import { inspectJournalPublishedEntry } from './commands/inspect/handler';
import { renderScheduleModal } from './commands/today/component';
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
  jsonPayload: unknown;
  prefix: string;
  alias: string;
  db: Database;
  identity: PluginIdentity;
  context: PluginContext;
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
    `${prefix}${alias} schedule-form <id> Open schedule modal for an entry`,
    `${prefix}${alias} schedule-cancel <id> Cancel scheduled publication for an entry`,
    `${prefix}${alias} publish <id> <nostr://nevent...> Mark an entry published`,
    `${prefix}${alias} inspect <id>     Inspect a published entry`,
    `${prefix}${alias} inspect-publish <id> --relay <url|all> Resend the original event`,
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

function getWebPayloadArg(jsonPayload: unknown, name: string): unknown {
  if (typeof jsonPayload !== 'object' || jsonPayload === null) {
    return null;
  }

  const payload = jsonPayload as { arguments?: unknown };

  if (
    typeof payload.arguments !== 'object' ||
    payload.arguments === null ||
    Array.isArray(payload.arguments)
  ) {
    return null;
  }

  return (payload.arguments as Record<string, unknown>)[name] ?? null;
}

function getWebArgument(jsonPayload: unknown, name: string): string | null {
  const value = getWebPayloadArg(jsonPayload, name);

  return typeof value === 'string' ? value : null;
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
  jsonPayload,
  prefix,
  alias,
  db,
  identity,
  context,
}: HandleJournalProps): Promise<WebHandlerResult> {
  void identity;

  const subcommand = (args[0] ?? 'help').toLowerCase();
  const webText = source === 'web' ? getWebArgument(jsonPayload, 'text') : null;
  const rest = (webText ?? args.slice(1).join(' ')).trim();
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
    const id = Number(args[1] ?? getWebPayloadArg(jsonPayload, 'id'));
    const textRaw = (webText ?? args.slice(2).join(' ')).trim();

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

    if (!entry) {
      return `Journal entry not found: ${id}`;
    }

    if (existing.status === 'scheduled' && source === 'web') {
      return renderScheduleModal({
        alias,
        entry,
        notification:
          'Entry updated. Please review the schedule and click Reschedule to sign and update the scheduled publication, or Cancel to keep the existing scheduled event.',
        error: null,
        defaultDate: null,
        defaultTime: null,
        isRescheduling: true,
      });
    }

    return `Updated journal entry #${entry.id}\n${formatJournalEntry(entry)}`;
  }

  if (subcommand === 'edit-form') {
    const id = Number(args[1] ?? getWebPayloadArg(jsonPayload, 'id'));

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
    const id = Number(args[1] ?? getWebPayloadArg(jsonPayload, 'id'));

    if (!Number.isInteger(id) || id <= 0) {
      return `Usage: ${cmd} delete <id>`;
    }

    const existing = getJournalEntry(db, id);

    if (
      existing &&
      existing.status === 'scheduled' &&
      existing.metadata.jobResourceId
    ) {
      try {
        await context.capabilities.invoke({
          operation: SchedulerV4.operations.delete,
          provider: 'auto',
          input: {
            resourceId: String(existing.metadata.jobResourceId),
          },
        });
      } catch (err) {
        console.warn(
          `[journal.delete] Failed to delete scheduled task for #${id}`,
          err,
        );
      }
    }

    return deleteJournalEntry(db, id)
      ? `Deleted journal entry #${id}`
      : `Journal entry not found: ${id}`;
  }

  if (subcommand === 'schedule-form') {
    const id = Number(args[1] ?? getWebPayloadArg(jsonPayload, 'id'));

    if (!Number.isInteger(id) || id <= 0) {
      return `Usage: ${cmd} schedule-form <id>`;
    }

    const entry = getJournalEntry(db, id);

    if (!entry) {
      return `Journal entry not found: ${id}`;
    }

    if (entry.status === 'published') {
      return `Journal entry #${id} is already published.`;
    }

    if (source === 'web') {
      return renderScheduleModal({
        alias,
        entry,
        notification: null,
        error: null,
        defaultDate: null,
        defaultTime: null,
        isRescheduling: entry.status === 'scheduled',
      });
    }

    return `Entry #${id} is ${entry.status}. Please use the web UI to schedule or reschedule publication.`;
  }

  if (subcommand === 'schedule-confirm') {
    const id = Number(args[1] ?? getWebPayloadArg(jsonPayload, 'id'));

    if (!Number.isInteger(id) || id <= 0) {
      return `Usage: ${cmd} schedule-confirm <id>`;
    }

    const existing = getJournalEntry(db, id);

    if (!existing) {
      return `Journal entry not found: ${id}`;
    }

    if (existing.status === 'published') {
      return `Journal entry #${id} is already published.`;
    }

    const signedEventRaw = getWebPayloadArg(jsonPayload, 'signedEvent');
    let signedEvent: VerifiedEvent;

    try {
      signedEvent =
        typeof signedEventRaw === 'string'
          ? (JSON.parse(signedEventRaw) as VerifiedEvent)
          : (signedEventRaw as VerifiedEvent);
    } catch {
      return 'Invalid signed event payload.';
    }

    if (!signedEvent || !verifyEvent(signedEvent)) {
      return 'Signed event verification failed.';
    }

    if (signedEvent.pubkey !== context.masterPubkey) {
      return 'Signed event author does not match master user public key.';
    }

    const runAtRaw = (getWebPayloadArg(jsonPayload, 'runAt') as string) ?? null;

    if (!runAtRaw) {
      return 'Scheduled time (runAt) is required.';
    }

    const runAtDate = new Date(runAtRaw);

    if (Number.isNaN(runAtDate.getTime())) {
      return 'Invalid scheduled date or time.';
    }

    if (runAtDate.getTime() <= Date.now()) {
      return 'Scheduled time must be in the future.';
    }

    const runAtIso = runAtDate.toISOString();
    const jobName = `Publish Captain's Log #${id}`;
    const scheduleDesc = `One-time publishing of journal entry #${id} at ${runAtIso}`;

    let jobResourceId: string;

    try {
      const createResult = await context.capabilities.invoke({
        operation: SchedulerV4.operations.create,
        provider: 'auto',
        input: {
          name: jobName,
          schedule: {
            type: 'one-time',
            runAt: runAtIso,
            description: scheduleDesc,
          },
          task: {
            type: 'plugin-tool',
            alias,
            toolName: 'publish_scheduled',
            input: {
              id,
            },
          },
          enabled: true,
        },
      });

      if (createResult.status !== 'success') {
        console.error(
          '[journal.schedule-confirm] Capability invocation returned non-success:',
          createResult,
        );

        return `Failed to schedule job: capability scheduler not available (${createResult.status}).`;
      }

      jobResourceId = createResult.output.resource.resourceId;
    } catch (err) {
      console.error(
        '[journal.schedule-confirm] Scheduler capability invoke error:',
        err,
      );

      return `Failed to schedule job: ${err instanceof Error ? err.message : String(err)}`;
    }

    if (
      existing.metadata.jobResourceId &&
      existing.metadata.jobResourceId !== jobResourceId
    ) {
      try {
        await context.capabilities.invoke({
          operation: SchedulerV4.operations.delete,
          provider: 'auto',
          input: {
            resourceId: String(existing.metadata.jobResourceId),
          },
        });
      } catch (err) {
        console.warn(
          '[journal.schedule-confirm] Failed to delete previous job:',
          err,
        );
      }
    }

    const scheduledAt = runAtDate.getTime();

    const tz =
      (getWebPayloadArg(jsonPayload, 'tz') as string) ??
      Intl.DateTimeFormat().resolvedOptions().timeZone;

    const entry = updateJournalEntry({
      db,
      id,
      input: {
        title: existing.title,
        body: existing.body,
        tags: existing.tags,
        status: 'scheduled',
        metadata: {
          ...existing.metadata,
          jobResourceId,
          scheduledAt,
          signedEvent,
          runAt: runAtIso,
          timezone: tz,
        },
      },
    });

    if (source === 'web') {
      return renderJournalTodayWeb({
        alias,
        entries: listTodayJournalEntries(db),
        recentEntries: listJournalEntries(db, 20),
        editingEntry: null,
      });
    }

    return entry
      ? `Scheduled journal entry #${id} for ${runAtIso}`
      : `Journal entry not found: ${id}`;
  }

  if (subcommand === 'schedule-cancel') {
    const id = Number(args[1] ?? getWebPayloadArg(jsonPayload, 'id'));

    if (!Number.isInteger(id) || id <= 0) {
      return `Usage: ${cmd} schedule-cancel <id>`;
    }

    const existing = getJournalEntry(db, id);

    if (!existing) {
      return `Journal entry not found: ${id}`;
    }

    if (existing.status !== 'scheduled') {
      return `Journal entry #${id} is not scheduled.`;
    }

    if (existing.metadata.jobResourceId) {
      try {
        await context.capabilities.invoke({
          operation: SchedulerV4.operations.delete,
          provider: 'auto',
          input: {
            resourceId: String(existing.metadata.jobResourceId),
          },
        });
      } catch (err) {
        console.warn(
          '[journal.schedule-cancel] Failed to delete scheduled job:',
          err,
        );
      }
    }

    const nextMetadata = { ...existing.metadata };
    delete nextMetadata.jobResourceId;
    delete nextMetadata.scheduledAt;
    delete nextMetadata.signedEvent;
    delete nextMetadata.runAt;

    const entry = updateJournalEntry({
      db,
      id,
      input: {
        title: existing.title,
        body: existing.body,
        tags: existing.tags,
        status: 'private',
        metadata: nextMetadata,
      },
    });

    if (source === 'web') {
      return renderJournalTodayWeb({
        alias,
        entries: listTodayJournalEntries(db),
        recentEntries: listJournalEntries(db, 20),
        editingEntry: null,
      });
    }

    return entry
      ? `Cancelled scheduled publishing for entry #${id}.`
      : `Journal entry not found: ${id}`;
  }

  if (subcommand === 'publish') {
    const id = Number(args[1]);

    const nostrUrl = String(
      (source === 'web'
        ? (getWebArgument(jsonPayload, 'nostrUrl') ??
          getWebArgument(jsonPayload, 'url'))
        : null) ??
        args[2] ??
        '',
    ).trim();

    console.info('[journal.publish] Received publish confirmation', {
      entryId: Number.isInteger(id) ? id : null,
      source,
      hasNostrUrl: nostrUrl.length > 0,
    });

    if (!Number.isInteger(id) || id <= 0 || !nostrUrl) {
      console.warn('[journal.publish] Invalid publish confirmation', {
        entryId: Number.isInteger(id) ? id : null,
        source,
        hasNostrUrl: nostrUrl.length > 0,
      });

      return `Usage: ${cmd} publish <id> <nostr://nevent...>`;
    }

    if (!nostrUrl.startsWith('nostr://nevent')) {
      console.warn('[journal.publish] Rejected invalid Nostr event URL', {
        entryId: id,
        source,
        urlPrefix: nostrUrl.slice(0, 16),
      });

      return 'Publish URL must start with nostr://nevent';
    }

    const existing = getJournalEntry(db, id);

    if (!existing) {
      console.warn('[journal.publish] Journal entry not found', {
        entryId: id,
      });

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

    console.info('[journal.publish] Stored publish confirmation', {
      entryId: id,
      updated: entry !== null,
    });

    return entry
      ? `Marked journal entry #${id} as published: ${nostrUrl}`
      : `Journal entry not found: ${id}`;
  }

  if (subcommand === 'inspect' || subcommand === 'inspect-publish') {
    const id = Number(args[1]);

    const entry =
      Number.isInteger(id) && id > 0 ? getJournalEntry(db, id) : null;

    if (!entry) {
      return 'Published journal entry not found.';
    }

    const payload = jsonPayload as { options?: { relay?: unknown } } | null;

    const relayIndex = args.indexOf('--relay');

    const relay =
      source === 'web' && typeof payload?.options?.relay === 'string'
        ? payload.options.relay
        : relayIndex >= 0 && args[relayIndex + 1]
          ? args[relayIndex + 1]!
          : null;

    if (subcommand === 'inspect-publish' && relay === null) {
      return `Usage: ${cmd} inspect-publish <id> --relay <write-relay|all>`;
    }

    return inspectJournalPublishedEntry({
      alias,
      entry,
      masterPubkey: context.masterPubkey,
      publishRelay: subcommand === 'inspect-publish' ? relay : null,
    });
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
