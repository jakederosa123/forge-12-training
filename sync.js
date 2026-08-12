const META_KEY = "forge.training.sync.meta.v1";
const CONFLICT_BACKUP_KEY = "forge.training.sync.conflict-backup.v1";
const LOCAL_CONFIG_KEY = "forge.training.sync.config.v1";

export function createSyncManager({ getState, replaceState, requestRender, notify }) {
  const config = resolveConfig();
  const configured = validConfig(config);
  const client = configured && window.supabase
    ? window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      })
    : null;

  let user = null;
  let status = configured ? "signed-out" : "setup";
  let lastSyncedAt = null;
  let errorMessage = "";
  let syncTimer;
  let syncing = false;
  let syncQueued = false;
  let channel;

  function meta() {
    try {
      return JSON.parse(localStorage.getItem(META_KEY)) || { lastCloudRevision: 0, lastSyncedLocalSave: null };
    } catch {
      return { lastCloudRevision: 0, lastSyncedLocalSave: null };
    }
  }

  function setMeta(value) {
    localStorage.setItem(META_KEY, JSON.stringify(value));
  }

  async function init() {
    if (!client) return;
    const { data } = await client.auth.getSession();
    user = data.session?.user || null;
    if (user) {
      status = navigator.onLine ? "syncing" : "offline";
      requestRender();
      subscribe();
      if (navigator.onLine) await syncNow();
    }

    client.auth.onAuthStateChange((event, session) => {
      user = session?.user || null;
      if (user) {
        status = navigator.onLine ? "syncing" : "offline";
        subscribe();
        setTimeout(syncNow, 0);
      } else {
        unsubscribe();
        status = "signed-out";
      }
      requestRender();
    });

    window.addEventListener("online", () => {
      status = user ? "syncing" : "signed-out";
      requestRender();
      syncNow();
    });
    window.addEventListener("offline", () => {
      status = "offline";
      requestRender();
    });
    window.addEventListener("focus", () => user && navigator.onLine && syncNow());
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && user && navigator.onLine) syncNow();
    });
  }

  function subscribe() {
    if (!client || !user || channel) return;
    channel = client
      .channel(`training-state-${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "training_state", filter: `user_id=eq.${user.id}` },
        () => setTimeout(syncNow, 250),
      )
      .subscribe();
  }

  function unsubscribe() {
    if (client && channel) client.removeChannel(channel);
    channel = null;
  }

  function localChanged() {
    if (!user || !navigator.onLine) {
      status = user ? "offline" : configured ? "signed-out" : "setup";
      requestRender();
      return;
    }
    status = "pending";
    requestRender();
    if (syncing) {
      syncQueued = true;
      return;
    }
    clearTimeout(syncTimer);
    syncTimer = setTimeout(syncNow, 1200);
  }

  async function handleAction(action) {
    if (action === "sync-save-config") {
      const url = document.querySelector("#sync-project-url")?.value.trim() || "";
      const key = document.querySelector("#sync-publishable-key")?.value.trim() || "";
      const nextConfig = { supabaseUrl: url.replace(/\/$/, ""), supabasePublishableKey: key };
      if (!validConfig(nextConfig)) {
        notify("Enter the Supabase Project URL and Publishable Key. Do not use a Secret or service_role key.");
        return;
      }
      localStorage.setItem(LOCAL_CONFIG_KEY, JSON.stringify(nextConfig));
      notify("Connection saved. Reloading Forge 12 now.");
      setTimeout(() => location.reload(), 350);
      return;
    }
    if (action === "sync-open-settings") {
      const settingsButton = document.querySelector('[data-view="settings"]');
      settingsButton?.click();
      return;
    }
    if (action === "sync-sign-in-password" || action === "sync-sign-up-password") {
      const email = document.querySelector("#sync-email")?.value.trim() || "";
      const password = document.querySelector("#sync-password")?.value || "";
      if (!email || !email.includes("@")) {
        notify("Enter a valid email address.");
        return;
      }
      if (password.length < 8) {
        notify("Use a password with at least 8 characters.");
        return;
      }
      status = "syncing";
      requestRender();
      if (action === "sync-sign-in-password") {
        const { error } = await client.auth.signInWithPassword({ email, password });
        if (error) return fail(error);
        notify("Signed in. Your workouts are synchronizing now.");
        return;
      }
      const { data, error } = await client.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${location.origin}${location.pathname}` },
      });
      if (error) return fail(error);
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        return fail(new Error("This email already has an account. Sign in with your password, or use the email-link option once and then set a password."));
      }
      if (data.session) {
        notify("Account created and signed in. Synchronization is starting.");
      } else {
        status = "email-sent";
        requestRender();
        notify("Account created. Check your email once to confirm it, then sign in with your password.");
      }
      return;
    }
    if (action === "sync-email-link") {
      const input = document.querySelector("#sync-email");
      const email = input?.value.trim();
      if (!email || !email.includes("@")) {
        notify("Enter a valid email address.");
        return;
      }
      status = "syncing";
      requestRender();
      const { error } = await client.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${location.origin}${location.pathname}` },
      });
      if (error) return fail(error);
      status = "email-sent";
      requestRender();
      notify("Sign-in link sent. Open your email and tap the link.");
      return;
    }
    if (action === "sync-set-password") {
      const password = document.querySelector("#sync-new-password")?.value || "";
      if (password.length < 8) {
        notify("Use a password with at least 8 characters.");
        return;
      }
      const { error } = await client.auth.updateUser({ password });
      if (error) return fail(error);
      notify("Password saved. You can now sign in directly from your iPhone app icon.");
      const input = document.querySelector("#sync-new-password");
      if (input) input.value = "";
      return;
    }
    if (action === "sync-now") {
      await syncNow(true);
      return;
    }
    if (action === "sync-sign-out") {
      await client.auth.signOut();
      user = null;
      status = "signed-out";
      requestRender();
      notify("Signed out. Local saving is still on.");
    }
  }

  async function syncNow(showSuccess = false, retry = true) {
    if (!client || !user || !navigator.onLine) return;
    if (syncing) {
      syncQueued = true;
      return;
    }
    syncing = true;
    syncQueued = false;
    status = "syncing";
    errorMessage = "";
    requestRender();

    try {
      const currentMeta = meta();
      const originalLocal = getState();
      const { data: row, error: readError } = await client
        .from("training_state")
        .select("app_state, revision, updated_at")
        .eq("user_id", user.id)
        .maybeSingle();
      if (readError) throw readError;

      if (!row) {
        const snapshot = toCloudState(originalLocal);
        const { data: inserted, error: insertError } = await client
          .from("training_state")
          .insert({ user_id: user.id, app_state: snapshot, revision: 1 })
          .select("revision, updated_at")
          .single();
        if (insertError) {
          if (retry && insertError.code === "23505") {
            syncing = false;
            return syncNow(showSuccess, false);
          }
          throw insertError;
        }
        finishSync(inserted.revision, originalLocal.lastSavedAt, inserted.updated_at, showSuccess);
        return;
      }

      const localDirty = originalLocal.lastSavedAt !== currentMeta.lastSyncedLocalSave;
      const cloudDirty = Number(row.revision) > Number(currentMeta.lastCloudRevision || 0);
      let merged = originalLocal;

      if (cloudDirty) {
        if (localDirty) {
          localStorage.setItem(CONFLICT_BACKUP_KEY, JSON.stringify({
            savedAt: new Date().toISOString(),
            local: toCloudState(originalLocal),
            cloud: row.app_state,
          }));
        }
        merged = mergeCloudState(originalLocal, row.app_state || {});
        replaceState(merged);
      }

      if (localDirty || (cloudDirty && JSON.stringify(toCloudState(merged)) !== JSON.stringify(row.app_state || {}))) {
        const nextRevision = Number(row.revision) + 1;
        const { data: updated, error: updateError } = await client
          .from("training_state")
          .update({ app_state: toCloudState(merged), revision: nextRevision })
          .eq("user_id", user.id)
          .eq("revision", row.revision)
          .select("revision, updated_at")
          .maybeSingle();
        if (updateError) throw updateError;
        if (!updated) {
          if (retry) {
            syncing = false;
            return syncNow(showSuccess, false);
          }
          throw new Error("Another device updated the account. Tap Sync now once more.");
        }
        finishSync(updated.revision, merged.lastSavedAt, updated.updated_at, showSuccess);
      } else {
        finishSync(row.revision, merged.lastSavedAt, row.updated_at, showSuccess);
      }
    } catch (error) {
      fail(error);
    } finally {
      syncing = false;
      if (syncQueued && user && navigator.onLine) {
        syncQueued = false;
        clearTimeout(syncTimer);
        syncTimer = setTimeout(syncNow, 50);
      }
    }
  }

  function finishSync(revision, localSave, serverTime, showSuccess) {
    lastSyncedAt = serverTime || new Date().toISOString();
    setMeta({ lastCloudRevision: Number(revision), lastSyncedLocalSave: localSave || null });
    status = "synced";
    errorMessage = "";
    requestRender();
    if (showSuccess) notify("Laptop and phone data are synchronized.");
  }

  function fail(error) {
    console.error("Forge sync error", error);
    status = "error";
    errorMessage = friendlyError(error);
    requestRender();
    notify(errorMessage);
  }

  function renderStatus() {
    const details = statusDetails();
    return `<button class="save-indicator sync-indicator ${details.className}" data-action="sync-open-settings" title="Open synchronization settings"><span class="save-dot"></span>${details.label}</button>`;
  }

  function renderPanel() {
    if (!configured) {
      return `<section class="panel sync-panel"><div class="panel-header"><div><span class="eyebrow">Laptop and iPhone</span><h2>Connect this device to Supabase</h2><p>Paste the Project URL and Publishable Key from your Supabase project. You can also place them in <strong>config.js</strong> once to configure every device.</p></div><span class="status-pill modify">Setup needed</span></div><div class="sync-setup"><div class="field"><label for="sync-project-url">Supabase Project URL</label><input id="sync-project-url" type="url" inputmode="url" autocomplete="url" placeholder="https://your-project.supabase.co"></div><div class="field"><label for="sync-publishable-key">Supabase Publishable Key</label><input id="sync-publishable-key" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="sb_publishable_..."></div><button class="button" data-action="sync-save-config">Save connection on this device</button></div><p class="micro-copy">Use only a Publishable Key. Never enter a Secret Key, service_role key, database password, or connection string.</p></section>`;
    }
    if (!user) {
      return `<section class="panel sync-panel">
        <div class="panel-header"><div><span class="eyebrow">Laptop and iPhone</span><h2>Sign in to synchronize</h2><p>Sign in directly with the same email and password on every device. Your session stays saved on that device until you sign out or clear its website data.</p></div><span class="status-pill hold">Local only</span></div>
        <div class="sync-credentials">
          <div class="field"><label for="sync-email">Email address</label><input id="sync-email" type="email" autocomplete="email" autocapitalize="none" spellcheck="false" placeholder="you@example.com"></div>
          <div class="field"><label for="sync-password">Password</label><input id="sync-password" type="password" autocomplete="current-password" minlength="8" placeholder="At least 8 characters"></div>
          <div class="button-row"><button class="button" data-action="sync-sign-in-password">Sign in</button><button class="button-secondary" data-action="sync-sign-up-password">Create account</button></div>
        </div>
        <details class="auth-fallback"><summary>Already used an email sign-in link and do not have a password?</summary><p>Use the email link one more time on your laptop. Once signed in, return here and set a password. After that, the iPhone Home Screen app can sign in directly.</p><button class="button-ghost small" data-action="sync-email-link">Email me a one-time sign-in link</button></details>
        ${status === "email-sent" ? `<div class="readiness-summary"><strong>Check your email</strong><span>Open the message on this device, return to Settings, and create your password.</span></div>` : ""}
      </section>`;
    }
    const details = statusDetails();
    return `<section class="panel sync-panel">
      <div class="panel-header"><div><span class="eyebrow">Laptop and iPhone</span><h2>Cloud synchronization</h2><p>Signed in as ${escapeHtml(user.email || "your account")}. Workouts save locally first and upload whenever internet is available.</p></div><span class="status-pill ${details.pillClass}">${details.label}</span></div>
      <div class="sync-account"><div><span class="metric-label">Last cloud save</span><strong>${lastSyncedAt ? formatTime(lastSyncedAt) : "Waiting for first sync"}</strong>${errorMessage ? `<p class="sync-error">${escapeHtml(errorMessage)}</p>` : ""}</div><div class="button-row"><button class="button" data-action="sync-now">Sync now</button><button class="button-ghost" data-action="sync-sign-out">Sign out</button></div></div>
      <div class="password-setup"><div><strong>Direct iPhone login</strong><p>If this account previously used email links, set a password once. Then use this email and password inside the Home Screen app.</p></div><div class="field"><label for="sync-new-password">New or replacement password</label><input id="sync-new-password" type="password" autocomplete="new-password" minlength="8" placeholder="At least 8 characters"></div><button class="button-secondary" data-action="sync-set-password">Save password</button></div>
    </section>`;
  }

  function statusDetails() {
    const values = {
      setup: { label: "Setup needed", className: "setup", pillClass: "modify" },
      "signed-out": { label: "Saved locally", className: "local", pillClass: "hold" },
      "email-sent": { label: "Check email", className: "pending", pillClass: "hold" },
      pending: { label: "Waiting to sync", className: "pending", pillClass: "hold" },
      syncing: { label: "Syncing", className: "pending", pillClass: "hold" },
      synced: { label: "Synced", className: "synced", pillClass: "complete" },
      offline: { label: "Offline, saved locally", className: "offline", pillClass: "hold" },
      error: { label: "Sync needs attention", className: "error", pillClass: "modify" },
    };
    return values[status] || values["signed-out"];
  }

  return { init, localChanged, handleAction, renderStatus, renderPanel, syncNow };
}

function validConfig(config) {
  return /^https:\/\/.+\.supabase\.co$/i.test(config.supabaseUrl || "")
    && /^(sb_publishable_|eyJ)/.test(config.supabasePublishableKey || "")
    && !/YOUR_/i.test(`${config.supabaseUrl}${config.supabasePublishableKey}`);
}

function resolveConfig() {
  const published = window.FORGE_SYNC_CONFIG || {};
  if (validConfig(published)) return published;
  try {
    const local = JSON.parse(localStorage.getItem(LOCAL_CONFIG_KEY));
    return validConfig(local || {}) ? local : published;
  } catch {
    return published;
  }
}

function toCloudState(local) {
  return {
    schemaVersion: 1,
    program: local.program,
    readiness: local.readiness || {},
    logs: local.logs || {},
    sessionNotes: local.sessionNotes || {},
    sessionCompleted: local.sessionCompleted || {},
    syncTimes: local.syncTimes || { program: null, readiness: {}, logs: {}, notes: {}, completed: {} },
    lastSavedAt: local.lastSavedAt || null,
  };
}

function mergeCloudState(local, cloud) {
  if (!cloud?.program?.weeks?.length) return local;
  const cloudTimes = normalizeTimes(cloud.syncTimes);
  const localTimes = normalizeTimes(local.syncTimes);
  const localFallback = local.lastSavedAt || "";
  const cloudFallback = cloud.lastSavedAt || "";
  const merged = { ...local };

  merged.program = newer(localTimes.program, cloudTimes.program, localFallback, cloudFallback)
    ? local.program
    : cloud.program;
  merged.readiness = mergeMap(local.readiness, cloud.readiness, localTimes.readiness, cloudTimes.readiness, localFallback, cloudFallback);
  merged.logs = mergeMap(local.logs, cloud.logs, localTimes.logs, cloudTimes.logs, localFallback, cloudFallback);
  merged.sessionNotes = mergeMap(local.sessionNotes, cloud.sessionNotes, localTimes.notes, cloudTimes.notes, localFallback, cloudFallback);
  merged.sessionCompleted = mergeMap(local.sessionCompleted, cloud.sessionCompleted, localTimes.completed, cloudTimes.completed, localFallback, cloudFallback);
  merged.syncTimes = mergeTimes(localTimes, cloudTimes);
  merged.lastSavedAt = maxDate(local.lastSavedAt, cloud.lastSavedAt);
  return merged;
}

function mergeMap(local = {}, cloud = {}, localTimes = {}, cloudTimes = {}, localFallback = "", cloudFallback = "") {
  const result = {};
  const keys = new Set([...Object.keys(cloud || {}), ...Object.keys(local || {})]);
  for (const key of keys) {
    if (!(key in local)) result[key] = cloud[key];
    else if (!(key in cloud)) result[key] = local[key];
    else result[key] = newer(localTimes[key], cloudTimes[key], localFallback, cloudFallback) ? local[key] : cloud[key];
  }
  return result;
}

function normalizeTimes(value = {}) {
  return {
    program: value?.program || null,
    readiness: value?.readiness || {},
    logs: value?.logs || {},
    notes: value?.notes || {},
    completed: value?.completed || {},
  };
}

function mergeTimes(local, cloud) {
  return {
    program: maxDate(local.program, cloud.program),
    readiness: mergeTimeMap(local.readiness, cloud.readiness),
    logs: mergeTimeMap(local.logs, cloud.logs),
    notes: mergeTimeMap(local.notes, cloud.notes),
    completed: mergeTimeMap(local.completed, cloud.completed),
  };
}

function mergeTimeMap(local = {}, cloud = {}) {
  const result = {};
  for (const key of new Set([...Object.keys(local), ...Object.keys(cloud)])) result[key] = maxDate(local[key], cloud[key]);
  return result;
}

function newer(localTime, cloudTime, localFallback, cloudFallback) {
  return String(localTime || localFallback || "") >= String(cloudTime || cloudFallback || "");
}

function maxDate(a, b) {
  return String(a || "") >= String(b || "") ? (a || b || null) : (b || a || null);
}

function friendlyError(error) {
  const message = error?.message || String(error || "Cloud synchronization failed.");
  if (/Failed to fetch|NetworkError/i.test(message)) return "No internet connection. Your workout is still saved locally.";
  if (/invalid login credentials/i.test(message)) return "That email and password did not match. If you previously used email links, use the link option once and set a password after signing in.";
  if (/email not confirmed/i.test(message)) return "Confirm the account from the Supabase email once, then sign in with your password.";
  if (/password.*(short|characters|length)/i.test(message)) return "Use a password with at least 8 characters.";
  if (/training_state|relation/i.test(message)) return "The Supabase training table is not ready. Run supabase/setup.sql in the SQL Editor.";
  if (/row-level security|policy|permission/i.test(message)) return "Supabase security rules blocked the save. Run the complete setup SQL again.";
  return message;
}

function formatTime(value) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}
