import { z } from 'zod';

import type { AiDefinition } from '@src/system/ai-definition';

import {
  listJournalEntries,
  listTodayJournalEntries,
  openDb,
  searchJournalEntries,
  storeJournalDraft,
  type CreateJournalEntryInput,
  type JournalEntryStatus,
} from './db';
import { formatJournalDraft, formatJournalEntries } from './format';

const JournalStatusSchema = z.enum(['private', 'published']);

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

export const JournalToolCallSchema = z.discriminatedUnion('type', [
  JournalAddCallSchema,
  JournalListCallSchema,
  JournalTodayCallSchema,
  JournalSearchCallSchema,
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
