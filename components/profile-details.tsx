"use client";
import { FspConnect } from "./fsp-connect";
import { ChoiceSelect } from "./choice-select";
import { phoneError } from "@/lib/phone";
import { withPersonalName, editPersonalName } from "@/lib/personal-name";
import { withWorkPreferences, editWorkPreference } from "@/lib/profile-options";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Download,
  Upload,
  Check,
  ArrowRight,
  FileText,
  UserRound,
  Code2,
  BriefcaseBusiness,
  MapPin,
  Award,
} from "lucide-react";
import { State, Profile } from "@/lib/model";
import { Action } from "./registration";
import { Navigate } from "./landing";
import { useDraft, DraftStatus } from "@/hooks/use-draft";
import { Badge } from "./brand";
import { Checkbox } from "./ui/checkbox";
import { salaryRangeError } from "@/lib/salary-range";
import { profileCompletion } from "@/lib/profile-completion";
import { ResumePreview } from "./resume-preview";
import { ProfileSummary } from "./profile-summary";
import { ProfileInlineFields } from "./profile-inline-fields";
import { ProfileAvatarEditor } from "./profile-avatar";
import { ProfileCompletion } from "./profile-completion";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./ui/dialog";

import {
  resumeFieldLabels as labels,
  resumeFieldText,
  photoPreview,
  importResumePhoto,
  type ResumeImportResponse,
} from "@/lib/resume-import";
import { ResumePhotoReview } from "./resume-photo-review";
export function ProfileDetails({
  s,
  act,
  nav,
  download,
  onStateChange,
  actionsHost,
}: {
  s: State;
  act: Action;
  nav: Navigate;
  download: (p: Profile) => void;
  onStateChange: (state: State) => void;
  actionsHost: HTMLDivElement | null;
}) {
  const [draft, set, meta] = useDraft("profile", s.profile);
  const p = withWorkPreferences(
    withPersonalName({
      ...s.profile,
      ...draft,
      avatarKey: s.profile.avatarKey,
      grade: s.profile.grade,
      verified: s.profile.verified,
      score: s.profile.score,
    }),
  );
  const [tabState, setTabState] = useDraft("profile:ui", { tab: "personal" });
  const profileTab = [
    "personal",
    "skills",
    "expectations",
    "experience",
    "resume",
  ].includes(tabState.tab)
    ? tabState.tab
    : "personal";
  const [editingCard, setEditingCard] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (!editingCard) return;
    const frame = requestAnimationFrame(() => {
      const card = Array.from(
        formRef.current?.querySelectorAll<HTMLElement>("[data-profile-card]") ||
          [],
      ).find((el) => el.dataset.profileCard === editingCard);
      if (!card) return;
      const form = formRef.current!;
      if (getComputedStyle(form).overflowY === "auto")
        form.scrollTo({
          top:
            form.scrollTop +
            card.getBoundingClientRect().top -
            form.getBoundingClientRect().top -
            20,
          behavior: "smooth",
        });
      else card.scrollIntoView({ block: "start", behavior: "smooth" });
    });
    return () => cancelAnimationFrame(frame);
  }, [editingCard, profileTab]);
  const setProfileTab = (tab: string) => {
    setTabState({ tab });
    setEditingCard(null);
    formRef.current?.scrollTo({ top: 0 });
    window.scrollTo({ top: 0, behavior: "instant" });
  };
  const [localError, setLocalError] = useState("");
  const [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(false),
    [uploading, setUploading] = useState(false),
    [filename, setFilename] = useState(""),
    [parsed, setParsed] = useState<Partial<Profile> | null>(null),
    [review, setReview] = useState(false),
    [selected, setSelected] = useState<string[]>([]),
    [fsp, setFsp] = useState(s.profile.fsp || "");
  const [photos, setPhotos] = useState<string[]>([]);
  const [selectedPhoto, setSelectedPhoto] = useState<number | null>(null);
  useEffect(() => {
    if (!s.profile.resumeKey) return;
    let active = true;
    fetch("/api/resume?info=1")
      .then((r) => (r.ok ? (r.json() as Promise<{ filename: string }>) : null))
      .then((info) => {
        if (active && info?.filename) setFilename(info.filename);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [s.profile.resumeKey]);
  async function downloadOriginal() {
    try {
      const response = await fetch("/api/resume");
      if (!response.ok)
        throw new Error(
          ((await response.json()) as { error?: string }).error ||
            "Не удалось скачать файл",
        );
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename || "Загруженное резюме.pdf";
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setLocalError((error as Error).message);
    }
  }
  const completion = profileCompletion(p);
  const sectionItems = [
    {
      value: "personal",
      label: "Личные данные",
      hint: "Контакты и локация",
      icon: UserRound,
      done: completion.required
        .filter((f) => ["name", "email", "city"].includes(f.key))
        .every((f) => f.done),
    },
    {
      value: "skills",
      label: "Роли и навыки",
      hint: "Направление и технологии",
      icon: Code2,
      done: completion.required
        .filter((f) => ["roles", "skills"].includes(f.key))
        .every((f) => f.done),
    },
    {
      value: "expectations",
      label: "Условия работы",
      hint: "Формат и зарплата",
      icon: MapPin,
      done: completion.required
        .filter((f) => ["salary", "consent"].includes(f.key))
        .every((f) => f.done),
    },
    {
      value: "experience",
      label: "Опыт и проекты",
      hint: "Необязательно",
      icon: BriefcaseBusiness,
      done: !!(p.workHistory.length || p.projects.trim() || p.education.trim()),
    },
    {
      value: "resume",
      label: "Резюме",
      hint: "Загрузка и сверка PDF",
      icon: FileText,
      done: !!(s.profile.resumeKey || filename),
    },
  ];
  const put = (k: keyof Profile, v: unknown) => {
    set(editWorkPreference(editPersonalName(p, k, v), k, v));
    setSaved(false);
    setLocalError("");
  };
  function addWork() {
    const id = crypto.randomUUID();
    put("workHistory", [
      ...p.workHistory,
      {
        id,
        company: "",
        role: "",
        start: "",
        end: "",
        current: false,
        description: "",
      },
    ]);
    setEditingCard(`work:${id}`);
  }
  const renderEditor = (card: string) => (
    <>
      {card === "identity" && (
        <ProfileAvatarEditor profile={p} onStateChange={onStateChange} />
      )}
      <ProfileInlineFields
        profile={p}
        card={card}
        put={put}
        addWork={addWork}
      />
    </>
  );
  async function save() {
    const validation =
      phoneError(p.phone) ||
      (p.salaryMin && p.salaryMax
        ? salaryRangeError(p.salaryMin, p.salaryMax)
        : null);
    if (validation) {
      setLocalError(validation);
      return;
    }
    setBusy(true);
    const r = await act(
      profileCompletion(p).ready ? "profile" : "profile-draft",
      p,
    );
    setBusy(false);
    if (r) {
      meta.reset(r.profile);
      setSaved(true);
      setEditingCard(null);
    }
  }
  async function upload(file?: File, existing = false) {
    if ((!file && !existing) || uploading) return;
    setUploading(true);
    try {
      const f = new FormData();
      if (file) f.set("file", file);
      if (existing) f.set("reparse", "true");
      const r = await fetch("/api/resume", { method: "POST", body: f });
      const b = (await r.json()) as ResumeImportResponse;
      if (!r.ok) throw new Error(b.error);
      const previews = (b.photos || []).map(photoPreview);
      setPhotos(previews);
      setSelectedPhoto(previews.length === 1 ? 0 : null);
      setFilename(b.filename);
      setParsed(
        Object.fromEntries(
          Object.entries(b.parsed).filter(
            ([key]) => !["firstName", "lastName", "patronymic"].includes(key),
          ),
        ),
      );
      setSelected(
        Object.keys(b.parsed).filter(
          (key) => !["firstName", "lastName", "patronymic"].includes(key),
        ),
      );
      setReview(true);
    } catch (e) {
      setLocalError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }
  return (
    <>
      <Tabs
        value={profileTab}
        onValueChange={setProfileTab}
        className="profile-tabbed-editor"
        orientation="vertical"
      >
        <div className="editor-layout">
          <div className="profile-navigation-card">
            <TabsList
              className="profile-section-nav"
              aria-label="Разделы профиля"
            >
              {sectionItems.map(({ value, label, hint, icon: Icon, done }) => (
                <TabsTrigger key={value} value={value} aria-label={label}>
                  <span className="profile-tab-icon">
                    <Icon aria-hidden="true" />
                  </span>
                  <span className="profile-tab-copy">
                    <strong>{label}</strong>
                    <small>{hint}</small>
                  </span>
                  {done && (
                    <Check
                      className="profile-tab-check"
                      aria-label="Заполнено"
                    />
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          <form
            ref={formRef}
            className="panel form-stack profile-form"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            {actionsHost &&
              createPortal(
                <div className="profile-toolbar">
                  <button
                    type="button"
                    className="btn outline"
                    onClick={() => nav("/demo/candidate/profile-view")}
                  >
                    <UserRound size={17} /> Посмотреть профиль
                  </button>

                  <button
                    type="button"
                    className="btn outline"
                    onClick={() => download(p)}
                  >
                    <Download size={17} /> Скачать PDF
                  </button>
                </div>,
                actionsHost,
              )}
            <DraftStatus meta={meta} />
            {localError && (
              <p role="alert" className="inline-error">
                {localError}
              </p>
            )}
            <TabsContent value="personal" className="profile-section-content">
              <ProfileSummary
                profile={p}
                section="personal"
                editingCard={editingCard}
                onEdit={setEditingCard}
                renderEditor={renderEditor}
                onSave={save}
                busy={busy}
                addWork={addWork}
              />
            </TabsContent>
            <TabsContent value="skills" className="profile-section-content">
              <ProfileSummary
                profile={p}
                section="skills"
                editingCard={editingCard}
                onEdit={setEditingCard}
                renderEditor={renderEditor}
                onSave={save}
                busy={busy}
                addWork={addWork}
              />
            </TabsContent>
            <TabsContent value="experience" className="profile-section-content">
              <ProfileSummary
                profile={p}
                section="experience"
                editingCard={editingCard}
                onEdit={setEditingCard}
                renderEditor={renderEditor}
                onSave={save}
                busy={busy}
                addWork={addWork}
              />
            </TabsContent>
            <TabsContent
              value="expectations"
              className="profile-section-content"
            >
              <ProfileSummary
                profile={p}
                section="expectations"
                editingCard={editingCard}
                onEdit={setEditingCard}
                renderEditor={renderEditor}
                onSave={save}
                busy={busy}
                addWork={addWork}
              />
            </TabsContent>
            <TabsContent value="resume" className="profile-section-content">
              <div className="form-section-heading">
                <span className="mono">05</span>
                <div>
                  <h2>Ваше резюме</h2>
                  <p>
                    Загрузите PDF сейчас или в любое удобное время. Поля можно
                    заполнить вручную.
                  </p>
                </div>
              </div>
              <div
                className="upload-zone"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  upload(e.dataTransfer.files[0]);
                }}
              >
                <Upload size={30} />
                <strong>
                  {uploading
                    ? "Разбираем резюме…"
                    : filename
                      ? "Загрузить новую версию резюме"
                      : "Начните с вашего резюме"}
                </strong>
                <p>
                  Перетащите PDF или выберите файл · текстовый слой · до 10 МБ
                </p>
                <label className="btn subtle">
                  {uploading ? "Читаем документ…" : "Выбрать PDF"}
                  <input
                    type="file"
                    accept="application/pdf"
                    hidden
                    disabled={uploading}
                    onChange={(e) => upload(e.target.files?.[0])}
                  />
                </label>
              </div>
              {(s.profile.resumeKey || filename) && (
                <section className="resume-original-file">
                  <FileText size={26} />
                  <div>
                    <h3>Загруженное резюме</h3>
                    <p>{filename || "Ваш исходный PDF"}</p>
                    <small>Оригинал файла, который вы загрузили.</small>
                  </div>
                  <div className="resume-original-actions">
                    <button
                      type="button"
                      className="btn outline"
                      onClick={downloadOriginal}
                    >
                      <Download size={17} /> Скачать оригинал
                    </button>
                    <button
                      type="button"
                      className="btn outline"
                      disabled={uploading}
                      onClick={() => upload(undefined, true)}
                    >
                      Разобрать заново
                    </button>
                  </div>
                </section>
              )}
              {parsed && (
                <button
                  className="text-link"
                  type="button"
                  onClick={() => setReview(true)}
                >
                  Проверить найденные данные
                </button>
              )}
              <ResumePreview profile={p} />
            </TabsContent>
            {profileTab === "resume" && (
              <div className="profile-sticky-actions">
                <span>
                  {saved ? (
                    <>
                      <Check size={15} />
                      Профиль сохранён
                    </>
                  ) : (
                    <>Неопубликованные изменения сохраняются как черновик</>
                  )}
                </span>
                <button className="btn primary" disabled={busy}>
                  Сохранить изменения
                  <ArrowRight size={17} />
                </button>
              </div>
            )}
          </form>
          <aside className="editor-aside">
            <ProfileCompletion
              profile={p}
              variant="rail"
              savedProfile={s.profile}
              onFieldSelect={(key) => {
                const tab = ["name", "email", "city", "phone"].includes(key)
                  ? "personal"
                  : ["skills", "roles", "bio"].includes(key)
                    ? "skills"
                    : ["education", "projects", "languages", "links"].includes(
                          key,
                        )
                      ? "experience"
                      : "expectations";
                setProfileTab(tab);
                setEditingCard(
                  (
                    {
                      name: "personal",
                      email: "personal",
                      city: "personal",
                      phone: "personal",
                      roles: "roles",
                      skills: "skills",
                      bio: "bio",
                      salary: "salary",
                      consent: "consent",
                      education: "education",
                      projects: "projects",
                      languages: "languages",
                      links: "links",
                    } as Record<string, string>
                  )[key] || "personal",
                );
              }}
            />
            <div className="panel">
              <Award size={28} className="purple" />
              <h3>Подтверждённая категория</h3>
              {s.profile.grade ? (
                <Badge>
                  {s.profile.specialty} {s.profile.grade} · {s.profile.score}%
                </Badge>
              ) : (
                <p>Пока не подтверждена</p>
              )}
              <p className="muted">
                {s.profile.grade
                  ? "Категория подтверждена проверкой уровня. Самооценка в резюме учитывается отдельно."
                  : "Указанный в резюме грейд — самооценка. Категория появится после проверки уровня."}
              </p>
              <button
                className="btn primary full"
                onClick={() => nav("/demo/candidate/assessment")}
              >
                Подтвердить уровень
                <ArrowRight size={16} />
              </button>
            </div>
            <div className="panel fsp-panel">
              <img src="/brand/fsp.svg" alt="ФСП" />
              <h3>История ФСП</h3>
              <p>
                Участие — дополнительный сигнал. Отсутствие истории не
                ограничивает регистрацию.
              </p>
              {s.auth?.demo ? (
                <>
                  <label className="field">
                    ID участника
                    <ChoiceSelect
                      label="Демонстрационный участник ФСП"
                      value={fsp}
                      onChange={setFsp}
                      options={[
                        {
                          value: "FSP-DEMO-1042",
                          label: "1042 · с достижениями",
                        },
                        {
                          value: "FSP-DEMO-1043",
                          label: "1043 · без достижений",
                        },
                        { value: "", label: "Без привязки ФСП" },
                      ]}
                    />
                  </label>
                  <button
                    className="btn subtle full"
                    onClick={async () => {
                      await act("fsp", { id: fsp });
                    }}
                  >
                    {fsp
                      ? "Загрузить историю (демо)"
                      : "Сохранить без привязки"}
                  </button>
                  {s.profile.fsp && (
                    <div aria-live="polite">
                      <p>ID: {s.profile.fsp}</p>
                      {s.profile.achievements.length ? (
                        <ul>
                          {s.profile.achievements.map((a) => (
                            <li key={a}>{a}</li>
                          ))}
                        </ul>
                      ) : (
                        <p>
                          Участник найден. Достижений пока нет — это не снижает
                          категорию.
                        </p>
                      )}
                    </div>
                  )}
                  <small>
                    Демонстрационный реестр. Настоящий ФСП ID подключается
                    отдельно.
                  </small>
                </>
              ) : (
                <FspConnect role="candidate" intent="link" />
              )}
            </div>
          </aside>
        </div>
      </Tabs>
      <Dialog open={review} onOpenChange={setReview}>
        <DialogContent className="app-dialog resume-review">
          <DialogHeader>
            <DialogTitle>Проверим найденное.</DialogTitle>
            <DialogDescription>
              Выберите поля для переноса. Остальные данные профиля останутся
              вашими. Грейд из PDF не подтверждает квалификацию.
            </DialogDescription>
          </DialogHeader>
          <div className="resume-review-filename">
            <FileText size={20} />
            {filename}
          </div>
          <div className="resume-review-fields">
            {Object.entries(labels).map(([key, label]) => {
              const v = (parsed as any)?.[key],
                found = v !== undefined;
              return (
                <label key={key} className={!found ? "not-found" : ""}>
                  <Checkbox
                    disabled={!found}
                    checked={found && selected.includes(key)}
                    onCheckedChange={(c) =>
                      setSelected(
                        c
                          ? [...selected, key]
                          : selected.filter((x) => x !== key),
                      )
                    }
                  />
                  <div>
                    <strong>{label}</strong>
                    <span>
                      {found
                        ? resumeFieldText(v)
                        : "Не найдено — заполните вручную"}
                    </span>
                  </div>
                  {found && <Check size={16} className="purple" />}
                </label>
              );
            })}
          </div>
          <ResumePhotoReview
            photos={photos}
            selected={selectedPhoto}
            onSelect={setSelectedPhoto}
          />
          <DialogFooter>
            <button className="btn outline" onClick={() => setReview(false)}>
              Пока не переносить
            </button>
            <button
              className="btn primary"
              disabled={uploading}
              onClick={async () => {
                setUploading(true);
                try {
                  if (selectedPhoto !== null && photos[selectedPhoto])
                    onStateChange(
                      await importResumePhoto(photos[selectedPhoto]),
                    );
                  const patch = Object.fromEntries(
                    Object.entries(parsed || {}).filter(([k]) =>
                      selected.includes(k),
                    ),
                  );
                  set({ ...p, ...patch });
                  setReview(false);
                } catch (error) {
                  setLocalError((error as Error).message);
                } finally {
                  setUploading(false);
                }
              }}
            >
              Перенести выбранное
              <ArrowRight size={17} />
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
