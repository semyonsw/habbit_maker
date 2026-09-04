// Reminders: the permission negotiation, what reaches the Android scheduler,
// and how a web notification is actually delivered.
//
// The Capacitor bridge and the Notification API are STUBBED, not mocked away.
// The stubs answer the way the real platforms answer -- including Android's
// fourth permission state and Chrome-on-Android's illegal Notification
// constructor -- so what runs here is what runs on a phone.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom, click, $ } from "./dom.mjs";

installDom();

const { setState } = await import("../src/state.js");
const { getDefaultState, migrateState } = await import(
  "../src/persistence.js"
);
const {
  enableRemindersInteractive,
  fireWebNotification,
  getNotificationStatus,
  notificationsSupported,
  rescheduleReminders,
} = await import("../src/notifications.js");
const { setDailyReminderEnabled, setDailyReminderTime } = await import(
  "../src/ui-prefs.js"
);
const { renderSettings, bindSettingsEvents } = await import(
  "../src/render-settings.js"
);

bindSettingsEvents();

// rescheduleReminders() coalesces into a microtask and then awaits a handful of
// bridge calls, so one macrotask turn is what "it has finished" looks like.
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

// The bridge as the WebView builds it: plugins as ready-made objects under
// Capacitor.Plugins, every method a promise. `current` is the device's state,
// mutable mid-test -- that is how a permission gets revoked in system settings
// while the app is running.
function stubNative({
  display = "granted",
  exact = "granted",
  request = "granted",
} = {}) {
  const current = { display, exact };
  const calls = {
    checks: 0,
    requests: 0,
    scheduled: [],
    cancelled: [],
    exactChecks: 0,
    settingsOpened: 0,
  };

  window.Capacitor = {
    isNativePlatform: () => true,
    Plugins: {
      LocalNotifications: {
        checkPermissions: async () => {
          calls.checks += 1;
          return { display: current.display };
        },
        requestPermissions: async () => {
          calls.requests += 1;
          current.display = request;
          return { display: request };
        },
        getPending: async () => ({ notifications: [] }),
        cancel: async (options) => {
          calls.cancelled.push(options);
        },
        schedule: async (options) => {
          calls.scheduled.push(options);
        },
        checkExactNotificationSetting: async () => {
          calls.exactChecks += 1;
          return { exact_alarm: current.exact };
        },
        changeExactNotificationSetting: async () => {
          calls.settingsOpened += 1;
          current.exact = "granted";
          return { exact_alarm: "granted" };
        },
      },
    },
  };

  return { calls, current };
}

beforeEach(() => {
  setState(getDefaultState());
  migrateState();
  setDailyReminderEnabled(false);
  setDailyReminderTime("08:00");
});

afterEach(() => {
  delete window.Capacitor;
  delete window.Notification;
  delete navigator.serviceWorker;
});

/* ====================================================================== */
/* Permission                                                             */
/* ====================================================================== */

test("Android's fourth permission state is still worth asking about", async () => {
  // Dismiss the system dialog once and POST_NOTIFICATIONS lands on
  // "prompt-with-rationale" -- askable again, and the likeliest state for
  // anyone who swiped the first prompt away. Code that recognised only the
  // exact string "prompt" never asked again and never said why: the toggle sat
  // there looking on with no alarms behind it.
  const { calls } = stubNative({
    display: "prompt-with-rationale",
    request: "granted",
  });

  rescheduleReminders();
  await settle();

  assert.equal(
    getNotificationStatus().permission,
    "prompt",
    "reported as promptable, not as a denial and not as a state the UI cannot read",
  );
  assert.equal(calls.scheduled.length, 0, "and nothing is scheduled yet");

  const permission = await enableRemindersInteractive();

  assert.equal(calls.requests, 1, "the system dialog was actually asked for");
  assert.equal(permission, "granted");
});

test("a permission revoked in system settings stops the reminders", async () => {
  setDailyReminderEnabled(true);
  const { calls, current } = stubNative({ display: "granted" });

  rescheduleReminders();
  await settle();
  assert.equal(calls.scheduled.length, 1, "alarms are laid down while granted");

  // Turned off in Android's settings, with the app still running.
  current.display = "denied";
  rescheduleReminders();
  await settle();

  assert.equal(calls.scheduled.length, 1, "no further alarms are scheduled");
  assert.equal(
    getNotificationStatus().permission,
    "denied",
    "and Settings stops claiming reminders will arrive",
  );
});

