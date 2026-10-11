import { parseRequestJson, readRequestText } from "@/lib/request-security";
import { throttle } from '@/lib/auth';
import { checkOrigin, errorResponse, workspace } from '@/lib/store';
import { searchCatalog } from '@/lib/catalog';
import type { Profile } from '@/lib/model';
import { grades } from '@/lib/model';
import { validateTaskBrief } from '@/lib/task-brief';
import {
  selectTaskRecommendations,
  type RecommendationLane,
} from '@/lib/task-recommendations';

/** Read-only, scope-isolated recommendations using the same visibility and redaction as search. */
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const text = await readRequestText(request, 60000);
    if (text.length > 12000) throw new Error('Слишком большой запрос подбора');
    const body = parseRequestJson(text);
    if (!body || typeof body !== 'object' || Array.isArray(body))
      throw new Error('Проверьте запрос подбора');
    if (body.role !== 'employer')
      throw new Error('Доступно только работодателю');
    const requirements = validateTaskBrief(body.requirements);
    const { account, state } = await workspace();
    await throttle(`recommendations:${account.id}`, 30, 60);
    const modes: {
      key: RecommendationLane['key'];
      title: string;
      task: string;
      sort: string;
    }[] = [
      {
        key: 'main',
        title: 'По вашему запросу',
        task: requirements.task,
        sort: requirements.sort,
      },
      {
        key: 'operations',
        title: 'Для диагностики и исправления ошибок',
        task: 'operations',
        sort: requirements.sort,
      },
      {
        key: 'product',
        title: 'Для проектирования и изменений',
        task: 'product',
        sort: requirements.sort,
      },
      {
        key: 'quality',
        title: 'Для качества и надёжности',
        task: 'quality',
        sort: requirements.sort,
      },
      {
        key: 'budget',
        title: 'Вариант по бюджету',
        task: requirements.task,
        sort: 'По зарплате',
      },
    ];
    if (requirements.sort !== 'По результату теста')
      modes.push({
        key: 'fsp',
        title: 'С релевантными соревнованиями',
        task: requirements.task,
        sort: 'По достижениям ФСП',
      });
    let total = 0;
    const groups: { grade: string; total: number; examined: number }[] = [];
    const recommendations = [] as ReturnType<typeof selectTaskRecommendations>;
    const examined = new Set<number>();
    const relaxationsBySkill = new Map<
      string,
      { skill: string; total: number; added: number }
    >();
    const selectedGrades = requirements.grade
      ? [requirements.grade]
      : requirements.grades?.length
        ? requirements.grades
        : grades;
    // Query each level separately: catalog pagination must not hide Middle/Senior behind Junior.
    for (const grade of selectedGrades) {
      const lanes: RecommendationLane[] = [];
      let groupTotal = 0;
      for (const mode of modes) {
        const result = await searchCatalog(
          account,
          state,
          'candidates',
          {
            ...requirements,
            grade,
            grades: [],
            task: mode.task,
            tasks: ['main', 'budget', 'fsp'].includes(mode.key)
              ? requirements.tasks || []
              : [],
            sort: mode.sort,
            includeUnconfirmed: true,
            suggestRelaxations: mode.key === 'main',
          },
          'employer',
          1,
          'market',
        );
        if (mode.key === 'main') {
          groupTotal = result.total;
          total += result.total;
          for (const item of result.relaxations) {
            const old = relaxationsBySkill.get(item.skill);
            relaxationsBySkill.set(item.skill, {
              ...item,
              total: item.total + (old?.total || 0),
              added: item.added + (old?.added || 0),
            });
          }
        }
        lanes.push({
          key: mode.key,
          title: mode.title,
          items: result.items.filter(
            (item): item is Profile => !!item && 'claimed' in item,
          ),
        });
        if (!groupTotal) break;
      }
      const groupIds = new Set(
        lanes.flatMap((lane) => lane.items.map((profile) => profile.id)),
      );
      for (const id of groupIds) examined.add(id);
      groups.push({ grade, total: groupTotal, examined: groupIds.size });
      const choices = selectTaskRecommendations(
        lanes,
        {
          ...requirements,
          grade,
          grades: [],
        },
        selectedGrades.length > 1 ? 3 : 6,
      );
      recommendations.push(...choices);
    }
    return Response.json(
      {
        requirements,
        total,
        examined: examined.size,
        recommendations,
        groups,
        relaxations: [...relaxationsBySkill.values()].map((item) => ({
          ...item,
          total: total + item.added,
        })),
        method: `Подбор без LLM. Условия подтверждены вами; просмотрены первые 20 профилей по каждому из ${modes.length} приоритетов отдельно для ${selectedGrades.length} уровней. Веса выбранных групп задач усредняются, повторения слов не дают бонуса. Порядок между уровнями не означает превосходства; категория и версия теста разделяются. Одинаковые кандидаты объединены; общего процента соответствия нет.`,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    if (error instanceof SyntaxError)
      return Response.json(
        { error: 'Проверьте запрос подбора' },
        { status: 400 },
      );
    return errorResponse(error);
  }
}
