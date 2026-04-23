"use strict";

import { MONTH_NAMES } from "./constants.js";
import { state, chartInstances, linkedHoverState, globals } from "./state.js";
import {
  sanitize,
  daysInMonth,
  monthKey,
  getValueColor,
  getWeekShadeColor,
  getMonthCalendarWeekLayout,
  formatIsoWeekRangeLabel,
} from "./utils.js?v=2";
import {
  getCurrentMonthData,
  getCategoryById,
  getHabitEmoji,
  saveState,
} from "./persistence.js";
import {
  getSortedDailyHabits,
  isHabitTrackedOnDate,
  getHabitScheduleMode,
} from "./habits.js";
import { registerRenderer, callRenderer } from "./render-registry.js";

function syncStreakBadgeText(badge) {
  if (!(badge instanceof HTMLElement)) return;
  const current = parseInt(badge.dataset.streakCurrent || "0", 10);
  const best = parseInt(badge.dataset.streakBest || "0", 10);
  const safeCurrent = Number.isFinite(current) ? Math.max(0, current) : 0;
  const safeBest = Number.isFinite(best) ? Math.max(0, best) : 0;
  const text = `Current ${safeCurrent}d | Best ${safeBest}d`;
  badge.textContent = text;
  badge.title = text;
  badge.setAttribute("aria-label", text);
}

function syncAllStreakBadges(grid) {
  if (!(grid instanceof HTMLElement)) return;
  grid
    .querySelectorAll(".streak-badge[data-streak-habit]")
    .forEach((badge) => syncStreakBadgeText(badge));
}

let dashboardHabitActionsMenu = null;
let dashboardHabitActionsActiveToggle = null;
let dashboardHabitActionsBound = false;

function closeDashboardHabitActionsMenu(options = {}) {
  const restoreFocus = !!options.restoreFocus;
  if (!dashboardHabitActionsMenu) return;

  dashboardHabitActionsMenu.hidden = true;
  dashboardHabitActionsMenu.setAttribute("aria-hidden", "true");

  if (dashboardHabitActionsActiveToggle instanceof HTMLElement) {
    dashboardHabitActionsActiveToggle.setAttribute("aria-expanded", "false");
    if (restoreFocus) {
      dashboardHabitActionsActiveToggle.focus();
    }
  }

  dashboardHabitActionsActiveToggle = null;
}

function positionDashboardHabitActionsMenu(toggle, menu) {
  if (!(toggle instanceof HTMLElement) || !(menu instanceof HTMLElement))
    return;

  const gap = 8;
  const rect = toggle.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();

  let left = rect.right - menuRect.width;
  let top = rect.bottom + gap;

  if (left < gap) {
    left = gap;
  }
  if (left + menuRect.width > window.innerWidth - gap) {
    left = window.innerWidth - menuRect.width - gap;
  }

  if (top + menuRect.height > window.innerHeight - gap) {
    top = rect.top - menuRect.height - gap;
  }
  if (top < gap) {
    top = gap;
  }

  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;
}

function runDashboardHabitAction(action, habitId) {
  if (!habitId || !window.HabitApp) return;

  if (action === "move-up") {
    window.HabitApp.moveHabit?.(habitId, "up");
    return;
  }
  if (action === "move-down") {
    window.HabitApp.moveHabit?.(habitId, "down");
    return;
  }
  if (action === "edit") {
    window.HabitApp.editHabit?.(habitId);
    return;
  }
  if (action === "delete") {
    window.HabitApp.deleteHabit?.(habitId);
  }
}

