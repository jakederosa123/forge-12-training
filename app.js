import { createSyncManager } from "./sync.js";

const STORAGE_KEY = "forge.training.state.v1";
const APP_ID = "hypertrophy-training-system";
const VIEWS = ["workout", "progress", "program", "editor", "settings"];
const LOAD_METRIC = /load|weight/i;

let defaults;
let state;
let saveTimer;
let toastTimer;
let syncManager;

const app = document.querySelector("#app");
const toast = document.querySelector("#toast");
const restoreFile = document.querySelector("#restore-file");

init().catch((error) => {
  console.error(error);
  app.className = "empty-state";
  app.innerHTML = `<strong>The training system could not load.</strong><p>${escapeHtml(error.message)}</p>`;
});

async function init() {
  const response = await fetch("program-data.json", { cache: "no-store" });
  if (!response.ok) throw new Error("program-data.json is missing or unavailable.");
  defaults = await response.json();
  state = loadState();
  normalizeState();
  syncManager = createSyncManager({
    getState: () => clone(state),
    replaceState: replaceStateFromCloud,
    requestRender: render,
    notify: showToast,
  });
  bindEvents();
  render();
  registerServiceWorker();
  syncManager.init();
}

function newState() {
  return {
    version: 1,
    program: clone(defaults),
    selectedWeek: 1,
    selectedDay: 1,
    activeView: "workout",
    readiness: {},
    logs: {},
    sessionNotes: {},
    sessionCompleted: {},
    loadSearch: "",
    lastSavedAt: null,
    syncTimes: { program: null, readiness: {}, logs: {}, notes: {}, completed: {} },
  };
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved?.version === 1 && saved?.program?.weeks?.length === 12) return saved;
  } catch (error) {
    console.warn("Saved training data could not be read.", error);
  }
  return newState();
}

function normalizeState() {
  state.program.settings = { ...clone(defaults.settings), ...(state.program.settings || {}) };
  state.program.settings.estimated1RMs = {
    ...clone(defaults.settings.estimated1RMs),
    ...(state.program.settings.estimated1RMs || {}),
  };
  state.program.settings.startingLoads = {
    ...clone(defaults.settings.startingLoads),
    ...(state.program.settings.startingLoads || {}),
  };
  state.logs ||= {};
  state.readiness ||= {};
  state.sessionNotes ||= {};
  state.sessionCompleted ||= {};
  state.syncTimes ||= {};
  state.syncTimes.program ||= null;
  state.syncTimes.readiness ||= {};
  state.syncTimes.logs ||= {};
  state.syncTimes.notes ||= {};
  state.syncTimes.completed ||= {};
  if (!VIEWS.includes(state.activeView)) state.activeView = "workout";
  state.selectedWeek = clamp(Number(state.selectedWeek) || 1, 1, 12);
  state.selectedDay = clamp(Number(state.selectedDay) || 1, 1, 6);
}

function bindEvents() {
  app.addEventListener("click", handleClick);
  app.addEventListener("input", handleInput);
  app.addEventListener("change", handleChange);
  restoreFile.addEventListener("change", restoreBackup);
  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY && event.newValue) {
      state = JSON.parse(event.newValue);
      normalizeState();
      render();
      showToast("Training data refreshed from another tab.");
    }
  });
}

function render() {
  const session = getSession();
  app.className = "app-shell";
  app.innerHTML = `
    <header class="topbar">
      <button class="brand" data-view="workout" aria-label="Open today's workout">
        <span class="brand-mark">F</span>
        <span class="brand-copy"><strong class="brand-name">FORGE 12</strong><span class="brand-subtitle">Autoregulated training system</span></span>
      </button>
      <nav class="primary-nav" aria-label="Main navigation">${navButtons()}</nav>
      ${syncManager ? syncManager.renderStatus() : `<span class="save-indicator"><span class="save-dot"></span>Local auto-save on</span>`}
    </header>
    <main class="page">${renderView(session)}</main>
    <nav class="mobile-nav" aria-label="Mobile navigation">${navButtons(true)}</nav>
  `;
}

function navButtons(mobile = false) {
  const labels = { workout: "Workout", progress: "Progress", program: "Program", editor: "Edit", settings: "Settings" };
  return VIEWS.map((view) => `<button class="nav-button ${state.activeView === view ? "active" : ""}" data-view="${view}">${mobile ? navIcon(view) : ""}${labels[view]}</button>`).join("");
}

function navIcon(view) {
  return { workout: "● ", progress: "↗ ", program: "▦ ", editor: "✎ ", settings: "⚙ " }[view];
}

function renderView(session) {
  if (state.activeView === "progress") return renderProgress();
  if (state.activeView === "program") return renderProgram();
  if (state.activeView === "editor") return renderEditor(session);
  if (state.activeView === "settings") return renderSettings();
  return renderWorkout(session);
}

