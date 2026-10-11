import { readRequestJson } from "@/lib/request-security";
import { specialtyName } from "@/lib/assessment-tracks";
import { workHistoryDateError } from "@/lib/work-dates";
import { syncDemoFspHistory } from "@/lib/fsp-history";
import { FspRegistryError } from "@/lib/fsp-registry";
import { withPersonalName } from "@/lib/personal-name";
import { phoneError, formatPhone } from "@/lib/phone";
import { profileGrades, availabilityOptions } from "@/lib/profile-options";
import { profileInitials } from "@/lib/profile-identity";
import { formatOptions, employmentOptions } from "@/lib/profile-options";
import {
  workspace,
  save,
  clientState,
  errorResponse,
  checkOrigin,
} from "@/lib/store";
import {
  assessmentTracks,
  assessmentProfileSpecialties,
} from "@/lib/assessment-tracks";
import { grades, specialties, industries, Need, rank } from "@/lib/model";
import { salaryRangeError } from "@/lib/salary-range";
import { profileCompletion } from "@/lib/profile-completion";
import {
  skillCatalog,
  canonicalSuggestion,
  normalizeSuggestion,
} from "@/lib/suggestion-catalogs";
import { ownsJob, applicationProfileError } from "@/lib/job-applications";
import {
  cleanCompany,
  cleanJob,
  invitationOwned,
  publishedJob,
  assetUrl,
} from "@/lib/employer-profile";
import {
  userSettings,
  validTimeZone,
  deletedAccountState,
} from "@/lib/account-settings";
import { bucket } from "@/lib/file-storage";
import { verificationEmail, confirmEmail, throttle } from "@/lib/auth";
import {
  beginEmailChange,
  authorizeEmailChange,
  resendEmailChange,
  finishEmailChange,
} from "@/lib/email-change";
import {
  inheritPlatformContext,
  loadPlatform,
  accountById,
} from "@/lib/platform";
import { validateTaskBrief } from '@/lib/task-brief';
import { changeInvitation, assertInvitationRevision } from '@/lib/invitation-changes';
import { invitationSource } from '@/lib/invitations';

