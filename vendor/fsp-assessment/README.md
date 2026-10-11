# Офферли — платформа профессиональных испытаний

Текущая ревизия **7.3.3**: исполняемые переходы без готовых флагов безопасности, прогноз последствий отдельно от выбранного плана, различение соседних уровней при выборе независимых дополнительных кейсов. Свежий парный holdout: Junior **95,69% → 95,69%**, Middle **82,50% → 85,14%**, Senior **83,33% → 83,33%** относительно 7.2.7. Это условные результаты синтетической модели, не точность на реальных людях. [Актуальный итог и ограничения](docs/ASSESSMENT_FINAL_7_3_3.md), [запуск на другом компьютере](PORTABLE_START.md), [передача следующему агенту](AGENT_HANDOFF.md). Сводка также доступна admin в «Качество и валидация».

Историческая 7.2.7 и предшествующий эксперимент: [отчёт](docs/ASSESSMENT_FINAL_7_2_7.md), [ручное прохождение 36 сессий 7.2.6](docs/ASSESSMENT_MANUAL_36_REVIEW.md). Дополнительно разобраны [24 задачи переходов 7.3.2](docs/ASSESSMENT_TRANSITION_REVIEW_7_3_2.md). Подбор формы из трёх отключён: исправленный development показал ухудшение. Старые серии с ошибкой передачи плана workers сохранены и явно отмечены; их нельзя выдавать за свежий holdout.

Историческая 7.1.1 вводила веса сложности и показывала регрессию Senior; исходники и невыгодные результаты сохранены: [отчёт 7.1.1](docs/ASSESSMENT_SCORING_7_1_1_RESULTS.md).

[Итоговые исправления и результаты проверки 7.0.2](docs/ASSESSMENT_FINAL_7_0_2.md): 225/225 tests, 0 повторов на 3850 вопросов в 360 последовательных сессиях; отдельно сохранены paired scoring comparison и sensitivity analysis.

В предыдущей ревизии **formal-generator-7.0.2** исправлены зависевшие от shuffle частичные баллы Backend и повторы отдельных вопросов. Исторические исходники и результаты сохранены. Новое парное исследование весов запускает `node scripts/validate-difficulty-scoring.mjs --output <new-output>` после `pnpm build`; оно отдельно проверяет ablations, новые seed и sensitivity. `pnpm validate:assessment:revision` относится к историческому сравнению исправлений рубрики; его режим `--issuance-only` используется также для проверки реальной выдачи. Проверка повторов: `node scripts/verify-question-diversity.mjs <issuance-output>`. Все команды проверки отказываются перезаписывать сохранённые результаты.

Локальная работающая версия механики тестирования ФСП. TypeScript в строгом режиме, Node.js 22.17+, SQLite из `node:sqlite`. Каталог включает 13 специализаций и 26 отдельных профессиональных семейств с собственными данными, алгоритмами и критериями. Это не полная сертификация всех специализаций.

Основная проверка квалификации — generative multistage assessment для 12 активных специализаций: обязательные сценарии, расследование инцидента, Review & Adapt и при необходимости целевые независимые проверки; Senior имеет отдельный обязательный judgment probe. Формальные ItemModels создают WorldState, ground truth и согласованные артефакты без runtime LLM; новые задания проходят validators и exposure control. Серверный hard cap — 20 минут. Кандидат сам выбирает Junior/Middle/Senior; результат подтверждает или не подтверждает этот уровень. Четыре dimensions, веса сложности и предварительный decision band заменяют простой процент правильных вариантов. [Актуальные правила и результаты](docs/ASSESSMENT_FINAL_7_3_3.md).

На основном адресе запускается **исходный React/Vinext-интерфейс из `Offerly-local-2026-10-05.zip`**. CSS сайта, лендинг, регистрация и бренд сохранены. Профиль дополнен статусом подтверждения и явно смоделированными достижениями ФСП. Используются уже объявленные зависимости архивного проекта. [Описание интеграции](docs/OFFERLY.md).

