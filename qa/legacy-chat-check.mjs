import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const fixturePath = '.data/task-match-qa/legacy-chat.json';
if (process.argv.includes('--seed')) {
  // Only seed the isolated QA checkout database, with the server stopped.
  const target = path.resolve('.data/task-match-qa/postgres');
  assert.equal(
    target,
    path.join(process.cwd(), '.data', 'task-match-qa', 'postgres'),
  );
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite(target);
  try {
    const { users } = JSON.parse(
      await readFile('.data/employer-implementation-qa/browser.json', 'utf8'),
    );
    const { rows } = await db.query(
      `
      SELECT u.email AS employer,cu.email AS candidate,c.id AS company_id,p.id AS candidate_id,u.id AS sender
      FROM companies c JOIN users u ON u.id=c.owner_id CROSS JOIN candidate_profiles p
      JOIN users cu ON cu.id=p.user_id
      WHERE u.email=ANY($1::text[]) AND cu.email=ANY($1::text[]) AND u.id<>cu.id
      AND NOT EXISTS(SELECT 1 FROM invitations i WHERE i.company_id=c.id AND i.candidate_id=p.id AND i.status='accepted')
      AND NOT EXISTS(SELECT 1 FROM applications a JOIN jobs j ON j.id=a.job_id WHERE a.candidate_id=p.id AND j.company_id=c.id)
      LIMIT 1`,
      [users.map((user) => user.email)],
    );
    assert(
      rows.length,
      'A QA pair without accepted invitation or application is required',
    );
    const pair = rows[0];
    const {
      rows: [thread],
    } = await db.query(
      `INSERT INTO conversations(id,company_id,candidate_id)
      VALUES($1,$2,$3) ON CONFLICT(company_id,candidate_id) DO UPDATE SET company_id=excluded.company_id RETURNING id`,
      [crypto.randomUUID(), pair.company_id, pair.candidate_id],
    );
    const messageId = crypto.randomUUID();
    await db.query(
      `INSERT INTO conversation_messages(id,conversation_id,sender_id,sender_role,client_id,payload)
      VALUES($1,$2,$3,'employer',$1,$4)`,
      [
        messageId,
        thread.id,
        pair.sender,
        JSON.stringify({
          text: 'Историческое сообщение до согласия',
          task: {
            title: 'Старая задача',
            instructions: 'Проверка',
            minutes: 10,
            criteria: 'Ответ',
            status: 'offered',
          },
        }),
      ],
    );
    await writeFile(
      fixturePath,
      JSON.stringify(
        {
          employer: users.find((user) => user.email === pair.employer),
          candidate: users.find((user) => user.email === pair.candidate),
          companyId: pair.company_id,
          candidateId: pair.candidate_id,
          threadId: thread.id,
          messageId,
        },
        null,
        2,
      ),
    );
    console.log('Seeded one legacy QA conversation without consent');
  } finally {
    await db.close();
  }
} else {
  const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5174';
  assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
  let checks = 0;
  async function call(user, url, body, status = 200) {
    const response = await fetch(base + url, {
      method: body ? 'POST' : 'GET',
      headers: {
        Origin: base,
        'Content-Type': 'application/json',
        Cookie: user.cookie || '',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json();
    assert.equal(response.status, status, JSON.stringify(data));
    for (const cookie of response.headers.getSetCookie())
      user.cookie = cookie.split(';')[0];
    checks++;
    return data;
  }
  const { employer, candidate, companyId, candidateId, threadId, messageId } =
    fixture;
  for (const user of [employer, candidate])
    await call(user, '/api/auth', {
      type: 'login',
      role: 'candidate',
      email: user.email,
      password: user.password,
    });
  const rejectWrites = async () => {
    for (const [user, role] of [
      [employer, 'employer'],
      [candidate, 'candidate'],
    ]) {
      await call(
        user,
        '/api/conversations',
        { type: 'open', role, candidateId, companyId },
        400,
      );
      const history = await call(
        user,
        `/api/conversations?role=${role}&id=${threadId}`,
      );
      assert.equal(history.canWrite, false);
      assert(history.messages.some((message) => message.id === messageId));
      await call(
        user,
        '/api/conversations',
        {
          type: 'send',
          role,
          id: threadId,
          text: 'Обход согласия',
          clientId: crypto.randomUUID(),
        },
        400,
      );
    }
    await call(
      candidate,
      '/api/conversations',
      {
        type: 'task-response',
        role: 'candidate',
        id: threadId,
        messageId,
        status: 'accepted',
      },
      400,
    );
    await call(
      employer,
      '/api/conversations',
      {
        type: 'task-review',
        role: 'employer',
        id: threadId,
        messageId,
        feedback: 'Обход через задачу',
      },
      400,
    );
  };
  await rejectWrites();
  const state = await call(employer, '/api/action', {
    type: 'invite',
    role: 'employer',
    candidateId,
    title: 'Проверка согласия',
    description: 'Знакомство с командой',
    contact: employer.email,
    min: 100000,
    max: 200000,
  });
  const invitation = state.invitations.find(
    (item) => item.candidateId === candidateId && item.status === 'sent',
  );
  assert(invitation);
  await rejectWrites();
  await call(candidate, '/api/action', {
    type: 'respond',
    role: 'candidate',
    id: invitation.id,
    status: 'viewed',
  });
  await rejectWrites();
  await call(candidate, '/api/action', {
    type: 'respond',
    role: 'candidate',
    id: invitation.id,
    status: 'declined',
  });
  await rejectWrites();
  await writeFile(
    'qa/results/latest/legacy-chat-results.json',
    JSON.stringify(
      {
        checks,
        passed: true,
        oldHistoryReadable: true,
        allWritesBlockedWithoutConsent: true,
        statuses: ['none', 'sent', 'viewed', 'declined'],
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`PASS ${checks} legacy conversation HTTP checks`);
}
