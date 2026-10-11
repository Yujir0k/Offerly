import type { TargetGrade } from '../adaptive/model.js';
import type { ItemModel } from './model.js';
import { trackGradeConfigurations } from './grade-designs.js';
import { decisionCatalogs, modelDecisionCatalog } from './decision-archetypes.js';

interface SupportReview {
  grades: TargetGrade[];
  exclusions: Partial<Record<TargetGrade, string>>;
}
/** Explicit review of the existing 181 models. Missing entries fail registration; no all-grade default. */
export const gradeSupportReviews: Record<string, SupportReview> = {
  qa_layer_contract: {
    grades: ['Junior'],
    exclusions: {
      Middle:
        'Ограниченный контракт опубликован для Junior; взаимодействие независимых состояний не является предметом модели.',
      Senior: 'Стратегия и эволюция сознательно остаются вне ограниченного work sample.',
    },
  },
  ml_candidate_gate: {
    grades: ['Junior'],
    exclusions: {
      Middle:
        'Ограниченный контракт опубликован для Junior; взаимодействие независимых состояний не является предметом модели.',
      Senior: 'Стратегия и эволюция сознательно остаются вне ограниченного work sample.',
    },
  },
  ds_claim_boundary: {
    grades: ['Junior'],
    exclusions: {
      Middle:
        'Ограниченный контракт опубликован для Junior; взаимодействие независимых состояний не является предметом модели.',
      Senior: 'Стратегия и эволюция сознательно остаются вне ограниченного work sample.',
    },
  },
  unknown_external_outcome: {
    grades: ['Middle', 'Senior'],
    exclusions: {
      Junior:
        'Неизвестный исход внешней операции: смысл модели требует взаимодействующих состояний или решения об общем риске; самостоятельный ограниченный локальный контракт не опубликован.',
    },
  },
  queue_duplicate_delivery: {
    grades: ['Middle', 'Senior'],
    exclusions: {
      Junior:
        'Повторная доставка сообщения: смысл модели требует взаимодействующих состояний или решения об общем риске; самостоятельный ограниченный локальный контракт не опубликован.',
    },
  },
  db_lost_update: {
    grades: ['Junior', 'Middle'],
    exclusions: {
      Senior:
        'Конкурентное изменение данных: опубликованное содержание проверяет исправление и связь evidence; самостоятельная ответственность за policy/эволюцию этой модели не заявляется. Дополнительные компоненты не дают Senior support.',
    },
  },
  connection_pool_starvation: { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  cache_inconsistency: { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  transaction_event_gap: {
    grades: ['Middle', 'Senior'],
    exclusions: {
      Junior:
        'Граница записи и публикации события: смысл модели требует взаимодействующих состояний или решения об общем риске; самостоятельный ограниченный локальный контракт не опубликован.',
    },
  },
  zero_downtime_migration: {
    grades: ['Middle', 'Senior'],
    exclusions: {
      Junior:
        'Изменение схемы без остановки: смысл модели требует взаимодействующих состояний или решения об общем риске; самостоятельный ограниченный локальный контракт не опубликован.',
    },
  },
  api_backward_compatibility: { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  retry_storm: {
    grades: ['Middle', 'Senior'],
    exclusions: {
      Junior:
        'Усиление нагрузки повторами: смысл модели требует взаимодействующих состояний или решения об общем риске; самостоятельный ограниченный локальный контракт не опубликован.',
    },
  },
  stale_distributed_lock: {
    grades: ['Middle', 'Senior'],
    exclusions: {
      Junior:
        'Истёкшая аренда блокировки: смысл модели требует взаимодействующих состояний или решения об общем риске; самостоятельный ограниченный локальный контракт не опубликован.',
    },
  },
  schema_rollout: {
    grades: ['Middle', 'Senior'],
    exclusions: {
      Junior:
        'Развёртывание новой схемы сообщений: смысл модели требует взаимодействующих состояний или решения об общем риске; самостоятельный ограниченный локальный контракт не опубликован.',
    },
  },
  partial_dependency_failure: { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  request_validation: {
    grades: ['Junior', 'Middle'],
    exclusions: {
      Senior:
        'Контракт локального API: опубликованное содержание проверяет исправление и связь evidence; самостоятельная ответственность за policy/эволюцию этой модели не заявляется. Дополнительные компоненты не дают Senior support.',
    },
  },
  query_pagination: {
    grades: ['Junior', 'Middle'],
    exclusions: {
      Senior:
        'Чтение и пагинация данных: опубликованное содержание проверяет исправление и связь evidence; самостоятельная ответственность за policy/эволюцию этой модели не заявляется. Дополнительные компоненты не дают Senior support.',
    },
  },
  request_resource_lifecycle: {
    grades: ['Junior', 'Middle'],
    exclusions: {
      Senior:
        'Жизненный цикл обработчика: опубликованное содержание проверяет исправление и связь evidence; самостоятельная ответственность за policy/эволюцию этой модели не заявляется. Дополнительные компоненты не дают Senior support.',
    },
  },
  transaction_constraints: {
    grades: ['Junior', 'Middle'],
    exclusions: {
      Senior:
        'Локальная транзакция: опубликованное содержание проверяет исправление и связь evidence; самостоятельная ответственность за policy/эволюцию этой модели не заявляется. Дополнительные компоненты не дают Senior support.',
    },
  },
  fe_search_race: {
    grades: ['Junior', 'Middle'],
    exclusions: {
      Senior:
        'Асинхронный поиск: опубликованное содержание проверяет исправление и связь evidence; самостоятельная ответственность за policy/эволюцию этой модели не заявляется. Дополнительные компоненты не дают Senior support.',
    },
  },
  fe_form_draft: { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  fe_list_identity: {
    grades: ['Junior', 'Middle'],
    exclusions: {
      Senior:
        'Идентичность элементов списка: опубликованное содержание проверяет исправление и связь evidence; самостоятельная ответственность за policy/эволюцию этой модели не заявляется. Дополнительные компоненты не дают Senior support.',
    },
  },
  fe_hydration: { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  fe_interaction_latency: {
    grades: ['Junior', 'Middle'],
    exclusions: {
      Senior:
        'Задержка взаимодействия: опубликованное содержание проверяет исправление и связь evidence; самостоятельная ответственность за policy/эволюцию этой модели не заявляется. Дополнительные компоненты не дают Senior support.',
    },
  },
  fe_loading_budget: { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  fe_modal_focus: {
    grades: ['Junior', 'Middle'],
    exclusions: {
      Senior:
        'Доступность диалога: опубликованное содержание проверяет исправление и связь evidence; самостоятельная ответственность за policy/эволюцию этой модели не заявляется. Дополнительные компоненты не дают Senior support.',
    },
  },
  fe_form_accessibility: { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  fe_asset_release: { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  fe_route_resilience: { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  fe_untrusted_html: {
    grades: ['Junior', 'Middle'],
    exclusions: {
      Senior:
        'Недоверенное содержимое: опубликованное содержание проверяет исправление и связь evidence; самостоятельная ответственность за policy/эволюцию этой модели не заявляется. Дополнительные компоненты не дают Senior support.',
    },
  },
  fe_origin_boundary: { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  'work-frontend-request-races': { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  'work-frontend-list-reconciliation': {
    grades: ['Junior', 'Middle'],
    exclusions: {
      Senior:
        'Список: стабильные ключи, сохранение состояния и виртуализация: опубликованное содержание проверяет исправление и связь evidence; самостоятельная ответственность за policy/эволюцию этой модели не заявляется. Дополнительные компоненты не дают Senior support.',
    },
  },
  'work-native-fe-dialog': { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  sre_sli_scope: { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  sre_burn_alert: { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  sre_zone_routing: { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  sre_termination: {
    grades: ['Junior', 'Middle'],
    exclusions: {
      Senior:
        'Завершение реплики: опубликованное содержание проверяет исправление и связь evidence; самостоятельная ответственность за policy/эволюцию этой модели не заявляется. Дополнительные компоненты не дают Senior support.',
    },
  },
  sre_cpu_throttling: {
    grades: ['Junior', 'Middle'],
    exclusions: {
      Senior:
        'Ресурсное насыщение: опубликованное содержание проверяет исправление и связь evidence; самостоятельная ответственность за policy/эволюцию этой модели не заявляется. Дополнительные компоненты не дают Senior support.',
    },
  },
  sre_admission: { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  sre_canary: { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  sre_config_drift: { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  sre_restore: { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  sre_failover_drill: {
    grades: ['Junior', 'Middle'],
    exclusions: {
      Senior:
        'Учение по отказу: опубликованное содержание проверяет исправление и связь evidence; самостоятельная ответственность за policy/эволюцию этой модели не заявляется. Дополнительные компоненты не дают Senior support.',
    },
  },
  sre_trace_sampling: {
    grades: ['Junior', 'Middle'],
    exclusions: {
      Senior:
        'Полнота телеметрии: опубликованное содержание проверяет исправление и связь evidence; самостоятельная ответственность за policy/эволюцию этой модели не заявляется. Дополнительные компоненты не дают Senior support.',
    },
  },
  sre_postmortem_action: {
    grades: ['Middle', 'Senior'],
    exclusions: {
      Junior:
        'Действия после инцидента: смысл модели требует взаимодействующих состояний или решения об общем риске; самостоятельный ограниченный локальный контракт не опубликован.',
    },
  },
  'work-sre-multiwindow-burn': {
    grades: ['Junior', 'Middle'],
    exclusions: {
      Senior:
        'SRE: multi-window burn rate и взвешивание трафика: опубликованное содержание проверяет исправление и связь evidence; самостоятельная ответственность за policy/эволюцию этой модели не заявляется. Дополнительные компоненты не дают Senior support.',
    },
  },
  'work-sre-rolling-capacity': {
    grades: ['Middle', 'Senior'],
    exclusions: {
      Junior:
        'SRE: rolling update, запас мощности и сбой реплики: смысл модели требует взаимодействующих состояний или решения об общем риске; самостоятельный ограниченный локальный контракт не опубликован.',
    },
  },
  'work-native-sre-restore': { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  qa_risk_matrix: { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  qa_boundary_partition: {
    grades: ['Junior', 'Middle'],
    exclusions: {
      Senior:
        'Границы и классы эквивалентности: опубликованное содержание проверяет исправление и связь evidence; самостоятельная ответственность за policy/эволюцию этой модели не заявляется. Дополнительные компоненты не дают Senior support.',
    },
  },
  qa_result_oracle: {
    grades: ['Junior', 'Middle'],
    exclusions: {
      Senior:
        'Oracle результата: опубликованное содержание проверяет исправление и связь evidence; самостоятельная ответственность за policy/эволюцию этой модели не заявляется. Дополнительные компоненты не дают Senior support.',
    },
  },
  qa_eventual_oracle: { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  qa_ui_synchronization: {
    grades: ['Junior', 'Middle'],
    exclusions: {
      Senior:
        'Синхронизация UI-теста: опубликованное содержание проверяет исправление и связь evidence; самостоятельная ответственность за policy/эволюцию этой модели не заявляется. Дополнительные компоненты не дают Senior support.',
    },
  },
  qa_api_contract: { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  qa_parallel_isolation: {
    grades: ['Junior', 'Middle'],
    exclusions: {
      Senior:
        'Изоляция параллельных тестов: опубликованное содержание проверяет исправление и связь evidence; самостоятельная ответственность за policy/эволюцию этой модели не заявляется. Дополнительные компоненты не дают Senior support.',
    },
  },
  qa_environment_fidelity: { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  qa_flaky_triage: {
    grades: ['Junior', 'Middle'],
    exclusions: {
      Senior:
        'Классификация flaky-сигнала: опубликованное содержание проверяет исправление и связь evidence; самостоятельная ответственность за policy/эволюцию этой модели не заявляется. Дополнительные компоненты не дают Senior support.',
    },
  },
  qa_ci_gate: { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  qa_test_layers: {
    grades: ['Middle', 'Senior'],
    exclusions: {
      Junior:
        'Выбор уровня проверки: смысл модели требует взаимодействующих состояний или решения об общем риске; самостоятельный ограниченный локальный контракт не опубликован.',
    },
  },
  qa_release_decision: {
    grades: ['Middle', 'Senior'],
    exclusions: {
      Junior:
        'Решение о качестве релиза: смысл модели требует взаимодействующих состояний или решения об общем риске; самостоятельный ограниченный локальный контракт не опубликован.',
    },
  },
  'work-qa-mutation-risk': {
    grades: ['Middle', 'Senior'],
    exclusions: {
      Junior:
        'QA: mutation testing и портфель проверок по риску: смысл модели требует взаимодействующих состояний или решения об общем риске; самостоятельный ограниченный локальный контракт не опубликован.',
    },
  },
  'work-qa-flaky-async-isolation': {
    grades: ['Junior', 'Middle'],
    exclusions: {
      Senior:
        'QA: асинхронные ожидания, shared state и скрывающие дефект retries: опубликованное содержание проверяет исправление и связь evidence; самостоятельная ответственность за policy/эволюцию этой модели не заявляется. Дополнительные компоненты не дают Senior support.',
    },
  },
  'work-native-qa-ci': { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  de_cdc_offset: {
    grades: ['Junior', 'Middle'],
    exclusions: {
      Senior:
        'Граница CDC: опубликованное содержание проверяет исправление и связь evidence; самостоятельная ответственность за policy/эволюцию этой модели не заявляется. Дополнительные компоненты не дают Senior support.',
    },
  },
  de_incremental_load: { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  de_late_window: { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  de_stream_join: {
    grades: ['Junior', 'Middle'],
    exclusions: {
      Senior:
        'Join потоков: опубликованное содержание проверяет исправление и связь evidence; самостоятельная ответственность за policy/эволюцию этой модели не заявляется. Дополнительные компоненты не дают Senior support.',
    },
  },
  de_quality_contract: {
    grades: ['Junior', 'Middle'],
    exclusions: {
      Senior:
        'Контракт качества таблицы: опубликованное содержание проверяет исправление и связь evidence; самостоятельная ответственность за policy/эволюцию этой модели не заявляется. Дополнительные компоненты не дают Senior support.',
    },
  },
  de_schema_evolution: { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  de_dag_partition: {
    grades: ['Junior', 'Middle'],
    exclusions: {
      Senior:
        'Зависимости DAG: опубликованное содержание проверяет исправление и связь evidence; самостоятельная ответственность за policy/эволюцию этой модели не заявляется. Дополнительные компоненты не дают Senior support.',
    },
  },
  de_backfill: {
    grades: ['Middle', 'Senior'],
    exclusions: {
      Junior:
        'Безопасный backfill: смысл модели требует взаимодействующих состояний или решения об общем риске; самостоятельный ограниченный локальный контракт не опубликован.',
    },
  },
  de_partition_scan: { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  de_join_skew: {
    grades: ['Junior', 'Middle'],
    exclusions: {
      Senior:
        'Skew обработки: опубликованное содержание проверяет исправление и связь evidence; самостоятельная ответственность за policy/эволюцию этой модели не заявляется. Дополнительные компоненты не дают Senior support.',
    },
  },
  de_lineage_gap: { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  de_consumer_freshness: {
    grades: ['Middle', 'Senior'],
    exclusions: {
      Junior:
        'Freshness потребителя: смысл модели требует взаимодействующих состояний или решения об общем риске; самостоятельный ограниченный локальный контракт не опубликован.',
    },
  },
  'work-de-cdc-schema-money': { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  'work-de-event-time-windows': {
    grades: ['Junior', 'Middle'],
    exclusions: {
      Senior:
        'Streaming: event time, late data и коррекция агрегатов: опубликованное содержание проверяет исправление и связь evidence; самостоятельная ответственность за policy/эволюцию этой модели не заявляется. Дополнительные компоненты не дают Senior support.',
    },
  },
  'work-native-de-lineage': { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  ml_point_in_time: { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  ml_preprocess_parity: {
    grades: ['Junior', 'Middle'],
    exclusions: {
      Senior:
        'Train/serve parity: опубликованное содержание проверяет исправление и связь evidence; самостоятельная ответственность за policy/эволюцию этой модели не заявляется. Дополнительные компоненты не дают Senior support.',
    },
  },
  ml_training_resume: {
    grades: ['Junior', 'Middle'],
    exclusions: {
      Senior:
        'Воспроизводимое обучение: опубликованное содержание проверяет исправление и связь evidence; самостоятельная ответственность за policy/эволюцию этой модели не заявляется. Дополнительные компоненты не дают Senior support.',
    },
  },
  ml_training_stability: { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  ml_split_leakage: {
    grades: ['Junior', 'Middle'],
    exclusions: {
      Senior:
        'Независимая оценка модели: опубликованное содержание проверяет исправление и связь evidence; самостоятельная ответственность за policy/эволюцию этой модели не заявляется. Дополнительные компоненты не дают Senior support.',
    },
  },
  ml_threshold_metrics: { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  ml_batch_inference: {
    grades: ['Junior', 'Middle'],
    exclusions: {
      Senior:
        'Batching inference: опубликованное содержание проверяет исправление и связь evidence; самостоятельная ответственность за policy/эволюцию этой модели не заявляется. Дополнительные компоненты не дают Senior support.',
    },
  },
  ml_serving_contract: { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  ml_feature_drift: {
    grades: ['Junior', 'Middle'],
    exclusions: {
      Senior:
        'Drift признаков: опубликованное содержание проверяет исправление и связь evidence; самостоятельная ответственность за policy/эволюцию этой модели не заявляется. Дополнительные компоненты не дают Senior support.',
    },
  },
  ml_delayed_labels: {
    grades: ['Middle', 'Senior'],
    exclusions: {
      Junior:
        'Задержанные метки: смысл модели требует взаимодействующих состояний или решения об общем риске; самостоятельный ограниченный локальный контракт не опубликован.',
    },
  },
  ml_model_rollout: {
    grades: ['Middle', 'Senior'],
    exclusions: {
      Junior:
        'Выпуск новой модели: смысл модели требует взаимодействующих состояний или решения об общем риске; самостоятельный ограниченный локальный контракт не опубликован.',
    },
  },
  ml_feedback_loop: {
    grades: ['Middle', 'Senior'],
    exclusions: {
      Junior:
        'Обратная связь обучения: смысл модели требует взаимодействующих состояний или решения об общем риске; самостоятельный ограниченный локальный контракт не опубликован.',
    },
  },
  'work-mle-serving-contract': { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  'work-mle-batching-precision': { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  'work-ranking-ndcg-availability': { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  ds_sample_population: { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  ds_data_definition: {
    grades: ['Junior', 'Middle'],
    exclusions: {
      Senior:
        'Семантика аналитических данных: опубликованное содержание проверяет исправление и связь evidence; самостоятельная ответственность за policy/эволюцию этой модели не заявляется. Дополнительные компоненты не дают Senior support.',
    },
  },
  ds_group_split: {
    grades: ['Junior', 'Middle'],
    exclusions: {
      Senior:
        'Независимость split: опубликованное содержание проверяет исправление и связь evidence; самостоятельная ответственность за policy/эволюцию этой модели не заявляется. Дополнительные компоненты не дают Senior support.',
    },
  },
  ds_time_backtest: { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  ds_randomization: { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  ds_exposure_analysis: {
    grades: ['Junior', 'Middle'],
    exclusions: {
      Senior:
        'Экспозиция эксперимента: опубликованное содержание проверяет исправление и связь evidence; самостоятельная ответственность за policy/эволюцию этой модели не заявляется. Дополнительные компоненты не дают Senior support.',
    },
  },
  ds_multiple_testing: { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  ds_effect_interval: { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  ds_metric_objective: { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  ds_segment_reversal: {
    grades: ['Junior', 'Middle'],
    exclusions: {
      Senior:
        'Сегменты и агрегированный вывод: опубликованное содержание проверяет исправление и связь evidence; самостоятельная ответственность за policy/эволюцию этой модели не заявляется. Дополнительные компоненты не дают Senior support.',
    },
  },
  ds_observational_effect: {
    grades: ['Middle', 'Senior'],
    exclusions: {
      Junior:
        'Наблюдательный причинный вывод: смысл модели требует взаимодействующих состояний или решения об общем риске; самостоятельный ограниченный локальный контракт не опубликован.',
    },
  },
  ds_natural_experiment: {
    grades: ['Middle', 'Senior'],
    exclusions: {
      Junior:
        'Квазиэксперимент: смысл модели требует взаимодействующих состояний или решения об общем риске; самостоятельный ограниченный локальный контракт не опубликован.',
    },
  },
  'work-ds-decision-cost': { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  'work-ds-segment-thresholds': {
    grades: ['Junior', 'Middle'],
    exclusions: {
      Senior:
        'Качество по сегментам: единый порог скрывает потери: опубликованное содержание проверяет исправление и связь evidence; самостоятельная ответственность за policy/эволюцию этой модели не заявляется. Дополнительные компоненты не дают Senior support.',
    },
  },
  'work-analytics-stratified-ab': {
    grades: ['Middle', 'Senior'],
    exclusions: {
      Junior:
        'A/B: Simpson paradox и стандартизация состава групп: смысл модели требует взаимодействующих состояний или решения об общем риске; самостоятельный ограниченный локальный контракт не опубликован.',
    },
  },
  mp_run_manifest: {
    grades: ['Junior', 'Middle'],
    exclusions: {
      Senior:
        'Manifest обучения: опубликованное содержание проверяет исправление и связь evidence; самостоятельная ответственность за policy/эволюцию этой модели не заявляется. Дополнительные компоненты не дают Senior support.',
    },
  },
  mp_artifact_integrity: { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  mp_pipeline_cache: {
    grades: ['Junior', 'Middle'],
    exclusions: {
      Senior:
        'Кэш ML-pipeline: опубликованное содержание проверяет исправление и связь evidence; самостоятельная ответственность за policy/эволюцию этой модели не заявляется. Дополнительные компоненты не дают Senior support.',
    },
  },
  mp_pipeline_gate: { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  mp_registry_promotion: {
    grades: ['Middle', 'Senior'],
    exclusions: {
      Junior:
        'Promotion в registry: смысл модели требует взаимодействующих состояний или решения об общем риске; самостоятельный ограниченный локальный контракт не опубликован.',
    },
  },
  mp_registry_compatibility: { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  mp_deployment_bundle: { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  mp_rollback_contract: { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  mp_gpu_scheduling: { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  mp_training_cost: {
    grades: ['Junior', 'Middle'],
    exclusions: {
      Senior:
        'Бюджет обучения: опубликованное содержание проверяет исправление и связь evidence; самостоятельная ответственность за policy/эволюцию этой модели не заявляется. Дополнительные компоненты не дают Senior support.',
    },
  },
  mp_retrain_trigger: {
    grades: ['Middle', 'Senior'],
    exclusions: {
      Junior:
        'Триггер retraining: смысл модели требует взаимодействующих состояний или решения об общем риске; самостоятельный ограниченный локальный контракт не опубликован.',
    },
  },
  mp_feedback_lineage: {
    grades: ['Junior', 'Middle'],
    exclusions: {
      Senior:
        'Lineage обратной связи: опубликованное содержание проверяет исправление и связь evidence; самостоятельная ответственность за policy/эволюцию этой модели не заявляется. Дополнительные компоненты не дают Senior support.',
    },
  },
  'work-mlops-canary-rollback': {
    grades: ['Middle', 'Senior'],
    exclusions: {
      Junior:
        'Canary: сегментный SLO и обоснованный откат: смысл модели требует взаимодействующих состояний или решения об общем риске; самостоятельный ограниченный локальный контракт не опубликован.',
    },
  },
  'work-mlops-point-in-time': {
    grades: ['Junior', 'Middle'],
    exclusions: {
      Senior:
        'Feature Store: point-in-time join, TTL и задержка источника: опубликованное содержание проверяет исправление и связь evidence; самостоятельная ответственность за policy/эволюцию этой модели не заявляется. Дополнительные компоненты не дают Senior support.',
    },
  },
  'work-native-mp-retrain': { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  ga_retrieval_recall: { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  ga_chunk_context: {
    grades: ['Junior', 'Middle'],
    exclusions: {
      Senior:
        'Chunking и контекст: опубликованное содержание проверяет исправление и связь evidence; самостоятельная ответственность за policy/эволюцию этой модели не заявляется. Дополнительные компоненты не дают Senior support.',
    },
  },
  ga_citation_grounding: {
    grades: ['Junior', 'Middle'],
    exclusions: {
      Senior:
        'Проверяемые цитаты: опубликованное содержание проверяет исправление и связь evidence; самостоятельная ответственность за policy/эволюцию этой модели не заявляется. Дополнительные компоненты не дают Senior support.',
    },
  },
  ga_abstention: { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  ga_eval_dataset: { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  ga_judge_validation: {
    grades: ['Middle', 'Senior'],
    exclusions: {
      Junior:
        'Валидность LLM-judge: смысл модели требует взаимодействующих состояний или решения об общем риске; самостоятельный ограниченный локальный контракт не опубликован.',
    },
  },
  ga_tool_contract: { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  ga_agent_loop: {
    grades: ['Middle', 'Senior'],
    exclusions: {
      Junior:
        'Контроль agent loop: смысл модели требует взаимодействующих состояний или решения об общем риске; самостоятельный ограниченный локальный контракт не опубликован.',
    },
  },
  ga_context_budget: { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  ga_cache_latency: {
    grades: ['Junior', 'Middle'],
    exclusions: {
      Senior:
        'Кэш и latency LLM-системы: опубликованное содержание проверяет исправление и связь evidence; самостоятельная ответственность за policy/эволюцию этой модели не заявляется. Дополнительные компоненты не дают Senior support.',
    },
  },
  ga_untrusted_instructions: { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  ga_retrieval_access: { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  'work-llm-retrieval-trust': {
    grades: ['Junior', 'Middle'],
    exclusions: {
      Senior:
        'RAG: устаревший документ, недоверенный источник и prompt injection: опубликованное содержание проверяет исправление и связь evidence; самостоятельная ответственность за policy/эволюцию этой модели не заявляется. Дополнительные компоненты не дают Senior support.',
    },
  },
  'work-llm-grounding-abstention': {
    grades: ['Junior', 'Middle'],
    exclusions: {
      Senior:
        'Оценка ответов: доказательство, отказ и расход контекста: опубликованное содержание проверяет исправление и связь evidence; самостоятельная ответственность за policy/эволюцию этой модели не заявляется. Дополнительные компоненты не дают Senior support.',
    },
  },
  'work-native-ga-tools': { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  an_configuration_state: {
    grades: ['Junior', 'Middle'],
    exclusions: {
      Senior:
        'Configuration change: опубликованное содержание проверяет исправление и связь evidence; самостоятельная ответственность за policy/эволюцию этой модели не заявляется. Дополнительные компоненты не дают Senior support.',
    },
  },
  an_process_restore: { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  an_flow_collection: { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  an_compose_identity: {
    grades: ['Junior', 'Middle'],
    exclusions: {
      Senior:
        'Compose identity: опубликованное содержание проверяет исправление и связь evidence; самостоятельная ответственность за policy/эволюцию этой модели не заявляется. Дополнительные компоненты не дают Senior support.',
    },
  },
  an_room_offline: { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  an_sync_conflict: {
    grades: ['Middle', 'Senior'],
    exclusions: {
      Junior:
        'Конфликт offline-изменений: смысл модели требует взаимодействующих состояний или решения об общем риске; самостоятельный ограниченный локальный контракт не опубликован.',
    },
  },
  an_workmanager: { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  an_background_permissions: { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  an_main_thread: {
    grades: ['Junior', 'Middle'],
    exclusions: {
      Senior:
        'Main thread и ANR: опубликованное содержание проверяет исправление и связь evidence; самостоятельная ответственность за policy/эволюцию этой модели не заявляется. Дополнительные компоненты не дают Senior support.',
    },
  },
  an_memory_startup: { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  an_room_migration: { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  an_deeplink_release: { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  'work-native-an-restore': {
    grades: ['Junior', 'Middle'],
    exclusions: {
      Senior:
        'Android: сохранение черновика при process recreation: опубликованное содержание проверяет исправление и связь evidence; самостоятельная ответственность за policy/эволюцию этой модели не заявляется. Дополнительные компоненты не дают Senior support.',
    },
  },
  'work-native-an-offline': { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  'work-native-an-frame': {
    grades: ['Junior', 'Middle'],
    exclusions: {
      Senior:
        'Android: frame budget и resource pressure: опубликованное содержание проверяет исправление и связь evidence; самостоятельная ответственность за policy/эволюцию этой модели не заявляется. Дополнительные компоненты не дают Senior support.',
    },
  },
  io_scene_restore: { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  io_background_completion: {
    grades: ['Junior', 'Middle'],
    exclusions: {
      Senior:
        'Завершение фоновой задачи: опубликованное содержание проверяет исправление и связь evidence; самостоятельная ответственность за policy/эволюцию этой модели не заявляется. Дополнительные компоненты не дают Senior support.',
    },
  },
  io_state_ownership: { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  io_observation: {
    grades: ['Junior', 'Middle'],
    exclusions: {
      Senior:
        'Наблюдаемость модели: опубликованное содержание проверяет исправление и связь evidence; самостоятельная ответственность за policy/эволюцию этой модели не заявляется. Дополнительные компоненты не дают Senior support.',
    },
  },
  io_actor_isolation: { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  io_task_cancellation: {
    grades: ['Junior', 'Middle'],
    exclusions: {
      Senior:
        'Cancellation и результат task: опубликованное содержание проверяет исправление и связь evidence; самостоятельная ответственность за policy/эволюцию этой модели не заявляется. Дополнительные компоненты не дают Senior support.',
    },
  },
  io_local_persistence: { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  io_offline_merge: {
    grades: ['Middle', 'Senior'],
    exclusions: {
      Junior:
        'Слияние offline-правки: смысл модели требует взаимодействующих состояний или решения об общем риске; самостоятельный ограниченный локальный контракт не опубликован.',
    },
  },
  io_responsiveness: { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  io_memory_images: {
    grades: ['Junior', 'Middle'],
    exclusions: {
      Senior:
        'Память изображений: опубликованное содержание проверяет исправление и связь evidence; самостоятельная ответственность за policy/эволюцию этой модели не заявляется. Дополнительные компоненты не дают Senior support.',
    },
  },
  io_store_migration: {
    grades: ['Middle', 'Senior'],
    exclusions: {
      Junior:
        'Миграция store: смысл модели требует взаимодействующих состояний или решения об общем риске; самостоятельный ограниченный локальный контракт не опубликован.',
    },
  },
  io_privacy_links: { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  'work-native-io-scene': {
    grades: ['Junior', 'Middle'],
    exclusions: {
      Senior:
        'iOS: SceneStorage key и persistent draft: опубликованное содержание проверяет исправление и связь evidence; самостоятельная ответственность за policy/эволюцию этой модели не заявляется. Дополнительные компоненты не дают Senior support.',
    },
  },
  'work-native-io-actors': { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  'work-native-io-bgtime': { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  se_asset_boundary: {
    grades: ['Junior', 'Middle'],
    exclusions: {
      Senior:
        'Актив и граница доверия: опубликованное содержание проверяет исправление и связь evidence; самостоятельная ответственность за policy/эволюцию этой модели не заявляется. Дополнительные компоненты не дают Senior support.',
    },
  },
  se_tenant_trust: { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  se_object_authorization: {
    grades: ['Junior', 'Middle'],
    exclusions: {
      Senior:
        'Объектная авторизация: опубликованное содержание проверяет исправление и связь evidence; самостоятельная ответственность за policy/эволюцию этой модели не заявляется. Дополнительные компоненты не дают Senior support.',
    },
  },
  se_function_policy: { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  se_session_lifecycle: { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  se_secret_rotation: { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  se_query_input: {
    grades: ['Junior', 'Middle'],
    exclusions: {
      Senior:
        'Безопасная интерпретация входа: опубликованное содержание проверяет исправление и связь evidence; самостоятельная ответственность за policy/эволюцию этой модели не заявляется. Дополнительные компоненты не дают Senior support.',
    },
  },
  se_external_resource: { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  se_build_provenance: {
    grades: ['Middle', 'Senior'],
    exclusions: {
      Junior:
        'Происхождение сборки: смысл модели требует взаимодействующих состояний или решения об общем риске; самостоятельный ограниченный локальный контракт не опубликован.',
    },
  },
  se_dependency_risk: { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  se_control_verification: { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  se_audit_signal: { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  'work-native-se-authz': { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
  'work-native-se-provenance': {
    grades: ['Junior', 'Middle'],
    exclusions: {
      Senior:
        'AppSec: provenance и release digest: опубликованное содержание проверяет исправление и связь evidence; самостоятельная ответственность за policy/эволюцию этой модели не заявляется. Дополнительные компоненты не дают Senior support.',
    },
  },
  'work-native-se-session': { grades: ['Junior', 'Middle', 'Senior'], exclusions: {} },
};

export function auditGradeSupport(model: ItemModel): ItemModel {
  const review = gradeSupportReviews[model.id];
  if (!review) throw new Error(`ItemModel не прошла grade-support audit: ${model.id}`);
  const catalog = decisionCatalogs[model.specialization];
  const decisionArchetypes = catalog?.bundles[model.competencyDomain!];
  if (!decisionArchetypes) throw new Error(`Нет предметной области решений: ${model.id}`);
  const audited = { ...model, decisionArchetypes: [...decisionArchetypes] };
  const actions = modelDecisionCatalog(audited);
  const configurations = trackGradeConfigurations(model.specialization);
  const evidence = model.cases[0]!;
  return {
    ...audited,
    supportedGrades: [...review.grades],
    gradeRange: [...review.grades],
    gradeExclusions: { ...review.exclusions },
    supportsJunior: review.grades.includes('Junior'),
    supportsMiddle: review.grades.includes('Middle'),
    supportsSenior: review.grades.includes('Senior'),
    gradeSupportRationale: `${model.title}: grade support определён опубликованными контрактами содержания, evidence и решений; ограничения проверены отдельно.`,
    gradeConfigurations: Object.fromEntries(
      review.grades.map((grade) => {
        const local = `${model.title}: безопасно восстановить ограниченный контракт. Изучить ${evidence.diagnostic}: ${evidence.evidence}`;
        const interaction = `${model.title}: связать подтверждённое состояние ${model.competencyDomain} с независимым наблюдением и определить, к какому состоянию применимо исправление.`;
        const strategic = `${model.title}: выбрать policy для ${model.competencyDomain}; сравнить ${actions.map((action) => action.id).join(', ')} при заданной стоимости, сроке и остаточной экспозиции. Физическое исправление не определяет стратегию.`;
        const responsibility =
          grade === 'Junior' ? local : grade === 'Middle' ? interaction : strategic;
        return [
          grade,
          {
            ...configurations[grade],
            responsibility,
            professionalResponsibility: responsibility,
            requiredReasoning:
              grade === 'Junior'
                ? `Связать наблюдение с контрактом: ${evidence.invariant}`
                : grade === 'Middle'
                  ? `Проверить происхождение evidence и применимость плана к состоянию: ${evidence.invariant}`
                  : `Сохранить ${evidence.invariant} и выбрать допустимое предметное решение по constraints; учесть последствия и пересмотр.`,
            uniqueRadicals:
              grade === 'Junior'
                ? [`${model.id}:bounded-contract`, evidence.diagnostic]
                : grade === 'Middle'
                  ? [`${model.id}:state-correlation`, 'confirmed-revision', evidence.diagnostic]
                  : [
                      `${model.id}:native-policy`,
                      ...actions.map((action) => action.id),
                      'decision-priority',
                      'reversible-decision',
                    ],
            typicalDecisions:
              grade === 'Senior'
                ? actions.map((action) => action.action)
                : configurations[grade].typicalDecisions,
          },
        ];
      }),
    ),
  };
}