## Запуск

```powershell
pnpm install --frozen-lockfile
pnpm build
pnpm validate
cd offerly-web
pnpm install --frozen-lockfile
pnpm run setup:local
cd ..
pnpm start
```

Открыть <http://127.0.0.1:4310>. Вход и переключение ролей работают как в оригинальном локальном прототипе. Проверка навыков — `/demo/candidate/assessment`, подборки — `/demo/employer/needs`, экспертная очередь — `/demo/employer/quality`. Интерфейс остаётся приватной демонстрацией с синтетическими профилями; локальный вход не является production-авторизацией.

API испытаний работает на 4313 через same-origin прокси. Его development-аккаунты: `candidate@demo.local`, `employer@demo.local`, `admin@demo.local`; пароль `Demo2026!pass`. База испытаний — `data/platform.sqlite`; исходные кабинеты и черновики — `offerly-web/.wrangler/state`. Рабочие данные не удаляются при запуске.

Сквозной сценарий: кандидат выбирает специализацию и заявленный уровень → проходит обязательные этапы последовательно → открывает источники evidence → при необходимости получает дополнительную проверку → видит отчёт по четырём dimensions → результат сохраняется в профиле → работодатель просматривает подтверждённые категории и отправляет предложение. Старые испытания и корпоративные кейсы сохранены для совместимости.

## Рабочие возможности

`pnpm test:restored` проверяет оригинальный интерфейс: контрольные суммы дизайн-файлов, все 26 семейств, приоритеты работодателя, корпоративные кейсы и экспертную проверку. Этот набор использует изолированные API и D1 на портах 4314/4315; рабочие данные не изменяются. `pnpm test:e2e` оставлен для регрессий прежнего клиента API.

- Каталог специализаций и компетенций; роли кандидат / работодатель / эксперт.
- Воспроизводимые параметризованные варианты, перестановка вариантов ответа, сценарии с ошибочным и корректным предложением ИИ.
- Теория без ИИ, практический этап с выбранным помощником, изменённые условия с документацией.
- Два самостоятельных семейства для каждой специализации: от NMS и IPS до CDC, canary, интерфейсных гонок и A/B. [Каталог и критерии](docs/FAMILIES.md).
- Конфигурируемые планы, реальные числовые расчёты и изменение данных на втором практическом этапе.
- Старые три лаборатории сохранены для совместимости ранее созданных испытаний.
- Структурированная потребность работодателя без LLM: навыки и веса выбирают подходящее семейство, работодатель может ограничить список семейств.
- Корпоративные кейсы: материалы, вопросы, рубрика, параметры вида `days=3:20`, подстановка `{{days}}`, публикация, сдача и экспертная проверка. Экспериментальные кейсы не меняют общий грейд.
- Предварительные результаты и доказательства; экспертная проверка открытых рекомендаций.
- Обработка отсутствия истории ФСП; самостоятельно указанный ID не выдаётся за верифицированное достижение.
- Приглашения с зарплатой и разграничением контактов.
- Пилотные наблюдения и описательный отчёт валидации.
- OpenAPI 3.1: `/api/openapi.json`.

## Проверки

```powershell
pnpm test
pnpm validate
pnpm validate:adaptive
pnpm format:check
# При установленном Microsoft Edge; отдельный тестовый сервер запускается автоматически:
pnpm test:e2e
```

`pnpm validate` проверяет legacy-варианты и переходы. `pnpm validate:adaptive` моделирует 480 multistage sessions; отчёт: `data/adaptive-validation.json`. 121 модульный/API-тест и 49 restored browser scenarios проверяют движок, flow и совместимость. Итоговый корпус: 100 Backend Middle sessions / 1000 items и по 30 сессий / 180 items для Backend Junior/Senior, Frontend Middle и DevOps/SRE Middle — без итоговых ошибок и точных дубликатов. Ручной sample — 50 items по восьми критериям. [Результаты проверки](docs/ASSESSMENT_QUALITY_VERIFICATION.md). Browser QA использует изолированные базы. Проверки не доказывают психометрическую валидность или фактическую длительность прохождения людьми. Semantic reuse Middle — 81.4%: банк причинных конфигураций конечен. Общий frontend lint содержит прежние нарушения; изменённые assessment-компоненты проверены отдельно без ошибок.

