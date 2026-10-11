import { createHash } from 'node:crypto';
import { generateArtifacts, renderContext, templateBlocks, templateCompatible } from './render.js';
import { deriveGroundTruth, evaluateIntent, worldTopology } from './world.js';
import type { GeneratedItem, ItemModel, SpecializationPack, ValidationIssue } from './model.js';
import { validatePlan } from '../families/core.js';
import { difficultyMetadata, strategyDecision } from './qualitative-runtime.js';
import { profileAllowed } from './difficulty.js';
import { modelDecisionCatalog } from './decision-archetypes.js';

/** Canonical representation preserves semantics while ignoring object insertion order. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
export function fingerprint(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

/** Fingerprint an inspectable question independently of IDs, timestamps and option order. */
export function questionFingerprint(
  item: import('../adaptive/model.js').ItemVariant,
  step: import('../adaptive/model.js').ItemStep,
  pack: SpecializationPack,
): string {
  const world = item.generated?.stepWorlds[step.id];
  const normalize = (value: string) => {
    const content = world
      ? value
          .replaceAll(world.incidentals.operationId, '<sample>')
          .replaceAll(world.incidentals.timestamp, '<timestamp>')
      : value;
    return content.replace(/\s+/g, ' ').trim();
  };
  const artifacts = item.generated?.stepArtifacts[step.id] || item.artifacts;
  return fingerprint({
    prompt: normalize(step.prompt),
    context: normalize(step.context),
    resetContext: normalize(step.resetContext || ''),
    answers: step.options.map((option) => normalize(option.text)).sort(),
    planInstructions: normalize(step.responseTask?.instructions || ''),
    controls: (step.responseTask?.controls || []).map((control) => ({
      id: control.id,
      label: normalize(control.label),
      type: control.type,
      options: control.options.map((option) => ({
        value: option.value,
        label: normalize(option.label),
      })),
      values: control.values,
    })),
    artifacts: artifacts
      .filter((artifact) =>
        step.responseTask || pack.presentation?.evidenceVisibility === 'all-stages'
          ? artifact.type !== 'topology'
          : item.stage === 'incident'
            ? artifact.type !== 'architecture'
            : ['code', 'diff', 'deployment'].includes(artifact.type || '') &&
              (item.stage === 'review' || artifact.type === 'code'),
      )
      .map((artifact) => ({ type: artifact.type, content: normalize(artifact.content) }))
      .sort((left, right) => canonical(left).localeCompare(canonical(right))),
  });
}

