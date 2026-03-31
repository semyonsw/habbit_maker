(function () {
  "use strict";

  H.getDefaultMonthData = function () {
    return {
      dailyCompletions: {},
      dailyNotes: {},
      monthlyReview: { wins: "", blockers: "", focus: "" },
    };
  };

  H.ensureMonthDataShape = function (monthData) {
    if (!H.isPlainObject(monthData.dailyCompletions)) {
      monthData.dailyCompletions = {};
    }
    if (!H.isPlainObject(monthData.dailyNotes)) {
      monthData.dailyNotes = {};
    }
    if (!H.isPlainObject(monthData.monthlyReview)) {
      monthData.monthlyReview = {};
    }
    monthData.monthlyReview.wins = String(monthData.monthlyReview.wins || "");
    monthData.monthlyReview.blockers = String(
      monthData.monthlyReview.blockers || "",
    );
    monthData.monthlyReview.focus = String(monthData.monthlyReview.focus || "");
    return monthData;
  };

  H.ensureBooksShape = function (input) {
    if (!H.isPlainObject(input.books)) {
      input.books = { items: [], activeBookId: null };
    }
    if (!Array.isArray(input.books.items)) {
      input.books.items = [];
    }
    if (typeof input.books.activeBookId !== "string") {
      input.books.activeBookId = null;
    }
    if (!H.isPlainObject(input.books.ai)) {
      input.books.ai = {};
    }
    input.books.ai.apiKey = "";
    input.books.ai.apiKeyMode = "encrypted";
    input.books.ai.apiKeySaved = H.hasStoredEncryptedApiKey();
    input.books.ai.apiKeyLastUpdated = String(
      input.books.ai.apiKeyLastUpdated || "",
    );
    input.books.ai.model = H.ensureModelAllowed(input.books.ai.model);
    var normalizedChunkChars = parseInt(input.books.ai.chunkChars, 10);
    input.books.ai.chunkChars = Number.isFinite(normalizedChunkChars)
      ? Math.min(30000, Math.max(4000, normalizedChunkChars))
      : H.SUMMARY_MAX_CHARS_PER_CHUNK_DEFAULT;
    var normalizedMaxPages = parseInt(input.books.ai.maxPagesPerRun, 10);
    input.books.ai.maxPagesPerRun = Number.isFinite(normalizedMaxPages)
      ? Math.min(1000, Math.max(20, normalizedMaxPages))
      : H.SUMMARY_MAX_PAGES_PER_RUN_DEFAULT;
    input.books.ai.consolidateMode =
      input.books.ai.consolidateMode === false ? false : true;

    input.books.items = input.books.items
      .filter(function (book) { return H.isPlainObject(book) && typeof book.bookId === "string"; })
      .map(function (book) {
        var createdAt = String(book.createdAt || H.nowIso());
        var updatedAt = String(book.updatedAt || createdAt);
        var cleanBook = {
          bookId: String(book.bookId),
          title:
            String(book.title || "Untitled Book").trim() || "Untitled Book",
          author: book.author ? String(book.author) : "",
          fileId: String(book.fileId || H.uid("file")),
          fileName: String(book.fileName || "unknown.pdf"),
          fileSize: Number.isFinite(book.fileSize)
            ? Math.max(0, book.fileSize)
            : 0,
          totalPagesDetected: Number.isFinite(
            parseInt(book.totalPagesDetected, 10),
          )
            ? Math.max(1, parseInt(book.totalPagesDetected, 10))
            : null,
          totalPagesDetectedAt: String(book.totalPagesDetectedAt || ""),
          totalPagesOverride: Number.isFinite(
            parseInt(book.totalPagesOverride, 10),
          )
            ? Math.max(1, parseInt(book.totalPagesOverride, 10))
            : null,
          createdAt: createdAt,
          updatedAt: updatedAt,
          bookmarks: [],
        };

        var rawBookmarks = Array.isArray(book.bookmarks)
          ? book.bookmarks
          : [];
        cleanBook.bookmarks = rawBookmarks
          .filter(
            function (bm) {
              return H.isPlainObject(bm) &&
                typeof bm.bookmarkId === "string" &&
                Number.isFinite(Number(bm.pdfPage));
            },
          )
          .map(function (bm) {
            var bmCreatedAt = String(bm.createdAt || H.nowIso());
            var bmUpdatedAt = String(bm.updatedAt || bmCreatedAt);
            var history = Array.isArray(bm.history) ? bm.history : [];
            var bookmarkPage = Math.max(1, parseInt(bm.pdfPage, 10) || 1);
            var summaries = Array.isArray(bm.summaries) ? bm.summaries : [];
            return {
              bookmarkId: String(bm.bookmarkId),
              label: String(bm.label || "Bookmark").trim() || "Bookmark",
              pdfPage: bookmarkPage,
              realPage: (function () {
                var parsed = parseInt(bm.realPage, 10);
                return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
              })(),
              note: String(bm.note || ""),
              createdAt: bmCreatedAt,
              updatedAt: bmUpdatedAt,
              history: history
                .filter(function (h) { return H.isPlainObject(h); })
                .map(function (h) {
                  return {
                    eventId: String(h.eventId || H.uid("hist")),
                    type: String(h.type || "updated"),
                    at: String(h.at || bmUpdatedAt),
                    note: String(h.note || ""),
                  };
                })
                .sort(function (a, b) { return a.at < b.at ? 1 : -1; })
                .slice(0, H.MAX_BOOKMARK_HISTORY),
              summaries: summaries
                .filter(function (s) { return H.isPlainObject(s); })
                .map(function (s) {
                  var sCreatedAt = String(s.createdAt || H.nowIso());
                  var sUpdatedAt = String(s.updatedAt || sCreatedAt);
                  var fallbackStart =
                    s.isIncremental === true
                      ? Math.max(1, parseInt(s.startPage, 10) || 1)
                      : 1;
                  var startPage = Math.max(
                    1,
                    parseInt(s.startPage, 10) || fallbackStart,
                  );
                  var endPage = Math.max(
                    startPage,
                    parseInt(s.endPage, 10) || bookmarkPage,
                  );
                  var status = ["ready", "failed", "running"].includes(
                    String(s.status || ""),
                  )
                    ? String(s.status)
                    : String(s.content || "").trim().length
                      ? "ready"
                      : "failed";
                  var basedOnSummaryId =
                    typeof s.basedOnSummaryId === "string" &&
                    s.basedOnSummaryId.trim()
                      ? s.basedOnSummaryId
                      : null;
                  var durationMs = Number.isFinite(Number(s.durationMs))
                    ? Math.max(0, Number(s.durationMs))
                    : null;
                  return {
                    summaryId: String(s.summaryId || H.uid("sum")),
                    model: String(s.model || ""),
                    startPage: startPage,
                    endPage: endPage,
                    isIncremental: s.isIncremental === true,
                    basedOnSummaryId: basedOnSummaryId,
                    createdAt: sCreatedAt,
                    updatedAt: sUpdatedAt,
                    status: status,
                    content: String(s.content || ""),
                    chunkMeta: H.isPlainObject(s.chunkMeta) ? s.chunkMeta : {},
                    durationMs: durationMs,
                    error: String(s.error || ""),
                  };
                })
                .sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; }),
            };
          })
          .sort(function (a, b) { return a.updatedAt < b.updatedAt ? 1 : -1; });

        return cleanBook;
      });

    if (!H.isPlainObject(input.books.helper)) {
      input.books.helper = {};
    }
    input.books.helper.selectedBookId =
      typeof input.books.helper.selectedBookId === "string"
        ? input.books.helper.selectedBookId
        : "";
    input.books.helper.targetDate =
      typeof input.books.helper.targetDate === "string"
        ? input.books.helper.targetDate
        : "";
    input.books.helper.startPage = Number.isFinite(
      parseInt(input.books.helper.startPage, 10),
    )
      ? Math.max(1, parseInt(input.books.helper.startPage, 10))
      : null;
    var rawWeekdays = Array.isArray(input.books.helper.weekdays)
      ? input.books.helper.weekdays
      : [].concat(H.ALL_WEEKDAYS);
    input.books.helper.weekdays = [].concat(new Set(rawWeekdays))
      .map(function (value) { return parseInt(value, 10); })
      .filter(function (value) { return Number.isInteger(value) && value >= 0 && value <= 6; })
      .sort(function (a, b) { return a - b; });
  };

  H.getDefaultState = function () {
    var now = new Date();
    var key = H.monthKey(now.getFullYear(), now.getMonth());
    return {
      currentYear: now.getFullYear(),
      currentMonth: now.getMonth(),
      categories: JSON.parse(JSON.stringify(H.DEFAULT_CATEGORIES)),
      habits: {
        daily: H.DEFAULT_DAILY_HABITS.map(function (h, idx) {
          var copy = {};
          for (var k in h) { if (Object.prototype.hasOwnProperty.call(h, k)) copy[k] = h[k]; }
          copy.order = idx;
          return copy;
        }),
      },
      months: {},
      books: {
        items: [],
        activeBookId: null,
        helper: {
          selectedBookId: "",
          targetDate: "",
          startPage: null,
          weekdays: [].concat(H.ALL_WEEKDAYS),
        },
        ai: {
          apiKey: "",
          apiKeyMode: "encrypted",
          apiKeySaved: false,
          apiKeyLastUpdated: "",
          model: "gemini-2.5-flash",
          chunkChars: H.SUMMARY_MAX_CHARS_PER_CHUNK_DEFAULT,
          maxPagesPerRun: H.SUMMARY_MAX_PAGES_PER_RUN_DEFAULT,
          consolidateMode: true,
        },
      },
      meta: {
        schemaVersion: H.SCHEMA_VERSION,
      },
    };
  };

  // Set the month key after building
  H.getDefaultState._withMonth = true;
  var _origGetDefaultState = H.getDefaultState;
  H.getDefaultState = function () {
    var s = _origGetDefaultState();
    var now = new Date();
    var key = H.monthKey(now.getFullYear(), now.getMonth());
    s.months[key] = H.getDefaultMonthData();
    return s;
  };

  H.migrateState = function () {
    if (!H.isPlainObject(H.state)) {
      H.state = H.getDefaultState();
      return;
    }

    if (!Array.isArray(H.state.categories)) {
      H.state.categories = JSON.parse(JSON.stringify(H.DEFAULT_CATEGORIES));
    }

    if (!H.isPlainObject(H.state.habits)) {
      H.state.habits = { daily: [] };
    }
    if (!Array.isArray(H.state.habits.daily)) {
      H.state.habits.daily = [];
    }
    delete H.state.habits.weekly;

    if (!H.isPlainObject(H.state.months)) {
      H.state.months = {};
    }
    Object.keys(H.state.months).forEach(function (key) {
      if (!H.isPlainObject(H.state.months[key])) {
        H.state.months[key] = H.getDefaultMonthData();
      }
      delete H.state.months[key].weeklyCompletions;
      H.ensureMonthDataShape(H.state.months[key]);
    });

    H.state.habits.daily.forEach(function (habit, idx) {
      habit.id = String(habit.id || H.uid("dh"));
      habit.name = String(habit.name || "Habit");
      habit.categoryId = String(habit.categoryId || "");
      habit.monthGoal = Math.max(1, parseInt(habit.monthGoal, 10) || 20);

      if (!Array.isArray(habit.excludedWeekdays)) {
        var legacy = Array.isArray(habit.excludedDays)
          ? habit.excludedDays
          : [];
        habit.excludedWeekdays = legacy
          .map(function (d) { return parseInt(d, 10); })
          .filter(function (d) { return Number.isInteger(d) && d >= 0 && d <= 6; });
      }
      habit.excludedWeekdays = [].concat(new Set(habit.excludedWeekdays))
        .filter(function (d) { return Number.isInteger(d) && d >= 0 && d <= 6; })
        .sort(function (a, b) { return a - b; });

      var mode = String(habit.scheduleMode || habit.type || "fixed");
      if (mode === "dynamic") {
        var activeWeekdays = H.ALL_WEEKDAYS.filter(
          function (weekday) { return !habit.excludedWeekdays.includes(weekday); },
        );
        habit.activeWeekdays = activeWeekdays.length
          ? activeWeekdays
          : [].concat(H.ALL_WEEKDAYS);
        mode =
          habit.activeWeekdays.length === 7 ? "fixed" : "specific_weekdays";
      }

      if (mode !== "specific_weekdays" && mode !== "specific_month_days") {
        mode = "fixed";
      }

      habit.activeWeekdays = H.normalizeWeekdayArray(
        Array.isArray(habit.activeWeekdays)
          ? habit.activeWeekdays
          : mode === "specific_weekdays"
            ? H.ALL_WEEKDAYS.filter(
                function (weekday) { return !habit.excludedWeekdays.includes(weekday); },
              )
            : H.ALL_WEEKDAYS,
      );
      if (!habit.activeWeekdays.length) {
        habit.activeWeekdays = [].concat(H.ALL_WEEKDAYS);
      }

      habit.activeMonthDays = H.normalizeMonthDayArray(
        Array.isArray(habit.activeMonthDays) ? habit.activeMonthDays : [],
      );
      if (mode === "specific_month_days" && !habit.activeMonthDays.length) {
        habit.activeMonthDays = [1];
      }

      if (mode === "fixed") {
        habit.activeWeekdays = [].concat(H.ALL_WEEKDAYS);
      }

      habit.scheduleMode = mode;
      habit.type = mode;
      delete habit.excludedDays;
      habit.emoji = String(habit.emoji || "\uD83D\uDCCC");
      habit.order = Number.isInteger(habit.order) ? habit.order : idx;
    });
    H.state.habits.daily.sort(function (a, b) { return a.order - b.order; });
    H.state.habits.daily.forEach(function (h, idx) {
      h.order = idx;
    });

    H.ensureBooksShape(H.state);

    if (!H.isPlainObject(H.state.meta)) {
      H.state.meta = {};
    }
    H.state.meta.schemaVersion = H.SCHEMA_VERSION;

    if (!Number.isInteger(H.state.currentYear)) {
      H.state.currentYear = new Date().getFullYear();
    }
    if (
      !Number.isInteger(H.state.currentMonth) ||
      H.state.currentMonth < 0 ||
      H.state.currentMonth > 11
    ) {
      H.state.currentMonth = new Date().getMonth();
    }
  };

  H.ensureMonthData = function () {
    var key = H.monthKey(H.state.currentYear, H.state.currentMonth);
    if (!H.state.months[key]) {
      H.state.months[key] = H.getDefaultMonthData();
    }
    H.ensureMonthDataShape(H.state.months[key]);
  };

  H.getCurrentMonthData = function () {
    H.ensureMonthData();
    return H.state.months[H.monthKey(H.state.currentYear, H.state.currentMonth)];
  };

  H.loadState = function () {
    try {
      var raw = localStorage.getItem(H.STORAGE_KEY);
      if (raw) {
        H.state = JSON.parse(raw);
        H.migrateState();
        H.ensureMonthData();
        if (
          H.isPlainObject(H.state.books) &&
          H.isPlainObject(H.state.books.ai) &&
          typeof H.state.books.ai.apiKey === "string" &&
          H.state.books.ai.apiKey.trim().length
        ) {
          H.legacyPlaintextApiKeyForMigration = H.state.books.ai.apiKey.trim();
          H.appendLogEntry({
            level: "warn",
            component: "secure-settings",
            operation: "loadState",
            message: "Legacy plaintext API key detected; scrubbing from state.",
          });
          H.state.books.ai.apiKey = "";
        }
        H.saveState();
        return;
      }
    } catch (error) {
      H.appendLogEntry({
        level: "error",
        component: "state",
        operation: "loadState",
        message: "Failed to load state, using defaults.",
        error: error,
      });
    }

    H.state = H.getDefaultState();
    H.saveState();
  };

  H.saveState = function () {
    localStorage.setItem(H.STORAGE_KEY, JSON.stringify(H.state));
  };

  H.getCategoryById = function (categoryId) {
    return H.state.categories.find(function (c) { return c.id === categoryId; }) || null;
  };

  H.getHabitEmoji = function (habit) {
    if (habit.emoji) return habit.emoji;
    var cat = H.getCategoryById(habit.categoryId);
    return cat ? cat.emoji : "\uD83D\uDCCC";
  };

  H.isHabitTrackedOnDate = function (habit, year, month, day) {
    if (!habit) return true;
    var mode = H.getHabitScheduleMode(habit);
    if (mode === "fixed") return true;

    if (mode === "specific_weekdays") {
      var weekday = new Date(year, month, day).getDay();
      var activeWeekdays = H.normalizeWeekdayArray(
        Array.isArray(habit.activeWeekdays)
          ? habit.activeWeekdays
          : H.ALL_WEEKDAYS,
      );
      return activeWeekdays.includes(weekday);
    }

    if (mode === "specific_month_days") {
      var activeMonthDays = H.normalizeMonthDayArray(
        Array.isArray(habit.activeMonthDays) ? habit.activeMonthDays : [],
      );
      return activeMonthDays.includes(day);
    }

    return true;
  };

  H.getSortedDailyHabits = function () {
    return [].concat(H.state.habits.daily).sort(
      function (a, b) { return (a.order || 0) - (b.order || 0); },
    );
  };

  H.updateHabitOrder = function () {
    H.state.habits.daily = H.getSortedDailyHabits();
    H.state.habits.daily.forEach(function (h, idx) {
      h.order = idx;
    });
  };
})();
