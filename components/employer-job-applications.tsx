"use client";
import { ChatLaunch } from "./chat-launch";
import { useState } from "react";
import { Check, Inbox, Mail, MapPin, Phone, X } from "lucide-react";
import { toast } from "sonner";
import type { Job, State } from "@/lib/model";
import type { Action } from "./registration";
import type { Navigate } from "./landing";
import { applicationLabel } from "@/lib/job-applications";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
export function EmployerJobApplications({
  s,
  job,
  act,
  nav,
}: {
  s: State;
  job: Job;
  act: Action;
  nav: Navigate;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const applications = s.applications.filter((a) => a.jobId === job.id);
  return (
    <>
      <button className="btn secondary" onClick={() => setOpen(true)}>
        <Inbox size={17} />
        Отклики · {applications.length}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="app-dialog vacancy-application-dialog">
          <DialogHeader>
            <DialogTitle>Отклики на вакансию</DialogTitle>
            <DialogDescription>
              {job.title} · {job.company}
            </DialogDescription>
          </DialogHeader>
          {!applications.length && (
            <div className="vacancy-employer-empty">
              <Inbox size={34} />
              <h3>Пока нет откликов</h3>
              <p>
                Здесь появятся профили и сообщения кандидатов, которые выбрали
                вашу вакансию.
              </p>
            </div>
          )}
          {applications.map((application) => (
            <article
              className="vacancy-employer-response"
              key={application.id || application.jobId}
            >
              <div className="vacancy-response-heading">
                <h3>{application.candidate?.name || "Кандидат"}</h3>
                <span className="vacancy-application-status">
                  {applicationLabel(application.status)}
                </span>
              </div>
              <span className="muted">
                {new Date(application.createdAt).toLocaleDateString("ru-RU")} ·
                Профиль на момент отклика
              </span>
              {application.candidate && (
                <>
                  <p>
                    {application.candidate.headline ||
                      application.candidate.roles.join(", ") ||
                      application.candidate.specialty}
                  </p>
                  <div className="vacancy-response-contacts">
                    <a href={`mailto:${application.candidate.email}`}>
                      <Mail size={15} />
                      {application.candidate.email}
                    </a>
                    {application.candidate.phone && (
                      <a
                        href={`tel:${application.candidate.phone.replace(/[^+\d]/g, "")}`}
                      >
                        <Phone size={15} />
                        {application.candidate.phone}
                      </a>
                    )}
                    {application.candidate.city && (
                      <span>
                        <MapPin size={15} />
                        {application.candidate.city}
                      </span>
                    )}
                  </div>
                  <div className="vacancy-skill-chips">
                    {application.candidate.skills.map((skill) => (
                      <span key={skill}>{skill}</span>
                    ))}
                  </div>
                  {application.candidate.grade && (
                    <p>
                      {application.candidate.demonstration
                        ? "Условная категория · демопример: "
                        : "Подтверждённая категория: "}
                      {application.candidate.grade}
                    </p>
                  )}
                  {application.candidate.bio && (
                    <p>{application.candidate.bio}</p>
                  )}
                  {!application.candidate.grade && (
                    <p className="muted">
                      Категория ещё не подтверждена проверкой.
                    </p>
                  )}
                  {application.candidate.verified.length > 0 && (
                    <p>
                      {application.candidate.demonstration
                        ? "Условные навыки · демопример:"
                        : "Подтверждённые навыки:"}{" "}
                      {application.candidate.verified.join(", ")}
                    </p>
                  )}
                  <details className="vacancy-response-details">
                    <summary>Опыт и дополнительные сведения</summary>
                    {application.candidate.workHistory.map((work) => (
                      <section key={work.id}>
                        <strong>
                          {work.role} · {work.company}
                        </strong>
                        <p>
                          {work.start} —{" "}
                          {work.current ? "По настоящее время" : work.end}
                        </p>
                        <p>{work.description}</p>
                      </section>
                    ))}
                    {[
                      ["Образование", application.candidate.education],
                      ["Проекты", application.candidate.projects],
                      ["Языки", application.candidate.languages.join(", ")],
                      ["Дополнительные сведения", application.candidate.notes],
                    ]
                      .filter(([, value]) => value)
                      .map(([title, value]) => (
                        <section key={title}>
                          <strong>{title}</strong>
                          <p>{value}</p>
                        </section>
                      ))}
                    {!application.candidate.workHistory.length &&
                      !application.candidate.education &&
                      !application.candidate.projects &&
                      !application.candidate.languages.length &&
                      !application.candidate.notes && (
                        <p className="muted">
                          Дополнительные сведения пока не заполнены.
                        </p>
                      )}
                  </details>
                </>
              )}
              {application.message && (
                <section className="vacancy-response-message">
                  <strong>Сообщение команде</strong>
                  <p>{application.message}</p>
                </section>
              )}
              <div className="vacancy-application-footer">
                {application.id && (
                  <ChatLaunch
                    role="employer"
                    applicationId={application.id}
                    nav={nav}
                  />
                )}
                {["Просмотрен", "Отклонён"].map((status) => (
                  <button
                    key={status}
                    disabled={busy || application.status === status}
                    className="btn secondary"
                    onClick={async () => {
                      setBusy(true);
                      const result = await act("application-status", {
                        id: application.id,
                        jobId: job.id,
                        status,
                      });
                      setBusy(false);
                      if (result) toast.success("Статус отклика обновлён");
                    }}
                  >
                    {status === "Просмотрен" ? (
                      <Check size={16} />
                    ) : (
                      <X size={16} />
                    )}
                    {status === "Просмотрен"
                      ? "Отметить просмотренным"
                      : "Отклонить"}
                  </button>
                ))}
              </div>
            </article>
          ))}
        </DialogContent>
      </Dialog>
    </>
  );
}