function renderWorkout(session) {
  const week = state.program.weeks[state.selectedWeek - 1];
  const readiness = getReadiness(session.id);
  const readinessResult = calculateReadiness(readiness);
  const recommendations = buildRecommendations();
  const date = sessionDate(session.week, session.day);
  const completedCount = session.exercises.filter((exercise) => state.logs[exercise.id]?.completed).length;
  const performedSets = session.exercises.reduce((sum, exercise) => sum + countPerformedSets(state.logs[exercise.id]), 0);
  const tonnage = session.exercises.reduce((sum, exercise) => sum + exerciseTonnage(state.logs[exercise.id]), 0);

  return `
    <section class="page-heading">
      <div><span class="eyebrow">Week ${session.week} of 12</span><h1 class="display-title">Today's work.</h1><p class="lede">Log every set. The next recommendation responds to what you actually perform.</p></div>
      <div class="session-selector">
        <button class="icon-button" data-action="previous-session" aria-label="Previous session">←</button>
        <div class="selector-box"><label for="week-select">Week</label><select id="week-select" data-action="select-week">${optionRange(1, 12, session.week)}</select></div>
        <div class="selector-box"><label for="day-select">Day</label><select id="day-select" data-action="select-day">${optionRange(1, 6, session.day, "Day ")}</select></div>
        <button class="icon-button" data-action="next-session" aria-label="Next session">→</button>
      </div>
    </section>

    <section class="hero-grid">
      <article class="session-hero">
        <div class="hero-topline"><span class="phase-badge">${escapeHtml(week.block)}</span><span class="hero-date">${formatDate(date)}</span></div>
        <h2 class="session-title">${escapeHtml(session.session)}</h2>
        <p class="session-focus">${escapeHtml(session.focus)}</p>
        <div class="exercise-meta"><span>${session.exercises.length} movements</span><span>${escapeHtml(week.targetEffort)}</span><span>${escapeHtml(week.intensityMethods)}</span></div>
      </article>
      <article class="readiness-card">
        <span class="eyebrow">Readiness</span>
        <div class="readiness-score"><strong>${readinessResult.touched ? Math.round(readinessResult.percentage) : "--"}</strong><span>/ 100</span></div>
        <p class="readiness-action">${readinessResult.action}</p>
        <div class="modifier-bar"><span class="modifier-fill ${readinessResult.className}" style="width:${Math.max(6, readinessResult.modifier * 100)}%"></span></div>
        <p class="micro-copy">Working-set modifier: ${Math.round(readinessResult.modifier * 100)}%</p>
      </article>
    </section>

    <section class="metrics-grid" aria-label="Session metrics">
      ${metricCard("Completed", `${completedCount}/${session.exercises.length}`, "movements")}
      ${metricCard("Performed", performedSets, "sets logged")}
      ${metricCard("Volume", formatNumber(tonnage), state.program.settings.units)}
      ${metricCard("Block", week.week === 4 || week.week === 8 ? "Deload" : week.block, week.objective)}
    </section>

    ${renderReadinessPanel(session, readiness, readinessResult)}

    <section class="workout-heading"><div><span class="eyebrow">Session plan</span><h2>Work sets</h2><p>Open a movement to log sets, RIR, pain, and performance.</p></div><button class="button-ghost small" data-action="print">Print session</button></section>
    <section class="exercise-list">${session.exercises.map((exercise) => renderExercise(exercise, readinessResult, recommendations[exercise.id])).join("")}</section>

    <section class="session-footer panel">
      <div class="panel-header"><div><span class="eyebrow">Session notes</span><h2>Leave the signal for next time.</h2></div></div>
      <textarea data-action="session-notes" data-session="${session.id}" rows="4" placeholder="Technique notes, substitutions, recovery, or anything that should shape the next exposure...">${escapeHtml(state.sessionNotes[session.id] || "")}</textarea>
      <div class="button-row"><button class="button" data-action="complete-session" data-session="${session.id}">${state.sessionCompleted[session.id] ? "Session completed ✓" : "Mark session complete"}</button><button class="button-secondary" data-view="progress">View progress</button></div>
    </section>
  `;
}

function renderReadinessPanel(session, values, result) {
  const fields = [
    ["sleep", "Sleep", "1 poor, 5 excellent"], ["energy", "Energy", "1 depleted, 5 strong"],
    ["soreness", "Soreness", "1 low, 5 high"], ["stress", "Stress", "1 low, 5 high"],
    ["motivation", "Motivation", "1 low, 5 high"], ["pain", "Pain", "0 none, 10 severe"],
  ];
  return `
    <section class="panel">
      <div class="panel-header"><div><span class="eyebrow">Daily autoregulation</span><h2>Set today's readiness</h2><p>Use honest inputs. Pain at or above ${state.program.settings.painThreshold} switches the session to modification mode.</p></div></div>
      <div class="readiness-grid">${fields.map(([key, label, hint]) => {
        const config = state.program.readinessScale[key];
        return `<div class="range-field"><header><label for="${key}-range">${label}</label><span class="range-value">${values[key]}</span></header><input id="${key}-range" type="range" min="${config.min}" max="${config.max}" step="1" value="${values[key]}" data-action="readiness" data-session="${session.id}" data-field="${key}"><span class="micro-copy">${hint}</span></div>`;
      }).join("")}</div>
      <div class="readiness-summary ${result.className === "stop" ? "stop" : result.className === "warn" ? "warning" : ""}"><strong>${result.action}</strong><span>${result.guidance}</span></div>
    </section>
  `;
}