function ensureDashboardHabitActionsMenu() {
  if (
    dashboardHabitActionsMenu instanceof HTMLElement &&
    document.body.contains(dashboardHabitActionsMenu)
  ) {
    return dashboardHabitActionsMenu;
  }

  const menu = document.createElement("div");
  menu.id = "dashboardHabitActionsMenu";
  menu.className = "habit-actions-popover";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "Habit actions");
  menu.setAttribute("aria-hidden", "true");
  menu.hidden = true;
  menu.innerHTML =
    "<button type='button' class='habit-action-item' data-action='move-up' role='menuitem'>Move up</button><button type='button' class='habit-action-item' data-action='move-down' role='menuitem'>Move down</button><button type='button' class='habit-action-item' data-action='edit' role='menuitem'>Edit</button><button type='button' class='habit-action-item delete' data-action='delete' role='menuitem'>Delete</button>";
  document.body.appendChild(menu);

  dashboardHabitActionsMenu = menu;

  if (!dashboardHabitActionsBound) {
    document.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const toggle = target.closest(".habit-actions-toggle");
      if (toggle instanceof HTMLElement) {
        const menuEl = ensureDashboardHabitActionsMenu();
        const isSameToggle =
          dashboardHabitActionsActiveToggle === toggle && !menuEl.hidden;

        if (isSameToggle) {
          closeDashboardHabitActionsMenu({ restoreFocus: false });
          return;
        }

        closeDashboardHabitActionsMenu({ restoreFocus: false });
        dashboardHabitActionsActiveToggle = toggle;
        toggle.setAttribute("aria-expanded", "true");

        menuEl.dataset.habitId = toggle.dataset.habitId || "";

        const canMoveUp = toggle.dataset.canMoveUp === "true";
        const canMoveDown = toggle.dataset.canMoveDown === "true";
        const moveUpBtn = menuEl.querySelector(
          ".habit-action-item[data-action='move-up']",
        );
        const moveDownBtn = menuEl.querySelector(
          ".habit-action-item[data-action='move-down']",
        );
        if (moveUpBtn instanceof HTMLButtonElement) {
          moveUpBtn.disabled = !canMoveUp;
        }
        if (moveDownBtn instanceof HTMLButtonElement) {
          moveDownBtn.disabled = !canMoveDown;
        }

        menuEl.hidden = false;
        menuEl.setAttribute("aria-hidden", "false");
        positionDashboardHabitActionsMenu(toggle, menuEl);
        return;
      }

      const actionBtn = target.closest(".habit-action-item");
      if (actionBtn instanceof HTMLButtonElement) {
        if (actionBtn.disabled) return;
        const menuEl = ensureDashboardHabitActionsMenu();
        const habitId = menuEl.dataset.habitId || "";
        const action = actionBtn.dataset.action || "";
        closeDashboardHabitActionsMenu({ restoreFocus: false });
        runDashboardHabitAction(action, habitId);
        return;
      }

      if (target.closest("#dashboardHabitActionsMenu")) return;

      closeDashboardHabitActionsMenu({ restoreFocus: false });
    });

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      closeDashboardHabitActionsMenu({ restoreFocus: true });
    });

    window.addEventListener("resize", () => {
      closeDashboardHabitActionsMenu({ restoreFocus: false });
    });

    window.addEventListener(
      "scroll",
      () => {
        closeDashboardHabitActionsMenu({ restoreFocus: false });
      },
      true,
    );

    dashboardHabitActionsBound = true;
  }

  return dashboardHabitActionsMenu;
}

export function switchView(viewId) {
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
    callRenderer("renderBooksView");
    return;
  }

  if (viewId === "analytics") {
    callRenderer("renderAnalyticsView");
    return;
  }

  if (viewId === "logs") {
    callRenderer("renderLogsView");
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

  const combo = computeGlobalComboStreak();
  const comboEl = document.getElementById("comboStreakValue");
  if (comboEl) {
    const capped = Math.min(combo.current, 30);
    const fire = combo.current > 0 ? "🔥 " : "";
    comboEl.textContent = `${fire}${combo.current}d`;
    comboEl.style.color = getValueColor(capped, 30, 1);
    comboEl.style.background = getValueColor(capped, 30, 0.18);
    comboEl.style.borderColor = getValueColor(capped, 30, 0.55);
    comboEl.title = `Current combo ${combo.current}d · Best ${combo.best}d`;
    const bestEl = document.getElementById("comboStreakBest");
    if (bestEl) {
      bestEl.textContent = combo.best > 0 ? `best ${combo.best}d` : "";
    }
  }
}

