import { dimensions } from '../adaptive/model.js';
import type { SpecializationPack } from '../generative/model.js';
import { behaviourKeys, type SyntheticCandidateProfile } from './model.js';
export function domainDefinitions(pack: SpecializationPack): string[] {
  return [
    ...new Set(pack.itemModels.map((model) => model.competencyDomain!).filter(Boolean)),
  ].sort();
}
const spectrum = [
  ['clear_junior', 0.42, 'Junior'],
  ['upper_junior', 0.48, 'Junior'],
  ['junior_middle_borderline', 0.54, 'borderline'],
  ['lower_middle', 0.6, 'Middle'],
  ['clear_middle', 0.68, 'Middle'],
  ['upper_middle', 0.75, 'Middle'],
  ['middle_senior_borderline', 0.8, 'borderline'],
  ['lower_senior', 0.85, 'Senior'],
  ['clear_senior', 0.93, 'Senior'],
] as const;
export function profilesForPack(pack: SpecializationPack): SyntheticCandidateProfile[] {
  const domains = domainDefinitions(pack);
  const base = (id: string, ability: number): SyntheticCandidateProfile => ({
    id,
    latentClass: 'adversarial',
    order: null,
    mode: 'competency',
    dimensions: Object.fromEntries(
      dimensions.map((d) => [d, ability]),
    ) as SyntheticCandidateProfile['dimensions'],
    domainSkills: Object.fromEntries(domains.map((d) => [d, ability])),
    behaviours: Object.fromEntries(
      behaviourKeys.map((d) => [d, ability]),
    ) as SyntheticCandidateProfile['behaviours'],
    misconceptionSusceptibility: Object.fromEntries(
      [
        ...new Set([
          'symptom_treatment',
          'wrong_causal_layer',
          'insufficient_evidence',
          'unsafe_ordering',
          'incorrect_atomicity_assumption',
          'ignore_concurrency',
          'premature_scaling',
          'over_serialization',
          'wrong_consistency_model',
          'incorrect_failure_assumption',
          ...pack.misconceptionCatalog,
          ...pack.itemModels.flatMap((m) => m.misconceptionClasses),
        ]),
      ].map((m) => [m, 1 - ability]),
    ),
    consistency: 0.88,
    noise: 0.08,
    speed: 1.15 - ability * 0.35,
  });
  const profiles: SyntheticCandidateProfile[] = spectrum.map(
    ([id, ability, latentClass], order) => ({ ...base(id, ability), latentClass, order }),
  );
  profiles.push(
    { ...base('random_guesser', 0.2), mode: 'random' },
    {
      ...base('memorizer', 0.7),
      mode: 'memorizer',
      behaviours: { ...base('', 0.28).behaviours, misconceptionResistance: 0.5 },
    },
    { ...base('keyword_matcher', 0.3), mode: 'keyword' },
    { ...base('overengineer', 0.6), mode: 'overengineer' },
  );
  const diagnosis = base('strong_diagnosis_weak_judgment', 0.85);
  diagnosis.dimensions.engineering_judgment = 0.35;
  diagnosis.dimensions.adaptation = 0.3;
  diagnosis.dimensions.diagnosis = 0.9;
  diagnosis.behaviours.constraintTracking = 0.35;
  profiles.push(diagnosis);
  const technique = base('weak_diagnosis_strong_technique_knowledge', 0.85);
  technique.dimensions.diagnosis = 0.3;
  technique.behaviours.evidenceSelection = 0.25;
  technique.behaviours.causalReasoning = 0.3;
  profiles.push(technique);
  profiles.push({
    ...base('weak_adaptation', 0.85),
    mode: 'weak-adaptation',
    dimensions: { ...base('', 0.85).dimensions, adaptation: 0.25 },
    behaviours: { ...base('', 0.85).behaviours, constraintTracking: 0.35 },
  });
  for (const domain of domains)
    profiles.push({
      ...base(`one_domain_specialist:${domain}`, 0.3),
      mode: 'specialist',
      specialistDomain: domain,
      domainSkills: Object.fromEntries(domains.map((d) => [d, d === domain ? 0.95 : 0.25])),
      dimensions: base('', 0.78).dimensions,
    });
  for (const profile of profiles) validateProfile(profile);
  return profiles;
}
export function validateProfile(profile: SyntheticCandidateProfile): void {
  for (const number of [
    ...Object.values(profile.dimensions),
    ...Object.values(profile.domainSkills),
    ...Object.values(profile.behaviours),
    ...Object.values(profile.misconceptionSusceptibility),
    profile.consistency,
    profile.noise,
  ])
    if (!Number.isFinite(number) || number < 0 || number > 1)
      throw new Error(`Invalid ability: ${profile.id}`);
  if (!Number.isFinite(profile.speed) || profile.speed <= 0)
    throw new Error('Invalid candidate speed');
}
