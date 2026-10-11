import { build } from "esbuild";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
import { getDocumentProxy, extractTextItems } from "unpdf";
await mkdir("tmp/pdfs", { recursive: true });
await build({
  entryPoints: [
    "lib/profile-pdf.ts",
    "lib/personal-name.ts",
    "lib/resume-parser.ts",
    "lib/model.ts",
    "lib/location-catalogs.ts",
    "lib/profile-options.ts",
  ],
  bundle: true,
  platform: "node",
  format: "esm",
  outdir: "tmp/pdfs/modules",
  external: ["jspdf"],
});
const { parseResume, resumeLayoutText } =
  await import("../tmp/pdfs/modules/resume-parser.js");
const { initialState } = await import("../tmp/pdfs/modules/model.js");
const { splitPersonalName, withPersonalName, editPersonalName, greetingName } =
  await import("../tmp/pdfs/modules/personal-name.js");
const { createProfilePdf } = await import("../tmp/pdfs/modules/profile-pdf.js");
const { regionCatalog, countryCatalog } =
  await import("../tmp/pdfs/modules/location-catalogs.js");
assert.equal(greetingName({ name: "Борисов Игорь Олегович" }), "Игорь");
assert.equal(greetingName({ name: "Игорь Борисов" }), "Игорь");
assert.equal(greetingName({ name: "Борисов Игорь" }), "Игорь");
assert.equal(greetingName({ name: "Игорь Борисов Олегович" }), "Игорь");
assert.equal(
  editPersonalName({ name: "Борисов Игорь Олегович" }, "firstName", "Алексей")
    .name,
  "Борисов Алексей Олегович",
);
assert.equal(
  withPersonalName({
    name: "Борисов Игорь Олегович",
    firstName: "Алексей",
    lastName: "Крылов",
  }).firstName,
  "Игорь",
);
assert.equal(greetingName({ name: "Example Ambiguous" }), "");
assert(countryCatalog.some((x) => x.name === "Россия"));
assert(countryCatalog.length > 190);
assert(regionCatalog("Россия").some((x) => x.name === "Московская область"));
assert(regionCatalog("Россия").some((x) => x.name === "Москва"));
assert(regionCatalog("Казахстан").length > 10);
const {
  withWorkPreferences,
  editWorkPreference,
  splitLanguage,
  professionalDirections,
} = await import("../tmp/pdfs/modules/profile-options.js");
assert(professionalDirections.length >= 30);
let preferences = withWorkPreferences(initialState().profile);
preferences = editWorkPreference(preferences, "formats", ["Любой", "Удалённо"]);
assert.deepEqual(preferences.formats, ["Удалённо"]);
preferences = editWorkPreference(preferences, "formats", [
  "Удалённо",
  "Гибрид",
]);
assert.equal(preferences.format, "Удалённо · Гибрид");
assert.deepEqual(
  withWorkPreferences({ ...preferences, format: "Офис" }).formats,
  ["Офис"],
);
preferences = editWorkPreference(preferences, "employmentTypes", [
  "Полная занятость",
  "Проектная работа",
]);
assert.equal(preferences.employment, "Полная занятость · Проектная работа");
assert.deepEqual(splitLanguage("Английский — C1 — Продвинутый"), {
  language: "Английский",
  level: "C1 — Продвинутый",
});
const source = process.argv[2];
const doc = await getDocumentProxy(new Uint8Array(await readFile(source)));
const { items } = await extractTextItems(doc);
const parsed = parseResume(resumeLayoutText(items));
assert.equal(parsed.firstName, "Игорь");
assert.equal(parsed.lastName, "Борисов");
assert.equal(parsed.patronymic, "Олегович");
const current = JSON.parse(
  await readFile("tmp/pdfs/current-state.json", "utf8"),
);
const p = {
  ...initialState().profile,
  ...current.profile,
  ...parsed,
  workHistory: parsed.workHistory || [],
};
const assets = {
  regular: (await readFile("public/fonts/Manrope-Regular.ttf")).toString(
    "base64",
  ),
  bold: (await readFile("public/fonts/Manrope-Bold.ttf")).toString("base64"),
};
try {
  assets.photo = (await readFile("tmp/pdfs/portrait.png")).toString("base64");
  assets.logo = (await readFile("tmp/pdfs/logo.png")).toString("base64");
} catch {}
await mkdir("output/pdf", { recursive: true });
for (const template of ["accent", "minimal"]) {
  const pdf = await createProfilePdf(p, template, assets);
  await writeFile(
    `output/pdf/offerly-resume-readable-${template}.pdf`,
    Buffer.from(pdf.output("arraybuffer")),
  );
  const textDoc = await getDocumentProxy(
    new Uint8Array(pdf.output("arraybuffer")),
  );
  const { items: out } = await extractTextItems(textDoc);
  const txt = out
    .flat()
    .map((x) => x.str)
    .join(" ");
  for (const skill of parsed.skills)
    assert(txt.includes(skill), `Missing skill ${skill}`);
  assert(txt.includes("OmniSub"));
  assert(txt.includes("Финансовый"));
  assert(txt.includes("Дополнитель") || !p.notes);
  console.log(
    template,
    pdf.getNumberOfPages(),
    "pages;",
    parsed.skills.length,
    "skills preserved",
  );
  await textDoc.cleanup();
}
await writeFile("tmp/pdfs/profile-fixture.json", JSON.stringify(p));
await doc.cleanup();
// Exercise serialization without a database: new name fields must respect contact access.
await build({
  entryPoints: ["lib/store.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: "tmp/pdfs/modules/store.js",
  external: ["drizzle-orm"],
  plugins: [
    {
      name: "database-stubs",
      setup(b) {
        b.onResolve(
          { filter: /^(?:@\/db(?:\/schema)?|@\/app\/chatgpt-auth)$/ },
          (a) => ({ path: a.path, namespace: "stub" }),
        );
        b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
          contents:
            'export const workspaces={}; export function getDb(){throw Error("No database in unit check")} export function getChatGPTUser(){return null}',
        }));
      },
    },
  ],
});
const { clientState } = await import("../tmp/pdfs/modules/store.js");
const privacy = initialState();
privacy.profile = { ...p, visible: true, consent: true, grade: "Middle" };
privacy.candidates = [];
privacy.invitations = [];
privacy.applications = [];
let hidden = clientState(privacy, "employer");
assert.equal(hidden.candidates.length, 1);
for (const key of ["firstName", "lastName", "patronymic", "email", "phone"]) {
  assert.equal(hidden.profile[key], "");
  assert.equal(hidden.candidates[0][key], "");
}
privacy.jobs[0].employerOwned = true;
privacy.applications = [
  {
    id: "privacy-test",
    jobId: privacy.jobs[0].id,
    candidateId: p.id,
    candidate: {
      name: "Крылов Алексей Сергеевич",
      initials: "АК",
      email: "approved@example.test",
      phone: "",
    },
  },
];
const approved = clientState(privacy, "employer").candidates[0];
assert.equal(approved.firstName, "Алексей");
assert.equal(approved.lastName, "Крылов");
console.log(
  "PASS: HH name migration, structured name editing, countries/regions, résumé extraction and both PDF templates",
);
console.log(
  "PASS: structured name fields stay private and authorized applications use the saved identity",
);
