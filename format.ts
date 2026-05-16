import type { JournalDraft, JournalEntry } from './db';

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

function formatTags(tags: string[]): string {
  return tags.length > 0 ? ` #${tags.join(' #')}` : '';
}

export function formatJournalEntry(entry: JournalEntry): string {
  const title = entry.title ? `${entry.title}: ` : '';
  const firstLine = entry.body.split('\n')[0] ?? entry.body;

  return `#${entry.id} ${title}${firstLine}${formatTags(entry.tags)} (${formatDate(entry.created_at)})`;
}

export function formatJournalEntries(
  entries: JournalEntry[],
  empty: string,
): string {
  if (entries.length === 0) {
    return empty;
  }

  return entries.map(formatJournalEntry).join('\n');
}

export function formatJournalDraft(draft: JournalDraft, cmd: string): string {
  const title = draft.input.title ? `${draft.input.title}\n\n` : '';

  const tags =
    draft.input.tags.length > 0
      ? `\n\nTags: ${draft.input.tags.join(', ')}`
      : '';

  return [
    'Journal draft:',
    '',
    `${title}${draft.input.body}${tags}`,
    '',
    `Draft ID: ${draft.id}`,
    `Accept: ${cmd} accept ${draft.id}`,
    `Decline: ${cmd} decline ${draft.id}`,
  ].join('\n');
}

export function formatJournalDrafts(
  drafts: JournalDraft[],
  cmd: string,
): string {
  if (drafts.length === 0) {
    return 'No journal drafts.';
  }

  return drafts.map((draft) => formatJournalDraft(draft, cmd)).join('\n\n');
}
