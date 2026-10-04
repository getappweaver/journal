import { createHelpSubcommandDefinition } from '@src/commands/help/command';
import type {
  CommandDefinition,
  SubcommandDefinition,
} from '@src/system/command-definition';

type SubcommandProps = {
  name: string;
  summary: string;
  examples: string[];
};

function subcommand({
  name,
  summary,
  examples,
}: SubcommandProps): SubcommandDefinition {
  return {
    name,
    summary,
    aliases: [],
    arguments: [],
    options: [],
    examples,
  };
}

export const commandDefinition = (
  prefix: string,
  alias: string,
): CommandDefinition => ({
  name: alias,
  summary: "Captain's Log: private journaling and searchable personal notes.",
  aliases: [],
  subcommands: [
    createHelpSubcommandDefinition(prefix, alias, {
      topicArgSummary:
        'Optional subcommand: add, list, today, search, edit, delete, schedule-form, schedule-cancel, publish, inspect, inspect-publish, config, drafts, accept, decline',
      exampleTopics: ['add', 'today', 'search'],
    }),
    {
      name: 'add',
      summary: 'Add a journal entry.',
      aliases: [],
      arguments: [
        {
          name: 'text',
          summary: 'Journal entry body.',
          kind: 'string',
          required: true,
          variadic: true,
          choices: null,
        },
      ],
      options: [],
      examples: [
        `${prefix}${alias} add Today I shipped the first journal MVP.`,
      ],
      webExecutionMode: 'requires_input',
    },
    subcommand({
      name: 'list',
      summary: 'List recent journal entries.',
      examples: [`${prefix}${alias} list`],
    }),
    {
      name: 'today',
      summary: "Show today's journal entries.",
      aliases: [],
      arguments: [],
      options: [],
      examples: [`${prefix}${alias} today`],
      webWidget: {
        placement: 'header',
        surface: 'timeline_singleton',
        label: "Captain's Log",
        modalTitle: "Captain's Log",
        icon: 'commands/today/renderers/captains-log.svg',
        order: 40,
      },
      webExecutionMode: 'runnable_default',
    },
    {
      name: 'search',
      summary: 'Search journal entries.',
      aliases: [],
      arguments: [
        {
          name: 'query',
          summary: 'Search query.',
          kind: 'string',
          required: true,
          variadic: true,
          choices: null,
        },
      ],
      options: [],
      examples: [`${prefix}${alias} search renderer`],
    },
    {
      name: 'edit',
      summary: 'Edit a journal entry.',
      aliases: [],
      arguments: [
        {
          name: 'id',
          summary: 'Journal entry id.',
          kind: 'integer',
          required: true,
          variadic: false,
          choices: null,
        },
        {
          name: 'text',
          summary: 'Replacement journal entry body.',
          kind: 'string',
          required: true,
          variadic: true,
          choices: null,
        },
      ],
      options: [],
      examples: [`${prefix}${alias} edit 1 Updated entry text.`],
      webExecutionMode: 'requires_input',
    },
    {
      name: 'edit-form',
      summary: 'Open the journal widget with an entry loaded for editing.',
      aliases: [],
      arguments: [
        {
          name: 'id',
          summary: 'Journal entry id.',
          kind: 'integer',
          required: true,
          variadic: false,
          choices: null,
        },
      ],
      options: [],
      examples: [`${prefix}${alias} edit-form 1`],
      webExecutionMode: 'runnable_default',
    },
    {
      name: 'delete',
      summary: 'Delete a journal entry.',
      aliases: [],
      arguments: [
        {
          name: 'id',
          summary: 'Journal entry id.',
          kind: 'integer',
          required: true,
          variadic: false,
          choices: null,
        },
      ],
      options: [],
      examples: [`${prefix}${alias} delete 1`],
      webExecutionMode: 'runnable_default',
    },
    {
      name: 'schedule-form',
      summary: 'Open the scheduling modal for a journal entry.',
      aliases: [],
      arguments: [
        {
          name: 'id',
          summary: 'Journal entry id.',
          kind: 'integer',
          required: true,
          variadic: false,
          choices: null,
        },
      ],
      options: [],
      examples: [`${prefix}${alias} schedule-form 1`],
      webExecutionMode: 'runnable_default',
    },
    {
      name: 'schedule-confirm',
      summary: 'Confirm scheduling for a journal entry.',
      aliases: [],
      arguments: [
        {
          name: 'id',
          summary: 'Journal entry id.',
          kind: 'integer',
          required: true,
          variadic: false,
          choices: null,
        },
      ],
      options: [],
      examples: [`${prefix}${alias} schedule-confirm 1`],
      webExecutionMode: 'requires_input',
    },
    {
      name: 'schedule-cancel',
      summary: 'Cancel scheduled publishing for a journal entry.',
      aliases: [],
      arguments: [
        {
          name: 'id',
          summary: 'Journal entry id.',
          kind: 'integer',
          required: true,
          variadic: false,
          choices: null,
        },
      ],
      options: [],
      examples: [`${prefix}${alias} schedule-cancel 1`],
      webExecutionMode: 'runnable_default',
    },
    {
      name: 'publish',
      summary: 'Mark a journal entry as published with a Nostr event URL.',
      aliases: [],
      arguments: [
        {
          name: 'id',
          summary: 'Journal entry id.',
          kind: 'integer',
          required: true,
          variadic: false,
          choices: null,
        },
        {
          name: 'url',
          summary: 'nostr://nevent URL for the published entry.',
          kind: 'string',
          required: false,
          variadic: false,
          choices: null,
        },
      ],
      options: [],
      examples: [`${prefix}${alias} publish 1 nostr://nevent1...`],
      webExecutionMode: 'runnable_default',
    },
    subcommand({
      name: 'config',
      summary: 'Show journal configuration.',
      examples: [`${prefix}${alias} config`],
    }),
    ...['inspect', 'inspect-publish'].map((name): SubcommandDefinition => ({
      name,
      summary:
        name === 'inspect'
          ? "Inspect a published entry on its author's write relays."
          : 'Resend the original published event to missing write relays.',
      aliases: [],
      arguments: [
        {
          name: 'id',
          summary: 'Journal entry id.',
          kind: 'integer',
          required: true,
          variadic: false,
          choices: null,
        },
      ],
      options:
        name === 'inspect-publish'
          ? [
              {
                name: 'relay',
                flag: '--relay',
                summary: 'Write relay URL, or all missing write relays.',
                kind: 'string',
                shortFlag: null,
                required: true,
                choices: null,
              },
            ]
          : [],
      examples: [
        `${prefix}${alias} ${name} 1${name === 'inspect-publish' ? ' --relay all' : ''}`,
      ],
      webExecutionMode: 'runnable_default',
    })),
  ],
});
