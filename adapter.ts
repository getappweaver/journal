import type { Database } from 'bun:sqlite';

import type { PluginIdentity } from '@src/core/plugin';
import type { MessageSource } from '@src/messaging';
import type {
  WebAction,
  WebHandlerResult,
  WebNode,
  WebNodeRoot,
  WebTone,
} from '@src/web/ui-schema';

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
  type JournalEntry,
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

type TextElementProps = {
  value: string;
  className: string | null;
  tone: WebTone | null;
  size: 'sm' | 'md' | 'lg' | null;
  weight: 'normal' | 'medium' | 'semibold' | 'bold' | null;
};

type LayoutProps = {
  children: WebNode[];
  className: string | null;
  gap: 'xs' | 'sm' | 'md' | 'lg';
};

type BoxProps = {
  children: WebNode[];
  className: string | null;
  padding: 'xs' | 'sm' | 'md' | 'lg' | null;
};

type RenderJournalRootProps = {
  alias: string;
  entries: JournalEntry[];
  recentEntries: JournalEntry[];
  editingEntry: JournalEntry | null;
};

type DiaryPage = {
  pageNumber: number;
  entries: JournalEntry[];
  dateLabels: string[];
};

type ParseDraftIdProps = {
  args: string[];
  prefix: string;
  alias: string;
  subcommand: string;
};

function text(value: string): WebNode {
  return { type: 'text', value };
}

function textElement({
  value,
  className,
  tone,
  size,
  weight,
}: TextElementProps): WebNode {
  return {
    type: 'element',
    tag: 'text',
    props: {
      whiteSpace: 'pre-wrap',
      ...(className ? { className } : {}),
      ...(tone ? { tone } : {}),
      ...(size ? { size } : {}),
      ...(weight ? { weight } : {}),
    },
    children: [text(value)],
  };
}

function stack({ children, className, gap }: LayoutProps): WebNode {
  return {
    type: 'element',
    tag: 'stack',
    props: className ? { gap, className } : { gap },
    children,
  };
}

function row({ children, className, gap }: LayoutProps): WebNode {
  return {
    type: 'element',
    tag: 'row',
    props: className ? { gap, className } : { gap },
    children,
  };
}

function box({ children, className, padding }: BoxProps): WebNode {
  return {
    type: 'element',
    tag: 'box',
    props: {
      ...(className ? { className } : {}),
      ...(padding ? { padding } : {}),
    },
    children,
  };
}

function formatEntryTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatEntryDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString([], {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

function dateKey(timestamp: number): string {
  const date = new Date(timestamp);

  return [
    String(date.getFullYear()),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function uniqueEntries(entries: JournalEntry[]): JournalEntry[] {
  const seen = new Set<number>();
  const result: JournalEntry[] = [];

  for (const entry of entries) {
    if (seen.has(entry.id)) {
      continue;
    }

    seen.add(entry.id);
    result.push(entry);
  }

  return result.sort((a, b) => b.created_at - a.created_at || b.id - a.id);
}

function buildDiaryPages(entries: JournalEntry[]): DiaryPage[] {
  const groups = new Map<string, JournalEntry[]>();

  for (const entry of entries) {
    const key = dateKey(entry.created_at);
    const group = groups.get(key) ?? [];

    group.push(entry);
    groups.set(key, group);
  }

  const orderedGroups = Array.from(groups.entries()).sort(([a], [b]) =>
    b.localeCompare(a),
  );

  const pages: DiaryPage[] = [];

  for (let index = 0; index < orderedGroups.length; index += 2) {
    const pageGroups = orderedGroups.slice(index, index + 2);
    const pageEntries = pageGroups.flatMap(([, group]) => group);

    const dateLabels = pageGroups.map(([, group]) =>
      formatEntryDate(group[0]!.created_at),
    );

    pages.push({
      pageNumber: pages.length + 1,
      entries: pageEntries,
      dateLabels,
    });
  }

  return pages.length > 0
    ? pages
    : [
        {
          pageNumber: 1,
          entries: [],
          dateLabels: [formatEntryDate(Date.now())],
        },
      ];
}

function journalRefresh(alias: string) {
  return {
    command: alias,
    subcommand: 'today',
    arguments: {},
    options: {},
  };
}

function editJournalEntryAction(alias: string, entry: JournalEntry): WebAction {
  return {
    type: 'command',
    command: alias,
    subcommand: 'edit-form',
    arguments: { id: entry.id },
    options: {},
    recordInTimeline: false,
  };
}

function deleteJournalEntryAction(
  alias: string,
  entry: JournalEntry,
): WebAction {
  return {
    type: 'command',
    command: alias,
    subcommand: 'delete',
    arguments: { id: entry.id },
    options: {},
    refresh: journalRefresh(alias),
  };
}

function publishJournalEntryAction(
  alias: string,
  entry: JournalEntry,
): WebAction {
  const title = entry.title?.trim() ?? '';

  return {
    type: 'clientAction',
    action: 'nostr.publishKind1',
    payload: {
      content: entry.body,
      tags: [
        ...entry.tags.map((tag) => ['t', tag]),
        ...(title ? [['subject', title]] : []),
      ],
      signTitle: 'Sign Event: Publish journal entry',
      fallbackRelays: [
        'wss://relay.damus.io',
        'wss://nos.lol',
        'wss://relay.nostr.band',
      ],
      statusTitle: 'Journal entry published',
      statusMessage: `Journal entry #${entry.id}`,
      onSuccessCommand: {
        command: alias,
        subcommand: 'publish',
        arguments: { id: entry.id },
        options: {},
      },
    },
    refresh: journalRefresh(alias),
  };
}

function copyToClipboardAction(text: string): WebAction {
  return {
    type: 'clientAction',
    action: 'clipboard.writeText',
    payload: { text },
  };
}

function renderEntryActions(alias: string, entry: JournalEntry): WebNode {
  return {
    type: 'element',
    tag: 'overflowMenu',
    props: {
      label: formatEntryTime(entry.created_at),
      className: 'journal-entry__time journal-entry__menu',
    },
    children: [
      {
        type: 'element',
        tag: 'menuItem',
        props: {
          label: 'Edit',
          action: editJournalEntryAction(alias, entry),
        },
      },
      {
        type: 'element',
        tag: 'menuItem',
        props: {
          label: `Copy #${entry.id}`,
          action: copyToClipboardAction(`#${entry.id}`),
        },
      },
      {
        type: 'element',
        tag: 'menuItem',
        props: {
          label: 'Delete',
          tone: 'danger',
          action: deleteJournalEntryAction(alias, entry),
        },
      },
    ],
  };
}

function renderEntry(alias: string, entry: JournalEntry): WebNode {
  const tags = entry.tags.length > 0 ? ` #${entry.tags.join(' #')}` : '';

  const headerChildren: WebNode[] = [
    ...(entry.title
      ? [
          textElement({
            value: entry.title,
            className: null,
            tone: null,
            size: null,
            weight: null,
          }),
        ]
      : []),
  ];

  return box({
    className: 'journal-entry',
    padding: null,
    children: [
      row({
        className: 'journal-entry__header',
        gap: 'sm',
        children: [
          stack({
            className: 'journal-entry__heading',
            gap: 'xs',
            children: headerChildren,
          }),
          renderEntryActions(alias, entry),
        ],
      }),
      textElement({
        value: entry.body,
        className: 'journal-entry__body',
        tone: null,
        size: null,
        weight: null,
      }),
      renderEntryMeta(alias, entry, tags),
    ],
  });
}

function renderEntryMeta(
  alias: string,
  entry: JournalEntry,
  tags: string,
): WebNode {
  const nostrUrl =
    typeof entry.metadata.nostrUrl === 'string'
      ? entry.metadata.nostrUrl
      : null;

  if (entry.status === 'published' && nostrUrl) {
    return row({
      className: 'journal-entry__meta',
      gap: 'sm',
      children: [
        textElement({
          value: tags.trim(),
          className: 'journal-entry__tags',
          tone: 'muted',
          size: 'sm',
          weight: null,
        }),
        {
          type: 'element',
          tag: 'link',
          props: {
            href: nostrUrl,
            external: true,
            tone: 'muted',
            size: 'sm',
            className: 'journal-entry__status journal-entry__published-link',
          },
          children: [{ type: 'text', value: 'published' }],
        },
      ],
    });
  }

  return row({
    className: 'journal-entry__meta',
    gap: 'sm',
    children: [
      textElement({
        value: tags.trim(),
        className: 'journal-entry__tags',
        tone: 'muted',
        size: 'sm',
        weight: null,
      }),
      {
        type: 'element',
        tag: 'overflowMenu',
        props: {
          label: 'private',
          className: 'journal-entry__status journal-entry__status-link',
        },
        children: [
          {
            type: 'element',
            tag: 'menuItem',
            props: {
              label: 'Publish',
              action: publishJournalEntryAction(alias, entry),
            },
          },
        ],
      },
    ],
  });
}

function renderEmptyToday(): WebNode {
  return box({
    className: 'journal-empty',
    padding: 'lg',
    children: [
      textElement({
        value: 'No entries today yet.',
        className: null,
        tone: null,
        size: 'lg',
        weight: 'semibold',
      }),
      textElement({
        value: 'Write one sentence. That is enough.',
        className: null,
        tone: 'muted',
        size: null,
        weight: null,
      }),
    ],
  });
}

function renderSubmitButton(label: string): WebNode {
  return {
    type: 'element',
    tag: 'button',
    props: {
      htmlType: 'submit',
      label,
      className: 'journal-submit-button',
      storyTargetId: 'journal-quick-capture-submit',
    },
    children: [
      {
        type: 'element',
        tag: 'image',
        props: {
          src: '/plugin-icons/journal/commands__today__renderers__captains-log.svg',
          alt: '',
          className: 'journal-submit-button__icon',
        },
      },
      { type: 'text', value: label },
    ],
  };
}

function renderComposeForm(
  alias: string,
  editingEntry: JournalEntry | null,
): WebNode {
  const isEditing = editingEntry !== null;

  return {
    type: 'element',
    tag: 'form',
    props: {
      className: 'web-form web-form--stacked journal-compose',
      action: {
        type: 'command',
        command: alias,
        subcommand: isEditing ? 'edit' : 'add',
        arguments: isEditing ? { id: editingEntry.id } : {},
        options: {},
        refresh: {
          command: alias,
          subcommand: 'today',
          arguments: {},
          options: {},
        },
      },
    },
    children: [
      textElement({
        value: isEditing ? `Edit entry #${editingEntry.id}` : 'Quick capture',
        className: 'journal-compose__title',
        tone: null,
        size: null,
        weight: 'semibold',
      }),
      {
        type: 'element',
        tag: 'textArea',
        props: {
          formFieldName: 'text',
          inputPlaceholder:
            'What do you want to remember? Tags like #idea or #stuck are picked up automatically.',
          ...(isEditing ? { value: editingEntry.body } : {}),
          autoFocus: true,
          scrollIntoViewOnMount: isEditing ? true : undefined,
          maxRows: 8,
          storyTargetId: 'journal-quick-capture-text',
        },
      },
      stack({
        className: 'web-form__actions journal-actions',
        gap: 'sm',
        children: [renderSubmitButton(isEditing ? 'Edit Entry' : 'Save Entry')],
      }),
    ],
  };
}

function renderDiaryPage(alias: string, page: DiaryPage): WebNode {
  const title = page.dateLabels.join(' / ');

  return box({
    className: 'journal-page',
    padding: null,
    children: [
      row({
        className: 'journal-page__header',
        gap: 'sm',
        children: [
          textElement({
            value: title,
            className: 'journal-page__date',
            tone: null,
            size: null,
            weight: null,
          }),
          textElement({
            value: `Page ${page.pageNumber}`,
            className: 'journal-page__number',
            tone: 'muted',
            size: 'sm',
            weight: null,
          }),
        ],
      }),
      ...(page.entries.length > 0
        ? page.entries.map((entry) => renderEntry(alias, entry))
        : [renderEmptyToday()]),
    ],
  });
}

function renderJournalSection(title: string, children: WebNode[]): WebNode {
  return stack({
    className: 'journal-section',
    gap: 'sm',
    children: [
      textElement({
        value: title,
        className: 'journal-section__title',
        tone: null,
        size: null,
        weight: 'semibold',
      }),
      ...children,
    ],
  });
}

export function renderJournalWebRoot({
  alias,
  entries,
  recentEntries,
  editingEntry,
}: RenderJournalRootProps): WebNodeRoot {
  const pages = buildDiaryPages(uniqueEntries([...recentEntries, ...entries]));

  return {
    kind: 'ui',
    version: 1,
    meta: { command: alias, subcommand: 'today', arguments: {}, options: {} },
    widgetHelp: {
      title: "Captain's Log",
      body: [
        'A private page for what happened, what mattered, and what should not be forgotten. Publish any of them as a short note to your Nostr followers.',
      ],
      stories: [
        {
          id: 'journal-capture-publish',
          title: 'Capture and publish a journal entry',
          description:
            'Write a private log entry from the widget, then use the entry menu when you want to publish it to Nostr.',
          pluginAlias: alias,
          iconUrl:
            '/plugin-icons/journal/commands__today__renderers__captains-log.svg',
        },
      ],
    },
    shadowMountOverflow: 'hidden',
    tree: stack({
      className: 'journal-shell',
      gap: 'lg',
      children: [
        renderComposeForm(alias, editingEntry),
        renderJournalSection(
          'Diary pages',
          pages.map((page) => renderDiaryPage(alias, page)),
        ),
      ],
    }),
    stylesheets: [
      {
        id: 'journal-phase1',
        cssText: `
.journal-shell {
  --journal-page-bg: color-mix(in srgb, var(--color-surface, Canvas) 96%, white 4%);
  --journal-entry-even-bg: color-mix(in srgb, var(--color-surface-alt, #1a1a1a) 76%, #000 24%);
  min-height: 100%;
  max-height: 100%;
  overflow: auto;
  padding: 0;
}

.journal-compose,
.journal-empty,
.journal-page {
  background: color-mix(in srgb, var(--color-accent, Canvas) 10%, transparent);
}

.journal-compose__title,
.journal-entry__body {
  display: block;
}

.journal-compose__title {
  margin-bottom: 4px;
  text-align: center;
}

.journal-compose {
  padding: 8px;
}

.journal-submit-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  min-height: 1rem;
  font: inherit;
  font-size: 0.88rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.journal-submit-button__icon {
  width: 1rem;
  height: 1rem;
  object-fit: contain;
}

.journal-page {
  background: var(--journal-page-bg);
  box-shadow: 0 12px 32px color-mix(in srgb, black 7%, transparent);
  padding: 8px;
}

.journal-entry {
  background: transparent;
  margin-bottom: 0.35rem;
  padding: 0 0 0.2rem;
  position: relative;
}

.journal-entry:nth-child(even) {
  background: var(--journal-entry-even-bg);
}

.journal-entry__header {
  align-items: flex-start;
  justify-content: flex-end;
  margin-bottom: 2px;
}

.journal-entry__header,
.journal-page__header {
  flex-wrap: wrap;
}

.journal-page__header {
  margin-bottom: 5px;
  padding-bottom: 2px;
}

.journal-section__title {
  display: block;
  text-align: center;
}

.journal-entry__heading {
  min-width: 0;
  text-align: right;
}

.journal-entry__menu {
  color: var(--color-text-muted);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.journal-entry__menu.web-button,
.journal-entry__menu.web-overflow-trigger {
  opacity: 1;
  min-width: 0;
  min-height: 0;
  margin: 0;
  padding: 0;
  border: none;
  background: transparent;
  box-shadow: none;
  color: var(--color-text-muted);
  font: inherit;
  font-size: 0.72rem;
  font-weight: 400;
  line-height: inherit;
  transform: none;
}

.journal-entry__menu.web-button:hover,
.journal-entry__menu.web-button:focus-visible {
  background: transparent;
  color: var(--color-warning);
  box-shadow: none;
  transform: none;
}

.journal-entry .web-overflow-panel .web-button {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 1px 10px !important;
  color: #000;
  font-size: 0.88rem;
}

.journal-actions {
  align-items: flex-start;
}

.journal-page__number {
  margin-inline-start: auto;
}

.journal-entry__body {
  font-family: 'Lucida Console', 'IBM Plex Mono', 'Courier New', monospace;
  font-size: 0.8rem;
  line-height: 1.42;
}

.journal-entry__header,
.journal-entry__meta {
  font-size: 0.72rem;
  letter-spacing: 0.02em;
}

.journal-entry__meta {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  justify-content: space-between;
  margin-top: 2px;
}

.journal-entry__tags {
  flex: 1;
  min-width: 0;
}

.journal-entry__status {
  margin-inline-start: auto;
  text-align: right;
}

.journal-entry__status-link.web-button,
.journal-entry__status-link.web-overflow-trigger {
  display: inline;
  opacity: 1;
  min-width: 0;
  min-height: 0;
  padding: 0;
  border: none;
  background: transparent;
  box-shadow: none;
  color: var(--color-text-muted);
  font: inherit;
  font-size: 0.72rem;
  font-weight: 400;
  line-height: inherit;
  text-decoration: underline;
  text-underline-offset: 2px;
  transform: none;
}

.journal-entry__status-link.web-button:hover,
.journal-entry__status-link.web-button:focus-visible,
.journal-entry__status-link.web-overflow-trigger:hover,
.journal-entry__status-link.web-overflow-trigger:focus-visible {
  background: transparent;
  color: var(--color-warning);
  box-shadow: none;
  transform: none;
}

.journal-entry__published-link,
.web-node.journal-entry__published-link {
  font-size: 0.72rem;
  text-decoration: underline;
  text-underline-offset: 2px;
}
`,
      },
    ],
  };
}

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
      return renderJournalWebRoot({
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
      return renderJournalWebRoot({
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

    return renderJournalWebRoot({
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
