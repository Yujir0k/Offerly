import type { Assessment, Experiment, Question } from './domain.js';

/** Escape content before embedding it in the interface. */
export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  );
}
const e = escapeHtml;

/** Render a small, locally bundled line icon. */
export function icon(name: string): string {
  const paths: Record<string, string> = {
    home: '<path d="m3 10 9-7 9 7v10H3zM9 20v-7h6v7"/>',
    shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z"/><path d="m8 12 3 3 5-6"/>',
    folder: '<path d="M3 7V5h6l2 2h10v13H3z"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 6 9 7 9-7"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
    search: '<circle cx="10" cy="10" r="7"/><path d="m15 15 6 6"/>',
    chart: '<path d="M4 3v18h17M8 16v-4m5 4V7m5 9v-6"/>',
    arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
    back: '<path d="M20 12H4m6-6-6 6 6 6"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    exit: '<path d="M9 4H4v16h5m4-4 4-4-4-4M8 12h13"/>',
    code: '<path d="m8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 5m0 3h.01"/>',
  };
  return `<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">${paths[name] ?? paths.shield}</svg>`;
}

/** Preserve the logo and typography supplied in the Offerly archive. */
export function brand(): string {
  return '<span class="brand"><img src="/brand/original.svg" width="43" height="43" alt=""><span><strong>Офферли</strong><small>Дело найдёт.</small></span></span>';
}

/** Render an accessible heading shared by workspace screens. */
export function heading(eyebrow: string, title: string, description = '', action = ''): string {
  return `<div class="page-heading"><div><span class="eyebrow">${e(eyebrow)}</span><h1 tabindex="-1">${e(title)}</h1>${description ? `<p>${e(description)}</p>` : ''}</div>${action}</div>`;
}

/** Render an empty state with a useful next step. */
export function empty(title: string, description: string, symbol = 'shield'): string {
  return `<div class="card empty-state"><span class="empty-icon">${icon(symbol)}</span><h3>${e(title)}</h3><p>${e(description)}</p></div>`;
}

/** Render radio questions without exposing answers or private rubrics. */
export function theoryQuestions(questions: Question[]): string {
  return questions
    .map(
      (question, index) =>
        `<fieldset class="question-card"><legend><span class="question-number mono">${String(index + 1).padStart(2, '0')}</span>${e(question.prompt)}</legend>${question.scenario ? `<p class="question-scenario">${e(question.scenario)}</p>` : ''}${question.options.map((option) => `<label class="choice answer-choice"><input type="radio" name="${e(question.id)}" value="${e(option.id)}" required><span>${e(option.text)}</span></label>`).join('')}</fieldset>`,
    )
    .join('');
}

/** Present real experiment metrics and checks; raw details remain inspectable. */
export function experimentHtml(experiment: Experiment, latest: boolean): string {
  return `<details class="experiment-entry" ${latest ? 'open' : ''}><summary><span>Этап ${experiment.stage + 1} · ${e(experiment.at.slice(11, 19))}</span><span class="badge ${Object.values(experiment.checks).every(Boolean) ? 'success' : 'neutral'}">${Object.values(experiment.checks).filter(Boolean).length}/${Object.keys(experiment.checks).length} проверок</span></summary><div class="metric-grid">${Object.entries(
    experiment.metrics,
  )
    .map(
      ([name, value]) =>
        `<div class="metric"><span title="${e(name)}">${e(name)}</span><strong class="mono">${e(typeof value === 'number' ? Number(value.toFixed(4)).toLocaleString('ru-RU') : value)}</strong></div>`,
    )
    .join('')}</div><div class="check-list">${Object.entries(experiment.checks)
    .map(
      ([name, passed]) =>
        `<div class="check ${passed ? 'passed' : 'failed'}">${icon(passed ? 'check' : 'close')}<span>${e(name)}</span><small>${passed ? 'Пройдено' : 'Не пройдено'}</small></div>`,
    )
    .join(
      '',
    )}</div><p class="muted">${e(experiment.explanation)}</p><details class="raw-details"><summary>Параметры запуска</summary><pre>${e(JSON.stringify(experiment.input, null, 2))}</pre></details></details>`;
}

/** Render an honest report: automated evidence is distinct from expert validation. */
export function resultHtml(item: Assessment, skillName: (id: string) => string): string {
  const result = item.result!;
  const percent = Math.round((result.score / 90) * 100);
  return `<button class="secondary back-button" data-back>${icon('back')}К испытаниям</button>${heading('РЕЗУЛЬТАТ ПРОВЕРКИ', 'Ваше решение. Ваш следующий шаг.', `${item.variant.grade} · ${new Date(item.createdAt).toLocaleDateString('ru-RU')}`)}<div class="result-top"><div class="card score-card"><span class="eyebrow">ИТОГ ПОПЫТКИ</span><strong class="score mono">${percent}%</strong><span class="stat">${result.score}/90</span><p>Автоматическая оценка</p></div><div class="card"><span class="result-icon">${icon('shield')}</span><h2>${e(item.variant.grade)} · ${e(item.variant.title)}</h2><div class="result-meta"><div><small>Вы заявили</small><strong>${e(item.variant.grade)}</strong></div><div><small>По результатам симуляции</small><strong>${e(result.proposedGrade ?? 'Нужна подготовка')}</strong></div><div><small>Статус</small><strong>${result.status === 'not_confirmed' ? 'Не подтверждён' : 'Предварительный'}</strong></div></div><p class="muted">Открытое решение проверяет эксперт. Подтверждение профессионального уровня требует человеческой калибровки семейства.</p></div></div><div class="card"><div class="section-title"><h2>Результаты по компетенциям</h2><span class="badge neutral">Проверенные модули</span></div><p class="muted">Что удалось показать и где стоит продолжить практику.</p>${result.evidence.map((evidence) => `<div class="skill-evidence"><div class="skill-line"><strong>${e(skillName(evidence.skillId))}</strong><meter min="0" max="100" value="${evidence.score}" aria-label="${e(skillName(evidence.skillId))}">${evidence.score}/100</meter><span class="mono">${evidence.score}%</span></div><p class="muted">${e(evidence.explanation)}</p></div>`).join('')}</div><div class="grid"><div class="card"><h2>Обратная связь</h2>${result.feedback.map((text) => `<p>${e(text)}</p>`).join('')}</div><div class="card"><h2>Ваше обоснование</h2><p class="muted">Рекомендация на экспертную проверку</p><div class="prose">${e(item.recommendation)}</div></div></div>`;
}