export function renderDonut(canvasId, pct) {
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
          backgroundColor: [getValueColor(pct, 100, 0.9), "#1a2840"],
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

function clearLinkedHoverHighlights() {
  document
    .querySelectorAll(
      ".week-card.linked-week-active, .week-mini-bar.linked-capsule-active, th.day-col.linked-day-active, th.day-col.linked-week-active, td.day-cell.linked-day-active, td.day-cell.linked-week-active",
    )
    .forEach((element) => {
      element.classList.remove(
        "linked-week-active",
        "linked-capsule-active",
        "linked-day-active",
      );
    });
}

function ensureLinkedHoverTooltip() {
  let tooltip = document.getElementById("linkedHoverTooltip");
  if (tooltip) return tooltip;
  tooltip = document.createElement("div");
  tooltip.id = "linkedHoverTooltip";
  tooltip.className = "linked-hover-tooltip";
  tooltip.setAttribute("role", "status");
  tooltip.setAttribute("aria-live", "polite");
  document.body.appendChild(tooltip);
  return tooltip;
}

function hideLinkedHoverTooltip() {
  const tooltip = document.getElementById("linkedHoverTooltip");
  if (!tooltip) return;
  tooltip.classList.remove("visible");
}

function showLinkedHoverTooltip(text, point) {
  if (!text || !point) return;
  const tooltip = ensureLinkedHoverTooltip();
  tooltip.textContent = text;
  tooltip.style.left = `${Math.round(point.x)}px`;
  tooltip.style.top = `${Math.round(point.y)}px`;
  tooltip.classList.add("visible");
}

function updateLinkedHoverTooltipPositionFromMouse(event) {
  const tooltip = document.getElementById("linkedHoverTooltip");
  if (!tooltip || !tooltip.classList.contains("visible")) return;
  tooltip.style.left = `${Math.round(event.clientX + 16)}px`;
  tooltip.style.top = `${Math.round(event.clientY - 28)}px`;
}

function weekRangeFromIndex(week) {
  const { weeks } = getMonthCalendarWeekLayout(
    state.currentYear,
    state.currentMonth,
  );
  if (!weeks.length) return null;

  const parsed = parseInt(week, 10);
  if (!Number.isFinite(parsed)) return null;
  const range = weeks.find((w) => w.week === parsed);
  if (!range) return null;
  return { week: range.week, start: range.start, end: range.end };
}

function weekFromDay(day) {
  if (!Number.isFinite(day) || day < 1) return null;
  const { dayToWeek } = getMonthCalendarWeekLayout(
    state.currentYear,
    state.currentMonth,
  );
  return dayToWeek[day] || null;
}

function activateLinkedDay(day, options = {}) {
  const totalDays = daysInMonth(state.currentYear, state.currentMonth);
  const normalizedDay = parseInt(day, 10);
  if (!Number.isFinite(normalizedDay) || normalizedDay < 1) return;
  if (normalizedDay > totalDays) return;

  const week = weekFromDay(normalizedDay);
  if (!week) return;

  clearLinkedHoverHighlights();

  const weekCard = document.querySelector(`.week-card[data-week='${week}']`);
  if (weekCard) {
    weekCard.classList.add("linked-week-active");
  }

  const weekCapsule = document.querySelector(
    `.week-mini-bar[data-day='${normalizedDay}']`,
  );
  if (weekCapsule) {
    weekCapsule.classList.add("linked-capsule-active");
  }

  document
    .querySelectorAll(`th.day-col[data-day='${normalizedDay}']`)
    .forEach((header) => header.classList.add("linked-day-active"));

  document
    .querySelectorAll(`td.day-cell[data-day='${normalizedDay}']`)
    .forEach((cell) => cell.classList.add("linked-day-active"));

  linkedHoverState.day = normalizedDay;
  linkedHoverState.week = week;
  linkedHoverState.scope = "day";
  linkedHoverState.source = options.source || "unknown";

  if (options.event && options.event.clientX && options.event.clientY) {
    showLinkedHoverTooltip(`Week ${week} • Day ${normalizedDay}`, {
      x: options.event.clientX + 16,
      y: options.event.clientY - 28,
    });
  } else if (options.anchorElement) {
    const rect = options.anchorElement.getBoundingClientRect();
    showLinkedHoverTooltip(`Week ${week} • Day ${normalizedDay}`, {
      x: rect.left + rect.width / 2,
      y: rect.top - 12,
    });
  }
}

function activateLinkedWeek(week, options = {}) {
  const parsedWeek = parseInt(week, 10);
  if (!Number.isFinite(parsedWeek) || parsedWeek < 1) return;

  const range = weekRangeFromIndex(parsedWeek);
  if (!range) return;
  clearLinkedHoverHighlights();

  const weekCard = document.querySelector(
    `.week-card[data-week='${range.week}']`,
  );
  if (weekCard) {
    weekCard.classList.add("linked-week-active");
  }

  for (let day = range.start; day <= range.end; day++) {
    document
      .querySelectorAll(`th.day-col[data-day='${day}']`)
      .forEach((header) => header.classList.add("linked-week-active"));

    document
      .querySelectorAll(`td.day-cell[data-day='${day}']`)
      .forEach((cell) => cell.classList.add("linked-week-active"));
  }

  linkedHoverState.day = null;
  linkedHoverState.week = range.week;
  linkedHoverState.scope = "week";
  linkedHoverState.source = options.source || "unknown";

  if (options.event && options.event.clientX && options.event.clientY) {
    showLinkedHoverTooltip(
      `Week ${range.week} • Days ${range.start}-${range.end}`,
      { x: options.event.clientX + 16, y: options.event.clientY - 28 },
    );
  } else if (options.anchorElement) {
    const rect = options.anchorElement.getBoundingClientRect();
    showLinkedHoverTooltip(
      `Week ${range.week} • Days ${range.start}-${range.end}`,
      { x: rect.left + rect.width / 2, y: rect.top - 12 },
    );
  }
}

export function clearLinkedHoverState() {
  linkedHoverState.day = null;
  linkedHoverState.week = null;
  linkedHoverState.scope = null;
  linkedHoverState.source = null;
  clearLinkedHoverHighlights();
  hideLinkedHoverTooltip();
}

function bindWeeklySummaryHoverInteractions(container) {
  if (!container || container.dataset.linkedHoverBound === "true") return;

  container.addEventListener("mouseover", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const capsule = target.closest(".week-mini-bar[data-day]");
    if (capsule) {
      activateLinkedDay(parseInt(capsule.dataset.day, 10), {
        source: "weekly",
        event,
      });
      return;
    }

    const card = target.closest(".week-card[data-week]");
    if (!card) return;
    activateLinkedWeek(parseInt(card.dataset.week, 10), {
      source: "weekly",
      event,
    });
  });

  container.addEventListener("mousemove", (event) => {
    updateLinkedHoverTooltipPositionFromMouse(event);
  });

  container.addEventListener("mouseleave", () => {
    if (linkedHoverState.source !== "weekly") return;
    clearLinkedHoverState();
  });

  container.addEventListener("focusin", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const capsule = target.closest(".week-mini-bar[data-day]");
    if (capsule) {
      activateLinkedDay(parseInt(capsule.dataset.day, 10), {
        source: "weekly",
        anchorElement: capsule,
      });
      return;
    }

    const card = target.closest(".week-card[data-week]");
    if (!card) return;
    activateLinkedWeek(parseInt(card.dataset.week, 10), {
      source: "weekly",
      anchorElement: card,
    });
  });

  container.addEventListener("focusout", (event) => {
    const next = event.relatedTarget;
    if (next instanceof Node && container.contains(next)) return;
    if (linkedHoverState.source !== "weekly") return;
    clearLinkedHoverState();
  });

  container.dataset.linkedHoverBound = "true";
}