function renderExercise(exercise, readinessResult, recommendation) {
  const log = getExerciseLog(exercise);
  const setCount = setsToday(exercise, readinessResult.modifier);
  ensureSetRows(log, setCount);
  const completed = Boolean(log.completed);
  const modified = readinessResult.className === "stop";
  const status = progressionStatus(exercise, log, recommendation);
  const isLoad = usesLoad(exercise);
  const target = exercise.targetRIR == null ? "quality" : `${exercise.targetRIR} RIR`;
  const prescribedLoad = recommendation?.recommended || 0;
  return `
    <article class="exercise-card ${completed ? "completed" : ""} ${modified ? "modify" : ""}" data-exercise-card="${exercise.id}">
      <div class="exercise-summary">
        <span class="slot-number">${exercise.slot}</span>
        <div><div class="exercise-meta"><span class="tag ${slug(exercise.category)}">${escapeHtml(exercise.category)}</span>${exercise.pair ? `<span class="tag">Pair ${escapeHtml(exercise.pair)}</span>` : ""}<span>${escapeHtml(exercise.method)}</span></div><h3 class="exercise-name">${escapeHtml(exercise.exercise)}</h3><p class="meta-text">${escapeHtml(exercise.primaryMuscle)} · ${escapeHtml(exercise.pattern)}</p></div>
        <div class="exercise-prescription"><strong>${setCount} × ${exercise.repLow}${exercise.repHigh !== exercise.repLow ? `-${exercise.repHigh}` : ""}</strong><span>${target} · ${exercise.restSec}s rest</span></div>
        <div class="load-prescription"><span class="load-label">Recommended</span><strong class="load-number">${isLoad && prescribedLoad ? formatNumber(prescribedLoad) : "Track"}</strong><span>${isLoad && prescribedLoad ? state.program.settings.units : escapeHtml(exercise.metric)}</span></div>
        <button class="expand-button" data-action="toggle-exercise" data-exercise="${exercise.id}" aria-label="Open ${escapeHtml(exercise.exercise)}">⌄</button>
      </div>
      <div class="exercise-detail">
        <div class="coach-note"><strong>Execution</strong><span>${escapeHtml(exercise.cue)}</span><span>Tempo ${escapeHtml(exercise.tempo)} · ${escapeHtml(exercise.method)}</span></div>
        <div class="note-box"><strong>Substitutions</strong><span>${escapeHtml(exercise.substitute1)} or ${escapeHtml(exercise.substitute2)}</span></div>
        <div class="set-grid">${log.sets.slice(0, setCount).map((set, index) => renderSetRow(exercise, set, index, isLoad)).join("")}</div>
        <div class="exercise-feedback">
          <div class="field-compact"><label>Final RIR</label><input aria-label="Final RIR" inputmode="numeric" type="number" min="0" max="10" step="1" value="${valueAttr(log.finalRIR)}" data-action="exercise-log" data-exercise="${exercise.id}" data-field="finalRIR"></div>
          <div class="field-compact"><label>Pain 0-10</label><input aria-label="Pain 0-10" inputmode="numeric" type="number" min="0" max="10" step="1" value="${valueAttr(log.pain)}" data-action="exercise-log" data-exercise="${exercise.id}" data-field="pain"></div>
          <div class="field-compact"><label>${escapeHtml(exercise.metric)}</label><input aria-label="${escapeAttr(exercise.metric)} result" type="text" value="${valueAttr(log.metricResult)}" data-action="exercise-log" data-exercise="${exercise.id}" data-field="metricResult" placeholder="Result"></div>
          <label class="completion-toggle"><input type="checkbox" ${completed ? "checked" : ""} data-action="exercise-completed" data-exercise="${exercise.id}"><span>Movement complete</span></label>
        </div>
        <div class="result-strip"><span class="status-pill ${status.className}">${status.label}</span><span>${status.message}</span><strong>${recommendation?.next ? `Next: ${formatNumber(recommendation.next)} ${state.program.settings.units}` : "Log the work to create a next-load recommendation."}</strong></div>
      </div>
    </article>
  `;
}

function renderSetRow(exercise, set, index, isLoad) {
  return `<div class="set-row ${isLoad ? "" : "non-load"}">
    <span class="set-label">Set ${index + 1}</span>
    ${isLoad ? `<div class="field-compact"><label>Load</label><input aria-label="Set ${index + 1} load" inputmode="decimal" type="number" min="0" step="0.5" value="${valueAttr(set.load)}" data-action="set-log" data-exercise="${exercise.id}" data-set="${index}" data-field="load"></div>` : ""}
    <div class="field-compact"><label>${exercise.metric === "seconds" ? "Seconds" : "Reps"}</label><input aria-label="Set ${index + 1} ${exercise.metric === "seconds" ? "seconds" : "reps"}" inputmode="numeric" type="number" min="0" step="1" value="${valueAttr(set.reps)}" data-action="set-log" data-exercise="${exercise.id}" data-set="${index}" data-field="reps"></div>
    <label class="completion-toggle"><input type="checkbox" ${set.done ? "checked" : ""} data-action="set-done" data-exercise="${exercise.id}" data-set="${index}"><span>Done</span></label>
  </div>`;
}

