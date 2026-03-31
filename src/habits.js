"use strict";

import { ALL_WEEKDAYS, WEEKDAY_LABELS } from "./constants.js";
import { state } from "./state.js";
import {
  sanitize,
  daysInMonth,
  normalizeWeekdayArray,
  normalizeMonthDayArray,
} from "./utils.js";
import { saveState, ensureMonthData } from "./persistence.js";
import { callRenderer } from "./render-registry.js";

export function getHabitScheduleMode(habit) {
  const mode = String(
    (habit && (habit.scheduleMode || habit.type)) || "fixed",
  );
  if (mode === "specific_weekdays" || mode === "specific_month_days") {
    return mode;
  }
  return "fixed";
}

export function isHabitTrackedOnDate(habit, year, month, day) {
  if (!habit) return true;
  const mode = getHabitScheduleMode(habit);
  if (mode === "fixed") return true;

  if (mode === "specific_weekdays") {
    const weekday = new Date(year, month, day).getDay();
    const activeWeekdays = normalizeWeekdayArray(
      Array.isArray(habit.activeWeekdays)
        ? habit.activeWeekdays
        : ALL_WEEKDAYS,
    );
    return activeWeekdays.includes(weekday);
  }

  if (mode === "specific_month_days") {
    const activeMonthDays = normalizeMonthDayArray(
      Array.isArray(habit.activeMonthDays) ? habit.activeMonthDays : [],
    );
    return activeMonthDays.includes(day);
  }

  return true;
}

export function getPossibleActiveDaysInMonth(habit, year, month) {
  const totalDays = daysInMonth(year, month);
  let activeDays = 0;
  for (let day = 1; day <= totalDays; day += 1) {
    if (isHabitTrackedOnDate(habit, year, month, day)) {
      activeDays += 1;
    }
  }
  return activeDays;
}

export function getSortedDailyHabits() {
  return [...state.habits.daily].sort(
    (a, b) => (a.order || 0) - (b.order || 0),
  );
}

export function updateHabitOrder() {
  state.habits.daily = getSortedDailyHabits();
  state.habits.daily.forEach((h, idx) => {
    h.order = idx;
  });
}

export function moveDailyHabit(habitId, direction) {
  const habits = getSortedDailyHabits();
  const fromIndex = habits.findIndex((h) => h.id === habitId);
  if (fromIndex < 0) return;

  const offset = direction === "up" ? -1 : 1;
  const targetIndex = fromIndex + offset;
  if (targetIndex < 0 || targetIndex >= habits.length) return;

  const moved = habits.splice(fromIndex, 1)[0];
  habits.splice(targetIndex, 0, moved);
  habits.forEach((habit, idx) => {
    habit.order = idx;
  });

  state.habits.daily = habits;
  saveState();
  callRenderer("renderAll");
}

export function navigateMonth(delta) {
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
  callRenderer("renderAll");
}

export function deleteHabit(id) {
  const habit = state.habits.daily.find((h) => h.id === id);
  if (!habit) return;

  callRenderer("openConfirm", "Delete Habit", `Delete \"${habit.name}\"?`, () => {
    state.habits.daily = state.habits.daily.filter((h) => h.id !== id);
    updateHabitOrder();
    Object.values(state.months).forEach((monthData) => {
      delete monthData.dailyCompletions[id];
      if (monthData.dailyNotes) {
        delete monthData.dailyNotes[id];
      }
    });
    saveState();
    callRenderer("renderAll");
  });
}

export function deleteCategory(id) {
  const cat = state.categories.find((c) => c.id === id);
  if (!cat) return;

  callRenderer("openConfirm", "Delete Category", `Delete \"${cat.name}\"?`, () => {
    state.categories = state.categories.filter((c) => c.id !== id);
    state.habits.daily.forEach((h) => {
      if (h.categoryId === id) h.categoryId = "";
    });
    saveState();
    callRenderer("renderAll");
  });
}

export function buildScheduleCheckboxes(
  containerId,
  values,
  labelBuilder,
  selectedValues,
) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const selected = new Set(
    Array.isArray(selectedValues) ? selectedValues : [],
  );
  container.innerHTML = values
    .map((value) => {
      const checked = selected.has(value) ? "checked" : "";
      const inputId = `${containerId}_${value}`;
      return `<label class='schedule-day-option' for='${inputId}'><input id='${inputId}' type='checkbox' value='${value}' ${checked}><span>${sanitize(labelBuilder(value))}</span></label>`;
    })
    .join("");
}

export function getCheckedValuesFromContainer(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return [];
  return Array.from(
    container.querySelectorAll("input[type='checkbox']:checked"),
  )
    .map((input) => parseInt(input.value, 10))
    .filter((value) => Number.isInteger(value));
}

export function renderHabitScheduleSelectors(habit) {
  const mode = getHabitScheduleMode(habit || {});
  const weekdays = normalizeWeekdayArray(
    habit && Array.isArray(habit.activeWeekdays)
      ? habit.activeWeekdays
      : ALL_WEEKDAYS,
  );
  const monthDays = normalizeMonthDayArray(
    habit && Array.isArray(habit.activeMonthDays)
      ? habit.activeMonthDays
      : [1],
  );

  buildScheduleCheckboxes(
    "habitActiveWeekdays",
    ALL_WEEKDAYS,
    (value) => WEEKDAY_LABELS[value],
    weekdays,
  );
  buildScheduleCheckboxes(
    "habitActiveMonthDays",
    Array.from({ length: 31 }, (_, idx) => idx + 1),
    (value) => String(value),
    monthDays,
  );

  updateHabitScheduleTypeUI(mode);
}

export function updateHabitScheduleTypeUI(scheduleMode) {
  const mode =
    scheduleMode === "specific_month_days"
      ? "specific_month_days"
      : scheduleMode === "specific_weekdays"
        ? "specific_weekdays"
        : "fixed";
  const weekdaysGroup = document.getElementById("habitWeekdaysGroup");
  const monthDaysGroup = document.getElementById("habitMonthDaysGroup");
  if (weekdaysGroup) {
    weekdaysGroup.style.display =
      mode === "specific_weekdays" ? "block" : "none";
  }
  if (monthDaysGroup) {
    monthDaysGroup.style.display =
      mode === "specific_month_days" ? "block" : "none";
  }
}
