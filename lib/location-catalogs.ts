import russianAreas from "./data/hh-russian-areas.json";
import regions from "./data/countries-regions.json";
import { type Suggestion, normalizeSuggestion } from "./suggestion-catalogs";
const codes =
  "AF AL DZ AS AD AO AI AQ AG AR AM AW AU AT AZ BS BH BD BB BY BE BZ BJ BM BT BO BA BW BR BN BG BF BI CV KH CM CA KY CF TD CL CN CO KM CG CD CR CI HR CU CY CZ DK DJ DM DO EC EG SV GQ ER EE SZ ET FJ FI FR GA GM GE DE GH GR GL GD GU GT GN GW GY HT HN HK HU IS IN ID IR IQ IE IL IT JM JP JO KZ KE KI KP KR KW KG LA LV LB LS LR LY LI LT LU MG MW MY MV ML MT MH MR MU MX MD MC MN ME MA MZ MM NA NP NL NZ NI NE NG NO OM PK PW PA PG PY PE PH PL PT PR QA RO RU RW KN LC VC WS SM ST SA SN RS SC SL SG SK SI SB SO ZA ES LK SD SR SE CH SY TW TJ TZ TH TL TG TO TT TN TR TM TV UG UA AE GB US UY UZ VU VA VE VN YE ZM ZW".split(
    " ",
  );
const names = new Intl.DisplayNames(["ru"], { type: "region" });
export const countryCatalog: Suggestion[] = [
  { name: "Россия", group: "Страны", aliases: ["Russia", "RU"] },
  ...codes
    .filter((x) => x !== "RU")
    .map((code) => ({
      name: names.of(code) || code,
      group: "Страны",
      aliases: [code],
    })),
];
export function regionCatalog(country: string): Suggestion[] {
  const entry = regions.find(
    (x) =>
      normalizeSuggestion(x.name) === normalizeSuggestion(country || "Россия"),
  );
  if (normalizeSuggestion(country || "Россия") === "россия")
    return [
      ...new Set([
        "Москва",
        "Санкт-Петербург",
        ...russianAreas.map((row) => row[2]).filter(Boolean),
      ]),
    ]
      .sort((a, b) => a.localeCompare(b, "ru"))
      .map((name) => ({ name, group: "Россия" }));
  return (entry?.regions || []).map((x) => ({
    name: x.name,
    group: country || "Россия",
  }));
}
