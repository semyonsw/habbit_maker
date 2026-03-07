/* ============================================================
   HABIT TRACKER — Application Logic
   ============================================================ */

(function () {
  "use strict";

  // ─── Constants ───────────────────────────────────────────
  const STORAGE_KEY = "habitTracker_v1";
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

  const DEFAULT_CATEGORIES = [
    { id: "cat_health", name: "Health", emoji: "❤️", color: "#EF4444" },
    {
      id: "cat_productivity",
      name: "Productivity",
      emoji: "🧠",
      color: "#3B82F6",
    },
    { id: "cat_fitness", name: "Fitness", emoji: "💪", color: "#22C55E" },
    { id: "cat_family", name: "Family", emoji: "👨‍👩‍👧‍👦", color: "#F97316" },
    { id: "cat_sleep", name: "Sleep", emoji: "😴", color: "#6366F1" },
    { id: "cat_study", name: "Study", emoji: "📚", color: "#8B5CF6" },
    { id: "cat_diet", name: "Diet", emoji: "🥗", color: "#14B8A6" },
    { id: "cat_career", name: "Career", emoji: "💼", color: "#EAB308" },
    { id: "cat_music", name: "Music", emoji: "🎵", color: "#EC4899" },
  ];

  const DEFAULT_DAILY_HABITS = [
    {
      id: "dh_1",
      name: "Morning Bible reading",
      categoryId: "cat_health",
      monthGoal: 30,
      type: "fixed",
      excludedDays: [],
      emoji: "📖",
    },
    {
      id: "dh_2",
      name: "Complete work tasks",
      categoryId: "cat_productivity",
      monthGoal: 28,
      type: "fixed",
      excludedDays: [],
      emoji: "💼",
    },
    {
      id: "dh_3",
      name: "Afternoon Bible reflection",
      categoryId: "cat_health",
      monthGoal: 24,
      type: "fixed",
      excludedDays: [],
      emoji: "🙏",
    },
    {
      id: "dh_4",
      name: "Plan and write tomorrow tasks",
      categoryId: "cat_productivity",
      monthGoal: 24,
      type: "fixed",
      excludedDays: [],
      emoji: "📝",
    },
    {
      id: "dh_5",
      name: "Drink 2L+ water",
      categoryId: "cat_health",
      monthGoal: 24,
      type: "fixed",
      excludedDays: [],
      emoji: "💧",
    },
    {
      id: "dh_6",
      name: "Evening spiritual reading",
      categoryId: "cat_study",
      monthGoal: 24,
      type: "fixed",
      excludedDays: [],
      emoji: "📕",
    },
    {
      id: "dh_7",
      name: "Gym workout",
      categoryId: "cat_fitness",
      monthGoal: 16,
      type: "fixed",
      excludedDays: [],
      emoji: "💪",
    },
    {
      id: "dh_8",
      name: "Read or study book",
      categoryId: "cat_study",
      monthGoal: 14,
      type: "fixed",
      excludedDays: [],
      emoji: "📚",
    },
    {
      id: "dh_9",
      name: "Morning sunlight walk",
      categoryId: "cat_health",
      monthGoal: 18,
      type: "fixed",
      excludedDays: [],
      emoji: "☀️",
    },
  ];

  const HISTORICAL_DAILY_HABITS = DEFAULT_DAILY_HABITS.map((h) => ({ ...h }));

  const HISTORICAL_WEEKLY_HABITS = [
    {
      id: "wh_church",
      name: "Go to church",
      order: 0,
    },
  ];

  const DEFAULT_WEEKLY_HABITS = [
    { id: "wh_1", name: "Eat healthy breakfast", order: 0 },
    { id: "wh_2", name: "Walk with a friend", order: 1 },
    { id: "wh_3", name: "Eat 100g protein", order: 2 },
    { id: "wh_4", name: "Make bed", order: 3 },
    { id: "wh_5", name: "Plan tomorrow's meals", order: 4 },
    { id: "wh_6", name: "Compliment someone", order: 5 },
    { id: "wh_7", name: "Organize workspace", order: 6 },
    { id: "wh_8", name: "Prep healthy lunches", order: 7 },
    { id: "wh_9", name: "Go for a 30 minute run", order: 8 },
    { id: "wh_10", name: "Make quick lunches", order: 9 },
    { id: "wh_11", name: "Do yoga in the morning", order: 10 },
    { id: "wh_12", name: "Track daily meals (LI friend)", order: 11 },
    { id: "wh_13", name: "Take a multivitamin", order: 12 },
    { id: "wh_14", name: "Weigh-in", order: 13 },
    { id: "wh_15", name: "Read one chapter of a book", order: 14 },
    { id: "wh_16", name: "Journal wins and reflections", order: 15 },
    { id: "wh_17", name: "Go to church", order: 16 },
  ];

  // ─── State ───────────────────────────────────────────────
  // Single source of truth for UI rendering and persistence.
  let state = null;
  let chartInstances = {};
  let dragState = null;

  // ─── Utility ─────────────────────────────────────────────
  function uid() {
    return (
      Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8)
    );
  }

  function monthKey(year, month) {
    return `${year}-${String(month + 1).padStart(2, "0")}`;
  }

  function daysInMonth(year, month) {
    return new Date(year, month + 1, 0).getDate();
  }

  function getWeekNumber(day, totalDays) {
    // Week 1 = days 1-7, Week 2 = 8-14, etc.
    return Math.min(Math.ceil(day / 7), 5);
  }

  function getWeekRange(weekNum, totalDays) {
    const start = (weekNum - 1) * 7 + 1;
    const end = Math.min(weekNum * 7, totalDays);
    return { start, end };
  }

  function sanitize(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function getCategoryById(categoryId) {
    return state.categories.find((c) => c.id === categoryId) || null;
  }

  function getHabitEmoji(habit) {
    if (habit.emoji) return habit.emoji;
    const cat = getCategoryById(habit.categoryId);
    return cat ? cat.emoji : "📌";
  }

  function getSortedHabits(type) {
    return [...state.habits[type]].sort(
      (a, b) =>
        (a.order ?? Number.MAX_SAFE_INTEGER) -
        (b.order ?? Number.MAX_SAFE_INTEGER),
    );
  }

  function resequenceHabitOrder(type) {
    const sorted = getSortedHabits(type);
    sorted.forEach((h, idx) => {
      h.order = idx;
    });
  }

  function isDayExcluded(habit, day) {
    return habit.type === "dynamic" && Array.isArray(habit.excludedDays)
      ? habit.excludedDays.includes(day)
      : false;
  }

  function getDailyHabitActiveDays(habit, totalDays) {
    let activeDays = 0;
    for (let d = 1; d <= totalDays; d++) {
      if (!isDayExcluded(habit, d)) activeDays++;
    }
    return activeDays;
  }

  function normalizeHabitName(name) {
    return String(name || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function seedHistoricalHabitsIfNeeded() {
    if (!state.meta || typeof state.meta !== "object") {
      state.meta = {};
    }
    if (state.meta.seededFromOldTasksV1) {
      return;
    }

    const dailyNames = new Set(
      state.habits.daily.map((h) => normalizeHabitName(h.name)),
    );
    HISTORICAL_DAILY_HABITS.forEach((habit) => {
      const normalized = normalizeHabitName(habit.name);
      if (dailyNames.has(normalized)) return;
      state.habits.daily.push({
        id: "dh_" + uid(),
        name: habit.name,
        categoryId: habit.categoryId,
        monthGoal: habit.monthGoal,
        type: "fixed",
        excludedDays: [],
        emoji: habit.emoji,
        order: state.habits.daily.length,
      });
      dailyNames.add(normalized);
    });

    const weeklyNames = new Set(
      state.habits.weekly.map((h) => normalizeHabitName(h.name)),
    );
    HISTORICAL_WEEKLY_HABITS.forEach((habit) => {
      const normalized = normalizeHabitName(habit.name);
      if (weeklyNames.has(normalized)) return;
      state.habits.weekly.push({
        id: "wh_" + uid(),
        name: habit.name,
        order: state.habits.weekly.length,
      });
      weeklyNames.add(normalized);
    });

    state.meta.seededFromOldTasksV1 = true;
  }

  function migrateState() {
    if (!state.categories || !Array.isArray(state.categories)) {
      state.categories = JSON.parse(JSON.stringify(DEFAULT_CATEGORIES));
    }
    if (!state.habits || typeof state.habits !== "object") {
      state.habits = { daily: [], weekly: [] };
    }
    if (!Array.isArray(state.habits.daily)) {
      state.habits.daily = [];
    }
    if (!Array.isArray(state.habits.weekly)) {
      state.habits.weekly = [];
    }
    if (!state.months || typeof state.months !== "object") {
      state.months = {};
    }
    if (!state.meta || typeof state.meta !== "object") {
      state.meta = {};
    }

    seedHistoricalHabitsIfNeeded();

    state.habits.daily.forEach((h, idx) => {
      if (h.order === undefined) h.order = idx;
      if (h.type !== "dynamic" && h.type !== "fixed") h.type = "fixed";
      if (!Array.isArray(h.excludedDays)) h.excludedDays = [];
      h.excludedDays = [
        ...new Set(
          h.excludedDays
            .map((d) => parseInt(d, 10))
            .filter((d) => Number.isInteger(d) && d >= 1 && d <= 31),
        ),
      ].sort((a, b) => a - b);
      if (!h.emoji) {
        const cat = state.categories.find((c) => c.id === h.categoryId);
        h.emoji = cat ? cat.emoji : "📌";
      }
    });

    state.habits.weekly.forEach((h, idx) => {
      if (h.order === undefined) h.order = idx;
    });

    resequenceHabitOrder("daily");
    resequenceHabitOrder("weekly");
  }

  function moveHabit(type, draggedId, targetId) {
    if (!draggedId || !targetId || draggedId === targetId) return;
    const sorted = getSortedHabits(type);
    const from = sorted.findIndex((h) => h.id === draggedId);
    const to = sorted.findIndex((h) => h.id === targetId);
    if (from < 0 || to < 0) return;
    const [moved] = sorted.splice(from, 1);
    sorted.splice(to, 0, moved);
    sorted.forEach((h, idx) => {
      h.order = idx;
    });
    saveState();
    renderAll();
  }

  // ─── State Persistence ───────────────────────────────────
  function getDefaultState() {
    const now = new Date();
    const key = monthKey(now.getFullYear(), now.getMonth());
    return {
      currentYear: now.getFullYear(),
      currentMonth: now.getMonth(), // 0-indexed
      categories: JSON.parse(JSON.stringify(DEFAULT_CATEGORIES)),
      habits: {
        daily: DEFAULT_DAILY_HABITS.map((h, idx) => ({ ...h, order: idx })),
        weekly: DEFAULT_WEEKLY_HABITS.map((h) => ({ ...h })),
      },
      months: {
        [key]: { dailyCompletions: {}, weeklyCompletions: {} },
      },
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        state = JSON.parse(raw);
        migrateState();
        // Ensure current month data exists
        ensureMonthData();
        saveState();
        return;
      }
    } catch (e) {
      console.warn("Failed to load state, using defaults", e);
    }
    state = getDefaultState();
    saveState();
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.error("Failed to save state", e);
    }
  }

  function ensureMonthData() {
    const key = monthKey(state.currentYear, state.currentMonth);
    if (!state.months[key]) {
      state.months[key] = { dailyCompletions: {}, weeklyCompletions: {} };
    }
    if (!state.months[key].dailyCompletions) {
      state.months[key].dailyCompletions = {};
    }
    if (!state.months[key].weeklyCompletions) {
      state.months[key].weeklyCompletions = {};
    }
  }

  function getCurrentMonthData() {
    const key = monthKey(state.currentYear, state.currentMonth);
    return state.months[key];
  }

  // ─── Navigation ──────────────────────────────────────────
  function navigateMonth(delta) {
    state.currentMonth += delta;
    if (state.currentMonth > 11) {
      state.currentMonth = 0;
      state.currentYear++;
    } else if (state.currentMonth < 0) {
      state.currentMonth = 11;
      state.currentYear--;
    }
    ensureMonthData();
    saveState();
    renderAll();
  }

  function switchView(viewId) {
    document
      .querySelectorAll(".view")
      .forEach((v) => v.classList.remove("active"));
    document
      .querySelectorAll(".nav-tab")
      .forEach((t) => t.classList.remove("active"));
    document.getElementById("view-" + viewId).classList.add("active");
    document
      .querySelector(`.nav-tab[data-view="${viewId}"]`)
      .classList.add("active");
    // Close mobile sidebar
    document.querySelector(".sidebar").classList.remove("open");
  }

  // ─── Rendering: Dashboard ────────────────────────────────
  function renderAll() {
    renderMonthHeader();
    renderSummary();
    renderWeeklySummaryCards();
    renderDailyBarChart();
    renderCategoryBarChart();
    renderDailyHabitsGrid();
    renderWeeklyView();
    renderManageView();
  }

  function renderMonthHeader() {
    const name = `${MONTH_NAMES[state.currentMonth]}`;
    document.getElementById("monthName").textContent = name;
    const wEl = document.getElementById("monthNameW");
    if (wEl) wEl.textContent = name;
  }

  function renderSummary() {
    const data = getCurrentMonthData();
    const totalDays = daysInMonth(state.currentYear, state.currentMonth);
    const habits = getSortedHabits("daily");

    let completed = 0;
    let goal = 0;

    habits.forEach((h) => {
      const activeDays = getDailyHabitActiveDays(h, totalDays);
      const effectiveGoal = Math.min(h.monthGoal || totalDays, activeDays);
      goal += effectiveGoal;
      for (let d = 1; d <= totalDays; d++) {
        if (isDayExcluded(h, d)) continue;
        if (data.dailyCompletions[h.id] && data.dailyCompletions[h.id][d]) {
          completed++;
        }
      }
    });

    document.getElementById("totalCompleted").textContent = completed;
    document.getElementById("totalGoal").textContent = goal;

    const pct = goal > 0 ? Math.round((completed / goal) * 100) : 0;
    renderDonut("summaryDonut", pct, 120, 120);
  }

  function renderDonut(canvasId, pct, w, h) {
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
            backgroundColor: ["#7C3AED", "#EDE9FE"],
            borderWidth: 0,
            borderRadius: 6,
          },
        ],
      },
      options: {
        cutout: "72%",
        responsive: false,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { enabled: false },
        },
      },
      plugins: [
        {
          id: "centerText",
          afterDraw(chart) {
            const { ctx, width, height } = chart;
            ctx.save();
            ctx.font = "bold 20px Inter, sans-serif";
            ctx.fillStyle = "#4C1D95";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(pct + "%", width / 2, height / 2);
            ctx.restore();
          },
        },
      ],
    });
  }

  function renderMiniDonut(canvas, pct) {
    if (!canvas) return;
    const id = canvas.id || "mc_" + uid();
    canvas.id = id;

    if (chartInstances[id]) {
      chartInstances[id].destroy();
    }

    const ctx = canvas.getContext("2d");
    chartInstances[id] = new Chart(ctx, {
      type: "doughnut",
      data: {
        datasets: [
          {
            data: [pct, 100 - pct],
            backgroundColor: ["#7C3AED", "#EDE9FE"],
            borderWidth: 0,
            borderRadius: 4,
          },
        ],
      },
      options: {
        cutout: "68%",
        responsive: false,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { enabled: false },
        },
      },
      plugins: [
        {
          id: "centerText",
          afterDraw(chart) {
            const { ctx, width, height } = chart;
            ctx.save();
            ctx.font = "bold 13px Inter, sans-serif";
            ctx.fillStyle = "#4C1D95";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(pct + "%", width / 2, height / 2);
            ctx.restore();
          },
        },
      ],
    });
  }

  function renderWeeklySummaryCards() {
    const container = document.getElementById("weeklySummaryCards");
    const data = getCurrentMonthData();
    const totalDays = daysInMonth(state.currentYear, state.currentMonth);
    const habits = getSortedHabits("daily");
    const numWeeks = Math.ceil(totalDays / 7);

    let html = "";
    for (let w = 1; w <= Math.min(numWeeks, 5); w++) {
      const range = getWeekRange(w, totalDays);
      let completed = 0;
      let total = 0;

      habits.forEach((h) => {
        for (let d = range.start; d <= range.end; d++) {
          if (isDayExcluded(h, d)) continue;
          total++;
          if (data.dailyCompletions[h.id] && data.dailyCompletions[h.id][d]) {
            completed++;
          }
        }
      });

      const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
      const canvasId = `weekDonut_${w}`;
      html += `
                <div class="week-card">
                    <span class="week-card-title">Week ${w}</span>
                    <canvas id="${canvasId}" width="70" height="70"></canvas>
                </div>`;
    }
    container.innerHTML = html;

    // Render mini donuts after DOM update
    for (let w = 1; w <= Math.min(numWeeks, 5); w++) {
      const range = getWeekRange(w, totalDays);
      let completed = 0,
        total = 0;
      habits.forEach((h) => {
        for (let d = range.start; d <= range.end; d++) {
          if (isDayExcluded(h, d)) continue;
          total++;
          if (data.dailyCompletions[h.id] && data.dailyCompletions[h.id][d])
            completed++;
        }
      });
      const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
      renderMiniDonut(document.getElementById(`weekDonut_${w}`), pct);
    }
  }

  // ─── Charts ──────────────────────────────────────────────
  function renderDailyBarChart() {
    const data = getCurrentMonthData();
    const totalDays = daysInMonth(state.currentYear, state.currentMonth);
    const habits = getSortedHabits("daily");

    const labels = [];
    const values = [];
    for (let d = 1; d <= totalDays; d++) {
      labels.push(d);
      let count = 0;
      habits.forEach((h) => {
        if (isDayExcluded(h, d)) return;
        if (data.dailyCompletions[h.id] && data.dailyCompletions[h.id][d])
          count++;
      });
      values.push(count);
    }

    if (chartInstances["dailyBarChart"]) {
      chartInstances["dailyBarChart"].destroy();
    }

    const ctx = document.getElementById("dailyBarChart").getContext("2d");
    chartInstances["dailyBarChart"] = new Chart(ctx, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            data: values,
            backgroundColor: createBarGradient(ctx, totalDays),
            borderRadius: 4,
            borderSkipped: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "#4C1D95",
            titleFont: { family: "Inter" },
            bodyFont: { family: "Inter" },
            callbacks: {
              title: (items) => `Day ${items[0].label}`,
              label: (item) => `${item.raw} habits completed`,
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { font: { size: 10, family: "Inter" }, color: "#6B7280" },
          },
          y: {
            beginAtZero: true,
            grid: { color: "#F3F4F6" },
            ticks: {
              stepSize: 1,
              font: { size: 10, family: "Inter" },
              color: "#6B7280",
            },
          },
        },
      },
    });
  }

  function createBarGradient(ctx, count) {
    const colors = [];
    for (let i = 0; i < count; i++) {
      const ratio = i / count;
      const r = Math.round(139 + (75 - 139) * ratio);
      const g = Math.round(92 + 21 * ratio);
      const b = Math.round(246 - (246 - 168) * ratio);
      colors.push(`rgb(${r}, ${g}, ${b})`);
    }
    return colors;
  }

  function renderCategoryBarChart() {
    const data = getCurrentMonthData();
    const totalDays = daysInMonth(state.currentYear, state.currentMonth);
    const habits = getSortedHabits("daily");

    const catMap = {};
    state.categories.forEach((c) => {
      catMap[c.id] = {
        name: c.name,
        emoji: c.emoji,
        color: c.color,
        completed: 0,
        notCompleted: 0,
      };
    });

    habits.forEach((h) => {
      const cat = catMap[h.categoryId];
      if (!cat) return;
      for (let d = 1; d <= totalDays; d++) {
        if (isDayExcluded(h, d)) continue;
        if (data.dailyCompletions[h.id] && data.dailyCompletions[h.id][d]) {
          cat.completed++;
        } else {
          cat.notCompleted++;
        }
      }
    });

    const cats = Object.values(catMap).filter(
      (c) => c.completed > 0 || c.notCompleted > 0,
    );
    cats.sort((a, b) => b.completed - a.completed);

    const labels = cats.map((c) => c.emoji + " " + c.name);
    const completedData = cats.map((c) => c.completed);
    const notCompletedData = cats.map((c) => c.notCompleted);

    if (chartInstances["categoryBarChart"]) {
      chartInstances["categoryBarChart"].destroy();
    }

    const ctx = document.getElementById("categoryBarChart").getContext("2d");
    chartInstances["categoryBarChart"] = new Chart(ctx, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "Completed",
            data: completedData,
            backgroundColor: "#7C3AED",
            borderRadius: 4,
            borderSkipped: false,
          },
          {
            label: "Not Completed",
            data: notCompletedData,
            backgroundColor: "#EDE9FE",
            borderRadius: 4,
            borderSkipped: false,
          },
        ],
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: "top",
            labels: {
              font: { size: 11, family: "Inter" },
              boxWidth: 12,
              boxHeight: 12,
              borderRadius: 3,
              useBorderRadius: true,
            },
          },
          tooltip: {
            backgroundColor: "#4C1D95",
            titleFont: { family: "Inter" },
            bodyFont: { family: "Inter" },
          },
        },
        scales: {
          x: {
            stacked: true,
            grid: { color: "#F3F4F6" },
            ticks: { font: { size: 10, family: "Inter" }, color: "#6B7280" },
          },
          y: {
            stacked: true,
            grid: { display: false },
            ticks: { font: { size: 11, family: "Inter" }, color: "#374151" },
          },
        },
      },
    });
  }

  // ─── Daily Habits Grid ───────────────────────────────────
  function renderDailyHabitsGrid() {
    const grid = document.getElementById("dailyHabitsGrid");
    const data = getCurrentMonthData();
    const totalDays = daysInMonth(state.currentYear, state.currentMonth);
    const habits = getSortedHabits("daily");
    const today = new Date();
    const isCurrentMonth =
      today.getFullYear() === state.currentYear &&
      today.getMonth() === state.currentMonth;
    const todayDay = isCurrentMonth ? today.getDate() : -1;

    // Header row
    let headerHtml = `<thead><tr>
            <th class="habit-name-col">Habits</th>
            <th class="category-col">Category</th>
            <th class="goal-col">Month Goal</th>`;

    // Week separators
    for (let d = 1; d <= totalDays; d++) {
      const weekNum = getWeekNumber(d, totalDays);
      const isWeekStart =
        d === 1 || getWeekNumber(d - 1, totalDays) !== weekNum;
      const todayClass = d === todayDay ? " today" : "";
      headerHtml += `<th class="day-col${todayClass}" ${isWeekStart ? 'style="border-left: 2px solid #C4B5FD;"' : ""}>${d}</th>`;
    }
    headerHtml += "</tr></thead>";

    // Week header row (spanning)
    let weekHeaderHtml =
      '<thead><tr><th colspan="3" class="habit-name-col" style="border-bottom:none;"></th>';
    let currentWeek = 0;
    for (let d = 1; d <= totalDays; d++) {
      const weekNum = getWeekNumber(d, totalDays);
      if (weekNum !== currentWeek) {
        const range = getWeekRange(weekNum, totalDays);
        const span = range.end - range.start + 1;
        weekHeaderHtml += `<th colspan="${span}" style="text-align:center; background: linear-gradient(135deg, #7C3AED, #6B21A8); color: white; border-radius: 6px 6px 0 0; font-size: 0.7rem; letter-spacing: 1px; padding: 5px 0;">Week ${weekNum}</th>`;
        currentWeek = weekNum;
        // Skip directly to the current week end because we already rendered the span.
        d = range.end; // skip to end of week
      }
    }
    weekHeaderHtml += "</tr></thead>";

    // Body rows
    let bodyHtml = "<tbody>";
    habits.forEach((h) => {
      const cat = getCategoryById(h.categoryId);
      const catName = cat ? cat.emoji + " " + sanitize(cat.name) : "—";
      const catColor = cat ? cat.color : "#7C3AED";
      const catBg = catColor + "18";
      const habitTypeLabel = h.type === "dynamic" ? "Dynamic" : "Fixed";
      const habitEmoji = getHabitEmoji(h);

      bodyHtml += `<tr draggable="true" class="draggable-row" data-habit-type="daily" data-habit-id="${h.id}" data-dnd-surface="daily-grid">
                <td class="habit-name-cell">
            <span class="drag-handle" title="Drag to reorder">⋮⋮</span>
            <span class="habit-leading-emoji">${sanitize(habitEmoji)}</span>
            ${sanitize(h.name)}
            <span class="habit-kind ${h.type === "dynamic" ? "dynamic" : "fixed"}">${habitTypeLabel}</span>
                    <span class="habit-actions">
                        <button class="habit-action-btn" onclick="HabitApp.editHabit('daily','${h.id}')" title="Edit">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        </button>
                        <button class="habit-action-btn delete" onclick="HabitApp.deleteHabit('daily','${h.id}')" title="Delete">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                        </button>
                    </span>
                </td>
                <td class="category-cell">
                    <span class="category-badge" style="background:${catBg}; color:${catColor}">${catName}</span>
                </td>
                <td class="goal-cell">${h.monthGoal || "—"}</td>`;

      for (let d = 1; d <= totalDays; d++) {
        const weekNum = getWeekNumber(d, totalDays);
        const isWeekStart =
          d === 1 || getWeekNumber(d - 1, totalDays) !== weekNum;
        const isExcluded = isDayExcluded(h, d);
        const checked =
          data.dailyCompletions[h.id] && data.dailyCompletions[h.id][d]
            ? "checked"
            : "";
        const todayClass = d === todayDay ? " today-col" : "";
        if (isExcluded) {
          bodyHtml += `<td class="day-cell day-cell-off${todayClass}" ${isWeekStart ? 'style="border-left: 2px solid #EDE9FE;"' : ""}>
                    <span class="off-day-mark" title="Not tracked this day">OFF</span>
                </td>`;
        } else {
          bodyHtml += `<td class="day-cell${todayClass}" ${isWeekStart ? 'style="border-left: 2px solid #EDE9FE;"' : ""}>
                    <input type="checkbox" class="habit-check" data-habit="${h.id}" data-day="${d}" ${checked}>
                </td>`;
        }
      }
      bodyHtml += "</tr>";
    });

    // Completion % row
    bodyHtml +=
      '<tr class="completion-row"><td class="habit-name-cell">Daily Completion</td><td></td><td></td>';
    for (let d = 1; d <= totalDays; d++) {
      let dayCompleted = 0;
      let dayEligible = 0;
      habits.forEach((h) => {
        if (isDayExcluded(h, d)) return;
        dayEligible++;
        if (data.dailyCompletions[h.id] && data.dailyCompletions[h.id][d])
          dayCompleted++;
      });
      const pct =
        dayEligible > 0 ? Math.round((dayCompleted / dayEligible) * 100) : 0;
      const isWeekStart =
        d === 1 ||
        getWeekNumber(d - 1, totalDays) !== getWeekNumber(d, totalDays);
      const todayClass = d === todayDay ? " today-col" : "";
      bodyHtml += `<td class="day-cell${todayClass}" ${isWeekStart ? 'style="border-left: 2px solid #EDE9FE;"' : ""}>${pct}%</td>`;
    }
    bodyHtml += "</tr>";

    // Daily % label row
    bodyHtml +=
      '<tr class="completion-row"><td class="habit-name-cell">Daily % Completed</td><td></td><td></td>';
    for (let d = 1; d <= totalDays; d++) {
      const isWeekStart =
        d === 1 ||
        getWeekNumber(d - 1, totalDays) !== getWeekNumber(d, totalDays);
      bodyHtml += `<td ${isWeekStart ? 'style="border-left: 2px solid #EDE9FE;"' : ""}></td>`;
    }
    bodyHtml += "</tr>";

    bodyHtml += "</tbody>";

    grid.innerHTML = weekHeaderHtml + headerHtml + bodyHtml;

    // Attach checkbox event listeners
    grid.querySelectorAll(".habit-check").forEach((cb) => {
      cb.addEventListener("change", function () {
        const habitId = this.dataset.habit;
        const day = parseInt(this.dataset.day);
        if (!data.dailyCompletions[habitId]) {
          data.dailyCompletions[habitId] = {};
        }
        data.dailyCompletions[habitId][day] = this.checked;
        saveState();
        // Update charts and summary without re-rendering grid
        renderSummary();
        renderWeeklySummaryCards();
        renderDailyBarChart();
        renderCategoryBarChart();
        // Update completion row
        updateCompletionRow(totalDays, habits, data, todayDay);
      });
    });
  }

  function updateCompletionRow(totalDays, habits, data, todayDay) {
    const rows = document.querySelectorAll("#dailyHabitsGrid .completion-row");
    if (!rows[0]) return;
    const cells = rows[0].querySelectorAll("td.day-cell");
    cells.forEach((cell, idx) => {
      const d = idx + 1;
      let dayCompleted = 0;
      let dayEligible = 0;
      habits.forEach((h) => {
        if (isDayExcluded(h, d)) return;
        dayEligible++;
        if (data.dailyCompletions[h.id] && data.dailyCompletions[h.id][d])
          dayCompleted++;
      });
      const pct =
        dayEligible > 0 ? Math.round((dayCompleted / dayEligible) * 100) : 0;
      cell.textContent = pct + "%";
    });
  }

  // ─── Weekly View ─────────────────────────────────────────
  function renderWeeklyView() {
    renderWeeklyProgressCards();
    renderWeeklyHabitsGrid();
  }

  function renderWeeklyProgressCards() {
    const container = document.getElementById("weeklyProgressRow");
    const data = getCurrentMonthData();
    const totalDays = daysInMonth(state.currentYear, state.currentMonth);
    const numWeeks = Math.ceil(totalDays / 7);
    const habits = getSortedHabits("weekly");

    let html = "";
    let overallCompleted = 0;
    let overallGoal = habits.length * Math.min(numWeeks, 5);

    for (let w = 1; w <= Math.min(numWeeks, 5); w++) {
      let completed = 0;
      habits.forEach((h) => {
        if (data.weeklyCompletions[h.id] && data.weeklyCompletions[h.id][w])
          completed++;
      });
      overallCompleted += completed;
      const pct =
        habits.length > 0 ? Math.round((completed / habits.length) * 100) : 0;
      const canvasId = `wpDonut_${w}`;

      html += `
                <div class="weekly-progress-card">
                    <span class="wp-title">Week ${w}</span>
                    <div class="wp-stats">
                        <div><span class="wp-num">${completed}</span><br><span class="wp-label">Completed</span></div>
                        <div><span class="wp-num">${habits.length}</span><br><span class="wp-label">Goal</span></div>
                    </div>
                    <canvas id="${canvasId}" width="70" height="70"></canvas>
                </div>`;
    }

    // Overall card
    const overallPct =
      overallGoal > 0 ? Math.round((overallCompleted / overallGoal) * 100) : 0;
    html += `
            <div class="weekly-progress-card" style="border-color: #7C3AED;">
                <span class="wp-title" style="background: linear-gradient(135deg, #4C1D95, #6B21A8);">Overall</span>
                <div class="wp-stats">
                    <div><span class="wp-num">${overallCompleted}</span><br><span class="wp-label">Completed</span></div>
                    <div><span class="wp-num">${overallGoal}</span><br><span class="wp-label">Goal</span></div>
                </div>
                <canvas id="wpDonut_overall" width="70" height="70"></canvas>
            </div>`;

    container.innerHTML = html;

    // Render mini donuts
    for (let w = 1; w <= Math.min(numWeeks, 5); w++) {
      let completed = 0;
      habits.forEach((h) => {
        if (data.weeklyCompletions[h.id] && data.weeklyCompletions[h.id][w])
          completed++;
      });
      const pct =
        habits.length > 0 ? Math.round((completed / habits.length) * 100) : 0;
      renderMiniDonut(document.getElementById(`wpDonut_${w}`), pct);
    }
    renderMiniDonut(document.getElementById("wpDonut_overall"), overallPct);
  }

  function renderWeeklyHabitsGrid() {
    const grid = document.getElementById("weeklyHabitsGrid");
    const data = getCurrentMonthData();
    const totalDays = daysInMonth(state.currentYear, state.currentMonth);
    const numWeeks = Math.ceil(totalDays / 7);
    const habits = getSortedHabits("weekly");

    let html =
      '<thead><tr><th class="habit-name-col" style="min-width:200px;">Habits</th>';
    for (let w = 1; w <= Math.min(numWeeks, 5); w++) {
      html += `<th class="week-col"><span class="week-col-header">Week ${w}</span></th>`;
    }
    html += "</tr></thead><tbody>";

    habits.forEach((h) => {
      html += `<tr draggable="true" class="draggable-row" data-habit-type="weekly" data-habit-id="${h.id}" data-dnd-surface="weekly-grid"><td class="habit-name-cell">
                <span class="drag-handle" title="Drag to reorder">⋮⋮</span>
                ${sanitize(h.name)}
                <span class="habit-actions">
                    <button class="habit-action-btn" onclick="HabitApp.editHabit('weekly','${h.id}')" title="Edit">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>
                    <button class="habit-action-btn delete" onclick="HabitApp.deleteHabit('weekly','${h.id}')" title="Delete">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    </button>
                </span>
            </td>`;
      for (let w = 1; w <= Math.min(numWeeks, 5); w++) {
        const checked =
          data.weeklyCompletions[h.id] && data.weeklyCompletions[h.id][w]
            ? "checked"
            : "";
        html += `<td class="day-cell"><input type="checkbox" class="habit-check weekly-check" data-habit="${h.id}" data-week="${w}" ${checked}></td>`;
      }
      html += "</tr>";
    });

    html += "</tbody>";
    grid.innerHTML = html;

    // Attach events
    grid.querySelectorAll(".weekly-check").forEach((cb) => {
      cb.addEventListener("change", function () {
        const habitId = this.dataset.habit;
        const week = parseInt(this.dataset.week);
        if (!data.weeklyCompletions[habitId]) {
          data.weeklyCompletions[habitId] = {};
        }
        data.weeklyCompletions[habitId][week] = this.checked;
        saveState();
        renderWeeklyProgressCards();
      });
    });
  }

  // ─── Manage View ─────────────────────────────────────────
  function renderManageView() {
    renderCategoriesList();
    renderDailyHabitsList();
    renderWeeklyHabitsList();
  }

  function renderCategoriesList() {
    const list = document.getElementById("categoriesList");
    if (state.categories.length === 0) {
      list.innerHTML =
        '<div class="empty-state"><p>No categories. Add one to get started.</p></div>';
      return;
    }
    list.innerHTML = state.categories
      .map(
        (c) => `
            <div class="manage-item">
                <div class="manage-item-info">
                    <span class="manage-item-emoji" style="background:${c.color}18">${c.emoji}</span>
                    <div>
                        <div class="manage-item-name">${sanitize(c.name)}</div>
                        <div class="manage-item-meta" style="color:${c.color}">${c.color}</div>
                    </div>
                </div>
                <div class="manage-item-actions">
                    <button class="manage-btn" onclick="HabitApp.editCategory('${c.id}')" title="Edit">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>
                    <button class="manage-btn delete" onclick="HabitApp.deleteCategory('${c.id}')" title="Delete">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    </button>
                </div>
            </div>
        `,
      )
      .join("");
  }

  function renderDailyHabitsList() {
    const list = document.getElementById("dailyHabitsList");
    const habits = getSortedHabits("daily");
    if (habits.length === 0) {
      list.innerHTML =
        '<div class="empty-state"><p>No daily habits. Add one to start tracking.</p></div>';
      return;
    }
    list.innerHTML = habits
      .map((h) => {
        const cat = getCategoryById(h.categoryId);
        const habitEmoji = getHabitEmoji(h);
        return `
            <div class="manage-item" draggable="true" data-habit-type="daily" data-habit-id="${h.id}" data-dnd-surface="manage-daily">
                <div class="manage-item-info">
                    <span class="drag-handle" title="Drag to reorder">⋮⋮</span>
                    <span class="manage-item-emoji" style="background:${cat ? cat.color + "18" : "#EDE9FE"}">${sanitize(habitEmoji)}</span>
                    <div>
                        <div class="manage-item-name">${sanitize(h.name)}</div>
                        <div class="manage-item-meta">${cat ? sanitize(cat.name) : "No category"} · ${h.type === "dynamic" ? "Dynamic" : "Fixed"} · Goal: ${h.monthGoal}</div>
                    </div>
                </div>
                <div class="manage-item-actions">
                    <button class="manage-btn" onclick="HabitApp.editHabit('daily','${h.id}')" title="Edit">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>
                    <button class="manage-btn delete" onclick="HabitApp.deleteHabit('daily','${h.id}')" title="Delete">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    </button>
                </div>
            </div>`;
      })
      .join("");
  }

  function renderWeeklyHabitsList() {
    const list = document.getElementById("weeklyHabitsList");
    const habits = getSortedHabits("weekly");
    if (habits.length === 0) {
      list.innerHTML =
        '<div class="empty-state"><p>No weekly habits. Add one to start tracking.</p></div>';
      return;
    }
    list.innerHTML = habits
      .map(
        (h) => `
            <div class="manage-item" draggable="true" data-habit-type="weekly" data-habit-id="${h.id}" data-dnd-surface="manage-weekly">
                <div class="manage-item-info">
                    <span class="drag-handle" title="Drag to reorder">⋮⋮</span>
                    <span class="manage-item-emoji" style="background:#EDE9FE">📋</span>
                    <div>
                        <div class="manage-item-name">${sanitize(h.name)}</div>
                        <div class="manage-item-meta">Weekly habit</div>
                    </div>
                </div>
                <div class="manage-item-actions">
                    <button class="manage-btn" onclick="HabitApp.editHabit('weekly','${h.id}')" title="Edit">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>
                    <button class="manage-btn delete" onclick="HabitApp.deleteHabit('weekly','${h.id}')" title="Delete">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    </button>
                </div>
            </div>
        `,
      )
      .join("");
  }

  // ─── Modals ──────────────────────────────────────────────
  function openModal(id) {
    document.getElementById(id).classList.add("open");
  }

  function closeModal(id) {
    document.getElementById(id).classList.remove("open");
  }

  let editingHabitId = null;
  let editingHabitType = null;

  function renderExcludedDaysPicker(selectedDays) {
    const container = document.getElementById("habitExcludedDays");
    const totalDays = daysInMonth(state.currentYear, state.currentMonth);
    const selected = new Set(selectedDays || []);
    let html = "";
    for (let d = 1; d <= totalDays; d++) {
      html += `<label class="excluded-day-option"><input type="checkbox" value="${d}" ${selected.has(d) ? "checked" : ""}><span>${d}</span></label>`;
    }
    container.innerHTML = html;
  }

  function updateHabitModalDailyFields(type) {
    const isWeekly = type === "weekly";
    const catGroup = document
      .getElementById("habitCategory")
      .closest(".form-group");
    document.getElementById("habitGoalGroup").style.display = isWeekly
      ? "none"
      : "block";
    document.getElementById("habitEmojiGroup").style.display = isWeekly
      ? "none"
      : "block";
    document.getElementById("habitScheduleTypeGroup").style.display = isWeekly
      ? "none"
      : "block";
    catGroup.style.display = isWeekly ? "none" : "block";

    if (isWeekly) {
      document.getElementById("habitExcludedDaysGroup").style.display = "none";
      return;
    }

    const scheduleType = document.getElementById("habitScheduleType").value;
    document.getElementById("habitExcludedDaysGroup").style.display =
      scheduleType === "dynamic" ? "block" : "none";
  }

  function openHabitModal(type, habitId) {
    editingHabitType = type;
    editingHabitId = habitId || null;

    const titleEl = document.getElementById("habitModalTitle");
    const nameEl = document.getElementById("habitName");
    const catEl = document.getElementById("habitCategory");
    const typeEl = document.getElementById("habitType");
    const emojiEl = document.getElementById("habitEmoji");
    const scheduleTypeEl = document.getElementById("habitScheduleType");
    const goalEl = document.getElementById("habitGoal");
    const typeGroup = document.getElementById("habitTypeGroup");

    // Populate category dropdown
    catEl.innerHTML = state.categories
      .map(
        (c) =>
          `<option value="${c.id}">${c.emoji} ${sanitize(c.name)}</option>`,
      )
      .join("");

    if (habitId) {
      titleEl.textContent = "Edit Habit";
      const list = type === "daily" ? state.habits.daily : state.habits.weekly;
      const habit = list.find((h) => h.id === habitId);
      if (habit) {
        nameEl.value = habit.name;
        if (type === "daily") {
          catEl.value = habit.categoryId;
          goalEl.value = habit.monthGoal || 20;
          emojiEl.value = getHabitEmoji(habit);
          scheduleTypeEl.value = habit.type || "fixed";
          renderExcludedDaysPicker(habit.excludedDays || []);
        }
      }
      typeGroup.style.display = "none";
      typeEl.value = type;
    } else {
      titleEl.textContent = "Add Habit";
      nameEl.value = "";
      typeEl.value = type;
      goalEl.value = 20;
      emojiEl.value = "📌";
      scheduleTypeEl.value = "fixed";
      renderExcludedDaysPicker([]);
      typeGroup.style.display = type ? "none" : "block";
    }

    updateHabitModalDailyFields(type);

    openModal("habitModal");
    nameEl.focus();
  }

  function saveHabitModal() {
    const name = document.getElementById("habitName").value.trim();
    if (!name) return;

    const type = editingHabitType || document.getElementById("habitType").value;
    const catId = document.getElementById("habitCategory").value;
    const totalDays = daysInMonth(state.currentYear, state.currentMonth);
    const goal = Math.max(
      1,
      Math.min(
        totalDays,
        parseInt(document.getElementById("habitGoal").value, 10) || 20,
      ),
    );
    const emoji = document.getElementById("habitEmoji").value || "📌";
    const scheduleType = document.getElementById("habitScheduleType").value;
    const excludedDays = Array.from(
      document.querySelectorAll("#habitExcludedDays input:checked"),
    )
      .map((el) => parseInt(el.value, 10))
      .filter((day) => Number.isInteger(day) && day >= 1 && day <= totalDays)
      .sort((a, b) => a - b);

    if (editingHabitId) {
      const list = type === "daily" ? state.habits.daily : state.habits.weekly;
      const habit = list.find((h) => h.id === editingHabitId);
      if (habit) {
        habit.name = name;
        if (type === "daily") {
          habit.categoryId = catId;
          habit.monthGoal = goal;
          habit.emoji = emoji;
          habit.type = scheduleType;
          habit.excludedDays = scheduleType === "dynamic" ? excludedDays : [];
        }
      }
    } else {
      if (type === "daily") {
        state.habits.daily.push({
          id: "dh_" + uid(),
          name,
          categoryId: catId,
          monthGoal: goal,
          type: scheduleType,
          excludedDays: scheduleType === "dynamic" ? excludedDays : [],
          emoji,
          order: state.habits.daily.length,
        });
      } else {
        state.habits.weekly.push({
          id: "wh_" + uid(),
          name,
          order: state.habits.weekly.length,
        });
      }
    }

    resequenceHabitOrder(type);

    saveState();
    closeModal("habitModal");
    renderAll();
  }

  let editingCategoryId = null;

  function openCategoryModal(catId) {
    editingCategoryId = catId || null;
    const titleEl = document.getElementById("categoryModalTitle");
    const nameEl = document.getElementById("categoryName");
    const emojiEl = document.getElementById("categoryEmoji");
    const colorEl = document.getElementById("categoryColor");

    if (catId) {
      titleEl.textContent = "Edit Category";
      const cat = state.categories.find((c) => c.id === catId);
      if (cat) {
        nameEl.value = cat.name;
        emojiEl.value = cat.emoji;
        colorEl.value = cat.color;
      }
    } else {
      titleEl.textContent = "Add Category";
      nameEl.value = "";
      emojiEl.value = "⭐";
      colorEl.value = "#7C3AED";
    }

    openModal("categoryModal");
    nameEl.focus();
  }

  function saveCategoryModal() {
    const name = document.getElementById("categoryName").value.trim();
    if (!name) return;

    const emoji = document.getElementById("categoryEmoji").value || "⭐";
    const color = document.getElementById("categoryColor").value || "#7C3AED";

    if (editingCategoryId) {
      const cat = state.categories.find((c) => c.id === editingCategoryId);
      if (cat) {
        cat.name = name;
        cat.emoji = emoji;
        cat.color = color;
      }
    } else {
      state.categories.push({
        id: "cat_" + uid(),
        name,
        emoji,
        color,
      });
    }

    saveState();
    closeModal("categoryModal");
    renderAll();
  }

  let confirmCallback = null;

  function openConfirm(title, message, callback) {
    document.getElementById("confirmTitle").textContent = title;
    document.getElementById("confirmMessage").textContent = message;
    confirmCallback = callback;
    openModal("confirmModal");
  }

  // ─── CRUD Operations ─────────────────────────────────────
  function deleteHabit(type, id) {
    const list = type === "daily" ? state.habits.daily : state.habits.weekly;
    const habit = list.find((h) => h.id === id);
    if (!habit) return;

    openConfirm(
      "Delete Habit",
      `Are you sure you want to delete "${habit.name}"?`,
      () => {
        if (type === "daily") {
          state.habits.daily = state.habits.daily.filter((h) => h.id !== id);
          resequenceHabitOrder("daily");
          // Clean up completions
          Object.values(state.months).forEach((m) => {
            delete m.dailyCompletions[id];
          });
        } else {
          state.habits.weekly = state.habits.weekly.filter((h) => h.id !== id);
          resequenceHabitOrder("weekly");
          Object.values(state.months).forEach((m) => {
            delete m.weeklyCompletions[id];
          });
        }
        saveState();
        renderAll();
      },
    );
  }

  function deleteCategory(id) {
    const cat = state.categories.find((c) => c.id === id);
    if (!cat) return;

    openConfirm(
      "Delete Category",
      `Delete "${cat.name}"? Habits in this category will become uncategorized.`,
      () => {
        state.categories = state.categories.filter((c) => c.id !== id);
        // Update habits using this category
        state.habits.daily.forEach((h) => {
          if (h.categoryId === id) h.categoryId = "";
        });
        saveState();
        renderAll();
      },
    );
  }

  // ─── Export / Import ─────────────────────────────────────
  function exportData() {
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

  function importData(file) {
    const reader = new FileReader();
    reader.onload = function (e) {
      try {
        const imported = JSON.parse(e.target.result);
        // Basic validation
        if (
          imported &&
          imported.categories &&
          imported.habits &&
          imported.months
        ) {
          state = imported;
          migrateState();
          ensureMonthData();
          saveState();
          renderAll();
        } else {
          alert("Invalid backup file format.");
        }
      } catch (err) {
        alert("Failed to parse backup file.");
      }
    };
    reader.readAsText(file);
  }

  // ─── Event Binding ───────────────────────────────────────
  function bindEvents() {
    // Navigation tabs
    document.querySelectorAll(".nav-tab").forEach((tab) => {
      tab.addEventListener("click", () => switchView(tab.dataset.view));
    });

    // Month navigation — dashboard
    document
      .getElementById("prevMonth")
      .addEventListener("click", () => navigateMonth(-1));
    document
      .getElementById("nextMonth")
      .addEventListener("click", () => navigateMonth(1));

    // Month navigation — weekly view
    document
      .getElementById("prevMonthW")
      .addEventListener("click", () => navigateMonth(-1));
    document
      .getElementById("nextMonthW")
      .addEventListener("click", () => navigateMonth(1));

    // Add habit buttons
    document
      .getElementById("btnAddDailyHabit")
      .addEventListener("click", () => openHabitModal("daily"));
    document
      .getElementById("btnAddWeeklyHabit")
      .addEventListener("click", () => openHabitModal("weekly"));
    document
      .getElementById("btnAddDailyManage")
      .addEventListener("click", () => openHabitModal("daily"));
    document
      .getElementById("btnAddWeeklyManage")
      .addEventListener("click", () => openHabitModal("weekly"));

    // Add category
    document
      .getElementById("btnAddCategory")
      .addEventListener("click", () => openCategoryModal());

    // Habit modal
    document
      .getElementById("habitModalClose")
      .addEventListener("click", () => closeModal("habitModal"));
    document
      .getElementById("habitModalCancel")
      .addEventListener("click", () => closeModal("habitModal"));
    document
      .getElementById("habitModalSave")
      .addEventListener("click", saveHabitModal);

    // Category modal
    document
      .getElementById("categoryModalClose")
      .addEventListener("click", () => closeModal("categoryModal"));
    document
      .getElementById("categoryModalCancel")
      .addEventListener("click", () => closeModal("categoryModal"));
    document
      .getElementById("categoryModalSave")
      .addEventListener("click", saveCategoryModal);

    // Confirm modal
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

    // Emoji picker
    document.querySelectorAll(".emoji-option").forEach((opt) => {
      opt.addEventListener("click", () => {
        const targetId = opt.dataset.target || "categoryEmoji";
        const input = document.getElementById(targetId);
        if (input) input.value = opt.dataset.emoji;
      });
    });

    // Color presets
    document.querySelectorAll(".color-option").forEach((opt) => {
      opt.addEventListener("click", () => {
        document.getElementById("categoryColor").value = opt.dataset.color;
      });
    });

    // Habit type toggle
    document
      .getElementById("habitType")
      .addEventListener("change", function () {
        updateHabitModalDailyFields(this.value);
      });
    document
      .getElementById("habitScheduleType")
      .addEventListener("change", function () {
        if (this.value === "dynamic") {
          renderExcludedDaysPicker(
            Array.from(
              document.querySelectorAll("#habitExcludedDays input:checked"),
            ).map((el) => parseInt(el.value, 10)),
          );
        }
        updateHabitModalDailyFields(
          editingHabitType || document.getElementById("habitType").value,
        );
      });

    // Export / Import
    document.getElementById("btnExport").addEventListener("click", exportData);
    document.getElementById("btnImport").addEventListener("click", () => {
      document.getElementById("importFile").click();
    });
    document
      .getElementById("importFile")
      .addEventListener("change", function () {
        if (this.files[0]) {
          importData(this.files[0]);
          this.value = "";
        }
      });

    // Reset month
    document.getElementById("btnResetMonth").addEventListener("click", () => {
      openConfirm(
        "Reset Month",
        `Clear all check marks for ${MONTH_NAMES[state.currentMonth]} ${state.currentYear}?`,
        () => {
          const key = monthKey(state.currentYear, state.currentMonth);
          state.months[key] = { dailyCompletions: {}, weeklyCompletions: {} };
          saveState();
          renderAll();
        },
      );
    });

    // Clear all
    document.getElementById("btnClearAll").addEventListener("click", () => {
      openConfirm(
        "Clear All Data",
        "This will delete ALL habits, categories, and progress. This cannot be undone!",
        () => {
          localStorage.removeItem(STORAGE_KEY);
          state = getDefaultState();
          saveState();
          renderAll();
        },
      );
    });

    // Mobile menu toggle
    document
      .getElementById("mobileMenuToggle")
      .addEventListener("click", () => {
        document.querySelector(".sidebar").classList.toggle("open");
      });

    // Close sidebar on outside click (mobile)
    document.addEventListener("click", (e) => {
      const sidebar = document.querySelector(".sidebar");
      const toggle = document.getElementById("mobileMenuToggle");
      if (
        sidebar.classList.contains("open") &&
        !sidebar.contains(e.target) &&
        !toggle.contains(e.target)
      ) {
        sidebar.classList.remove("open");
      }
    });

    // Close modals on overlay click
    document.querySelectorAll(".modal-overlay").forEach((overlay) => {
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) {
          overlay.classList.remove("open");
        }
      });
    });

    // Keyboard: Enter to save modals, Escape to close
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        document
          .querySelectorAll(".modal-overlay.open")
          .forEach((m) => m.classList.remove("open"));
      }
    });

    document.getElementById("habitName").addEventListener("keydown", (e) => {
      if (e.key === "Enter") saveHabitModal();
    });

    document.getElementById("categoryName").addEventListener("keydown", (e) => {
      if (e.key === "Enter") saveCategoryModal();
    });

    // Drag and drop reordering
    document.addEventListener("dragstart", (e) => {
      const row = e.target.closest("[draggable='true'][data-habit-id]");
      if (!row) return;
      dragState = {
        type: row.dataset.habitType,
        habitId: row.dataset.habitId,
        surface: row.dataset.dndSurface,
      };
      row.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", row.dataset.habitId);
    });

    document.addEventListener("dragover", (e) => {
      const target = e.target.closest("[draggable='true'][data-habit-id]");
      if (!target || !dragState) return;
      if (
        target.dataset.habitType !== dragState.type ||
        target.dataset.dndSurface !== dragState.surface
      ) {
        return;
      }
      e.preventDefault();
      target.classList.add("drop-target");
    });

    document.addEventListener("dragleave", (e) => {
      const target = e.target.closest("[draggable='true'][data-habit-id]");
      if (target) target.classList.remove("drop-target");
    });

    document.addEventListener("drop", (e) => {
      const target = e.target.closest("[draggable='true'][data-habit-id]");
      if (!target || !dragState) return;
      if (
        target.dataset.habitType !== dragState.type ||
        target.dataset.dndSurface !== dragState.surface
      ) {
        return;
      }
      e.preventDefault();
      target.classList.remove("drop-target");
      moveHabit(dragState.type, dragState.habitId, target.dataset.habitId);
      dragState = null;
    });

    document.addEventListener("dragend", () => {
      dragState = null;
      document
        .querySelectorAll(".dragging, .drop-target")
        .forEach((el) => el.classList.remove("dragging", "drop-target"));
    });
  }

  // ─── Public API (for inline onclick handlers) ────────────
  window.HabitApp = {
    editHabit: function (type, id) {
      openHabitModal(type, id);
    },
    deleteHabit: deleteHabit,
    editCategory: function (id) {
      openCategoryModal(id);
    },
    deleteCategory: deleteCategory,
  };

  // ─── Init ────────────────────────────────────────────────
  function init() {
    loadState();
    bindEvents();
    renderAll();
  }

  // Start when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