function bindDailyGridHoverInteractions(grid) {
  if (!grid || grid.dataset.linkedHoverBound === "true") return;

  grid.addEventListener("mouseover", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const dayHost = target.closest(
      "th.day-col[data-day], td.day-cell[data-day]",
    );
    if (!dayHost) return;
    activateLinkedDay(parseInt(dayHost.dataset.day, 10), {
      source: "grid",
      event,
    });
  });

  grid.addEventListener("mousemove", (event) => {
    updateLinkedHoverTooltipPositionFromMouse(event);
  });

  grid.addEventListener("mouseleave", () => {
    if (linkedHoverState.source !== "grid") return;
    clearLinkedHoverState();
  });

  grid.addEventListener("focusin", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const dayHost = target.closest(
      "th.day-col[data-day], td.day-cell[data-day]",
    );
    if (!dayHost) return;
    activateLinkedDay(parseInt(dayHost.dataset.day, 10), {
      source: "grid",
      anchorElement: dayHost,
    });
  });

  grid.addEventListener("focusout", (event) => {
    const next = event.relatedTarget;
    if (next instanceof Node && grid.contains(next)) return;
    if (linkedHoverState.source !== "grid") return;
    clearLinkedHoverState();
  });

  grid.dataset.linkedHoverBound = "true";
}

