"use strict";

import { state } from "./state.js";
import { chartInstances } from "./state.js";
import {
  daysInMonth,
  monthKey,
  getValueColor,
  getWeekShadeColor,
  getHeatColor,
  getIsoWeekNumber,
  isPlainObject,
} from "./utils.js";
import { getCurrentMonthData, getDefaultMonthData, ensureMonthDataShape, getHabitEmoji } from "./persistence.js";
import { getSortedDailyHabits, isHabitTrackedOnDate, getPossibleActiveDaysInMonth } from "./habits.js";
import {
  getMetricValue,
  getMetricLabel,
  getMetricAxisLabel,
  syncAnalyticsModeControls,
  getBooksAnalyticsRangeDays,
  getAnalyticsDisplayMode,
} from "./preferences.js";
import { getCategoryById } from "./persistence.js";
import { registerRenderer, callRenderer } from "./render-registry.js";

export function renderDailyBarChart() {
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
          backgroundColor: values.map((value) =>
            getValueColor(value, Math.max(1, ...values), 0.86),
          ),
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

export function renderCategoryBarChart() {
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
          backgroundColor: entries.map((e) =>
            getValueColor(
              e.completed,
              Math.max(1, ...entries.map((item) => item.completed)),
              0.86,
            ),
          ),
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
                ((context.p0?.parsed?.y || 0) +
                  (context.p1?.parsed?.y || 0)) /
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

export function renderWeeklyCategoryStackedChart(canvasId, chartKey, weeklyData) {
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
        backgroundColor(context) {
          const value =
            context.parsed && Number(context.parsed.y)
              ? Number(context.parsed.y)
              : 0;
          const scaleMax =
            getAnalyticsDisplayMode() === "percent"
              ? 100
              : Math.max(1, ...points);
          return getValueColor(value, scaleMax, 0.86);
        },
        borderRadius: 4,
        borderColor(context) {
          const value =
            context.parsed && Number(context.parsed.y)
              ? Number(context.parsed.y)
              : 0;
          const scaleMax =
            getAnalyticsDisplayMode() === "percent"
              ? 100
              : Math.max(1, ...points);
          return getValueColor(value, scaleMax, 1);
        },
        borderWidth: 1,
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
                ((context.p0?.parsed?.y || 0) +
                  (context.p1?.parsed?.y || 0)) /
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

export function renderMonthlyCategoryTrendChart(canvasId, chartKey, timeline) {
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

  const datasets = topCategories.map((item) => {
    const points = timeline.map((point) => {
      const slot = point.byCategory[item.category.id] || {
        done: 0,
        possible: 0,
      };
      return getMetricValue(slot.done, slot.possible);
    });
    const maxScale =
      getAnalyticsDisplayMode() === "percent" ? 100 : Math.max(1, ...points);
    const avgValue = points.length
      ? points.reduce((sum, value) => sum + value, 0) / points.length
      : 0;
    return {
      label: `${item.category.emoji} ${item.category.name}`,
      data: points,
      borderColor: getValueColor(avgValue, maxScale, 0.95),
      backgroundColor: getValueColor(avgValue, maxScale, 0.2),
      pointBackgroundColor: points.map((value) =>
        getValueColor(value, maxScale, 0.92),
      ),
      pointBorderColor: points.map((value) =>
        getValueColor(value, maxScale, 1),
      ),
      segment: {
        borderColor(context) {
          const midpoint =
            ((context.p0?.parsed?.y || 0) + (context.p1?.parsed?.y || 0)) / 2;
          return getValueColor(midpoint, maxScale, 0.95);
        },
      },
      fill: false,
      tension: 0.25,
    };
  });

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

  weeklyData.weekBuckets.forEach((week, weekIndex) => {
    html += `<div class='heatmap-week-label'>W${weekIndex + 1}</div>`;
    week.weekdays.forEach((entry) => {
      const value = getMetricValue(entry.done, entry.possible);
      const scaleMax =
        getAnalyticsDisplayMode() === "percent" ? 100 : maxValue;
      const ratio = scaleMax > 0 ? value / scaleMax : 0;
      html += `<div class='heatmap-cell' style='background:${getHeatColor(ratio)}' title='Done ${entry.done} / ${entry.possible}'>${getMetricLabel(value)}</div>`;
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

  renderDailyBarChart();
  renderCategoryBarChart();
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
  callRenderer("renderBooksAnalyticsDashboard", { includeCharts: true });
  callRenderer("renderMonthlyReview");
}

registerRenderer("renderAnalyticsView", renderAnalyticsView);
registerRenderer("renderChart", renderChart);
