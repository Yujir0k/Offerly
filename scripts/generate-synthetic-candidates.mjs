// Offline only: scripted respondents run the unchanged professional engine.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { initialState } from '../lib/model.ts';
import { demoTracks } from '../lib/demo-tracks.ts';
import {
  answer,
  createSession,
  openEvidence,
  publicSession,
} from '../vendor/fsp-assessment/dist/src/adaptive/engine.js';
import { generatorVersion } from '../vendor/fsp-assessment/dist/src/generative/generator.js';
import { random } from '../vendor/fsp-assessment/dist/src/random.js';

const version = 'synthetic-specialists-1';
const output = '.data/synthetic-candidates';
const countPerGrade = Number(process.env.SYNTHETIC_PER_GRADE || 20);
assert(
  Number.isInteger(countPerGrade) && countPerGrade >= 1 && countPerGrade <= 100,
);
await mkdir(`${output}/snapshots`, { recursive: true });
await mkdir('data', { recursive: true });
const male = [
  'Алексей',
  'Дмитрий',
  'Михаил',
  'Артём',
  'Илья',
  'Максим',
  'Андрей',
  'Никита',
  'Павел',
  'Сергей',
  'Роман',
  'Егор',
  'Денис',
  'Владимир',
  'Тимур',
  'Виктор',
  'Константин',
  'Глеб',
  'Матвей',
  'Олег',
  'Лев',
  'Антон',
  'Иван',
  'Даниил',
  'Вадим',
  'Василий',
  'Григорий',
  'Борис',
  'Виталий',
  'Руслан',
];
const female = [
  'Анна',
  'Мария',
  'Елена',
  'Анастасия',
  'Дарья',
  'Полина',
  'Ольга',
  'Екатерина',
  'Ксения',
  'Софья',
  'Виктория',
  'Алина',
  'Татьяна',
  'Валерия',
  'Наталья',
  'Ирина',
  'Юлия',
  'Александра',
  'Вероника',
  'Светлана',
  'Надежда',
  'Евгения',
  'Яна',
  'Нина',
  'Лидия',
  'Марина',
  'Ульяна',
  'Диана',
  'Вера',
  'Алёна',
];
const surnames = [
  'Крылов',
  'Орлов',
  'Волков',
  'Соколов',
  'Белов',
  'Лебедев',
  'Захаров',
  'Морозов',
  'Новиков',
  'Романов',
  'Фомин',
  'Зайцев',
  'Поляков',
  'Савельев',
  'Тихонов',
  'Баранов',
  'Смирнов',
  'Давыдов',
  'Комаров',
  'Ковалёв',
  'Ермаков',
  'Кузнецов',
  'Макаров',
  'Никитин',
];
const cities = [
  ['Москва', 'Москва'],
  ['Санкт-Петербург', 'Санкт-Петербург'],
  ['Казань', 'Республика Татарстан'],
  ['Новосибирск', 'Новосибирская область'],
  ['Екатеринбург', 'Свердловская область'],
  ['Нижний Новгород', 'Нижегородская область'],
  ['Самара', 'Самарская область'],
  ['Пермь', 'Пермский край'],
  ['Воронеж', 'Воронежская область'],
  ['Уфа', 'Республика Башкортостан'],
  ['Краснодар', 'Краснодарский край'],
  ['Томск', 'Томская область'],
  ['Омск', 'Омская область'],
  ['Ростов-на-Дону', 'Ростовская область'],
  ['Тюмень', 'Тюменская область'],
  ['Владивосток', 'Приморский край'],
];
const domains = [
  'финтех',
  'образование',
  'логистика',
  'электронная коммерция',
  'корпоративные сервисы',
  'медиаплатформы',
];
const companyNames = [
  'Линия',
  'Север',
  'Маяк',
  'Контур данных',
  'Спектр',
  'Платформа',
  'Ритм',
  'Кодовые системы',
];
const end = Date.parse('2026-10-09T12:00:00Z');
const personaLevels = [
  [0.99, 0.99, 0.99, 0.99],
  [0.97, 0.98, 0.82, 0.9],
  [0.85, 0.96, 0.98, 0.98],
  [0.93, 0.99, 0.93, 0.88],
  [0.95, 0.91, 0.94, 0.98],
  [0.88, 0.95, 0.91, 0.9],
  [0.83, 0.86, 0.79, 0.82],
  [0.55, 0.68, 0.6, 0.5],
];
const dimensions = [
  'diagnosis',
  'correctness',
  'engineering_judgment',
  'adaptation',
];
let profiles = [],
  index = 0;
