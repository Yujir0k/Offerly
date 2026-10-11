"use client";
import { useState } from "react";
import type { Profile, Need, State } from "@/lib/model";
import { useDraft, DraftStatus } from "@/hooks/use-draft";
import { toast } from "sonner";
import { ShieldCheck, LockKeyhole, Send } from "lucide-react";
import { LogoMotion } from "./logo-motion";
import { EmployerField, EmployerSelect } from "./employer-ui";
import type { Action } from "./registration";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
export function InviteDialog({
  p,
  n,
  company,
  act,
  close,
}: {
  p: Profile | null;
  n: Need;
  company: State["company"];
  act: Action;
  close: () => void;
}) {
  const [d, setD, inviteMeta] = useDraft(`invite:${p?.id || "empty"}`, {
    title: n.title,
    description: n.description,
    min: n.min,
    max: n.max,
    contact: company.email,
    format: n.format,
    city: "",
  });
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={!!p}
      onOpenChange={(v) => {
        if (!v) close();
      }}
    >
      <DialogContent className="app-dialog invitation-compose-dialog">
        <DialogHeader>
          <DialogTitle>Пригласить кандидата</DialogTitle>
          <DialogDescription>
            Предложение для кандидата #{p?.id}. Условия будут видны до начала
            общения.
          </DialogDescription>
        </DialogHeader>
        <form
          key={p?.id}
          className="form-stack"
          onSubmit={async (e) => {
            e.preventDefault();
            const data = Object.fromEntries(new FormData(e.currentTarget));
            setBusy(true);
            const r = await act("invite", {
              ...data,
              candidateId: p?.id,
              needId: n.id || undefined,
              format: d.format || n.format,
              city: d.city,
              grade: n.grade,
              skills: n.skills,
            });
            setBusy(false);
            if (r) {
              toast.success("Приглашение отправлено");
              inviteMeta.reset({
                title: n.title,
                description: n.description,
                min: n.min,
                max: n.max,
                contact: company.email,
                format: n.format,
                city: "",
              });
              close();
            }
          }}
        >
          <DraftStatus meta={inviteMeta} />
          <div className="invitation-compose-recipient">
            <ShieldCheck size={22} />
            <div>
              <strong>Кандидат #{p?.id}</strong>
              <span>
                {p?.specialty} · {p?.grade} подтверждён
              </span>
            </div>
            <LockKeyhole size={18} />
          </div>
          <EmployerField label="Должность">
            <input
              name="title"
              required
              value={d.title}
              onChange={(e) => setD((x) => ({ ...x, title: e.target.value }))}
            />
          </EmployerField>
          <EmployerField label="Задачи и предложение">
            <textarea
              name="description"
              required
              rows={4}
              value={d.description}
              onChange={(e) =>
                setD((x) => ({ ...x, description: e.target.value }))
              }
            />
          </EmployerField>
          <div className="form-two">
            <EmployerField label="Зарплата от, ₽/мес">
              <input
                type="number"
                name="min"
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
                type="number"
                name="max"
                min={1}
                required
                value={d.max}
                onChange={(e) =>
                  setD((x) => ({ ...x, max: Number(e.target.value) }))
                }
              />
            </EmployerField>
          </div>
          <EmployerField label="Как связаться с вашей командой">
            <input
              name="contact"
              required
              value={d.contact}
              onChange={(e) => setD((x) => ({ ...x, contact: e.target.value }))}
            />
          </EmployerField>
          <div className="form-two">
            <EmployerField label="Формат работы">
              <EmployerSelect
                label="Формат работы"
                value={d.format || n.format}
                onChange={(format) => setD((x) => ({ ...x, format }))}
                options={["Удалённо", "Гибрид", "Офис"].map((value) => ({
                  value,
                  label: value,
                }))}
              />
            </EmployerField>
            <EmployerField label="Город команды" hint="Необязательно">
              <input
                name="city"
                placeholder="Например, Москва"
                value={d.city}
                onChange={(e) => setD((x) => ({ ...x, city: e.target.value }))}
              />
            </EmployerField>
          </div>
          <p className="small-note">
            <LockKeyhole size={14} />
            Контакты кандидата откроются только после его согласия.
          </p>
          <button className="btn primary full" disabled={busy}>
            {busy ? (
              <LogoMotion size={20} />
            ) : (
              <>
                Отправить приглашение
                <Send size={17} />
              </>
            )}
          </button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
