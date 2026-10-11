import { randomBytes, scrypt } from "node:crypto";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Database } from "@/db";
import {
  initialState,
  type Profile,
  type CompanyProfile,
  type Job,
} from "./model";
import { assessmentTracks } from "./assessment-tracks";
import { demoEmployers } from "./vacancy-catalog";
import { withPersonalName } from "./personal-name";
import { bucket } from "./file-storage";
import { showcaseEnabled } from "./showcase-policy";
import { ensureConversation } from "./conversations";

const installs = new WeakMap<Database, Promise<void>>();
const stacks = [
  ["Python", "SQL", "FastAPI"],
  ["JavaScript", "TypeScript", "React"],
  ["Docker", "Kubernetes", "Terraform"],
  ["Python", "Pytest", "Playwright"],
  ["Python", "SQL", "Airflow"],
  ["Python", "PyTorch", "Docker"],
  ["Python", "SQL", "Pandas"],
  ["Python", "MLflow", "Kubernetes"],
  ["Python", "LLM", "RAG"],
  ["Kotlin", "Android", "Jetpack Compose"],
  ["Swift", "iOS", "SwiftUI"],
  ["Python", "Linux", "OWASP"],
];
const cities = [
  "Москва",
  "Санкт-Петербург",
  "Казань",
  "Новосибирск",
  "Екатеринбург",
];
const names = ["Алексей", "Мария", "Дмитрий", "Анна", "Илья", "Елена"];

