import { join } from 'path';

import { Database, type Database as DatabaseType } from 'bun:sqlite';

export type JournalEntryStatus = 'private' | 'published';

export type JournalEntry = {
  id: number;
  title: string | null;
  body: string;
  tags: string[];
  status: JournalEntryStatus;
  metadata: Record<string, unknown>;
  created_at: number;
  updated_at: number;
};

export type CreateJournalEntryInput = {
  title: string | null;
  body: string;
  tags: string[];
  status: JournalEntryStatus;
  metadata: Record<string, unknown>;
};

type UpdateJournalEntryProps = {
  db: DatabaseType;
  id: number;
  input: CreateJournalEntryInput;
};

export type JournalDraft = {
  id: number;
  input: CreateJournalEntryInput;
  original_prompt: string;
  created_at: number;
};

type EntryRow = {
  id: number;
  title: string | null;
  body: string;
  tags: string;
  status: JournalEntryStatus;
  metadata: string;
  created_at: number;
  updated_at: number;
};

type DraftRow = {
  id: number;
  input_json: string;
  original_prompt: string;
  created_at: number;
};

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;

    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      !Array.isArray(parsed)
    ) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return {};
  }

  return {};
}

function rowToEntry(row: EntryRow): JournalEntry {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    tags: row.tags ? row.tags.split(',').filter(Boolean) : [],
    status: row.status,
    metadata: parseJsonObject(row.metadata),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function rowToDraft(row: DraftRow): JournalDraft | null {
  try {
    return {
      id: row.id,
      input: JSON.parse(row.input_json) as CreateJournalEntryInput,
      original_prompt: row.original_prompt,
      created_at: row.created_at,
    };
  } catch {
    return null;
  }
}

export function createJournalTables(db: DatabaseType): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS journal_entries (
      id         INTEGER PRIMARY KEY,
      title      TEXT,
      body       TEXT NOT NULL,
      tags       TEXT NOT NULL DEFAULT '',
      status     TEXT NOT NULL DEFAULT 'private',
      metadata   TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS journal_config (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS journal_drafts (
      id              INTEGER PRIMARY KEY,
      input_json      TEXT NOT NULL,
      original_prompt TEXT NOT NULL,
      created_at      INTEGER NOT NULL
    )
  `);

  db.run(
    'CREATE INDEX IF NOT EXISTS idx_journal_entries_created_at ON journal_entries(created_at)',
  );
}

export function createJournalEntry(
  db: DatabaseType,
  input: CreateJournalEntryInput,
): JournalEntry {
  const now = Date.now();

  const info = db.run(
    `INSERT INTO journal_entries
      (title, body, tags, status, metadata, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      input.title,
      input.body,
      input.tags.join(','),
      input.status,
      JSON.stringify(input.metadata),
      now,
      now,
    ],
  );

  return getJournalEntry(db, Number(info.lastInsertRowid))!;
}

export function updateJournalEntry({
  db,
  id,
  input,
}: UpdateJournalEntryProps): JournalEntry | null {
  const now = Date.now();

  const info = db
    .prepare(
      `UPDATE journal_entries
       SET title = ?, body = ?, tags = ?, status = ?, metadata = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(
      input.title,
      input.body,
      input.tags.join(','),
      input.status,
      JSON.stringify(input.metadata),
      now,
      id,
    );

  return info.changes > 0 ? getJournalEntry(db, id) : null;
}

export function deleteJournalEntry(db: DatabaseType, id: number): boolean {
  const info = db.prepare('DELETE FROM journal_entries WHERE id = ?').run(id);

  return info.changes > 0;
}

export function getJournalEntry(
  db: DatabaseType,
  id: number,
): JournalEntry | null {
  const row = db
    .prepare('SELECT * FROM journal_entries WHERE id = ?')
    .get(id) as EntryRow | undefined;

  return row ? rowToEntry(row) : null;
}

export function listJournalEntries(
  db: DatabaseType,
  limit: number,
): JournalEntry[] {
  const rows = db
    .prepare(
      'SELECT * FROM journal_entries ORDER BY created_at DESC, id DESC LIMIT ?',
    )
    .all(limit) as EntryRow[];

  return rows.map(rowToEntry);
}

export function listTodayJournalEntries(db: DatabaseType): JournalEntry[] {
  const start = new Date();
  start.setHours(0, 0, 0, 0);

  const rows = db
    .prepare(
      'SELECT * FROM journal_entries WHERE created_at >= ? ORDER BY created_at DESC, id DESC',
    )
    .all(start.getTime()) as EntryRow[];

  return rows.map(rowToEntry);
}

export function searchJournalEntries(
  db: DatabaseType,
  query: string,
  limit: number,
): JournalEntry[] {
  const like = `%${query}%`;

  const rows = db
    .prepare(
      `SELECT * FROM journal_entries
       WHERE body LIKE ? OR title LIKE ? OR tags LIKE ?
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
    )
    .all(like, like, like, limit) as EntryRow[];

  return rows.map(rowToEntry);
}

export function storeJournalDraft(
  db: DatabaseType,
  input: CreateJournalEntryInput,
  originalPrompt: string,
): JournalDraft {
  const now = Date.now();

  const info = db.run(
    'INSERT INTO journal_drafts (input_json, original_prompt, created_at) VALUES (?, ?, ?)',
    [JSON.stringify(input), originalPrompt, now],
  );

  return getJournalDraft(db, Number(info.lastInsertRowid))!;
}

export function getJournalDraft(
  db: DatabaseType,
  id: number,
): JournalDraft | null {
  const row = db
    .prepare('SELECT * FROM journal_drafts WHERE id = ?')
    .get(id) as DraftRow | undefined;

  return row ? rowToDraft(row) : null;
}

export function listJournalDrafts(db: DatabaseType): JournalDraft[] {
  const rows = db
    .prepare('SELECT * FROM journal_drafts ORDER BY created_at DESC, id DESC')
    .all() as DraftRow[];

  return rows.map(rowToDraft).filter((draft) => draft !== null);
}

export function deleteJournalDraft(db: DatabaseType, id: number): boolean {
  const info = db.prepare('DELETE FROM journal_drafts WHERE id = ?').run(id);

  return info.changes > 0;
}

export function getJournalConfig(db: DatabaseType): Record<string, string> {
  const rows = db
    .prepare('SELECT key, value FROM journal_config ORDER BY key')
    .all() as {
    key: string;
    value: string;
  }[];

  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

export function setDefaultJournalConfig(db: DatabaseType): void {
  const defaults: Record<string, string> = {
    dailyReminderEnabled: 'false',
    gitHookEnabled: 'false',
    postCommitPromptEnabled: 'false',
  };

  for (const [key, value] of Object.entries(defaults)) {
    db.run('INSERT OR IGNORE INTO journal_config (key, value) VALUES (?, ?)', [
      key,
      value,
    ]);
  }
}

export function openDb(): Database {
  const db = new Database(join(import.meta.dir, 'db.sqlite'), { strict: true });

  db.run('PRAGMA foreign_keys = ON');
  db.run('PRAGMA journal_mode=WAL');
  createJournalTables(db);
  setDefaultJournalConfig(db);

  return db;
}
