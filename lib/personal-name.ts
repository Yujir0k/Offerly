export type PersonalName = {
  firstName?: string;
  lastName?: string;
  patronymic?: string;
  name: string;
};
const commonNames = new Set(
  "игорь алексей александр андрей артем артём борис владимир владислав вячеслав георгий григорий данил даниил денис дмитрий евгений иван илья кирилл константин максим михаил никита николай олег павел петр пётр роман руслан сергей семен семён станислав степан тимофей федор фёдор юрий анна алина алёна алена анастасия валерия вера виктория дарья екатерина елена елизавета ирина ксения лариса любовь людмила мария марина надежда наталья ольга полина светлана софия татьяна юлия".split(
    " ",
  ),
);
export function splitPersonalName(name: string): PersonalName {
  const words = name.trim().split(/\s+/).filter(Boolean);
  // Russian patronymics identify the conventional surname / name / patronymic order.
  const surnameFirst =
    (words.length >= 3 &&
      /(?:вич|вна|ична|ич)$/i.test(words[2]) &&
      !(
        commonNames.has((words[0] || "").toLowerCase()) &&
        !commonNames.has((words[1] || "").toLowerCase())
      )) ||
    (!commonNames.has((words[0] || "").toLowerCase()) &&
      commonNames.has((words[1] || "").toLowerCase()));
  const firstName = surnameFirst
    ? words[1]
    : commonNames.has((words[0] || "").toLowerCase()) || words.length === 1
      ? words[0]
      : "";
  return {
    name: name.trim(),
    firstName: firstName || "",
    lastName: surnameFirst
      ? words[0]
      : firstName
        ? words[1] || ""
        : name.trim(),
    patronymic: firstName ? words.slice(2).join(" ") : "",
  };
}
export function fullPersonalName(p: PersonalName) {
  return [p.lastName, p.firstName, p.patronymic]
    .map((x) => (x || "").trim())
    .filter(Boolean)
    .join(" ");
}
export function withPersonalName<T extends PersonalName>(p: T): T {
  if (
    p.firstName !== undefined &&
    p.lastName !== undefined &&
    fullPersonalName(p) === p.name.trim()
  )
    return p;
  return { ...p, ...splitPersonalName(p.name) };
}
export function editPersonalName<T extends PersonalName>(
  p: T,
  key: string,
  value: unknown,
): T {
  const next = { ...withPersonalName(p), [key]: value };
  if (["firstName", "lastName", "patronymic"].includes(key))
    next.name = fullPersonalName(next);
  if (key === "name") return { ...next, ...splitPersonalName(String(value)) };
  return next;
}
export function greetingName(p: PersonalName) {
  return withPersonalName(p).firstName || "";
}