async function install(db: Database) {
  const prefix = "offerly-showcase-v1",
    marker = prefix + "-backend-junior-1";
  if (
    (await db.query("SELECT id FROM users WHERE id=$1", [marker])).rows.length
  )
    return;
  const password =
    process.env.DEMO_ACCOUNT_PASSWORD ||
    (process.env.NODE_ENV !== "production" ? "Offerly-Demo-2026!" : "");
  if (password.length < 12 || password.length > 128)
    throw new Error(
      "Для демоданных задайте DEMO_ACCOUNT_PASSWORD (12–128 символов)",
    );
  const salt = randomBytes(16).toString("hex");
  const key = (await promisify(scrypt)(password, salt, 64)) as Buffer;
  const hash = `scrypt:${salt}:${key.toString("hex")}`;
  const portraits = await Promise.all(
    ["male", "female"].map((sex) =>
      readFile(
        path.join(process.cwd(), `public/portraits/developer-${sex}.webp`),
      ),
    ),
  );
  const employers = Object.values(demoEmployers);
  const base = initialState().profile;
  const now = new Date().toISOString();
  await db.transaction(async (tx) => {
    async function account(
      uid: string,
      name: string,
      role: "candidate" | "employer",
    ) {
      const email = uid + "@demo.offerly.test";
      await tx.query(
        "INSERT INTO users(id,email,name,scope,demo,password_hash,verified_at) VALUES($1,$2,$3,'public',false,$4,now()) ON CONFLICT(id) DO NOTHING",
        [uid, email, name, hash],
      );
      await tx.query(
        "INSERT INTO account_state(user_id,payload) VALUES($1,$2) ON CONFLICT(user_id) DO NOTHING",
        [
          uid,
          JSON.stringify({
            role,
            onboarded: true,
            notifications: true,
            journey: "complete",
          }),
        ],
      );
      return email;
    }
    async function profile(uid: string, p: Profile) {
      const result = await tx.query(
        "INSERT INTO candidate_profiles(user_id,payload,specialty,grade,visible,consent) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id) DO NOTHING RETURNING id",
        [uid, JSON.stringify(p), p.specialty, p.grade, p.visible, p.consent],
      );
      if (result.rows[0])
        await tx.query(
          "UPDATE candidate_profiles SET payload=$2 WHERE user_id=$1",
          [uid, JSON.stringify({ ...p, id: result.rows[0].id })],
        );
    }
    function person(name: string, email: string): Profile {
      return {
        ...base,
        ...withPersonalName({ name }),
        id: 0,
        initials: name[0] + "Д",
        email,
        phone: "",
        avatarKey: undefined,
        resumeKey: undefined,
        grade: null,
        claimed: "Junior",
        score: 0,
        verified: [],
        skills: [],
        roles: [],
        city: "",
        country: "Россия",
        region: "",
        preferredLocations: [],
        salaryMin: 0,
        salaryMax: 0,
        experience: 0,
        visible: false,
        consent: false,
        bio: "",
        fsp: null,
        achievements: [],
        fspHistory: null,
        workHistory: [],
        education: "",
        projects: "",
        links: [],
        notes: "",
        softSkills: [],
        languages: [],
        lastGradeChange: null,
        demonstration: true,
        jobStatus: "open",
      };
    }
    for (let t = 0; t < assessmentTracks.length; t++) {
      const track = assessmentTracks[t],
        source = employers[t % employers.length];
      const owner = prefix + "-company-" + track.id,
        cid = owner;
      const email = await account(
        owner,
        "Демо-команда " + track.name,
        "employer",
      );
      await profile(owner, person("Демо-команда " + track.name, email));
      const logoKey = `company-media/${owner}/logo.svg`;
      await bucket.put(
        logoKey,
        await readFile(path.join(process.cwd(), "public", source.logo)),
        { httpMetadata: { contentType: "image/svg+xml" } },
      );
      const company: CompanyProfile = {
        id: cid,
        name: source.name + " · демо",
        description:
          source.description +
          " Это вымышленная компания для демонстрации Офферли.",
        email,
        website: "",
        industry: source.industry,
        size: "11–50 человек",
        city: cities[t % cities.length],
        contactName: "Демо-команда " + track.name,
        tagline: "Демонстрационная компания",
        technologies: stacks[t],
        culture: "Удалённая команда, code review и поддержка наставника.",
        logoKey,
        media: [{ key: logoKey, kind: "logo", name: "Логотип демокомпании" }],
        demonstration: true,
      };
      await tx.query(
        "INSERT INTO companies(id,owner_id,scope,payload) VALUES($1,$2,'public',$3) ON CONFLICT(id) DO NOTHING",
        [cid, owner, JSON.stringify(company)],
      );
      await tx.query(
        "INSERT INTO company_memberships(company_id,user_id,role) VALUES($1,$2,'owner') ON CONFLICT DO NOTHING",
        [cid, owner],
      );
      for (let g = 0; g < 3; g++) {
        const grade = ["Junior", "Middle", "Senior"][g];
        for (let v = 0; v < 2; v++) {
          const uid = `${prefix}-${track.id}-${grade.toLowerCase()}-${v + 1}`,
            name = names[(t + g + v) % names.length] + " Демо";
          const pe = await account(uid, name, "candidate");
          const avatarKey = `avatars/${uid}/portrait.webp`;
          await bucket.put(avatarKey, portraits[(t + g + v) % 2], {
            httpMetadata: { contentType: "image/webp" },
          });
          const p: Profile = {
            ...person(name, pe),
            avatarKey,
            demoAvatar: `/portraits/developer-${(t + g + v) % 2 ? "female" : "male"}.webp`,
            headline: `${track.name} · ${grade}`,
            specialty: track.name,
            professionalDirection: track.name,
            grade,
            claimed: grade,
            skills: stacks[t],
            verified: v ? [] : stacks[t].slice(0, 2),
            score: 80 + g * 5 + v,
            roles: [track.name + "-специалист"],
            city: cities[(t + v) % cities.length],
            format: v ? "Гибрид" : "Удалённо",
            formats: [v ? "Гибрид" : "Удалённо"],
            experience: g * 3 + v,
            salaryMin: [95000, 180000, 300000][g] + v * 25000,
            salaryMax: [155000, 260000, 420000][g] + v * 25000,
            visible: true,
            consent: true,
            employment: "Полная занятость",
            employmentTypes: ["Полная занятость"],
            bio: `Демонстрационный профиль ${track.name}. Условная категория ${grade} используется для показа фильтров и подбора; это не результат реального испытания.`,
            phone: `+7999000${String(t * 6 + g * 2 + v).padStart(4, "0")}`,
            projects: "Учебный проект для демонстрации рабочих задач.",
            education: "Демонстрационная программа подготовки",
            industry: source.industry,
            ...(v === 0 && t % 3 === 0
              ? {
                  fsp: `FSP-DEMO-${t}-${g}`,
                  achievements: [
                    "Учебный командный турнир · демонстрационный пример",
                  ],
                  fspHistory: { source: "demo" as const, syncedAt: now },
                }
              : {}),
          };
          await profile(uid, p);
          const personalCompany = {
            id: uid + "-workspace",
            name: "",
            description: "",
            email: pe,
            website: "",
          };
          await tx.query(
            "INSERT INTO companies(id,owner_id,scope,payload) VALUES($1,$2,'public',$3) ON CONFLICT(id) DO NOTHING",
            [personalCompany.id, uid, JSON.stringify(personalCompany)],
          );
          await tx.query(
            "INSERT INTO company_memberships(company_id,user_id,role) VALUES($1,$2,'owner') ON CONFLICT DO NOTHING",
            [personalCompany.id, uid],
          );
        }
        for (let v = 0; v < 3; v++) {
          const min = [120000, 200000, 320000][g] + v * 25000;
          const job: Job = {
            id: `${prefix}-job-${track.id}-${g}-${v}`,
            companyId: cid,
            company: company.name,
            title: `${track.name} ${grade} — ${["сервисы продукта", "новое направление", "инженерная команда"][v]}`,
            specialty: track.name,
            grade,
            skills: stacks[t],
            description: `Демонстрационная вакансия. ${source.description} Задачи адаптированы для ${grade}.`,
            min,
            max: min + 70000,
            format: ["Удалённо", "Гибрид", "Офис"][v],
            city: company.city,
            industry: source.industry,
            employment: v === 2 ? "Частичная занятость" : "Полная занятость",
            experienceMin: g * 2,
            experienceMax: g * 3 + 2,
            status: "published",
            publishedAt: now,
            updatedAt: now,
            demo: true,
            logo: `/api/company-media?key=${encodeURIComponent(logoKey)}`,
            companyDescription: company.description,
            companySize: company.size,
            responsibilities: [
              `Работать с ${stacks[t].join(", ")}`,
              "Участвовать в code review и развитии продукта",
            ],
            requirements: [
              `${grade} в направлении ${track.name}`,
              `Знание ${stacks[t].slice(0, 2).join(" и ")}`,
            ],
            benefits: ["Наставник и развитие", "Гибкий график"],
          };
          await tx.query(
            "INSERT INTO jobs(id,company_id,status,specialty,grade,min_salary,max_salary,payload) VALUES($1,$2,'published',$3,$4,$5,$6,$7) ON CONFLICT(id) DO NOTHING",
            [job.id, cid, track.name, grade, min, job.max, JSON.stringify(job)],
          );
        }
      }
    }
  });
}

