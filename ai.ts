import { nip19, type NostrEvent, type VerifiedEvent } from 'nostr-tools';
import type { SimplePool } from 'nostr-tools/pool';
import { z } from 'zod';

import { fetchNip65WriteRelays, uniqueRelays } from '@src/nostr/nip65';
import {
  publishSignedEventToRelays,
  summarizeRelayOutcomes,
} from '@src/nostr/relay-publish';
import { NIP65_DISCOVERY_RELAYS } from '@src/nostr/relays';
import type { AiDefinition } from '@src/system/ai-definition';

import {
  getJournalEntry,
  listJournalEntries,
  listTodayJournalEntries,
  openDb,
  searchJournalEntries,
  storeJournalDraft,
  type CreateJournalEntryInput,
  type JournalEntryStatus,
  updateJournalEntry,
} from './db';
import { formatJournalDraft, formatJournalEntries } from './format';
import { JournalPluginContext } from './init';

const JournalStatusSchema = z.enum(['private', 'scheduled', 'published']);

const JournalAddCallSchema = z.object({
  type: z.literal('add'),
  input: z.object({
    title: z.string().nullable(),
    body: z.string().min(1),
    tags: z.array(z.string()).default([]),
    status: JournalStatusSchema.default('private'),
    metadata: z.record(z.string(), z.unknown()).default({}),
  }),
  original_prompt: z.string(),
});

const JournalListCallSchema = z.object({
  type: z.literal('list'),
  limit: z.number().int().positive().max(50).default(10),
});

const JournalTodayCallSchema = z.object({
  type: z.literal('today'),
});

const JournalSearchCallSchema = z.object({
  type: z.literal('search'),
  query: z.string().min(1),
  limit: z.number().int().positive().max(50).default(10),
});

const JournalPublishScheduledCallSchema = z.object({
  type: z.literal('publish_scheduled'),
  id: z.number().int().positive(),
  jobResourceId: z.string().optional(),
  aborted: z.boolean().optional(),
});

export const JournalToolCallSchema = z.discriminatedUnion('type', [
  JournalAddCallSchema,
  JournalListCallSchema,
  JournalTodayCallSchema,
  JournalSearchCallSchema,
  JournalPublishScheduledCallSchema,
]);

export type JournalToolCall = z.infer<typeof JournalToolCallSchema>;

function normalizeInput(
  input: z.infer<typeof JournalAddCallSchema>['input'],
): CreateJournalEntryInput {
  return {
    title: input.title,
    body: input.body,
    tags: input.tags,
    status: input.status as JournalEntryStatus,
    metadata: input.metadata,
  };
}