const report = [];
for (const [trackIndex, track] of demoTracks.entries()) {
  for (const [gradeIndex, grade] of ['Junior', 'Middle', 'Senior'].entries()) {
    let confirmed = 0;
    for (let local = 0; local < countPerGrade; local++, index++) {
      const key = `${track.id}-${grade.toLowerCase()}-${String(local + 1).padStart(2, '0')}`;
      const cache = `${output}/${key}.json`;
      let record;
      try {
        record = JSON.parse(await readFile(cache, 'utf8'));
      } catch {
        /* Generate missing records, never re-score saved ones. */
      }
      if (!record) {
        const seed = 712603 + index * 7919,
          rng = random(seed);
        const start =
          end - (local * 3 + gradeIndex * 11 + trackIndex * 2 + 1) * 86400000;
        const session = createSession(
          `${version}-${key}`,
          `synthetic-${key}`,
          grade,
          `${version}-${seed}`,
          start,
          undefined,
          undefined,
          { specialization: track.id },
        );
        const qualities = personaLevels[local % personaLevels.length];
        let now = start,
          steps = 0;
        while (session.state === 'active') {
          assert(steps++ < 45, `Unbounded assessment: ${key}`);
          const item = session.items[session.cursor.item].variant,
            step = item.steps[session.cursor.step];
          const quality =
            qualities[dimensions.indexOf(step.rubric.dimension)] || 0.9;
          now += 22000 + Math.floor(rng() * 19000);
          if (step.exploration) {
            const artifacts = [...item.artifacts].sort(
              (a, b) => b.usefulness - a.usefulness,
            );
            for (const [position, artifact] of artifacts
              .slice(0, step.requiredEvidenceSources || 2)
              .entries())
              openEvidence(
                session,
                item.id,
                step.id,
                artifact.id,
                now - 6000 + position * 1000,
              );
          }
          const choices = Object.entries(step.rubric.scores).sort(
            (a, b) => b[1] - a[1],
          );
          const correct = rng() < quality;
          const option = step.exploration
            ? 'continue'
            : choices[
                correct
                  ? 0
                  : Math.min(choices.length - 1, 1 + Math.floor(rng() * 2))
              ][0];
          // Executable plans use the same engine validation as the UI; forecast mistakes remain mistakes.
          answer(
            session,
            item.id,
            step.id,
            option,
            now,
            item.generated?.responseChecks?.[step.id]?.accepted[0],
          );
        }
        assert(session.result && session.state === 'completed');
        const view = publicSession(session, now),
          passed = session.result.decision === 'CONFIRMED';
        const score = Math.round(session.result.band.estimatedScore * 100);
        const source = JSON.stringify(session),
          snapshotHash = createHash('sha256').update(source).digest('hex');
        await writeFile(`${output}/snapshots/${key}.json.gz`, gzipSync(source));
        const woman = index % 2 === 1,
          nameIndex = Math.floor(index / 2) % male.length;
        const surname =
          surnames[Math.floor(index / 60) % surnames.length] +
          (woman ? 'а' : '');
        const firstName = (woman ? female : male)[nameIndex],
          name = `${firstName} ${surname}`;
        const skills = [
          ...track.stacks[(local + gradeIndex) % track.stacks.length],
        ];
        const [city, region] = cities[(index * 7 + local) % cities.length];
        const experience =
          gradeIndex === 0
            ? (local % 5) / 2
            : gradeIndex === 1
              ? 2 + (local % 5)
              : 5 + (local % 8);
        const salaryMin =
          [55000, 140000, 250000][gradeIndex] +
          (local % 7) * [10000, 15000, 20000][gradeIndex];
        const format = ['Удалённо', 'Удалённо', 'Гибрид', 'Офис'][local % 4];
        const project = track.projects[local % track.projects.length];
        const industry = domains[(local + trackIndex) % domains.length];
        const competitionResults = [];
        if (local % 5 < 3)
          for (let eventIndex = 0; eventIndex < 1 + (local % 3); eventIndex++) {
            const relevant = eventIndex !== 2 || local % 2 === 0;
            const other = demoTracks[(trackIndex + 3) % demoTracks.length];
            const eventTrack = relevant ? track : other;
            competitionResults.push({
              id: `synthetic-cup-${eventTrack.id}-${2024 + eventIndex}`,
              title: `${['Кубок инженерных решений', 'Командный хакатон', 'Открытый чемпионат'][eventIndex]} · ${eventTrack.specialty} (демо)`,
              date: `${2024 + eventIndex}-04-${String(10 + (local % 15)).padStart(2, '0')}`,
              discipline: [
                'data-engineering',
                'ml-engineer',
                'data-scientist',
                'mlops',
                'genai',
              ].includes(eventTrack.id)
                ? 'Анализ данных'
                : eventTrack.id === 'security-appsec'
                  ? 'Кибербезопасность'
                  : local % 4 === 0
                    ? 'Алгоритмическое программирование'
                    : 'Продуктовая разработка',
              specialties: [eventTrack.specialty],
              skills: [
                ...eventTrack.stacks[local % eventTrack.stacks.length],
              ].slice(0, 3),
              result: ['participation', 'prize', 'winner'][
                (local + eventIndex) % 3
              ],
              team: local % 4 !== 0,
              source: 'demo',
            });
          }
        const finishedAt = session.finishedAt;
        const profile = {
          ...initialState().profile,
          id: 0,
          name,
          firstName,
          lastName: surname,
          patronymic: '',
          initials: firstName[0] + surname[0],
          avatarKey: undefined,
          resumeKey: undefined,
          synthetic: {
            dataset: version,
            key,
            method: 'engine-simulation',
            engineVersion: generatorVersion,
          },
          headline: track.title,
          specialty: track.specialty,
          professionalDirection: track.direction,
          grade: passed ? grade : null,
          claimed: grade,
          skills,
          verified: [],
          score: passed ? score : 0,
          assessmentEvidence: passed
            ? {
                confirmedAt: finishedAt,
                assessmentVersion: session.assessmentVersion,
                scoringConfigVersion: session.result.scoringConfigVersion,
                dimensions: view.result.dimensions,
              }
            : undefined,
          city,
          country: 'Россия',
          region,
          preferredLocations:
            local % 5 === 0 ? ['Москва', 'Санкт-Петербург'] : [],
          relocation: local % 6 === 0,
          format,
          formats: local % 4 === 2 ? ['Гибрид', 'Удалённо'] : [format],
          experience,
          salaryMin,
          salaryMax: salaryMin + [30000, 50000, 80000][gradeIndex],
          bio: `${experience ? `Работаю в направлении ${track.direction}, опыт ${experience} лет.` : 'Начинаю профессиональный путь после обучения и проектной практики.'} Основной проект — ${project}. Интересны ${industry} и команды с понятными задачами. ${['Предпочитаю сначала разобраться в ограничениях, затем предложить решение.', 'Люблю работать с измеримыми результатами и обратной связью.', 'Уделяю внимание качеству выпуска и понятной документации.', 'Хочу развивать сложные сервисы вместе с командой.'][local % 4]}`,
          email: `${key}@example.test`,
          phone: '',
          fsp: competitionResults.length
            ? `DEMO-${String(index + 1).padStart(6, '0')}`
            : null,
          competitionResults,
          achievements: competitionResults.map(
            (event) =>
              `${event.title} · ${event.result === 'winner' ? 'победа' : event.result === 'prize' ? 'призовое место' : 'участие'}`,
          ),
          visible: true,
          consent: true,
          lastGradeChange: passed ? finishedAt : null,
          freshAt: finishedAt,
          jobStatus: 'open',
          industry: 'Разработка цифровых продуктов',
          preferredIndustries: [industry],
          roles: [track.title],
          softSkills: [
            ['Работа в команде', 'Самостоятельность'],
            ['Аналитическое мышление', 'Коммуникация'],
            ['Внимание к деталям', 'Ответственность'],
          ][local % 3],
          languages: [
            'Русский — родной',
            `Английский — ${['B1', 'B2', 'C1'][local % 3]}`,
          ],
          education: `${['Бакалавриат', 'Магистратура', 'Профессиональная переподготовка'][local % 3]} · ${['Программная инженерия', 'Прикладная информатика', 'Информационные системы'][trackIndex % 3]}. Демонстрационные сведения.`,
          notes: '',
          links: [],
          projects: `${experience ? 'В команде' : 'В учебном проекте'}: ${project}. Стек: ${skills.join(', ')}. ${['Добавлены проверки критических сценариев.', 'Подготовлены наблюдаемость и документация.', 'Разобраны ограничения и альтернативы решения.'][local % 3]}`,
          workHistory: experience
            ? [
                {
                  id: `${key}-job`,
                  company: `${companyNames[(local + trackIndex) % companyNames.length]} (демо)`,
                  role: track.title,
                  start: `${2026 - Math.ceil(experience)}-09`,
                  end: '',
                  current: true,
                  description: `${project[0].toUpperCase() + project.slice(1)}. Командная работа, ревью и поддержка выпуска.`,
                },
              ]
            : [],
          employment: 'Полная занятость',
          employmentTypes:
            local % 7 === 0
              ? ['Полная занятость', 'Проектная работа']
              : ['Полная занятость'],
          availability: [
            'В течение месяца',
            'Готов сейчас',
            'Через две недели',
          ][local % 3],
          availabilities: [
            ['В течение месяца'],
            ['Готов сейчас'],
            ['Через две недели'],
          ][local % 3],
        };
        record = {
          key,
          track: track.id,
          profile,
          assessment: {
            id: session.id,
            specialty: track.specialty,
            grade,
            questions: [],
            answers: {},
            score,
            passed,
            createdAt: session.startedAt,
            completedAt: finishedAt,
            previousGrade: null,
            categoryAfter: passed ? `${track.specialty} ${grade}` : null,
            formal: true,
            result: view.result,
            assessmentVersion: session.assessmentVersion,
            scoringConfigVersion: session.result.scoringConfigVersion,
            synthetic: true,
          },
          proof: {
            snapshotHash,
            steps: session.responses.length,
            answered: view.progress.answered,
            coreCompleted: view.coreCompleted,
            durationMs: now - start,
            generatorVersion,
          },
        };
        await writeFile(cache, JSON.stringify(record));
      }
      profiles.push(record);
      if (record.assessment.passed) confirmed++;
      if ((local + 1) % 5 === 0)
        console.log(
          `${track.id} ${grade}: ${local + 1}/${countPerGrade}, confirmed ${confirmed}`,
        );
    }
    report.push({
      track: track.id,
      specialty: track.specialty,
      grade,
      completed: countPerGrade,
      confirmed,
    });
  }
}
assert.equal(
  new Set(profiles.map((record) => record.profile.name)).size,
  profiles.length,
);
// Geographic variety is independent of track, grade and simulated performance.
profiles = profiles.map((record, position) => {
  const [city, region] = cities[(position * 7) % cities.length];
  return { ...record, profile: { ...record.profile, city, region } };
});
const dataset = {
  version,
  method:
    'Scripted respondents completed the unchanged engine; not human assessment or validation of hiring accuracy.',
  generatorVersion,
  createdAt: new Date().toISOString(),
  report,
  profiles,
};
await writeFile('data/synthetic-candidates-v1.json', JSON.stringify(dataset));
await writeFile(
  'qa/results/latest/synthetic-candidates-results.json',
  JSON.stringify(
    {
      version,
      generatorVersion,
      count: profiles.length,
      confirmed: profiles.filter((row) => row.assessment.passed).length,
      report,
    },
    null,
    2,
  ),
);
console.log(`DONE: ${profiles.length} completed engine simulations`);