// Example interactions belong exclusively to fictional accounts. Never attach
// a fabricated acceptance, contact-sharing event or message to a real user.
async function installInteractions(db: Database) {
  await db.transaction(async (tx) => {
    for (const track of assessmentTracks) {
      const prefix = "offerly-showcase-v1";
      const companyId = `${prefix}-company-${track.id}`;
      const {
        rows: [company],
      } = await tx.query("SELECT payload FROM companies WHERE id=$1", [
        companyId,
      ]);
      if (!company?.payload.demonstration) continue;
      for (let g = 0; g < 3; g++) {
        const grade = ["Junior", "Middle", "Senior"][g];
        const userId = `${prefix}-${track.id}-${grade.toLowerCase()}-1`;
        const {
          rows: [candidate],
        } = await tx.query(
          "SELECT id,payload FROM candidate_profiles WHERE user_id=$1",
          [userId],
        );
        if (!candidate?.payload.demonstration) continue;
        const id = `${prefix}-example-invitation-${track.id}-${g}`;
        const status = ["accepted", "sent", "declined"][g];
        const createdAt = new Date(Date.now() - 86400000).toISOString();
        const invitation = {
          id,
          candidateId: candidate.id,
          companyId,
          company: company.payload.name,
          title: `${track.name} ${grade} — демонстрационный пример`,
          min: candidate.payload.salaryMin,
          max: candidate.payload.salaryMax,
          format: "Удалённо",
          city: company.payload.city,
          grade,
          skills: candidate.payload.skills,
          description:
            "Пример приглашения вымышленному кандидату для знакомства с интерфейсом.",
          contact: company.payload.email,
          status,
          createdAt,
          ...(status !== "sent"
            ? { respondedAt: createdAt, readAt: createdAt }
            : {}),
        };
        const inserted = await tx.query(
          "INSERT INTO invitations(id,company_id,candidate_id,status,min_salary,max_salary,payload) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO NOTHING RETURNING id",
          [
            id,
            companyId,
            candidate.id,
            status,
            invitation.min,
            invitation.max,
            JSON.stringify(invitation),
          ],
        );
        // An existing fixture may already have been changed during a demonstration.
        if (!inserted.rows.length || status !== "accepted") continue;
        const conversationId = await ensureConversation(
          tx,
          companyId,
          candidate.id,
        );
        if (!conversationId)
          throw new Error("Не удалось создать демонстрационный диалог");
        await tx.query(
          "INSERT INTO consent_events(id,user_id,version,purpose,granted,context) VALUES($1,$2,'demo-fixture-v1','contact-sharing',true,$3) ON CONFLICT(id) DO NOTHING",
          [
            id + "-consent",
            userId,
            JSON.stringify({ demonstration: true, invitationId: id }),
          ],
        );
        const count = track.id === "backend" ? 52 : 4;
        for (let m = 0; m < count; m++)
          await tx.query(
            "INSERT INTO conversation_messages(conversation_id,sender_id,client_id,body,created_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
            [
              conversationId,
              m % 2 ? userId : companyId,
              `showcase-${m}`,
              m === 0
                ? "Демонстрационный диалог: контакты вымышленных участников открыты после принятия приглашения."
                : `${m % 2 ? "Кандидат" : "Команда"}: ${["Обсудим задачи и формат работы.", "Спасибо! Буду рад познакомиться с командой.", "Можно уточнить технологии и роль наставника?", "Расскажем о проекте на первой встрече."][m % 4]} (пример ${m + 1})`,
              new Date(Date.now() - (count - m) * 60000).toISOString(),
            ],
          );
        const jobId = `${prefix}-job-${track.id}-0-0`;
        const applicationId = id + "-application";
        const {
          avatarKey: _avatar,
          resumeKey: _resume,
          ...publicCandidate
        } = candidate.payload;
        await tx.query(
          "INSERT INTO applications(id,job_id,candidate_id,status,payload) VALUES($1,$2,$3,'sent',$4) ON CONFLICT DO NOTHING",
          [
            applicationId,
            jobId,
            candidate.id,
            JSON.stringify({
              id: applicationId,
              jobId,
              candidateId: candidate.id,
              status: "Отправлен",
              candidate: publicCandidate,
              date: createdAt,
              createdAt,
              message: "Демонстрационный отклик вымышленного кандидата.",
            }),
          ],
        );
      }
    }
    // Repair only the first local revision of our explicitly marked fixtures.
    // Preserve statuses/messages changed by someone using the demonstration.
    const { rows: repairs } =
      await tx.query(`SELECT a.id,p.payload FROM applications a JOIN candidate_profiles p ON p.id=a.candidate_id
      WHERE a.id LIKE 'offerly-showcase-v1-example-invitation-%-application'
      AND coalesce((p.payload->>'demonstration')::boolean,false) AND NOT (a.payload ? 'candidate')`);
    for (const row of repairs) {
      const {
        avatarKey: _avatar,
        resumeKey: _resume,
        ...snapshot
      } = row.payload;
      await tx.query(
        "UPDATE applications SET payload=jsonb_set(payload,'{candidate}',$2::jsonb) WHERE id=$1",
        [row.id, JSON.stringify(snapshot)],
      );
    }
  });
}

export async function ensureShowcaseCatalog(db: Database, scope: string) {
  if (scope !== "public" || !showcaseEnabled()) return;
  let pending = installs.get(db);
  if (!pending) {
    pending = install(db)
      .then(() => installInteractions(db))
      .catch((e) => {
        installs.delete(db);
        throw e;
      });
    installs.set(db, pending);
  }
  await pending;
}