/** Public screens use the original Offerly visual language and real entry points. */
export function landingHtml(tracks: number, families: number, development: boolean): string {
  return `<header class="public-header"><div class="nav-container"><a href="/" aria-label="Офферли — главная">${brand()}</a><nav aria-label="Главная навигация"><a class="how-link" href="#how-it-works">Как это работает</a><button class="nav-login" data-public="login">Войти</button><button class="btn primary nav-cta" data-public="register">Начать</button></nav></div></header><main><section class="hero"><img class="hero-motif motif-left" src="/brand/fsp.svg" alt=""><img class="hero-motif motif-right" src="/brand/fsp.svg" alt=""><div class="hero-content"><span class="eyebrow">НАВЫКИ ГОВОРЯТ ЗА ВАС</span><h1>Вы умеете.<br>Дело <span>найдёт.</span></h1><p class="hero-lead">Покажите, как вы решаете рабочие задачи.<br>Находите команды, которым нужен именно ваш опыт.</p><div class="hero-actions"><button class="btn primary large" data-public="register">Показать свои навыки ${icon('arrow')}</button><button class="btn outline large" data-public="employer">Найти кандидатов</button></div><div class="hero-notes"><span>${icon('shield')}Проверяемые результаты</span><span>${icon('mail')}Условия до общения</span><span>${icon('lock')}Контакты под контролем</span></div></div><div class="product-scene"><div class="product-preview"><div class="preview-sidebar">${brand()}<div><span class="active">${icon('shield')}Проверка навыков</span><span>${icon('chart')}Результаты</span><span>${icon('mail')}Приглашения</span></div><div class="preview-bottom">Ваше рабочее пространство</div></div><div class="preview-main"><span class="eyebrow">БЛИЖЕ К РЕАЛЬНОЙ РАБОТЕ</span><h2>Не просто правильный ответ.<br>Обоснованное решение.</h2><p class="muted">Исследуйте данные, проверьте гипотезу и адаптируйтесь, когда условия изменятся.</p><div class="preview-journey"><span>01 <strong>Подумать</strong></span><span>02 <strong>Проверить</strong></span><span>03 <strong>Объяснить</strong></span></div><div class="preview-proof">${icon('check')}Теория, эксперименты и открытое обоснование</div></div></div><p class="scene-caption">${tracks} специализаций · ${families} семейств рабочих задач</p></div></section><section class="steps-section section-wrap" id="how-it-works"><div class="section-heading"><span class="eyebrow">КАНДИДАТАМ</span><h2>От навыков —<br>к предложению.</h2><p>Пространство, в котором можно показать ход мысли.</p></div><div class="steps-grid">${[
    ['01', 'Выберите направление', 'Специализация, предполагаемый уровень и семейство задач.'],
    ['02', 'Пройдите испытание', 'Примите решения и проверьте их на исходных и изменённых данных.'],
    [
      '03',
      'Обсудите предложение',
      'Сопоставление по проверенным навыкам. Контакты откроются с вашего согласия.',
    ],
  ]
    .map(
      ([number, title, description]) =>
        `<article class="step"><div class="step-top"><span class="step-number mono">${number}</span>${icon('shield')}</div><h3>${title}</h3><p>${description}</p></article>`,
    )
    .join(
      '',
    )}</div></section><section class="employer-section"><div class="section-wrap employer-inner"><div><span class="eyebrow">РАБОТОДАТЕЛЯМ</span><h2>Задайте вектор.<br>Найдите своих.</h2><p>Выберите компетенции и их важность.<br>Платформа соберёт проверку под задачи команды.</p><button class="btn white large" data-public="employer">Начать подбор ${icon('arrow')}</button></div><div class="employer-example"><span class="eyebrow">ПОДБОР ПО СУЩЕСТВУ</span><h3>Приоритеты задаёте вы</h3><p>Специализация · Уровень · Обязательные навыки</p><div class="preview-proof">${icon('check')}Объяснимое соответствие потребности</div><div class="preview-proof">${icon('check')}Особые корпоративные кейсы</div><div class="preview-proof">${icon('check')}Зарплатный диапазон в приглашении</div></div></div></section>${development ? `<section class="demo-entry section-wrap"><span class="eyebrow">ПОСМОТРЕТЬ ИЗНУТРИ</span><h2>Попробуйте Офферли</h2><p>Локальные демонстрационные кабинеты. Все действия используют настоящее API.</p><div class="actions"><button data-demo="candidate">Кандидат</button><button class="secondary" data-demo="employer">Работодатель</button><button class="secondary" data-demo="admin">Эксперт</button></div></section>` : ''}</main><footer class="site-footer"><div>${brand()}</div><p>Офферли · Дело найдёт.</p><span>Семейства технически проверены. Уровни предварительные до человеческой калибровки.</span></footer>`;
}