function renderWeeklySummaryCards() {
  const container = document.getElementById("weeklySummaryCards");
  if (!container) return;

  const monthData = getCurrentMonthData();
  const habits = getSortedDailyHabits();
  const { weeks } = getMonthCalendarWeekLayout(
    state.currentYear,
    state.currentMonth,
  );

  let html = "";
  weeks.forEach(({ week, start, end, fullStart, fullEnd }) => {
    const weekAccent = getWeekShadeColor(week);
    const rangeLabel = formatIsoWeekRangeLabel(fullStart, fullEnd);
    let done = 0;
    let possible = 0;
    const dayCompletionRates = [];

    for (let day = start; day <= end; day++) {
      let dayDone = 0;
      let dayPossible = 0;

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

        dayPossible += 1;
        if (
          monthData.dailyCompletions[habit.id] &&
          monthData.dailyCompletions[habit.id][day]
        ) {
          dayDone += 1;
        }
      });

      done += dayDone;
      possible += dayPossible;
      dayCompletionRates.push(
        dayPossible > 0 ? Math.round((dayDone / dayPossible) * 100) : 0,
      );
    }

    const pct = possible > 0 ? Math.round((done / possible) * 100) : 0;
    const weekColor = getValueColor(pct, 100, 0.92);
    const weekShadowColor = getValueColor(pct, 100, 0.25);
    const bars = dayCompletionRates
      .map(
        (value, idx) =>
          `<span class="week-mini-bar" style="--bar-pct:${value};--bar-fill-color:${getValueColor(value, 100, 0.9)};--bar-border-color:${getValueColor(value, 100, 0.42)}" title="Day ${start + idx}: ${value}%" data-day="${start + idx}" data-week="${week}" tabindex="0" aria-label="Week ${week} day ${start + idx} completion ${value}%"></span>`,
      )
      .join("");

    html += `<div class="week-card" style="--week-accent:${weekAccent}" data-week="${week}" tabindex="0"><div class="week-card-top"><span class="week-card-title">Week ${week}</span><span class="week-range">${rangeLabel}</span></div><div class="week-ring" style="--week-pct:${pct};--week-color:${weekColor};--week-shadow:${weekShadowColor}" aria-label="Week ${week} completion ${pct}%"><span class="week-pct">${pct}%</span></div><div class="week-meta">${done}/${possible} tasks</div><div class="week-mini-bars">${bars}</div></div>`;
  });

  container.innerHTML = html;
  bindWeeklySummaryHoverInteractions(container);
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
    const today = new Date();
    const viewedIsCurrent =
      today.getFullYear() === state.currentYear &&
      today.getMonth() === state.currentMonth;
    const viewedIsFuture =
      state.currentYear > today.getFullYear() ||
      (state.currentYear === today.getFullYear() &&
        state.currentMonth > today.getMonth());

    if (!viewedIsFuture) {
      let y = state.currentYear;
      let m = state.currentMonth;
      let d = viewedIsCurrent ? today.getDate() : daysInMonth(y, m);

      if (viewedIsCurrent) {
        const mdToday = state.months[monthKey(y, m)];
        const tracked = isHabitTrackedOnDate(habit, y, m, d);
        const doneToday = !!(
          mdToday &&
          mdToday.dailyCompletions[habitId] &&
          mdToday.dailyCompletions[habitId][d]
        );
        if (tracked && !doneToday) {
          d -= 1;
          if (d < 1) {
            m -= 1;
            if (m < 0) {
              m = 11;
              y -= 1;
            }
            d = daysInMonth(y, m);
          }
        }
      }

      let safety = 370;
      while (safety-- > 0) {
        const md = state.months[monthKey(y, m)];
        if (md) {
          if (isHabitTrackedOnDate(habit, y, m, d)) {
            const done = !!(
              md.dailyCompletions[habitId] && md.dailyCompletions[habitId][d]
            );
            if (!done) break;
            current += 1;
          }
        } else if (isHabitTrackedOnDate(habit, y, m, d)) {
          break;
        }
        d -= 1;
        if (d < 1) {
          m -= 1;
          if (m < 0) {
            m = 11;
            y -= 1;
          }
          d = daysInMonth(y, m);
        }
      }
    }
  }

  badge.dataset.streakCurrent = String(current);
  badge.dataset.streakBest = String(best);
  syncStreakBadgeText(badge);
}