export async function executeTool(params: {
  alias: string;
  prefix: string;
  call: JournalToolCall;
  db: ReturnType<typeof openDb>;
  pool?: SimplePool;
  masterPubkey?: string;
}): Promise<string> {
  const cmd = `${params.prefix}${params.alias}`;

  if (params.call.type === 'list') {
    return formatJournalEntries(
      listJournalEntries(params.db, params.call.limit),
      'No journal entries yet.',
    );
  }

  if (params.call.type === 'today') {
    return formatJournalEntries(
      listTodayJournalEntries(params.db),
      'No journal entries today.',
    );
  }

  if (params.call.type === 'search') {
    return formatJournalEntries(
      searchJournalEntries(params.db, params.call.query, params.call.limit),
      `No journal entries matched: ${params.call.query}`,
    );
  }

  if (params.call.type === 'publish_scheduled') {
    const id = params.call.id;

    if (params.call.aborted) {
      return `Scheduled publication for entry #${id} was cancelled.`;
    }

    const entry = getJournalEntry(params.db, id);

    if (!entry) {
      return `Scheduled entry #${id} was not found (it may have been deleted). Publication aborted.`;
    }

    if (entry.status === 'published') {
      return `Journal entry #${id} is already published.`;
    }

    if (entry.status !== 'scheduled') {
      return `Journal entry #${id} is not scheduled (status: ${entry.status}). Publication aborted.`;
    }

    if (
      params.call.jobResourceId &&
      entry.metadata.jobResourceId &&
      entry.metadata.jobResourceId !== params.call.jobResourceId
    ) {
      return `Scheduled publication for entry #${id} was superseded by another schedule. Publication aborted.`;
    }

    const signedEvent = entry.metadata.signedEvent as NostrEvent | undefined;

    if (
      !signedEvent ||
      typeof signedEvent !== 'object' ||
      !signedEvent.id ||
      !signedEvent.sig
    ) {
      return `Scheduled journal entry #${id} does not contain a valid signed event. Publication failed.`;
    }

    const pool = params.pool ?? JournalPluginContext?.pool;

    if (!pool) {
      return `Nostr connection pool is not available. Failed to publish entry #${id}.`;
    }

    const writeRelays = await fetchNip65WriteRelays({
      pool,
      authorPubkey: signedEvent.pubkey,
    });

    const targetRelays = uniqueRelays([
      ...writeRelays,
      ...NIP65_DISCOVERY_RELAYS,
    ]);

    const outcomes = await publishSignedEventToRelays(
      targetRelays,
      signedEvent as VerifiedEvent,
    );

    const { accepted, rejected } = summarizeRelayOutcomes(outcomes);

    if (accepted.length === 0) {
      const errMsgs = rejected.map((r) => `${r.relay}: ${r.error}`).join('; ');

      updateJournalEntry({
        db: params.db,
        id,
        input: {
          title: entry.title,
          body: entry.body,
          tags: entry.tags,
          status: 'scheduled',
          metadata: {
            ...entry.metadata,
            lastPublishError: errMsgs,
            lastPublishAttempt: Date.now(),
          },
        },
      });

      return `Failed to publish scheduled entry #${id} to any relays: ${errMsgs}`;
    }

    const acceptedRelays = accepted.map((r) => r.relay);

    const nostrUrl = `nostr://${nip19.neventEncode({
      id: signedEvent.id,
      relays: acceptedRelays.slice(0, 4),
    })}`;

    updateJournalEntry({
      db: params.db,
      id,
      input: {
        title: entry.title,
        body: entry.body,
        tags: entry.tags,
        status: 'published',
        metadata: {
          ...entry.metadata,
          nostrUrl,
          publishedRelays: acceptedRelays,
          publishedAt: Date.now(),
        },
      },
    });

    return `Successfully published scheduled journal entry #${id} to Nostr: ${nostrUrl}`;
  }

  const draft = storeJournalDraft(
    params.db,
    normalizeInput(params.call.input),
    params.call.original_prompt,
  );

  return formatJournalDraft(draft, cmd);
}

export function agentInstructions(alias: string, prefix: string): string {
  return `## Captain's Log (${alias} tools)

Use ${alias} tools for private journal entries, daily notes, personal reflections, and commit-aware notes.

- Use \`list\`, \`today\`, and \`search\` to inspect existing entries.
- Use \`add\` to propose a new entry; it returns a draft that the user must accept with \`${prefix}${alias} accept <id>\`.
- Do not publish journal content unless the user explicitly asks for a publishing workflow.`;
}

export const aiDefinition = {
  toolCallSchema: JournalToolCallSchema,
  skillDescription: "Captain's Log journaling via local AppWeaver CLI tools.",
  skillNotes:
    'Mutating add calls create drafts. The user must accept or decline drafts through the journal command.',
  skillRules: [
    'Never treat private journal entries as public content unless the user explicitly asks to publish or draft public material.',
    'Return draft accept/decline instructions verbatim after add calls.',
  ],
  openDb,
  executeTool,
  agentInstructions,
} satisfies AiDefinition<
  typeof JournalToolCallSchema,
  JournalToolCall,
  ReturnType<typeof openDb>
>;

export { openDb };
