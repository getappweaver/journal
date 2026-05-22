import type { WebNodeRoot } from '@src/web/ui-schema';

import type { JournalEntry } from '../../../db';

import { renderJournalTodayComponent } from '../component';

type RenderJournalTodayWebProps = {
  alias: string;
  entries: JournalEntry[];
  recentEntries: JournalEntry[];
  editingEntry: JournalEntry | null;
};

export function renderJournalTodayWeb(
  params: RenderJournalTodayWebProps,
): WebNodeRoot {
  return renderJournalTodayComponent(params);
}