## LLM

По умолчанию live LLM выключена. Помощник возвращает явно помеченную локальную справку. Ключ из переписки не записан в проект и не используется автоматически.

Для будущего подключения скопировать `.env.example` в `.env`, задать `YANDEX_API_KEY`, `YANDEX_FOLDER_ID`, затем явно включить `LLM_LIVE_ENABLED=true` и перезапустить сервер. Секрет не отправляется в браузер. Live-адаптер ещё не проверен на реальных запросах; возможны различия параметров и usage провайдера.

Профили: Alice AI LLM Flash для короткой справки, Qwen3.6 35B для локальной помощи, DeepSeek V4.1 Flash для расширенной помощи. Модель, число обращений, выходной лимит и передаваемый контекст определяются профилем. Ограничение инструкции помощнику не гарантирует, что модель не решит задачу.

## Архитектура

`families/` — профессиональные генераторы, вычислительные процедуры и реестр; `domain.ts` — контракты; `catalog.ts` — роли и ресурсы; `generator.ts` — варианты; `simulator.ts` — эксперименты; `scoring.ts` — доказательства; `store.ts` — SQLite, аккаунты и сессии; `assistant.ts` — помощь по профилю задания; `calibration.ts` — пилот; `server.ts` — API; `client.ts` — сменяемый интерфейс.

Лаборатории выполняют ограниченные алгоритмы платформы. Произвольный код кандидата на сервере не исполняется. Для полноценного notebook/SQL/code runner нужен отдельный изолированный executor; `node:vm` не следует использовать как защитную песочницу.

Добавлен Dockerfile для локального контейнера; сборка Docker в этой среде не проверялась. При запуске публикуйте порт только на loopback: `docker run -p 127.0.0.1:4310:4310 -v fsp-data:/app/data fsp-assessment`. Сначала соберите образ командой `docker build -t fsp-assessment .`.

Подробнее: [каталог семейств](docs/FAMILIES.md), [состояние реализации](docs/STATUS.md), [процедура валидации](docs/VALIDATION.md).

Последние изменения assessment: [качество содержания и UI](docs/ASSESSMENT_QUALITY.md), [результаты проверок](docs/ASSESSMENT_QUALITY_VERIFICATION.md), [ручной разбор 50 заданий](docs/ASSESSMENT_QUALITY_MANUAL_REVIEW.md). Backend теперь содержит 16 формальных моделей; генерация не вызывает LLM. В экспертной панели доступен JSON экспорт данных для пилота.

## Новые профессиональные треки

Адаптивная проверка включает Frontend, DevOps/SRE, QA/Automation, Data Engineering, четыре самостоятельных ML/AI трека, Android, iOS и Security/AppSec. Сохранены все 181 исходная модель. После audit поддержки грейдов добавлены три ограниченные Junior модели для QA, ML Engineer и Data Scientist; всего 184. Повторные попытки доступны сразу.

[Профессиональные blueprints](SPECIALIZATION_BLUEPRINTS.md), [отчёт исходного этапа v4](docs/SPECIALIZATION_VERIFICATION.md), [редакторское чтение 220 заданий v4](docs/SPECIALIZATION_MANUAL_REVIEW.md). Исходный этап проверен 148 unit tests, 61 browser regression tests и 1 680 массовыми сессиями. Новые пакеты требуют независимого экспертного пилота.

