export const defaultCandidateFilters = {
  needId: '',
  taskOrigin: false,
  spec: 'Все',
  grade: 'Все',
  grades: [] as string[],
  query: '',
  skills: [] as string[],
  desiredSkills: [] as string[],
  stack: '',
  location: '',
  formats: [] as string[],
  salaryMin: '',
  salaryMax: '',
  experienceMin: '',
  experienceMax: '',
  fsp: false,
  relevantFsp: false,
  savedOnly: false,
  confirmation: 'all',
  includeUnconfirmed: true,
  skillSource: 'profile',
  testMin: '',
  discipline: '',
  task: 'balanced',
  tasks: [] as string[],
  sort: 'Тест + ФСП',
  suggestRelaxations: true,
};
export type CandidateFilters = typeof defaultCandidateFilters;
export const candidateOrderOptions = [
  { value: 'Тест + ФСП', label: 'Баланс результатов теста и ФСП' },
  { value: 'По результату теста', label: 'Сначала результаты теста' },
  { value: 'По достижениям ФСП', label: 'Сначала достижения ФСП' },
  { value: 'По дате подтверждения', label: 'Сначала свежие результаты теста' },
  { value: 'По зарплате', label: 'Сначала меньшие зарплатные ожидания' },
];
/** Describe the current ordering in language shared by search and comparison. */
export function candidateOrderLabel(value: string): string {
  return (
    candidateOrderOptions.find((option) => option.value === value)?.label ||
    candidateOrderOptions[0].label
  );
}
/** Count active conditions without treating ordering as an exclusion filter. */
export function candidateFilterCount(f: CandidateFilters): number {
  return [
    f.needId,
    f.spec !== 'Все',
    (f.grade && f.grade !== 'Все') || !!f.grades?.length,
    f.skills.length > 0,
    f.desiredSkills.length > 0,
    f.location,
    f.formats.length > 0,
    f.salaryMin || f.salaryMax,
    f.experienceMin || f.experienceMax,
    f.confirmation !== 'all',
    f.skillSource === 'verified',
    f.testMin,
    f.fsp,
    f.relevantFsp,
    f.discipline,
    f.task !== 'balanced' || !!f.tasks?.length,
  ].filter(Boolean).length;
}
