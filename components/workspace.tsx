"use client";
import { InviteDialog } from "./invite-dialog";
import { CandidateCard } from "./candidate-card";
import { CandidateProfileDialog } from "./candidate-profile-dialog";
import { EmployerNeeds } from "./employer-needs";
import dynamic from "next/dynamic";
import { CandidateCompare, SavedSearchTools } from "./hiring-tools";
import { candidateExperience } from "@/lib/candidate-comparison";
import { recommendSpecialties } from "@/lib/assessment-tracks";
const FormalAssessment = dynamic(() =>
  import("./professional-assessment").then((m) => m.FormalAssessment),
);
import { FeedbackDialog } from "./feedback-dialog";
import { useCatalog } from "@/hooks/use-catalog";
import { WorkspaceTour } from "./workspace-tour";
import { SkillChecks } from "./skill-checks";
import { LogoMotion } from "./logo-motion";
import { ProfileAvatar } from "./profile-avatar";
import { ProfileView } from "./profile-view";
import { downloadResume } from "@/lib/profile-pdf";
import { useState, useEffect, useMemo, useRef } from "react";
import {
  Users,
  ArrowRight,
  ArrowLeft,
  Search,
  Folder,
  Send,
  Building2,
  Settings,
  Home,
  ShieldCheck,
  FileText,
  Bell,
  HelpCircle,
  LogOut,
  Menu,
  Plus,
  Check,
  Mail,
  MessageSquare,
  Phone,
  MapPin,
  BriefcaseBusiness,
  Bookmark,
  LockKeyhole,
  X,
  Upload,
  Download,
  Code2,
  ChevronDown,
  Sparkles,
  CheckCircle2,
  Clock,
  SlidersHorizontal,
  ExternalLink,
  Eye,
} from "lucide-react";
import { toast } from "sonner";
import { seedDraft, useDraft, DraftStatus } from "@/hooks/use-draft";
import { ProfileDetails } from "./profile-details";
import { CandidateOverview } from "./candidate-overview";
import { EmployerJobApplications } from "./employer-job-applications";
import { ownsJob } from "@/lib/job-applications";
import { CandidateVacancies } from "./candidate-vacancies";
import { ChoiceSelect } from "./choice-select";
import { Messages } from "./messages";
import { ChatLaunch } from "./chat-launch";
import { useChatUnread } from "@/hooks/use-chat-unread";
import { InvitationInbox } from "./invitation-inbox";
import { AccountSettings } from "./account-settings";
import { companyCompletion } from "./company-completion";
import { CompanyEditor } from "./company-editor";
import { EmployerJobs } from "./employer-jobs";
import { EmployerOverview as EmployerOverviewPage } from "./employer-overview";
import { EmployerField, EmployerSelect, CompanyMark } from "./employer-ui";
import { specialtyLabels, invitationOwned } from "@/lib/employer-profile";
import { candidateFilterError } from "@/lib/candidate-search";
import { SuggestionTags } from "./suggestion-picker";
import { cityCatalog, skillCatalog } from "@/lib/suggestion-catalogs";
import { notificationActive } from "@/lib/account-settings";
import { invitationUnread } from "@/lib/invitations";
import { profileCompletion } from "@/lib/profile-completion";
import { SuggestionText } from "./suggestion-picker";
import { companyCatalog } from "@/lib/suggestion-catalogs";
import { ResultsPage } from "./journey";
import { nextGradeDate } from "@/lib/model";
import {
  State,
  Role,
  Profile,
  Need,
  rank,
  money,
  specialties,
  grades,
} from "@/lib/model";
import { Brand, Badge, Tags, PrivacyNote } from "./brand";
import { Navigate } from "./landing";
import { Action } from "./registration";
import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarFooter,
  SidebarInset,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