Генератор v7 вводит перекрывающиеся GradeProfile configurations, профессиональную progression и domain-native decision catalogs. Все 181 исходная ItemModel получили explicit supportedGrades и rationale. Universal Senior strategy template удалён. Junior работает с локальными facts; Middle связывает состояния и источники workflow; Senior выбирает стратегию с последствиями при нескольких допустимых решениях. Количество исправлений определяется WorldState. Композиция этапов профессиональная, anchors используют floor/core/ceiling bands; таймер, progress, immutable target grade и unlimited retries сохранены.

[Модель грейдов](GRADE_MODEL.md), [blueprints всех направлений](SPECIALIZATION_BLUEPRINTS.md), [структурные результаты и triplets](docs/GRADE_VERIFICATION.md), [полный отчёт переработки](docs/GRADE_REFACTOR_REPORT.md), [защита от переноса планов](docs/LEAK_RESISTANCE.md). Фактическую трудность, равнозначность вариантов и достаточность 20 минут необходимо подтвердить человеческим пилотом; программные проверки не заменяют калибровку. [Исторический отчёт v5](docs/LEAK_RESISTANCE_V5.md) не описывает текущие правила грейдов.

## Границы production

Сервер по умолчанию слушает loopback. Есть scrypt, HttpOnly/SameSite-сессии, проверка Origin, лимиты запросов и скрытие oracle. Для промышленного запуска нужны доставка email, HTTPS/reverse proxy, резервное копирование, внешний executor, нагрузочные проверки, полноценные каталоги и человеческая калибровка. В production регистрация выключена до подключения доставки писем; сервер отказывается использовать демонстрационную базу.

`node:sqlite` в Node.js 22 отмечен experimental. Многопроцессное масштабирование и миллион пользователей не проверены. Микросервисная миграция и production-развёртывание не выполнены.

## Проверки targeted refactor v7

`pnpm verify:grades` генерирует 50 Junior / 100 Middle / 50 Senior сессий на каждый track и сохраняет GRADE_DIMENSION_DISTRIBUTION, DECISION_ARCHETYPE_DISTRIBUTION и GRADE_SUPPORT_AUDIT в `data/grade-verification`. `pnpm verify:transfer` разделяет sibling/same-family/cross-family/cross-specialization переносы конкретного плана. `pnpm lint:assessment` проверяет assessment engine отдельно от прежних frontend lint errors; нужны установленные зависимости offerly-web. Для macOS с Chrome доступен `pnpm test:restored:local`; исходная Edge-конфигурация сохранена. Итог: [GRADE_REFACTOR_REPORT](docs/GRADE_REFACTOR_REPORT.md).

## Synthetic validation baseline

`pnpm validate:synthetic` runs an additional independent local competency simulator through the actual assessment engine. Defaults: all 12 tracks, 22 personas per track, three target grades and 500 seeds per cohort (396,000 sessions). Results are preserved in `data/synthetic-validation/baseline`; policy and production versions, deterministic action digests, adversarial profiles, item diagnostics and metamorphic checks are included. Production scoring is not calibrated against synthetic outcomes.

Use `pnpm validate:synthetic --seeds 8 --item-seeds 4 --output data/synthetic-validation/smoke --skip-metamorphic --no-doc` for a quick smoke run, `pnpm test:synthetic` for policy tests, and `pnpm validate:metamorphic` for mutation checks. See [harness design and commands](docs/SYNTHETIC_VALIDATION_HARNESS.md) and [baseline results](docs/SYNTHETIC_VALIDATION_REPORT.md). These simulations do not establish real human grade accuracy, wording quality or fairness.

The original synthetic baseline is now locked. `pnpm validate:synthetic` writes subsequent runs into a separate `new-run` directory. `pnpm validate:synthetic:decomposition` adds frozen Oracle controls and the four paired answer/evidence interventions on the original seeds. See [Oracle/decomposition diagnosis](docs/SYNTHETIC_DECOMPOSITION_REPORT.md); review it before attributing synthetic failures to assessment quality. Production scoring remains unchanged.
