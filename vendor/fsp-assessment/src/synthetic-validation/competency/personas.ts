import { professionalRubric, facets, type Mastery, type Facet } from './rubrics.js';
import { seedOf } from '../math.js';

export interface CompetencyPersona {
  id: string;
  track: string;
  latentClass: 'Junior' | 'Middle' | 'Senior' | 'borderline' | 'adversarial';
  order: number | null;
  mode: 'professional' | 'random' | 'keyword' | 'memorizer' | 'overengineer' | 'specialist';
  mastery: Record<string, Record<Facet, Mastery>>;
  diagnosticOverride?: Mastery;
  adaptationOverride?: Mastery;
  strategicOverride?: Mastery;
  specialistDomain?: string;
  derivation: string;
}
export type BlindPersona = Omit<CompetencyPersona, 'latentClass' | 'order' | 'derivation'>;
const spectrum = [
  ['clear_junior', 'Junior'],
  ['upper_junior', 'Junior'],
  ['junior_middle_borderline', 'borderline'],
  ['lower_middle', 'Middle'],
  ['clear_middle', 'Middle'],
  ['upper_middle', 'Middle'],
  ['middle_senior_borderline', 'borderline'],
  ['lower_senior', 'Senior'],
  ['clear_senior', 'Senior'],
] as const;
/** Exact mastery quotas encode the rubric's behavioral anchors; no scalar ability. */
export function competencyPersonas(track: string): CompetencyPersona[] {
  const rubric = professionalRubric(track);
  const capabilities = [...rubric.capabilities].sort(
    (a, b) => seedOf(track, a.id, 'mastery-allocation') - seedOf(track, b.id, 'mastery-allocation'),
  );
  const core = capabilities.filter((c) => c.middleTier === 'core');
  const upper = capabilities.filter((c) => c.middleTier === 'upper');
  const build = (id: string): CompetencyPersona => ({
    id,
    track,
    latentClass: 'adversarial',
    order: null,
    mode: 'professional',
    mastery: Object.fromEntries(
      capabilities.map((c) => [
        c.id,
        { bounded: 'stable', integrated: 'weak', strategic: 'not_expected' },
      ]),
    ),
    derivation: '',
  });
  const fill = (persona: CompetencyPersona, facet: Facet, value: Mastery) => {
    for (const c of capabilities) persona.mastery[c.id]![facet] = value;
  };
  const assign = (
    persona: CompetencyPersona,
    list: typeof capabilities,
    facet: Facet,
    count: number,
    value: Mastery,
  ) => {
    for (const c of list.slice(0, count)) persona.mastery[c.id]![facet] = value;
  };
  const personas = spectrum.map(([id, latentClass], order) => {
    const p = build(id);
    p.latentClass = latentClass;
    p.order = order;
    if (order === 0) {
      fill(p, 'bounded', 'moderate');
      assign(p, capabilities, 'bounded', 16, 'stable');
      p.derivation = '16/18 bounded stable, 2 moderate; integrated weak; strategy not expected.';
    } else if (order === 1) {
      assign(p, core, 'integrated', 4, 'moderate');
      p.derivation = 'All bounded stable; 4/12 integrated core moderate, other integrated weak.';
    } else if (order === 2) {
      fill(p, 'integrated', 'inconsistent');
      assign(p, core, 'integrated', 6, 'stable');
      p.diagnosticOverride = 'inconsistent';
      p.derivation =
        'Bounded stable; 6/12 integrated core stable, remaining unstable; weaker evidence integration.';
    } else if (order === 3) {
      fill(p, 'integrated', 'inconsistent');
      assign(p, core, 'integrated', 8, 'stable');
      p.derivation = 'Bounded stable; 8/12 integrated core stable, 4 and upper inconsistent.';
    } else if (order === 4) {
      fill(p, 'integrated', 'moderate');
      assign(p, core, 'integrated', 10, 'stable');
      assign(p, upper, 'integrated', 2, 'stable');
      fill(p, 'strategic', 'weak');
      p.derivation =
        'Bounded mastered; 10/12 (83.3%) Middle core stable, 2 moderate; upper 2 stable/4 moderate; strategy weak.';
    } else if (order === 5) {
      fill(p, 'integrated', 'stable');
      assign(p, upper.slice(4), 'integrated', 2, 'moderate');
      fill(p, 'strategic', 'weak');
      assign(p, capabilities, 'strategic', 6, 'moderate');
      p.derivation =
        'Middle core stable, upper 4 stable/2 moderate; 6 strategic moderate, remainder weak.';
    } else if (order === 6) {
      fill(p, 'integrated', 'stable');
      fill(p, 'strategic', 'inconsistent');
      assign(p, capabilities, 'strategic', 9, 'moderate');
      p.derivation =
        'Middle mastered; 9 strategic moderate and 9 inconsistent; trade-offs/evolution/consequences unstable.';
    } else if (order === 7) {
      fill(p, 'integrated', 'stable');
      fill(p, 'strategic', 'moderate');
      assign(p, capabilities, 'strategic', 12, 'stable');
      p.derivation = 'Middle mastered; 12 strategic stable, 6 moderate.';
    } else {
      fill(p, 'integrated', 'stable');
      fill(p, 'strategic', 'moderate');
      assign(p, capabilities, 'strategic', 16, 'stable');
      p.derivation =
        'Bounded/integrated stable; 16 strategic stable, 2 moderate; explicit uncertainty/rollback ownership.';
    }
    return p;
  });
  for (const [id, mode] of [
    ['random_guesser', 'random'],
    ['memorizer', 'memorizer'],
    ['keyword_matcher', 'keyword'],
    ['overengineer', 'overengineer'],
  ] as const) {
    const p = build(id);
    p.mode = mode;
    for (const facet of facets) fill(p, facet, 'weak');
    p.derivation = 'Adversarial tactic without professional mastery.';
    personas.push(p);
  }
  for (const [id, overrides] of [
    ['strong_diagnosis_weak_judgment', { strategicOverride: 'weak' }],
    ['weak_diagnosis_strong_technique_knowledge', { diagnosticOverride: 'weak' }],
    ['weak_adaptation', { adaptationOverride: 'weak' }],
  ] as const) {
    const p = build(id);
    for (const facet of facets) fill(p, facet, 'stable');
    Object.assign(p, overrides);
    p.derivation =
      'Stable mastery except explicitly weak reasoning facet: ' + JSON.stringify(overrides);
    personas.push(p);
  }
  for (const domain of [...new Set(capabilities.map((c) => c.domain))].sort()) {
    const p = build(`one_domain_specialist:${domain}`);
    p.mode = 'specialist';
    p.specialistDomain = domain;
    for (const c of capabilities)
      for (const facet of facets) p.mastery[c.id]![facet] = c.domain === domain ? 'stable' : 'weak';
    p.derivation =
      'All facets stable in ' +
      domain +
      '; weak outside it. Tests breadth, not a claimed professional grade.';
    personas.push(p);
  }
  return personas;
}
export function blindPersona(persona: CompetencyPersona): BlindPersona {
  const { latentClass: _latentClass, order: _order, derivation: _derivation, ...blind } = persona;
  return blind;
}
