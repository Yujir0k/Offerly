import type {
  Assessment,
  CustomCase,
  Need,
  Track,
  Skill,
  Question,
  ExperimentInput,
  LabControl,
  Plan,
} from './domain.js';
import type { User } from './store.js';
import {
  brand,
  icon,
  heading,
  empty,
  theoryQuestions,
  experimentHtml,
  resultHtml,
  landingHtml,
} from './presentation.js';

type FamilyInfo = { id: string; trackId: string; title: string; skills: string[] };
type Catalog = {
  families: FamilyInfo[];
  tracks: Track[];
  skills: Skill[];
  grades: string[];
  development: boolean;
  liveEnabled: boolean;
  profiles: Record<string, { name: string }>;
};
const root = document.querySelector<HTMLDivElement>('#app')!;
const notice = document.querySelector<HTMLDivElement>('#notice')!;
let catalog: Catalog;
let user: User | null = null;
let tab = 'assessments';
let publicPage =
  location.pathname === '/login'
    ? 'login'
    : location.pathname.startsWith('/register')
      ? 'register'
      : 'landing';
let employerRegistration = location.pathname === '/register/employer';
let selected: Assessment | null = null;
let assessments: Assessment[] = [];
let historyLimit = 8;
let needs: Need[] = [];
let cases: CustomCase[] = [];
let caseVariant: {
  id: string;
  caseId: string;
  title: string;
  context: string;
  constraints: string;
  deliverable: string;
  materials: { name: string; content: string }[];
  questions: Question[];
  mode: string;
} | null = null;
let noticeTimer: ReturnType<typeof setTimeout>;
let busy = false;
let lastView = '';
const recommendationDrafts = new Map<string, string>();
const esc = (value: unknown) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  );
const trackName = (id: string) => catalog.tracks.find((track) => track.id === id)?.name ?? id;
const skillName = (id: string) => catalog.skills.find((skill) => skill.id === id)?.name ?? id;
const statusLabel = (status: string) =>
  ({
    draft: 'Черновик',
    technical: 'Опубликован',
    sent: 'Отправлено',
    viewed: 'Просмотрено',
    accepted: 'Принято',
    declined: 'Отклонено',
    pending: 'Ожидает проверки',
    submitted: 'На проверке',
    approved: 'Проверено экспертом',
    needs_revision: 'Требует доработки',
  })[status] ?? status;
const opts = (items: { value: string; text: string }[], current = '') =>
  items
    .map(
      (item) =>
        `<option value="${esc(item.value)}" ${item.value === current ? 'selected' : ''}>${esc(item.text)}</option>`,
    )
    .join('');
const trackOptions = (current = '') =>
  opts(
    catalog.tracks.map((track) => ({ value: track.id, text: track.name })),
    current,
  );
const gradeOptions = () =>
  opts(
    catalog.grades.map((value) => ({ value, text: value })),
    'Middle',
  );
const modeOptions = () =>
  opts(
    Object.entries(catalog.profiles).map(([value, profile]) => ({ value, text: profile.name })),
    'local',
  );
function toast(message: string): void {
  notice.textContent = message;
  notice.style.display = 'block';
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => {
    notice.style.display = 'none';
  }, 9000);
}
async function api<T>(path: string, method = 'GET', data?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Platform-Request': '1' },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  const result = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(result.error ?? 'Ошибка запроса');
  return result;
}

function familyOptions(trackId: string): string {
  return opts(
    (catalog.families ?? [])
      .filter((family) => family.trackId === trackId)
      .map((family) => ({ value: family.id, text: family.title })),
  );
}
function needFamilies(trackId: string): string {
  return (
    '<h3>Семейства проверки</h3>' +
    (catalog.families ?? [])
      .filter((family) => family.trackId === trackId)
      .map(
        (family) =>
          `<label class="choice"><input type="checkbox" name="familyIds" value="${esc(family.id)}" checked>${esc(family.title)}</label>`,
      )
      .join('')
  );
}
function renderControls(controls: LabControl[]): string {
  return controls
    .map((control) =>
      control.type === 'multiselect'
        ? `<fieldset><legend>${esc(control.label)}</legend>${control.options.map((option) => `<label class="choice"><input type="checkbox" name="plan:${esc(control.id)}" value="${esc(option.value)}" ${Array.isArray(control.initial) && control.initial.includes(option.value) ? 'checked' : ''}>${esc(option.label)}</label>`).join('')}<p class="muted">${esc(control.help)}</p></fieldset>`
        : `<label>${esc(control.label)}<select name="plan:${esc(control.id)}" data-plan-type="${control.type}">${
            control.type === 'number'
              ? opts(
                  control.values.map((item) => ({ value: String(item), text: String(item) })),
                  String(control.initial),
                )
              : opts(
                  control.options.map((option) => ({ value: option.value, text: option.label })),
                  String(control.initial),
                )
          }</select></label><p class="muted">${esc(control.help)}</p>`,
    )
    .join('');
}
function readPlan(form: FormData, controls: LabControl[]): Plan {
  return Object.fromEntries(
    controls.map((control) => [
      control.id,
      control.type === 'multiselect'
        ? form.getAll('plan:' + control.id).map(String)
        : control.type === 'number'
          ? Number(form.get('plan:' + control.id))
          : String(form.get('plan:' + control.id)),
    ]),
  );
}
function draftKey(): string {
  return `offerly:draft:${user?.id}:${selected?.id}:${selected?.stage}`;
}
function saveDraft(): void {
  if (!selected || selected.result) return;
  const fields: Record<string, string[]> = {};
  for (const form of root.querySelectorAll<HTMLFormElement>('#answers, #experiment, #submit')) {
    for (const [name, value] of new FormData(form)) (fields[name] ??= []).push(String(value));
  }
  try {
    localStorage.setItem(draftKey(), JSON.stringify(fields));
    const label = root.querySelector('.draft-status');
    if (label) label.innerHTML = `${icon('check')}Черновик сохранён в браузере`;
  } catch {
    const label = root.querySelector('.draft-status');
    if (label) label.textContent = 'Сохранение черновика недоступно';
  }
}
function restoreDraft(): void {
  if (!selected || selected.result) return;
  try {
    const stored = localStorage.getItem(draftKey());
    if (!stored) return;
    const fields = JSON.parse(stored) as Record<string, string[]>;
    for (const field of root.querySelectorAll<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >('#answers input, #experiment input, #experiment select, #submit textarea')) {
      const values = fields[field.name];
      if (!values || !Array.isArray(values)) continue;
      if (field instanceof HTMLInputElement && ['checkbox', 'radio'].includes(field.type))
        field.checked = values.includes(field.value);
      else field.value = values[0] ?? '';
    }
    const label = root.querySelector('.draft-status');
    if (label) label.innerHTML = `${icon('check')}Черновик восстановлен`;
  } catch {
    /* Storage is optional; server progress remains available. */
  }
}
function syncSessionUi(): void {
  if (!selected || selected.result) return;
  const answers = root.querySelector('#answer-progress');
  if (answers)
    answers.textContent = `${root.querySelectorAll('#answers input:checked').length} из ${selected.variant.questions.length} ответов`;
  const recommendation = root.querySelector<HTMLTextAreaElement>('#submit textarea');
  const count = root.querySelector('#recommendation-count');
  if (recommendation && count)
    count.textContent = `${recommendation.value.length} символов · минимум 20`;
  const hasExperiment = selected.experiments.some(
    (experiment) => experiment.stage === selected!.stage,
  );
  const next = root.querySelector<HTMLButtonElement>('[data-advance], #submit button');
  if (next) next.disabled = !hasExperiment || busy;
}
function restorePlan(plan: Plan, controls: LabControl[]): void {
  for (const control of controls) {
    const item = plan[control.id];
    if (Array.isArray(item)) {
      for (const checkbox of root.querySelectorAll<HTMLInputElement>(
        `input[name="plan:${control.id}"]`,
      ))
        checkbox.checked = item.includes(checkbox.value);
    } else {
      const field = root.querySelector<HTMLSelectElement>(
        `#experiment [name="plan:${control.id}"]`,
      );
      if (field && item !== undefined) field.value = String(item);
    }
  }
}
function labDataView(data: NonNullable<Assessment['variant']['lab']>['data']): string {
  const columns = Object.keys(data.rows[0] ?? {});
  return `<details><summary>Параметры и данные · ${data.rows.length} строк</summary><div class="parameter-grid">${Object.entries(
    data.parameters,
  )
    .map(([key, value]) => `<div><span>${esc(key)}</span><strong>${esc(value)}</strong></div>`)
    .join(
      '',
    )}</div><label class="data-search">Поиск по данным<input type="search" data-row-search placeholder="ID, значение или сегмент" aria-label="Поиск по данным"></label><div class="table-wrap"><table><thead><tr>${columns.map((column) => `<th>${esc(column)}</th>`).join('')}</tr></thead><tbody>${data.rows
    .map((row) => `<tr>${columns.map((column) => `<td>${esc(row[column])}</td>`).join('')}</tr>`)
    .join(
      '',
    )}</tbody></table></div><p class="muted" data-row-count>Все ${data.rows.length} строк. Полный набор также доступен в JSON.</p></details>`;
}