function renderProgress() {
  const totals = progressTotals();
  const weeks = state.program.weeks.map((week) => {
    const completed = week.sessions.filter((session) => state.sessionCompleted[session.id]).length;
    return { week: week.week, completed, percent: (completed / 6) * 100, deload: week.week === 4 || week.week === 8 };
  });
  const maxSets = Math.max(1, ...totals.muscles.map((item) => item.sets));
  return `
    <section class="page-heading"><div><span class="eyebrow">Performance dashboard</span><h1 class="display-title">Progress that earns the next load.</h1><p class="lede">The dashboard reads only the work you log. Backup your data from Settings when you want a second copy.</p></div><button class="button-secondary" data-action="export-csv">Export CSV</button></section>
    <section class="metrics-grid">
      ${metricCard("Sessions", `${totals.completedSessions}/72`, `${Math.round(totals.completedSessions / 72 * 100)}% adherence`)}
      ${metricCard("Completed sets", formatNumber(totals.performedSets), "logged work sets")}
      ${metricCard("Tonnage", formatNumber(totals.tonnage), state.program.settings.units)}
      ${metricCard("Training days", totals.trainingDays, "days with logged work")}
    </section>
    <section class="progress-shell">
      <article class="panel"><div class="panel-header"><div><span class="eyebrow">12-week adherence</span><h2>Sessions completed</h2></div></div><div class="week-bars">${weeks.map((item) => `<div class="week-bar-wrap"><div class="week-bar ${item.deload ? "deload" : ""}" style="height:${Math.max(4, item.percent)}%" title="Week ${item.week}: ${item.completed} of 6"></div><span class="week-bar-value">${item.completed}</span><span class="week-bar-label">W${item.week}</span></div>`).join("")}</div></article>
      <article class="panel"><div class="panel-header"><div><span class="eyebrow">Volume distribution</span><h2>Sets by primary muscle</h2></div></div><div class="muscle-list">${totals.muscles.slice(0, 10).map((item) => `<div class="muscle-row"><header><span>${escapeHtml(item.muscle)}</span><strong>${item.sets}</strong></header><div class="mini-bar"><span style="width:${item.sets / maxSets * 100}%"></span></div></div>`).join("") || `<div class="empty-state"><strong>No completed sets yet.</strong><p>Log your first workout to start the volume view.</p></div>`}</div></article>
    </section>
    <section class="panel"><div class="panel-header"><div><span class="eyebrow">Strength signal</span><h2>Best estimated 1RM by movement</h2><p>Calculated with the Epley formula from completed loaded sets.</p></div></div>${totals.bestE1RM.length ? `<div class="load-table-wrap"><table class="data-table"><thead><tr><th>Movement</th><th>Best set</th><th>Estimated 1RM</th></tr></thead><tbody>${totals.bestE1RM.slice(0, 15).map((item) => `<tr><td>${escapeHtml(item.exercise)}</td><td>${formatNumber(item.load)} × ${item.reps}</td><td>${formatNumber(item.e1rm)} ${state.program.settings.units}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty-state"><strong>No loaded sets yet.</strong><p>Complete a set with load and reps to start this table.</p></div>`}</section>
  `;
}

function renderProgram() {
  return `
    <section class="page-heading"><div><span class="eyebrow">Full training plan</span><h1 class="display-title">Twelve weeks. Four clear phases.</h1><p class="lede">Accumulation builds the base, intensification raises output, realization sharpens it, then week 12 consolidates.</p></div></section>
    <section class="program-grid">${state.program.weeks.map((week) => {
      const complete = week.sessions.filter((session) => state.sessionCompleted[session.id]).length;
      return `<article class="week-card ${state.selectedWeek === week.week ? "current" : ""} ${week.week === 4 || week.week === 8 ? "deload" : ""}">
        <div class="week-card-header"><div><span class="week-number">Week ${week.week}</span><h3>${escapeHtml(week.block)}</h3><p>${escapeHtml(week.objective)}</p></div><span class="session-check">${complete}/6</span></div>
        <div class="exercise-meta"><span>${escapeHtml(week.targetEffort)}</span><span>${escapeHtml(week.intensityMethods)}</span></div>
        <div class="session-list">${week.sessions.map((session) => `<button class="session-link" data-action="open-session" data-week="${week.week}" data-day="${session.day}"><span class="day-box">D${session.day}</span><span><strong>${escapeHtml(session.session)}</strong><small>${escapeHtml(session.focus)}</small></span><span class="session-check">${state.sessionCompleted[session.id] ? "✓" : ""}</span></button>`).join("")}</div>
      </article>`;
    }).join("")}</section>
  `;
}

function renderEditor(session) {
  return `
    <section class="page-heading"><div><span class="eyebrow">Program editor</span><h1 class="display-title">Make the plan yours.</h1><p class="lede">Changes save locally and remain separate from the included source program until you reset them.</p></div></section>
    <div class="editor-toolbar">
      <div class="session-selector"><div class="selector-box"><label>Week</label><select aria-label="Editor week" data-action="select-week">${optionRange(1, 12, session.week)}</select></div><div class="selector-box"><label>Day</label><select aria-label="Editor day" data-action="select-day">${optionRange(1, 6, session.day, "Day ")}</select></div></div>
      <div class="button-row"><button class="button-secondary small" data-action="add-exercise">Add movement</button><button class="button-danger small" data-action="reset-session">Reset this session</button></div>
    </div>
    <section class="panel"><div class="editor-fields"><div class="field"><label>Session name</label><input aria-label="Session name" value="${valueAttr(session.session)}" data-action="edit-session" data-field="session"></div><div class="field wide"><label>Session focus</label><input aria-label="Session focus" value="${valueAttr(session.focus)}" data-action="edit-session" data-field="focus"></div></div></section>
    <section class="editor-list">${session.exercises.map((exercise, index) => renderEditorCard(exercise, index, session.exercises.length)).join("")}</section>
  `;
}

function renderEditorCard(exercise, index, length) {
  const fields = [
    ["exercise", "Movement", "text"], ["category", "Category", "text"], ["primaryMuscle", "Primary muscle", "text"], ["pattern", "Pattern", "text"],
    ["method", "Method", "text"], ["pair", "Pair", "text"], ["plannedSets", "Sets", "number"], ["repLow", "Rep low", "number"],
    ["repHigh", "Rep high", "number"], ["targetRIR", "Target RIR", "number"], ["restSec", "Rest seconds", "number"], ["tempo", "Tempo", "text"],
    ["loadFactor", "Load factor", "number"], ["percent1RM", "% 1RM decimal", "number"], ["metric", "Metric", "text"], ["substitute1", "Substitute 1", "text"],
    ["substitute2", "Substitute 2", "text"], ["cue", "Coaching cue", "text"],
  ];
  return `<article class="editor-card"><div class="editor-card-header"><span class="editor-index">${index + 1}</span><div><strong>${escapeHtml(exercise.exercise)}</strong><span class="meta-text">${escapeHtml(exercise.category)} · ${escapeHtml(exercise.primaryMuscle)}</span></div><div class="editor-actions"><button data-action="move-exercise" data-exercise="${exercise.id}" data-direction="up" ${index === 0 ? "disabled" : ""} aria-label="Move up">↑</button><button data-action="move-exercise" data-exercise="${exercise.id}" data-direction="down" ${index === length - 1 ? "disabled" : ""} aria-label="Move down">↓</button><button data-action="remove-exercise" data-exercise="${exercise.id}" aria-label="Remove movement">×</button></div></div><div class="editor-fields">${fields.map(([field, label, type]) => `<div class="field ${field === "cue" ? "wide" : ""}"><label>${label}</label><input aria-label="${escapeAttr(label)}" type="${type}" ${type === "number" ? "step=\"any\"" : ""} value="${valueAttr(exercise[field])}" data-action="edit-exercise" data-exercise="${exercise.id}" data-field="${field}"></div>`).join("")}</div></article>`;
}

function renderSettings() {
  const settings = state.program.settings;
  const query = state.loadSearch.toLowerCase();
  const loads = Object.entries(settings.startingLoads).filter(([name]) => name.toLowerCase().includes(query));
  const rmFields = [["benchPress", "Bench press"], ["backSquat", "Back squat"], ["conventionalDeadlift", "Conventional deadlift"], ["overheadPress", "Overhead press"]];
  const numberFields = [["loadIncrement", "Load rounding increment"], ["progressionStep", "Progression decimal"], ["regressionStep", "Regression decimal"], ["greenReadinessThreshold", "Green threshold"], ["redReadinessThreshold", "Red threshold"], ["painThreshold", "Pain stop threshold"]];
  return `
    <section class="page-heading"><div><span class="eyebrow">System settings</span><h1 class="display-title">Your loads. Your data.</h1><p class="lede">Every entry saves in this browser first. Sign in below to keep your laptop and iPhone synchronized.</p></div></section>
    ${syncManager ? syncManager.renderPanel() : ""}
    <section class="settings-grid">
      <article class="panel settings-section"><div class="panel-header"><div><span class="eyebrow">Calendar and units</span><h2>Program setup</h2></div></div><div class="editor-fields"><div class="field"><label>Week 1 start date</label><input aria-label="Week 1 start date" type="date" value="${valueAttr(settings.startDate)}" data-action="setting" data-field="startDate"></div><div class="field"><label>Units</label><select aria-label="Units" data-action="setting" data-field="units"><option value="lb" ${settings.units === "lb" ? "selected" : ""}>lb</option><option value="kg" ${settings.units === "kg" ? "selected" : ""}>kg</option></select></div>${numberFields.map(([field, label]) => `<div class="field"><label>${label}</label><input aria-label="${escapeAttr(label)}" type="number" step="any" value="${valueAttr(settings[field])}" data-action="setting" data-field="${field}"></div>`).join("")}</div></article>
      <article class="panel settings-section"><div class="panel-header"><div><span class="eyebrow">Primary lifts</span><h2>Estimated 1RMs</h2><p>Used when a programmed movement includes a percentage prescription.</p></div></div><div class="editor-fields">${rmFields.map(([field, label]) => `<div class="field"><label>${label} (${settings.units})</label><input aria-label="${escapeAttr(label)} estimated 1RM" type="number" min="0" step="0.5" value="${valueAttr(settings.estimated1RMs[field])}" data-action="one-rm" data-field="${field}"></div>`).join("")}</div></article>
    </section>
    <section class="panel"><div class="panel-header"><div><span class="eyebrow">First-exposure recommendations</span><h2>Starting loads</h2><p>Enter a baseline for any movement. Later recommendations use your logged performance.</p></div></div><input aria-label="Search starting loads" class="search-field" type="search" placeholder="Search movements..." value="${valueAttr(state.loadSearch)}" data-action="load-search"><div class="load-table-wrap"><table class="data-table"><thead><tr><th>Movement</th><th>Starting load (${settings.units})</th></tr></thead><tbody>${loads.map(([name, load]) => `<tr><td>${escapeHtml(name)}</td><td><input aria-label="${escapeAttr(name)} starting load" class="load-input" type="number" min="0" step="0.5" value="${valueAttr(load)}" data-action="starting-load" data-exercise-name="${escapeAttr(name)}"></td></tr>`).join("")}</tbody></table></div></section>
    <section class="data-actions">
      <article class="action-card"><h3>Backup all data</h3><p>Download one JSON file containing your plan edits, settings, and workout history.</p><button class="button" data-action="backup">Download backup</button></article>
      <article class="action-card"><h3>Restore a backup</h3><p>Load a backup created by this training system. It replaces the data in this browser.</p><button class="button-secondary" data-action="restore">Choose backup</button></article>
      <article class="action-card"><h3>Export workout log</h3><p>Download completed and in-progress set records as a CSV spreadsheet.</p><button class="button-secondary" data-action="export-csv">Export CSV</button></article>
      <article class="action-card"><h3>Reset local data</h3><p>Erase workout history and edits on this browser, then restore the included 12-week plan.</p><button class="button-danger" data-action="reset-all">Reset everything</button></article>
    </section>
    <div class="storage-notice"><strong>Local storage and backup</strong><span>Every entry saves on this device first. Cloud sync copies it to your signed-in account when internet is available. Keep an occasional backup file as an extra safeguard.</span></div>
    <section class="guardrail"><span class="eyebrow">Training guardrails</span><ul class="guardrail-list">${state.program.guardrails.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></section>
  `;
}

function handleClick(event) {
  const target = event.target.closest("button, [data-action]");
  if (!target) return;
  if (target.dataset.view) {
    state.activeView = target.dataset.view;
    scheduleSave();
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }
  const action = target.dataset.action;
  if (!action) return;
  if (action.startsWith("sync-")) {
    syncManager?.handleAction(action, target);
    return;
  }
  if (action === "previous-session" || action === "next-session") moveSession(action === "next-session" ? 1 : -1);
  if (action === "toggle-exercise") target.closest(".exercise-card")?.classList.toggle("open");
  if (action === "print") window.print();
  if (action === "open-session") openSession(Number(target.dataset.week), Number(target.dataset.day));
  if (action === "complete-session") toggleSessionComplete(target.dataset.session);
  if (action === "add-exercise") addExercise();
  if (action === "remove-exercise") removeExercise(target.dataset.exercise);
  if (action === "move-exercise") moveExercise(target.dataset.exercise, target.dataset.direction);
  if (action === "reset-session") resetSession();
  if (action === "backup") downloadBackup();
  if (action === "restore") restoreFile.click();
  if (action === "export-csv") exportCSV();
  if (action === "reset-all") resetAll();
}

function handleInput(event) {
  const target = event.target;
  const action = target.dataset.action;
  if (!action) return;
  if (action === "readiness") {
    const values = getReadiness(target.dataset.session);
    values[target.dataset.field] = Number(target.value);
    values.touched = true;
    markDataChange("readiness", target.dataset.session);
    scheduleSave();
    renderPreservingScroll();
  } else if (action === "set-log") {
    const exercise = findExercise(target.dataset.exercise);
    const log = getExerciseLog(exercise);
    ensureSetRows(log, Number(target.dataset.set) + 1);
    log.sets[Number(target.dataset.set)][target.dataset.field] = nullableNumber(target.value);
    markDataChange("logs", target.dataset.exercise);
    scheduleSave();
  } else if (action === "exercise-log") {
    const exercise = findExercise(target.dataset.exercise);
    const log = getExerciseLog(exercise);
    log[target.dataset.field] = target.dataset.field === "metricResult" ? target.value : nullableNumber(target.value);
    markDataChange("logs", target.dataset.exercise);
    scheduleSave();
  } else if (action === "session-notes") {
    state.sessionNotes[target.dataset.session] = target.value;
    markDataChange("notes", target.dataset.session);
    scheduleSave();
  } else if (action === "edit-session") {
    getSession()[target.dataset.field] = target.value;
    markDataChange("program");
    scheduleSave();
  } else if (action === "edit-exercise") {
    const exercise = findExercise(target.dataset.exercise);
    const numeric = ["plannedSets", "repLow", "repHigh", "targetRIR", "restSec", "loadFactor", "percent1RM"].includes(target.dataset.field);
    exercise[target.dataset.field] = numeric ? nullableNumber(target.value) : target.value;
    markDataChange("program");
    scheduleSave();
  } else if (action === "setting") {
    state.program.settings[target.dataset.field] = target.type === "number" ? nullableNumber(target.value) : target.value;
    markDataChange("program");
    scheduleSave();
  } else if (action === "one-rm") {
    state.program.settings.estimated1RMs[target.dataset.field] = nullableNumber(target.value) || 0;
    markDataChange("program");
    scheduleSave();
  } else if (action === "starting-load") {
    state.program.settings.startingLoads[target.dataset.exerciseName] = nullableNumber(target.value) || 0;
    markDataChange("program");
    scheduleSave();
  } else if (action === "load-search") {
    state.loadSearch = target.value;
    scheduleSave();
    renderPreservingScroll();
    requestAnimationFrame(() => {
      const search = document.querySelector('[data-action="load-search"]');
      search?.focus();
      search?.setSelectionRange(search.value.length, search.value.length);
    });
  }
}

function handleChange(event) {
  const target = event.target;
  const action = target.dataset.action;
  if (action === "select-week") {
    state.selectedWeek = Number(target.value);
    scheduleSave();
    render();
  } else if (action === "select-day") {
    state.selectedDay = Number(target.value);
    scheduleSave();
    render();
  } else if (action === "set-done") {
    const exercise = findExercise(target.dataset.exercise);
    const log = getExerciseLog(exercise);
    ensureSetRows(log, Number(target.dataset.set) + 1);
    log.sets[Number(target.dataset.set)].done = target.checked;
    markDataChange("logs", target.dataset.exercise);
    scheduleSave();
    renderPreservingScroll();
  } else if (action === "exercise-completed") {
    const exercise = findExercise(target.dataset.exercise);
    getExerciseLog(exercise).completed = target.checked;
    markDataChange("logs", target.dataset.exercise);
    scheduleSave();
    renderPreservingScroll();
  } else if (["setting", "one-rm", "starting-load"].includes(action)) {
    handleInput(event);
    renderPreservingScroll();
  }
}

function moveSession(offset) {
  const index = (state.selectedWeek - 1) * 6 + (state.selectedDay - 1) + offset;
  const wrapped = (index + 72) % 72;
  state.selectedWeek = Math.floor(wrapped / 6) + 1;
  state.selectedDay = (wrapped % 6) + 1;
  scheduleSave();
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function openSession(week, day) {
  state.selectedWeek = week;
  state.selectedDay = day;
  state.activeView = "workout";
  scheduleSave();
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function toggleSessionComplete(sessionId) {
  state.sessionCompleted[sessionId] = !state.sessionCompleted[sessionId];
  markDataChange("completed", sessionId);
  scheduleSave(true);
  renderPreservingScroll();
}

function addExercise() {
  const session = getSession();
  const stamp = Date.now().toString(36);
  session.exercises.push({ id: `${session.id}custom${stamp}`, slot: session.exercises.length + 1, exercise: "New Movement", category: "Hypertrophy", primaryMuscle: "Other", pattern: "Custom", method: "Straight sets", pair: "", plannedSets: 3, repLow: 8, repHigh: 12, targetRIR: 2, restSec: 90, tempo: "Controlled", loadFactor: 1, percent1RM: 0, metric: "load × reps", substitute1: "Pain-free equivalent", substitute2: "Machine or cable equivalent", cue: "Use controlled, repeatable technique" });
  markDataChange("program");
  scheduleSave(true);
  renderPreservingScroll();
}

function removeExercise(id) {
  const session = getSession();
  const exercise = session.exercises.find((item) => item.id === id);
  if (!exercise || !window.confirm(`Remove ${exercise.exercise} from this session?`)) return;
  session.exercises = session.exercises.filter((item) => item.id !== id);
  resequence(session);
  markDataChange("program");
  scheduleSave(true);
  renderPreservingScroll();
}

function moveExercise(id, direction) {
  const session = getSession();
  const index = session.exercises.findIndex((item) => item.id === id);
  const next = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || next < 0 || next >= session.exercises.length) return;
  [session.exercises[index], session.exercises[next]] = [session.exercises[next], session.exercises[index]];
  resequence(session);
  markDataChange("program");
  scheduleSave(true);
  renderPreservingScroll();
}

function resetSession() {
  const session = getSession();
  if (!window.confirm(`Reset Week ${session.week}, Day ${session.day} to the included program?`)) return;
  const original = defaults.weeks[session.week - 1].sessions[session.day - 1];
  state.program.weeks[session.week - 1].sessions[session.day - 1] = clone(original);
  markDataChange("program");
  scheduleSave(true);
  renderPreservingScroll();
}

function resetAll() {
  if (!window.confirm("Erase all local workout history, settings, and program edits? Download a backup first if you want to keep them.")) return;
  localStorage.removeItem(STORAGE_KEY);
  state = newState();
  saveNow();
  render();
  showToast("The included program has been restored.");
}

function resequence(session) {
  session.exercises.forEach((exercise, index) => { exercise.slot = index + 1; });
}

function getSession() {
  return state.program.weeks[state.selectedWeek - 1].sessions[state.selectedDay - 1];
}

function findExercise(id) {
  for (const week of state.program.weeks) for (const session of week.sessions) {
    const found = session.exercises.find((exercise) => exercise.id === id);
    if (found) return found;
  }
  return null;
}

function getReadiness(sessionId) {
  state.readiness[sessionId] ||= { sleep: 3, energy: 3, soreness: 3, stress: 3, motivation: 3, pain: 0, touched: false };
  return state.readiness[sessionId];
}

function calculateReadiness(values) {
  const settings = state.program.settings;
  const score = values.sleep + values.energy + (6 - values.soreness) + (6 - values.stress) + values.motivation;
  const percentage = clamp((score / 25) * 100 - values.pain * 4, 0, 100);
  if (!values.touched) return { percentage, modifier: 1, className: "", touched: false, action: "Enter readiness", guidance: "Move each slider once before training so today's volume and load guidance can respond." };
  if (values.pain >= settings.painThreshold) return { percentage, modifier: 0.6, className: "stop", touched: true, action: "Stop or substitute painful work", guidance: "Use pain-free substitutions, reduce load, and stop any sharp, radiating, or escalating pain." };
  if (percentage >= settings.greenReadinessThreshold) return { percentage, modifier: 1, className: "", touched: true, action: "Run session as written", guidance: "Keep the planned work and respect the assigned RIR. Do not turn green readiness into extra failure work." };
  if (percentage >= settings.redReadinessThreshold) return { percentage, modifier: 0.85, className: "warn", touched: true, action: "Moderate reduction: leave 3+ RIR", guidance: "Reduce working sets, keep technique crisp, and avoid unplanned intensity methods." };
  return { percentage, modifier: 0.7, className: "stop", touched: true, action: "Recovery mode: reduce sets and skip intensity techniques", guidance: "Keep only useful, pain-free work. Cut intensity techniques and end power work if quality drops." };
}

function getExerciseLog(exercise) {
  state.logs[exercise.id] ||= { sets: [], finalRIR: null, pain: 0, metricResult: "", completed: false };
  return state.logs[exercise.id];
}

function ensureSetRows(log, count) {
  while (log.sets.length < count) log.sets.push({ load: null, reps: null, done: false });
}

function setsToday(exercise, modifier) {
  if (exercise.category === "Mobility") return exercise.plannedSets;
  return Math.max(1, Math.round(exercise.plannedSets * modifier));
}

function usesLoad(exercise) {
  return LOAD_METRIC.test(exercise.metric) || exercise.percent1RM > 0 || (state.program.settings.startingLoads[exercise.exercise] || 0) > 0;
}

function buildRecommendations() {
  const result = {};
  const lastByExercise = {};
  for (const week of state.program.weeks) for (const session of week.sessions) for (const exercise of session.exercises) {
    if (!usesLoad(exercise)) {
      result[exercise.id] = { recommended: 0, next: 0 };
      continue;
    }
    const previous = lastByExercise[exercise.exercise];
    const baseline = previous?.next || previous?.recommended || firstLoad(exercise);
    const recommended = roundLoad(baseline * (exercise.loadFactor || 1));
    const log = state.logs[exercise.id];
    let next = 0;
    if (log?.completed || countPerformedSets(log) > 0) {
      const performedLoads = (log.sets || []).filter((set) => set.done && Number(set.load) > 0).map((set) => Number(set.load));
      const maxLoad = performedLoads.length ? Math.max(...performedLoads) : recommended;
      const adjustment = progressionAdjustment(exercise, log);
      next = roundLoad(maxLoad * (1 + adjustment));
    }
    result[exercise.id] = { recommended, next };
    lastByExercise[exercise.exercise] = { recommended, next };
  }
  return result;
}

function firstLoad(exercise) {
  const settings = state.program.settings;
  const starting = Number(settings.startingLoads[exercise.exercise]) || 0;
  if (starting) return starting;
  if (!exercise.percent1RM) return 0;
  const key = oneRMKey(exercise.exercise);
  return key ? (Number(settings.estimated1RMs[key]) || 0) * exercise.percent1RM : 0;
}

function oneRMKey(name) {
  if (/bench/i.test(name) && !/overhead/i.test(name)) return "benchPress";
  if (/squat/i.test(name)) return "backSquat";
  if (/deadlift|romanian/i.test(name)) return "conventionalDeadlift";
  if (/overhead press|push press/i.test(name)) return "overheadPress";
  return null;
}

function progressionAdjustment(exercise, log) {
  const settings = state.program.settings;
  if ((Number(log.pain) || 0) >= settings.painThreshold) return -2 * settings.regressionStep;
  const completedSets = (log.sets || []).filter((set) => set.done && Number(set.reps) > 0);
  if (!completedSets.length || log.finalRIR == null || exercise.targetRIR == null) return 0;
  const lowestReps = Math.min(...completedSets.map((set) => Number(set.reps)));
  const reachedTop = completedSets.every((set) => Number(set.reps) >= exercise.repHigh);
  if (reachedTop && Number(log.finalRIR) >= exercise.targetRIR + 1) return settings.progressionStep;
  if (lowestReps < exercise.repLow || Number(log.finalRIR) < exercise.targetRIR - 1) return -settings.regressionStep;
  return 0;
}

function progressionStatus(exercise, log, recommendation) {
  if (!log || (!log.completed && countPerformedSets(log) === 0)) return { label: "Awaiting log", className: "hold", message: "Complete your work sets, then enter final RIR and pain." };
  if ((Number(log.pain) || 0) >= state.program.settings.painThreshold) return { label: "Modify", className: "modify", message: "Pain threshold reached. Reduce load and use a pain-free substitute." };
  if (!recommendation?.next) return { label: "Logged", className: "complete", message: "Performance recorded. Add load and reps for a load recommendation." };
  const difference = recommendation.next - recommendation.recommended;
  if (difference > 0) return { label: "Progress", className: "progress", message: "Top reps and RIR support a small load increase." };
  if (difference < 0) return { label: "Regress", className: "regress", message: "Reps, RIR, or pain support a load reduction." };
  return { label: "Hold", className: "hold", message: "Repeat this load and improve execution or reps." };
}

function progressTotals() {
  let performedSets = 0;
  let tonnage = 0;
  const muscles = {};
  const e1rms = {};
  const trainingDays = new Set();
  for (const week of state.program.weeks) for (const session of week.sessions) for (const exercise of session.exercises) {
    const log = state.logs[exercise.id];
    if (!log) continue;
    const completed = (log.sets || []).filter((set) => set.done);
    if (completed.length) trainingDays.add(session.id);
    performedSets += completed.length;
    muscles[exercise.primaryMuscle] = (muscles[exercise.primaryMuscle] || 0) + completed.length;
    for (const set of completed) {
      const load = Number(set.load) || 0;
      const reps = Number(set.reps) || 0;
      tonnage += load * reps;
      if (load && reps) {
        const e1rm = load * (1 + reps / 30);
        if (!e1rms[exercise.exercise] || e1rm > e1rms[exercise.exercise].e1rm) e1rms[exercise.exercise] = { exercise: exercise.exercise, load, reps, e1rm };
      }
    }
  }
  return {
    completedSessions: Object.values(state.sessionCompleted).filter(Boolean).length,
    performedSets, tonnage, trainingDays: trainingDays.size,
    muscles: Object.entries(muscles).map(([muscle, sets]) => ({ muscle, sets })).sort((a, b) => b.sets - a.sets),
    bestE1RM: Object.values(e1rms).sort((a, b) => b.e1rm - a.e1rm),
  };
}

function countPerformedSets(log) {
  return (log?.sets || []).filter((set) => set.done).length;
}

function exerciseTonnage(log) {
  return (log?.sets || []).filter((set) => set.done).reduce((sum, set) => sum + (Number(set.load) || 0) * (Number(set.reps) || 0), 0);
}

function sessionDate(week, day) {
  const date = new Date(`${state.program.settings.startDate}T12:00:00`);
  date.setDate(date.getDate() + (week - 1) * 7 + (day - 1));
  return date;
}

function scheduleSave(immediate = false) {
  clearTimeout(saveTimer);
  if (immediate) saveNow();
  else saveTimer = setTimeout(saveNow, 350);
}

function saveNow() {
  state.lastSavedAt = new Date().toISOString();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    syncManager?.localChanged();
  } catch (error) {
    console.error(error);
    showToast("Browser storage is full. Download a backup now.");
  }
}

function markDataChange(section, id = null) {
  const timestamp = new Date().toISOString();
  if (section === "program") state.syncTimes.program = timestamp;
  else state.syncTimes[section][id] = timestamp;
}

function replaceStateFromCloud(nextState) {
  state = nextState;
  normalizeState();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  render();
}

function downloadBackup() {
  saveNow();
  downloadFile(`forge-12-backup-${todayStamp()}.json`, JSON.stringify({ app: APP_ID, schemaVersion: 1, exportedAt: new Date().toISOString(), state }, null, 2), "application/json");
  showToast("Backup downloaded.");
}

async function restoreBackup() {
  const file = restoreFile.files?.[0];
  restoreFile.value = "";
  if (!file) return;
  try {
    const backup = JSON.parse(await file.text());
    if (backup.app !== APP_ID || backup.schemaVersion !== 1 || backup.state?.program?.weeks?.length !== 12) throw new Error("This file is not a valid Forge 12 backup.");
    if (!window.confirm("Restore this backup and replace the current browser data?")) return;
    state = backup.state;
    normalizeState();
    saveNow();
    render();
    showToast("Backup restored.");
  } catch (error) {
    showToast(error.message || "Backup could not be restored.");
  }
}

function exportCSV() {
  const recommendations = buildRecommendations();
  const rows = [["week", "day", "date", "session", "exercise", "category", "set", "load", "reps", "set_complete", "final_rir", "pain", "metric_result", "movement_complete", "recommended_load", "next_load", "notes"]];
  for (const week of state.program.weeks) for (const session of week.sessions) for (const exercise of session.exercises) {
    const log = state.logs[exercise.id];
    if (!log) continue;
    const sets = log.sets?.length ? log.sets : [{ load: "", reps: "", done: false }];
    sets.forEach((set, index) => rows.push([week.week, session.day, isoDate(sessionDate(week.week, session.day)), session.session, exercise.exercise, exercise.category, index + 1, set.load ?? "", set.reps ?? "", set.done ? "yes" : "no", log.finalRIR ?? "", log.pain ?? "", log.metricResult ?? "", log.completed ? "yes" : "no", recommendations[exercise.id]?.recommended || "", recommendations[exercise.id]?.next || "", state.sessionNotes[session.id] || ""]));
  }
  downloadFile(`forge-12-training-log-${todayStamp()}.csv`, rows.map((row) => row.map(csvCell).join(",")).join("\n"), "text/csv;charset=utf-8");
  showToast("Workout log exported.");
}

function downloadFile(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function renderPreservingScroll() {
  const y = window.scrollY;
  const open = [...document.querySelectorAll(".exercise-card.open")].map((card) => card.dataset.exerciseCard);
  render();
  open.forEach((id) => document.querySelector(`[data-exercise-card="${CSS.escape(id)}"]`)?.classList.add("open"));
  window.scrollTo(0, y);
}

function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("show");
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3000);
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("sw.js").catch(console.warn);
}

function metricCard(label, value, detail) {
  return `<article class="metric-card"><span class="metric-label">${escapeHtml(label)}</span><strong class="metric-value">${escapeHtml(String(value))}</strong><span class="metric-detail">${escapeHtml(String(detail))}</span></article>`;
}

function optionRange(start, end, selected, prefix = "") {
  return Array.from({ length: end - start + 1 }, (_, index) => index + start).map((value) => `<option value="${value}" ${value === selected ? "selected" : ""}>${prefix}${value}</option>`).join("");
}

function roundLoad(value) {
  const increment = Number(state.program.settings.loadIncrement) || 1;
  return value ? Math.round(value / increment) * increment : 0;
}

function formatDate(date) {
  return new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(date);
}

function formatNumber(value) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(Number(value) || 0);
}

function todayStamp() { return isoDate(new Date()); }
function isoDate(date) { return date.toISOString().slice(0, 10); }
function nullableNumber(value) { return value === "" ? null : Number(value); }
function valueAttr(value) { return value == null ? "" : escapeAttr(String(value)); }
function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function slug(value) { return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-"); }
function csvCell(value) { const text = String(value ?? ""); return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]); }
function escapeAttr(value) { return escapeHtml(value).replace(/`/g, "&#96;"); }