/** Quality gate rejects semantic, artifact, answer, difficulty, assumption and style failures. */
export function validateGeneratedItem(
  item: GeneratedItem,
  model: ItemModel,
  pack: SpecializationPack,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const fail = (gate: string, message: string) => issues.push({ gate, message });
  const w = item.generated.worldState;
  let truth;
  try {
    truth = deriveGroundTruth(model, w);
  } catch (e) {
    fail('answer_validity', String(e));
    return issues;
  }
  if (canonical(truth) !== canonical(item.generated.groundTruth))
    fail('semantic_consistency', 'Ground truth не соответствует WorldState');
  const expectedArtifacts = generateArtifacts(model, w, truth);
  if (!expectedArtifacts.some((artifact) => artifact.id === truth.bestDiagnosticArtifact))
    fail('semantic_consistency', 'Обязательный диагностический источник отсутствует в WorldState');
  if (canonical(item.artifacts) !== canonical(expectedArtifacts))
    fail('semantic_consistency', 'Артефакты расходятся с формальным состоянием');
  if (
    canonical(item.topology) !== canonical(w.topology) ||
    canonical(item.architecture) !== canonical(w.topology.nodes.map((n) => n.label))
  )
    fail('semantic_consistency', 'Схема не соответствует topology');
  const ids = new Set(w.topology.nodes.map((n) => n.id));
  if (w.topology.edges.some((e) => !ids.has(e.from) || !ids.has(e.to)))
    fail('semantic_consistency', 'Edge указывает на отсутствующий узел');
  const physicalGrade = w.work?.reasoningGrade || item.targetGrade;
  if (w.work) {
    if (!profileAllowed(w.work.band, w.work.profile))
      fail('difficulty_structure', 'Профиль вне допустимой области band');
    if (
      !model.supportedGrades?.includes(physicalGrade) ||
      !model.supportedGrades.includes(item.targetGrade)
    )
      fail('grade_support', 'Target grade или reasoning band не прошёл support audit');
    const configuration = model.gradeConfigurations?.[physicalGrade];
    if (
      !configuration?.professionalResponsibility ||
      !configuration.requiredReasoning ||
      !configuration.uniqueRadicals?.length
    )
      fail('grade_support', 'У supported grade отсутствует предметное rationale');
    if (w.work.policy) {
      const catalog = modelDecisionCatalog(model);
      if (
        w.work.decisionArchetypes.length !== 4 ||
        w.work.decisionArchetypes.some(
          (action) => !catalog.some((allowed) => canonical(action) === canonical(allowed)),
        )
      )
        fail('decision_archetype', 'Решение не происходит из предметного каталога модели');
    }
  }
  const profile = model.worldBounds?.[physicalGrade] || pack.worldBounds[physicalGrade];
  const expectedLabels = worldTopology(model, physicalGrade, w.radicals.failure).nodes.map(
    (n) => n.label,
  );
  if (
    canonical(w.topology.nodes.map((n) => n.label)) !== canonical(expectedLabels) ||
    w.radicals.components !== w.topology.nodes.length
  )
    fail('semantic_consistency', 'World topology не содержит обязательные компоненты модели');
  const grades = ['Junior', 'Middle', 'Senior'];
  const causalCase = model.cases.find((c) => c.hazard === truth.hazard)!;
  if (Object.entries(causalCase.facts).some(([k, v]) => w.radicals.failure[k] !== v))
    fail('content_validation', 'WorldState выходит за опубликованный causal configuration');
  if (grades.indexOf(causalCase.minimumGrade || 'Junior') > grades.indexOf(physicalGrade))
    fail('difficulty_validation', 'Сценарий требует reasoning другого грейда');
  if (grades.indexOf(causalCase.maximumGrade || 'Senior') < grades.indexOf(physicalGrade))
    fail('difficulty_validation', 'Сценарий проще обязательного профиля грейда');
  if (
    w.grade !== item.targetGrade ||
    !profile.workers.includes(w.radicals.workers) ||
    w.radicals.components > profile.maxComponents ||
    w.radicals.legacyClients !== profile.legacyClients ||
    w.radicals.rollbackRequired !== profile.rollbackRequired
  )
    fail('difficulty_validation', 'Radicals не соответствуют grade profile');
  if (
    item.generated.coreProbe &&
    (item.targetGrade !== 'Senior' ||
      item.generated.difficulty?.band !== 'senior_core' ||
      item.steps.length !== 1 ||
      item.steps[0]!.rubric.dimension !== 'engineering_judgment' ||
      item.steps[0]!.rubric.informationWeight !== 1 ||
      !w.work?.policy ||
      w.work.consequences.length < 2)
  )
    fail(
      'difficulty_structure',
      'Mandatory Senior probe lacks an independent policy ownership contract',
    );
  if (
    item.stage === 'boundary' &&
    !item.generated.coreProbe &&
    item.steps[0]!.rubric.informationWeight < 2
  )
    fail('difficulty_validation', 'Boundary должен добавлять high-information evidence');
  if (w.assumptions.length < 3)
    fail('content_validation', 'Отсутствует существенное assumption или constraint');
  if (
    !model.gradeRange?.includes(item.targetGrade) ||
    !model.competencyDomain ||
    !model.availableArtifacts?.length ||
    !model.worldStateSchema
  )
    fail('content_validation', 'Нет опубликованного grade/domain/evidence/schema contract');
  for (const templateId of item.generated.templateIds) {
    const template = templateBlocks.find((t) => t.id === templateId);
    if (!template || !templateCompatible(template, w))
      fail('template_compatibility', `Несовместимый template ${templateId}`);
  }
  for (const s of item.steps) {
    const sw = item.generated.stepWorlds[s.id];
    const st = item.generated.stepTruths[s.id];
    if (!sw || !st || canonical(st) !== canonical(deriveGroundTruth(model, sw))) {
      fail('semantic_consistency', `Нет согласованного step world: ${s.id}`);
      continue;
    }
    const presentation = renderContext(model, sw, st);
    const rendered = presentation.text;
    if (canonical(s.scenario) !== canonical(presentation.scenario))
      fail('semantic_consistency', 'Структурированный scenario расходится с WorldState');
    if (
      sw.grade !== item.targetGrade ||
      grades.indexOf(model.cases.find((c) => c.hazard === st.hazard)!.minimumGrade || 'Junior') >
        grades.indexOf(sw.work?.reasoningGrade || sw.grade) ||
      grades.indexOf(model.cases.find((c) => c.hazard === st.hazard)!.maximumGrade || 'Senior') <
        grades.indexOf(sw.work?.reasoningGrade || sw.grade)
    )
      fail('difficulty_validation', 'Изменение условий вышло за выбранный грейд');
    if (
      canonical(item.generated.stepArtifacts[s.id]) !== canonical(generateArtifacts(model, sw, st))
    )
      fail('semantic_consistency', `Артефакты ${s.id} не соответствуют условиям шага`);
    if (s.context !== rendered)
      fail('semantic_consistency', `Текст ${s.id} не соответствует WorldState`);
    if (s.exploration) continue;
    if (sw.work) {
      const metadata = difficultyMetadata(sw)!;
      if (sw.work.reasoningGrade === 'Junior' && !metadata.structuralEvidence.localContext)
        fail('difficulty_structure', 'Локальная ответственность не подтверждена структурой');
      if (
        sw.work.reasoningGrade === 'Middle' &&
        (!metadata.structuralEvidence.interactingWorkflow ||
          !metadata.structuralEvidence.correlatedSources ||
          !sw.work.operationalConstraint)
      )
        fail(
          'difficulty_structure',
          'Нет взаимодействия, корреляции источников и operational constraint',
        );
      if (
        sw.work.reasoningGrade === 'Senior' &&
        (!metadata.structuralEvidence.interactingWorkflow ||
          metadata.structuralEvidence.technicallyValidStrategies < 2 ||
          metadata.structuralEvidence.feasibleStrategies < 2 ||
          !metadata.structuralEvidence.strategyChangesUnderConstraints ||
          metadata.structuralEvidence.secondOrderConsequences.length < 2)
      )
        fail(
          'difficulty_structure',
          'Стратегический выбор не доказан несколькими допустимыми решениями и последствиями',
        );
      if (sw.work.policy && strategyDecision(sw.work).feasible.length < 2)
        fail('difficulty_structure', 'Senior сведён к единственному техническому исправлению');
    }
    if (model.runtime?.responseTask) {
      const kind = item.generated.intents[s.id]?.[0]?.kind;
      if (!kind) {
        fail('response_plan', `Неизвестный тип плана ${s.id}`);
        continue;
      }
      const expected = model.runtime.responseTask(model, sw, kind);
      if (
        canonical(s.responseTask) !== canonical(expected.task) ||
        canonical(item.generated.responseChecks?.[s.id]?.accepted) !== canonical(expected.accepted)
      )
        fail('response_plan', `План ${s.id} расходится с текущими условиями`);
      if (!expected.accepted.length) fail('response_plan', `Нет допустимого плана ${s.id}`);
      for (const plan of expected.accepted) {
        try {
          validatePlan(expected.task.controls, plan);
        } catch {
          fail('response_plan', `Недопустимая схема эталона ${s.id}`);
          break;
        }
      }
    }
    const intents = item.generated.intents[s.id] || [];
    const evaluated = s.options.map((o) => {
      const intent = intents.find((i) => i.id === item.generated.optionIntents[o.id]);
      if (!intent) {
        fail('answer_validity', 'Ответ не связан с semantic intent');
        return -1;
      }
      if (!intent.applicability || !Object.keys(intent.applicability).length)
        fail('answer_validity', 'У intent отсутствуют проверяемые условия применимости');
      if (o.text !== intent.text)
        fail('semantic_consistency', 'Текст ответа не соответствует его semantic intent');
      const score = evaluateIntent(intent, sw, st);
      if (score !== s.rubric.scores[o.id])
        fail('answer_validity', 'Score не следует из формальной модели');
      return score;
    });
    if (
      evaluated.filter((v) => v === 1).length !== 1 ||
      s.options.length !== 4 ||
      new Set(s.options.map((o) => o.text)).size !== 4 ||
      new Set(s.options.map((o) => o.id)).size !== 4
    )
      fail('answer_validity', 'Single-select должен иметь один best answer и четыре разных intent');
    const best = s.options[evaluated.indexOf(1)];
    if (new Set(s.options.map((o) => item.generated.optionIntents[o.id])).size !== s.options.length)
      fail('distractor_validity', 'Несколько ответов представляют один semantic intent');
    if (intents.filter((i) => evaluateIntent(i, sw, st) === 1).length !== 1)
      fail('distractor_validity', 'Distractor эквивалентен правильному решению');
    const lengths = s.options.map((o) => o.text.length).sort((a, b) => a - b);
    const median = (lengths[1]! + lengths[2]!) / 2;
    if (best && (best.text.length > median * 1.65 || best.text.length < median * 0.55))
      fail('option_balance', 'Правильный вариант выделяется длиной');
    const details = (text: string) =>
      (
        text.match(
          /transaction|commit|identity|reader|writer|rollback|version|cache|replay|epoch|атомар|транзакц|верс[иі]|контракт|откат/gi,
        ) || []
      ).length;
    const counts = s.options.map((o) => details(o.text)).sort((a, b) => a - b);
    if (best && details(best.text) > (counts[1]! + counts[2]!) / 2 + 3)
      fail('option_balance', 'Правильный ответ выделяется количеством технических деталей');
    if (
      s.options.some((o) =>
        /единственно правильн|очевидно|95% confidence|causal chain/i.test(o.text),
      ) ||
      /causal chain|Как адаптировать deployment/i.test(s.prompt)
    )
      fail('content_validation', 'Стилевая подсказка или неестественный язык');
  }
  if (w.work && canonical(item.generated.difficulty) !== canonical(difficultyMetadata(w)))
    fail('difficulty_structure', 'Difficulty metadata не следует из work structure');
  return issues;
}
