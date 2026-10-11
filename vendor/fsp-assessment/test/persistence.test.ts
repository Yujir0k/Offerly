import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { Store } from '../src/store.js';
test('SQLite retains users across closing and reopening', () => {
  const directory = mkdtempSync(join(tmpdir(), 'fsp-storage-'));
  const file = join(directory, 'state.sqlite');
  try {
    const first = new Store(file);
    const user = first.createUser('a@example.org', 'Password2026!', 'A', 'candidate', true);
    first.close();
    const second = new Store(file);
    assert.equal(second.authenticate('a@example.org', 'Password2026!')?.id, user.id);
    second.close();
  } finally {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    for (const name of readdirSync(directory)) rmSync(join(directory, name));
    rmdirSync(directory);
  }
});
