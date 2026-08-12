import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = new URL("../public/training-app/program-data.json", import.meta.url);
const program = JSON.parse(await readFile(source, "utf8"));

assert.equal(program.schemaVersion, 1, "Unexpected program schema version");
assert.equal(program.weeks.length, 12, "Program must contain 12 weeks");
assert.equal(program.weeks.flatMap((week) => week.sessions).length, 72, "Program must contain 72 sessions");
assert.equal(program.weeks.flatMap((week) => week.sessions).flatMap((session) => session.exercises).length, 660, "Program must contain 660 exercise entries");
assert.equal(program.weeks[0].sessions[0].session, "Pull A", "Week 1, Day 1 must be Pull A");
assert.equal(program.weeks[0].sessions[1].session, "Legs A", "Week 1, Day 2 must be Legs A");
assert.equal(program.weeks[0].sessions[2].session, "Push A", "Week 1, Day 3 must be Push A");

const ids = [];
for (const [weekIndex, week] of program.weeks.entries()) {
  assert.equal(week.week, weekIndex + 1, `Week number mismatch at index ${weekIndex}`);
  assert.equal(week.sessions.length, 6, `Week ${week.week} must contain six sessions`);
  for (const [dayIndex, session] of week.sessions.entries()) {
    assert.equal(session.day, dayIndex + 1, `Week ${week.week} day number mismatch`);
    assert.ok(session.session && session.focus, `${session.id} needs a name and focus`);
    ids.push(session.id);
    for (const exercise of session.exercises) {
      ids.push(exercise.id);
      assert.ok(exercise.exercise && exercise.category && exercise.primaryMuscle, `${exercise.id} is missing required fields`);
      assert.ok(Number(exercise.plannedSets) > 0, `${exercise.id} needs at least one set`);
      assert.ok(Number(exercise.repHigh) >= Number(exercise.repLow), `${exercise.id} has an invalid rep range`);
    }
  }
}

assert.equal(new Set(ids).size, ids.length, "Session and exercise IDs must be unique");
assert.ok(program.settings.loadIncrement > 0, "Load increment must be positive");
assert.ok(program.settings.greenReadinessThreshold > program.settings.redReadinessThreshold, "Readiness thresholds are reversed");
assert.ok(program.settings.painThreshold >= 0 && program.settings.painThreshold <= 10, "Pain threshold must be between 0 and 10");

console.log("Program verified: 12 weeks, 72 sessions, 660 exercise entries, Pull A opens Week 1.");