function questionsHtml(questions: Question[]): string {
  return theoryQuestions(questions);
}
function login(): string {
  if (publicPage === 'landing')
    return landingHtml(catalog.tracks.length, catalog.families.length, catalog.development);
  const registering = publicPage === 'register';
  return `<div class="auth-page"><header class="public-header"><div class="nav-container"><button class="brand-home" data-public="landing" aria-label="Офферли — главная">${brand()}</button><button class="nav-login" data-public="${registering ? 'login' : 'register'}">${registering ? 'Уже есть аккаунт' : 'Создать аккаунт'} ${icon('arrow')}</button></div></header><main class="auth-main"><span class="eyebrow">${registering ? 'НАЧАЛО НОВОЙ ИСТОРИИ' : 'ВАШЕ РАБОЧЕЕ ПРОСТРАНСТВО'}</span><h1>${registering ? (employerRegistration ? 'Соберите свою команду.' : 'Дело начинается с вас.') : 'С возвращением.'}</h1><p>${registering ? 'Расскажите о себе. Дальше — интересные задачи и новые возможности.' : 'Продолжите испытание или найдите подходящих специалистов.'}</p><div class="auth-card card">${registering ? `<form id="register"><label>Имя или компания<input name="name" autocomplete="name" required></label><label>Email<input name="email" type="email" autocomplete="email" required></label><label>Пароль, от 10 символов<input name="password" type="password" autocomplete="new-password" minlength="10" required></label><label>Роль<select name="role"><option value="candidate" ${!employerRegistration ? 'selected' : ''}>Кандидат</option><option value="employer" ${employerRegistration ? 'selected' : ''}>Работодатель</option></select></label><label class="choice"><input name="consent" type="checkbox" required><span>Согласен на обработку и публикацию профиля для подбора</span></label><button>Зарегистрироваться ${icon('arrow')}</button><div id="verification" role="status"></div></form>` : `<form id="login"><label>Email<input type="email" name="email" autocomplete="email" required placeholder="you@company.ru"></label><label>Пароль<input type="password" name="password" autocomplete="current-password" required></label><button>Войти</button></form>`}${catalog.development ? '<div class="auth-demo"><span class="eyebrow">ЛОКАЛЬНАЯ ДЕМОНСТРАЦИЯ</span><div class="actions"><button class="secondary" data-demo="candidate">Кандидат</button><button class="secondary" data-demo="employer">Работодатель</button><button class="secondary" data-demo="admin">Эксперт</button></div></div>' : ''}</div><p class="privacy-note">${icon('lock')}Контакты открываются только с вашего согласия</p></main></div>`;
}
function profile(): string {
  return `${heading('МОЙ ПРОФИЛЬ', user!.role === 'employer' ? 'Ваша команда в Офферли' : 'Расскажите, что вам интересно', 'Контакты и видимость всегда под вашим контролем.')}<div class="profile-grid"><div class="card profile-summary"><div class="avatar-large">${esc(user!.name.slice(0, 2).toUpperCase())}</div><h2>${esc(user!.name)}</h2><p class="muted">${esc(user!.email)}</p><span class="badge ${user!.verified ? 'success' : 'neutral'}">${user!.verified ? 'Email подтверждён' : 'Email не подтверждён'}</span><div class="tags">${user!.stack.map((item) => `<span>${esc(item)}</span>`).join('')}</div><p class="privacy-note">${icon('lock')}Контакты доступны после принятия приглашения</p></div><div class="card"><h2>Основная информация</h2><form id="profile"><div class="row"><label>Имя<input name="name" value="${esc(user!.name)}" required autocomplete="name"></label><label>Контакты<input name="contacts" value="${esc(user!.contacts)}" required placeholder="Email или Telegram"></label></div><label>Стек, через запятую<input name="stack" value="${esc(user!.stack.join(', '))}" placeholder="Python, SQL, PyTorch"></label><label>ID ФСП<input name="fspId" value="${esc(user!.fspId)}"></label><p class="muted">Связь с реестром ещё не подключена. Указанный ID не считается подтверждённым достижением.</p><div class="visibility-box"><label class="choice"><input type="checkbox" name="consent" ${user!.consent ? 'checked' : ''}><span>Показывать профиль работодателям</span></label><p class="muted">Вы решаете, когда обменяться контактами.</p></div><button>Сохранить ${icon('check')}</button></form></div></div>`;
}
function assessmentCard(item: Assessment): string {
  return `<div class="card assessment-card"><div class="section-title"><span class="badge ${item.state === 'submitted' ? 'success' : 'neutral'}">${esc(item.variant.grade)} · ${item.state === 'submitted' ? 'Завершено' : 'В работе'}</span><span class="meta mono">${new Date(item.createdAt).toLocaleDateString('ru-RU')}</span></div><h2>${esc(trackName(item.variant.trackId))}</h2><p>${esc(item.variant.title)}</p><div class="assessment-card-bottom">${item.result ? `<span class="mono result-number">${item.result.score}/90 <small>баллов</small></span>` : `<span class="muted">Этап ${item.stage + 1} из 3</span>`}<button class="secondary" data-open="${esc(item.id)}">${item.state === 'submitted' ? 'Посмотреть результат' : 'Продолжить'} ${icon('arrow')}</button></div></div>`;
}
function overview(): string {
  const completed = assessments.filter((item) => item.state === 'submitted');
  return `${heading('ВАШЕ РАБОЧЕЕ ПРОСТРАНСТВО', `Добро пожаловать, ${user!.name.split(' · ')[0]}`, 'Новый шаг в карьере начинается с того, что вы уже умеете.')}<div class="welcome-panel"><div><span class="eyebrow">ПОКАЖИТЕ ХОД МЫСЛИ</span><h2>Интересные задачи.<br>Понятные результаты.</h2><p>Сначала разберитесь в ситуации. Затем проверьте решение.<br>Расскажите, почему ему можно доверять.</p><button data-tab="assessments">Выбрать испытание ${icon('arrow')}</button></div><img src="/brand/fsp.svg" alt=""></div><div class="stats-grid"><div class="card"><span>В работе</span><strong class="mono">${assessments.length - completed.length}</strong></div><div class="card"><span>Завершённых испытаний</span><strong class="mono">${completed.length}</strong></div><div class="card"><span>Доступных специализаций</span><strong class="mono">${catalog.tracks.length}</strong></div></div><div class="section-title"><h2>Продолжить с того же места</h2><button class="text-button" data-tab="assessments">Все испытания ${icon('arrow')}</button></div>${
    assessments
      .filter((item) => item.state === 'active')
      .slice(0, 3)
      .map(assessmentCard)
      .join('') ||
    empty(
      'Ваше первое испытание впереди',
      'Выберите направление и семейство задач в разделе проверки навыков.',
    )
  }<div class="card quiet-card">${icon('shield')}<p>Техническая проверка семейства уже выполнена. Профессиональные уровни пока предварительные: далее нужны пилот с участниками и экспертная калибровка.</p></div>`;
}
function resultsView(): string {
  return `${heading('РЕЗУЛЬТАТЫ', 'То, что вы уже показали', 'Доказательства по компетенциям, обратная связь и ваши обоснования.')}<div class="history-list">${
    assessments
      .filter((item) => item.state === 'submitted')
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(assessmentCard)
      .join('') ||
    empty(
      'Результаты появятся после испытания',
      'Выполните теоретическую и практическую части, затем отправьте обоснование решения.',
      'chart',
    )
  }</div>`;
}
function assessmentsView(): string {
  const history = [...assessments]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, historyLimit);
  return `${heading('ПРОВЕРКА НАВЫКОВ', 'Покажите, как вы думаете', 'Рабочая ситуация, ваши решения и проверяемые эксперименты.')}<div class="grid assessments-grid"><div><div class="journey-intro"><span class="eyebrow">КАК ПРОХОДИТ ИСПЫТАНИЕ</span><div class="journey-mini"><div><span class="mono">01</span><strong>Разобраться</strong><small>Теория без ИИ</small></div><div><span class="mono">02</span><strong>Проверить</strong><small>Рабочая лаборатория</small></div><div><span class="mono">03</span><strong>Адаптироваться</strong><small>Новые условия</small></div></div></div><div class="section-title"><h2>Мои испытания</h2><span class="badge neutral">${assessments.length}</span></div>${history.map(assessmentCard).join('') || empty('У вас всё впереди', 'Выберите специализацию и предполагаемый уровень для первого испытания. Можно вернуться к незавершённой работе в любое время.')}${assessments.length > historyLimit ? '<button class="secondary" data-history-more>Показать ещё испытания</button>' : ''}</div><div class="card assessment-start"><span class="eyebrow">ВАШ СЛЕДУЮЩИЙ ШАГ</span><h2>Подтвердить специализацию</h2><form id="start"><label>Специализация<select name="trackId" id="start-track">${trackOptions()}</select></label><label>Семейство задач<select name="familyId" id="start-family">${familyOptions(catalog.tracks[0]!.id)}</select></label><div id="family-preview" class="family-preview">${familyPreview(catalog.families[0]!.id)}</div><label>Предполагаемый уровень<select name="grade">${gradeOptions()}</select></label><label>Помощник для практической части<select name="toolMode">${modeOptions()}</select></label><p class="muted">Теория без ИИ. Последний этап — с документацией. Открытое решение проверяет эксперт.</p><button>Начать испытание ${icon('arrow')}</button></form>${needs.length ? `<div class="company-tasks"><h3>Задачи компаний</h3>${needs.map((need) => `<div><strong>${esc(need.title)}</strong><p class="muted">${need.salaryMin.toLocaleString('ru-RU')}–${need.salaryMax.toLocaleString('ru-RU')} ₽</p><button class="secondary" data-need="${need.id}">Пройти ${icon('arrow')}</button></div>`).join('')}</div>` : ''}</div></div>`;
}
function familyPreview(id: string): string {
  const family = catalog.families.find((item) => item.id === id);
  return `<strong class="family-title">${esc(family?.title)}</strong><span class="meta">Проверяемые компетенции</span><div class="tags">${family?.skills.map((skill) => `<span>${esc(skillName(skill))}</span>`).join('') ?? ''}</div>`;
}
function assessmentView(item: Assessment): string {
  const variant = item.variant;
  const fields = Object.keys(variant.rows[0]?.values ?? {});
  const lab = variant.lab
    ? renderControls(variant.lab.controls)
    : fields.length
      ? `<label>Признаки</label>${fields.map((field) => `<label class="choice"><input type="checkbox" name="features" value="${field}">${field}</label>`).join('')}<label>Разбиение<select name="split"><option value="random">Случайное</option><option value="time">Временное</option><option value="group">По группам</option></select></label>`
      : variant.documents.length
        ? '<label>Политика источников<select name="policy"><option value="all">Все версии, всегда отвечать</option><option value="current">Актуальные, всегда отвечать</option><option value="current-abstain">Актуальные, отказ при отсутствии подтверждения</option></select></label><label>topK<input type="number" name="topK" min="1" max="5" value="2"></label>'
        : '<label>Стратегия обработки<select name="strategy"><option value="arrival">По приходу</option><option value="dedupe">Убрать повторы</option><option value="versioned">Повторы и максимальная версия</option></select></label>';
  if (item.result) return resultHtml(item, skillName);
  const hasExperiment = item.experiments.some((experiment) => experiment.stage === item.stage);
  return `<button class="secondary back-button" data-back>${icon('back')}К испытаниям</button>${heading(`${trackName(variant.trackId).toUpperCase()} / ${variant.grade}`, variant.title)}<nav class="stage" aria-label="Этапы испытания">${['Теория', 'Исследование', 'Изменение условий'].map((name, index) => `<div class="${item.stage === index ? 'current' : item.stage > index ? 'complete' : ''}" ${item.stage === index ? 'aria-current="step"' : ''}><span class="step-dot mono">${item.stage > index ? icon('check') : '0' + (index + 1)}</span><span><strong>${name}</strong><small>${['Самостоятельное рассуждение', 'Проверка вашего решения', 'Адаптация и обоснование'][index]}</small></span></div>`).join('')}</nav><div class="session-bar"><span>${icon('lock')}${esc(catalog.profiles[variant.stageModes[item.stage]!]?.name)}</span><span>${icon('code')}Эксперименты: ${item.experiments.length}/12</span><span class="draft-status" aria-live="polite">${icon('check')}Прогресс этапов сохранён</span></div><div class="lab-mobile-tabs" role="group" aria-label="Рабочая область"><button class="secondary" data-lab-panel="work" aria-pressed="true">Решение</button><button class="secondary" data-lab-panel="materials" aria-pressed="false">Материалы и помощь</button></div><div class="lab-grid"><section class="card work-panel">${
    item.stage === 0
      ? `<span class="eyebrow">ПЕРЕД ПРАКТИКОЙ</span><h2>Сначала — ваша логика</h2><p class="muted">Выберите один ответ в каждом вопросе. Здесь важно ваше рассуждение.</p><div class="theory-progress" aria-live="polite"><span id="answer-progress">0 из ${variant.questions.length} ответов</span></div><form id="answers">${questionsHtml(variant.questions)}<button>Сохранить ответы и продолжить ${icon('arrow')}</button></form>`
      : `<span class="eyebrow">ЭТАП ${item.stage + 1} / 3</span><h2>${item.stage === 2 ? 'Проверка новых условий' : 'Рабочая лаборатория'}</h2><p class="muted">Выберите параметры решения и проверьте, как оно работает на данных.</p>${item.stage === 2 ? `<div class="change-callout"><span class="eyebrow">УСЛОВИЯ ИЗМЕНИЛИСЬ</span><p>${variant.lab ? esc(variant.lab.change) : 'Повторите проверку на изменённых данных и объясните последствия.'}</p></div>` : ''}<form id="experiment">${lab}<button>${icon('code')}Запустить эксперимент</button></form><div class="section-title experiment-heading"><h3>Журнал экспериментов</h3><span class="badge neutral">${item.experiments.length}</span></div>${
          item.experiments.length
            ? [...item.experiments]
                .reverse()
                .map((experiment, index) => experimentHtml(experiment, index === 0))
                .join('')
            : `<div class="experiment-empty">${icon('chart')}<p>Первый запуск покажет метрики и проверки вашего решения.</p></div>`
        }<p class="muted evaluation-note">При сдаче оценивается последний запущенный эксперимент на каждом этапе.</p>${item.stage === 1 ? `<button data-advance ${hasExperiment ? '' : 'disabled'}>Перейти к изменению условий ${icon('arrow')}</button>` : `<form id="submit"><h3>Обоснуйте решение</h3><p class="muted">Что показали эксперименты? Какие есть ограничения? Что вы проверите перед внедрением?</p><label>Решение, доказательства, ограничения и следующий шаг<textarea name="recommendation" required minlength="20" placeholder="Моё решение…\nРезультаты проверки…\nРиски и следующий шаг…" rows="7"></textarea></label><span id="recommendation-count" class="meta">Минимум 20 символов</span><button ${hasExperiment ? '' : 'disabled'}>Сдать работу ${icon('check')}</button></form>`}`
  }</section><aside class="materials-column"><div class="card materials-panel"><span class="eyebrow">ВСЁ ПОД РУКОЙ</span><h2>Материалы</h2><p class="material-context">${esc(variant.context)}</p>${variant.artifacts.map((artifact, index) => `<details ${index === 0 ? 'open' : ''}><summary>${icon('folder')}${esc(artifact.name)}</summary><pre>${esc(artifact.content)}</pre></details>`).join('')}${variant.lab ? labDataView(variant.lab.data) : ''}<button class="secondary full" data-download>${icon('download')}Скачать материалы и данные</button>${variant.documents.map((document) => `<p><strong>${esc(document.id)}</strong>: ${esc(document.text)}</p>`).join('')}</div>${['hint', 'local', 'extended'].includes(variant.stageModes[item.stage]!) ? `<div class="card assistant-panel"><div class="section-title"><h2>Помощник</h2><span class="badge neutral">${catalog.liveEnabled ? 'LLM' : 'Справка'}</span></div><p class="muted">${catalog.liveEnabled ? 'Помощь в пределах правил текущего этапа.' : 'Сейчас доступна локальная справка. Ответы платной модели не используются.'}</p><form id="assistant"><label>Ваш вопрос<textarea name="question" maxlength="3000" required placeholder="Помоги разобраться в методе проверки…" rows="3"></textarea></label><button class="secondary">Получить помощь ${icon('arrow')}</button></form><div id="assistant-response" class="prose" role="status"></div></div>` : `<div class="card quiet-card">${icon('lock')}<p>На этом этапе ${variant.stageModes[item.stage] === 'docs' ? 'доступна документация. ИИ не используется.' : 'решение принимаете вы. ИИ не используется.'}</p></div>`}</aside></div>`;
}
function needView(): string {
  const track = catalog.tracks[0]!;
  return `${heading('ПОДБОРКИ', 'Потребности команды', 'Задайте компетенции и их важность. Проверка подстроится под профессиональный вектор.')}<div class="grid"><div>${needs.map((need) => `<div class="card"><h2>${esc(need.title)}</h2><p>${esc(trackName(need.trackId))} · ${need.grade}</p><p>${need.salaryMin.toLocaleString()}–${need.salaryMax.toLocaleString()} ₽</p><p class="muted">Обязательные: ${need.required.map(skillName).map(esc).join(', ')}</p><button data-match="${need.id}">Найти кандидатов</button></div>`).join('') || empty('Первый подбор начинается с задачи', 'Выберите специализацию, отметьте обязательные навыки и расставьте приоритеты. Подбор и план испытания собираются без ИИ.', 'folder')}</div><div class="card"><span class="eyebrow">ЗАДАЧИ ВАШЕЙ КОМАНДЫ</span><h2>Новая потребность</h2><form id="need"><label>Название<input name="title" required placeholder="LLM Engineer для сервиса поддержки"></label><label>Специализация<select name="trackId" id="need-track">${trackOptions()}</select></label><label>Уровень<select name="grade">${gradeOptions()}</select></label><label>Стек<input name="stack" placeholder="Python, PostgreSQL"></label><div id="need-skills">${needSkills(track)}</div><div id="need-families">${needFamilies(track.id)}</div><div class="row"><label>Зарплата от, ₽<input type="number" name="salaryMin" min="1" value="120000" required></label><label>До, ₽<input type="number" name="salaryMax" min="1" value="200000" required></label></div><label>Условия и задачи<textarea name="description" required></textarea></label><label>Помощник<select name="toolMode">${modeOptions()}</select></label><button>Создать потребность</button></form></div></div>`;
}
function needSkills(track: Track): string {
  return `<h3>Компетенции и приоритеты</h3>${track.skills.map((skill) => `<div class="weight"><label><input type="checkbox" name="required" value="${skill}" checked> ${esc(skillName(skill))}</label><input aria-label="Приоритет ${esc(skillName(skill))}" type="number" name="weight:${skill}" min="0" max="10" value="5"></div>`).join('')}`;
}
async function candidatesView(needId = ''): Promise<string> {
  const candidates = await api<
    {
      id: string;
      name: string;
      stack: string[];
      contacts: string | null;
      fsp: string;
      categories: { trackId: string; grade: string }[];
      matching: { score: number; missing: string[]; explanation: string } | null;
    }[]
  >(`/candidates${needId ? `?needId=${encodeURIComponent(needId)}` : ''}`);
  return `${heading('ПОИСК КАНДИДАТОВ', 'Подбор кандидатов', 'Смотрите проверенные компетенции и основания соответствия задачам команды.')}<form id="filter"><label>Потребность<select name="needId"><option value="">Все категории</option>${opts(
    needs.map((need) => ({ value: need.id, text: need.title })),
    needId,
  )}</select></label><button class="secondary">Показать</button></form><p class="muted">В подборку попадают кандидаты с положительным предварительным результатом. Контакты открываются после принятия приглашения.</p>${candidates.map((candidate) => `<div class="card"><h2>${esc(candidate.name)}</h2><p>${candidate.categories.map((category) => `${esc(trackName(category.trackId))} · ${esc(category.grade)}`).join(', ')}</p><p>${esc(candidate.fsp)} · ${esc(candidate.stack.join(', '))}</p>${candidate.matching ? `<p><strong>Соответствие: ${candidate.matching.score}%</strong></p><p>${esc(candidate.matching.explanation)}</p><p class="muted">Пробелы: ${candidate.matching.missing.map(skillName).map(esc).join(', ') || 'нет в проверенных модулях'}</p>` : ''}<p>Контакты: ${esc(candidate.contacts ?? 'откроются после принятия')}</p><form class="invite" data-candidate="${candidate.id}"><label>Предложение<textarea name="description" required></textarea></label><div class="row"><label>От, ₽<input name="salaryMin" type="number" min="1" value="120000" required></label><label>До, ₽<input name="salaryMax" type="number" min="1" value="200000" required></label></div><button>Пригласить</button></form></div>`).join('') || '<div class="card empty">Пока нет кандидатов с подходящим результатом. Пройдите испытание в кабинете кандидата.</div>'}`;
}
async function invitationsView(): Promise<string> {
  const invitations = await api<
    {
      id: string;
      company: string;
      description: string;
      salaryMin: number;
      salaryMax: number;
      status: string;
      employerContact: string;
    }[]
  >('/invitations');
  return `${heading('ПРЕДЛОЖЕНИЯ', 'Приглашения', 'Задачи, условия и зарплата — до первого разговора.')}${invitations.map((item) => `<div class="card"><span class="badge">${esc(statusLabel(item.status))}</span><h2>${esc(item.company)}</h2><p>${esc(item.description)}</p><p><strong>${item.salaryMin.toLocaleString()}–${item.salaryMax.toLocaleString()} ₽</strong></p><p>Связь: ${esc(item.employerContact)}</p>${user!.role === 'candidate' && ['sent', 'viewed'].includes(item.status) ? `<div class="actions"><button data-invitation="${item.id}" data-status="accepted">Принять</button><button class="secondary" data-invitation="${item.id}" data-status="declined">Отклонить</button></div>` : ''}</div>`).join('') || empty('Хорошие предложения впереди', 'Когда появится приглашение, здесь будут задачи, условия и зарплатный диапазон.', 'mail')}`;
}
function casesView(): string {
  if (caseVariant)
    return `<button class="secondary" data-case-back>К библиотеке</button><div class="card"><h1>${esc(caseVariant.title)}</h1><span class="badge">Экспериментальный корпоративный кейс · ${esc(catalog.profiles[caseVariant.mode]?.name ?? caseVariant.mode)}</span><p>${esc(caseVariant.context)}</p><p>${esc(caseVariant.constraints)}</p>${caseVariant.materials.map((material) => `<details open><summary>${esc(material.name)}</summary><pre>${esc(material.content)}</pre></details>`).join('')}<form id="case-submit">${questionsHtml(caseVariant.questions)}<label>${esc(caseVariant.deliverable)}<textarea name="recommendation" required></textarea></label><button>Отправить на экспертную проверку</button></form></div>`;
  return `${heading('ЗАДАЧИ КОМПАНИЙ', 'Особые кейсы', 'Параметризованные ситуации под задачи команды. Открытые решения оценивает эксперт.')}<div class="grid"><div>${cases.map((item) => `<div class="card"><span class="badge">${esc(statusLabel(item.status))}</span><h2>${esc(item.title)}</h2><p>${esc(item.context)}</p>${user!.role === 'employer' && item.status === 'draft' ? `<button data-publish="${item.id}">Опубликовать экспериментальный кейс</button>` : `<button data-case="${item.id}">Открыть вариант</button>`}</div>`).join('') || empty('Место для особых задач', 'Корпоративные кейсы появятся здесь после публикации работодателем.', 'folder')}</div>${user!.role === 'employer' ? `<div class="card"><h2>Конструктор кейса</h2><form id="case"><label>Название<input name="title" required></label><label>Специализация<select name="trackId">${trackOptions()}</select></label><label>Ситуация<textarea name="context" required placeholder="Проверьте решение при задержке {{days}} дней"></textarea></label><label>Ожидаемый результат<textarea name="deliverable" required></textarea></label><label>Ограничения<textarea name="constraints" required></textarea></label><label>Материал<textarea name="material" required></textarea></label><label>Критерии экспертной проверки<textarea name="rubric" required></textarea></label><label>Вариации, через запятую<input name="variations" placeholder="days=3:20"></label><label>Режим помощи<select name="mode">${modeOptions()}</select></label><details class="custom-questions"><summary>Добавить теоретические вопросы</summary><p class="muted">Укажите варианты ответа и правильный вариант. Открытое решение проверит эксперт. Кейс не присваивает общий грейд.</p><div id="question-builder"></div><button class="secondary" type="button" data-add-question>Добавить вопрос</button></details><button>Сохранить черновик</button></form></div>` : ''}</div>`;
}
async function adminView(): Promise<string> {
  const [validation, report, reviews] = await Promise.all([
    api<Record<string, unknown>>('/admin/validation'),
    api<Record<string, unknown>>('/admin/observations'),
    api<Assessment[]>('/admin/reviews'),
  ]);
  const families = (validation.families ?? []) as {
    title: string;
    variants: number;
    acceptedOracle: number;
    rejectedFaults: number;
  }[];
  const percent = (value: unknown) =>
    typeof value === 'number' ? `${Math.round(value * 100)}%` : 'Нет данных';
  return `${heading('КАЧЕСТВО ПРОВЕРКИ', 'Доказательства вместо догадок', 'Техническая проверка генератора, пилот на людях и экспертная очередь.')}<div class="stats-grid"><div class="card"><span>Проверенных вариантов</span><strong class="mono">${esc(validation.variants ?? '—')}</strong></div><div class="card"><span>Отклонённых ошибочных стратегий</span><strong class="mono">${esc(validation.faultyStrategiesRejected ?? '—')}</strong></div><div class="card"><span>Наблюдений с участниками</span><strong class="mono">${esc(report.humanObservations ?? 0)}</strong></div></div><div class="grid"><div><div class="card"><div class="section-title"><h2>Техническая валидация</h2><span class="badge ${validation.passed ? 'success' : 'neutral'}">${validation.passed ? 'Пройдена' : 'Не выполнена'}</span></div><p class="muted">Воспроизводимость, допустимые решения, чувствительность к ошибкам и изменение условий. Это техническая проверка, а не подтверждение равенства сложности для людей.</p>${families.length ? `<details><summary>${families.length} семейств · результаты проверки</summary><div class="table-wrap"><table><thead><tr><th>Семейство</th><th>Варианты</th><th>Принято</th><th>Ошибки обнаружены</th></tr></thead><tbody>${families.map((family) => `<tr><td class="family-table-title">${esc(family.title)}</td><td>${family.variants}</td><td>${family.acceptedOracle}</td><td>${family.rejectedFaults}</td></tr>`).join('')}</tbody></table></div></details>` : '<p class="muted">Полный отчёт появится после запуска технической валидации.</p>'}<details><summary>Полный технический отчёт</summary><pre>${esc(JSON.stringify(validation, null, 2))}</pre></details></div><div class="card"><h2>Пилот на людях</h2><div class="pilot-metrics"><div><span>Согласие с экспертами</span><strong>${percent(report.expertAgreement)}</strong></div><div><span>Стабильность повторной попытки</span><strong>${percent(report.repeatAgreement)}</strong></div></div><p class="muted">${esc(report.warning)}</p><details><summary>Добавить наблюдение</summary><form id="observation"><label>Участник<input name="participant" required></label><label>Семейство<select name="familyId">${opts(catalog.families.map((family) => ({ value: family.id, text: family.title })))}</select></label><label>Вариант<input name="variantId" required></label><div class="row"><label>Уровень эксперта: 0–3<input name="expertGrade" type="number" min="0" max="3" required></label><label>Уровень теста: 0–3<input name="predictedGrade" type="number" min="0" max="3" required></label></div><div class="row"><label>Баллы<input name="score" type="number" min="0" max="100" required></label><label>Время, секунды<input name="seconds" type="number" min="1" required></label></div><label>Условие<select name="condition"><option value="standard">Стандартное</option><option value="exposed">С известным решением</option><option value="ai-only">ИИ самостоятельно</option></select></label><button>Добавить наблюдение</button></form></details><details><summary>Подробная статистика пилота</summary><pre>${esc(JSON.stringify(report, null, 2))}</pre></details></div></div><div><div class="section-title"><h2>Экспертная очередь</h2><span class="badge neutral">${reviews.length}</span></div>${reviews.map((item) => `<div class="card"><span class="badge neutral">${esc(item.variant.grade)} · ${esc(trackName(item.variant.trackId))}</span><h3>${esc(item.variant.title)}</h3><p class="mono result-number">${esc(item.result?.score)}/90</p><div class="prose">${esc(item.recommendation)}</div><details><summary>Материалы и результаты экспериментов</summary>${item.variant.artifacts.map((artifact) => `<h4>${esc(artifact.name)}</h4><pre>${esc(artifact.content)}</pre>`).join('')}${item.experiments.map((experiment) => experimentHtml(experiment, false)).join('')}</details><form class="review" data-id="${item.id}"><label>Решение<select name="decision"><option value="approved">Рекомендация обоснована</option><option value="needs_revision">Требует доработки</option></select></label><label>Доказательства и замечания<textarea name="notes" required></textarea></label><button>Записать проверку</button></form></div>`).join('') || empty('Здесь будут решения участников', 'После сдачи работы появятся обоснование, эксперименты и форма экспертной проверки.', 'folder')}</div></div>`;
}
async function render(): Promise<void> {
  if (!user) {
    document.title = 'Офферли · Дело найдёт.';
    root.innerHTML = login();
    lastView = '';
    return;
  }
  const navigation =
    user.role === 'candidate'
      ? [
          ['overview', 'Обзор'],
          ['assessments', 'Испытания'],
          ['results', 'Результаты'],
          ['cases', 'Особые кейсы'],
          ['invitations', 'Приглашения'],
          ['profile', 'Профиль'],
        ]
      : user.role === 'employer'
        ? [
            ['needs', 'Потребности'],
            ['candidates', 'Кандидаты'],
            ['cases', 'Конструктор кейсов'],
            ['invitations', 'Приглашения'],
            ['profile', 'Компания'],
          ]
        : [['admin', 'Качество и валидация']];
  const content = selected
    ? assessmentView(selected)
    : tab === 'overview'
      ? overview()
      : tab === 'results'
        ? resultsView()
        : tab === 'profile'
          ? profile()
          : tab === 'assessments'
            ? assessmentsView()
            : tab === 'needs'
              ? needView()
              : tab === 'candidates'
                ? await candidatesView()
                : tab === 'cases'
                  ? casesView()
                  : tab === 'invitations'
                    ? await invitationsView()
                    : await adminView();
  const symbols: Record<string, string> = {
    overview: 'home',
    assessments: 'shield',
    results: 'chart',
    cases: 'folder',
    invitations: 'mail',
    profile: 'user',
    needs: 'folder',
    candidates: 'search',
    admin: 'shield',
  };
  const currentTitle = selected
    ? selected.result
      ? 'Результаты'
      : 'Проверка навыков'
    : (navigation.find(([id]) => id === tab)?.[1] ?? 'Кабинет');
  document.title = `${currentTitle} · Офферли`;
  history.replaceState(null, '', `/#${tab}${selected ? '/' + selected.id : ''}`);
  root.innerHTML = `<a class="skip-link" href="#content">К содержимому</a><div class="shell"><aside class="app-sidebar" id="workspace-nav"><button class="sidebar-brand" data-tab="${user.role === 'candidate' ? 'overview' : user.role === 'employer' ? 'needs' : 'admin'}">${brand()}</button><span class="sidebar-label mono">РАБОЧЕЕ ПРОСТРАНСТВО</span><nav class="nav" aria-label="Навигация кабинета">${navigation.map(([id, title]) => `<button class="app-menu-button ${tab === id ? 'active' : ''}" ${tab === id ? 'aria-current="page"' : ''} data-tab="${id}">${icon(symbols[id!]!)}<span>${title}</span></button>`).join('')}</nav><div class="sidebar-callout">${icon('shield')}<strong>Навыки говорят за вас</strong><p>Исследуйте, проверяйте и показывайте основания своего решения.</p></div><div class="sidebar-footer"><button class="app-menu-button" data-help>${icon('help')}Помощь</button><button class="app-menu-button" data-logout>${icon('exit')}Выйти</button><p class="sidebar-footnote">Офферли · Дело найдёт.</p></div></aside><div class="workspace-inset"><header class="workspace-header"><div class="workspace-breadcrumb"><button class="mobile-menu" data-menu aria-label="Открыть меню" aria-controls="workspace-nav" aria-expanded="false">${icon('menu')}</button><span>Кабинет ${user.role === 'candidate' ? 'кандидата' : user.role === 'employer' ? 'работодателя' : 'эксперта'}</span><span class="breadcrumb-sep">/</span><strong>${esc(currentTitle)}</strong></div><div class="workspace-user">${catalog.development ? '<span class="demo-pill"><span></span>Локальная версия</span>' : ''}<button class="user-avatar" data-tab="${user.role === 'admin' ? 'admin' : 'profile'}" aria-label="${esc(user.name)}">${esc(user.name.slice(0, 2).toUpperCase())}</button></div></header><main class="workspace-main" id="content">${content}</main></div></div><dialog id="help-dialog"><div class="section-title"><h2>Всё в вашем темпе</h2><button class="icon-button" data-help-close aria-label="Закрыть помощь">${icon('close')}</button></div><p>Теория проверяет самостоятельное рассуждение. В лаборатории можно запускать эксперименты и изучать результаты. На последнем этапе условия меняются — нужно адаптировать решение и объяснить его.</p><p>Учитывается последний запущенный эксперимент каждого этапа. Этапы и эксперименты сохраняются на сервере, черновики ответов и обоснования — в этом браузере.</p><p>Результат предварительный до калибровки семейства на людях. Открытые решения рассматривает эксперт.</p><button data-help-close>Понятно</button></dialog>`;
  if (selected && !selected.result) {
    const draft = root.querySelector<HTMLTextAreaElement>('#submit textarea');
    if (draft) draft.value = recommendationDrafts.get(selected.id) ?? '';
    const latest = selected.experiments.at(-1)?.input;
    if (latest?.plan && selected.variant.lab)
      restorePlan(latest.plan, selected.variant.lab.controls);
    if (latest) {
      for (const [name, value] of Object.entries(latest)) {
        if (Array.isArray(value)) {
          for (const checkbox of root.querySelectorAll<HTMLInputElement>('input[name="features"]'))
            checkbox.checked = value.includes(checkbox.value);
        } else {
          const field = root.querySelector<HTMLInputElement | HTMLSelectElement>(
            `#experiment [name="${name}"]`,
          );
          if (field) field.value = String(value);
        }
      }
    }
  }
  if (caseVariant && ['hint', 'local', 'extended'].includes(caseVariant.mode))
    root
      .querySelector('#case-submit')
      ?.insertAdjacentHTML(
        'afterend',
        '<form id="case-assistant"><label>Вопрос помощнику<textarea name="question" required maxlength="3000"></textarea></label><button class="secondary">Получить помощь</button></form><pre id="assistant-response"></pre>',
      );
  if (selected?.result) {
    const review = (selected as Assessment & { expertReview?: { decision: string; notes: string } })
      .expertReview;
    if (review)
      root
        .querySelector('#content')
        ?.insertAdjacentHTML(
          'beforeend',
          `<div class="card"><h3>Экспертная проверка</h3><p>${esc(statusLabel(review.decision))}</p><pre>${esc(review.notes)}</pre></div>`,
        );
  }
  if (tab === 'cases' && !caseVariant) {
    const submissions =
      await api<{ status: string; recommendation: string; notes?: string }[]>('/case-submissions');
    if (submissions.length)
      root
        .querySelector('#content')
        ?.insertAdjacentHTML(
          'beforeend',
          `<div class="card"><h2>Результаты особых кейсов</h2>${submissions.map((item) => `<p>${esc(statusLabel(item.status))}</p><pre>${esc(item.recommendation)}</pre><p>${esc(item.notes ?? 'Ожидает экспертной проверки')}</p>`).join('')}</div>`,
        );
  }
  if (tab === 'admin') {
    const submissions = await api<
      {
        id: string;
        status: string;
        recommendation: string;
        case: CustomCase | null;
        variant: unknown;
      }[]
    >('/admin/case-submissions');
    if (submissions.length)
      root
        .querySelector('#content')
        ?.insertAdjacentHTML(
          'beforeend',
          `<div class="card"><h2>Проверка особых кейсов</h2>${submissions.map((item) => `<form class="case-review" data-id="${item.id}"><h3>${esc(item.case?.title)}</h3><p>${esc(statusLabel(item.status))}</p><details><summary>Задание и рубрика</summary><pre>${esc(JSON.stringify(item.variant, null, 2))}</pre><p>${esc(item.case?.rubric)}</p></details><pre>${esc(item.recommendation)}</pre><label>Решение<select name="decision"><option value="approved">Принять</option><option value="needs_revision">Требует доработки</option></select></label><label>Замечания<textarea name="notes" required></textarea></label><button>Записать проверку кейса</button></form>`).join('')}</div>`,
        );
  }
  restoreDraft();
  syncSessionUi();
  const viewKey = `${user.id}:${tab}:${selected?.id}:${selected?.stage}:${Boolean(selected?.result)}:${caseVariant?.id}`;
  if (viewKey !== lastView) {
    window.scrollTo({ top: 0, behavior: 'instant' });
    root.querySelector<HTMLHeadingElement>('h1')?.focus({ preventScroll: true });
    lastView = viewKey;
  }
}
async function refresh(): Promise<void> {
  if (!user) return;
  needs = await api<Need[]>('/needs');
  cases = await api<CustomCase[]>('/cases');
  if (user.role === 'candidate') assessments = await api<Assessment[]>('/assessments');
  await render();
}
root.addEventListener('change', (event) => {
  const target = event.target as HTMLSelectElement;
  if (target.id === 'start-track') {
    document.querySelector('#start-family')!.innerHTML = familyOptions(target.value);
    document.querySelector('#family-preview')!.innerHTML = familyPreview(
      (document.querySelector('#start-family') as HTMLSelectElement).value,
    );
  }
  if (target.id === 'start-family')
    document.querySelector('#family-preview')!.innerHTML = familyPreview(target.value);
  if (target.id === 'need-track') {
    document.querySelector('#need-skills')!.innerHTML = needSkills(
      catalog.tracks.find((track) => track.id === target.value)!,
    );
    document.querySelector('#need-families')!.innerHTML = needFamilies(target.value);
  }
  if (target.name === 'trackId' && target.closest('form')?.id === 'case') {
    for (const field of root.querySelectorAll<HTMLSelectElement>('[data-question-skill]')) {
      field.innerHTML = opts(
        catalog.tracks
          .find((track) => track.id === target.value)!
          .skills.map((skill) => ({ value: skill, text: skillName(skill) })),
      );
    }
  }
  saveDraft();
  syncSessionUi();
});
root.addEventListener('input', (event) => {
  const target = event.target as HTMLTextAreaElement;
  if (target.hasAttribute('data-question-options')) {
    const field = target
      .closest('[data-custom-question]')!
      .querySelector<HTMLSelectElement>('[data-question-correct]')!;
    const current = field.value;
    field.innerHTML = opts(
      target.value
        .split('\n')
        .map((value) => value.trim())
        .filter(Boolean)
        .map((text, index) => ({ value: String(index), text })),
      current,
    );
  }
  if (target.hasAttribute('data-row-search')) {
    let visible = 0;
    const rows = target.closest('details')!.querySelectorAll<HTMLTableRowElement>('tbody tr');
    for (const row of rows) {
      row.hidden = !row.textContent
        ?.toLocaleLowerCase('ru-RU')
        .includes(target.value.toLocaleLowerCase('ru-RU'));
      if (!row.hidden) visible++;
    }
    target.closest('details')!.querySelector('[data-row-count]')!.textContent =
      `${visible} из ${rows.length} строк`;
    return;
  }
  if (selected && target.name === 'recommendation')
    recommendationDrafts.set(selected.id, target.value);
  saveDraft();
  syncSessionUi();
});
root.addEventListener('click', async (event) => {
  const button = (event.target as Element).closest<HTMLButtonElement>('button');
  if (!button || (button.type === 'submit' && !Object.keys(button.dataset).length)) return;
  if (busy) return;
  busy = true;
  try {
    if ('addQuestion' in button.dataset) {
      const trackId = root.querySelector<HTMLSelectElement>('#case [name="trackId"]')!.value;
      const skills = catalog.tracks.find((track) => track.id === trackId)!.skills;
      root
        .querySelector('#question-builder')!
        .insertAdjacentHTML(
          'beforeend',
          `<fieldset data-custom-question><div class="section-title"><h3>Теоретический вопрос</h3><button type="button" class="icon-button" data-remove-question aria-label="Удалить вопрос">${icon('close')}</button></div><label>Формулировка<input data-question-prompt required></label><label>Варианты ответа, каждый с новой строки<textarea data-question-options required placeholder="Первый вариант\nВторой вариант"></textarea></label><label>Правильный ответ<select data-question-correct required><option value="">Сначала добавьте варианты</option></select></label><label>Компетенция<select data-question-skill>${opts(skills.map((skill) => ({ value: skill, text: skillName(skill) })))}</select></label></fieldset>`,
        );
    } else if ('removeQuestion' in button.dataset) {
      button.closest('[data-custom-question]')!.remove();
    } else if (button.dataset.labPanel) {
      root
        .querySelector('.lab-grid')!
        .classList.toggle('show-materials', button.dataset.labPanel === 'materials');
      for (const item of root.querySelectorAll<HTMLButtonElement>('[data-lab-panel]'))
        item.setAttribute('aria-pressed', String(item === button));
    } else if (button.dataset.public) {
      employerRegistration = button.dataset.public === 'employer';
      publicPage = employerRegistration ? 'register' : button.dataset.public;
      history.replaceState(
        null,
        '',
        publicPage === 'landing'
          ? '/'
          : publicPage === 'register' && employerRegistration
            ? '/register/employer'
            : `/${publicPage}`,
      );
      await render();
      window.scrollTo(0, 0);
    } else if ('menu' in button.dataset) {
      const opened = root.querySelector('.shell')!.classList.toggle('menu-open');
      button.setAttribute('aria-expanded', String(opened));
      button.setAttribute('aria-label', opened ? 'Закрыть меню' : 'Открыть меню');
    } else if ('help' in button.dataset) {
      root.querySelector<HTMLDialogElement>('#help-dialog')!.showModal();
    } else if ('helpClose' in button.dataset) {
      root.querySelector<HTMLDialogElement>('#help-dialog')!.close();
    } else if ('historyMore' in button.dataset) {
      historyLimit += 8;
      await render();
    } else if (button.dataset.demo) {
      user = await api<User>('/auth/login', 'POST', {
        email: `${button.dataset.demo}@demo.local`,
        password: 'Demo2026!pass',
      });
      tab =
        user.role === 'candidate' ? 'assessments' : user.role === 'employer' ? 'needs' : 'admin';
      await refresh();
    } else if ('logout' in button.dataset) {
      await api('/auth/logout', 'POST', {});
      user = null;
      selected = null;
      publicPage = 'landing';
      history.replaceState(null, '', '/');
      await render();
    } else if (button.dataset.tab) {
      tab = button.dataset.tab;
      selected = null;
      caseVariant = null;
      await refresh();
    } else if (button.dataset.open) {
      selected = await api<Assessment>(`/assessments/${button.dataset.open}`);
      await render();
    } else if ('back' in button.dataset) {
      selected = null;
      await refresh();
    } else if ('advance' in button.dataset) {
      selected = await api<Assessment>(`/assessments/${selected!.id}/advance`, 'POST', {});
      await render();
    } else if (button.dataset.need) {
      selected = await api<Assessment>('/assessments', 'POST', { needId: button.dataset.need });
      await render();
    } else if (button.dataset.match) {
      tab = 'candidates';
      selected = null;
      await render();
      document.querySelector('#content')!.innerHTML = await candidatesView(button.dataset.match);
    } else if (button.dataset.invitation) {
      await api(`/invitations/${button.dataset.invitation}`, 'PATCH', {
        status: button.dataset.status,
      });
      await render();
    } else if (button.dataset.publish) {
      await api(`/cases/${button.dataset.publish}/publish`, 'POST', {});
      await refresh();
    } else if (button.dataset.case) {
      caseVariant = await api(`/cases/${button.dataset.case}/variant`);
      await render();
    } else if ('caseBack' in button.dataset) {
      caseVariant = null;
      await render();
    } else if ('download' in button.dataset) {
      const blob = new Blob(
        [
          JSON.stringify(
            {
              artifacts: selected!.variant.artifacts,
              rows: selected!.variant.rows,
              events: selected!.variant.events,
              documents: selected!.variant.documents,
              lab: selected!.variant.lab,
            },
            null,
            2,
          ),
        ],
        { type: 'application/json' },
      );
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = 'assessment-materials.json';
      link.click();
      URL.revokeObjectURL(link.href);
    }
  } catch (error) {
    toast(error instanceof Error ? error.message : 'Ошибка');
  } finally {
    busy = false;
    syncSessionUi();
  }
});
root.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (busy) return;
  busy = true;
  const form = event.target as HTMLFormElement;
  const data = new FormData(form);
  const values = Object.fromEntries(data) as Record<string, string>;
  for (const button of root.querySelectorAll<HTMLButtonElement>('button')) button.disabled = true;
  try {
    if (form.id === 'login') {
      user = await api<User>('/auth/login', 'POST', values);
      tab =
        user.role === 'candidate' ? 'assessments' : user.role === 'employer' ? 'needs' : 'admin';
      await refresh();
    } else if (form.id === 'register') {
      const result = await api<{ developmentVerificationUrl?: string; message: string }>(
        '/auth/register',
        'POST',
        { ...values, consent: data.has('consent') },
      );
      document.querySelector('#verification')!.innerHTML =
        `<p>${esc(result.message)}</p>${result.developmentVerificationUrl ? `<a href="${esc(result.developmentVerificationUrl)}">Подтвердить локальный email</a>` : ''}`;
    } else if (form.id === 'profile') {
      user = await api<User>('/profile', 'PATCH', {
        ...values,
        stack: (values.stack ?? '')
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
        consent: data.has('consent'),
      });
      toast('Профиль сохранён');
      await render();
    } else if (form.id === 'start') {
      selected = await api<Assessment>('/assessments', 'POST', values);
      await render();
    } else if (form.id === 'answers') {
      await api(`/assessments/${selected!.id}/answers`, 'POST', { answers: values });
      selected = await api<Assessment>(`/assessments/${selected!.id}/advance`, 'POST', {});
      await render();
    } else if (form.id === 'experiment') {
      const input: ExperimentInput = {};
      if (selected!.variant.lab) input.plan = readPlan(data, selected!.variant.lab.controls);
      if (data.has('split')) {
        input.features = data.getAll('features').map(String);
        input.split = values.split!;
      }
      if (data.has('policy')) {
        input.policy = values.policy!;
        input.topK = Number(values.topK);
      }
      if (data.has('strategy')) input.strategy = values.strategy!;
      selected = await api<Assessment>(`/assessments/${selected!.id}/experiments`, 'POST', input);
      await render();
    } else if (form.id === 'submit') {
      selected = await api<Assessment>(`/assessments/${selected!.id}/submit`, 'POST', values);
      await render();
    } else if (form.id === 'assistant') {
      const result = await api<{ text: string }>(
        `/assessments/${selected!.id}/assistant`,
        'POST',
        values,
      );
      document.querySelector('#assistant-response')!.textContent = result.text;
    } else if (form.id === 'case-assistant') {
      const result = await api<{ text: string }>(
        `/cases/${caseVariant!.caseId}/assistant`,
        'POST',
        { ...values, variantId: caseVariant!.id },
      );
      document.querySelector('#assistant-response')!.textContent = result.text;
    } else if (form.id === 'need') {
      const weights = Object.fromEntries(
        [...data]
          .filter(([key]) => key.startsWith('weight:'))
          .map(([key, value]) => [key.slice(7), Number(value)]),
      );
      await api('/needs', 'POST', {
        ...values,
        weights,
        required: data.getAll('required'),
        familyIds: data.getAll('familyIds'),
        stack: (values.stack ?? '')
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
        salaryMin: Number(values.salaryMin),
        salaryMax: Number(values.salaryMax),
      });
      toast('Потребность сохранена без вызова ИИ');
      await refresh();
    } else if (form.id === 'filter')
      document.querySelector('#content')!.innerHTML = await candidatesView(values.needId);
    else if (form.classList.contains('invite')) {
      await api('/invitations', 'POST', {
        ...values,
        candidateId: form.dataset.candidate,
        salaryMin: Number(values.salaryMin),
        salaryMax: Number(values.salaryMax),
      });
      toast('Приглашение отправлено');
      form.reset();
    } else if (form.id === 'case') {
      const track = catalog.tracks.find((item) => item.id === values.trackId)!;
      await api('/cases', 'POST', {
        ...values,
        skills: track.skills,
        variations: (values.variations ?? '')
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
        materials: [{ name: 'Материалы работодателя', content: values.material }],
        questions: [...form.querySelectorAll<HTMLElement>('[data-custom-question]')].map(
          (block) => ({
            prompt: block.querySelector<HTMLInputElement>('[data-question-prompt]')!.value,
            options: block
              .querySelector<HTMLTextAreaElement>('[data-question-options]')!
              .value.split('\n')
              .map((value) => value.trim())
              .filter(Boolean),
            correct: Number(
              block.querySelector<HTMLSelectElement>('[data-question-correct]')!.value,
            ),
            skill: block.querySelector<HTMLSelectElement>('[data-question-skill]')!.value,
          }),
        ),
      });
      await refresh();
    } else if (form.id === 'case-submit') {
      await api(`/cases/${caseVariant!.caseId}/submit`, 'POST', {
        variantId: caseVariant!.id,
        answers: values,
        recommendation: values.recommendation,
      });
      caseVariant = null;
      toast('Работа отправлена на экспертную проверку. Общий грейд не изменён.');
      await refresh();
    } else if (form.id === 'observation') {
      await api('/admin/observations', 'POST', {
        ...values,
        expertGrade: Number(values.expertGrade),
        predictedGrade: Number(values.predictedGrade),
        score: Number(values.score),
        seconds: Number(values.seconds),
      });
      await render();
    } else if (form.classList.contains('review')) {
      await api('/admin/reviews', 'POST', { ...values, assessmentId: form.dataset.id });
      toast('Экспертная проверка записана');
    } else if (form.classList.contains('case-review')) {
      await api('/admin/case-submissions', 'POST', { ...values, submissionId: form.dataset.id });
      toast('Проверка особого кейса записана');
    }
  } catch (error) {
    toast(error instanceof Error ? error.message : 'Ошибка');
  } finally {
    busy = false;
    for (const button of root.querySelectorAll<HTMLButtonElement>('button'))
      button.disabled = false;
    syncSessionUi();
  }
});
async function boot(): Promise<void> {
  try {
    catalog = await api<Catalog>('/catalog');
    try {
      user = await api<User>('/auth/me');
    } catch {
      user = null;
    }
    if (user) {
      tab =
        user.role === 'candidate' ? 'assessments' : user.role === 'employer' ? 'needs' : 'admin';
      const [routeTab, assessmentId] = location.hash.slice(1).split('/');
      const allowedTabs =
        user.role === 'candidate'
          ? ['overview', 'assessments', 'results', 'cases', 'invitations', 'profile']
          : user.role === 'employer'
            ? ['needs', 'candidates', 'cases', 'invitations', 'profile']
            : ['admin'];
      if (routeTab && allowedTabs.includes(routeTab)) tab = routeTab;
      if (assessmentId && user.role === 'candidate') {
        try {
          selected = await api<Assessment>(`/assessments/${encodeURIComponent(assessmentId)}`);
        } catch {
          toast('Испытание недоступно. Выберите работу из истории.');
        }
      }
      await refresh();
    } else await render();
  } catch (error) {
    root.textContent = error instanceof Error ? error.message : 'Сервер недоступен';
  }
}
void boot();
