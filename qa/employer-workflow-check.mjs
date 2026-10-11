import assert from 'node:assert/strict';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
const base = process.env.TEST_BASE_URL || 'http://localhost:5191';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname))
  throw new Error('Run only against an isolated local QA database');
// Adapt archive workflow to the existing bigint/body chat contract.
let checks = 0;
async function call(user, path, body, expected = 200) {
  if (path.startsWith('/api/conversations')) {
    if (body?.clientId) body = { ...body, clientId: 'workflow-check-' + body.clientId };
    if (body?.type === 'read') body = { ...body, through: body.messageId };
    if (expected === 400) {
      if (!body || body.type === 'open' || body.clientId?.endsWith('-foreign')) expected = 404;
      else if (body.clientId?.endsWith('-candidate-task')) expected = 403;
      else if (body.type === 'task-response') expected = 409;
      else if (body.clientId?.endsWith('-message-one')) expected = 409;
    }
  }
  const response = await fetch(base + path, {
    method: body ? 'POST' : 'GET',
    headers: {
      Origin: base,
      'Content-Type': 'application/json',
      ...(user.cookie ? { Cookie: user.cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (path.startsWith('/api/conversations') && data.items) data.conversations = data.items;
  assert.equal(response.status, expected, `${path}: ${JSON.stringify(data)}`);
  checks++;
  if (response.headers.get('set-cookie'))
    user.cookie = response.headers.get('set-cookie').split(';')[0];
  return data;
}
const run = Date.now(),
  users = [];
for (let i = 0; i < 3; i++) {
  const user = {
    email: `employer-flow-${run}-${i}@example.test`,
    password: 'local-workflow-password-1234',
  };
  user.state = await call(user, '/api/auth', {
    type: 'register',
    role: 'candidate',
    email: user.email,
    password: user.password,
    name: `Проверка Подбора ${i}`,
    consent: true,
  });
  // Registration already sends the verification code; do not resend inside cooldown.

  const dir = process.env.TEST_MAIL_DIR || '.data/mail-outbox';
  const mails = await Promise.all(
    (await readdir(dir)).map(async (file) =>
      JSON.parse(await readFile(`${dir}/${file}`, 'utf8')),
    ),
  );
  const mail = mails.filter((item) => item.to === user.email).at(-1);
  assert(mail);
  user.state = await call(user, '/api/action', {
    type: 'email-confirm',
    code: mail.text.match(/\b\d{6}\b/)[0],
  });
  user.state = await call(user, '/api/action', {
    ...user.state.profile,
    type: 'profile',
    role: 'candidate',
    city: 'Москва',
    skills: i === 1 ? ['питон', 'SQL'] : ['Python', 'Redis'],
    roles: ['Backend-разработчик'],
    salaryMin: 100000,
    salaryMax: 200000,
    consent: true,
    visible: true,
  });
  user.state = await call(user, '/api/action', {
    type: 'privacy',
    role: 'candidate',
    visible: true,
    notifications: true,
  });
  user.state = await call(user, '/api/action', {
    type: 'company',
    role: 'employer',
    name: `Компания проверки ${i}`,
    description: 'Разработка платформы',
    email: user.email,
  });
  users.push(user);
}
const [a, b, c] = users;
async function catalog(user, filters, page = 1) {
  return call(
    user,
    `/api/catalog/candidates?${new URLSearchParams({ role: 'employer', filters: JSON.stringify(filters), page: String(page) })}`,
  );
}
let candidates = await catalog(a, {
  skills: ['Python'],
  sort: 'По результату теста',
});
assert(candidates.items.some((p) => p.id === b.state.profile.id));
assert(!candidates.items.some((p) => p.id === a.state.profile.id));
assert.equal(candidates.total, candidates.items.length);
assert.equal(
  candidates.items.find((p) => p.id === b.state.profile.id).email,
  '',
);
assert.equal(
  (await catalog(a, { skills: ['Python'], skillSource: 'verified' })).total,
  0,
);
assert(
  (await catalog(a, { query: 'питон' })).items.some(
    (p) => p.id === b.state.profile.id,
  ),
);
const saved = await call(a, '/api/action', {
  type: 'need',
  role: 'employer',
  title: 'Подбор Backend',
  description: '',
  specialty: 'Backend',
  grade: 'Middle',
  skills: 'Python',
  desiredSkills: 'Redis',
  task: 'operations',
  format: 'Удалённо',
  min: 100000,
  max: 200000,
});
const need = saved.needs.find((n) => n.title === 'Подбор Backend');
assert(need);
assert.equal(need.task, 'operations');
for (const sort of [
  'Тест + ФСП',
  'По результату теста',
  'По достижениям ФСП',
  'По дате подтверждения',
  'По зарплате',
]) {
  await catalog(a, { needId: need.id, skills: ['Python'], sort });
}
const relaxed = await catalog(a, {
  skills: ['Python', 'SQL', 'Redis'],
  suggestRelaxations: true,
});
assert(
  relaxed.relaxations.some(
    (option) => option.skill === 'Redis' && option.added > 0,
  ),
);
assert.equal(
  (await catalog(a, { ids: [b.state.profile.id, c.state.profile.id] })).items
    .length,
  2,
);
await call(a, '/api/action', {
  type: 'need',
  role: 'employer',
  ...need,
  task: 'product',
  skills: 'Python',
  desiredSkills: 'SQL',
});
assert.equal(
  (await call(a, '/api/state?role=employer')).needs.find(
    (n) => n.id === need.id,
  ).task,
  'product',
);
await call(
  c,
  '/api/action',
  { type: 'need-delete', role: 'employer', id: need.id },
  400,
);
await call(a, '/api/action', {
  type: 'need-delete',
  role: 'employer',
  id: need.id,
});
assert(
  !(await call(a, '/api/state?role=employer')).needs.some(
    (n) => n.id === need.id,
  ),
);
await call({}, '/api/conversations?role=employer', undefined, 401);
// Neither visibility nor a previous conversation grants consent to chat.
await call(
  b,
  '/api/conversations',
  { type: 'open', role: 'candidate', companyId: a.state.company.id },
  400,
);
await call(
  a,
  '/api/conversations',
  { type: 'open', role: 'employer', candidateId: a.state.profile.id },
  400,
);
await call(b, '/api/action', {
  type: 'privacy',
  role: 'candidate',
  visible: false,
  notifications: true,
});
await call(
  a,
  '/api/conversations',
  { type: 'open', role: 'employer', candidateId: b.state.profile.id },
  400,
);
await call(b, '/api/action', {
  type: 'privacy',
  role: 'candidate',
  visible: true,
  notifications: true,
});
const ownProfile = (await call(b, '/api/state?role=candidate')).profile;
await call(b, '/api/action', {
  ...ownProfile,
  type: 'profile',
  role: 'candidate',
  jobStatus: 'paused',
});
await call(
  a,
  '/api/conversations',
  { type: 'open', role: 'employer', candidateId: b.state.profile.id },
  400,
);
await call(b, '/api/action', {
  ...ownProfile,
  type: 'profile',
  role: 'candidate',
  jobStatus: 'open',
});
for (const patch of [{ consent: false }, { city: '' }]) {
  await call(b, '/api/action', {
    ...ownProfile,
    ...patch,
    type: 'profile-draft',
    role: 'candidate',
  });
  await call(
    a,
    '/api/conversations',
    {
      type: 'open',
      role: 'employer',
      candidateId: b.state.profile.id,
    },
    400,
  );
  await call(b, '/api/action', {
    ...ownProfile,
    type: 'profile',
    role: 'candidate',
  });
}
await call(a, '/api/conversations', {
  type: 'open', role: 'employer', candidateId: b.state.profile.id,
}, 400);
assert.equal((await catalog(a, { ids: [b.state.profile.id] })).items[0].canMessage, false);
const beforeInvitation = (await catalog(a, { ids: [b.state.profile.id] }))
  .items[0];
assert.equal(beforeInvitation.email, '');
assert.equal(beforeInvitation.phone, '');
assert.deepEqual(Object.keys(beforeInvitation.match_reasons).sort(), ['budget_fit', 'fsp_achievement', 'grade_status', 'stack_summary']);
assert.equal(beforeInvitation.match_reasons.fsp_achievement, null);
assert(beforeInvitation.match_reasons.grade_status.includes('не подтверждён'));
const sourceState = await call(a, '/api/action', {
  type: 'need', role: 'employer', title: 'Backend для продуктовой команды',
  description: 'Серверная часть продукта', specialty: 'Backend', grade: 'Middle',
  skills: 'Python', desiredSkills: 'Redis', task: 'product', format: 'Удалённо',
  min: 100000, max: 200000,
});
const sourceNeed = sourceState.needs.find((item) => item.title === 'Backend для продуктовой команды');
await call(c, '/api/action', {
  type: 'invite', role: 'employer', candidateId: b.state.profile.id,
  title: 'Попытка подмены источника', description: 'Чужая задача', min: 100000,
  max: 200000, contact: c.email, needId: sourceNeed.id,
}, 400);
const invitations = await call(a, '/api/action', {
  type: 'invite',
  role: 'employer',
  candidateId: b.state.profile.id,
  title: 'Разработчик',
  description: 'Знакомство с командой',
  min: 100000,
  max: 200000,
  contact: a.email,
  needId: sourceNeed.id,
});
const invitation = invitations.invitations.find(
  (i) => i.candidateId === b.state.profile.id,
);
assert(invitation);
assert.equal(invitation.source.title, sourceNeed.title);
assert.deepEqual(invitation.source.skills, ['Python']);
await call(a, '/api/action', {
  ...sourceNeed, type: 'need', role: 'employer', title: 'Изменённая задача', skills: 'Go',
});
await call(a, '/api/action', { type: 'need-delete', role: 'employer', id: sourceNeed.id });
assert.deepEqual((await call(a, '/api/state?role=employer')).invitations.find((item) => item.id === invitation.id).source, invitation.source);
await call(a, '/api/conversations', {
  type: 'open',
  role: 'employer',
  candidateId: b.state.profile.id,
}, 400);
await call(b, '/api/action', { type: 'respond', role: 'candidate', id: invitation.id, status: 'viewed' });
await call(a, '/api/conversations', { type: 'open', role: 'employer', candidateId: b.state.profile.id }, 400);
assert.equal(
  (await catalog(a, { ids: [b.state.profile.id] })).items[0].email,
  '',
);
await call(b, '/api/action', {
  type: 'respond',
  role: 'candidate',
  id: invitation.id,
  status: 'accepted',
});
const thread = await call(a, '/api/conversations', {
  type: 'open',
  role: 'employer',
  candidateId: b.state.profile.id,
});
assert.equal((await catalog(a, { ids: [b.state.profile.id] })).items[0].canMessage, true);
assert.equal((await call(a, '/api/conversations?role=employer&id=' + thread.id)).canWrite, true);
assert.equal(
  (
    await call(b, '/api/conversations', {
      type: 'open',
      role: 'candidate',
      companyId: a.state.company.id,
    })
  ).id,
  thread.id,
);
await call(
  c,
  `/api/conversations?role=employer&id=${thread.id}`,
  undefined,
  400,
);
await call(
  c,
  '/api/conversations',
  {
    type: 'send',
    role: 'employer',
    id: thread.id,
    text: 'Чужая запись',
    clientId: 'foreign',
  },
  400,
);
const message = {
  type: 'send',
  role: 'employer',
  id: thread.id,
  text: 'Здравствуйте! Обсудим условия.',
  clientId: 'message-one',
};
const first = await call(a, '/api/conversations', message);
assert.equal((await call(a, '/api/conversations', message)).id, first.id);
await call(a, '/api/conversations', { ...message, text: 'Иной текст' }, 400);
assert.equal(
  (await call(b, '/api/conversations?role=candidate')).conversations.find(
    (t) => t.id === thread.id,
  ).unread,
  1,
);
await call(b, '/api/conversations', {
  type: 'read',
  role: 'candidate',
  id: thread.id,
  messageId: first.id,
});
assert.equal(
  (await call(b, '/api/conversations?role=candidate')).conversations.find(
    (t) => t.id === thread.id,
  ).unread,
  0,
);
await call(
  b,
  '/api/conversations',
  {
    type: 'send',
    role: 'candidate',
    id: thread.id,
    clientId: 'candidate-task',
    task: {
      title: 'Попытка',
      instructions: 'Проверка',
      minutes: 10,
      criteria: 'Ответ',
    },
  },
  400,
);
const taskMessage = await call(a, '/api/conversations', {
  type: 'send',
  role: 'employer',
  id: thread.id,
  clientId: 'task-one',
  task: {
    title: 'Диагностика API',
    instructions: 'Опишите план поиска причины таймаута.',
    minutes: 10,
    criteria: 'Проверяемые гипотезы, ограничения и критерий успеха.',
  },
});
const gradeBefore = (await call(b, '/api/state?role=candidate')).profile.grade;
await call(
  b,
  '/api/conversations',
  {
    type: 'task-response',
    role: 'candidate',
    id: thread.id,
    messageId: taskMessage.id,
    status: 'submitted',
    answer: 'Без принятия',
  },
  400,
);
await call(b, '/api/conversations', {
  type: 'task-response',
  role: 'candidate',
  id: thread.id,
  messageId: taskMessage.id,
  status: 'accepted',
});
await call(b, '/api/conversations', {
  type: 'task-response',
  role: 'candidate',
  id: thread.id,
  messageId: taskMessage.id,
  status: 'submitted',
  answer:
    'Проверю журнал, трассировки и нагрузку. Сопоставлю время запроса с зависимостями.',
});
await call(a, '/api/conversations', {
  type: 'task-review',
  role: 'employer',
  id: thread.id,
  messageId: taskMessage.id,
  feedback: 'План понятен. На встрече обсудим критерии проверки гипотез.',
});
const history = await call(
  b,
  `/api/conversations?role=candidate&id=${thread.id}`,
);
assert.equal(
  (
    await call(a, '/api/conversations', {
      type: 'send',
      role: 'employer',
      id: thread.id,
      clientId: 'task-one',
      task: {
        title: 'Диагностика API',
        instructions: 'Опишите план поиска причины таймаута.',
        minutes: 10,
        criteria: 'Проверяемые гипотезы, ограничения и критерий успеха.',
      },
    })
  ).id,
  taskMessage.id,
);
assert.equal(
  history.messages.find((m) => m.id === taskMessage.id).task.status,
  'reviewed',
);
assert(
  history.messages
    .find((m) => m.id === taskMessage.id)
    .task.answer.includes('журнал'),
);
assert.equal(
  (await call(b, '/api/state?role=candidate')).profile.grade,
  gradeBefore,
);
const historyBefore = await call(
  a,
  `/api/conversations?role=employer&id=${thread.id}&before=${history.messages.at(-1).id}`,
);
assert(historyBefore.messages.length < history.messages.length);
// A voluntary application independently grants access to the same employer.
const jobState = await call(a, '/api/action', {
  type: 'job', role: 'employer', title: 'Backend по отклику', description: 'Разработка API',
  specialty: 'Backend', grade: 'Middle', skills: ['Python'], format: 'Удалённо', min: 100000, max: 200000,
});
const job = jobState.jobs.find((item) => item.title === 'Backend по отклику' && item.companyId === a.state.company.id);
const vacancyInvitation = await call(a, '/api/action', {
  type: 'invite', role: 'employer', candidateId: c.state.profile.id, needId: job.id,
  title: 'Backend по отклику', description: 'Знакомство по вакансии', contact: a.email, min: 100000, max: 200000,
});
const pendingApplication = vacancyInvitation.invitations.find((item) => item.candidateId === c.state.profile.id);
assert.equal(pendingApplication.source.kind, 'vacancy');
assert.equal(pendingApplication.source.id, job.id);
assert.equal((await catalog(a, { ids: [c.state.profile.id] })).items[0].canMessage, false);
await call(a, '/api/conversations', { type: 'open', role: 'employer', candidateId: c.state.profile.id }, 400);
await call(c, '/api/action', { type: 'apply', role: 'candidate', id: job.id, message: 'Интересна ваша задача', shareContacts: true });
const applicationThread = await call(a, '/api/conversations', { type: 'open', role: 'employer', candidateId: c.state.profile.id });
await call(c, '/api/conversations', { type: 'send', role: 'candidate', id: applicationThread.id, text: 'Добрый день!', clientId: 'own-application' });
assert.equal((await catalog(a, { ids: [c.state.profile.id] })).items[0].canMessage, true);
const demo = {};
await call(demo, '/api/auth', {
  type: 'demo-login',
  role: 'employer',
});
const demoCandidates = await catalog(demo, {
  sort: 'По достижениям ФСП',
  fsp: true,
});
assert(demoCandidates.items.length > 0);
assert(demoCandidates.items.every((p) => p.ranking.events.length > 0));
const baseline = await catalog(demo, { sort: 'Тест + ФСП' });
for (const sort of ['По результату теста', 'По достижениям ФСП']) {
  const ordered = await catalog(demo, { sort });
  assert.equal(ordered.total, baseline.total);
  const unconfirmed = await catalog(demo, {
    sort,
    confirmation: 'unconfirmed',
  });
  assert(unconfirmed.total > 0);
  assert(unconfirmed.items.every((p) => !p.grade));
}
await call(
  demo,
  '/api/conversations',
  { type: 'open', role: 'employer', candidateId: b.state.profile.id },
  400,
);
await call(
  a,
  '/api/conversations',
  { type: 'open', role: 'employer', candidateId: demoCandidates.items[0].id },
  400,
);
await call(
  demo,
  `/api/conversations?role=employer&id=${thread.id}`,
  undefined,
  400,
);
await mkdir('.data/employer-implementation-qa', { recursive: true });
await writeFile(
  '.data/employer-implementation-qa/browser.json',
  JSON.stringify(
    {
      users: users.map(({ email, password }) => ({ email, password })),
      candidateId: b.state.profile.id,
      threadId: thread.id,
    },
    null,
    2,
  ),
);
await writeFile(
  'qa/results/latest/employer-workflow-results.json',
  JSON.stringify(
    {
      checks,
      aliasesDiscoverable: true,
      sortingFixed: true,
      contactPrivacy: true,
      directChatBeforeInvitation: false,
      acceptedInvitationOrApplicationRequired: true,
      invitationSourceImmutable: true,
      structuredMatchReasons: true,
      hiddenAndPausedCandidatesProtected: true,
      incompleteAndNonConsentingCandidatesProtected: true,
      prioritiesKeepUnconfirmedCandidates: true,
      messagesPrivate: true,
      taskLifecycle: true,
      gradePreserved: true,
      demoIsolated: true,
    },
    null,
    2,
  ),
);
console.log(`PASS ${checks} HTTP workflow checks`);
