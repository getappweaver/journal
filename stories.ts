import type {
  StoryChatState,
  StoryDefinition,
} from '@src/system/story-definition';

import { renderJournalWebRoot } from './adapter';
import type { JournalEntry } from './db';

type JournalStoryState = {
  chat: StoryChatState;
};

const demoNow = new Date('2026-05-16T11:20:00Z').getTime();

const demoEntries: JournalEntry[] = [
  {
    id: 3,
    title: null,
    body: 'Shipped a smaller diary page surface and kept the entry actions out of the way until hover. #journal',
    tags: ['journal'],
    status: 'private',
    metadata: {},
    created_at: demoNow,
    updated_at: demoNow,
  },
  {
    id: 2,
    title: null,
    body: 'Need to decide when a private note is worth publishing as a short Nostr note.',
    tags: [],
    status: 'private',
    metadata: {},
    created_at: demoNow - 1000 * 60 * 45,
    updated_at: demoNow - 1000 * 60 * 45,
  },
];

function buildJournalTodayOutput(params: {
  alias: string;
}): NonNullable<StoryDefinition<JournalStoryState>['commandOutput']> {
  return {
    text: null,
    web: renderJournalWebRoot({
      alias: params.alias,
      entries: demoEntries,
      recentEntries: demoEntries,
      editingEntry: null,
    }),
    clientView: null,
  };
}

function baseSandbox(params: { alias: string }) {
  return {
    __outputs: {
      [`${params.alias}:today`]: [
        buildJournalTodayOutput({ alias: params.alias }).web,
      ],
      [`${params.alias}:add`]: [
        renderJournalWebRoot({
          alias: params.alias,
          entries: [
            {
              id: 4,
              title: null,
              body: 'Captured the key decision before it disappeared. #demo',
              tags: ['demo'],
              status: 'private',
              metadata: {},
              created_at: demoNow + 1000 * 60,
              updated_at: demoNow + 1000 * 60,
            },
            ...demoEntries,
          ],
          recentEntries: demoEntries,
          editingEntry: null,
        }),
      ],
    },
  };
}

function buildCapturePublishStory(params: {
  alias: string;
}): StoryDefinition<JournalStoryState> {
  const story: StoryDefinition<JournalStoryState> = {
    id: 'journal-capture-publish',
    title: 'Capture and publish a journal entry',
    description:
      'Write a private diary entry from the Journal widget and find the publish action in the entry menu.',
    showcase: {
      title: 'Private first, publish when ready',
      description:
        "Captain's Log keeps notes local by default and only publishes a selected entry when you choose it.",
      timing: {
        initialDelayMs: 900,
        stepDelayMs: 1900,
        storyDelayMs: 2500,
      },
    },
    kind: 'command',
    initialState: { chat: { messages: [] } },
    sandbox: baseSandbox({ alias: params.alias }),
    steps: [
      {
        type: 'instruction',
        text: "Open Captain's Log from the widget dock.",
        showcase: {
          title: 'The diary is a persistent widget',
          description:
            'The journal opens as a singleton timeline widget so it stays available while you work.',
        },
      },
      {
        type: 'focus_target',
        target: {
          type: 'header_widget',
          command: params.alias,
          subcommand: 'today',
        },
      },
      {
        type: 'wait_for_action',
        match: {
          type: 'widget_opened',
          command: params.alias,
          subcommand: 'today',
        },
      },
      {
        type: 'instruction',
        text: 'Write a short entry in Quick capture.',
        showcase: {
          title: 'Capture one sentence',
          description:
            'The widget is optimized for quick private notes rather than heavy document editing.',
        },
      },
      {
        type: 'focus_target',
        target: { type: 'web_node', targetId: 'journal-quick-capture-text' },
      },
      {
        type: 'fill_form',
        targetId: 'journal-quick-capture-text',
        values: {
          arguments: {
            text: 'Captured the key decision before it disappeared. #demo',
          },
          options: {},
        },
      },
      {
        type: 'focus_target',
        target: { type: 'web_node', targetId: 'journal-quick-capture-submit' },
      },
      {
        type: 'wait_for_action',
        match: {
          type: 'target_clicked',
          targetId: 'journal-quick-capture-submit',
        },
      },
      {
        type: 'wait_for_action',
        match: {
          type: 'command_completed',
          command: params.alias,
          subcommand: 'add',
        },
      },
      {
        type: 'instruction',
        text: 'Use the entry menu later when you want to publish a private note to Nostr.',
        showcase: {
          title: 'Publishing is explicit',
          description:
            'The entry menu keeps Edit, Delete, and Publish actions close to the note without crowding the page.',
        },
      },
      {
        type: 'complete',
        cleanup: {
          closeWidgets: [
            {
              command: params.alias,
              subcommand: 'today',
            },
          ],
        },
      },
    ],
  };

  story.commandOutput = buildJournalTodayOutput({ alias: params.alias });

  return story;
}

export function journalStories(
  prefix: string,
  alias: string,
): StoryDefinition<unknown>[] {
  void prefix;

  return [buildCapturePublishStory({ alias })];
}
