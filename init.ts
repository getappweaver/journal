import { basename } from 'path';

import type { Database } from 'bun:sqlite';

import {
  parsePluginPackageJson,
  type BotPlugin,
  type PluginContext,
  type PluginInvocationContext,
} from '@src/core/plugin';
import type { WebHandlerResult } from '@src/web/ui-schema';

import { handleJournal } from './adapter';
import { aiDefinition } from './ai';
import { openDb } from './db';
import { commandDefinition } from './definition';
import { journalStories } from './stories';

const pluginDir = import.meta.dir;
const alias = basename(pluginDir);
const journalPkg = parsePluginPackageJson({ pluginDir });

if (!journalPkg) {
  throw new Error(
    'Journal plugin: invalid or missing package.json. Required: name, version, dmBot.coreApiVersion, dmBot.description',
  );
}

export let JournalPluginContext: PluginContext | null = null;
export let JournalPluginDb: Database | null = null;

export const JournalPlugin: BotPlugin = {
  identity: {
    name: journalPkg.name,
    alias,
    version: journalPkg.version,
    description: journalPkg.description,
  },
  handler: async (
    args: string[],
    context: PluginInvocationContext,
  ): Promise<WebHandlerResult> => {
    if (!JournalPluginContext) {
      throw new Error('JournalPlugin not initialized');
    }

    if (!JournalPluginDb) {
      throw new Error('JournalPluginDb not initialized');
    }

    return handleJournal({
      args,
      source: context.source,
      jsonPayload: context.jsonPayload,
      prefix: context.prefix,
      alias,
      db: JournalPluginDb,
      identity: JournalPlugin.identity,
    });
  },
  onInit: (ctx: PluginContext) => {
    JournalPluginContext = ctx;
    JournalPluginDb = openDb();
  },
  helpText: (helpAlias: string, prefix: string) => [
    `Captain's Log: private journaling and searchable personal notes. Use ${prefix}${helpAlias} add, today, list, search, edit, delete, publish, drafts, accept, and decline.`,
  ],
  commandDefinition,
  stories: journalStories,
  aiDefinition,
};