const roleLinks: Record<Role, [string, string, typeof Mail][]> = {
  candidate: [
    ["overview", "Обзор", Home],
    ["assessment", "Проверка уровня", ShieldCheck],
    ["skills", "Проверка навыков", Code2],
    ["results", "Результаты", CheckCircle2],
    ["jobs", "Вакансии", BriefcaseBusiness],
    ["invitations", "Приглашения", Mail],
    ["messages", "Сообщения", MessageSquare],
    ["profile", "Мой профиль", FileText],
  ],
  employer: [
    ["overview", "Обзор", Home],
    ["candidates", "Поиск кандидатов", Search],
    ["needs", "Подборки", Folder],
    ["invitations", "Приглашения", Send],
    ["messages", "Сообщения", MessageSquare],
    ["jobs", "Вакансии", BriefcaseBusiness],
    ["company", "Моя компания", Building2],
  ],
};
const candidateDescriptions: Record<string, string> = {
  messages: "Обсуждайте задачи, условия и следующий шаг",
  overview: "Приглашения, отклики и новые возможности для вас",
  assessment: "Подтверждение уровня Junior, Middle или Senior по специализации",
  skills: "В разработке — тесты по технологиям пока недоступны",
  results: "Ваша категория, сильные стороны и история проверок",
  invitations: "Предложения компаний, условия и ваши решения",
  jobs: "Поиск работы, избранные вакансии и ваши отклики",
  profile: "Всё о вашем опыте, навыках и следующей работе",
  "profile-view": "Предпросмотр вашего профиля",
  settings: "Аккаунт, часовой пояс, приватность и уведомления",
};
const employerDescriptions: Record<string, string> = {
  messages: "Переписка с кандидатами вашей компании",
  overview: "Ваш найм, команда и текущие задачи",
  candidates: "Поиск специалистов по подтверждённым навыкам и условиям",
  needs: "Сохранённые потребности команды и подбор кандидатов",
  invitations: "Отправленные предложения и ответы кандидатов",
  jobs: "Вакансии рынка, ваши публикации и входящие отклики",
  company: "Команда, продукты и условия работы в вашей компании",
  settings: "Аккаунт, часовой пояс и уведомления",
};
function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
function Choice({
  value,
  onChange,
  options,
  placeholder = "Выберите",
  labels,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
  labels?: Record<string, string>;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="choice">
        <SelectValue placeholder={placeholder}>{labels?.[value]}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((v) => (
          <SelectItem key={v} value={v}>
            {labels?.[v] || v}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
function Empty({
  icon: Icon = Mail,
  title,
  desc,
  action,
}: {
  icon?: typeof Mail;
  title: string;
  desc: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <span>
        <Icon size={31} />
      </span>
      <h3>{title}</h3>
      <p>{desc}</p>
      {action}
    </div>
  );
}
function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action}
    </div>
  );
}
export function Workspace({
  state: s,
  role,
  section,
  nav,
  act,
  roleSwitching = false,
  onStateChange,
  tutorialEnabled = true,
  intro = false,
  jobId,
  invitationId,
  view,
}: {
  state: State;
  role: Role;
  section: string;
  nav: Navigate;
  act: Action;
  roleSwitching?: boolean;
  onStateChange: (state: State) => void;
  tutorialEnabled?: boolean;
  intro?: boolean;
  jobId?: string;
  invitationId?: string;
  view?: string;
}) {
  const unreadMessages = useChatUnread(role, s.auth?.userId);
  const [help, setHelp] = useState(false);
  const [tourReplay, setTourReplay] = useState(0);
  const [profileActionsHost, setProfileActionsHost] =
    useState<HTMLDivElement | null>(null);
  const path = (v: string) => `/demo/${role}/${v}`;
  const title =
    roleLinks[role].find((x) => x[0] === section)?.[1] ||
    (section === "profile-view" ? "Мой профиль" : "Настройки");
  return (
    <SidebarProvider
      className={`workspace-candidate-shell ${role === "employer" ? "workspace-employer-shell" : ""}`}
      style={{ "--sidebar-width": "244px" } as React.CSSProperties}
    >
      <MobileNavigationClose route={`${role}/${section}`} />
      <Sidebar className="app-sidebar">
        <SidebarHeader>
          <button className="sidebar-brand" onClick={() => nav("/")}>
            <Brand variant="original" />
          </button>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>РАБОЧЕЕ ПРОСТРАНСТВО</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {roleLinks[role].map(([id, label, Icon]) => (
                  <SidebarMenuItem key={id}>
                    <SidebarMenuButton
                      data-tour-tab={id}
                      className="app-menu-button"
                      isActive={
                        id === section ||
                        (id === "profile" && section === "profile-view")
                      }
                      onClick={() => nav(path(id))}
                    >
                      <Icon />
                      <span>{label}</span>
                      {((role === "candidate" && id === "profile") ||
                        (role === "employer" && id === "company")) && (
                        <b className="menu-count">
                          {role === "candidate"
                            ? profileCompletion(s.profile).percent
                            : companyCompletion(s.company).percent}
                          %
                        </b>
                      )}
                      {id === "messages" && unreadMessages > 0 && (
                        <b className="menu-count">
                          {unreadMessages > 99 ? "99+" : unreadMessages}
                        </b>
                      )}
                      {id === "invitations" &&
                        role === "candidate" &&
                        notificationActive(s, "invitations") &&
                        s.invitations.filter(invitationUnread).length > 0 && (
                          <b className="menu-count">
                            {s.invitations.filter(invitationUnread).length}
                          </b>
                        )}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          {((role === "candidate" && section === "profile") ||
            (role === "employer" && section === "company")) && (
            <div className="sidebar-profile-progress">
              <div>
                <span>Заполнение профиля</span>
                <strong>
                  {role === "candidate"
                    ? profileCompletion(s.profile).percent
                    : companyCompletion(s.company).percent}
                  %
                </strong>
              </div>
              <Progress
                value={
                  role === "candidate"
                    ? profileCompletion(s.profile).percent
                    : companyCompletion(s.company).percent
                }
                aria-label="Заполнение сохранённого профиля"
              />
            </div>
          )}
          <div className="sidebar-callout">
            <img src="/brand/purple-white.svg" alt="" />
            <strong>
              {role === "candidate"
                ? "Ваши навыки говорят."
                : "Люди, которые подходят."}
            </strong>
            <p>
              {role === "candidate"
                ? profileCompletion(s.profile).ready
                  ? "Проверьте квалификацию и станьте заметнее."
                  : "Дополните профиль, чтобы получать более точные предложения."
                : "Подтверждённый профиль. Понятные основания."}
            </p>
            <button
              onClick={() =>
                nav(
                  path(
                    role === "candidate"
                      ? profileCompletion(s.profile).ready
                        ? "assessment"
                        : "profile"
                      : "candidates",
                  ),
                )
              }
            >
              {role === "candidate"
                ? profileCompletion(s.profile).ready
                  ? "Подтвердить уровень"
                  : "Дополнить профиль"
                : "Начать подбор"}
              <ArrowRight size={16} />
            </button>
          </div>
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                className="app-menu-button"
                data-tour-tab="settings"
                isActive={section === "settings"}
                onClick={() => nav(path("settings"))}
              >
                <Settings />
                <span>Настройки</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                className="app-menu-button"
                onClick={() => setHelp(true)}
              >
                <HelpCircle />
                <span>Помощь</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                className="app-menu-button"
                onClick={() => nav("/")}
              >
                <LogOut />
                <span>На главную</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
          <span className="sidebar-footnote">Офферли · Дело найдёт.</span>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset
        className={`workspace-inset ${section === "messages" ? "workspace-messages-inset" : ""} ${(role === "candidate" && section === "profile") || (role === "employer" && section === "company") ? "workspace-profile-inset" : ""}`}
      >
        <header className="workspace-header">
          <div className="workspace-breadcrumb">
            <SidebarTrigger aria-label="Открыть навигацию" />
            <div className="profile-header-title">
              <h1>{title as string}</h1>
              <p>
                {role === "employer"
                  ? employerDescriptions[section]
                  : candidateDescriptions[section]}
              </p>
            </div>
          </div>
          {((role === "candidate" && section === "profile") ||
            (role === "employer" && section === "company")) && (
            <div
              className="profile-header-actions"
              ref={setProfileActionsHost}
            />
          )}
          <div className="workspace-user">
            <button
              className="role-preview-toggle"
              disabled={roleSwitching}
              onClick={() =>
                nav(
                  `/demo/${role === "candidate" ? "employer" : "candidate"}/overview`,
                )
              }
            >
              {role === "candidate" ? "Вид работодателя" : "Вид кандидата"}
              <ArrowRight size={14} />
            </button>
            <button
              className="user-avatar"
              aria-label={
                role === "candidate"
                  ? "Посмотреть мой профиль"
                  : "Профиль компании"
              }
              onClick={() =>
                nav(path(role === "candidate" ? "profile-view" : "company"))
              }
            >
              {role === "candidate" ? (
                <ProfileAvatar profile={s.profile} />
              ) : (
                <CompanyMark company={s.company} />
              )}
            </button>
          </div>
        </header>

        <main
          className={`workspace-main ${section === "messages" ? "workspace-messages-main" : ""} ${(role === "candidate" && section === "profile") || (role === "employer" && section === "company") ? "workspace-profile-main" : ""} ${section === "jobs" || (role === "employer" && section === "candidates") ? "workspace-vacancies-main" : ""}`}
          key={`${role}-${section}`}
        >
          {role === "candidate" && section === "skills" && (
            <SkillChecks nav={nav} />
          )}
          {section === "results" && <ResultsPage s={s} nav={nav} />}
          {section === "overview" &&
            (role === "candidate" ? (
              <CandidateOverview s={s} nav={nav} act={act} />
            ) : (
              <EmployerOverviewPage s={s} nav={nav} />
            ))}
          {section === "candidates" && <Candidates s={s} act={act} nav={nav} />}
          {section === "profile" && (
            <ProfileEditor
              s={s}
              act={act}
              nav={nav}
              onStateChange={onStateChange}
              actionsHost={profileActionsHost}
            />
          )}
          {role === "candidate" && section === "profile-view" && (
            <ProfileView s={s} nav={nav} />
          )}
          {section === "assessment" && <Assessment s={s} act={act} nav={nav} />}
          {section === "invitations" && (
            <InvitationInbox s={s} role={role} act={act} nav={nav} onStateChange={onStateChange} requestedInvitationId={invitationId} />
          )}
          {section === "messages" && <Messages s={{ ...s, role }} nav={nav} />}
          {section === "needs" && <EmployerNeeds s={s} act={act} nav={nav} />}
          {section === "company" && (
            <CompanyEditor
              s={s}
              act={act}
              onStateChange={onStateChange}
              actionsHost={profileActionsHost}
            />
          )}
          {section === "jobs" &&
            (role === "candidate" ? (
              <CandidateVacancies
                s={s}
                act={act}
                nav={nav}
                jobId={jobId}
                view={view}
              />
            ) : (
              <EmployerJobs
                s={s}
                act={act}
                onStateChange={onStateChange}
                nav={nav}
                jobId={jobId}
              />
            ))}
          {section === "settings" && (
            <AccountSettings key={role} s={s} role={role} act={act} />
          )}
        </main>
      </SidebarInset>
      {tutorialEnabled && !(role === "candidate" && section === "assessment") && (
        <WorkspaceTour
          key={`${s.auth?.userId}:${role}`}
          role={role}
          section={section}
          intro={intro}
          replay={tourReplay}
          nav={nav}
        />
      )}
      <Dialog open={help} onOpenChange={setHelp}>
        <DialogContent className="app-dialog workspace-help-dialog">
          <DialogHeader>
            <DialogTitle>Всё по делу.</DialogTitle>
            <DialogDescription>
              Как пройти основной сценарий Офферли
            </DialogDescription>
          </DialogHeader>
          <ol className="help-steps">
            <li>
              <span>Профиль и навыки</span>Кандидат заполняет профиль и
              подтверждает уровень.
            </li>
            <li>
              <span>Подходящая команда</span>Работодатель публикует вакансию и
              подбирает кандидатов.
            </li>
            <li>
              <span>Приглашение или отклик</span>Приглашение с зарплатой или
              самостоятельный отклик.
            </li>
            <li>
              <span>Знакомство в сообщениях</span>После принятия приглашения или
              отклика открываются контакты и чат.
            </li>
          </ol>
          <div className="workspace-help-actions">
            <button
              className="workspace-help-action"
              onClick={() => {
                setHelp(false);
                setTourReplay((v) => v + 1);
              }}
            >
              <span>Подсказка об этом разделе</span>
              <Sparkles size={20} />
            </button>
            <button
              className="workspace-help-action"
              onClick={async () => {
                await seedDraft("settings:tour_preferences_v1", {
                  disabled: false,
                });
                await seedDraft(`settings:tour_${role}_v1`, {});
                setHelp(false);
                nav(`/welcome?role=${role}&replay=1`);
              }}
            >
              <span>Повторить знакомство с Офферли</span>
              <ArrowRight size={20} />
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </SidebarProvider>
  );
}
function MobileNavigationClose({ route }: { route: string }) {
  const { setOpenMobile } = useSidebar();
  useEffect(() => {
    setOpenMobile(false);
  }, [route, setOpenMobile]);
  return null;
}

function statusLabel(s: string) {
  return (
    (
      {
        sent: "Отправлено",
        viewed: "Просмотрено",
        accepted: "Принято",
        declined: "Отклонено",
      } as Record<string, string>
    )[s] || s
  );
}
function Candidates({ s, act, nav }: { s: State; act: Action; nav: Navigate }) {
  const queryNeed =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("need")
      : null;
  const initialNeed = queryNeed
    ? s.needs.find((n) => n.id === queryNeed)
    : undefined;
  const [f, setF, filterMeta] = useDraft("catalog", {
    needId: initialNeed?.id || "",
    spec: initialNeed?.specialty || "Все",
    grade: initialNeed?.grade || "Все",
    query: "",
    stack: "",
    skillSource: "declared" as "declared" | "verified",
    skills: initialNeed?.skills || ([] as string[]),
    location: "",
    formats:
      initialNeed && initialNeed.format !== "Любой"
        ? [initialNeed.format]
        : ([] as string[]),
    salaryMin: initialNeed ? String(initialNeed.min) : "",
    salaryMax: initialNeed ? String(initialNeed.max) : "",
    experienceMin: "",
    experienceMax: "",
    fsp: false,
    savedOnly: false,
    sort: "По соответствию",
  });
  const { needId, spec, grade, query, stack, fsp, savedOnly, sort } = f;
  const setNeedId = (v: string) => setF((x) => ({ ...x, needId: v })),
    setSpec = (v: string) => setF((x) => ({ ...x, spec: v })),
    setGrade = (v: string) => setF((x) => ({ ...x, grade: v })),
    setQuery = (v: string) => setF((x) => ({ ...x, query: v })),
    setStack = (v: string) => setF((x) => ({ ...x, stack: v })),
    setFsp = (v: boolean) => setF((x) => ({ ...x, fsp: v })),
    setSavedOnly = (v: boolean) => setF((x) => ({ ...x, savedOnly: v })),
    setSort = (v: string) => setF((x) => ({ ...x, sort: v }));
  const [compareIds, setCompareIds] = useState<number[]>([]);
  const [filterOpen, setFilterOpen] = useState(false);
  const [view, setView] = useState<Profile | null>(null),
    [invite, setInvite] = useState<Profile | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const n = needId ? s.needs.find((n) => n.id === needId) : undefined;
  const queryApplied = useRef(false);
  useEffect(() => {
    if (!queryApplied.current && filterMeta.status !== "loading") {
      queryApplied.current = true;
      const params = new URLSearchParams(window.location.search);
      const linkedCandidate = params.get("candidate");
      if (linkedCandidate && /^\d{1,10}$/.test(linkedCandidate)) {
        setF((x) => ({ ...x, needId: "", spec: "Все", grade: "Все", query: linkedCandidate,
          stack: "", skills: [], skillSource: "declared", location: "", formats: [],
          salaryMin: "", salaryMax: "", experienceMin: "", experienceMax: "",
          fsp: false, savedOnly: false, sort: "По соответствию" }));
      } else if (queryNeed) {
        const n = s.needs.find((n) => n.id === queryNeed);
        if (n) setF((x) => ({ ...x, needId: n.id, spec: n.specialty, grade: n.grade,
          query: "", skills: n.skills || [], stack: "", salaryMin: String(n.min), salaryMax: String(n.max),
          formats: n.format !== "Любой" ? [n.format] : [] }));
      }
    }
  }, [filterMeta.status, queryNeed]);
  const activeNeed = n || {
    id: "",
    title: "Все кандидаты",
    specialty: spec,
    grade,
    skills: f.skills?.length
      ? f.skills
      : f.stack
          ?.split(",")
          .map((v) => v.trim())
          .filter(Boolean) || [],
    description: "",
    min: 180000,
    max: 230000,
    format: "Удалённо",
  };
  const catalogStart = useRef<HTMLDivElement>(null);
  const [catalogPage, setCatalogPage] = useState(1);
  const filterSignature = JSON.stringify(f);
  const [previousFilters, setPreviousFilters] = useState(filterSignature);
  if (previousFilters !== filterSignature) { setPreviousFilters(filterSignature); setCatalogPage(1); }
  const catalog = useCatalog<Profile>(
    "candidates",
    f,
    "employer",
    catalogPage,
    "market",
    s,
  );
  const [openedLinkedCandidate, setOpenedLinkedCandidate] = useState(false);
  const linkedParams = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
  const linkedId = linkedParams.get("candidate");
  if (!openedLinkedCandidate && linkedParams.get("view") !== "card" && linkedId && f.query === linkedId && catalog.isCurrentData) {
    const profile = catalog.data?.items.find(item => item.id === Number(linkedId));
    if (profile) { setOpenedLinkedCandidate(true); setView(profile); setProfileOpen(true); }
  }
  const rows = catalog.data?.items || [];
  const total = catalog.data?.total || 0;
  const filterError = candidateFilterError(f);
  const reset = () =>
    setF({
      needId: "",
      spec: "Все",
      grade: "Все",
      query: "",
      stack: "",
      skillSource: "declared",
      skills: [],
      location: "",
      formats: [],
      salaryMin: "",
      salaryMax: "",
      experienceMin: "",
      experienceMax: "",
      fsp: false,
      savedOnly: false,
      sort: "По соответствию",
    });
  return (
    <>
      <FeedbackDialog
        open={!!catalog.error}
        onOpenChange={(open) => {
          if (!open) catalog.dismissError();
        }}
        message={catalog.error}
      />
      <div className="vacancies-page candidate-catalog-page">
        <div className="vacancy-layout">
          <div className="vacancy-results" ref={catalogStart}>
            <section
              className="vacancy-search-panel"
              aria-label="Поиск кандидатов"
            >
              <div className="vacancy-search-row">
                <label className="vacancy-search-input">
                  <Search size={19} />
                  <input
                    aria-label="Поиск кандидатов"
                    placeholder="Специализация, навык, город или ID"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  {query && (
                    <button
                      aria-label="Очистить поиск"
                      onClick={() => setQuery("")}
                    >
                      <X size={16} />
                    </button>
                  )}
                </label>
                <ChoiceSelect
                  label="Сортировка кандидатов"
                  value={sort}
                  onChange={setSort}
                  options={["По соответствию", "По результату теста", "По достижениям ФСП", "По дате подтверждения", "По зарплате"].map(
                    (value) => ({ value, label: value }),
                  )}
                />
              </div>
              <div className="vacancy-search-bottom">
                <p role="status">
                  Кандидатов в поиске: <strong>{total}</strong>
                </p>
                <button className={`btn subtle ${savedOnly ? "saved" : ""}`} aria-pressed={savedOnly} onClick={() => setSavedOnly(!savedOnly)}>
                  <Bookmark size={17} fill={savedOnly ? "currentColor" : "none"} />
                  Избранное
                </button>
                <button
                  className="vacancy-mobile-toggle"
                  aria-expanded={filterOpen}
                  aria-controls="employer-candidate-filters"
                  onClick={() => setFilterOpen(!filterOpen)}
                >
                  <SlidersHorizontal size={17} />
                  {filterOpen ? "Скрыть фильтры" : "Фильтры"}
                </button>
              </div>
              <DraftStatus meta={filterMeta} />
              <SavedSearchTools
                role="employer"
                filters={f}
                onApply={(v) => setF({ ...f, ...v })}
              />
            </section>
            <CandidateCompare
              ids={compareIds}
              onClear={() => setCompareIds([])}
            />
            <div
              className={`candidate-list ${catalog.loading ? "catalog-pending" : ""}`}
              aria-busy={catalog.loading}
            >
              <p className="catalog-status" role="status">
                {catalog.loading ? "Загружаем кандидатов…" : ""}
              </p>
              {rows.map((p) => (
                <div className="hiring-candidate-wrap" key={p.id}>
                  <CandidateCard
                    key={p.id}
                    p={p}
                    n={activeNeed}
                    comparing={compareIds.includes(p.id)}
                    onCompare={() => setCompareIds(ids => ids.includes(p.id) ? ids.filter(id=>id!==p.id) : [...ids,p.id])}
                    s={s}
                    act={act}
                    nav={nav}
                    onView={() => { setView(p); setProfileOpen(true); }}
                    onInvite={() => setInvite(p)}
                  />
                </div>
              ))}
              {!catalog.loading && !catalog.error && !rows.length && (
                <Empty
                  icon={Search}
                  title="Уточним поиск?"
                  desc="Попробуйте убрать часть фильтров. Подборка останется сохранённой."
                  action={
                    <button className="btn outline" onClick={reset}>
                      Сбросить фильтры
                    </button>
                  }
                />
              )}
            </div>
            {total > 20 && (
              <nav
                className="vacancy-pagination"
                aria-label="Страницы кандидатов"
              >
                <button
                  disabled={catalog.loading || catalogPage === 1}
                  onClick={() => {
                    setCatalogPage((catalog.data?.page || catalogPage) - 1);
                    catalogStart.current?.scrollIntoView({
                      behavior: "smooth",
                      block: "start",
                    });
                  }}
                >
                  Назад
                </button>
                <span>
                  Страница {catalog.data?.page || catalogPage} из{" "}
                  {Math.ceil(total / 20)}
                </span>
                <button
                  disabled={
                    catalog.loading || catalogPage >= Math.ceil(total / 20)
                  }
                  onClick={() => {
                    setCatalogPage((catalog.data?.page || catalogPage) + 1);
                    catalogStart.current?.scrollIntoView({
                      behavior: "smooth",
                      block: "start",
                    });
                  }}
                >
                  Далее
                </button>
              </nav>
            )}
          </div>
          <aside
            id="employer-candidate-filters"
            className={`vacancy-filter-panel employer-candidate-filters ${filterOpen ? "is-open" : ""}`}
          >
            <div className="panel-heading">
              <h2>Фильтры поиска</h2>
              <button className="employer-link" onClick={reset}>
                Сбросить
              </button>
            </div>
            <EmployerField label="Подборка для поиска">
              <EmployerSelect
                label="Подборка для поиска"
                value={needId}
                onChange={(v) => {
                  const need = s.needs.find((n) => n.id === v);
                  setF((current) => ({
                    ...current,
                    needId: v,
                    spec: need?.specialty || "Все",
                    grade: need?.grade || "Все",
                    skills: need?.skills || [],
                    stack: "",
                    salaryMin: need ? String(need.min) : "",
                    salaryMax: need ? String(need.max) : "",
                    formats:
                      need && need.format !== "Любой" ? [need.format] : [],
                  }));
                }}
                options={[
                  { value: "", label: "Все кандидаты" },
                  ...s.needs.map((n) => ({ value: n.id, label: n.title })),
                ]}
              />
            </EmployerField>
            <EmployerField label="Специализация">
              <EmployerSelect
                label="Специализация кандидата"
                value={spec}
                options={[
                  { value: "Все", label: "Любая" },
                  ...specialties.map((value) => ({
                    value,
                    label: specialtyLabels[value] || value,
                  })),
                ]}
                onChange={setSpec}
              />
            </EmployerField>
            <EmployerField label="Подтверждённый грейд">
              <EmployerSelect
                label="Подтверждённый грейд"
                value={grade}
                options={[{ value: "Все", label: "Любой" }, ...grades]}
                onChange={setGrade}
              />
            </EmployerField>
            <EmployerField
              label="Профессиональные навыки"
              hint="Все выбранные технологии; источник указывается отдельно"
            >
              <SuggestionTags
                id="candidate-verified-skills"
                value={
                  f.skills?.length
                    ? f.skills
                    : f.stack
                        ?.split(",")
                        .map((v) => v.trim())
                        .filter(Boolean) || []
                }
                catalog={skillCatalog}
                onChange={(skills) =>
                  setF((current) => ({ ...current, skills, stack: "" }))
                }
                maxSelected={20}
                allowCustom={true}
                placeholder="Python, SQL…"
              />
            </EmployerField>
            <EmployerField label="Источник навыков">
              <EmployerSelect
                label="Источник навыков"
                value={f.skillSource || "declared"}
                onChange={(v) =>
                  setF((x) => ({
                    ...x,
                    skillSource: v as "declared" | "verified",
                  }))
                }
                options={[
                  { value: "declared", label: "Указаны в профиле" },
                  { value: "verified", label: "Отдельно подтверждены" },
                ]}
              />
            </EmployerField>
            <EmployerField label="Локация">
              <SuggestionText
                id="candidate-location"
                value={f.location || ""}
                catalog={cityCatalog}
                placeholder="Город или регион"
                onChange={(location) =>
                  setF((current) => ({ ...current, location }))
                }
              />
            </EmployerField>
            <fieldset className="employer-filter-formats">
              <legend>Формат работы</legend>
              {["Удалённо", "Гибрид", "Офис"].map((value) => (
                <label key={value}>
                  <Checkbox
                    checked={f.formats?.includes(value) || false}
                    onCheckedChange={(checked) =>
                      setF((current) => ({
                        ...current,
                        formats: checked
                          ? [...(current.formats || []), value]
                          : (current.formats || []).filter((v) => v !== value),
                      }))
                    }
                  />
                  {value}
                </label>
              ))}
            </fieldset>
            <fieldset className="employer-filter-range">
              <legend>Ожидания, ₽ в месяц</legend>
              <div>
                <label>
                  От
                  <input
                    type="number"
                    min={0}
                    max={10000000}
                    aria-label="Зарплатные ожидания от"
                    value={f.salaryMin || ""}
                    onChange={(e) =>
                      setF((current) => ({
                        ...current,
                        salaryMin: e.target.value,
                      }))
                    }
                    placeholder="180 000"
                  />
                </label>
                <label>
                  До
                  <input
                    type="number"
                    min={0}
                    max={10000000}
                    aria-label="Зарплатные ожидания до"
                    value={f.salaryMax || ""}
                    onChange={(e) =>
                      setF((current) => ({
                        ...current,
                        salaryMax: e.target.value,
                      }))
                    }
                    placeholder="300 000"
                  />
                </label>
              </div>
              <small>Подойдёт пересекающийся диапазон ожиданий.</small>
            </fieldset>
            <fieldset className="employer-filter-range">
              <legend>Коммерческий опыт, лет</legend>
              <div>
                <label>
                  От
                  <input
                    type="number"
                    min={0}
                    max={50}
                    aria-label="Опыт кандидата от"
                    value={f.experienceMin || ""}
                    onChange={(e) =>
                      setF((current) => ({
                        ...current,
                        experienceMin: e.target.value,
                      }))
                    }
                    placeholder="0"
                  />
                </label>
                <label>
                  До
                  <input
                    type="number"
                    min={0}
                    max={50}
                    aria-label="Опыт кандидата до"
                    value={f.experienceMax || ""}
                    onChange={(e) =>
                      setF((current) => ({
                        ...current,
                        experienceMax: e.target.value,
                      }))
                    }
                    placeholder="Любой"
                  />
                </label>
              </div>
            </fieldset>
            {filterError && (
              <p className="inline-error" role="alert">
                {filterError} Числовые фильтры не применены.
              </p>
            )}
            <label className="filter-check">
              <Checkbox
                checked={fsp}
                onCheckedChange={(v) => setFsp(v === true)}
              />
              История ФСП
            </label>
            <label className="filter-check">
              <Checkbox
                checked={savedOnly}
                onCheckedChange={(v) => setSavedOnly(v === true)}
              />
              Только сохранённые
            </label>

          </aside>
        </div>
      </div>
      <CandidateProfileDialog view={view} open={profileOpen} onOpenChange={setProfileOpen}
        activeNeed={activeNeed} onInvite={(profile) => { setInvite(profile); setProfileOpen(false); }} />
      <InviteDialog
        p={invite}
        n={activeNeed}
        company={s.company}
        act={act}
        close={() => setInvite(null)}
      />
    </>
  );
}
async function downloadProfile(p: Profile) {
  try {
    await downloadResume(p);
    toast.success("Резюме скачано");
  } catch {
    toast.error("Не удалось создать PDF. Попробуйте ещё раз.");
  }
}
function ProfileEditor({
  s,
  act,
  nav,
  onStateChange,
  actionsHost,
}: {
  s: State;
  act: Action;
  nav: Navigate;
  onStateChange: (state: State) => void;
  actionsHost: HTMLDivElement | null;
}) {
  return (
    <ProfileDetails
      s={s}
      act={act}
      nav={nav}
      download={downloadProfile}
      onStateChange={onStateChange}
      actionsHost={actionsHost}
    />
  );
}
export function Assessment({
  s,
  act,
  nav,
  onboarding = false,
}: {
  s: State;
  act: Action;
  nav: Navigate;
  onboarding?: boolean;
}) {
  return <FormalAssessment s={s} act={act} nav={nav} />;
}
function NeedForm({
  act,
  type,
  close,
}: {
  act: Action;
  type: "need" | "job";
  close: () => void;
}) {
  const [d, setD, formMeta] = useDraft(type, {
    spec: "Backend",
    grade: "Middle",
    format: "Удалённо",
    title: "",
    description: "",
    skills: "",
    min: 180000,
    max: 230000,
  });
  const { spec, grade, format } = d;
  const setSpec = (v: string) => setD((x) => ({ ...x, spec: v })),
    setGrade = (v: string) => setD((x) => ({ ...x, grade: v })),
    setFormat = (v: string) => setD((x) => ({ ...x, format: v }));
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="form-stack"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const data = Object.fromEntries(new FormData(e.currentTarget));
        if (await act(type, { ...data, specialty: spec, grade, format })) {
          toast.success(
            type === "need" ? "Подборка создана" : "Вакансия опубликована",
          );
          formMeta.reset({ ...d, title: "", description: "", skills: "" });
          close();
        }
        setBusy(false);
      }}
    >
      <DraftStatus meta={formMeta} />
      <EmployerField
        label={type === "need" ? "Название подборки" : "Название вакансии"}
      >
        <input
          name="title"
          value={d.title}
          onChange={(e) => setD((x) => ({ ...x, title: e.target.value }))}
          required
          placeholder="Backend-разработчик в продуктовую команду"
        />
      </EmployerField>
      <EmployerField label="Что нужно команде">
        <textarea
          name="description"
          value={d.description}
          onChange={(e) => setD((x) => ({ ...x, description: e.target.value }))}
          required
          rows={4}
          placeholder="Задачи, команда и профессиональные требования…"
        />
      </EmployerField>
      {recommendSpecialties(d.description, d.skills.split(",")).length > 0 && (
        <div className="hiring-subpanel">
          <p>По описанию могут подойти направления. Выберите сами:</p>
          <div className="hiring-actions">
            {recommendSpecialties(d.description, d.skills.split(",")).map(
              (t) => (
                <button
                  type="button"
                  className="btn outline"
                  key={t.id}
                  onClick={() => setSpec(t.name)}
                >
                  {t.name}
                </button>
              ),
            )}
          </div>
        </div>
      )}
      <div className="form-two">
        <EmployerField label="Специализация">
          <EmployerSelect
            label="Специализация подборки"
            value={spec}
            onChange={setSpec}
            options={specialties.map((value) => ({
              value,
              label: specialtyLabels[value] || value,
            }))}
          />
        </EmployerField>
        <EmployerField label="Подтверждённый грейд">
          <EmployerSelect
            label="Подтверждённый грейд подборки"
            value={grade}
            onChange={setGrade}
            options={grades}
          />
        </EmployerField>
      </div>
      <EmployerField label="Нужные технологии">
        <input
          name="skills"
          value={d.skills}
          onChange={(e) => setD((x) => ({ ...x, skills: e.target.value }))}
          required
          placeholder="Python, SQL"
        />
      </EmployerField>
      <div className="form-two">
        <EmployerField label="Зарплата от, ₽/мес">
          <input
            name="min"
            type="number"
            min={1}
            required
            value={d.min}
            onChange={(e) =>
              setD((x) => ({ ...x, min: Number(e.target.value) }))
            }
          />
        </EmployerField>
        <EmployerField label="До, ₽/мес">
          <input
            name="max"
            type="number"
            min={1}
            required
            value={d.max}
            onChange={(e) =>
              setD((x) => ({ ...x, max: Number(e.target.value) }))
            }
          />
        </EmployerField>
      </div>
      <EmployerField label="Формат работы">
        <EmployerSelect
          label="Формат работы подборки"
          value={format}
          onChange={setFormat}
          options={["Удалённо", "Гибрид", "Офис"]}
        />
      </EmployerField>
      <button className="employer-button primary full" disabled={busy}>
        {busy ? (
          <LogoMotion size={20} />
        ) : type === "need" ? (
          "Сохранить подборку"
        ) : (
          "Опубликовать вакансию"
        )}
      </button>
    </form>
  );
}
function Needs({ s, act, nav }: { s: State; act: Action; nav: Navigate }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="employer-toolbar">
        <p className="employer-section-note">
          Сохранённые задачи помогают возвращаться к поиску с выбранными
          условиями. Подборку видит только ваша команда; чтобы кандидаты могли
          откликаться, опубликуйте вакансию.
        </p>
        <button
          className="employer-button primary"
          onClick={() => setOpen(true)}
        >
          <Plus size={17} />
          Новая подборка
        </button>
      </div>
      {!s.needs.length && (
        <div className="employer-panel employer-empty">
          <Folder size={32} />
          <h2>Сохраните первую подборку</h2>
          <p>
            Укажите роль, подтверждённые навыки и зарплату. К поиску с этими
            условиями можно будет вернуться в один клик.
          </p>
          <button className="employer-button" onClick={() => setOpen(true)}>
            <Plus size={17} />
            Создать подборку
          </button>
        </div>
      )}
      <div className="needs-grid">
        {s.needs.map((n) => (
          <article className="panel need-card" key={n.id}>
            <span className="need-icon">
              <Folder />
            </span>
            <h2>{n.title}</h2>
            <p>{n.description}</p>
            <Badge>
              {n.specialty} · {n.grade}
            </Badge>
            <Tags items={n.skills} />
            <strong>
              {money(n.min)} — {money(n.max)} ₽/мес
            </strong>
            <button
              className="btn primary full"
              onClick={() => nav(`/demo/employer/candidates?need=${n.id}`)}
            >
              Посмотреть кандидатов
              <ArrowRight size={17} />
            </button>
          </article>
        ))}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="app-dialog employer-need-dialog">
          <DialogHeader>
            <DialogTitle>Новая подборка</DialogTitle>
            <DialogDescription>
              Опишите потребность — найдём людей по проверенной категории и
              навыкам.
            </DialogDescription>
          </DialogHeader>
          <NeedForm act={act} type="need" close={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}
