"use client";
import { ChoiceSelect } from "./choice-select";
import { useState } from "react";
import {
  Check,
  ChevronDown,
  CheckCheck,
  FileText,
  Award,
  ChartNoAxesCombined,
  ListChecks,
  ScanSearch,
  Fingerprint,
  Search,
  Folder,
  Send,
  X,
  ArrowUpRight,
  Mail,
  LockKeyhole,
  MapPin,
  BriefcaseBusiness,
  Code2,
  Upload,
  Eye,
  EyeOff,
  Building2,
} from "lucide-react";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Progress } from "@/components/ui/progress";
import { Brand, MiniCandidate, Badge, Tags } from "./brand";
import type { Navigate } from "./landing";

// This preview owns only ephemeral React state. It has no workspace, storage or API access.
export function LandingWorkspacePreview() {
  const [section, setSection] = useState("candidates");
  const [specialization, setSpecialization] = useState("Backend");
  const [query, setQuery] = useState("");
  const [detail, setDetail] = useState<"profile" | "invite" | null>(null);
  const [prepared, setPrepared] = useState(false);
  const frontend = specialization === "Frontend";
  const candidateId = frontend ? "1087" : "1042";
  const matches =
    `${specialization} ${frontend ? "React TypeScript CSS 1087" : "Python SQL FastAPI 1042"} Москва Middle`
      .toLowerCase()
      .includes(query.trim().toLowerCase());
  const sections = [
    { id: "candidates", title: "Поиск кандидатов", icon: Search },
    { id: "needs", title: "Подборки", icon: Folder },
    { id: "invitations", title: "Приглашения", icon: Send },
    { id: "company", title: "Компания", icon: Building2 },
  ];
  const titles: Record<string, string> = {
    candidates: "Кандидаты для вашей команды",
    needs: "Подборки под ваши задачи",
    invitations: "Предложения с понятными условиями",
    company: "Команда, в которой хочется работать",
  };
  const changeSection = (value: string) => {
    setSection(value);
    setDetail(null);
  };
  const openCollection = (value: string) => {
    setSpecialization(value);
    setQuery("");
    changeSection("candidates");
  };
  return (
    <div
      className="product-preview interactive-preview"
      aria-label="Интерактивный обзор кабинета"
    >
      <div className="preview-sidebar">
        <Brand small />
        <nav aria-label="Разделы интерактивного обзора">
          {sections.map(({ id, title, icon: Icon }) => (
            <button
              key={id}
              type="button"
              aria-pressed={section === id}
              className={section === id ? "active" : ""}
              onClick={() => changeSection(id)}
            >
              <Icon size={18} />
              {title}
            </button>
          ))}
        </nav>
        <span className="preview-sandbox-note">
          <Eye size={15} /> Обзор интерфейса
        </span>
      </div>
      <div className="preview-main">
        <nav className="preview-mobile-tabs" aria-label="Разделы обзора">
          {sections.map(({ id, title }) => (
            <button
              key={id}
              aria-pressed={section === id}
              onClick={() => changeSection(id)}
            >
              {title}
            </button>
          ))}
        </nav>
        <div className="preview-top">
          <div>
            <span className="meta">
              {section === "candidates"
                ? `Подборка: ${specialization} Middle`
                : "Ваше рабочее пространство"}
            </span>
            <h2>{titles[section]}</h2>
          </div>
          {section === "candidates" && (
            <label className="preview-search">
              <Search size={16} />
              <input
                aria-label="Поиск в обзоре"
                placeholder="Поиск по навыкам"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
          )}
        </div>
        <div className="preview-view" key={section}>
          {section === "candidates" && (
            <>
              <div className="preview-filters">
                <ChoiceSelect
                  label="Специализация в обзоре"
                  value={specialization}
                  options={["Backend", "Frontend"].map((value) => ({
                    value,
                    label: value,
                  }))}
                  onChange={(value) => {
                    setSpecialization(value);
                    setQuery("");
                    setDetail(null);
                  }}
                />
                <span>Middle</span>
                <span>{frontend ? "React · TypeScript" : "Python · SQL"}</span>
              </div>
              <div className="preview-count">
                {matches ? "Подходящий кандидат" : "Совпадений пока нет"}
                <span>По подтверждённым навыкам</span>
              </div>
              {matches ? (
                <div className="preview-card">
                  <MiniCandidate frontend={frontend} />
                  <div className="preview-card-actions">
                    <button
                      className="btn primary"
                      onClick={() => {
                        setDetail("invite");
                        setPrepared(false);
                      }}
                    >
                      Пригласить
                    </button>
                    <button
                      className="btn subtle"
                      onClick={() => setDetail("profile")}
                    >
                      Подробнее
                    </button>
                  </div>
                </div>
              ) : (
                <div className="preview-empty">
                  <Search size={30} />
                  <h3>Попробуйте другой навык</h3>
                  <p>В этом обзоре доступны Python, SQL, React и TypeScript.</p>
                  <button className="btn subtle" onClick={() => setQuery("")}>
                    Сбросить поиск
                  </button>
                </div>
              )}
            </>
          )}
          {section === "needs" && (
            <div className="preview-collections">
              {["Backend", "Frontend"].map((name) => (
                <button
                  className="preview-collection"
                  key={name}
                  onClick={() => openCollection(name)}
                >
                  <span className="collection-icon">
                    <Folder size={24} />
                  </span>
                  <small className="mono">ПОТРЕБНОСТЬ КОМАНДЫ</small>
                  <h3>{name} · Middle</h3>
                  <p>
                    {name === "Backend"
                      ? "API, данные и надёжные сервисы"
                      : "Интерфейсы продукта и дизайн-система"}
                  </p>
                  <Tags
                    items={
                      name === "Backend"
                        ? ["Python", "SQL"]
                        : ["React", "TypeScript"]
                    }
                  />
                  <strong>
                    Посмотреть кандидата <ArrowUpRight size={18} />
                  </strong>
                </button>
              ))}
            </div>
          )}
          {section === "invitations" && (
            <div className="preview-offer-card">
              <span className="collection-icon red">
                <Send size={24} />
              </span>
              <span className="mono">
                ПРИГЛАШЕНИЕ · КАНДИДАТ #{candidateId}
              </span>
              <h3>{specialization}-разработчик</h3>
              <strong className="preview-offer-salary">
                180 000 — 230 000 ₽/мес
              </strong>
              <p>Продуктовая команда · Удалённо · Полная занятость</p>
              <div className="preview-contact-rule">
                <LockKeyhole size={18} />
                Контакты доступны после принятия приглашения
              </div>
              <button
                className="btn primary"
                onClick={() => {
                  setDetail("invite");
                  setPrepared(false);
                }}
              >
                Посмотреть условия
              </button>
            </div>
          )}
          {section === "company" && (
            <div className="preview-company">
              <span className="collection-icon">
                <Building2 size={30} />
              </span>
              <div>
                <span className="mono">ПРОДУКТОВАЯ КОМАНДА</span>
                <h3>Люди. Идеи. Общее дело.</h3>
                <p>
                  Создаём цифровые продукты и ищем тех, кому интересно развивать
                  их вместе. Прозрачные условия, понятные задачи и внимание к
                  навыкам.
                </p>
                <Tags
                  items={[
                    "Удалённая команда",
                    "Развитие продукта",
                    "Обмен знаниями",
                  ]}
                />
                <button
                  className="btn subtle"
                  onClick={() => changeSection("needs")}
                >
                  Какие специалисты нужны <ArrowUpRight size={17} />
                </button>
              </div>
            </div>
          )}
        </div>
        {detail && (
          <div
            className="preview-detail"
            role="region"
            aria-label={
              detail === "profile"
                ? "Профиль в обзоре"
                : "Условия приглашения в обзоре"
            }
          >
            <button
              className="preview-close"
              aria-label="Закрыть подробности обзора"
              onClick={() => setDetail(null)}
            >
              <X size={20} />
            </button>
            <span className="mono">
              {detail === "profile"
                ? `ПРОФЕССИОНАЛЬНЫЙ ПРОФИЛЬ · #${candidateId}`
                : "ПРИГЛАШЕНИЕ В КОМАНДУ"}
            </span>
            <h3>{specialization}-разработчик · Middle</h3>
            {detail === "profile" ? (
              <>
                <p>
                  Практические навыки проверены. Интересны продуктовые задачи,
                  удалённая работа и развитие в команде.
                </p>
                <div className="preview-competencies">
                  <span>
                    {frontend ? "React" : "Python"}
                    <strong>90%</strong>
                  </span>
                  <Progress value={90} />
                  <span>
                    {frontend ? "TypeScript" : "SQL"}
                    <strong>85%</strong>
                  </span>
                  <Progress value={85} />
                </div>
                <div className="preview-contact-rule">
                  <LockKeyhole size={18} />
                  Контакты скрыты до согласия кандидата
                </div>
              </>
            ) : (
              <>
                <strong className="preview-offer-salary">
                  180 000 — 230 000 ₽/мес
                </strong>
                <p>
                  {frontend
                    ? "Развивать интерфейсы на React и TypeScript вместе с дизайнером и командой продукта."
                    : "Развивать API на Python, работать с данными и архитектурой сервисов."}
                </p>
                <div className="preview-contact-rule">
                  <Eye size={18} />
                  Это просмотр условий. Реальное приглашение здесь не
                  отправляется.
                </div>
                <button
                  className="btn primary"
                  disabled={prepared}
                  onClick={() => setPrepared(true)}
                >
                  {prepared ? "Условия просмотрены" : "Проверить предложение"}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const journey = [
  {
    id: "profile",
    title: "Расскажите, что вам интересно",
    text: "Загрузите резюме или заполните профиль. Выберите специализацию, формат работы и зарплатные ожидания. Коммерческий опыт и достижения ФСП необязательны.",
    icon: FileText,
  },
  {
    id: "test",
    title: "Покажите, что умеете",
    text: "Выберите специализацию и заявленный уровень. Затем пройдите тест и практические задачи. В результате вы увидите свою категорию и результаты по компетенциям.",
    icon: ListChecks,
  },
  {
    id: "offer",
    title: "Выберите своё предложение",
    text: "Работодатель сам приглашает вас в команду. Задачи, зарплата и формат работы видны сразу. Принимать предложение или продолжать поиск — решаете вы.",
    icon: Mail,
  },
];
function DemoPerson({ large = false }: { large?: boolean }) {
  return (
    <div className={`demo-person ${large ? "large" : ""}`}>
      <img
        src="/portraits/developer-female.webp"
        width={80}
        height={80}
        alt="Портрет демонстрационного кандидата"
        loading="lazy"
      />
      <div>
        <span className="mono">Кандидат #1087</span>
        <strong>Frontend-разработчик</strong>
        <span>React · TypeScript · Интерфейсы</span>
      </div>
    </div>
  );
}
export function CandidateJourney({ nav }: { nav: Navigate }) {
  const [step, setStep] = useState("profile");
  return (
    <section className="journey-section section-wrap" id="how-it-works">
      <div className="narrative-heading reveal">
        <span className="eyebrow">КАНДИДАТАМ</span>
        <h2>
          От навыков —<br />
          <span>к предложению.</span>
        </h2>
        <p>
          Ваш опыт — начало разговора.
          <br />
          Подтверждённые навыки — повод пригласить.
        </p>
      </div>
      <div className="journey-layout">
        <div className="journey-copy reveal">
          <Accordion
            type="single"
            value={step}
            onValueChange={(v) => {
              if (v) setStep(v);
            }}
            className="journey-accordion"
          >
            {journey.map((item, i) => (
              <AccordionItem value={item.id} key={item.id}>
                <AccordionTrigger>
                  <span className="journey-number mono">0{i + 1}</span>
                  <span>{item.title}</span>
                </AccordionTrigger>
                <AccordionContent>{item.text}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
          <button
            className="btn primary large"
            onClick={() => nav("/register?role=candidate")}
          >
            Создать профиль
          </button>
        </div>
        <div className="journey-stage reveal" aria-live="polite">
          <div className="stage-caption mono">
            <span>ВАШ СЛЕДУЮЩИЙ ШАГ</span>
            <span>0{journey.findIndex((s) => s.id === step) + 1} / 03</span>
          </div>
          <div className="journey-demo" key={step}>
            {step === "profile" && (
              <>
                <div className="demo-window">
                  <div className="window-top">
                    <FileText size={18} />
                    <span>Профессиональный профиль</span>
                    <span className="mono">PDF</span>
                  </div>
                  <DemoPerson />
                  <div className="demo-fields">
                    <div>
                      <small>Специализация</small>
                      <strong>Frontend-разработка</strong>
                    </div>
                    <div>
                      <small>Формат работы</small>
                      <strong>Удалённо</strong>
                    </div>
                    <div>
                      <small>Ожидания</small>
                      <strong>от 160 000 ₽ / месяц</strong>
                    </div>
                  </div>
                  <Tags items={["React", "TypeScript", "CSS", "Git"]} />
                  <div className="upload-demo">
                    <Upload size={21} />
                    <div>
                      <strong>Начните с вашего резюме</strong>
                      <span>
                        Проверьте найденные данные и дополните профиль
                      </span>
                    </div>
                    <Check size={20} />
                  </div>
                </div>
                <div className="stage-note">
                  <CheckCheck size={19} /> Один профиль для всех предложений
                </div>
              </>
            )}
            {step === "test" && (
              <>
                <div className="demo-window">
                  <div className="window-top">
                    <ListChecks size={18} />
                    <span>Пример результата проверки</span>
                    <span className="mono">02</span>
                  </div>
                  <div className="demo-result-head">
                    <span className="result-symbol">
                      <Award size={32} />
                    </span>
                    <div>
                      <small>Подтверждённая категория</small>
                      <strong>Frontend · Middle</strong>
                    </div>
                  </div>
                  <div className="competency-demo">
                    {[
                      ["JavaScript", 90],
                      ["Работа с интерфейсами", 85],
                      ["Архитектура", 75],
                    ].map(([title, val]) => (
                      <div key={title}>
                        <span>
                          {title}
                          <strong className="mono">{val}%</strong>
                        </span>
                        <Progress
                          value={Number(val)}
                          aria-label={String(title)}
                        />
                      </div>
                    ))}
                  </div>
                  <div className="demo-insight">
                    <Code2 size={20} />
                    <p>
                      Результаты по каждой теме.
                      <br />
                      <strong>
                        Понятно, что уже получается и что развивать.
                      </strong>
                    </p>
                  </div>
                </div>
                <div className="stage-note">
                  <ChartNoAxesCombined size={19} /> Категория опирается на
                  проверку навыков
                </div>
              </>
            )}
            {step === "offer" && (
              <>
                <div className="demo-window offer-demo">
                  <div className="window-top">
                    <Mail size={18} />
                    <span>Приглашение в команду</span>
                    <Badge>Новое</Badge>
                  </div>
                  <div className="offer-company">
                    <span>
                      <Building2 size={27} />
                    </span>
                    <div>
                      <strong>Команда цифровых продуктов</strong>
                      <small>Вас приглашают на знакомство</small>
                    </div>
                  </div>
                  <h3>Frontend-разработчик</h3>
                  <div className="offer-salary">
                    180 000 — 230 000 <span>₽ / месяц</span>
                  </div>
                  <div className="offer-details">
                    <span>
                      <MapPin size={17} /> Удалённо
                    </span>
                    <span>
                      <BriefcaseBusiness size={17} /> Полная занятость
                    </span>
                  </div>
                  <p>
                    Создавать интерфейсы продукта на React. Работать с
                    дизайн-системой и командой разработки.
                  </p>
                  <div className="demo-insight">
                    <ScanSearch size={19} />
                    <p>
                      Совпадают специализация, проверенные навыки и выбранный
                      формат работы.
                    </p>
                  </div>
                  <button
                    className="btn primary full"
                    onClick={() => nav("/register?role=candidate")}
                  >
                    Получать такие предложения
                  </button>
                </div>
                <div className="stage-note">
                  <LockKeyhole size={19} /> Ваши контакты откроются с вашего
                  согласия
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
export function AssessmentPreview({ nav }: { nav: Navigate }) {
  const [answer, setAnswer] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const correct = answer === "GET";
  return (
    <section className="assessment-story" id="skills">
      <div className="section-wrap assessment-inner">
        <div className="assessment-copy reveal">
          <span className="eyebrow">УРОВЕНЬ · ТЕСТ · ПРАКТИКА</span>
          <h2>
            Меньше догадок.
            <br />
            <span>Больше ясности.</span>
          </h2>
          <p>
            Резюме рассказывает об опыте. Проверка показывает, как вы решаете
            задачи. Выберите направление и уровень — увидите результат по каждой
            компетенции.
          </p>
          <div className="assessment-points">
            <span>
              <Check /> Можно начать без опыта работы
            </span>
            <span>
              <Check /> Результат и история остаются в профиле
            </span>
            <span>
              <Check /> Неудачная попытка не снижает грейд
            </span>
          </div>
          <button
            className="btn white large"
            onClick={() => nav("/register?role=candidate")}
          >
            Подтвердить навыки
          </button>
        </div>
        <div className="assessment-question reveal">
          <div className="question-top">
            <span>
              <Code2 size={19} /> Попробуйте один вопрос
            </span>
            <span className="mono">API / 01</span>
          </div>
          <span className="question-label mono">ПРИМЕР ЗАДАНИЯ</span>
          <h3>Каким HTTP-методом запрашивают данные без их изменения?</h3>
          <RadioGroup
            className="question-options"
            aria-label="HTTP-метод"
            value={answer || ""}
            onValueChange={(v) => {
              setAnswer(v);
              setChecked(false);
            }}
          >
            {["GET", "POST", "DELETE"].map((v) => (
              <label
                key={v}
                className={`question-option ${answer === v ? "selected" : ""} ${checked && v === "GET" ? "correct" : ""}`}
              >
                <RadioGroupItem value={v} aria-label={v} />
                <span className="mono">{v}</span>
                {checked && v === "GET" && <Check size={20} />}
              </label>
            ))}
          </RadioGroup>
          <div className="question-feedback" aria-live="polite">
            {checked ? (
              <p>
                <strong>
                  {correct
                    ? "Верно. Хорошее начало."
                    : "Правильный ответ — GET."}
                </strong>{" "}
                GET используется для чтения ресурса. POST обычно отправляет
                данные, DELETE — удаляет ресурс.
              </p>
            ) : (
              <p>Выберите ответ — сразу получите объяснение.</p>
            )}
          </div>
          <button
            className="btn primary full"
            disabled={!answer}
            onClick={() => setChecked(true)}
          >
            Проверить ответ
          </button>
          <small>
            Это пример задания. Для категории нужно пройти полную проверку.
          </small>
        </div>
      </div>
    </section>
  );
}
export function PrivacyPreview() {
  return (
    <section className="privacy-story section-wrap" id="privacy-preview">
      <div className="privacy-copy reveal">
        <span className="eyebrow">ВЫ УПРАВЛЯЕТЕ ЗНАКОМСТВОМ</span>
        <h2>
          Квалификация видна.
          <br />
          <span>
            Контакты —<br />
            по вашему решению.
          </span>
        </h2>
        <p>
          Сначала — подходящая команда и конкретные условия. Затем — ваше
          согласие на общение. Личные контакты не превращаются в открытую базу.
        </p>
        <div className="privacy-benefits">
          <div>
            <Eye size={23} />
            <p>
              <strong>Работодатель видит главное</strong>
              <span>Категорию, навыки, опыт и предпочтения.</span>
            </p>
          </div>
          <div>
            <Mail size={23} />
            <p>
              <strong>Вы видите предложение целиком</strong>
              <span>Задачи, компанию и зарплату до первого разговора.</span>
            </p>
          </div>
          <div>
            <LockKeyhole size={23} />
            <p>
              <strong>Знакомство начинается с согласия</strong>
              <span>
                Контакты открываются после принятия или вашего отклика.
              </span>
            </p>
          </div>
        </div>
      </div>
      <div className="privacy-product reveal">
        <div className="privacy-window-bar">
          <span>
            <img src="/brand/original.svg" alt="" /> Вид работодателя
          </span>
          <span className="mono">ПРИМЕР</span>
        </div>
        <Tabs defaultValue="hidden" className="privacy-tabs">
          <TabsList aria-label="Доступность контактов">
            <TabsTrigger value="hidden">
              <EyeOff size={17} /> До согласия
            </TabsTrigger>
            <TabsTrigger value="shared">
              <CheckCheck size={17} /> После согласия
            </TabsTrigger>
          </TabsList>
          <div className="privacy-profile">
            <DemoPerson />
            <Badge>Middle подтверждён</Badge>
            <Tags items={["React", "TypeScript", "CSS"]} />
          </div>
          <TabsContent value="hidden">
            <div className="contact-preview">
              <div>
                <Mail size={20} />
                <span
                  className="contact-mask"
                  aria-label="Электронная почта скрыта"
                >
                  ••••••@••••••
                </span>
                <LockKeyhole size={17} />
              </div>
              <div>
                <FileText size={20} />
                <span className="contact-mask" aria-label="Телефон скрыт">
                  +7 ••• ••• •• ••
                </span>
                <LockKeyhole size={17} />
              </div>
            </div>
            <div className="privacy-decision">
              <span className="decision-icon">
                <Mail size={22} />
              </span>
              <div>
                <strong>Приглашение отправлено</strong>
                <span>180 000 — 230 000 ₽ / месяц</span>
                <small>Ожидаем решения кандидата</small>
              </div>
            </div>
          </TabsContent>
          <TabsContent value="shared">
            <div className="contact-preview shared">
              <div>
                <Mail size={20} />
                <span>candidate@example.test</span>
                <Check size={17} />
              </div>
              <div>
                <FileText size={20} />
                <span>Контакт для знакомства доступен</span>
                <Check size={17} />
              </div>
            </div>
            <div className="privacy-decision accepted">
              <span className="decision-icon">
                <CheckCheck size={22} />
              </span>
              <div>
                <strong>Кандидат принял приглашение</strong>
                <span>Теперь можно обсудить задачи и команду</span>
                <small>Контакты доступны этому работодателю</small>
              </div>
            </div>
          </TabsContent>
        </Tabs>
        <div className="privacy-window-footer">
          <Fingerprint size={20} />
          <span>Навыки помогают найти. Согласие помогает познакомиться.</span>
        </div>
      </div>
    </section>
  );
}
const questions = {
  candidate: [
    [
      "Как подтвердить свой уровень?",
      "Заполните профиль, выберите специализацию и заявленный уровень в разделе «Проверка уровня». Затем пройдите тест и практические задания. В результате увидите подтверждённую категорию, итоги по компетенциям и историю попыток.",
    ],
    [
      "Как меня найдёт работодатель?",
      "После подтверждения категории и согласия на публикацию ваш профиль попадает в подбор и поиск. Работодатель описывает задачи команды и получает подходящих кандидатов. Он может прислать вам приглашение с зарплатой и условиями.",
    ],
    [
      "А если опыта работы или истории ФСП ещё нет?",
      "Начните с учебных, личных проектов и проверки навыков. Отсутствие коммерческого опыта и достижений ФСП не мешает создать профиль. Достижения ФСП — дополнительная информация о практическом опыте.",
    ],
    [
      "Что будет, если я не пройду тест?",
      "Подтверждённый грейд не снижается принудительно. Можно подготовиться и повторить проверку своего уровня или добровольно выбрать уровень ниже. При ограничении смены грейда точная дата доступности показана в результатах.",
    ],
    [
      "Кто увидит мой телефон и почту?",
      "Работодатель увидит контакты после принятия его приглашения или вашего отклика на вакансию. До этого он видит профессиональный профиль и условия, при которых вы готовы рассмотреть работу.",
    ],
  ],
  employer: [
    [
      "Как получить подборку для моей команды?",
      "Опишите задачи, специализацию, грейд и нужный стек. Система предложит категории и кандидатов, объяснит соответствие. Уточняйте запрос фильтрами; выбранная потребность и подборка сохраняются.",
    ],
    [
      "На чём основан порядок кандидатов?",
      "На соответствии потребности и подтверждённом профиле: категории, результатах проверки и достижениях ФСП, если они есть. Самоописание в резюме дополняет информацию, а не заменяет проверку. Причины соответствия показаны в карточках.",
    ],
    [
      "Нужно ли публиковать вакансию, чтобы пригласить человека?",
      "Нет. Можно выбрать специалиста в подборке или каталоге и отправить предложение напрямую. Укажите описание задач, компанию и зарплатный диапазон в рублях — кандидат увидит условия до общения.",
    ],
    [
      "Когда можно связаться с кандидатом?",
      "Когда он примет приглашение или самостоятельно откликнется. В приглашениях видны актуальные статусы; контакты открываются после согласия кандидата.",
    ],
    [
      "Можно ли сначала посмотреть работу платформы?",
      "Да. В демонстрационных кабинетах доступны синтетические профили, подборки, проверка навыков и сценарий приглашения. Результаты небольшого демонстрационного теста не являются сертификацией квалификации.",
    ],
  ],
};
export function LandingFaq({ nav }: { nav: Navigate }) {
  return (
    <section className="landing-faq section-wrap" id="questions">
      <div className="faq-intro reveal">
        <span className="eyebrow">ЕСТЬ ВОПРОСЫ?</span>
        <h2>
          Давайте
          <br />
          <span>по делу.</span>
        </h2>
        <p>Всё о проверке навыков, подборе и первом знакомстве с командой.</p>
        <button className="text-link" onClick={() => nav("/support")}>
          Задать свой вопрос
        </button>
      </div>
      <Tabs defaultValue="candidate" className="faq-audiences reveal">
        <TabsList aria-label="Вопросы о платформе">
          <TabsTrigger value="candidate">Я ищу работу</TabsTrigger>
          <TabsTrigger value="employer">Я нанимаю</TabsTrigger>
        </TabsList>
        {Object.entries(questions).map(([audience, items]) => (
          <TabsContent key={audience} value={audience}>
            <Accordion
              type="single"
              collapsible
              defaultValue="q0"
              className="faq-list"
            >
              {items.map(([q, a], i) => (
                <AccordionItem key={q} value={`q${i}`}>
                  <AccordionTrigger>{q}</AccordionTrigger>
                  <AccordionContent>{a}</AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </TabsContent>
        ))}
      </Tabs>
    </section>
  );
}
