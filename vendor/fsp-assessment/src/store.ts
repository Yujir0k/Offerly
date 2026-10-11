import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import type { AccountRole } from './domain.js';

export interface User {
  id: string;
  email: string;
  name: string;
  role: AccountRole;
  verified: boolean;
  consent: boolean;
  contacts: string;
  fspId: string;
  fspVerified: boolean;
  stack: string[];
}
interface StoredUser extends User {
  passwordHash: string;
  salt: string;
}
/** Embedded persistence for local use; all collections remain outside version control. */
export class Store {
  readonly db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS records (collection TEXT NOT NULL, id TEXT NOT NULL, owner TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(collection,id));
      CREATE INDEX IF NOT EXISTS records_owner ON records(collection,owner);
      `);
  }
  get<T>(collection: string, id: string): T | null {
    const row = this.db
      .prepare('SELECT body FROM records WHERE collection=? AND id=?')
      .get(collection, id);
    return row ? (JSON.parse(String(row.body)) as T) : null;
  }
  list<T>(collection: string, owner?: string): T[] {
    const rows =
      owner === undefined
        ? this.db.prepare('SELECT body FROM records WHERE collection=?').all(collection)
        : this.db
            .prepare('SELECT body FROM records WHERE collection=? AND owner=?')
            .all(collection, owner);
    return rows.map((row) => JSON.parse(String(row.body)) as T);
  }
  save(collection: string, id: string, owner: string, body: unknown): void {
    this.db
      .prepare(
        'INSERT INTO records(collection,id,owner,body) VALUES(?,?,?,?) ON CONFLICT(collection,id) DO UPDATE SET owner=excluded.owner,body=excluded.body',
      )
      .run(collection, id, owner, JSON.stringify(body));
  }
  remove(collection: string, id: string): void {
    this.db.prepare('DELETE FROM records WHERE collection=? AND id=?').run(collection, id);
  }
  createUser(
    email: string,
    password: string,
    name: string,
    role: AccountRole,
    verified = false,
  ): User {
    if (this.list<StoredUser>('users').some((user) => user.email === email.toLowerCase()))
      throw new Error('Адрес уже зарегистрирован');
    const salt = randomBytes(16).toString('hex');
    const user: StoredUser = {
      id: randomUUID(),
      email: email.toLowerCase(),
      name,
      role,
      verified,
      consent: true,
      contacts: email.toLowerCase(),
      fspId: '',
      fspVerified: false,
      stack: [],
      salt,
      passwordHash: scryptSync(password, salt, 64).toString('hex'),
    };
    this.save('users', user.id, user.id, user);
    return this.publicUser(user);
  }
  authenticate(email: string, password: string): User | null {
    const user = this.list<StoredUser>('users').find((item) => item.email === email.toLowerCase());
    const salt = user?.salt ?? 'missing-user';
    const computed = scryptSync(password, salt, 64);
    if (
      !user ||
      !timingSafeEqual(computed, Buffer.from(user.passwordHash, 'hex')) ||
      !user.verified
    )
      return null;
    return this.publicUser(user);
  }
  publicUser(user: User): User {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      verified: user.verified,
      consent: user.consent,
      contacts: user.contacts,
      fspId: user.fspId,
      fspVerified: user.fspVerified,
      stack: user.stack,
    };
  }
  updateUser(id: string, fields: Partial<User>): User {
    const user = this.get<StoredUser>('users', id);
    if (!user) throw new Error('Пользователь не найден');
    const updated = { ...user, ...fields, id: user.id, role: user.role };
    this.save('users', id, id, updated);
    return this.publicUser(updated);
  }
  session(user: User): string {
    const token = randomBytes(32).toString('hex');
    this.save('sessions', createHash('sha256').update(token).digest('hex'), user.id, {
      userId: user.id,
      expires: Date.now() + 8 * 3600_000,
    });
    return token;
  }
  sessionUser(token: string): User | null {
    const record = this.get<{ userId: string; expires: number }>(
      'sessions',
      createHash('sha256').update(token).digest('hex'),
    );
    if (!record || record.expires < Date.now()) return null;
    const user = this.get<User>('users', record.userId);
    return user ? this.publicUser(user) : null;
  }
  audit(actor: string, action: string, object: string): void {
    const id = randomUUID();
    this.save('audit', id, actor, { id, actor, action, object, at: new Date().toISOString() });
  }
  close(): void {
    this.db.close();
  }
}
