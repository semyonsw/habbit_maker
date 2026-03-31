(function () {
  "use strict";

  H.state = null;
  H.chartInstances = {};
  H.sidebarCollapsed = false;
  H.noteModalState = { habitId: null, day: null };
  H.bookModalState = { editingBookId: null };
  H.bookmarkModalState = { editingBookId: null, editingBookmarkId: null };
  H.historyEventModalState = {
    editingBookId: null,
    editingBookmarkId: null,
    editingEventId: null,
  };
  H.summaryModalState = {
    bookId: null,
    bookmarkId: null,
    selectedSummaryId: null,
    statusText: "",
    detectionText: "",
    externalSummary: null,
    isRunning: false,
  };
  H.confirmCallback = null;
  H.editingHabitId = null;
  H.editingCategoryId = null;
  H.idbPromise = null;
  H.booksBlobStatus = {};
  H.topClockTimer = null;
  H.lastAutoScrolledMonthKey = null;
  H.linkedHoverState = {
    day: null,
    week: null,
    scope: null,
    source: null,
  };
  H.secureSettings = {
    keyCiphertext: null,
    saltBase64: null,
    ivBase64: null,
    kdfIterations: 200000,
    keyUpdatedAt: null,
  };
  H.runtimeSecrets = {
    apiKey: "",
    unlockedAt: null,
  };
  H.appLogs = [];
  H.logAutoDownloadBlockedUntil = 0;
  H.legacyPlaintextApiKeyForMigration = "";
  H.summaryModelPickerState = {
    isOpen: false,
    activeIndex: -1,
    filtered: [],
  };
  H.liveLogFileState = {
    enabled: false,
    handle: null,
    writeQueue: Promise.resolve(),
    sessionId: "",
    writeCount: 0,
    lastError: "",
  };
  H.analyticsState = {
    displayMode: "percent",
    booksRangeDays: 30,
  };
  H.finisherState = {
    loadingBookId: null,
    lastError: "",
  };
  H.readerState = {
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
})();
