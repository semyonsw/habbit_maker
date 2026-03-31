(function () {
  "use strict";

  H.loadAnalyticsPreferences = function () {
    var savedMode = localStorage.getItem(H.ANALYTICS_DISPLAY_MODE_KEY);
    H.analyticsState.displayMode = savedMode === "raw" ? "raw" : "percent";
    var savedBooksRange = localStorage.getItem(H.BOOKS_ANALYTICS_RANGE_KEY);
    H.analyticsState.booksRangeDays = H.normalizeBooksRange(savedBooksRange);
  };

  H.persistAnalyticsPreferences = function () {
    localStorage.setItem(
      H.ANALYTICS_DISPLAY_MODE_KEY,
      H.analyticsState.displayMode,
    );
    localStorage.setItem(
      H.BOOKS_ANALYTICS_RANGE_KEY,
      H.analyticsState.booksRangeDays === 0
        ? "all"
        : String(H.analyticsState.booksRangeDays),
    );
  };

  H.normalizeBooksRange = function (value) {
    var asString = String(value || "30").toLowerCase();
    if (asString === "all") return 0;
    var parsed = parseInt(asString, 10);
    if ([7, 30, 90].includes(parsed)) return parsed;
    return 30;
  };

  H.getBooksAnalyticsRangeDays = function () {
    return H.normalizeBooksRange(H.analyticsState.booksRangeDays);
  };

  H.getAnalyticsDisplayMode = function () {
    return H.analyticsState.displayMode === "raw" ? "raw" : "percent";
  };

  H.getMetricValue = function (done, possible) {
    if (H.getAnalyticsDisplayMode() === "raw") {
      return Number(done || 0);
    }
    if (!possible) return 0;
    return Math.round((Number(done || 0) / Number(possible || 1)) * 100);
  };

  H.getMetricLabel = function (value) {
    if (H.getAnalyticsDisplayMode() === "raw") {
      return String(Math.round(value || 0));
    }
    return `${Math.round(value || 0)}%`;
  };

  H.getMetricAxisLabel = function () {
    return H.getAnalyticsDisplayMode() === "raw"
      ? "Completed habits"
      : "Completion rate (%)";
  };

  H.syncAnalyticsModeControls = function () {
    ["analyticsDisplayModeAnalytics"]
      .map(function (id) { return document.getElementById(id); })
      .filter(Boolean)
      .forEach(function (control) {
        control.value = H.getAnalyticsDisplayMode();
      });
  };

  H.setAnalyticsDisplayMode = function (mode) {
    H.analyticsState.displayMode = mode === "raw" ? "raw" : "percent";
    H.persistAnalyticsPreferences();
    H.syncAnalyticsModeControls();
    H.renderAnalyticsView();
  };

  H.syncBooksRangeControls = function () {
    var current = H.getBooksAnalyticsRangeDays();
    document.querySelectorAll("[data-books-range]").forEach(function (btn) {
      if (!(btn instanceof HTMLElement)) return;
      var range = H.normalizeBooksRange(btn.dataset.booksRange);
      btn.classList.toggle("active", range === current);
      btn.setAttribute("aria-pressed", range === current ? "true" : "false");
    });
  };

  H.setBooksAnalyticsRange = function (value) {
    var next = H.normalizeBooksRange(value);
    if (next === H.analyticsState.booksRangeDays) return;
    H.analyticsState.booksRangeDays = next;
    H.persistAnalyticsPreferences();
    H.syncBooksRangeControls();
    if (document.getElementById("view-books")?.classList.contains("active")) {
      H.renderBooksView();
    } else {
      H.renderBooksStatsOverview(H.buildBooksAnalytics());
    }
    if (
      document.getElementById("view-analytics")?.classList.contains("active")
    ) {
      H.renderAnalyticsView();
    }
  };

  H.safeMonthData = function (year, month) {
    var key = H.monthKey(year, month);
    var monthData = H.state.months[key];
    if (!H.isPlainObject(monthData)) {
      return H.getDefaultMonthData();
    }
    return H.ensureMonthDataShape(monthData);
  };

  H.buildMonthTotals = function (year, month) {
    var monthData = H.safeMonthData(year, month);
    var habits = H.getSortedDailyHabits();
    var totalDays = H.daysInMonth(year, month);
    var done = 0;
    var possible = 0;

    for (var day = 1; day <= totalDays; day++) {
      habits.forEach(function (habit) {
        if (!H.isHabitTrackedOnDate(habit, year, month, day)) return;
        possible += 1;
        if (
          monthData.dailyCompletions[habit.id] &&
          monthData.dailyCompletions[habit.id][day]
        ) {
          done += 1;
        }
      });
    }

    return { done: done, possible: possible, totalDays: totalDays, monthData: monthData, habits: habits };
  };

  H.buildWeeklyAnalytics = function (year, month) {
    var totals = H.buildMonthTotals(year, month);
    var maxWeek = Math.max(1, Math.min(5, Math.ceil(totals.totalDays / 7)));

    var weekBuckets = Array.from({ length: maxWeek }, function (_, index) {
      return {
        label: `Week ${index + 1}`,
        done: 0,
        possible: 0,
        weekdays: Array.from({ length: 7 }, function () { return { done: 0, possible: 0 }; }),
      };
    });

    var categoryWeek = {};
    H.state.categories.forEach(function (category) {
      categoryWeek[category.id] = Array.from({ length: maxWeek }, function () {
        return {
          done: 0,
          possible: 0,
        };
      });
    });

    for (var day = 1; day <= totals.totalDays; day++) {
      var weekIndex = Math.min(maxWeek - 1, Math.floor((day - 1) / 7));
      var weekday = new Date(year, month, day).getDay();

      totals.habits.forEach(function (habit) {
        if (!H.isHabitTrackedOnDate(habit, year, month, day)) return;

        weekBuckets[weekIndex].possible += 1;
        weekBuckets[weekIndex].weekdays[weekday].possible += 1;

        if (!categoryWeek[habit.categoryId]) {
          categoryWeek[habit.categoryId] = Array.from(
            { length: maxWeek },
            function () {
              return {
                done: 0,
                possible: 0,
              };
            },
          );
        }
        categoryWeek[habit.categoryId][weekIndex].possible += 1;

        var done = !!(
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

    return { weekBuckets: weekBuckets, categoryWeek: categoryWeek };
  };

  H.buildMonthlyTimeline = function (monthCount) {
    if (monthCount === undefined) monthCount = 12;
    var timeline = [];
    for (var offset = monthCount - 1; offset >= 0; offset--) {
      var dt = new Date(H.state.currentYear, H.state.currentMonth - offset, 1);
      var year = dt.getFullYear();
      var month = dt.getMonth();
      var totals = H.buildMonthTotals(year, month);

      var byCategory = {};
      H.state.categories.forEach(function (category) {
        byCategory[category.id] = { done: 0, possible: 0 };
      });

      for (var day = 1; day <= totals.totalDays; day++) {
        totals.habits.forEach(function (habit) {
          if (!H.isHabitTrackedOnDate(habit, year, month, day)) return;
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
        label: `${H.MONTH_NAMES[month].slice(0, 3)} ${String(year).slice(-2)}`,
        done: totals.done,
        possible: totals.possible,
        byCategory: byCategory,
      });
    }
    return timeline;
  };

  H.getMonthStreakLeaderboard = function (limit) {
    if (limit === undefined) limit = 10;
    var totalDays = H.daysInMonth(H.state.currentYear, H.state.currentMonth);
    var monthData = H.getCurrentMonthData();
    var now = new Date();
    var isCurrentMonth =
      now.getFullYear() === H.state.currentYear &&
      now.getMonth() === H.state.currentMonth;
    var endDay = isCurrentMonth ? now.getDate() : totalDays;

    var rows = H.getSortedDailyHabits().map(function (habit) {
      var streak = 0;
      var trackedDays = 0;
      for (var day = 1; day <= endDay; day++) {
        if (
          H.isHabitTrackedOnDate(
            habit,
            H.state.currentYear,
            H.state.currentMonth,
            day,
          )
        ) {
          trackedDays += 1;
        }
      }

      for (var day = endDay; day >= 1; day--) {
        if (
          !H.isHabitTrackedOnDate(
            habit,
            H.state.currentYear,
            H.state.currentMonth,
            day,
          )
        ) {
          continue;
        }
        var done = !!(
          monthData.dailyCompletions[habit.id] &&
          monthData.dailyCompletions[habit.id][day]
        );
        if (!done) break;
        streak += 1;
      }

      var cat = H.getCategoryById(habit.categoryId);
      return {
        label: `${H.getHabitEmoji(habit)} ${habit.name}`,
        done: streak,
        possible: Math.max(1, trackedDays),
        color: cat ? cat.color : "#58a5d1",
      };
    });

    return rows
      .sort(function (a, b) { return b.done - a.done; })
      .slice(0, limit)
      .filter(function (row) { return row.possible > 0; });
  };
})();
