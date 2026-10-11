"use client";
import { ArrowRight } from "lucide-react";
import type { Navigate } from "./landing";

export function SkillChecks({ nav }: { nav: Navigate }) {
  return (
    <section className="skills-coming-soon">
      <span className="skills-coming-label">В разработке</span>
      <h2>Тесты по навыкам ещё готовятся</h2>
      <p>
        Здесь будут отдельные тесты на знание языков программирования,
        инструментов и технологий. Сейчас раздел разрабатывается — пройти
        проверку отдельного навыка пока нельзя.
      </p>
      <div
        className="skills-coming-examples"
        aria-label="Примеры будущих проверок"
      >
        <span>Python</span>
        <span>JavaScript</span>
        <span>Kotlin</span>
        <span>SQL</span>
      </div>
      <div className="skills-coming-next">
        <p>
          Проверка профессионального уровня уже доступна. Подтвердите Junior,
          Middle или Senior в разделе «Проверка уровня».
        </p>
        <button
          className="activity-button primary"
          onClick={() => nav("/demo/candidate/assessment")}
        >
          Проверить уровень <ArrowRight size={18} />
        </button>
      </div>
    </section>
  );
}
