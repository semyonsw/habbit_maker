"use strict";

import { state } from "./state.js";
import { chartInstances } from "./state.js";
import { MONTH_NAMES } from "./constants.js";
import {
  daysInMonth,
  monthKey,
  getValueColor,
  getHeatColor,
  getMonthCalendarWeekLayout,
  formatIsoWeekRangeLabel,
  isPlainObject,
} from "./utils.js?v=2";
import {
  getCurrentMonthData,
  getDefaultMonthData,
  ensureMonthDataShape,
  getHabitEmoji,
} from "./persistence.js";
import { getSortedDailyHabits, isHabitTrackedOnDate } from "./habits.js";
import {
  getMetricValue,
  getMetricLabel,
  getMetricAxisLabel,
  syncAnalyticsModeControls,
  getAnalyticsDisplayMode,
} from "./preferences.js";
import { getCategoryById } from "./persistence.js";
import { registerRenderer, callRenderer } from "./render-registry.js";

export function safeMonthData(year, month) {
  const key = monthKey(year, month);
  const monthData = state.months[key];
  if (!isPlainObject(monthData)) {
    return getDefaultMonthData();
  }
  return ensureMonthDataShape(monthData);
}

export function buildMonthTotals(year, month) {
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

export function buildWeeklyAnalytics(year, month) {
  const totals = buildMonthTotals(year, month);
  const { weeks, dayToWeek } = getMonthCalendarWeekLayout(year, month);
  const maxWeek = Math.max(1, weeks.length);
  const createMetricBucket = () => ({ done: 0, possible: 0 });
  const ensureCategoryWeekBucket = (categoryId, weekIndex) => {
    if (!Array.isArray(categoryWeek[categoryId])) {
      categoryWeek[categoryId] = [];
    }
    if (!categoryWeek[categoryId][weekIndex]) {
      categoryWeek[categoryId][weekIndex] = createMetricBucket();
    }
    return categoryWeek[categoryId][weekIndex];
  };

  const isoWeekToIndex = {};
  weeks.forEach((w, idx) => {
    isoWeekToIndex[w.week] = idx;
  });

  const weekBuckets = weeks.length
    ? weeks.map((w) => ({
        isoWeek: w.week,
        label: `W${w.week}`,
        rangeLabel: formatIsoWeekRangeLabel(w.fullStart, w.fullEnd),
        done: 0,
        possible: 0,
        weekdays: Array.from({ length: 7 }, createMetricBucket),
      }))
    : [
        {
          isoWeek: 0,
          label: "W?",
          rangeLabel: "",
          done: 0,
          possible: 0,
          weekdays: Array.from({ length: 7 }, createMetricBucket),
        },
      ];

  const categoryWeek = {};
  state.categories.forEach((category) => {
    categoryWeek[category.id] = Array.from(
      { length: maxWeek },
      createMetricBucket,
    );
  });

  for (let day = 1; day <= totals.totalDays; day++) {
    const week = dayToWeek[day];
    if (!week) continue;
    const weekIndex = isoWeekToIndex[week];
    if (weekIndex == null || !weekBuckets[weekIndex]) continue;
    const weekday = new Date(year, month, day).getDay();

    totals.habits.forEach((habit) => {
      if (!isHabitTrackedOnDate(habit, year, month, day)) return;

      const bucket = weekBuckets[weekIndex];
      if (!bucket) return;
      if (!Array.isArray(bucket.weekdays)) {
        bucket.weekdays = Array.from({ length: 7 }, createMetricBucket);
      }
      if (!bucket.weekdays[weekday]) {
        bucket.weekdays[weekday] = createMetricBucket();
      }
      const weekdayBucket = bucket.weekdays[weekday];

      bucket.possible += 1;
      if (weekdayBucket) weekdayBucket.possible += 1;

      const categoryBucket = ensureCategoryWeekBucket(
        habit.categoryId,
        weekIndex,
      );
      if (categoryBucket) categoryBucket.possible += 1;

      const done = !!(
        totals.monthData.dailyCompletions[habit.id] &&
        totals.monthData.dailyCompletions[habit.id][day]
      );

      if (done) {
        bucket.done += 1;
        if (weekdayBucket) weekdayBucket.done += 1;
        if (categoryBucket) categoryBucket.done += 1;
      }
    });
  }

  return { weekBuckets, categoryWeek };
}

export function buildMonthlyTimeline(monthCount = 12) {
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

export function getMonthStreakLeaderboard(limit = 10) {
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
        isHabitTrackedOnDate(habit, state.currentYear, state.currentMonth, day)
      ) {
        trackedDays += 1;
      }
    }

    for (let day = endDay; day >= 1; day--) {
      if (
        !isHabitTrackedOnDate(habit, state.currentYear, state.currentMonth, day)
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

export function destroyChart(chartKey) {
  if (!chartInstances[chartKey]) return;
  chartInstances[chartKey].destroy();
  delete chartInstances[chartKey];
}

export function renderChart(chartKey, canvasId, config) {
  if (typeof Chart === "undefined") return;
  const canvas = document.getElementById(canvasId);
  if (!canvas) {
    destroyChart(chartKey);
    return;
  }
  destroyChart(chartKey);
  chartInstances[chartKey] = new Chart(canvas.getContext("2d"), config);
}

export function renderWeeklyTrendChart(canvasId, chartKey, weeklyData) {
  const values = weeklyData.weekBuckets.map((bucket) =>
    getMetricValue(bucket.done, bucket.possible),
  );
  const maxScale =
    getAnalyticsDisplayMode() === "percent" ? 100 : Math.max(1, ...values);
  const avgValue = values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;

  renderChart(chartKey, canvasId, {
    type: "line",
    data: {
      labels: weeklyData.weekBuckets.map((bucket) => bucket.label),
      datasets: [
        {
          label: getMetricAxisLabel(),
          data: values,
          borderColor: getValueColor(avgValue, maxScale, 0.95),
          backgroundColor: getValueColor(avgValue, maxScale, 0.2),
          borderWidth: 3,
          fill: true,
          tension: 0.34,
          pointRadius: 4,
          pointBackgroundColor: values.map((value) =>
            getValueColor(value, maxScale, 0.95),
          ),
          pointBorderColor: values.map((value) =>
            getValueColor(value, maxScale, 1),
          ),
          segment: {
            borderColor(context) {
              const midpoint =
                ((context.p0?.parsed?.y || 0) + (context.p1?.parsed?.y || 0)) /
                2;
              return getValueColor(midpoint, maxScale, 0.95);
            },
          },
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      aspectRatio: 1.8,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title(items) {
              const bucket = weeklyData.weekBuckets[items[0].dataIndex];
              return bucket && bucket.rangeLabel
                ? `${bucket.label} · ${bucket.rangeLabel}`
                : (bucket && bucket.label) || "";
            },
            label(context) {
              const bucket = weeklyData.weekBuckets[context.dataIndex];
              const done = bucket ? bucket.done : 0;
              const possible = bucket ? bucket.possible : 0;
              return `${getMetricLabel(context.parsed.y)} · ${done}/${possible}`;
            },
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          title: { display: true, text: "Week" },
        },
        y: {
          beginAtZero: true,
          max: getAnalyticsDisplayMode() === "percent" ? 100 : undefined,
          grid: { color: "rgba(255,255,255,0.06)" },
          title: { display: true, text: getMetricAxisLabel() },
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

export function renderMonthlyTrendChart(canvasId, chartKey, timeline) {
  const values = timeline.map((item) =>
    getMetricValue(item.done, item.possible),
  );
  const maxScale =
    getAnalyticsDisplayMode() === "percent" ? 100 : Math.max(1, ...values);
  const avgValue = values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;
  renderChart(chartKey, canvasId, {
    type: "line",
    data: {
      labels: timeline.map((item) => item.label),
      datasets: [
        {
          data: values,
          borderColor: getValueColor(avgValue, maxScale, 0.95),
          backgroundColor: getValueColor(avgValue, maxScale, 0.18),
          borderWidth: 3,
          fill: true,
          tension: 0.26,
          pointRadius: 3,
          pointBackgroundColor: values.map((value) =>
            getValueColor(value, maxScale, 0.95),
          ),
          pointBorderColor: values.map((value) =>
            getValueColor(value, maxScale, 1),
          ),
          segment: {
            borderColor(context) {
              const midpoint =
                ((context.p0?.parsed?.y || 0) + (context.p1?.parsed?.y || 0)) /
                2;
              return getValueColor(midpoint, maxScale, 0.95);
            },
          },
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      aspectRatio: 1.8,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label(context) {
              const item = timeline[context.dataIndex] || {
                done: 0,
                possible: 0,
              };
              return `${getMetricLabel(context.parsed.y)} · ${item.done}/${item.possible}`;
            },
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          title: { display: true, text: "Month" },
        },
        y: {
          beginAtZero: true,
          max: getAnalyticsDisplayMode() === "percent" ? 100 : undefined,
          grid: { color: "rgba(255,255,255,0.06)" },
          title: { display: true, text: getMetricAxisLabel() },
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

export function renderMonthlyStreakChart(canvasId, chartKey, rows) {
  const values = rows.map((row) => getMetricValue(row.done, row.possible));
  const maxScale =
    getAnalyticsDisplayMode() === "percent" ? 100 : Math.max(1, ...values);

  renderChart(chartKey, canvasId, {
    type: "bar",
    data: {
      labels: rows.map((row) => row.label),
      datasets: [
        {
          data: values,
          backgroundColor: values.map((value) =>
            getValueColor(value, maxScale, 0.88),
          ),
          borderRadius: 6,
          maxBarThickness: 18,
        },
      ],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      aspectRatio: 1.8,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label(context) {
              const row = rows[context.dataIndex] || { done: 0, possible: 0 };
              return `${getMetricLabel(context.parsed.x)} · ${row.done}/${row.possible} days`;
            },
          },
        },
      },
      scales: {
        x: {
          beginAtZero: true,
          max: getAnalyticsDisplayMode() === "percent" ? 100 : undefined,
          grid: { color: "rgba(255,255,255,0.06)" },
          title: { display: true, text: "Current streak (days)" },
          ticks: {
            callback(value) {
              return getAnalyticsDisplayMode() === "percent"
                ? `${Math.round(value)}%`
                : value;
            },
          },
        },
        y: {
          grid: { display: false },
        },
      },
    },
  });
}

export function renderWeeklyHeatmap(containerId, weeklyData) {
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

  weeklyData.weekBuckets.forEach((week) => {
    const weekLabel = week.label || `W${week.isoWeek || "?"}`;
    const rangeTitle = week.rangeLabel
      ? `Week ${week.isoWeek} (${week.rangeLabel})`
      : weekLabel;
    html += `<div class='heatmap-week-label' title='${rangeTitle}'>${weekLabel}</div>`;
    week.weekdays.forEach((entry) => {
      const value = getMetricValue(entry.done, entry.possible);
      const scaleMax = getAnalyticsDisplayMode() === "percent" ? 100 : maxValue;
      const ratio = scaleMax > 0 ? value / scaleMax : 0;
      html += `<div class='heatmap-cell' style='background:${getHeatColor(ratio)}' title='${rangeTitle} · Done ${entry.done} / ${entry.possible}'>${getMetricLabel(value)}</div>`;
    });
  });

  container.innerHTML = html;
}

export function renderAnalyticsView() {
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
  renderWeeklyHeatmap("analyticsWeeklyHeatmap", weeklyData);
  callRenderer("renderMonthlyReview");
}

registerRenderer("renderAnalyticsView", renderAnalyticsView);
registerRenderer("renderChart", renderChart);
