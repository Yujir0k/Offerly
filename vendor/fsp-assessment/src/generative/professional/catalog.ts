import { dimensions } from '../../adaptive/model.js';
import type { ArtifactType, PackPresentation } from '../model.js';
import type { Probe, ProfessionalDefinition, ProfessionalModel } from './authoring.js';

/** Measurements and remedies are authored per domain, not generated from role names. */
export function p(
  name: string,
  expected: string,
  observed: string,
  cause: string,
  repair: string,
  source: ArtifactType,
): Probe {
  return { name, expected, observed, cause, repair, source };
}
export function q(
  mechanism: string,
  expected: string,
  observed: string,
  repair: string,
  source: ArtifactType,
): Probe {
  return p(
    mechanism,
    expected,
    observed,
    `${mechanism}: зафиксировано «${observed}». Это расхождение с указанным условием объясняет нарушение в проверяемом сценарии.`,
    repair,
    source,
  );
}
export function m(
  id: string,
  title: string,
  domain: string,
  context: string,
  code: string,
  probes: ProfessionalModel['probes'],
  topology: string[],
): ProfessionalModel {
  return { id, title, domain, context, code, probes, topology };
}
export function presentation(input: {
  id: string;
  groupId: string;
  groupName: string;
  role: string;
  domains: [string, string, string][];
  dimensions: [string, string, string, string];
  stageLabels: [string, string, string, string];
  samples: string[];
  grades: [string, string, string];
  sources: [string, string][];
}): PackPresentation {
  return {
    evidenceVisibility: 'all-stages',
    groupId: input.groupId,
    groupName: input.groupName,
    trackId: input.id,
    role: input.role,
    domains: input.domains.map(([id, label, description]) => ({ id, label, description })),
    dimensions: Object.fromEntries(
      dimensions.map((dimension, index) => [dimension, input.dimensions[index]!]),
    ) as PackPresentation['dimensions'],
    stages: (['anchors', 'incident', 'review', 'boundary'] as const).map((id, index) => ({
      id,
      label: input.stageLabels[index]!,
      purpose:
        index === 0
          ? 'Проверка независимых профессиональных решений'
          : index === 1
            ? input.samples[0]!
            : index === 2
              ? input.samples[1]!
              : 'Уточнение решения в зоне неопределённости',
      allowedItemTypes: [
        'situational_choice',
        'artifact_interpretation',
        'design_review',
        'constraint_mutation',
      ],
      minSteps: [4, 5, 3, 0][index]!,
      maxSteps: [4, 5, 3, 3][index]!,
      measuredDimensions: [...dimensions],
    })),
    gradeDescriptions: {
      Junior: input.grades[0],
      Middle: input.grades[1],
      Senior: input.grades[2],
    },
    workSamples: input.samples,
    sources: [
      ...input.sources.map(([title, url]) => ({ title, url })),
      {
        title: 'SFIA 9: skills and responsibility (design reference)',
        url: 'https://sfia-online.org/en/sfia-9',
      },
    ],
  };
}
export type Definition = ProfessionalDefinition;
