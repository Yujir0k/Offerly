"use client";
import { useEffect, useState } from "react";
import {
  ChevronDown,
  Check,
  FileText,
  Award,
  Mail,
  Search,
  Users,
  Folder,
  Send,
  Building2,
  Settings,
  LockKeyhole,
  Code2,
  Sparkles,
  Menu,
} from "lucide-react";
import { Brand, MiniCandidate } from "./brand";
import { PublicFooter } from "./public-footer";
import {
  CandidateJourney,
  AssessmentPreview,
  PrivacyPreview,
  LandingFaq,
  LandingWorkspacePreview,
} from "./landing-scenes";
import {
  NavigationMenu,
  NavigationMenuList,
  NavigationMenuItem,
  NavigationMenuTrigger,
  NavigationMenuContent,
  NavigationMenuLink,
} from "@/components/ui/navigation-menu";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
export type Navigate = (path: string) => void;
export function PublicHeader({
  nav,
  landing = false,
}: {
  nav: Navigate;
  landing?: boolean;
}) {
  const [mobile, setMobile] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [menuActivated, setMenuActivated] = useState(false);
  const dark = scrolled || menuActivated || mobile;
  useEffect(() => {
    if (!landing) return;
    const update = () => {
      setScrolled(window.scrollY > 24);
      if (window.scrollY <= 2) setMenuActivated(false);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, [landing]);
  return (
    <header
      className={`public-header ${landing ? "landing-header" : ""} ${dark ? "is-scrolled" : ""}`}
    >
      <div className="nav-container">
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault();
            nav("/");
          }}
          aria-label="Офферли — главная"
        >
          <Brand light={landing && !dark} />
        </a>
        <nav aria-label="Главная навигация">
          <NavigationMenu
            className="role-navigation"
            onPointerEnter={() => landing && setMenuActivated(true)}
            onValueChange={(value) => {
              if (landing && value) setMenuActivated(true);
            }}
            delayDuration={100}
            skipDelayDuration={500}
          >
            <NavigationMenuList>
              <RoleMenu role="candidate" nav={nav} />
              <RoleMenu role="employer" nav={nav} />
            </NavigationMenuList>
          </NavigationMenu>
          <button className="nav-login" onClick={() => nav("/login")}>
            Войти
          </button>
          <button
            className="btn primary nav-cta"
            onClick={() => nav("/register")}
          >
            Зарегистрироваться
          </button>
          <button
            className="mobile-nav-trigger"
            aria-label="Открыть меню"
            aria-expanded={mobile}
            onClick={() => setMobile(!mobile)}
          >
            <Menu />
          </button>
        </nav>
      </div>
      {mobile && (
        <div className="mobile-nav">
          <button
            onClick={() => {
              setMobile(false);
              nav("/register?role=candidate");
            }}
          >
            Кандидатам
          </button>
          <button
            onClick={() => {
              setMobile(false);
              nav("/register?role=employer");
            }}
          >
            Работодателям
          </button>
          <button
            onClick={() => {
              setMobile(false);
              nav("/login");
            }}
          >
            Войти
          </button>
          <button
            onClick={() => {
              setMobile(false);
              nav("/register");
            }}
          >
            Зарегистрироваться
          </button>
          <button
            onClick={() => {
              setMobile(false);
              nav("/demo/employer");
            }}
          >
            Посмотреть платформу
          </button>
        </div>
      )}
    </header>
  );
}
function RoleMenu({
  role,
  nav,
}: {
  role: "candidate" | "employer";
  nav: Navigate;
}) {
  const emp = role === "employer";
  const items = emp
    ? [
        [
          "Как устроен подбор",
          "Категории и подтверждённые навыки",
          "/#for-employers",
        ],
        ["Кандидаты", "Специалисты для вашей команды", "/demo/employer"],
        [
          "Приглашения",
          "Условия до первого разговора",
          "/demo/employer/invitations",
        ],
        ["Подборки", "От задачи к подходящим людям", "/demo/employer/needs"],
        ["Компания", "Расскажите о вашей команде", "/demo/employer/company"],
        [
          "Начать подбор",
          "Создать кабинет работодателя",
          "/register?role=employer",
        ],
      ]
    : [
        ["Как это работает", "От профиля — к предложению", "/#how-it-works"],
        [
          "Проверка навыков",
          "Проверка уровня, тесты и практические задачи",
          "/demo/candidate/assessment",
        ],
        [
          "Предложения",
          "Приглашения от работодателей",
          "/demo/candidate/invitations",
        ],
        ["Профиль", "Покажите то, что умеете", "/demo/candidate/profile"],
        ["Вакансии", "Посмотрите открытые предложения", "/demo/candidate/jobs"],
        [
          "Создать профиль",
          "Начните свой следующий шаг",
          "/register?role=candidate",
        ],
      ];
  return (
    <NavigationMenuItem className="role-nav-item">
      <NavigationMenuTrigger className="role-trigger">
        {emp ? "Работодателям" : "Кандидатам"}
      </NavigationMenuTrigger>
      <NavigationMenuContent className="role-panel">
        <div className="role-panel-grid">
          {items.map(([title, desc, path]) => (
            <NavigationMenuLink asChild key={title}>
              <a
                href={path}
                onClick={(e) => {
                  if (!path.includes("#")) {
                    e.preventDefault();
                    nav(path);
                  }
                }}
                className="role-panel-link"
              >
                <strong>{title}</strong>
                <span>{desc}</span>
              </a>
            </NavigationMenuLink>
          ))}
        </div>
        <div className="role-panel-strip">
          <p>
            {emp
              ? "Команда начинается с людей."
              : "Ваш следующий шаг. Дело найдёт."}
          </p>
          <NavigationMenuLink asChild>
            <a
              href={`/register?role=${role}`}
              className="btn primary"
              onClick={(e) => {
                e.preventDefault();
                nav(`/register?role=${role}`);
              }}
            >
              {emp ? "Найти кандидатов" : "Создать профиль"}
            </a>
          </NavigationMenuLink>
        </div>
      </NavigationMenuContent>
    </NavigationMenuItem>
  );
}
export function Landing({ nav }: { nav: Navigate }) {
  useEffect(() => {
    const nodes = document.querySelectorAll(".reveal");
    const observer = new IntersectionObserver(
      (es) =>
        es.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("visible");
            observer.unobserve(e.target);
          }
        }),
      { threshold: 0.1 },
    );
    nodes.forEach((n) => observer.observe(n));
    const scene = document.querySelector<HTMLElement>(".product-scene");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    const updateScene = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (scene) {
          const progress = reduced.matches
            ? 1
            : Math.max(
                0,
                Math.min(
                  1,
                  (window.innerHeight - scene.getBoundingClientRect().top) /
                    (window.innerHeight * 0.7),
                ),
              );
          scene.style.setProperty("--scene-progress", String(progress));
        }
      });
    };
    updateScene();
    window.addEventListener("scroll", updateScene, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", updateScene);
      cancelAnimationFrame(frame);
    };
  }, []);
  return (
    <div className="landing landing-refresh">
      <PublicHeader nav={nav} landing />
      <main>
        <section className="hero">
          <div className="hero-content">
            <span className="hero-intro reveal">
              <img src="/brand/original.svg" alt="" /> Офферли <span>·</span>{" "}
              Работа начинается с навыков
            </span>
            <h1 className="reveal" style={{ transitionDelay: "70ms" }}>
              <span className="brand-headline">Навыки говорят.</span>
              <br />
              <span className="headline-accent">Дело найдёт.</span>
            </h1>
            <p
              className="reveal hero-lead"
              style={{ transitionDelay: "140ms" }}
            >
              Подтвердите свой уровень. Получайте приглашения с понятными
              условиями.
              <br className="desktop-break" /> Собирайте команду по навыкам,
              которые проверены.
            </p>
            <div
              className="hero-actions reveal"
              style={{ transitionDelay: "200ms" }}
            >
              <button
                className="btn primary large"
                onClick={() => nav("/register?role=candidate")}
              >
                Создать профиль
              </button>
              <button
                className="btn outline large"
                onClick={() => nav("/register?role=employer")}
              >
                Найти кандидатов
              </button>
            </div>
            <div className="hero-notes reveal">
              <span>
                <Check size={15} />
                Подтверждённые навыки
              </span>
              <span>
                <Check size={15} />
                Зарплата до общения
              </span>
              <span>
                <LockKeyhole size={15} />
                Контакты под контролем
              </span>
            </div>
          </div>
          <div className="product-scene reveal">
            <LandingWorkspacePreview />
            <div className="scene-signals">
              {" "}
              <div className="floating-confirm">
                <Award />
                <div>
                  <strong>Middle подтверждён</strong>
                  <small>Навыки проверены тестом</small>
                </div>
              </div>
              <div className="floating-invite">
                <span className="red-icon">
                  <Mail />
                </span>
                <div>
                  <small>Новое приглашение</small>
                  <strong>180 000 — 230 000 ₽/мес</strong>
                  <span>от работодателя</span>
                </div>
              </div>
            </div>
          </div>
        </section>
        <CandidateJourney nav={nav} />
        <AssessmentPreview nav={nav} />
        <section
          className="employer-section landing-employer"
          id="for-employers"
        >
          <div className="section-wrap employer-inner">
            <div className="reveal">
              <span className="eyebrow">РАБОТОДАТЕЛЯМ</span>
              <h2>
                Нанимайте
                <br />
                по навыкам.
              </h2>
              <p>
                Опишите задачи команды.
                <br />
                Мы покажем подходящих специалистов
                <br />и объясним подбор.
              </p>
              <button
                className="btn white large"
                onClick={() => nav("/register?role=employer")}
              >
                Подобрать команду
              </button>
              <div className="emp-checks">
                <span>
                  <Check size={17} />
                  Проверенная категория
                </span>
                <span>
                  <Check size={17} />
                  Понятные причины соответствия
                </span>
                <span>
                  <Check size={17} />
                  Предложения напрямую
                </span>
              </div>
            </div>
            <div className="employer-example reveal">
              <div className="example-label">
                <span>
                  <Sparkles size={18} /> Подборка под вашу потребность
                </span>
                <span className="mono">01 / 24</span>
              </div>
              <MiniCandidate compact />
              <div className="example-explanation">
                <strong>Почему подходит вашей команде</strong>
                <span>
                  <Check size={17} />
                  Python и SQL подтверждены проверкой
                </span>
                <span>
                  <Check size={17} />
                  Совпадает категория Backend Middle
                </span>
                <span>
                  <Check size={17} />
                  Выбран удалённый формат
                </span>
              </div>
              <button
                className="btn primary full"
                onClick={() => nav("/demo/employer")}
              >
                Посмотреть кандидатов
              </button>
            </div>
          </div>
        </section>
        <PrivacyPreview />
        <LandingFaq nav={nav} />
        <section className="bottom-cta">
          <div className="section-wrap">
            <div>
              <span className="eyebrow">ВАШ СЛЕДУЮЩИЙ ШАГ</span>
              <h2>Дело найдёт.</h2>
              <p>
                Покажите, что умеете.
                <br />
                Встретьте команду, которой это нужно.
              </p>
            </div>
            <div>
              <button
                className="btn primary large"
                onClick={() => nav("/register")}
              >
                Создать профиль
              </button>
              <button
                className="text-link"
                onClick={() => nav("/demo/employer")}
              >
                Сначала посмотреть платформу
              </button>
            </div>
          </div>
        </section>
      </main>
      <PublicFooter nav={nav} />
    </div>
  );
}
