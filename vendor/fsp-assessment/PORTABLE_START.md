# Запуск на другом компьютере

Архив содержит папку `blabla` с проектом, исходниками веб-интерфейса, lock-файлами, документацией, первичными данными валидации и замороженными версиями генератора. В `references` находятся ТЗ и расшифровка организаторов. Рабочие исходники находятся в `blabla/src`, а не в исторических snapshots.

Нужны Node.js **22.17+** и pnpm **11.19.0**, доступ к реестру пакетов для первого `install`. Установленные зависимости, кеши и локальные секреты `.env` в архив не включены; привязка к путям Codex не нужна. В этом checkout нет сохранённой рабочей базы пользователей. Демо-данные создаются при настройке/запуске.

Из распакованной папки `blabla`:

```powershell
pnpm install --frozen-lockfile
pnpm build
cd offerly-web
pnpm install --frozen-lockfile
pnpm run setup:local
cd ..
pnpm start
```

Основной адрес: `http://127.0.0.1:4310`. API работает на 4313. Проверка кандидата: `/demo/candidate/assessment`, качество и валидация: `/demo/employer/quality`. Демо-аккаунты API: `candidate@demo.local`, `employer@demo.local`, `admin@demo.local`, пароль `Demo2026!pass`. Это локальная демонстрация.

Если нужен только алгоритм без веб-интерфейса:

```powershell
pnpm install --frozen-lockfile
pnpm build
node --test --test-concurrency=4 dist/test/*.test.js
node --input-type=module -e 'import {verifyAssessmentRevision} from "./dist/src/synthetic-validation/revision.js"; console.log(verifyAssessmentRevision())'
```

Исторические `data/assessment-revisions/*/dist` включены специально для воспроизводимости. Основной `dist` пересобирается командой `pnpm build`. Старые эксперименты не перезаписывать. Перед продолжением разработки прочитать `AGENT_HANDOFF.md` и актуальный отчёт `docs/ASSESSMENT_FINAL_7_3_3.md`.
