import type { Skill, Track, ToolMode } from './domain.js';
import { families } from './families/registry.js';

export const skills: Skill[] = [
  {
    id: 'validation',
    name: 'Валидация и доказательства',
    description: 'Корректное сравнение решений и обнаружение утечек.',
  },
  {
    id: 'experiments',
    name: 'Эксперименты',
    description: 'Проверка гипотез воспроизводимыми измерениями.',
  },
  {
    id: 'data',
    name: 'Качество данных',
    description: 'Происхождение, целостность и репрезентативность данных.',
  },
  {
    id: 'reliability',
    name: 'Надёжность',
    description: 'Повторная обработка, порядок событий и восстановление.',
  },
  {
    id: 'delivery',
    name: 'Эксплуатация',
    description: 'Версии, ограничения и безопасное внедрение.',
  },
  {
    id: 'retrieval',
    name: 'Retrieval и источники',
    description: 'Поиск актуальных подтверждённых сведений.',
  },
  {
    id: 'evaluation',
    name: 'Оценка качества',
    description: 'Метрики, сегменты и корректные критерии успеха.',
  },
  {
    id: 'cost',
    name: 'Ресурсы и стоимость',
    description: 'Выбор решения в условиях ограниченного бюджета.',
  },
  {
    id: 'reasoning',
    name: 'Профессиональное рассуждение',
    description: 'Обоснованные решения и границы применимости.',
  },
  {
    id: 'communication',
    name: 'Передача результата',
    description: 'Рекомендация, доказательства, ограничения и следующий шаг.',
  },
];
export const tracks: Track[] = [
  {
    id: 'data-science',
    name: 'Data Scientist · табличные данные',
    skills: ['validation', 'experiments', 'data', 'reasoning'],
    lab: 'classification',
    focus: 'утечка данных в оценке модели',
  },
  {
    id: 'ml-engineering',
    name: 'ML Engineer',
    skills: ['validation', 'experiments', 'delivery', 'cost'],
    lab: 'classification',
    focus: 'воспроизводимый пайплайн и признаки на момент inference',
  },
  {
    id: 'mlops',
    name: 'MLOps / ML Platform',
    skills: ['reliability', 'delivery', 'data', 'reasoning'],
    lab: 'events',
    focus: 'обновления реестра моделей с повторами и нарушением порядка',
  },
  {
    id: 'llm',
    name: 'NLP / LLM Engineer',
    skills: ['retrieval', 'evaluation', 'cost', 'reasoning'],
    lab: 'retrieval',
    focus: 'приёмка retrieval по актуальности источников и неизвестным вопросам',
  },
  {
    id: 'cv',
    name: 'Computer Vision',
    skills: ['validation', 'data', 'evaluation', 'experiments'],
    lab: 'classification',
    focus: 'оценка на новых камерах и проверка shortcut-признаков',
  },
  {
    id: 'ranking',
    name: 'Recommendation / Ranking',
    skills: ['evaluation', 'validation', 'experiments', 'data'],
    lab: 'classification',
    focus: 'временная корректность признаков и offline-оценки',
  },
  {
    id: 'research',
    name: 'Research ML',
    skills: ['experiments', 'validation', 'evaluation', 'reasoning'],
    lab: 'classification',
    focus: 'ablation и проверка заявленного улучшения',
  },
  {
    id: 'backend',
    name: 'Backend',
    skills: ['reliability', 'data', 'delivery', 'reasoning'],
    lab: 'events',
    focus: 'приёмка обработчика платежных событий',
  },
  {
    id: 'frontend',
    name: 'Frontend',
    skills: ['reliability', 'evaluation', 'delivery', 'reasoning'],
    lab: 'events',
    focus: 'гонка сетевых ответов и устаревшее состояние интерфейса',
  },
  {
    id: 'data-engineering',
    name: 'Data Engineer',
    skills: ['data', 'reliability', 'delivery', 'experiments'],
    lab: 'events',
    focus: 'повторная загрузка и версии записей',
  },
  {
    id: 'qa',
    name: 'QA / SDET',
    skills: ['evaluation', 'reliability', 'experiments', 'reasoning'],
    lab: 'events',
    focus: 'контрпримеры для обработки событий',
  },
  {
    id: 'sre',
    name: 'DevOps / SRE',
    skills: ['reliability', 'delivery', 'cost', 'reasoning'],
    lab: 'events',
    focus: 'восстановление согласованного состояния после инцидента',
  },
  {
    id: 'analytics',
    name: 'Аналитик данных',
    skills: ['evaluation', 'data', 'experiments', 'reasoning'],
    lab: 'classification',
    focus: 'проверка завышенной метрики и корректного разбиения',
  },
];
export const llmProfiles: Record<
  ToolMode,
  {
    name: string;
    model: string | null;
    inputRate: number;
    outputRate: number;
    maxTokens: number;
    calls: number;
  }
> = {
  closed: { name: 'Без ИИ', model: null, inputRate: 0, outputRate: 0, maxTokens: 0, calls: 0 },
  docs: {
    name: 'Документация, без ИИ',
    model: null,
    inputRate: 0,
    outputRate: 0,
    maxTokens: 0,
    calls: 0,
  },
  hint: {
    name: 'Справочный помощник',
    model: 'aliceai-llm-flash',
    inputRate: 100,
    outputRate: 200,
    maxTokens: 300,
    calls: 3,
  },
  local: {
    name: 'Локальный помощник',
    model: 'qwen3.6-35b-a3b',
    inputRate: 200,
    outputRate: 300,
    maxTokens: 700,
    calls: 5,
  },
  extended: {
    name: 'Расширенный помощник',
    model: 'deepseek-v4.1-flash',
    inputRate: 300,
    outputRate: 500,
    maxTokens: 1100,
    calls: 5,
  },
};
for (const track of tracks)
  track.skills = [
    ...new Set([
      ...track.skills,
      ...families
        .filter((family) => family.trackId === track.id)
        .flatMap((family) => family.skills),
    ]),
  ];
/** Finds a supported specialization. */
export function getTrack(id: string): Track {
  const track = tracks.find((item) => item.id === id);
  if (!track) throw new Error('Неизвестная специализация');
  return track;
}
/** Describes actual practical coverage, keeping theoretical and unsupported skills separate. */
export function familyCoverage(
  track: Track,
  familyId?: string,
): { practical: string[]; theoretical: string[]; additionalChecksNeeded: string[] } {
  const selected = families.filter(
    (family) => family.trackId === track.id && (!familyId || family.id === familyId),
  );
  const measured = [...new Set(selected.flatMap((family) => family.skills))];
  const theoretical = [
    ...new Set(
      selected.flatMap((family) => family.build('Middle', 1).theory.map((item) => item.skill)),
    ),
  ];
  return {
    practical: track.skills.filter((skill) => measured.includes(skill)),
    theoretical,
    additionalChecksNeeded: track.skills.filter((skill) => !measured.includes(skill)),
  };
}
