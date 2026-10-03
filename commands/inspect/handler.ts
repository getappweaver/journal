import { nip19, verifyEvent, type NostrEvent } from 'nostr-tools';
import { SimplePool } from 'nostr-tools/pool';

import { fetchNip65WriteRelays, uniqueRelays } from '@src/nostr/nip65';
import { NIP65_DISCOVERY_RELAYS } from '@src/nostr/relays';
import type { WebAction, WebNode, WebNodeRoot } from '@src/web/ui-schema';

import type { JournalEntry } from '../../db';

type InspectJournalPublishedEntryProps = {
  alias: string;
  entry: JournalEntry;
  masterPubkey: string;
  publishRelay: string | null;
};

type RelayResult = {
  relay: string;
  event: NostrEvent | null;
  error: string | null;
};

type QueryRelayProps = {
  pool: SimplePool;
  relay: string;
  eventId: string;
};

async function queryRelay({
  pool,
  relay,
  eventId,
}: QueryRelayProps): Promise<RelayResult> {
  try {
    const event = await pool.get(
      [relay],
      { ids: [eventId] },
      { maxWait: 3500 },
    );

    return {
      relay,
      event: event?.id === eventId && verifyEvent(event) ? event : null,
      error: null,
    };
  } catch (error) {
    return {
      relay,
      event: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function text(value: string): WebNode {
  return { type: 'text', value };
}

export async function inspectJournalPublishedEntry({
  alias,
  entry,
  masterPubkey,
  publishRelay,
}: InspectJournalPublishedEntryProps): Promise<WebNodeRoot | string> {
  const url = entry.metadata.nostrUrl;

  if (entry.status !== 'published' || typeof url !== 'string') {
    return 'This journal entry has no published event link.';
  }

  let decoded: ReturnType<typeof nip19.decode>;
  try {
    decoded = nip19.decode(url.replace(/^nostr:(?:\/\/)?/i, ''));
  } catch {
    return 'The stored published event link is invalid.';
  }

  if (decoded.type !== 'nevent' && decoded.type !== 'note') {
    return 'The stored link must identify a published event.';
  }

  const eventId = decoded.type === 'nevent' ? decoded.data.id : decoded.data;
  const hints = decoded.type === 'nevent' ? (decoded.data.relays ?? []) : [];

  const historicalRelays = uniqueRelays(
    Array.isArray(entry.metadata.publishedRelays)
      ? entry.metadata.publishedRelays.filter(
          (relay): relay is string => typeof relay === 'string',
        )
      : [],
  );

  const hintRelays = uniqueRelays(hints);
  let author =
    decoded.type === 'nevent'
      ? (decoded.data.author ?? masterPubkey)
      : masterPubkey;
  const pool = new SimplePool();
  const queried = new Map<string, RelayResult>();
  const opened = new Set<string>(uniqueRelays(NIP65_DISCOVERY_RELAYS));

  const checkRelays = async (relays: string[]) => {
    const pending = uniqueRelays(relays).filter((relay) => !queried.has(relay));
    for (const relay of pending) {
      opened.add(relay);
    }

    const results = await Promise.all(
      pending.map((relay) => queryRelay({ pool, relay, eventId })),
    );

    for (const result of results) {
      queried.set(result.relay, result);
    }
  };

  try {
    let discoveryError: string | null = null;

    const discoverWriteRelays = async (authorPubkey: string) => {
      try {
        return await fetchNip65WriteRelays({ pool, authorPubkey });
      } catch (error) {
        discoveryError = error instanceof Error ? error.message : String(error);

        return [];
      }
    };

    let writeRelays = await discoverWriteRelays(author);

    await checkRelays([
      ...writeRelays,
      ...hintRelays,
      ...historicalRelays,
      ...NIP65_DISCOVERY_RELAYS,
    ]);

    const original =
      [...queried.values()].find((result) => result.event)?.event ?? null;

    // Older publication links omit the author; use the actual signed event's
    // author rather than assuming the connected signer was the bot master.
    if (original && original.pubkey !== author) {
      author = original.pubkey;
      writeRelays = await discoverWriteRelays(author);
      await checkRelays(writeRelays);
    }

    const missing = writeRelays.filter((relay) => !queried.get(relay)?.event);

    if (publishRelay !== null) {
      const targets =
        publishRelay === 'all'
          ? missing
          : uniqueRelays([publishRelay]).filter((relay) =>
              missing.includes(relay),
            );

      if (targets.length > 0 && !original) {
        return 'The original signed event could not be found. Retry inspection later; resending requires that exact event.';
      }

      if (targets.length > 0 && original) {
        for (const relay of targets) {
          opened.add(relay);
        }

        const outcomes = await Promise.allSettled(
          pool.publish(targets, original, { maxWait: 5000 }),
        );

        outcomes.forEach((outcome, index) => {
          const relay = targets[index]!;

          const connectionFailure =
            outcome.status === 'fulfilled' &&
            typeof outcome.value === 'string' &&
            outcome.value.startsWith('connection failure:');

          queried.set(relay, {
            relay,
            event:
              outcome.status === 'fulfilled' && !connectionFailure
                ? original
                : null,
            error:
              outcome.status === 'rejected'
                ? String(outcome.reason)
                : connectionFailure
                  ? String(outcome.value)
                  : null,
          });
        });
      }
    }

    const action = (relay: string | null): WebAction => ({
      type: 'command',
      command: alias,
      subcommand: relay === null ? 'inspect' : 'inspect-publish',
      arguments: { id: entry.id },
      options: relay === null ? {} : { relay },
      surface: 'modal',
      modalTitle: `Inspect journal entry #${entry.id}`,
      recordInTimeline: false,
    });

    const canPublish = original !== null;
    const hasMissing = writeRelays.some((relay) => !queried.get(relay)?.event);

    const displayRelays = uniqueRelays([
      ...historicalRelays,
      ...hintRelays,
      ...writeRelays,
      ...[...queried.values()]
        .filter((result) => result.event !== null)
        .map((result) => result.relay),
    ]);

    return {
      kind: 'ui',
      version: 1,
      meta: { command: alias, subcommand: 'inspect' },
      tree: {
        type: 'element',
        tag: 'stack',
        props: { gap: 'sm' },
        children: [
          {
            type: 'element',
            tag: 'link',
            props: { href: url, external: true },
            children: [text('Open event ↗')],
          },
          {
            type: 'element',
            tag: 'text',
            props: { weight: 'bold' },
            children: [text(entry.title ?? `Entry #${entry.id}`)],
          },
          {
            type: 'element',
            tag: 'text',
            props: { size: 'sm', tone: 'muted', whiteSpace: 'pre-wrap' },
            children: [text(original?.content ?? entry.body)],
          },
          {
            type: 'element',
            tag: 'row',
            props: { gap: 'sm', align: 'between' },
            children: [
              {
                type: 'element',
                tag: 'text',
                props: { weight: 'bold' },
                children: [text('Publication relays and current write relays')],
              },
              {
                type: 'element',
                tag: 'button',
                props: { label: 'Refresh', action: action(null) },
                children: [],
              },
              {
                type: 'element',
                tag: 'button',
                props: {
                  label: 'Publish all missing',
                  disabled: !canPublish || !hasMissing,
                  action: action('all'),
                },
                children: [],
              },
            ],
          },
          {
            type: 'element',
            tag: 'text',
            props: { size: 'sm', tone: 'muted' },
            children: [
              text(
                'Found now means this exact event was returned. Link hints identify where to look; they are not proof of current availability.',
              ),
            ],
          },
          ...(discoveryError === null
            ? []
            : [
                {
                  type: 'element' as const,
                  tag: 'text' as const,
                  props: { size: 'sm' as const, tone: 'muted' as const },
                  children: [
                    text(
                      `Could not discover current write relays: ${discoveryError}`,
                    ),
                  ],
                },
              ]),
          ...displayRelays.map((relay): WebNode => {
            const result = queried.get(relay);
            const isWriteRelay = writeRelays.includes(relay);
            const wasConfirmed = historicalRelays.includes(relay);
            const isHint = hintRelays.includes(relay);

            const sources = [
              ...(wasConfirmed ? ['publication history'] : []),
              ...(isHint ? ['link hint'] : []),
              ...(isWriteRelay ? ['current write relay'] : []),
            ];

            const published =
              result?.event !== null && result?.event !== undefined;

            return {
              type: 'element',
              tag: 'row',
              props: { gap: 'sm', align: 'between', itemAlign: 'center' },
              children: [
                {
                  type: 'element',
                  tag: 'text',
                  props: { size: 'sm' },
                  children: [
                    text(
                      `${relay}${sources.length ? ` · ${sources.join(', ')}` : ''}`,
                    ),
                  ],
                },
                {
                  type: 'element',
                  tag: 'text',
                  props: { size: 'sm', tone: published ? 'success' : 'muted' },
                  children: [
                    text(
                      published
                        ? '✓ Found now'
                        : `${wasConfirmed ? 'Previously confirmed · ' : ''}${result?.error ? `Check failed: ${result.error}` : 'Not returned by this check'}`,
                    ),
                  ],
                },
                ...(published || !isWriteRelay
                  ? []
                  : [
                      {
                        type: 'element' as const,
                        tag: 'button' as const,
                        props: {
                          label: 'Publish',
                          disabled: !canPublish,
                          action: action(relay),
                        },
                        children: [],
                      },
                    ]),
              ],
            };
          }),
          ...(canPublish
            ? []
            : [
                {
                  type: 'element' as const,
                  tag: 'text' as const,
                  props: { tone: 'muted' as const, size: 'sm' as const },
                  children: [
                    text(
                      'Original signed event not found. Refresh to check again.',
                    ),
                  ],
                },
              ]),
        ],
      },
    };
  } finally {
    pool.close([...opened]);
    pool.destroy();
  }
}
