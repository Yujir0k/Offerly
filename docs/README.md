# Документация Офферли

Начните с [актуальной проверки безопасности, VPS и оставшихся пунктов](reports/2026-10-11/security-final.md). Более ранние отчёты описывают состояние на момент своего прогона; их числа не складываются в процент покрытия.

| Раздел | Что находится внутри |
|---|---|
| [architecture/](architecture/) | Архитектура, приватность, данные, масштабирование, антифрод и интеграции |
| [api/](api/) | [OpenAPI](api/openapi.json) и описание действий API |
| [assessment/](assessment/README.md) | Устройство профессиональных испытаний и исходная валидация |
| [guides/](guides/) | Локальный запуск почты, ФСП, MCP, подбор, каталог и подготовка production |
| [planning/](planning/) | Следующие шаги и исторические предложения |
| [reports/2026-10-10/](reports/2026-10-10/) | Отчёты отдельных итераций, текущая сверка ТЗ |

Ключевые инструкции: [MCP](guides/employer-mcp.md), [локальный ФСП](guides/fsp-demo.md), [реальная ФСП-интеграция](guides/fsp-id.md), [почта](guides/local-mail.md), [подбор по задаче](guides/task-recommendations.md), [подготовка сервера](guides/production-checklist.md).

Публичная копия OpenAPI находится в `public/openapi.json`; источник — `docs/api/openapi.json`. После изменений выполняются `node scripts/update-mvp-openapi.mjs` и `npm run check:api`. Схемы MCP, добровольных задач и завершения по времени входят в эту спецификацию.

[Карта перемещений документации](structure-migration-20261010.json) сохраняет соответствие старых и новых путей. Код приложения и миграции БД остаются в своих прежних каталогах.

[Защита](architecture/security.md) · [Схема системы](architecture/system.svg) · [Исходное ТЗ](requirements/fsp-specification.md) · [Место для скринкаста](video/README.md)
