import type { Profile } from './model';
import { money } from './model';
const list = (values: string[] | undefined, fallback = '') => values?.filter(Boolean).length ? [...new Set(values.filter(Boolean))].join(', ') : fallback || 'Не указано';
const normalized = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru');
const listKey = (values: string[]) => [...new Set(values.map(normalized).filter(Boolean))].sort().join('|');
export type ComparisonField = { id: string; label: string; value: (p: Profile) => string; key?: (p: Profile) => string };
const arrayField = (id: string, label: string, values: (p: Profile) => string[]): ComparisonField => ({ id, label, value:p=>list(values(p)), key:p=>listKey(values(p)) });
const fallbackList = (values: string[] | undefined, fallback: string) => values?.length ? values : [fallback];
export function candidateExperience(years: number) {
  if (!years) return 'Без коммерческого опыта';
  const form = !Number.isInteger(years) ? 'года' : years % 100 >= 11 && years % 100 <= 14 ? 'лет' : years % 10 === 1 ? 'год' : years % 10 >= 2 && years % 10 <= 4 ? 'года' : 'лет';
  return `${new Intl.NumberFormat('ru-RU').format(years)} ${form}`;
}
export const comparisonFields: ComparisonField[] = [
  {id:'specialty',label:'Специализация',value:p=>p.specialty || 'Не указано'},
  {id:'grade',label:'Уровень',value:p=>p.grade || `${p.claimed || 'Не указан'} · без подтверждения`},
  {id:'score',label:'Результат проверки',value:p=>p.grade ? `${p.score} / 100` : 'Нет подтверждённого результата'},
  arrayField('skills','Навыки в профиле',p=>p.skills),
  arrayField('verified','Подтверждённые навыки',p=>p.verified),
  {id:'salary',label:'Ожидания, ₽/мес',value:p=>`${money(p.salaryMin)} — ${money(p.salaryMax)}`},
  {id:'city',label:'Город',value:p=>p.city || 'Не указано'},
  arrayField('locations','Желаемые локации',p=>p.preferredLocations || []),
  arrayField('formats','Формат работы',p=>fallbackList(p.formats,p.format)),
  arrayField('employment','Занятость',p=>fallbackList(p.employmentTypes,p.employment)),
  arrayField('availability','Готовность выйти',p=>fallbackList(p.availabilities,p.availability)),
  {id:'experience',label:'Опыт',value:p=>candidateExperience(p.experience)},
  {id:'relocation',label:'Переезд',value:p=>p.relocation ? 'Готов к переезду' : 'Не указан'},
  {id:'fsp',label:'Достижения ФСП',value:p=>list(p.achievements, p.competitionResults?.map(e=>`${e.title} · ${e.result==='winner'?'победа':e.result==='prize'?'призовое место':'участие'}`).join('; ') || 'Нет сведений об участии')},
  arrayField('roles','Профессиональные роли',p=>p.roles || []),
  arrayField('industries','Интересующие сферы',p=>fallbackList(p.preferredIndustries,p.industry)),
  arrayField('softSkills','Гибкие навыки',p=>p.softSkills || []),
  arrayField('languages','Языки',p=>p.languages || []),
  {id:'education',label:'Образование',value:p=>p.education || 'Не указано'},
  {id:'projects',label:'Проекты',value:p=>p.projects || 'Не указано'},
  {id:'bio',label:'О себе',value:p=>p.bio || 'Не указано'},
  {id:'workHistory',label:'Места работы',value:p=>p.workHistory?.map(w=>`${w.role} · ${w.company} · ${w.start}–${w.current?'по настоящее время':w.end}`).join('; ') || 'Не указано'},
  {id:'contacts',label:'Контакты',value:p=>[p.email,p.phone].filter(Boolean).join(' · ') || 'Закрыты до согласия'},
];
export const defaultComparisonFields = ['specialty','grade','score','skills','verified','salary','city','formats','experience','fsp'];
export function visibleComparisonFields(profiles: Profile[], selected: string[], differencesOnly: boolean) {
  return comparisonFields.filter(field=>selected.includes(field.id) && (!differencesOnly || new Set(profiles.map(p=>field.key ? field.key(p) : normalized(field.value(p)))).size > 1));
}