export async function POST(r: Request) {
  try {
    checkOrigin(r);
    const b = (await readRequestJson(r, 524288)) as Record<string, any>;
    const {
      owner,
      db,
      account,
      state: s,
    } = await workspace({
      allOwnedJobs: b.type === "company",
      jobId: ["apply", "favorite-job", "job", "job-status"].includes(b.type)
        ? String(b.id || "").slice(0, 100)
        : String(b.type === 'invite' ? b.needId || '' : b.jobId || '').slice(0, 100),
      candidateId:
        b.type === "invite"
          ? Number(b.candidateId)
          : b.type === "saved"
            ? Number(b.id)
            : undefined,
    });
    await throttle("action:" + owner, 120, 60);
    const role = b.role === "employer" ? "employer" : "candidate";
    const p = s.profile;
    if (
      !account.demo &&
      !account.verified_at &&
      ['invite', 'invitation-update', 'invitation-cancel', 'apply', 'need', 'need-delete', 'start', 'finish', 'fsp'].includes(
        String(b.type),
      )
    )
      throw new Error("Подтвердите почту аккаунта перед этим действием");
    if (
      !account.demo &&
      !account.verified_at &&
      b.type === "job" &&
      b.status !== "draft"
    )
      throw new Error("Подтвердите почту перед публикацией вакансии");
    if (s.accountDeletedAt && b.type !== "onboard")
      throw new Error(
        "Аккаунт удалён. Создайте новый профиль, чтобы продолжить.",
      );
    const str = (v: any, max = 3000) =>
      typeof v === "string" ? v.trim().slice(0, max) : "";
    const salary = (a: any, z: any) => {
      const min = Number(a),
        max = Number(z);
      const error = salaryRangeError(a, z);
      if (error) throw new Error(error);
      return { min, max };
    };
    const list = (v: any, max = 20) =>
      Array.isArray(v)
        ? v
            .slice(0, max)
            .map((x) => str(x, 160))
            .filter(Boolean)
        : [];
    if (typeof b.specialty === "string")
      b.specialty = specialtyName(b.specialty);
    switch (b.type) {
      case "onboard": {
        const freshAccount = !s.onboarded || !!s.accountDeletedAt;
        if (b.consent !== true)
          throw new Error("Нужно согласие на обработку профиля");
        if (str(b.name).length < 2 || !/^\S+@\S+\.\S+$/.test(str(b.email)))
          throw new Error("Проверьте имя и email");
        s.onboarded = true;
        s.accountDeletedAt = undefined;
        s.role = role;
        s.emailVerification = {
          email: str(b.email, 200).toLowerCase(),
          status: "unverified",
        };
        if (role === "candidate") {
          s.journey = "profile";
          s.surveys = [];
          s.attempts = [];
          s.applications = [];
          s.favoriteJobs = [];
          s.invitations = s.invitations.filter((i) => i.candidateId !== p.id);
          Object.assign(p, {
            ...withPersonalName({
              name: str(b.name, 180),
              firstName:
                typeof b.firstName === "string"
                  ? str(b.firstName, 60)
                  : undefined,
              lastName:
                typeof b.lastName === "string"
                  ? str(b.lastName, 60)
                  : undefined,
              patronymic:
                typeof b.patronymic === "string"
                  ? str(b.patronymic, 60)
                  : undefined,
            }),
            email: str(b.email, 200),
            grade: null,
            score: 0,
            verified: [],
            fsp: null,
            achievements: [],
            competitionResults: [],
            assessmentEvidence: undefined,
            consent: true,
            visible: true,
            phone: "",
            skills: [],
            bio: "",
            experience: 0,
            roles: [],
            softSkills: [],
            languages: [],
            education: "",
            notes: "",
            links: [],
            workHistory: [],
            projects: "",
            country: "",
            region: "",
            city: "",
            preferredLocations: [],
            relocation: false,
            salaryMin: 0,
            salaryMax: 0,
            employment: "Полная занятость",
            availability: "В течение месяца",
            resumeKey: undefined,
            avatarKey: undefined,
            headline: "",
            jobStatus: "open",
            professionalDirection: "",
            format: "Любой",
            formats: ["Любой"],
            employmentTypes: ["Полная занятость"],
            lastGradeChange: null,
          });
          p.initials = profileInitials(p);
        } else {
          if (freshAccount)
            s.company = {
              id: s.company.id,
              name: "",
              email: "",
              description: "",
              website: "",
              contactName: str(b.name, 120),
            };
          Object.assign(s.company, {
            name: str(b.company || b.name, 150),
            email: str(b.email, 200),
          });
        }
        break;
      }
      case "profile":
      case "profile-draft": {
        if (role !== "candidate") throw new Error("Доступно только кандидату");
        if (str(b.name).length < 2 || !/^\S+@\S+\.\S+$/.test(str(b.email)))
          throw new Error("Проверьте имя и email");
        const workDateError = workHistoryDateError(b.workHistory);
        if (workDateError) throw new Error(workDateError);
        if (
          (!specialties.includes(b.specialty) &&
            !assessmentProfileSpecialties.includes(b.specialty)) ||
          !profileGrades.includes(b.claimed)
        )
          throw new Error("Выберите специализацию и грейд");
        const phoneValidation = phoneError(str(b.phone, 100));
        if (phoneValidation) throw new Error(phoneValidation);
        if (
          !Number.isFinite(Number(b.experience)) ||
          Number(b.experience) < 0 ||
          Number(b.experience) > 50
        )
          throw new Error("Укажите коммерческий опыт от 0 до 50 лет.");
        const availabilities = Array.isArray(b.availabilities)
          ? list(b.availabilities, 4)
          : str(b.availability, 200).split(" · ").filter(Boolean);
        if (availabilities.some((v) => !availabilityOptions.includes(v)))
          throw new Error("Выберите готовность к работе из списка.");
        const previousSpecialty = p.specialty;
        if (b.jobStatus && !["active", "open", "paused"].includes(b.jobStatus))
          throw new Error("Выберите статус поиска работы");
        const partialSalary = (value: unknown) => {
          if (typeof value !== "number" && typeof value !== "string") return 0;
          const number = Number(value);
          return Number.isInteger(number) && number >= 0 && number <= 10000000
            ? number
            : 0;
        };
        const range =
          b.type === "profile-draft"
            ? {
                min: partialSalary(b.salaryMin),
                max: partialSalary(b.salaryMax),
              }
            : salary(b.salaryMin, b.salaryMax);
        if (range.min && range.max) {
          const error = salaryRangeError(range.min, range.max);
          if (error) throw new Error(error);
        }
        const formats = Array.isArray(b.formats)
          ? list(b.formats, 4)
          : str(b.format, 100).split(" · ").filter(Boolean);
        const employmentTypes = Array.isArray(b.employmentTypes)
          ? list(b.employmentTypes, 4)
          : str(b.employment, 160).split(" · ").filter(Boolean);
        if (
          formats.some((v) => !formatOptions.includes(v)) ||
          employmentTypes.some((v) => !employmentOptions.includes(v))
        )
          throw new Error("Выберите формат работы и занятость из списка");
        const cleanFormats = formats.includes("Любой")
          ? ["Любой"]
          : [...new Set(formats)];
        Object.assign(p, {
          ...withPersonalName({
            name: str(b.name, 180) || p.name,
            firstName:
              typeof b.firstName === "string"
                ? str(b.firstName, 60)
                : undefined,
            lastName:
              typeof b.lastName === "string" ? str(b.lastName, 60) : undefined,
            patronymic:
              typeof b.patronymic === "string"
                ? str(b.patronymic, 60)
                : undefined,
          }),
          headline: str(b.headline, 100),
          jobStatus: b.jobStatus || p.jobStatus || "open",
          email: str(b.email, 200),
          phone: formatPhone(str(b.phone, 50)),
          specialty: b.specialty,
          professionalDirection: str(b.professionalDirection, 100),
          claimed: b.claimed,
          skills: Array.isArray(b.skills)
            ? b.skills
                .slice(0, 80)
                .map((value: unknown) =>
                  canonicalSuggestion(skillCatalog, str(value, 100)),
                )
                .filter(
                  (value: string, index: number, values: string[]) =>
                    value &&
                    values.findIndex(
                      (other) =>
                        normalizeSuggestion(other) ===
                        normalizeSuggestion(value),
                    ) === index,
                )
                .slice(0, 80)
            : p.skills,
          city: str(b.city, 100),
          country: str(b.country, 100),
          region: str(b.region, 100),
          preferredLocations: list(b.preferredLocations),
          relocation: !!b.relocation,
          formats: cleanFormats,
          format: cleanFormats.join(" · "),
          experience: Math.max(0, Math.min(50, Number(b.experience) || 0)),
          salaryMin: range.min,
          salaryMax: range.max,
          bio: str(b.bio),
          consent: typeof b.consent === "boolean" ? b.consent : p.consent,
          industry: str(b.industry, 160) || p.industry,
          preferredIndustries: Array.isArray(b.preferredIndustries)
            ? list(b.preferredIndustries, 20)
            : p.preferredIndustries || [p.industry].filter(Boolean),
          roles: list(b.roles),
          softSkills: list(b.softSkills),
          languages: list(b.languages),
          links: list(b.links),
          education: str(b.education, 6000),
          notes: str(b.notes, 6000),
          projects: str(b.projects, 5000),
          employmentTypes: [...new Set(employmentTypes)],
          employment: [...new Set(employmentTypes)].join(" · "),
          availabilities,
          availability: availabilities.join(" · "),
          workHistory: Array.isArray(b.workHistory)
            ? b.workHistory.slice(0, 12).map((w: any) => ({
                id: str(w.id, 80) || crypto.randomUUID(),
                company: str(w.company, 150),
                role: str(w.role, 150),
                start: str(w.start, 20),
                end: str(w.end, 20),
                current: !!w.current,
                description: str(w.description, 2000),
              }))
            : [],
        });
        // Profile contact email is independent of the verified login address.
        s.emailVerification = {
          email: account.email,
          status: account.verified_at ? "verified" : "unverified",
        };
        p.initials = profileInitials(p);
        if (b.type === "profile" && !profileCompletion(p).ready)
          throw new Error(
            "Заполните обязательные поля: " +
              profileCompletion(p)
                .required.filter((field) => !field.done)
                .map((field) => field.label)
                .join(", "),
          );
        if (s.journey === "profile" && profileCompletion(p).ready)
          s.journey = "assessment";
        if (previousSpecialty !== p.specialty) {
          s.journey = "assessment";
          p.grade = null;
          p.verified = [];
          p.score = 0;
          p.assessmentEvidence = undefined;
          p.lastGradeChange = null;
        }
        break;
      }
      case "survey": {
        if (role !== "candidate") throw new Error("Доступно только кандидату");
        if (
          !industries.includes(b.industry) ||
          !assessmentTracks.some((t) => t.name === b.specialty) ||
          !["Junior", "Middle", "Senior"].includes(b.grade)
        )
          throw new Error(
            "Выберите отрасль, специализацию и предполагаемый уровень",
          );
        if (!list(b.roles).length) throw new Error("Выберите роль в команде");
        const survey = {
          id: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
          industry: b.industry,
          specialty: b.specialty,
          grade: b.grade,
          roles: list(b.roles),
          experience: Math.max(0, Math.min(50, Number(b.experience) || 0)),
          goal: str(b.goal, 1000),
        };
        s.surveys.unshift(survey);
        p.industry = survey.industry;
        p.roles = survey.roles;
        p.claimed = survey.grade;
        p.experience = survey.experience;
        if (p.specialty !== survey.specialty) {
          p.grade = null;
          p.score = 0;
          p.assessmentEvidence = undefined;
          p.verified = [];
          p.lastGradeChange = null;
          s.journey = "assessment";
        }
        p.specialty = survey.specialty;
        if (s.journey !== "complete") s.journey = "assessment";
        break;
      }
      case "account-email": {
        throw new Error(
          "Для смены почты подтвердите доступ к аккаунту в настройках.",
        );
      }
      case "email-change-begin":
      case "email-change-authorize":
      case "email-change-resend": {
        const flow =
          b.type === "email-change-begin"
            ? await beginEmailChange(
                account,
                str(b.email, 200),
                str(b.method, 30),
                str(b.password, 129),
              )
            : b.type === "email-change-authorize"
              ? await authorizeEmailChange(
                  account,
                  str(b.flowId, 80),
                  str(b.code, 20),
                )
              : await resendEmailChange(account, str(b.flowId, 80));
        return Response.json(
          { ...clientState(s, role), emailChange: flow },
          { headers: { "Cache-Control": "no-store" } },
        );
      }
      case "email-change-confirm": {
        const changed = await finishEmailChange(
          account,
          str(b.flowId, 80),
          str(b.code, 20),
        );
        return Response.json(clientState(await loadPlatform(changed), role), {
          headers: { "Cache-Control": "no-store" },
        });
      }
      case "notifications-read": {
        s.settings = {
          ...userSettings(s),
          notificationReadAt: new Date().toISOString(),
        };
        break;
      }
      case "account-settings": {
        const timeZone = str(b.timeZone, 80);
        if (!validTimeZone(timeZone))
          throw new Error("Выберите действительный часовой пояс.");
        if (!["off", "daily", "weekly"].includes(b.emailDigest))
          throw new Error("Выберите частоту уведомлений.");
        const settings = userSettings(s);
        let snoozedUntil = settings.snoozedUntil;
        if (b.snooze === "off") snoozedUntil = null;
        else if (["1", "7", "30"].includes(b.snooze))
          snoozedUntil = new Date(
            Date.now() + Number(b.snooze) * 86400000,
          ).toISOString();
        else if (b.snooze !== "keep") throw new Error("Выберите период паузы.");
        s.settings = {
          ...settings,
          timeZone,
          invitations: !!b.invitations,
          emailInvitations: typeof b.emailInvitations === "boolean" ? b.emailInvitations : settings.emailInvitations,
          applications: !!b.applications,
          assessments: !!b.assessments,
          emailDigest: b.emailDigest,
          snoozedUntil,
        };
        s.notifications = !!b.notifications;
        if (role === "candidate") p.visible = !!b.visible;
        break;
      }
      case "delete-account": {
        if (
          b.confirmation !== "УДАЛИТЬ" ||
          str(b.email, 200).toLowerCase() !==
            userSettings(s).email.toLowerCase()
        )
          throw new Error(
            "Для удаления введите почту аккаунта и слово УДАЛИТЬ.",
          );
        const cleared = deletedAccountState(s);
        inheritPlatformContext(cleared, s);
        await save(owner, cleared);
        if (bucket)
          for (const prefix of [
            `resumes/${owner}/`,
            `avatars/${owner}/`,
            `company-media/${owner}/`,
          ]) {
            let cursor: string | undefined;
            do {
              const files = await bucket.list({ prefix, cursor });
              if (files.objects.length)
                await bucket.delete(files.objects.map((file) => file.key));
              cursor = files.truncated ? files.cursor : undefined;
            } while (cursor);
          }
        return Response.json(clientState(cleared, role));
      }
      case "email-request": {
        const delivery = await verificationEmail(account, b.automatic === true);
        return Response.json(
          { ...clientState(s, role), ...delivery },
          { headers: { "Cache-Control": "no-store" } },
        );
      }
      case "email-confirm": {
        const verified = await confirmEmail(account, str(b.code, 100));
        return Response.json(clientState(await loadPlatform(verified), role));
      }
      case "privacy":
        if (role === "candidate") p.visible = !!b.visible;
        s.notifications = !!b.notifications;
        break;
      case "fsp":
        if (!account.demo)
          throw new Error(
            "Привяжите настоящий ФСП ID через настройки аккаунта.",
          );
        if (role !== "candidate") throw new Error("Доступно только кандидату");
        if ((await db.query('SELECT user_id FROM fsp_demo_links WHERE user_id=$1', [account.id])).rows.length)
          throw new Error('ФСП ID уже подключён через демосервис. Обновите достижения в профиле или настройках.');
        await syncDemoFspHistory(account, b.id);
        return Response.json(clientState(await loadPlatform(account), role));
      case "company": {
        if (role !== "employer")
          throw new Error("Доступно только работодателю");
        for (const invitation of s.invitations)
          if (invitationOwned(invitation, s))
            invitation.companyId = s.company.id;
        s.company = cleanCompany(b, s.company);
        for (const invitation of s.invitations)
          if (invitation.companyId === s.company.id)
            invitation.company = s.company.name;
        for (const job of s.jobs)
          if (ownsJob(job, s))
            Object.assign(job, {
              company: s.company.name,
              companyDescription: s.company.description,
              companySize: s.company.size,
              industry: s.company.industry,
              logo: assetUrl(s.company.logoKey),
            });
        break;
      }
      case "job": {
        if (role !== "employer")
          throw new Error("Доступно только работодателю");
        const current = b.id ? s.jobs.find((j) => j.id === b.id) : undefined;
        if (b.id && (!current || !ownsJob(current, s)))
          throw new Error("Вакансия недоступна для редактирования");
        const job = cleanJob(b, s, current);
        if (current) s.jobs[s.jobs.indexOf(current)] = job;
        else s.jobs.unshift(job);
        break;
      }
      case "job-status": {
        if (!account.demo && !account.verified_at && b.status === "published")
          throw new Error("Подтвердите электронную почту перед публикацией");
        if (role !== "employer")
          throw new Error("Доступно только работодателю");
        const job = s.jobs.find((j) => j.id === b.id);
        if (!job || !ownsJob(job, s)) throw new Error("Вакансия недоступна");
        if (!["published", "archived"].includes(b.status))
          throw new Error("Некорректный статус вакансии");
        if (b.status === "published" && job.status === "draft")
          throw new Error(
            "Откройте редактор и заполните вакансию перед публикацией",
          );
        job.status = b.status;
        job.updatedAt = new Date().toISOString();
        break;
      }
      case "need": {
        if (role !== "employer")
          throw new Error("Доступно только работодателю");
        const confirmedBrief = b.taskBrief !== undefined ? validateTaskBrief(b.taskBrief) : undefined;
        const range = salary(b.min, b.max);
        if (
          !str(b.title) ||
          (!confirmedBrief && (!specialties.includes(b.specialty) || !grades.includes(b.grade)))
        )
          throw new Error(
            "Заполните название, описание, специализацию и грейд",
          );
        const n: Need = {
          id: crypto.randomUUID(),
          title: str(b.title, 200),
          description: str(b.description) || 'Потребность команды',
          specialty: b.specialty,
          grade: b.grade,
          skills: str(b.skills, 500)
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean),
          desiredSkills: str(b.desiredSkills, 500).split(',').map(x => canonicalSuggestion(skillCatalog, x.trim())).filter(Boolean),
          task: ['balanced', 'operations', 'product', 'quality'].includes(b.task) ? b.task : 'balanced',
          format: str(b.format, 40),
          ...range,
        };
        if (confirmedBrief) {
          const brief = confirmedBrief;
          n.taskBrief = brief;
          n.specialty = brief.spec;
          n.grade = brief.grade;
          n.skills = brief.skills;
          n.desiredSkills = brief.desiredSkills;
          n.task = brief.task;
          n.min = Number(brief.salaryMin) || 1;
          n.max = Number(brief.salaryMax) || 10000000;
          n.format = brief.formats.length === 1 ? brief.formats[0] : 'Любой';
        }
        if (b.id) {
          const current = s.needs.find(item => item.id === b.id);
          if (!current) throw new Error('Подборка недоступна');
          n.id = current.id;
          s.needs[s.needs.indexOf(current)] = n;
        } else s.needs.unshift(n);
        break;
      }
      case 'need-delete': {
        if (role !== 'employer') throw new Error('Доступно только работодателю');
        const current = s.needs.find(n => n.id === b.id);
        if (!current) throw new Error('Подборка недоступна');
        s.needs = s.needs.filter(n => n.id !== b.id);
        break;
      }
      case "invite": {
        if (role !== "employer")
          throw new Error("Доступно только работодателю");
        const c = [p, ...s.candidates].find(
          (c) => c.id === Number(b.candidateId) && c.visible && c.consent,
        );
        if (
          !c ||
          c.jobStatus === "paused" ||
          !profileCompletion(c).ready
        )
          throw new Error(
            "Кандидат недоступен: нужны заполненный профиль и согласие на подбор",
          );
        if (s.blockedCandidateIds?.includes(c.id))
          throw new Error("Кандидат недоступен");
        if (c.id === p.id)
          throw new Error("Нельзя отправить приглашение самому себе");
        const sourceNeed = b.needId
          ? s.needs.find((n) => n.id === b.needId) || s.jobs.find((j) => j.id === b.needId && j.companyId === s.company.id)
          : undefined;
        if (b.needId && !sourceNeed)
          throw new Error("Подборка недоступна этой компании");
        if (!s.company.name || !s.company.description || !s.company.email)
          throw new Error("Заполните название, описание и контакт компании");
        if (
          s.invitations.some(
            (i) =>
              i.candidateId === c.id &&
              invitationOwned(i, s) &&
              ["sent", "viewed"].includes(i.status),
          )
        )
          throw new Error("Кандидату уже отправлено приглашение");
        const range = salary(b.min, b.max);
        if (!str(b.title) || !str(b.description) || !str(b.contact))
          throw new Error("Заполните предложение и способ связи");
        let source;
        if (b.needId) {
          const need = s.needs.find((item) => item.id === b.needId) || s.jobs.find((item) => item.id === b.needId && item.companyId === s.company.id);
          if (!need) throw new Error('Задача или вакансия недоступна');
          source = invitationSource(need);
        } else if (b.taskBrief) {
          const brief = validateTaskBrief(b.taskBrief);
          source = invitationSource({ id: '', title: `Подбор по задаче · ${brief.spec}`, specialty: brief.spec, grade: brief.grade, skills: brief.skills, description: '', min: Number(brief.salaryMin) || 1, max: Number(brief.salaryMax) || 10000000, format: brief.formats[0] || 'Любой', taskBrief: brief });
        }
        s.invitations.unshift({
          ...(source ? { source } : {}),
          id: crypto.randomUUID(),
          candidateId: c.id,
          ...(sourceNeed
            ? { needId: sourceNeed.id, match: rank(c, sourceNeed) }
            : {}),
          title: str(b.title, 200),
          description: str(b.description),
          company: s.company.name,
          companyId: s.company.id,
          contact: str(b.contact, 200),
          format: formatOptions
            .filter((value) => value !== "Любой")
            .includes(b.format)
            ? b.format
            : undefined,
          city: str(b.city, 100) || undefined,
          grade: grades.includes(b.grade) ? b.grade : undefined,
          skills: list(b.skills),
          ...range,
          status: "sent",
          createdAt: new Date().toISOString(),
        });
        break;
      }
      case "invitation-update":
      case "invitation-cancel": {
        if (role !== "employer") throw new Error("Доступно только работодателю");
        const i = s.invitations.find((i) => i.id === b.id && invitationOwned(i, s));
        if (!i) throw new Error("Приглашение недоступно этой компании");
        Object.assign(i, changeInvitation(i, b.type, b));
        // Object.assign does not remove the old read marker when an edit reopens the proposal.
        if (b.type === "invitation-update") delete i.readAt;
        break;
      }
      case "respond": {
        if (role !== "candidate") throw new Error("Доступно только кандидату");
        const i = s.invitations.find(
          (i) => i.id === b.id && i.candidateId === p.id,
        );
        if (!i) throw new Error("Приглашение не найдено");
        if (!["sent", "viewed"].includes(i.status))
          throw new Error("Ответ уже сохранён");
        if (b.status !== "viewed") assertInvitationRevision(i, b.expectedUpdatedAt);
        if (!["viewed", "accepted", "declined"].includes(b.status))
          throw new Error("Некорректный статус");
        if (b.status === "declined")
          i.declineReason = str(b.declineReason, 500) || undefined;
        i.status = b.status;
        i.readAt ||= new Date().toISOString();
        if (b.status !== "viewed") i.respondedAt = new Date().toISOString();
        break;
      }
      case "apply": {
        if (role !== "candidate") throw new Error("Доступно только кандидату");
        if (!s.jobs.some((j) => j.id === b.id && publishedJob(j)))
          throw new Error("Вакансия не найдена");
        if (
          s.applications.some((a) => a.jobId === b.id && a.candidateId === p.id)
        )
          throw new Error("Отклик уже отправлен");
        if (b.shareContacts !== true)
          throw new Error(
            "Подтвердите передачу профиля и контактов выбранной компании",
          );
        const profileError = applicationProfileError(p);
        if (profileError) throw new Error(profileError);
        if (typeof b.message !== "string" || b.message.length > 2000)
          throw new Error("Сообщение должно быть не длиннее 2000 символов");
        const { resumeKey, avatarKey, ...candidate } = structuredClone(p);
        s.applications.push({
          id: crypto.randomUUID(),
          candidateId: p.id,
          candidate,
          message: b.message.trim(),
          jobId: b.id,
          status: "Отправлен",
          createdAt: new Date().toISOString(),
        });
        break;
      }
      case "application-status": {
        if (role !== "employer")
          throw new Error("Доступно только работодателю");
        const job = s.jobs.find((job) => job.id === b.jobId);
        if (!job || !ownsJob(job, s))
          throw new Error("Отклик недоступен этой компании");
        const application = s.applications.find(
          (a) => a.jobId === b.jobId && (a.id === b.id || (!a.id && !b.id)),
        );
        if (!application) throw new Error("Отклик не найден");
        if (!["Просмотрен", "Отклонён"].includes(b.status))
          throw new Error("Некорректный статус");
        application.status = b.status;
        application.updatedAt = new Date().toISOString();
        break;
      }
      case "saved": {
        if (role !== "employer")
          throw new Error("Доступно только работодателю");
        const id = Number(b.id);
        s.saved = s.saved.includes(id)
          ? s.saved.filter((x) => x !== id)
          : [...s.saved, id];
        break;
      }
      case "favorite-job": {
        if (role !== "candidate") throw new Error("Доступно только кандидату");
        if (!s.jobs.some((job) => job.id === b.id && job.status !== "draft"))
          throw new Error("Вакансия не найдена");
        if (typeof b.saved !== "boolean")
          throw new Error("Укажите состояние избранного");
        s.favoriteJobs = b.saved
          ? [...new Set([...s.favoriteJobs, b.id])]
          : s.favoriteJobs.filter((id) => id !== b.id);
        break;
      }
      case "professional-result":
        if (role !== "candidate") throw new Error("Доступно только кандидату");
        return Response.json(clientState(await loadPlatform(account), role));
      case "start":
      case "answer":
      case "finish":
        throw new Error("Используйте раздел профессиональной проверки навыков");
      case "task": {
        if (role !== "candidate") throw new Error("Доступно только кандидату");
        if (str(b.answer).length < 30)
          throw new Error("Опишите подход хотя бы в 30 символах");
        s.taskAnswer = str(b.answer);
        p.freshAt = new Date().toISOString();
        break;
      }
      default:
        throw new Error("Неизвестное действие");
    }
    await save(owner, s);
    let output = s;
    if (["profile", "profile-draft", "company"].includes(b.type)) {
      const freshAccount = await accountById(owner);
      if (!freshAccount) throw new Error("AUTH");
      output = await loadPlatform(freshAccount);
    } else if (["job", "job-status"].includes(b.type)) {
      output = await loadPlatform(account, {
        jobId: String(b.id || "").slice(0, 100),
      });
    }
    return Response.json(clientState(output, role));
  } catch (e) {
    if (e instanceof FspRegistryError)
      return Response.json({ error: e.message }, { status: e.status });
    return errorResponse(e);
  }
}