function evaluateDayCompletion(habits, monthData, y, m, day) {
  let required = 0;
  let done = 0;
  habits.forEach((habit) => {
    if (!isHabitTrackedOnDate(habit, y, m, day)) return;
    required += 1;
    if (
      monthData.dailyCompletions[habit.id] &&
      monthData.dailyCompletions[habit.id][day]
    ) {
      done += 1;
    }
  });
  return { required, done };
}

function computeGlobalComboStreak() {
  const habits = getSortedDailyHabits();
  if (!habits.length) return { current: 0, best: 0 };

  let best = 0;
  let chain = 0;
  const months = Object.keys(state.months).sort();
  months.forEach((mKey) => {
    const parts = mKey.split("-");
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const md = state.months[mKey];
    if (!md) return;
    const total = daysInMonth(year, month);
    for (let day = 1; day <= total; day++) {
      const { required, done } = evaluateDayCompletion(
        habits,
        md,
        year,
        month,
        day,
      );
      if (required === 0) continue;
      if (done === required) {
        chain += 1;
        best = Math.max(best, chain);
      } else {
        chain = 0;
      }
    }
  });

  let current = 0;
  const today = new Date();
  const viewedIsCurrent =
    today.getFullYear() === state.currentYear &&
    today.getMonth() === state.currentMonth;
  const viewedIsFuture =
    state.currentYear > today.getFullYear() ||
    (state.currentYear === today.getFullYear() &&
      state.currentMonth > today.getMonth());

  if (!viewedIsFuture) {
    let y = state.currentYear;
    let m = state.currentMonth;
    let d = viewedIsCurrent ? today.getDate() : daysInMonth(y, m);

    if (viewedIsCurrent) {
      const mdToday = state.months[monthKey(y, m)];
      if (mdToday) {
        const { required, done } = evaluateDayCompletion(
          habits,
          mdToday,
          y,
          m,
          d,
        );
        if (required > 0 && done !== required) {
          d -= 1;
          if (d < 1) {
            m -= 1;
            if (m < 0) {
              m = 11;
              y -= 1;
            }
            d = daysInMonth(y, m);
          }
        }
      }
    }

    let safety = 370;
    while (safety-- > 0) {
      const md = state.months[monthKey(y, m)];
      if (!md) {
        const anyTracked = habits.some((h) => isHabitTrackedOnDate(h, y, m, d));
        if (anyTracked) break;
      } else {
        const { required, done } = evaluateDayCompletion(habits, md, y, m, d);
        if (required > 0) {
          if (done !== required) break;
          current += 1;
        }
      }
      d -= 1;
      if (d < 1) {
        m -= 1;
        if (m < 0) {
          m = 11;
          y -= 1;
        }
        d = daysInMonth(y, m);
      }
    }
  }

  best = Math.max(best, current);
  return { current, best };
}

