import assert from "node:assert/strict";
import { initialState, rank } from "../lib/model";
const s = initialState(),
  base = { ...s.profile, fsp: null, achievements: [] },
  linked = { ...base, fsp: "FSP-REAL-123" };
assert.equal(rank(base, s.needs[0]).score, rank(linked, s.needs[0]).score);
assert(rank(linked, s.needs[0]).reasons.some((r) => r.includes("Без истории")));
assert.equal(
  rank({ ...linked, achievements: ["Подтверждённое участие"] }, s.needs[0])
    .score,
  rank(base, s.needs[0]).score + 5,
);
console.log("FSP ID alone does not count as a competition achievement.");
