import { canonicalSuggestion, skillCatalog } from './suggestion-catalogs';

type SkillNode = {
  name: string;
  aliases: readonly string[];
  technologies: readonly string[];
};

// Synonym edges identify a node; specialization edges mean any one technology.
export const skillOntology: readonly SkillNode[] = [
  {
    name: 'PostgreSQL или MySQL',
    aliases: [
      'реляционная база данных',
      'реляционные базы данных',
      'реляционная база',
      'реляционные базы',
      'реляционка',
      'рсубд',
    ],
    technologies: ['PostgreSQL', 'MySQL'],
  },
  {
    name: 'RabbitMQ или Kafka',
    aliases: [
      'очереди сообщений',
      'очередь сообщений',
      'брокеры сообщений',
      'брокер сообщений',
      'брокеры',
      'брокер',
    ],
    technologies: ['RabbitMQ', 'Kafka'],
  },
  {
    name: 'Redis',
    aliases: ['кэширование', 'кеширование', 'кэш', 'кеш'],
    technologies: ['Redis'],
  },
  {
    name: 'Docker',
    aliases: ['контейнеризация', 'контейнеры', 'контейнер'],
    technologies: ['Docker'],
  },
  {
    name: 'Go',
    aliases: ['го', 'гошка', 'гошке', 'гошку'],
    technologies: ['Go'],
  },
  {
    name: 'PostgreSQL',
    aliases: ['постгрес', 'постгреса', 'постгресе'],
    technologies: ['PostgreSQL'],
  },
  {
    name: 'PHP',
    aliases: ['пыха', 'пыхе', 'пыхи', 'пыху'],
    technologies: ['PHP'],
  },
  {
    name: 'Node.js',
    aliases: ['нода', 'ноде', 'ноды', 'ноду'],
    technologies: ['Node.js'],
  },
];
const normalize = (value: string) =>
  value.trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');

/** Canonicalize a synonym without pretending that a category proves every specialization. */
export function canonicalSkillName(value: string): string {
  const key = normalize(value);
  const node = skillOntology.find((entry) =>
    [entry.name, ...entry.aliases].some((alias) => normalize(alias) === key),
  );
  return node?.name || canonicalSuggestion(skillCatalog, value.trim());
}

/** Resolve the local graph into a bounded OR group; arbitrary names remain exact requirements. */
export function skillAlternatives(value: string): string[] {
  const canonical = canonicalSkillName(value);
  return [
    ...(skillOntology.find((entry) => entry.name === canonical)
      ?.technologies || [canonical]),
  ];
}

/** Match one requirement against actual declared or verified technologies. */
export function matchesSkill(
  requirement: string,
  actual: readonly string[],
): boolean {
  const keys = actual.map((value) => normalize(canonicalSkillName(value)));
  return skillAlternatives(requirement).some((value) =>
    keys.includes(normalize(value)),
  );
}
