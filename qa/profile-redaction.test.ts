import assert from 'node:assert/strict';
import { test } from 'node:test';
import { redactProfileValue } from '../lib/profile-redaction';

test('ISO assessment and competition dates survive contact redaction', () => {
  const profile = {
    assessmentEvidence: { confirmedAt: '2026-10-08T12:05:16.934Z' },
    competitionResults: [{ date: '2026-04-22', title: 'Кубок +79991234567' }],
    freshAt: '2026-10-08T12:05:16.934Z',
    lastGradeChange: null,
    fspConnection: { syncedAt: '2026-10-09T20:01:12.345Z' },
  };
  const publicProfile = redactProfileValue(profile);
  assert.equal(
    publicProfile.assessmentEvidence.confirmedAt,
    profile.assessmentEvidence.confirmedAt,
  );
  assert.equal(publicProfile.competitionResults[0].date, '2026-04-22');
  assert.equal(publicProfile.freshAt, profile.freshAt);
  assert.equal(publicProfile.lastGradeChange, null);
  assert.equal(
    publicProfile.fspConnection.syncedAt,
    profile.fspConnection.syncedAt,
  );
  assert.equal(
    publicProfile.competitionResults[0].title,
    'Кубок [контакт скрыт]',
  );
  assert.equal(profile.competitionResults[0].title, 'Кубок +79991234567');
});

test('date fields cannot bypass contact protection with a phone, URL or mixed text', () => {
  const publicProfile = redactProfileValue({
    bio: 'Пишите person@example.test, +79991234567 или https://example.test/me',
    confirmedAt: '+79991234567',
    date: '2026-04-22 person@example.test',
    freshAt: 'https://example.test/me',
    nested: [{ description: 'Телефон: 79991234567' }],
    score: 84,
  });
  const serialized = JSON.stringify(publicProfile);
  assert(!serialized.includes('79991234567'));
  assert(!serialized.includes('example.test'));
  assert.equal(publicProfile.confirmedAt, '[контакт скрыт]');
  assert.equal(publicProfile.score, 84);
});