export function renderDailyHabitsGrid() {
  closeDashboardHabitActionsMenu({ restoreFocus: false });

  const grid = document.getElementById("dailyHabitsGrid");
  if (!grid) return;

  ensureDashboardHabitActionsMenu();

  const monthData = getCurrentMonthData();
  const habits = getSortedDailyHabits();
  const totalDays = daysInMonth(state.currentYear, state.currentMonth);
  const { weeks, dayToWeek } = getMonthCalendarWeekLayout(
    state.currentYear,
    state.currentMonth,
  );
  const weekStartDays = new Set(weeks.map((range) => range.start));
  const today = new Date();
  const isCurrentMonthView =
    today.getFullYear() === state.currentYear &&
    today.getMonth() === state.currentMonth;
  const todayDay = isCurrentMonthView ? today.getDate() : -1;
  const currentViewMonthKey = monthKey(state.currentYear, state.currentMonth);

  function isDayFullyCompleted(day) {
    let requiredCount = 0;
    let checkedCount = 0;

    habits.forEach((habit) => {
      if (
        !isHabitTrackedOnDate(habit, state.currentYear, state.currentMonth, day)
      ) {
        return;
      }

      requiredCount += 1;
      if (
        monthData.dailyCompletions[habit.id] &&
        monthData.dailyCompletions[habit.id][day]
      ) {
        checkedCount += 1;
      }
    });

    return requiredCount > 0 && checkedCount === requiredCount;
  }

  const completedDays = {};
  for (let day = 1; day <= totalDays; day++) {
    completedDays[day] = isDayFullyCompleted(day);
  }

  function syncDayCompletionClass(day, isComplete) {
    const dayHeader = grid.querySelector(`th.day-col[data-day='${day}']`);
    if (dayHeader) {
      dayHeader.classList.toggle("day-complete", !!isComplete);
    }

    grid
      .querySelectorAll(`td.day-cell[data-day='${day}']`)
      .forEach((cell) => cell.classList.toggle("day-complete", !!isComplete));
  }

  let html = "<thead><tr><th class='habit-name-col'><span>Habits</span></th>";
  for (let day = 1; day <= totalDays; day++) {
    const isToday = day === todayDay;
    const isComplete = completedDays[day];
    const weekNumber = dayToWeek[day] || 1;
    const weekShadeColor = getWeekShadeColor(weekNumber);
    const weekBandBg =
      weekNumber % 2 === 1
        ? "rgba(125, 200, 240, 0.10)"
        : "rgba(60, 130, 200, 0.28)";
    const weekStartClass =
      weekStartDays.has(day) && day !== 1 ? "week-start" : "";
    html += `<th class='day-col ${weekStartClass} ${isToday ? "today" : ""} ${isComplete ? "day-complete" : ""}' style='--week-accent:${weekShadeColor};--week-band-bg:${weekBandBg}' data-day='${day}' tabindex='0'><span class='day-col-week'>W${weekNumber}</span><span class='day-col-day'>${day}</span></th>`;
  }
  html += "</tr></thead><tbody>";

  habits.forEach((habit, idx) => {
    const emoji = sanitize(getHabitEmoji(habit));
    const canMoveUp = idx > 0;
    const canMoveDown = idx < habits.length - 1;
    html += `<tr><td class='habit-name-cell'><div class='habit-name-cell-inner'><div class='habit-name-main'><span class='habit-title' title='${sanitize(habit.name)}'>${emoji} ${sanitize(habit.name)}</span><span class='streak-badge' data-streak-habit='${habit.id}' data-streak-current='0' data-streak-best='0' title='Current 0d | Best 0d' aria-label='Current 0d | Best 0d'>Current 0d | Best 0d</span></div><button type='button' class='habit-actions-toggle' data-habit-id='${habit.id}' data-can-move-up='${canMoveUp ? "true" : "false"}' data-can-move-down='${canMoveDown ? "true" : "false"}' aria-label='Open actions for ${sanitize(habit.name)}' aria-haspopup='menu' aria-expanded='false'>⋯</button></div></td>`;
    for (let day = 1; day <= totalDays; day++) {
      const isToday = day === todayDay;
      const isComplete = completedDays[day];
      const weekNumber = dayToWeek[day] || 1;
      const weekShadeColor = getWeekShadeColor(weekNumber);
      const weekBandBg =
        weekNumber % 2 === 1
          ? "rgba(125, 200, 240, 0.10)"
          : "rgba(60, 130, 200, 0.28)";
      const weekStartClass =
        weekStartDays.has(day) && day !== 1 ? "week-start" : "";
      if (
        !isHabitTrackedOnDate(habit, state.currentYear, state.currentMonth, day)
      ) {
        html += `<td class='day-cell day-cell-off ${weekStartClass} ${isToday ? "today-col" : ""} ${isComplete ? "day-complete" : ""}' style='--week-accent:${weekShadeColor};--week-band-bg:${weekBandBg}' data-day='${day}'><span class='off-day-mark'>OFF</span></td>`;
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
      html += `<td class='day-cell ${weekStartClass} ${isToday ? "today-col" : ""} ${isComplete ? "day-complete" : ""}' style='--week-accent:${weekShadeColor};--week-band-bg:${weekBandBg}' data-day='${day}'><div class='day-cell-content'><input type='checkbox' class='habit-check ${isToday ? "today-check" : ""}' data-habit='${habit.id}' data-day='${day}' ${checked}><button type='button' class='note-btn ${hasNote ? "has-note" : ""}' data-habit='${habit.id}' data-day='${day}'>📝</button></div></td>`;
    }
    html += "</tr>";
  });

  html += "</tbody>";
  grid.innerHTML = html;
  syncAllStreakBadges(grid);

  if (!isCurrentMonthView) {
    globals.lastAutoScrolledMonthKey = null;
  } else if (globals.lastAutoScrolledMonthKey !== currentViewMonthKey) {
    globals.lastAutoScrolledMonthKey = currentViewMonthKey;
    requestAnimationFrame(() => {
      const todayHeader = grid.querySelector("th.day-col.today");
      const wrapper = grid.closest(".habits-grid-wrapper");
      if (!todayHeader || !wrapper) return;

      const maxScrollLeft = wrapper.scrollWidth - wrapper.clientWidth;
      if (maxScrollLeft <= 0) return;

      const targetLeft = Math.max(
        0,
        Math.min(
          maxScrollLeft,
          todayHeader.offsetLeft -
            wrapper.clientWidth / 2 +
            todayHeader.offsetWidth / 2,
        ),
      );

      const reduceMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      wrapper.scrollTo({
        left: targetLeft,
        behavior: reduceMotion ? "auto" : "smooth",
      });
    });
  }

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
      callRenderer("renderAnalyticsView");
      updateHabitStreak(habitId);

      syncDayCompletionClass(day, isDayFullyCompleted(day));
    });
  });

  grid.querySelectorAll(".note-btn").forEach((btn) => {
    btn.addEventListener("click", function () {
      callRenderer(
        "openNoteModal",
        this.dataset.habit,
        parseInt(this.dataset.day, 10),
      );
    });
  });

  bindDailyGridHoverInteractions(grid);

  habits.forEach((h) => updateHabitStreak(h.id));
}