test("a bridge with no notifications plugin is not a crash", async () => {
  window.Capacitor = { isNativePlatform: () => true, Plugins: {} };
  assert.equal(notificationsSupported(), false);
  rescheduleReminders();
  await settle();
  assert.equal(getNotificationStatus().permission, "unsupported");
});

/* ====================================================================== */
/* What reaches Android                                                   */
/* ====================================================================== */

test("an enabled reminder becomes one weekly alarm per day, on the minute", async () => {
  setDailyReminderEnabled(true);
  setDailyReminderTime("21:30");
  const { calls } = stubNative({ display: "granted" });

  rescheduleReminders();
  await settle();

  assert.equal(calls.scheduled.length, 1, "one schedule call");
  const notifications = calls.scheduled[0].notifications;
  assert.equal(notifications.length, 7, "one alarm per weekday");

  assert.deepEqual(
    notifications.map((n) => n.schedule.on.weekday).sort((a, b) => a - b),
    [1, 2, 3, 4, 5, 6, 7],
    "Capacitor's weekdays are 1-based from Sunday, JS's are 0-based",
  );

  notifications.forEach((n) => {
    assert.equal(n.schedule.on.hour, 21);
    assert.equal(n.schedule.on.minute, 30);
    assert.equal(
      n.schedule.on.second,
      0,
      "pinned: the plugin fills unspecified fields from the current time, so " +
        "without this the alarm drifts to whatever second it was scheduled on",
    );
    assert.equal(n.schedule.repeats, true);
    assert.equal(n.schedule.allowWhileIdle, true, "so Doze cannot swallow it");
  });
});

test("the exact-alarm setting is checked, and Settings offers the fix", async () => {
  setDailyReminderEnabled(true);
  const { calls } = stubNative({ display: "granted", exact: "denied" });

  rescheduleReminders();
  await settle();

  assert.ok(calls.exactChecks >= 1, "checked, where it used to be checked nowhere");
  assert.equal(getNotificationStatus().exact, "denied");

  renderSettings();
  const row = $("[data-exact-alarms]");
  assert.ok(row, "the row that explains a late reminder is offered");

  // And it goes somewhere: Android owns the switch, so the app can only open it.
  click(row, "Allow exact alarms");
  await settle();
  assert.equal(calls.settingsOpened, 1, "the system screen was opened");

  renderSettings();
  assert.equal(
    $("[data-exact-alarms]"),
    null,
    "and once granted the row goes away rather than lingering as a lie",
  );
});

test("nothing is said about exact alarms when they are already granted", async () => {
  setDailyReminderEnabled(true);
  stubNative({ display: "granted", exact: "granted" });

  rescheduleReminders();
  await settle();
  renderSettings();

  assert.equal($("[data-exact-alarms]"), null);
});

/* ====================================================================== */
/* Web delivery                                                           */
/* ====================================================================== */

test("a web reminder is shown through the service worker", async () => {
  const shown = [];
  navigator.serviceWorker = {
    getRegistration: async () => ({
      showNotification: async (title, options) => {
        shown.push({ title, options });
      },
    }),
  };
  // Chrome on Android, faithfully: the page constructor THROWS. This is why
  // reminders in the installed PWA fired their timer, threw, logged a warning
  // nobody reads, and showed nothing at all.
  window.Notification = class {
    constructor() {
      throw new TypeError("Illegal constructor");
    }
  };
  window.Notification.permission = "granted";

  await fireWebNotification({
    id: 42,
    title: "Read",
    body: "After I pour my coffee",
  });

  assert.equal(shown.length, 1, "the service worker showed it");
  assert.equal(shown[0].title, "Read");
  assert.equal(shown[0].options.body, "After I pour my coffee");
  assert.equal(shown[0].options.tag, "habit-42");
});

test("with no service worker the page shows the reminder itself", async () => {
  const made = [];
  navigator.serviceWorker = { getRegistration: async () => null };
  window.Notification = class {
    constructor(title, options) {
      made.push({ title, options });
    }
    close() {}
  };
  window.Notification.permission = "granted";

  await fireWebNotification({ id: 7, title: "Stretch", body: "Two minutes" });

  assert.equal(made.length, 1, "the desktop path still works");
  assert.equal(made[0].title, "Stretch");
});
