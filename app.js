/* ============================================================
   HABIT TRACKER + BOOKS MODULE — Application Logic
   ============================================================ */

(function () {
  "use strict";

  const STORAGE_KEY = "habitTracker_v1";
  const SIDEBAR_COLLAPSE_KEY = "habitTracker_sidebarCollapsed_v1";
  const SCHEMA_VERSION = 3;
  const MONTH_NAMES = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];

  const MAX_PDF_FILE_SIZE_BYTES = 40 * 1024 * 1024;
  const MAX_BOOKMARK_HISTORY = 200;
  const PDF_DB_NAME = "habitTracker_books_pdf_v1";
  const PDF_DB_VERSION = 1;
  const PDF_STORE_NAME = "pdfFiles";
  const PDFJS_SCRIPT_URLS = [
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
    "https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.min.js",
  ];
  const PDFJS_WORKER_URL =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  const READER_DARK_ENABLED_KEY = "habitTracker_readerDarkEnabled_v1";
  const READER_DARK_MODE_KEY = "habitTracker_readerDarkMode_v1";
  const ANALYTICS_DISPLAY_MODE_KEY = "habitTracker_analyticsDisplayMode_v1";

  const DEFAULT_CATEGORIES = [
    { id: "cat_health", name: "Health", emoji: "❤️", color: "#3E85B5" },
    {
      id: "cat_productivity",
      name: "Productivity",
      emoji: "🧠",
      color: "#4F6BD8",
    },
    { id: "cat_fitness", name: "Fitness", emoji: "💪", color: "#2F9E7A" },
    { id: "cat_family", name: "Family", emoji: "👨‍👩‍👧‍👦", color: "#D97706" },
    { id: "cat_sleep", name: "Sleep", emoji: "😴", color: "#7C8CFF" },
    { id: "cat_study", name: "Study", emoji: "📚", color: "#B56BE3" },
    { id: "cat_diet", name: "Diet", emoji: "🥗", color: "#22C55E" },
    { id: "cat_career", name: "Career", emoji: "💼", color: "#F59E0B" },
    { id: "cat_music", name: "Music", emoji: "🎵", color: "#F97316" },
  ];

  const DEFAULT_DAILY_HABITS = [
    {
      id: "dh_1",
      name: "Morning Bible reading",
      categoryId: "cat_health",
      monthGoal: 30,
      type: "fixed",
      excludedWeekdays: [],
      emoji: "📖",
      order: 0,
    },
    {
      id: "dh_2",
      name: "Complete work tasks",
      categoryId: "cat_productivity",
      monthGoal: 28,
      type: "fixed",
      excludedWeekdays: [],
      emoji: "💼",
      order: 1,
    },
  ];

  let state = null;
  let chartInstances = {};
  let sidebarCollapsed = false;
  let noteModalState = { habitId: null, day: null };
  let bookModalState = { editingBookId: null };
  let bookmarkModalState = { editingBookId: null, editingBookmarkId: null };
  let historyEventModalState = {
    editingBookId: null,
    editingBookmarkId: null,
    editingEventId: null,
  };
  let confirmCallback = null;
  let editingHabitId = null;
  let editingCategoryId = null;
  let idbPromise = null;
  let booksBlobStatus = {};
  let topClockTimer = null;
  const analyticsState = {
    displayMode: "percent",
  };

  const readerState = {
    pdfDoc: null,
    book: null,
    currentPage: 1,
    totalPages: 0,
    renderTask: null,
    resizeHandlerBound: false,
    resizeTimer: null,
    darkEnabled: false,
    darkMode: "full",
    sourceBookmarkId: null,
    sourcePage: null,
  };

  function formatRealBookPage(value) {
    const page = parseInt(value, 10);
    return Number.isFinite(page) && page > 0 ? String(page) : "-";
  }

  function loadReaderThemePreferences() {
    readerState.darkEnabled =
      localStorage.getItem(READER_DARK_ENABLED_KEY) === "1";
    const savedMode = localStorage.getItem(READER_DARK_MODE_KEY);
    readerState.darkMode = savedMode === "text" ? "text" : "full";
  }

  function persistReaderThemePreferences() {
    localStorage.setItem(
      READER_DARK_ENABLED_KEY,
      readerState.darkEnabled ? "1" : "0",
    );
    localStorage.setItem(READER_DARK_MODE_KEY, readerState.darkMode);
  }

  function applyReaderThemeClasses() {
    const root = document.getElementById("readerMode");
    const canvas = document.getElementById("readerCanvas");
    if (!root || !canvas) return;

    root.classList.toggle("reader-dark-enabled", readerState.darkEnabled);
    canvas.classList.toggle("reader-dark-full", false);
    canvas.classList.toggle("reader-dark-text", false);

    if (readerState.darkEnabled) {
      canvas.classList.add(
        readerState.darkMode === "text"
          ? "reader-dark-text"
          : "reader-dark-full",
      );
    }
  }

  function updateReaderThemeControls() {
    const toggle = document.getElementById("readerDarkToggle");
    const mode = document.getElementById("readerDarkMode");
    if (!toggle || !mode) return;

    toggle.setAttribute("aria-pressed", String(readerState.darkEnabled));
    toggle.textContent = readerState.darkEnabled
      ? "Read in dark theme: ON"
      : "Read in dark theme: OFF";

    mode.value = readerState.darkMode;
    mode.disabled = !readerState.darkEnabled;
  }

  function toggleReaderDarkTheme() {
    readerState.darkEnabled = !readerState.darkEnabled;
    persistReaderThemePreferences();
    applyReaderThemeClasses();
    updateReaderThemeControls();
  }

  function setReaderDarkMode(mode) {
    readerState.darkMode = mode === "text" ? "text" : "full";
    persistReaderThemePreferences();
    applyReaderThemeClasses();
    updateReaderThemeControls();
  }

  function loadAnalyticsPreferences() {
    const savedMode = localStorage.getItem(ANALYTICS_DISPLAY_MODE_KEY);
    analyticsState.displayMode = savedMode === "raw" ? "raw" : "percent";
  }

  function persistAnalyticsPreferences() {
    localStorage.setItem(
      ANALYTICS_DISPLAY_MODE_KEY,
      analyticsState.displayMode,
    );
  }

  function getAnalyticsDisplayMode() {
    return analyticsState.displayMode === "raw" ? "raw" : "percent";
  }

  function getMetricValue(done, possible) {
    if (getAnalyticsDisplayMode() === "raw") {
      return Number(done || 0);
    }
    if (!possible) return 0;
    return Math.round((Number(done || 0) / Number(possible || 1)) * 100);
  }

  function getMetricLabel(value) {
    if (getAnalyticsDisplayMode() === "raw") {
      return String(Math.round(value || 0));
    }
    return `${Math.round(value || 0)}%`;
  }

  function getMetricAxisLabel() {
    return getAnalyticsDisplayMode() === "raw"
      ? "Completed habits"
      : "Completion rate (%)";
  }

  function syncAnalyticsModeControls() {
    ["analyticsDisplayModeDashboard", "analyticsDisplayModeAnalytics"]
      .map((id) => document.getElementById(id))
      .filter(Boolean)
      .forEach((control) => {
        control.value = getAnalyticsDisplayMode();
      });
  }

  function setAnalyticsDisplayMode(mode) {
    analyticsState.displayMode = mode === "raw" ? "raw" : "percent";
    persistAnalyticsPreferences();
    syncAnalyticsModeControls();
    renderDashboardAnalytics();
    renderAnalyticsView();
  }

  function uid(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function monthKey(year, month) {
    return `${year}-${String(month + 1).padStart(2, "0")}`;
  }

  function formatDateKey(year, month, day) {
    return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  function sanitize(str) {
    const div = document.createElement("div");
    div.textContent = String(str || "");
    return div.innerHTML;
  }

  function isPlainObject(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function formatIsoForDisplay(iso) {
    if (!iso) return "-";
    const dt = new Date(iso);
    if (Number.isNaN(dt.getTime())) return String(iso);
    return dt.toLocaleString();
  }

  function formatTopClockDateTime(date) {
    return date.toLocaleString(undefined, {
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }

  function updateTopClock() {
    const topDateTime = document.getElementById("topDateTime");
    if (!topDateTime) return;
    topDateTime.textContent = formatTopClockDateTime(new Date());
  }

  function initTopClock() {
    updateTopClock();
    if (topClockTimer) {
      clearInterval(topClockTimer);
    }
    topClockTimer = setInterval(updateTopClock, 1000);
  }

  function daysInMonth(year, month) {
    return new Date(year, month + 1, 0).getDate();
  }

  function getDefaultMonthData() {
    return {
      dailyCompletions: {},
      dailyNotes: {},
      monthlyReview: { wins: "", blockers: "", focus: "" },
    };
  }

  function ensureMonthDataShape(monthData) {
    if (!isPlainObject(monthData.dailyCompletions)) {
      monthData.dailyCompletions = {};
    }
    if (!isPlainObject(monthData.dailyNotes)) {
      monthData.dailyNotes = {};
    }
    if (!isPlainObject(monthData.monthlyReview)) {
      monthData.monthlyReview = {};
    }
    monthData.monthlyReview.wins = String(monthData.monthlyReview.wins || "");
    monthData.monthlyReview.blockers = String(
      monthData.monthlyReview.blockers || "",
    );
    monthData.monthlyReview.focus = String(monthData.monthlyReview.focus || "");
    return monthData;
  }

  function ensureBooksShape(input) {
    if (!isPlainObject(input.books)) {
      input.books = { items: [], activeBookId: null };
    }
    if (!Array.isArray(input.books.items)) {
      input.books.items = [];
    }
    if (typeof input.books.activeBookId !== "string") {
      input.books.activeBookId = null;
    }

    input.books.items = input.books.items
      .filter((book) => isPlainObject(book) && typeof book.bookId === "string")
      .map((book) => {
        const createdAt = String(book.createdAt || nowIso());
        const updatedAt = String(book.updatedAt || createdAt);
        const cleanBook = {
          bookId: String(book.bookId),
          title:
            String(book.title || "Untitled Book").trim() || "Untitled Book",
          author: book.author ? String(book.author) : "",
          fileId: String(book.fileId || uid("file")),
          fileName: String(book.fileName || "unknown.pdf"),
          fileSize: Number.isFinite(book.fileSize)
            ? Math.max(0, book.fileSize)
            : 0,
          createdAt,
          updatedAt,
          bookmarks: [],
        };

        const rawBookmarks = Array.isArray(book.bookmarks)
          ? book.bookmarks
          : [];
        cleanBook.bookmarks = rawBookmarks
          .filter(
            (bm) =>
              isPlainObject(bm) &&
              typeof bm.bookmarkId === "string" &&
              Number.isFinite(Number(bm.pdfPage)),
          )
          .map((bm) => {
            const bmCreatedAt = String(bm.createdAt || nowIso());
            const bmUpdatedAt = String(bm.updatedAt || bmCreatedAt);
            const history = Array.isArray(bm.history) ? bm.history : [];
            return {
              bookmarkId: String(bm.bookmarkId),
              label: String(bm.label || "Bookmark").trim() || "Bookmark",
              pdfPage: Math.max(1, parseInt(bm.pdfPage, 10) || 1),
              realPage: (() => {
                const parsed = parseInt(bm.realPage, 10);
                return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
              })(),
              note: String(bm.note || ""),
              createdAt: bmCreatedAt,
              updatedAt: bmUpdatedAt,
              history: history
                .filter((h) => isPlainObject(h))
                .map((h) => ({
                  eventId: String(h.eventId || uid("hist")),
                  type: String(h.type || "updated"),
                  at: String(h.at || bmUpdatedAt),
                  note: String(h.note || ""),
                }))
                .sort((a, b) => (a.at < b.at ? 1 : -1))
                .slice(0, MAX_BOOKMARK_HISTORY),
            };
          })
          .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));

        return cleanBook;
      });
  }

  function getDefaultState() {
    const now = new Date();
    const key = monthKey(now.getFullYear(), now.getMonth());
    return {
      currentYear: now.getFullYear(),
      currentMonth: now.getMonth(),
      categories: JSON.parse(JSON.stringify(DEFAULT_CATEGORIES)),
      habits: {
        daily: DEFAULT_DAILY_HABITS.map((h, idx) => ({ ...h, order: idx })),
      },
      months: {
        [key]: getDefaultMonthData(),
      },
      books: {
        items: [],
        activeBookId: null,
      },
      meta: {
        schemaVersion: SCHEMA_VERSION,
      },
    };
  }

  function migrateState() {
    if (!isPlainObject(state)) {
      state = getDefaultState();
      return;
    }

    if (!Array.isArray(state.categories)) {
      state.categories = JSON.parse(JSON.stringify(DEFAULT_CATEGORIES));
    }

    if (!isPlainObject(state.habits)) {
      state.habits = { daily: [] };
    }
    if (!Array.isArray(state.habits.daily)) {
      state.habits.daily = [];
    }
    // Purge removed weekly schema and persisted fields.
    delete state.habits.weekly;

    if (!isPlainObject(state.months)) {
      state.months = {};
    }
    Object.keys(state.months).forEach((key) => {
      if (!isPlainObject(state.months[key])) {
        state.months[key] = getDefaultMonthData();
      }
      delete state.months[key].weeklyCompletions;
      ensureMonthDataShape(state.months[key]);
    });

    state.habits.daily.forEach((habit, idx) => {
      habit.id = String(habit.id || uid("dh"));
      habit.name = String(habit.name || "Habit");
      habit.categoryId = String(habit.categoryId || "");
      habit.monthGoal = Math.max(1, parseInt(habit.monthGoal, 10) || 20);
      habit.type = habit.type === "dynamic" ? "dynamic" : "fixed";
      if (!Array.isArray(habit.excludedWeekdays)) {
        const legacy = Array.isArray(habit.excludedDays)
          ? habit.excludedDays
          : [];
        habit.excludedWeekdays = legacy
          .map((d) => parseInt(d, 10))
          .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
      }
      habit.excludedWeekdays = [...new Set(habit.excludedWeekdays)]
        .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
        .sort((a, b) => a - b);
      delete habit.excludedDays;
      habit.emoji = String(habit.emoji || "📌");
      habit.order = Number.isInteger(habit.order) ? habit.order : idx;
    });
    state.habits.daily.sort((a, b) => a.order - b.order);
    state.habits.daily.forEach((h, idx) => {
      h.order = idx;
    });

    ensureBooksShape(state);

    if (!isPlainObject(state.meta)) {
      state.meta = {};
    }
    state.meta.schemaVersion = SCHEMA_VERSION;

    if (!Number.isInteger(state.currentYear)) {
      state.currentYear = new Date().getFullYear();
    }
    if (
      !Number.isInteger(state.currentMonth) ||
      state.currentMonth < 0 ||
      state.currentMonth > 11
    ) {
      state.currentMonth = new Date().getMonth();
    }
  }

  function ensureMonthData() {
    const key = monthKey(state.currentYear, state.currentMonth);
    if (!state.months[key]) {
      state.months[key] = getDefaultMonthData();
    }
    ensureMonthDataShape(state.months[key]);
  }

  function getCurrentMonthData() {
    ensureMonthData();
    return state.months[monthKey(state.currentYear, state.currentMonth)];
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        state = JSON.parse(raw);
        migrateState();
        ensureMonthData();
        saveState();
        return;
      }
    } catch (error) {
      console.warn("Failed to load state, using defaults", error);
    }

    state = getDefaultState();
    saveState();
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function getCategoryById(categoryId) {
    return state.categories.find((c) => c.id === categoryId) || null;
  }

  function getHabitEmoji(habit) {
    if (habit.emoji) return habit.emoji;
    const cat = getCategoryById(habit.categoryId);
    return cat ? cat.emoji : "📌";
  }

  function isHabitTrackedOnDate(habit, year, month, day) {
    if (!habit || habit.type !== "dynamic") return true;
    const weekday = new Date(year, month, day).getDay();
    return !habit.excludedWeekdays.includes(weekday);
  }

  function getSortedDailyHabits() {
    return [...state.habits.daily].sort(
      (a, b) => (a.order || 0) - (b.order || 0),
    );
  }

  function updateHabitOrder() {
    state.habits.daily = getSortedDailyHabits();
    state.habits.daily.forEach((h, idx) => {
      h.order = idx;
    });
  }

  function navigateMonth(delta) {
    state.currentMonth += delta;
    if (state.currentMonth > 11) {
      state.currentMonth = 0;
      state.currentYear += 1;
    } else if (state.currentMonth < 0) {
      state.currentMonth = 11;
      state.currentYear -= 1;
    }
    ensureMonthData();
    saveState();
    renderAll();
  }

  function switchView(viewId) {
    document
      .querySelectorAll(".view")
      .forEach((view) => view.classList.remove("active"));
    document
      .querySelectorAll(".nav-tab")
      .forEach((tab) => tab.classList.remove("active"));

    const viewEl = document.getElementById(`view-${viewId}`);
    if (viewEl) viewEl.classList.add("active");

    const tabEl = document.querySelector(`.nav-tab[data-view="${viewId}"]`);
    if (tabEl) tabEl.classList.add("active");

    document.querySelector(".sidebar").classList.remove("open");

    if (viewId === "books") {
      renderBooksView();
      return;
    }

    if (viewId === "analytics") {
      renderAnalyticsView();
      return;
    }

    if (viewId === "dashboard") {
      renderAll();
    }
  }

  function renderMonthHeader() {
    const name = `${MONTH_NAMES[state.currentMonth]} ${state.currentYear}`;
    const monthName = document.getElementById("monthName");
    if (monthName) monthName.textContent = name;
  }

  function renderSummary() {
    const monthData = getCurrentMonthData();
    const habits = getSortedDailyHabits();
    const totalDays = daysInMonth(state.currentYear, state.currentMonth);

    let completed = 0;
    let goal = 0;

    habits.forEach((habit) => {
      let activeDays = 0;
      for (let d = 1; d <= totalDays; d++) {
        if (
          !isHabitTrackedOnDate(habit, state.currentYear, state.currentMonth, d)
        ) {
          continue;
        }
        activeDays += 1;
        if (
          monthData.dailyCompletions[habit.id] &&
          monthData.dailyCompletions[habit.id][d]
        ) {
          completed += 1;
        }
      }
      goal += Math.min(habit.monthGoal || totalDays, activeDays);
    });

    const totalCompleted = document.getElementById("totalCompleted");
    const totalGoal = document.getElementById("totalGoal");
    if (totalCompleted) totalCompleted.textContent = String(completed);
    if (totalGoal) totalGoal.textContent = String(goal);

    const pct = goal > 0 ? Math.round((completed / goal) * 100) : 0;
    renderDonut("summaryDonut", pct);
  }

  function renderDonut(canvasId, pct) {
    if (typeof Chart === "undefined") return;
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    if (chartInstances[canvasId]) {
      chartInstances[canvasId].destroy();
    }

    const ctx = canvas.getContext("2d");
    chartInstances[canvasId] = new Chart(ctx, {
      type: "doughnut",
      data: {
        datasets: [
          {
            data: [pct, 100 - pct],
            backgroundColor: ["#58a5d1", "#1a2840"],
            borderWidth: 0,
          },
        ],
      },
      options: {
        cutout: "72%",
        responsive: false,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
      },
      plugins: [
        {
          id: "centerText",
          afterDraw(chart) {
            const { ctx: c, width, height } = chart;
            c.save();
            c.font = "bold 20px Inter, sans-serif";
            c.fillStyle = "#d5e2f5";
            c.textAlign = "center";
            c.textBaseline = "middle";
            c.fillText(`${pct}%`, width / 2, height / 2);
            c.restore();
          },
        },
      ],
    });
  }

  function renderWeeklySummaryCards() {
    const container = document.getElementById("weeklySummaryCards");
    if (!container) return;

    const monthData = getCurrentMonthData();
    const habits = getSortedDailyHabits();
    const totalDays = daysInMonth(state.currentYear, state.currentMonth);
    const maxWeek = Math.min(5, Math.ceil(totalDays / 7));

    let html = "";
    for (let week = 1; week <= maxWeek; week++) {
      const start = (week - 1) * 7 + 1;
      const end = Math.min(week * 7, totalDays);
      let done = 0;
      let possible = 0;

      habits.forEach((habit) => {
        for (let day = start; day <= end; day++) {
          if (
            !isHabitTrackedOnDate(
              habit,
              state.currentYear,
              state.currentMonth,
              day,
            )
          ) {
            continue;
          }
          possible += 1;
          if (
            monthData.dailyCompletions[habit.id] &&
            monthData.dailyCompletions[habit.id][day]
          ) {
            done += 1;
          }
        }
      });

      const pct = possible > 0 ? Math.round((done / possible) * 100) : 0;
      html += `<div class="week-card"><span class="week-card-title">Week ${week}</span><div class="week-pct">${pct}%</div></div>`;
    }

    container.innerHTML = html;
  }

  function renderDailyBarChart() {
    if (typeof Chart === "undefined") return;
    const canvas = document.getElementById("dailyBarChart");
    if (!canvas) return;

    const monthData = getCurrentMonthData();
    const habits = getSortedDailyHabits();
    const totalDays = daysInMonth(state.currentYear, state.currentMonth);

    const labels = [];
    const values = [];
    for (let day = 1; day <= totalDays; day++) {
      labels.push(day);
      let count = 0;
      habits.forEach((habit) => {
        if (
          !isHabitTrackedOnDate(
            habit,
            state.currentYear,
            state.currentMonth,
            day,
          )
        ) {
          return;
        }
        if (
          monthData.dailyCompletions[habit.id] &&
          monthData.dailyCompletions[habit.id][day]
        ) {
          count += 1;
        }
      });
      values.push(count);
    }

    if (chartInstances.dailyBarChart) {
      chartInstances.dailyBarChart.destroy();
    }

    chartInstances.dailyBarChart = new Chart(canvas.getContext("2d"), {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            data: values,
            backgroundColor: "#3e85b5",
            borderRadius: 4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
      },
    });
  }

  function renderCategoryBarChart() {
    if (typeof Chart === "undefined") return;
    const canvas = document.getElementById("categoryBarChart");
    if (!canvas) return;

    const monthData = getCurrentMonthData();
    const totalDays = daysInMonth(state.currentYear, state.currentMonth);
    const habits = getSortedDailyHabits();

    const map = {};
    state.categories.forEach((c) => {
      map[c.id] = { name: c.name, emoji: c.emoji, completed: 0 };
    });

    habits.forEach((habit) => {
      const bucket = map[habit.categoryId];
      if (!bucket) return;
      for (let day = 1; day <= totalDays; day++) {
        if (
          !isHabitTrackedOnDate(
            habit,
            state.currentYear,
            state.currentMonth,
            day,
          )
        ) {
          continue;
        }
        if (
          monthData.dailyCompletions[habit.id] &&
          monthData.dailyCompletions[habit.id][day]
        ) {
          bucket.completed += 1;
        }
      }
    });

    const entries = Object.values(map).filter((x) => x.completed > 0);
    if (entries.length === 0) {
      if (chartInstances.categoryBarChart) {
        chartInstances.categoryBarChart.destroy();
      }
      return;
    }

    if (chartInstances.categoryBarChart) {
      chartInstances.categoryBarChart.destroy();
    }

    chartInstances.categoryBarChart = new Chart(canvas.getContext("2d"), {
      type: "bar",
      data: {
        labels: entries.map((e) => `${e.emoji} ${e.name}`),
        datasets: [
          {
            data: entries.map((e) => e.completed),
            backgroundColor: "#58a5d1",
          },
        ],
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
      },
    });
  }

  function safeMonthData(year, month) {
    const key = monthKey(year, month);
    const monthData = state.months[key];
    if (!isPlainObject(monthData)) {
      return getDefaultMonthData();
    }
    return ensureMonthDataShape(monthData);
  }

  function buildMonthTotals(year, month) {
    const monthData = safeMonthData(year, month);
    const habits = getSortedDailyHabits();
    const totalDays = daysInMonth(year, month);
    let done = 0;
    let possible = 0;

    for (let day = 1; day <= totalDays; day++) {
      habits.forEach((habit) => {
        if (!isHabitTrackedOnDate(habit, year, month, day)) return;
        possible += 1;
        if (
          monthData.dailyCompletions[habit.id] &&
          monthData.dailyCompletions[habit.id][day]
        ) {
          done += 1;
        }
      });
    }

    return { done, possible, totalDays, monthData, habits };
  }

  function buildWeeklyAnalytics(year, month) {
    const totals = buildMonthTotals(year, month);
    const maxWeek = Math.max(1, Math.min(5, Math.ceil(totals.totalDays / 7)));

    const weekBuckets = Array.from({ length: maxWeek }, (_, index) => ({
      label: `Week ${index + 1}`,
      done: 0,
      possible: 0,
      weekdays: Array.from({ length: 7 }, () => ({ done: 0, possible: 0 })),
    }));

    const categoryWeek = {};
    state.categories.forEach((category) => {
      categoryWeek[category.id] = Array.from({ length: maxWeek }, () => ({
        done: 0,
        possible: 0,
      }));
    });

    for (let day = 1; day <= totals.totalDays; day++) {
      const weekIndex = Math.min(maxWeek - 1, Math.floor((day - 1) / 7));
      const weekday = new Date(year, month, day).getDay();

      totals.habits.forEach((habit) => {
        if (!isHabitTrackedOnDate(habit, year, month, day)) return;

        weekBuckets[weekIndex].possible += 1;
        weekBuckets[weekIndex].weekdays[weekday].possible += 1;

        if (!categoryWeek[habit.categoryId]) {
          categoryWeek[habit.categoryId] = Array.from(
            { length: maxWeek },
            () => ({
              done: 0,
              possible: 0,
            }),
          );
        }
        categoryWeek[habit.categoryId][weekIndex].possible += 1;

        const done = !!(
          totals.monthData.dailyCompletions[habit.id] &&
          totals.monthData.dailyCompletions[habit.id][day]
        );

        if (done) {
          weekBuckets[weekIndex].done += 1;
          weekBuckets[weekIndex].weekdays[weekday].done += 1;
          categoryWeek[habit.categoryId][weekIndex].done += 1;
        }
      });
    }

    return { weekBuckets, categoryWeek };
  }

  function buildMonthlyTimeline(monthCount = 12) {
    const timeline = [];
    for (let offset = monthCount - 1; offset >= 0; offset--) {
      const dt = new Date(state.currentYear, state.currentMonth - offset, 1);
      const year = dt.getFullYear();
      const month = dt.getMonth();
      const totals = buildMonthTotals(year, month);

      const byCategory = {};
      state.categories.forEach((category) => {
        byCategory[category.id] = { done: 0, possible: 0 };
      });

      for (let day = 1; day <= totals.totalDays; day++) {
        totals.habits.forEach((habit) => {
          if (!isHabitTrackedOnDate(habit, year, month, day)) return;
          if (!byCategory[habit.categoryId]) {
            byCategory[habit.categoryId] = { done: 0, possible: 0 };
          }
          byCategory[habit.categoryId].possible += 1;
          if (
            totals.monthData.dailyCompletions[habit.id] &&
            totals.monthData.dailyCompletions[habit.id][day]
          ) {
            byCategory[habit.categoryId].done += 1;
          }
        });
      }

      timeline.push({
        label: `${MONTH_NAMES[month].slice(0, 3)} ${String(year).slice(-2)}`,
        done: totals.done,
        possible: totals.possible,
        byCategory,
      });
    }
    return timeline;
  }

  function getMonthStreakLeaderboard(limit = 10) {
    const totalDays = daysInMonth(state.currentYear, state.currentMonth);
    const monthData = getCurrentMonthData();
    const now = new Date();
    const isCurrentMonth =
      now.getFullYear() === state.currentYear &&
      now.getMonth() === state.currentMonth;
    const endDay = isCurrentMonth ? now.getDate() : totalDays;

    const rows = getSortedDailyHabits().map((habit) => {
      let streak = 0;
      let trackedDays = 0;
      for (let day = 1; day <= endDay; day++) {
        if (
          isHabitTrackedOnDate(
            habit,
            state.currentYear,
            state.currentMonth,
            day,
          )
        ) {
          trackedDays += 1;
        }
      }

      for (let day = endDay; day >= 1; day--) {
        if (
          !isHabitTrackedOnDate(
            habit,
            state.currentYear,
            state.currentMonth,
            day,
          )
        ) {
          continue;
        }
        const done = !!(
          monthData.dailyCompletions[habit.id] &&
          monthData.dailyCompletions[habit.id][day]
        );
        if (!done) break;
        streak += 1;
      }

      const cat = getCategoryById(habit.categoryId);
      return {
        label: `${getHabitEmoji(habit)} ${habit.name}`,
        done: streak,
        possible: Math.max(1, trackedDays),
        color: cat ? cat.color : "#58a5d1",
      };
    });

    return rows
      .sort((a, b) => b.done - a.done)
      .slice(0, limit)
      .filter((row) => row.possible > 0);
  }

  function destroyChart(chartKey) {
    if (!chartInstances[chartKey]) return;
    chartInstances[chartKey].destroy();
    delete chartInstances[chartKey];
  }

  function renderChart(chartKey, canvasId, config) {
    if (typeof Chart === "undefined") return;
    const canvas = document.getElementById(canvasId);
    if (!canvas) {
      destroyChart(chartKey);
      return;
    }
    destroyChart(chartKey);
    chartInstances[chartKey] = new Chart(canvas.getContext("2d"), config);
  }

  function renderWeeklyTrendChart(canvasId, chartKey, weeklyData) {
    const values = weeklyData.weekBuckets.map((bucket) =>
      getMetricValue(bucket.done, bucket.possible),
    );

    renderChart(chartKey, canvasId, {
      type: "line",
      data: {
        labels: weeklyData.weekBuckets.map((bucket) => bucket.label),
        datasets: [
          {
            label: getMetricAxisLabel(),
            data: values,
            borderColor: "#58a5d1",
            backgroundColor: "rgba(88, 165, 209, 0.2)",
            borderWidth: 3,
            fill: true,
            tension: 0.34,
            pointRadius: 4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label(context) {
                return `${getMetricAxisLabel()}: ${getMetricLabel(context.parsed.y)}`;
              },
            },
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            max: getAnalyticsDisplayMode() === "percent" ? 100 : undefined,
            ticks: {
              callback(value) {
                return getAnalyticsDisplayMode() === "percent"
                  ? `${Math.round(value)}%`
                  : value;
              },
            },
          },
        },
      },
    });
  }

  function renderWeeklyCategoryStackedChart(canvasId, chartKey, weeklyData) {
    const labels = weeklyData.weekBuckets.map((bucket) => bucket.label);
    const datasets = state.categories
      .map((category) => {
        const points = labels.map((_, index) => {
          const slot = weeklyData.categoryWeek[category.id]
            ? weeklyData.categoryWeek[category.id][index]
            : { done: 0, possible: 0 };
          return getMetricValue(slot.done, slot.possible);
        });
        const visible = points.some((point) => point > 0);
        if (!visible) return null;
        return {
          label: `${category.emoji} ${category.name}`,
          data: points,
          backgroundColor: category.color || "#58a5d1",
          borderRadius: 4,
        };
      })
      .filter(Boolean);

    renderChart(chartKey, canvasId, {
      type: "bar",
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "bottom" },
          tooltip: {
            callbacks: {
              label(context) {
                return `${context.dataset.label}: ${getMetricLabel(context.parsed.y)}`;
              },
            },
          },
        },
        scales: {
          x: { stacked: true },
          y: {
            stacked: true,
            beginAtZero: true,
            max: getAnalyticsDisplayMode() === "percent" ? 100 : undefined,
            ticks: {
              callback(value) {
                return getAnalyticsDisplayMode() === "percent"
                  ? `${Math.round(value)}%`
                  : value;
              },
            },
          },
        },
      },
    });
  }

  function renderMonthlyTrendChart(canvasId, chartKey, timeline) {
    const values = timeline.map((item) =>
      getMetricValue(item.done, item.possible),
    );
    renderChart(chartKey, canvasId, {
      type: "line",
      data: {
        labels: timeline.map((item) => item.label),
        datasets: [
          {
            data: values,
            borderColor: "#7c8cff",
            backgroundColor: "rgba(124, 140, 255, 0.18)",
            borderWidth: 3,
            fill: true,
            tension: 0.26,
            pointRadius: 3,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label(context) {
                return getMetricLabel(context.parsed.y);
              },
            },
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            max: getAnalyticsDisplayMode() === "percent" ? 100 : undefined,
            ticks: {
              callback(value) {
                return getAnalyticsDisplayMode() === "percent"
                  ? `${Math.round(value)}%`
                  : value;
              },
            },
          },
        },
      },
    });
  }

  function renderMonthlyStreakChart(canvasId, chartKey, rows) {
    renderChart(chartKey, canvasId, {
      type: "bar",
      data: {
        labels: rows.map((row) => row.label),
        datasets: [
          {
            data: rows.map((row) => getMetricValue(row.done, row.possible)),
            backgroundColor: rows.map((row) => row.color),
          },
        ],
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label(context) {
                return getMetricLabel(context.parsed.x);
              },
            },
          },
        },
        scales: {
          x: {
            beginAtZero: true,
            max: getAnalyticsDisplayMode() === "percent" ? 100 : undefined,
            ticks: {
              callback(value) {
                return getAnalyticsDisplayMode() === "percent"
                  ? `${Math.round(value)}%`
                  : value;
              },
            },
          },
        },
      },
    });
  }

  function renderMonthlyCategoryTrendChart(canvasId, chartKey, timeline) {
    const topCategories = state.categories
      .map((category) => {
        const sum = timeline.reduce((acc, item) => {
          const slot = item.byCategory[category.id] || { done: 0 };
          return acc + slot.done;
        }, 0);
        return { category, sum };
      })
      .filter((item) => item.sum > 0)
      .sort((a, b) => b.sum - a.sum)
      .slice(0, 6);

    const datasets = topCategories.map((item) => ({
      label: `${item.category.emoji} ${item.category.name}`,
      data: timeline.map((point) => {
        const slot = point.byCategory[item.category.id] || {
          done: 0,
          possible: 0,
        };
        return getMetricValue(slot.done, slot.possible);
      }),
      borderColor: item.category.color,
      backgroundColor: `${item.category.color}33`,
      fill: false,
      tension: 0.25,
    }));

    renderChart(chartKey, canvasId, {
      type: "line",
      data: {
        labels: timeline.map((item) => item.label),
        datasets,
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "bottom" },
          tooltip: {
            callbacks: {
              label(context) {
                return `${context.dataset.label}: ${getMetricLabel(context.parsed.y)}`;
              },
            },
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            max: getAnalyticsDisplayMode() === "percent" ? 100 : undefined,
            ticks: {
              callback(value) {
                return getAnalyticsDisplayMode() === "percent"
                  ? `${Math.round(value)}%`
                  : value;
              },
            },
          },
        },
      },
    });
  }

  function getHeatColor(strength) {
    const clamped = Math.max(0, Math.min(1, strength));
    const alpha = 0.2 + clamped * 0.75;
    return `rgba(88, 165, 209, ${alpha.toFixed(3)})`;
  }

  function renderWeeklyHeatmap(containerId, weeklyData) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const cells = [];
    weeklyData.weekBuckets.forEach((week) => {
      week.weekdays.forEach((entry) => {
        cells.push(getMetricValue(entry.done, entry.possible));
      });
    });
    const maxValue = Math.max(1, ...cells);

    let html = "<div></div>";
    dayLabels.forEach((label) => {
      html += `<div class='heatmap-head'>${label}</div>`;
    });

    weeklyData.weekBuckets.forEach((week, weekIndex) => {
      html += `<div class='heatmap-week-label'>W${weekIndex + 1}</div>`;
      week.weekdays.forEach((entry) => {
        const value = getMetricValue(entry.done, entry.possible);
        const ratio = maxValue > 0 ? value / maxValue : 0;
        html += `<div class='heatmap-cell' style='background:${getHeatColor(ratio)}' title='Done ${entry.done} / ${entry.possible}'>${getMetricLabel(value)}</div>`;
      });
    });

    container.innerHTML = html;
  }

  function renderDashboardAnalytics() {
    syncAnalyticsModeControls();
    const weeklyData = buildWeeklyAnalytics(
      state.currentYear,
      state.currentMonth,
    );
    const timeline = buildMonthlyTimeline(12);
    const streakRows = getMonthStreakLeaderboard(10);

    renderWeeklyTrendChart("weeklyTrendChart", "weeklyTrendChart", weeklyData);
    renderWeeklyCategoryStackedChart(
      "weeklyCategoryStackedChart",
      "weeklyCategoryStackedChart",
      weeklyData,
    );
    renderMonthlyTrendChart("monthlyTrendChart", "monthlyTrendChart", timeline);
    renderMonthlyStreakChart(
      "monthlyStreakChart",
      "monthlyStreakChart",
      streakRows,
    );
    renderMonthlyCategoryTrendChart(
      "monthlyCategoryTrendChart",
      "monthlyCategoryTrendChart",
      timeline,
    );
    renderWeeklyHeatmap("weeklyHeatmap", weeklyData);
  }

  function renderAnalyticsView() {
    syncAnalyticsModeControls();
    const weeklyData = buildWeeklyAnalytics(
      state.currentYear,
      state.currentMonth,
    );
    const timeline = buildMonthlyTimeline(12);
    const streakRows = getMonthStreakLeaderboard(14);

    renderWeeklyTrendChart(
      "analyticsWeeklyTrendChart",
      "analyticsWeeklyTrendChart",
      weeklyData,
    );
    renderWeeklyCategoryStackedChart(
      "analyticsWeeklyCategoryStackedChart",
      "analyticsWeeklyCategoryStackedChart",
      weeklyData,
    );
    renderMonthlyTrendChart(
      "analyticsMonthlyTrendChart",
      "analyticsMonthlyTrendChart",
      timeline,
    );
    renderMonthlyStreakChart(
      "analyticsMonthlyStreakChart",
      "analyticsMonthlyStreakChart",
      streakRows,
    );
    renderMonthlyCategoryTrendChart(
      "analyticsMonthlyCategoryTrendChart",
      "analyticsMonthlyCategoryTrendChart",
      timeline,
    );
    renderWeeklyHeatmap("analyticsWeeklyHeatmap", weeklyData);
  }

  function updateHabitStreak(habitId) {
    const badge = document.querySelector(
      `.streak-badge[data-streak-habit="${habitId}"]`,
    );
    if (!badge) return;

    const months = Object.keys(state.months).sort();
    let current = 0;
    let best = 0;
    let chain = 0;

    months.forEach((mKey) => {
      const parts = mKey.split("-");
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      const totalDays = daysInMonth(year, month);
      const habit = state.habits.daily.find((h) => h.id === habitId);
      if (!habit) return;
      for (let day = 1; day <= totalDays; day++) {
        if (!isHabitTrackedOnDate(habit, year, month, day)) continue;
        const md = state.months[mKey];
        const done = !!(
          md.dailyCompletions[habitId] && md.dailyCompletions[habitId][day]
        );
        if (done) {
          chain += 1;
          best = Math.max(best, chain);
        } else {
          chain = 0;
        }
      }
    });

    const habit = state.habits.daily.find((h) => h.id === habitId);
    if (habit) {
      const totalDays = daysInMonth(state.currentYear, state.currentMonth);
      const md = getCurrentMonthData();
      for (let day = totalDays; day >= 1; day--) {
        if (
          !isHabitTrackedOnDate(
            habit,
            state.currentYear,
            state.currentMonth,
            day,
          )
        ) {
          continue;
        }
        const done = !!(
          md.dailyCompletions[habitId] && md.dailyCompletions[habitId][day]
        );
        if (!done) break;
        current += 1;
      }
    }

    badge.textContent = `Current ${current}d | Best ${best}d`;
  }

  function renderDailyHabitsGrid() {
    const grid = document.getElementById("dailyHabitsGrid");
    if (!grid) return;

    const monthData = getCurrentMonthData();
    const habits = getSortedDailyHabits();
    const totalDays = daysInMonth(state.currentYear, state.currentMonth);
    const today = new Date();
    const isCurrentMonthView =
      today.getFullYear() === state.currentYear &&
      today.getMonth() === state.currentMonth;
    const todayDay = isCurrentMonthView ? today.getDate() : -1;

    let html =
      "<thead><tr><th class='habit-name-col'>Habits</th><th class='category-col'>Category</th><th class='goal-col'>Goal</th>";
    for (let day = 1; day <= totalDays; day++) {
      const isToday = day === todayDay;
      html += `<th class='day-col ${isToday ? "today" : ""}'>${day}</th>`;
    }
    html += "</tr></thead><tbody>";

    habits.forEach((habit) => {
      const cat = getCategoryById(habit.categoryId);
      const catName = cat ? `${cat.emoji} ${sanitize(cat.name)}` : "-";
      const emoji = sanitize(getHabitEmoji(habit));
      html += `<tr><td class='habit-name-cell'>${emoji} ${sanitize(habit.name)} <span class='streak-badge' data-streak-habit='${habit.id}'>Current 0d | Best 0d</span><span class='habit-actions'><button class='habit-action-btn' onclick="HabitApp.editHabit('${habit.id}')">Edit</button><button class='habit-action-btn delete' onclick="HabitApp.deleteHabit('${habit.id}')">Delete</button></span></td><td class='category-cell'>${catName}</td><td class='goal-cell'>${habit.monthGoal}</td>`;
      for (let day = 1; day <= totalDays; day++) {
        const isToday = day === todayDay;
        if (
          !isHabitTrackedOnDate(
            habit,
            state.currentYear,
            state.currentMonth,
            day,
          )
        ) {
          html += `<td class='day-cell day-cell-off ${isToday ? "today-col" : ""}'><span class='off-day-mark'>OFF</span></td>`;
          continue;
        }
        const checked =
          monthData.dailyCompletions[habit.id] &&
          monthData.dailyCompletions[habit.id][day]
            ? "checked"
            : "";
        const hasNote = !!(
          monthData.dailyNotes[habit.id] &&
          typeof monthData.dailyNotes[habit.id][day] === "string" &&
          monthData.dailyNotes[habit.id][day].trim().length
        );
        html += `<td class='day-cell ${isToday ? "today-col" : ""}'><div class='day-cell-content'><input type='checkbox' class='habit-check ${isToday ? "today-check" : ""}' data-habit='${habit.id}' data-day='${day}' ${checked}><button type='button' class='note-btn ${hasNote ? "has-note" : ""}' data-habit='${habit.id}' data-day='${day}'>📝</button></div></td>`;
      }
      html += "</tr>";
    });

    html += "</tbody>";
    grid.innerHTML = html;

    grid.querySelectorAll(".habit-check").forEach((cb) => {
      cb.addEventListener("change", function () {
        const habitId = this.dataset.habit;
        const day = parseInt(this.dataset.day, 10);
        if (!monthData.dailyCompletions[habitId])
          monthData.dailyCompletions[habitId] = {};
        monthData.dailyCompletions[habitId][day] = this.checked;
        saveState();
        renderSummary();
        renderWeeklySummaryCards();
        renderDailyBarChart();
        renderCategoryBarChart();
        renderDashboardAnalytics();
        renderAnalyticsView();
        updateHabitStreak(habitId);
      });
    });

    grid.querySelectorAll(".note-btn").forEach((btn) => {
      btn.addEventListener("click", function () {
        openNoteModal(this.dataset.habit, parseInt(this.dataset.day, 10));
      });
    });

    habits.forEach((h) => updateHabitStreak(h.id));
  }

  function renderMonthlyReview() {
    const review = getCurrentMonthData().monthlyReview;
    document.getElementById("monthlyWins").value = review.wins || "";
    document.getElementById("monthlyBlockers").value = review.blockers || "";
    document.getElementById("monthlyFocus").value = review.focus || "";
  }

  function saveMonthlyReview() {
    const monthData = getCurrentMonthData();
    monthData.monthlyReview = {
      wins: document.getElementById("monthlyWins").value.trim(),
      blockers: document.getElementById("monthlyBlockers").value.trim(),
      focus: document.getElementById("monthlyFocus").value.trim(),
    };
    saveState();
  }

  function renderCategoriesList() {
    const list = document.getElementById("categoriesList");
    if (!list) return;
    if (state.categories.length === 0) {
      list.innerHTML =
        "<div class='empty-state'><p>No categories yet.</p></div>";
      return;
    }

    list.innerHTML = state.categories
      .map(
        (c) =>
          `<div class='manage-item'><div class='manage-item-info'><span class='manage-item-emoji' style='background:${c.color}18'>${sanitize(c.emoji)}</span><div><div class='manage-item-name'>${sanitize(c.name)}</div><div class='manage-item-meta'>${sanitize(c.color)}</div></div></div><div class='manage-item-actions'><button class='manage-btn' onclick="HabitApp.editCategory('${c.id}')">Edit</button><button class='manage-btn delete' onclick="HabitApp.deleteCategory('${c.id}')">Delete</button></div></div>`,
      )
      .join("");
  }

  function renderDailyHabitsList() {
    const list = document.getElementById("dailyHabitsList");
    if (!list) return;

    const habits = getSortedDailyHabits();
    if (habits.length === 0) {
      list.innerHTML =
        "<div class='empty-state'><p>No daily habits yet.</p></div>";
      return;
    }

    list.innerHTML = habits
      .map((h) => {
        const cat = getCategoryById(h.categoryId);
        return `<div class='manage-item'><div class='manage-item-info'><span class='manage-item-emoji'>${sanitize(getHabitEmoji(h))}</span><div><div class='manage-item-name'>${sanitize(h.name)}</div><div class='manage-item-meta'>${cat ? sanitize(cat.name) : "No category"} · ${h.type}</div></div></div><div class='manage-item-actions'><button class='manage-btn' onclick="HabitApp.editHabit('${h.id}')">Edit</button><button class='manage-btn delete' onclick="HabitApp.deleteHabit('${h.id}')">Delete</button></div></div>`;
      })
      .join("");
  }

  function renderManageView() {
    renderCategoriesList();
    renderDailyHabitsList();
  }

  function openModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add("open");
  }

  function closeModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove("open");
  }

  function openConfirm(title, message, callback) {
    document.getElementById("confirmTitle").textContent = title;
    document.getElementById("confirmMessage").textContent = message;
    confirmCallback = callback;
    openModal("confirmModal");
  }

  function openHabitModal(habitId) {
    editingHabitId = habitId || null;

    const title = document.getElementById("habitModalTitle");
    const name = document.getElementById("habitName");
    const category = document.getElementById("habitCategory");
    const type = document.getElementById("habitScheduleType");
    const goal = document.getElementById("habitGoal");
    const emoji = document.getElementById("habitEmoji");

    category.innerHTML = state.categories
      .map(
        (c) =>
          `<option value='${c.id}'>${sanitize(c.emoji)} ${sanitize(c.name)}</option>`,
      )
      .join("");

    if (editingHabitId) {
      const habit = state.habits.daily.find((h) => h.id === editingHabitId);
      if (!habit) return;
      title.textContent = "Edit Habit";
      name.value = habit.name;
      category.value = habit.categoryId;
      type.value = habit.type || "fixed";
      goal.value = habit.monthGoal || 20;
      emoji.value = getHabitEmoji(habit);
    } else {
      title.textContent = "Add Habit";
      name.value = "";
      goal.value = 20;
      type.value = "fixed";
      emoji.value = "📌";
    }

    document.getElementById("habitTypeGroup").style.display = "none";
    document.getElementById("habitScheduleTypeGroup").style.display = "block";
    document.getElementById("habitGoalGroup").style.display = "block";
    document.getElementById("habitEmojiGroup").style.display = "block";
    document.getElementById("habitExcludedDaysGroup").style.display = "none";

    openModal("habitModal");
  }

  function saveHabitModal() {
    const name = document.getElementById("habitName").value.trim();
    if (!name) return;

    const categoryId = document.getElementById("habitCategory").value;
    const type =
      document.getElementById("habitScheduleType").value === "dynamic"
        ? "dynamic"
        : "fixed";
    const emoji = document.getElementById("habitEmoji").value || "📌";
    const totalDays = daysInMonth(state.currentYear, state.currentMonth);
    const monthGoal = Math.max(
      1,
      Math.min(
        totalDays,
        parseInt(document.getElementById("habitGoal").value, 10) || 20,
      ),
    );

    if (editingHabitId) {
      const habit = state.habits.daily.find((h) => h.id === editingHabitId);
      if (habit) {
        habit.name = name;
        habit.categoryId = categoryId;
        habit.type = type;
        habit.emoji = emoji;
        habit.monthGoal = monthGoal;
      }
    } else {
      state.habits.daily.push({
        id: uid("dh"),
        name,
        categoryId,
        monthGoal,
        type,
        excludedWeekdays: [],
        emoji,
        order: state.habits.daily.length,
      });
    }

    updateHabitOrder();
    saveState();
    closeModal("habitModal");
    renderAll();
  }

  function openCategoryModal(catId) {
    editingCategoryId = catId || null;
    const title = document.getElementById("categoryModalTitle");
    const name = document.getElementById("categoryName");
    const emoji = document.getElementById("categoryEmoji");
    const color = document.getElementById("categoryColor");

    if (editingCategoryId) {
      const cat = state.categories.find((c) => c.id === editingCategoryId);
      if (!cat) return;
      title.textContent = "Edit Category";
      name.value = cat.name;
      emoji.value = cat.emoji;
      color.value = cat.color;
    } else {
      title.textContent = "Add Category";
      name.value = "";
      emoji.value = "⭐";
      color.value = "#3e85b5";
    }

    openModal("categoryModal");
  }

  function saveCategoryModal() {
    const name = document.getElementById("categoryName").value.trim();
    if (!name) return;

    const emoji = document.getElementById("categoryEmoji").value || "⭐";
    const color = document.getElementById("categoryColor").value || "#3e85b5";

    if (editingCategoryId) {
      const cat = state.categories.find((c) => c.id === editingCategoryId);
      if (cat) {
        cat.name = name;
        cat.emoji = emoji;
        cat.color = color;
      }
    } else {
      state.categories.push({ id: uid("cat"), name, emoji, color });
    }

    saveState();
    closeModal("categoryModal");
    renderAll();
  }

  function openNoteModal(habitId, day) {
    const monthData = getCurrentMonthData();
    if (!monthData.dailyNotes[habitId]) {
      monthData.dailyNotes[habitId] = {};
    }

    noteModalState = { habitId, day };
    const habit = state.habits.daily.find((h) => h.id === habitId);
    document.getElementById("noteModalTitle").textContent = habit
      ? `${habit.name} - ${formatDateKey(state.currentYear, state.currentMonth, day)}`
      : "Daily Note";
    document.getElementById("noteText").value =
      monthData.dailyNotes[habitId][day] || "";
    openModal("noteModal");
  }

  function saveNoteModal() {
    if (!noteModalState.habitId || !noteModalState.day) return;
    const monthData = getCurrentMonthData();
    const value = document.getElementById("noteText").value.trim();

    if (!monthData.dailyNotes[noteModalState.habitId]) {
      monthData.dailyNotes[noteModalState.habitId] = {};
    }

    if (value) {
      monthData.dailyNotes[noteModalState.habitId][noteModalState.day] = value;
    } else {
      delete monthData.dailyNotes[noteModalState.habitId][noteModalState.day];
      if (
        Object.keys(monthData.dailyNotes[noteModalState.habitId]).length === 0
      ) {
        delete monthData.dailyNotes[noteModalState.habitId];
      }
    }

    saveState();
    closeModal("noteModal");
    noteModalState = { habitId: null, day: null };
    renderDailyHabitsGrid();
  }

  function deleteHabit(id) {
    const habit = state.habits.daily.find((h) => h.id === id);
    if (!habit) return;

    openConfirm("Delete Habit", `Delete \"${habit.name}\"?`, () => {
      state.habits.daily = state.habits.daily.filter((h) => h.id !== id);
      updateHabitOrder();
      Object.values(state.months).forEach((monthData) => {
        delete monthData.dailyCompletions[id];
        if (monthData.dailyNotes) {
          delete monthData.dailyNotes[id];
        }
      });
      saveState();
      renderAll();
    });
  }

  function deleteCategory(id) {
    const cat = state.categories.find((c) => c.id === id);
    if (!cat) return;

    openConfirm("Delete Category", `Delete \"${cat.name}\"?`, () => {
      state.categories = state.categories.filter((c) => c.id !== id);
      state.habits.daily.forEach((h) => {
        if (h.categoryId === id) h.categoryId = "";
      });
      saveState();
      renderAll();
    });
  }

  function openPdfDatabase() {
    if (idbPromise) return idbPromise;

    idbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(PDF_DB_NAME, PDF_DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(PDF_STORE_NAME)) {
          db.createObjectStore(PDF_STORE_NAME, { keyPath: "fileId" });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error || new Error("IndexedDB open failed"));
    });

    return idbPromise;
  }

  async function idbSavePdfBlob(fileId, blob) {
    const db = await openPdfDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(PDF_STORE_NAME, "readwrite");
      tx.objectStore(PDF_STORE_NAME).put({ fileId, blob, updatedAt: nowIso() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("PDF save failed"));
    });
  }

  async function idbGetPdfBlob(fileId) {
    const db = await openPdfDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(PDF_STORE_NAME, "readonly");
      const req = tx.objectStore(PDF_STORE_NAME).get(fileId);
      req.onsuccess = () => resolve(req.result ? req.result.blob : null);
      req.onerror = () => reject(req.error || new Error("PDF read failed"));
    });
  }

  async function idbDeletePdfBlob(fileId) {
    const db = await openPdfDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(PDF_STORE_NAME, "readwrite");
      tx.objectStore(PDF_STORE_NAME).delete(fileId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("PDF delete failed"));
    });
  }

  function getBookById(bookId) {
    return state.books.items.find((b) => b.bookId === bookId) || null;
  }

  function getActiveBook() {
    return getBookById(state.books.activeBookId);
  }

  async function refreshBookBlobStatus() {
    const entries = await Promise.all(
      state.books.items.map(async (book) => {
        try {
          const blob = await idbGetPdfBlob(book.fileId);
          return [book.bookId, !!blob];
        } catch (_) {
          return [book.bookId, false];
        }
      }),
    );
    booksBlobStatus = Object.fromEntries(entries);
  }

  function setActiveBook(bookId) {
    state.books.activeBookId = bookId;
    saveState();
    renderBooksView();
  }

  async function saveBookFromUpload() {
    const titleInput = document.getElementById("bookTitleInput");
    const authorInput = document.getElementById("bookAuthorInput");
    const fileInput = document.getElementById("bookPdfInput");

    const title = titleInput.value.trim();
    const author = authorInput.value.trim();
    const file =
      fileInput.files && fileInput.files[0] ? fileInput.files[0] : null;

    if (!title) {
      alert("Please enter a book title.");
      return;
    }
    if (!file) {
      alert("Please choose a PDF file.");
      return;
    }
    if (!/\.pdf$/i.test(file.name) || file.type !== "application/pdf") {
      alert("Only PDF files are supported.");
      return;
    }
    if (file.size > MAX_PDF_FILE_SIZE_BYTES) {
      alert("PDF file is too large. Maximum size is 40MB.");
      return;
    }

    const fileId = uid("file");
    const bookId = uid("book");
    const createdAt = nowIso();

    await idbSavePdfBlob(fileId, file);

    state.books.items.push({
      bookId,
      title,
      author,
      fileId,
      fileName: file.name,
      fileSize: file.size,
      createdAt,
      updatedAt: createdAt,
      bookmarks: [],
    });
    state.books.activeBookId = bookId;
    saveState();

    titleInput.value = "";
    authorInput.value = "";
    fileInput.value = "";

    await refreshBookBlobStatus();
    renderBooksView();
  }

  function openBookModal(bookId) {
    bookModalState.editingBookId = bookId || null;
    const titleEl = document.getElementById("bookModalTitle");
    const titleInput = document.getElementById("bookModalTitleInput");
    const authorInput = document.getElementById("bookModalAuthorInput");

    if (bookId) {
      const book = getBookById(bookId);
      if (!book) return;
      titleEl.textContent = "Edit Book Metadata";
      titleInput.value = book.title;
      authorInput.value = book.author || "";
    } else {
      titleEl.textContent = "Add Book Metadata";
      titleInput.value = "";
      authorInput.value = "";
    }

    openModal("bookModal");
  }

  function saveBookModal() {
    const title = document.getElementById("bookModalTitleInput").value.trim();
    const author = document.getElementById("bookModalAuthorInput").value.trim();
    if (!title) {
      alert("Book title is required.");
      return;
    }

    if (bookModalState.editingBookId) {
      const book = getBookById(bookModalState.editingBookId);
      if (book) {
        book.title = title;
        book.author = author;
        book.updatedAt = nowIso();
      }
    } else {
      state.books.items.push({
        bookId: uid("book"),
        title,
        author,
        fileId: uid("file"),
        fileName: "missing.pdf",
        fileSize: 0,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        bookmarks: [],
      });
    }

    saveState();
    closeModal("bookModal");
    renderBooksView();
  }

  async function deleteBook(bookId) {
    const book = getBookById(bookId);
    if (!book) return;

    openConfirm(
      "Delete Book",
      `Delete \"${book.title}\" and all its bookmarks?`,
      async () => {
        state.books.items = state.books.items.filter(
          (b) => b.bookId !== bookId,
        );
        if (state.books.activeBookId === bookId) {
          state.books.activeBookId = state.books.items[0]
            ? state.books.items[0].bookId
            : null;
        }
        saveState();
        try {
          await idbDeletePdfBlob(book.fileId);
        } catch (_) {
          // Non-fatal; metadata is already removed.
        }
        await refreshBookBlobStatus();
        renderBooksView();
      },
    );
  }

  function addBookmarkHistoryEvent(bookmark, type, note) {
    const event = {
      eventId: uid("hist"),
      type,
      at: nowIso(),
      note: String(note || ""),
    };
    bookmark.history = [
      event,
      ...(Array.isArray(bookmark.history) ? bookmark.history : []),
    ].slice(0, MAX_BOOKMARK_HISTORY);
    return event;
  }

  function openBookmarkModal(bookId, bookmarkId, options = {}) {
    const book = getBookById(bookId);
    if (!book) {
      alert("Please select a book first.");
      return;
    }

    bookmarkModalState = {
      editingBookId: bookId,
      editingBookmarkId: bookmarkId || null,
    };

    const title = document.getElementById("bookmarkModalTitle");
    const labelInput = document.getElementById("bookmarkLabel");
    const pdfPageInput = document.getElementById("bookmarkPdfPage");
    const realPageInput = document.getElementById("bookmarkRealPage");
    const noteInput = document.getElementById("bookmarkNote");

    if (bookmarkId) {
      const bm = book.bookmarks.find((b) => b.bookmarkId === bookmarkId);
      if (!bm) return;
      title.textContent = "Edit Bookmark";
      labelInput.value = bm.label;
      pdfPageInput.value = String(bm.pdfPage);
      realPageInput.value =
        bm.realPage === null || bm.realPage === undefined
          ? ""
          : String(bm.realPage);
      noteInput.value = bm.note || "";
    } else {
      title.textContent = "Add Bookmark";
      const prefillPdfPage = parseInt(options.prefillPdfPage, 10);
      const safePrefillPdfPage =
        Number.isFinite(prefillPdfPage) && prefillPdfPage >= 1
          ? prefillPdfPage
          : 1;
      labelInput.value = String(options.label || "");
      // Assign both numeric and string defaults so number inputs keep the value
      // after modal open across different browsers.
      pdfPageInput.value = "";
      pdfPageInput.valueAsNumber = safePrefillPdfPage;
      pdfPageInput.defaultValue = String(safePrefillPdfPage);
      pdfPageInput.setAttribute("value", String(safePrefillPdfPage));
      realPageInput.value =
        options.prefillRealPage === null ||
        options.prefillRealPage === undefined ||
        options.prefillRealPage === ""
          ? ""
          : String(options.prefillRealPage);
      noteInput.value = String(options.note || "");
    }

    openModal("bookmarkModal");

    if (!bookmarkId) {
      const prefillPdfPage = parseInt(options.prefillPdfPage, 10);
      const safePrefillPdfPage =
        Number.isFinite(prefillPdfPage) && prefillPdfPage >= 1
          ? prefillPdfPage
          : 1;
      // Re-apply once after opening in case the browser/UI resets number values.
      requestAnimationFrame(() => {
        pdfPageInput.valueAsNumber = safePrefillPdfPage;
      });
    }
  }

  function saveBookmark() {
    const book = getBookById(bookmarkModalState.editingBookId);
    if (!book) return;

    const label =
      document.getElementById("bookmarkLabel").value.trim() || "Bookmark";
    const pdfPageRaw = document.getElementById("bookmarkPdfPage").value.trim();
    const pdfPage = parseInt(pdfPageRaw, 10);
    if (!Number.isFinite(pdfPage) || pdfPage < 1) {
      alert("PDF page is required and must be 1 or greater.");
      return;
    }
    const realPageRaw = document
      .getElementById("bookmarkRealPage")
      .value.trim();
    let realPage = null;
    if (realPageRaw) {
      const parsedRealPage = parseInt(realPageRaw, 10);
      if (!Number.isFinite(parsedRealPage) || parsedRealPage < 1) {
        alert("Real book page must be empty or 1 or greater.");
        return;
      }
      realPage = parsedRealPage;
    }
    const note = document.getElementById("bookmarkNote").value.trim();

    if (bookmarkModalState.editingBookmarkId) {
      const bm = book.bookmarks.find(
        (b) => b.bookmarkId === bookmarkModalState.editingBookmarkId,
      );
      if (!bm) return;
      bm.label = label;
      bm.pdfPage = pdfPage;
      bm.realPage = realPage;
      bm.note = note;
      bm.updatedAt = nowIso();
      addBookmarkHistoryEvent(bm, "updated", "Bookmark updated");
    } else {
      const ts = nowIso();
      const bookmark = {
        bookmarkId: uid("bm"),
        label,
        pdfPage,
        realPage,
        note,
        createdAt: ts,
        updatedAt: ts,
        history: [],
      };
      addBookmarkHistoryEvent(bookmark, "created", "Bookmark created");
      book.bookmarks.unshift(bookmark);
    }

    book.bookmarks.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    book.updatedAt = nowIso();
    saveState();
    closeModal("bookmarkModal");
    renderBooksView();
  }

  function deleteBookmark(bookId, bookmarkId) {
    const book = getBookById(bookId);
    if (!book) return;
    const bm = book.bookmarks.find((b) => b.bookmarkId === bookmarkId);
    if (!bm) return;

    openConfirm("Delete Bookmark", `Delete bookmark \"${bm.label}\"?`, () => {
      book.bookmarks = book.bookmarks.filter(
        (b) => b.bookmarkId !== bookmarkId,
      );
      book.updatedAt = nowIso();
      saveState();
      renderBooksView();
    });
  }

  function openHistoryEventModal(bookId, bookmarkId, eventId) {
    const book = getBookById(bookId);
    if (!book) return;
    const bookmark = Array.isArray(book.bookmarks)
      ? book.bookmarks.find((b) => b.bookmarkId === bookmarkId)
      : null;
    if (!bookmark) return;
    const event = Array.isArray(bookmark.history)
      ? bookmark.history.find((h) => h.eventId === eventId)
      : null;
    if (!event) return;

    historyEventModalState = {
      editingBookId: bookId,
      editingBookmarkId: bookmarkId,
      editingEventId: eventId,
    };

    document.getElementById("historyEventType").value = String(
      event.type || "updated",
    );
    document.getElementById("historyEventNote").value = String(
      event.note || "",
    );
    openModal("historyEventModal");
  }

  function saveHistoryEventModal() {
    const { editingBookId, editingBookmarkId, editingEventId } =
      historyEventModalState;
    if (!editingBookId || !editingBookmarkId || !editingEventId) return;

    const book = getBookById(editingBookId);
    if (!book) return;
    const bookmark = Array.isArray(book.bookmarks)
      ? book.bookmarks.find((b) => b.bookmarkId === editingBookmarkId)
      : null;
    if (!bookmark) return;
    const event = Array.isArray(bookmark.history)
      ? bookmark.history.find((h) => h.eventId === editingEventId)
      : null;
    if (!event) return;

    const nextType = document.getElementById("historyEventType").value.trim();
    if (!nextType) {
      alert("History title is required.");
      return;
    }

    event.type = nextType;
    event.note = document.getElementById("historyEventNote").value.trim();
    bookmark.updatedAt = nowIso();
    book.updatedAt = bookmark.updatedAt;
    book.bookmarks.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    saveState();
    closeModal("historyEventModal");
    renderBooksView();
  }

  function deleteHistoryEvent(bookId, bookmarkId, eventId) {
    const book = getBookById(bookId);
    if (!book) return;
    const bookmark = Array.isArray(book.bookmarks)
      ? book.bookmarks.find((b) => b.bookmarkId === bookmarkId)
      : null;
    if (!bookmark || !Array.isArray(bookmark.history)) return;
    const event = bookmark.history.find((h) => h.eventId === eventId);
    if (!event) return;

    openConfirm(
      "Delete History Event",
      `Delete history event \"${event.type}\"?`,
      () => {
        bookmark.history = bookmark.history.filter(
          (h) => h.eventId !== eventId,
        );
        bookmark.updatedAt = nowIso();
        book.updatedAt = bookmark.updatedAt;
        book.bookmarks.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
        saveState();
        renderBooksView();
      },
    );
  }

  function addReaderHistoryToBookmark(book, bookmark, page) {
    if (!book || !bookmark) return;
    const safePage = Math.max(1, parseInt(page, 10) || 1);
    // Keep the bookmark's main target in sync with the latest reader action.
    bookmark.pdfPage = safePage;
    bookmark.updatedAt = nowIso();
    addBookmarkHistoryEvent(
      bookmark,
      "reader-note",
      `Reader action on PDF page ${safePage}`,
    );
    book.bookmarks.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    book.updatedAt = nowIso();
    saveState();
  }

  function addBookmarkOnCurrentReaderPage() {
    const book = readerState.book;
    if (!book) return;

    const page = Math.max(1, parseInt(readerState.currentPage, 10) || 1);
    const sourceBookmark = readerState.sourceBookmarkId
      ? book.bookmarks.find(
          (b) => b.bookmarkId === readerState.sourceBookmarkId,
        )
      : null;
    const openedFromSameBookmarkPage =
      !!sourceBookmark && page === readerState.sourcePage;

    if (openedFromSameBookmarkPage) {
      addReaderHistoryToBookmark(book, sourceBookmark, page);
      document.getElementById("readerStatusText").textContent =
        `History added to \"${sourceBookmark.label}\".`;
      return;
    }

    if (!Array.isArray(book.bookmarks) || book.bookmarks.length === 0) {
      openBookmarkModal(book.bookId, null, { prefillPdfPage: page });
      return;
    }

    const useExisting = window.confirm(
      "Add to an existing bookmark history?\n\nOK: Existing bookmark\nCancel: Create new bookmark on this page",
    );

    if (!useExisting) {
      openBookmarkModal(book.bookId, null, { prefillPdfPage: page });
      return;
    }

    const options = book.bookmarks
      .map(
        (bm, idx) =>
          `${idx + 1}. ${bm.label} (PDF ${bm.pdfPage}, Real ${formatRealBookPage(bm.realPage)})`,
      )
      .join("\n");
    const picked = window.prompt(
      `Pick bookmark number to append history:\n${options}`,
      "1",
    );
    if (picked === null) {
      return;
    }
    const index = parseInt(picked, 10) - 1;
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= book.bookmarks.length
    ) {
      alert("Invalid bookmark selection.");
      return;
    }

    const selected = book.bookmarks[index];
    addReaderHistoryToBookmark(book, selected, page);
    document.getElementById("readerStatusText").textContent =
      `History added to \"${selected.label}\".`;
  }

  function openBookmarkInNewTab(bookId, page, bookmarkId) {
    const bookmarkPart = bookmarkId
      ? `&bookmark=${encodeURIComponent(bookmarkId)}`
      : "";
    const url = `${window.location.pathname}?reader=1&book=${encodeURIComponent(bookId)}&page=${encodeURIComponent(page)}${bookmarkPart}`;
    window.open(url, "_blank", "noopener");
  }

  async function renderBooksList() {
    const list = document.getElementById("booksList");
    if (!list) return;

    if (state.books.items.length === 0) {
      list.innerHTML =
        "<div class='empty-state'><p>No books added yet.</p></div>";
      return;
    }

    list.innerHTML = state.books.items
      .map((book) => {
        const active = state.books.activeBookId === book.bookId ? "active" : "";
        const hasBlob = !!booksBlobStatus[book.bookId];
        return `<article class='books-item ${active}'><div class='books-item-main'><h4>${sanitize(book.title)}</h4><p>${sanitize(book.author || "Unknown author")}</p><p class='books-file-meta'>${sanitize(book.fileName)} · ${Math.round((book.fileSize || 0) / 1024)}KB</p>${hasBlob ? "" : "<p class='books-warning'>PDF blob missing in this browser storage.</p>"}</div><div class='books-item-actions'><button class='btn-secondary' type='button' onclick="HabitApp.setActiveBook('${book.bookId}')">Select</button><button class='btn-secondary' type='button' onclick="HabitApp.editBook('${book.bookId}')">Edit</button><button class='btn-danger' type='button' onclick="HabitApp.deleteBook('${book.bookId}')">Delete</button></div></article>`;
      })
      .join("");
  }

  function renderBookmarksPanel() {
    const panel = document.getElementById("bookmarksPanel");
    if (!panel) return;

    const book = getActiveBook();
    if (!book) {
      panel.innerHTML =
        "<div class='empty-state'><p>Select a book to view bookmarks.</p></div>";
      return;
    }

    if (!Array.isArray(book.bookmarks) || book.bookmarks.length === 0) {
      panel.innerHTML =
        "<div class='empty-state'><p>No bookmarks yet. Add your first bookmark.</p></div>";
      return;
    }

    panel.innerHTML = book.bookmarks
      .map((bm) => {
        const historyHtml = (Array.isArray(bm.history) ? bm.history : [])
          .slice(0, 8)
          .map(
            (h) =>
              `<li><div class='bookmark-history-row'><span><strong>${sanitize(h.type)}</strong> · ${sanitize(formatIsoForDisplay(h.at))}${h.note ? ` · ${sanitize(h.note)}` : ""}</span><span class='bookmark-history-actions'><button class='bookmark-history-btn' type='button' onclick="HabitApp.editHistoryEvent('${book.bookId}', '${bm.bookmarkId}', '${h.eventId}')">Edit</button><button class='bookmark-history-btn danger' type='button' onclick="HabitApp.deleteHistoryEvent('${book.bookId}', '${bm.bookmarkId}', '${h.eventId}')">Delete</button></span></div></li>`,
          )
          .join("");

        return `<article class='bookmark-item'><div class='bookmark-main'><h4>${sanitize(bm.label)}</h4><p>PDF page ${bm.pdfPage} · Real page ${formatRealBookPage(bm.realPage)}</p><p>${sanitize(bm.note || "No note")}</p><p class='bookmark-updated'>Updated ${sanitize(formatIsoForDisplay(bm.updatedAt))}</p></div><div class='bookmark-actions'><button class='btn-primary' type='button' onclick="HabitApp.openBookmark('${book.bookId}', ${bm.pdfPage}, '${bm.bookmarkId}')">Open at Bookmark</button><button class='btn-secondary' type='button' onclick="HabitApp.editBookmark('${book.bookId}', '${bm.bookmarkId}')">Edit</button><button class='btn-danger' type='button' onclick="HabitApp.deleteBookmark('${book.bookId}', '${bm.bookmarkId}')">Delete</button></div><ul class='bookmark-history'>${historyHtml || "<li>No history yet.</li>"}</ul></article>`;
      })
      .join("");
  }

  async function renderBooksView() {
    await refreshBookBlobStatus();
    await renderBooksList();
    renderBookmarksPanel();
  }

  function renderAll() {
    renderMonthHeader();
    renderSummary();
    renderWeeklySummaryCards();
    renderDailyBarChart();
    renderCategoryBarChart();
    renderDashboardAnalytics();
    renderDailyHabitsGrid();
    renderMonthlyReview();
    renderManageView();

    if (
      document.getElementById("view-analytics")?.classList.contains("active")
    ) {
      renderAnalyticsView();
    }
  }

  function exportData() {
    alert(
      "Export note: JSON backup includes habits + books metadata only. PDF binaries stored in IndexedDB are not embedded.",
    );

    const blob = new Blob([JSON.stringify(state, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `habit-tracker-backup-${monthKey(state.currentYear, state.currentMonth)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function validateImportedState(imported) {
    const errors = [];

    if (!isPlainObject(imported)) {
      return { ok: false, errors: ["Root value must be an object."] };
    }

    if (!Array.isArray(imported.categories)) {
      errors.push("categories must be an array.");
    }

    if (
      !isPlainObject(imported.habits) ||
      !Array.isArray(imported.habits.daily)
    ) {
      errors.push("habits.daily must be an array.");
    }

    if (!isPlainObject(imported.months)) {
      errors.push("months must be an object.");
    }

    if (imported.books !== undefined) {
      if (!isPlainObject(imported.books)) {
        errors.push("books must be an object when provided.");
      } else {
        if (!Array.isArray(imported.books.items)) {
          errors.push("books.items must be an array.");
        } else {
          imported.books.items.forEach((book, i) => {
            if (!isPlainObject(book)) {
              errors.push(`books.items[${i}] must be an object.`);
              return;
            }
            if (typeof book.bookId !== "string" || !book.bookId.trim()) {
              errors.push(
                `books.items[${i}].bookId must be a non-empty string.`,
              );
            }
            if (
              book.bookmarks !== undefined &&
              !Array.isArray(book.bookmarks)
            ) {
              errors.push(`books.items[${i}].bookmarks must be an array.`);
            }
            if (Array.isArray(book.bookmarks)) {
              book.bookmarks.forEach((bm, j) => {
                if (!isPlainObject(bm)) {
                  errors.push(
                    `books.items[${i}].bookmarks[${j}] must be an object.`,
                  );
                  return;
                }
                if (
                  typeof bm.bookmarkId !== "string" ||
                  !bm.bookmarkId.trim()
                ) {
                  errors.push(
                    `books.items[${i}].bookmarks[${j}].bookmarkId must be a non-empty string.`,
                  );
                }
                if (!Number.isFinite(Number(bm.pdfPage))) {
                  errors.push(
                    `books.items[${i}].bookmarks[${j}].pdfPage must be numeric.`,
                  );
                }
                const hasRealPageValue =
                  bm.realPage !== undefined &&
                  bm.realPage !== null &&
                  String(bm.realPage).trim() !== "";
                if (hasRealPageValue && !Number.isFinite(Number(bm.realPage))) {
                  errors.push(
                    `books.items[${i}].bookmarks[${j}].realPage must be numeric when provided.`,
                  );
                }
                if (bm.history !== undefined && !Array.isArray(bm.history)) {
                  errors.push(
                    `books.items[${i}].bookmarks[${j}].history must be an array.`,
                  );
                }
              });
            }
          });
        }
      }
    }

    return { ok: errors.length === 0, errors };
  }

  function importData(file) {
    const reader = new FileReader();
    reader.onload = function (e) {
      try {
        const imported = JSON.parse(e.target.result);
        const validation = validateImportedState(imported);
        if (!validation.ok) {
          alert(
            `Import failed:\n- ${validation.errors.slice(0, 8).join("\n- ")}`,
          );
          return;
        }
        state = imported;
        migrateState();
        ensureMonthData();
        saveState();
        renderAll();
        renderBooksView();
        alert(
          "Import completed. Note: PDF binaries are not included in JSON and may need re-upload.",
        );
      } catch (_) {
        alert("Failed to parse backup file.");
      }
    };
    reader.readAsText(file);
  }

  function initSidebarCollapse() {
    sidebarCollapsed = localStorage.getItem(SIDEBAR_COLLAPSE_KEY) === "1";
    applySidebarCollapseState();
  }

  function isDesktopViewport() {
    return window.innerWidth > 768;
  }

  function applySidebarCollapseState() {
    const sidebar = document.querySelector(".sidebar");
    const toggle = document.getElementById("sidebarCollapseToggle");
    if (!sidebar || !toggle) return;
    const effective = sidebarCollapsed && isDesktopViewport();
    sidebar.classList.toggle("collapsed", effective);
    toggle.setAttribute("aria-expanded", String(!effective));
  }

  function setSidebarCollapsed(collapsed, persist = true) {
    sidebarCollapsed = !!collapsed;
    applySidebarCollapseState();
    if (persist) {
      localStorage.setItem(SIDEBAR_COLLAPSE_KEY, sidebarCollapsed ? "1" : "0");
    }
  }

  function loadScriptTag(url) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(
        `script[data-pdfjs-url="${url}"]`,
      );

      if (existing) {
        if (existing.dataset.loaded === "1") {
          resolve();
          return;
        }
        if (existing.dataset.failed === "1") {
          reject(new Error(`Script failed earlier: ${url}`));
          return;
        }
        existing.addEventListener("load", () => resolve(), { once: true });
        existing.addEventListener(
          "error",
          () => reject(new Error(`Failed to load script: ${url}`)),
          { once: true },
        );
        return;
      }

      const script = document.createElement("script");
      script.src = url;
      script.async = true;
      script.dataset.pdfjsUrl = url;
      script.addEventListener(
        "load",
        () => {
          script.dataset.loaded = "1";
          resolve();
        },
        { once: true },
      );
      script.addEventListener(
        "error",
        () => {
          script.dataset.failed = "1";
          reject(new Error(`Failed to load script: ${url}`));
        },
        { once: true },
      );
      document.head.appendChild(script);
    });
  }

  async function ensurePdfJsLibLoaded() {
    if (window.pdfjsLib && typeof window.pdfjsLib.getDocument === "function") {
      return window.pdfjsLib;
    }

    for (const url of PDFJS_SCRIPT_URLS) {
      try {
        await loadScriptTag(url);
      } catch (_) {
        continue;
      }

      if (
        window.pdfjsLib &&
        typeof window.pdfjsLib.getDocument === "function"
      ) {
        return window.pdfjsLib;
      }
    }

    return null;
  }

  async function initReaderMode() {
    const params = new URLSearchParams(window.location.search);
    if (params.get("reader") !== "1") {
      return false;
    }

    document.getElementById("app").style.display = "none";
    const readerRoot = document.getElementById("readerMode");
    readerRoot.style.display = "block";
    loadReaderThemePreferences();
    applyReaderThemeClasses();

    const bookId = params.get("book") || "";
    const targetPage = Math.max(1, parseInt(params.get("page"), 10) || 1);
    const sourceBookmarkId = params.get("bookmark") || "";
    const book = getBookById(bookId);
    if (!book) {
      document.getElementById("readerStatusText").textContent =
        "Book metadata not found.";
      return true;
    }

    readerState.book = book;
    readerState.sourceBookmarkId = sourceBookmarkId || null;
    readerState.sourcePage = targetPage;
    document.getElementById("readerBookTitle").textContent = book.title;

    let blob = null;
    try {
      blob = await idbGetPdfBlob(book.fileId);
    } catch (_) {
      blob = null;
    }
    if (!blob) {
      document.getElementById("readerStatusText").textContent =
        "PDF file is missing in IndexedDB for this browser.";
      return true;
    }

    const pdfjsLib = await ensurePdfJsLibLoaded();
    if (!pdfjsLib) {
      document.getElementById("readerStatusText").textContent =
        "PDF.js failed to load. Check your internet and refresh.";
      return true;
    }

    pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;

    const url = URL.createObjectURL(blob);
    try {
      const loadingTask = pdfjsLib.getDocument(url);
      readerState.pdfDoc = await loadingTask.promise;
      readerState.totalPages = readerState.pdfDoc.numPages;
      document.getElementById("readerStatusText").textContent = "Loaded";
      await renderReaderPage(Math.min(targetPage, readerState.totalPages));
    } catch (_) {
      document.getElementById("readerStatusText").textContent =
        "Failed to open PDF.";
    } finally {
      URL.revokeObjectURL(url);
    }

    bindReaderEvents();
    updateReaderThemeControls();
    return true;
  }

  async function renderReaderPage(pageNumber) {
    if (!readerState.pdfDoc) return;

    const safePage = Math.max(1, Math.min(pageNumber, readerState.totalPages));
    readerState.currentPage = safePage;

    const page = await readerState.pdfDoc.getPage(safePage);
    const baseViewport = page.getViewport({ scale: 1 });
    const canvasWrap = document.querySelector(".reader-canvas-wrap");
    const availableWidth = Math.max(
      320,
      (canvasWrap ? canvasWrap.clientWidth : window.innerWidth) - 24,
    );
    const fitScale = availableWidth / baseViewport.width;
    const cssScale = Math.max(1.4, Math.min(fitScale, 2.6));
    const viewport = page.getViewport({ scale: cssScale });

    // Render above CSS pixel resolution for crisper text on high-DPI displays.
    const outputScale = Math.min(window.devicePixelRatio || 1, 3);
    const canvas = document.getElementById("readerCanvas");
    const ctx = canvas.getContext("2d");
    canvas.width = Math.floor(viewport.width * outputScale);
    canvas.height = Math.floor(viewport.height * outputScale);
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;

    if (readerState.renderTask) {
      try {
        readerState.renderTask.cancel();
      } catch (_) {
        // Ignore cancellation race.
      }
    }

    readerState.renderTask = page.render({
      canvasContext: ctx,
      viewport,
      transform: [outputScale, 0, 0, outputScale, 0, 0],
    });
    await readerState.renderTask.promise;
    applyReaderThemeClasses();

    document.getElementById("readerPageIndicator").textContent =
      `${readerState.currentPage} / ${readerState.totalPages}`;
    document.getElementById("readerJumpPage").value = String(
      readerState.currentPage,
    );
  }

  function bindReaderEvents() {
    const prev = document.getElementById("readerPrevPage");
    const next = document.getElementById("readerNextPage");
    const go = document.getElementById("readerGoPage");
    const jump = document.getElementById("readerJumpPage");
    const addBookmarkOnPage = document.getElementById(
      "readerAddBookmarkOnPage",
    );
    const darkToggle = document.getElementById("readerDarkToggle");
    const darkMode = document.getElementById("readerDarkMode");

    prev.addEventListener("click", () =>
      renderReaderPage(readerState.currentPage - 1),
    );
    next.addEventListener("click", () =>
      renderReaderPage(readerState.currentPage + 1),
    );
    go.addEventListener("click", () => {
      renderReaderPage(parseInt(jump.value, 10) || 1);
    });
    jump.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        renderReaderPage(parseInt(jump.value, 10) || 1);
      }
    });

    darkToggle.addEventListener("click", () => {
      toggleReaderDarkTheme();
    });

    darkMode.addEventListener("change", (e) => {
      setReaderDarkMode(e.target.value);
    });

    addBookmarkOnPage.addEventListener("click", () => {
      addBookmarkOnCurrentReaderPage();
    });

    if (!readerState.resizeHandlerBound) {
      window.addEventListener("resize", () => {
        if (!readerState.pdfDoc) return;
        if (readerState.resizeTimer) {
          clearTimeout(readerState.resizeTimer);
        }
        readerState.resizeTimer = setTimeout(() => {
          renderReaderPage(readerState.currentPage);
        }, 120);
      });
      readerState.resizeHandlerBound = true;
    }
  }

  function bindEvents() {
    document.querySelectorAll(".nav-tab").forEach((tab) => {
      tab.addEventListener("click", () => switchView(tab.dataset.view));
    });

    document
      .getElementById("prevMonth")
      .addEventListener("click", () => navigateMonth(-1));
    document
      .getElementById("nextMonth")
      .addEventListener("click", () => navigateMonth(1));

    document
      .getElementById("btnAddDailyHabit")
      .addEventListener("click", () => openHabitModal());
    document
      .getElementById("btnAddDailyManage")
      .addEventListener("click", () => openHabitModal());
    document
      .getElementById("btnAddCategory")
      .addEventListener("click", () => openCategoryModal());

    document
      .getElementById("habitModalClose")
      .addEventListener("click", () => closeModal("habitModal"));
    document
      .getElementById("habitModalCancel")
      .addEventListener("click", () => closeModal("habitModal"));
    document
      .getElementById("habitModalSave")
      .addEventListener("click", saveHabitModal);

    document
      .getElementById("categoryModalClose")
      .addEventListener("click", () => closeModal("categoryModal"));
    document
      .getElementById("categoryModalCancel")
      .addEventListener("click", () => closeModal("categoryModal"));
    document
      .getElementById("categoryModalSave")
      .addEventListener("click", saveCategoryModal);

    document
      .getElementById("noteModalClose")
      .addEventListener("click", () => closeModal("noteModal"));
    document
      .getElementById("noteModalCancel")
      .addEventListener("click", () => closeModal("noteModal"));
    document
      .getElementById("noteModalSave")
      .addEventListener("click", saveNoteModal);

    document
      .getElementById("bookModalClose")
      .addEventListener("click", () => closeModal("bookModal"));
    document
      .getElementById("bookModalCancel")
      .addEventListener("click", () => closeModal("bookModal"));
    document
      .getElementById("bookModalSave")
      .addEventListener("click", saveBookModal);

    document
      .getElementById("bookmarkModalClose")
      .addEventListener("click", () => closeModal("bookmarkModal"));
    document
      .getElementById("bookmarkModalCancel")
      .addEventListener("click", () => closeModal("bookmarkModal"));
    document
      .getElementById("bookmarkModalSave")
      .addEventListener("click", saveBookmark);

    document
      .getElementById("historyEventModalClose")
      .addEventListener("click", () => closeModal("historyEventModal"));
    document
      .getElementById("historyEventModalCancel")
      .addEventListener("click", () => closeModal("historyEventModal"));
    document
      .getElementById("historyEventModalSave")
      .addEventListener("click", saveHistoryEventModal);

    document
      .getElementById("confirmModalClose")
      .addEventListener("click", () => closeModal("confirmModal"));
    document
      .getElementById("confirmCancel")
      .addEventListener("click", () => closeModal("confirmModal"));
    document.getElementById("confirmOk").addEventListener("click", () => {
      closeModal("confirmModal");
      if (confirmCallback) confirmCallback();
      confirmCallback = null;
    });

    document
      .getElementById("monthlyReviewSave")
      .addEventListener("click", saveMonthlyReview);

    const dashboardMode = document.getElementById(
      "analyticsDisplayModeDashboard",
    );
    if (dashboardMode) {
      dashboardMode.addEventListener("change", (event) => {
        setAnalyticsDisplayMode(event.target.value);
      });
    }

    const analyticsMode = document.getElementById(
      "analyticsDisplayModeAnalytics",
    );
    if (analyticsMode) {
      analyticsMode.addEventListener("change", (event) => {
        setAnalyticsDisplayMode(event.target.value);
      });
    }

    document.getElementById("btnExport").addEventListener("click", exportData);
    document.getElementById("btnImport").addEventListener("click", () => {
      document.getElementById("importFile").click();
    });
    document
      .getElementById("importFile")
      .addEventListener("change", function () {
        if (this.files && this.files[0]) {
          importData(this.files[0]);
          this.value = "";
        }
      });

    document.getElementById("btnResetMonth").addEventListener("click", () => {
      openConfirm(
        "Reset Month",
        `Clear all check marks and notes for ${MONTH_NAMES[state.currentMonth]} ${state.currentYear}?`,
        () => {
          state.months[monthKey(state.currentYear, state.currentMonth)] =
            getDefaultMonthData();
          saveState();
          renderAll();
        },
      );
    });

    document.getElementById("btnClearAll").addEventListener("click", () => {
      openConfirm(
        "Clear All Data",
        "This deletes all habits and books metadata. Continue?",
        () => {
          state = getDefaultState();
          saveState();
          renderAll();
          renderBooksView();
        },
      );
    });

    document
      .getElementById("mobileMenuToggle")
      .addEventListener("click", () => {
        document.querySelector(".sidebar").classList.toggle("open");
      });

    document
      .getElementById("sidebarCollapseToggle")
      .addEventListener("click", () => {
        setSidebarCollapsed(!sidebarCollapsed);
      });

    window.addEventListener("resize", applySidebarCollapseState);

    document.querySelectorAll(".emoji-option").forEach((opt) => {
      opt.addEventListener("click", () => {
        const target = document.getElementById(
          opt.dataset.target || "categoryEmoji",
        );
        if (target) target.value = opt.dataset.emoji;
      });
    });

    document.querySelectorAll(".color-option").forEach((opt) => {
      opt.addEventListener("click", () => {
        document.getElementById("categoryColor").value = opt.dataset.color;
      });
    });

    document.querySelectorAll(".modal-overlay").forEach((overlay) => {
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) overlay.classList.remove("open");
      });
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        document
          .querySelectorAll(".modal-overlay.open")
          .forEach((m) => m.classList.remove("open"));
      }
    });

    document.getElementById("btnUploadBook").addEventListener("click", () => {
      saveBookFromUpload().catch((err) => {
        console.error(err);
        alert("Failed to upload PDF.");
      });
    });
    document
      .getElementById("btnBookCreate")
      .addEventListener("click", () => openBookModal());
    document.getElementById("btnAddBookmark").addEventListener("click", () => {
      if (!state.books.activeBookId) {
        alert("Select a book first.");
        return;
      }
      openBookmarkModal(state.books.activeBookId);
    });
  }

  window.HabitApp = {
    editHabit(id) {
      openHabitModal(id);
    },
    deleteHabit,
    editCategory(id) {
      openCategoryModal(id);
    },
    deleteCategory,
    setActiveBook,
    editBook(bookId) {
      openBookModal(bookId);
    },
    deleteBook(bookId) {
      deleteBook(bookId);
    },
    editBookmark(bookId, bookmarkId) {
      openBookmarkModal(bookId, bookmarkId);
    },
    deleteBookmark,
    editHistoryEvent(bookId, bookmarkId, eventId) {
      openHistoryEventModal(bookId, bookmarkId, eventId);
    },
    deleteHistoryEvent,
    openBookmark(bookId, page, bookmarkId) {
      openBookmarkInNewTab(bookId, page, bookmarkId);
    },
  };

  async function init() {
    loadState();
    loadAnalyticsPreferences();
    bindEvents();
    initSidebarCollapse();

    const inReaderMode = await initReaderMode();
    if (inReaderMode) {
      return;
    }

    initTopClock();
    renderAll();
    renderBooksView();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      init().catch((err) => {
        console.error(err);
      });
    });
  } else {
    init().catch((err) => {
      console.error(err);
    });
  }
})();