function renderCategoriesList() {
  const list = document.getElementById("categoriesList");
  if (!list) return;
  if (state.categories.length === 0) {
    list.innerHTML = "<div class='empty-state'><p>No categories yet.</p></div>";
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
    .map((h, idx) => {
      const cat = getCategoryById(h.categoryId);
      const mode = getHabitScheduleMode(h)
        .replace("specific_weekdays", "specific weekdays")
        .replace("specific_month_days", "specific month days");
      return `<div class='manage-item'><div class='manage-item-info'><span class='manage-item-emoji'>${sanitize(getHabitEmoji(h))}</span><div><div class='manage-item-name'>${sanitize(h.name)}</div><div class='manage-item-meta'>${cat ? sanitize(cat.name) : "No category"} · ${sanitize(mode)}</div></div></div><div class='manage-item-actions'><button class='manage-btn' onclick="HabitApp.moveHabit('${h.id}', 'up')" ${idx === 0 ? "disabled" : ""} title='Move up'>↑</button><button class='manage-btn' onclick="HabitApp.moveHabit('${h.id}', 'down')" ${idx === habits.length - 1 ? "disabled" : ""} title='Move down'>↓</button><button class='manage-btn' onclick="HabitApp.editHabit('${h.id}')">Edit</button><button class='manage-btn delete' onclick="HabitApp.deleteHabit('${h.id}')">Delete</button></div></div>`;
    })
    .join("");
}

export function renderManageView() {
  renderCategoriesList();
  renderDailyHabitsList();
}

export function renderAll() {
  clearLinkedHoverState();
  renderMonthHeader();
  renderSummary();
  renderWeeklySummaryCards();
  renderDailyHabitsGrid();
  renderManageView();

  if (document.getElementById("view-analytics")?.classList.contains("active")) {
    callRenderer("renderAnalyticsView");
  }
}

// Register renderers
registerRenderer("renderAll", renderAll);
registerRenderer("renderManageView", renderManageView);
registerRenderer("switchView", switchView);
registerRenderer("renderDailyHabitsGrid", renderDailyHabitsGrid);
