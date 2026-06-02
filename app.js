const STORAGE_KEY = "local-kanban-board-v1";

const columns = [
  { id: "todo", title: "未対応" },
  { id: "progress", title: "対応中" },
  { id: "review", title: "レビュー中" },
  { id: "done", title: "完了" },
];

const priorityLabels = {
  high: "高",
  medium: "中",
  low: "低",
};

const seedTasks = [
  {
    id: crypto.randomUUID(),
    title: "ログイン画面のワイヤーフレーム確認",
    description: "認証導線とエラー表示の文言を確認する。",
    status: "todo",
    priority: "high",
    assignee: "Sato",
    dueDate: todayOffset(2),
    createdAt: Date.now(),
  },
  {
    id: crypto.randomUUID(),
    title: "API レスポンスの型定義を整理",
    description: "一覧、詳細、更新のレスポンスを合わせる。",
    status: "progress",
    priority: "medium",
    assignee: "Tanaka",
    dueDate: todayOffset(5),
    createdAt: Date.now() + 1,
  },
  {
    id: crypto.randomUUID(),
    title: "レビュー指摘の反映",
    description: "表示崩れと空状態の修正を確認する。",
    status: "review",
    priority: "medium",
    assignee: "Yamada",
    dueDate: todayOffset(1),
    createdAt: Date.now() + 2,
  },
  {
    id: crypto.randomUUID(),
    title: "プロジェクト初期設定",
    description: "ボード、列、タスクの基本操作を用意する。",
    status: "done",
    priority: "low",
    assignee: "Ito",
    dueDate: todayOffset(-1),
    createdAt: Date.now() + 3,
  },
];

let tasks = loadTasks();
let activeDragId = null;
let currentView = "board";

const board = document.querySelector("#board");
const gantt = document.querySelector("#gantt");
const taskDialog = document.querySelector("#taskDialog");
const taskForm = document.querySelector("#taskForm");
const dialogTitle = document.querySelector("#dialogTitle");
const deleteTaskButton = document.querySelector("#deleteTaskButton");
const toast = document.querySelector("#toast");
const boardViewButton = document.querySelector("#boardViewButton");
const ganttViewButton = document.querySelector("#ganttViewButton");
const menuButton = document.querySelector("#menuButton");
const actionMenu = document.querySelector("#actionMenu");

const controls = {
  search: document.querySelector("#searchInput"),
  priority: document.querySelector("#priorityFilter"),
  assignee: document.querySelector("#assigneeFilter"),
};

document.querySelector("#newTaskButton").addEventListener("click", () => openTaskDialog());
document.querySelector("#seedButton").addEventListener("click", seedSampleTasks);
document.querySelector("#clearButton").addEventListener("click", clearTasks);
document.querySelector("#exportButton").addEventListener("click", exportTasks);
boardViewButton.addEventListener("click", () => setView("board"));
ganttViewButton.addEventListener("click", () => setView("gantt"));
menuButton.addEventListener("click", toggleActionMenu);
actionMenu.addEventListener("click", (event) => {
  if (event.target.closest("button")) closeActionMenu();
});
document.addEventListener("click", closeMenuOnOutsideClick);
document.addEventListener("keydown", closeMenuOnEscape);
taskForm.addEventListener("submit", saveTask);
deleteTaskButton.addEventListener("click", deleteCurrentTask);

Object.values(controls).forEach((control) => {
  control.addEventListener("input", render);
  control.addEventListener("change", render);
});

render();

function loadTasks() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
}

function render() {
  const visible = filteredTasks();
  board.classList.toggle("hidden", currentView !== "board");
  gantt.classList.toggle("hidden", currentView !== "gantt");
  boardViewButton.classList.toggle("active", currentView === "board");
  ganttViewButton.classList.toggle("active", currentView === "gantt");
  boardViewButton.setAttribute("aria-pressed", String(currentView === "board"));
  ganttViewButton.setAttribute("aria-pressed", String(currentView === "gantt"));

  if (currentView === "gantt") {
    renderGantt(visible);
    return;
  }

  renderBoard(visible);
}

function renderBoard(visible) {
  board.innerHTML = "";

  columns.forEach((column) => {
    const columnEl = document.createElement("section");
    columnEl.className = "column";
    columnEl.dataset.status = column.id;
    columnEl.innerHTML = `
      <div class="column-header">
        <h2>${column.title}</h2>
        <span class="count">${visible.filter((task) => task.status === column.id).length}</span>
      </div>
      <div class="task-list" data-list="${column.id}"></div>
    `;

    const list = columnEl.querySelector(".task-list");
    const columnTasks = visible
      .filter((task) => task.status === column.id)
      .sort((a, b) => (a.order ?? a.createdAt) - (b.order ?? b.createdAt));

    if (columnTasks.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "ここにタスクをドロップ";
      list.append(empty);
    } else {
      columnTasks.forEach((task) => list.append(createTaskCard(task)));
    }

    addDropHandlers(columnEl);
    board.append(columnEl);
  });
}

function renderGantt(visible) {
  gantt.innerHTML = "";

  if (!visible.length) {
    const empty = document.createElement("div");
    empty.className = "empty gantt-empty";
    empty.textContent = "表示するタスクがありません";
    gantt.append(empty);
    return;
  }

  const sorted = [...visible].sort((a, b) => getTaskStart(a) - getTaskStart(b));
  const range = getGanttRange(sorted);
  const days = eachDay(range.start, range.end);
  const todayKey = toDateKey(new Date());

  const chart = document.createElement("section");
  chart.className = "gantt-chart";
  chart.style.setProperty("--day-count", days.length);
  chart.innerHTML = `
    <div class="gantt-head task-head">タスク</div>
    <div class="gantt-head meta-head">情報</div>
    <div class="gantt-timeline-head"></div>
  `;

  const timelineHead = chart.querySelector(".gantt-timeline-head");
  days.forEach((day) => {
    const dayEl = document.createElement("div");
    dayEl.className = "gantt-day";
    dayEl.classList.toggle("today", toDateKey(day) === todayKey);
    dayEl.textContent = new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric" }).format(day);
    timelineHead.append(dayEl);
  });

  sorted.forEach((task) => {
    const start = getTaskStart(task);
    const end = getTaskEnd(task, start);
    const offset = Math.max(0, daysBetween(range.start, start));
    const duration = Math.max(1, daysBetween(start, end) + 1);
    const rowClass = task.dueDate ? "" : " no-due";
    const todayIndex = days.findIndex((day) => toDateKey(day) === todayKey);

    const name = document.createElement("button");
    name.className = `gantt-task-name${rowClass}`;
    name.type = "button";
    name.addEventListener("click", () => openTaskDialog(task));
    name.innerHTML = `
      <strong></strong>
      <span>${getColumnTitle(task.status)} / ${priorityLabels[task.priority]}</span>
    `;
    name.querySelector("strong").textContent = task.title;

    const meta = document.createElement("div");
    meta.className = "gantt-task-meta";
    meta.innerHTML = `
      <span>${task.assignee || "未割当"}</span>
      <span>${task.dueDate ? formatDate(task.dueDate) : "期限なし"}</span>
    `;

    const row = document.createElement("div");
    row.className = "gantt-row";
    row.style.setProperty("--start", offset + 1);
    row.style.setProperty("--span", duration);
    row.style.setProperty("--today", Math.max(1, todayIndex + 1));
    row.style.setProperty("--today-display", todayIndex === -1 ? "none" : "block");

    const bar = document.createElement("button");
    bar.className = `gantt-bar ${task.priority}${rowClass}`;
    bar.type = "button";
    bar.textContent = task.title;
    bar.title = `${task.title} / ${task.assignee || "未割当"} / ${
      task.dueDate ? formatDate(task.dueDate) : "期限なし"
    }`;
    bar.addEventListener("click", () => openTaskDialog(task));

    row.append(bar);
    chart.append(name, meta, row);
  });

  gantt.append(chart);
}

function filteredTasks() {
  const query = controls.search.value.trim().toLowerCase();
  const priority = controls.priority.value;
  const assignee = controls.assignee.value.trim().toLowerCase();

  return tasks.filter((task) => {
    const text = `${task.title} ${task.description} ${task.assignee}`.toLowerCase();
    const matchesQuery = !query || text.includes(query);
    const matchesPriority = priority === "all" || task.priority === priority;
    const matchesAssignee = !assignee || task.assignee.toLowerCase().includes(assignee);
    return matchesQuery && matchesPriority && matchesAssignee;
  });
}

function createTaskCard(task) {
  const card = document.createElement("article");
  card.className = "task-card";
  card.draggable = true;
  card.dataset.id = task.id;
  card.innerHTML = `
    <div class="task-title-row">
      <h3 class="task-title"></h3>
      <span class="pill ${task.priority}">${priorityLabels[task.priority]}</span>
    </div>
    <p class="task-description"></p>
    <div class="meta">
      <span class="pill">${task.assignee || "未割当"}</span>
      ${task.dueDate ? `<span class="pill">${formatDate(task.dueDate)}</span>` : ""}
    </div>
  `;
  card.querySelector(".task-title").textContent = task.title;
  card.querySelector(".task-description").textContent = task.description || "説明なし";

  card.addEventListener("click", () => openTaskDialog(task));
  card.addEventListener("dragstart", (event) => {
    activeDragId = task.id;
    card.classList.add("dragging");
    event.dataTransfer.effectAllowed = "move";
  });
  card.addEventListener("dragend", () => {
    activeDragId = null;
    card.classList.remove("dragging");
    document.querySelectorAll(".drag-over").forEach((el) => el.classList.remove("drag-over"));
  });

  return card;
}

function addDropHandlers(columnEl) {
  columnEl.addEventListener("dragover", (event) => {
    event.preventDefault();
    columnEl.classList.add("drag-over");
  });

  columnEl.addEventListener("dragleave", (event) => {
    if (!columnEl.contains(event.relatedTarget)) {
      columnEl.classList.remove("drag-over");
    }
  });

  columnEl.addEventListener("drop", (event) => {
    event.preventDefault();
    const nextStatus = columnEl.dataset.status;
    const task = tasks.find((item) => item.id === activeDragId);
    if (!task || task.status === nextStatus) return;

    task.status = nextStatus;
    task.order = Date.now();
    persist();
    render();
  });
}

function openTaskDialog(task = null) {
  taskForm.reset();
  const editing = Boolean(task);
  dialogTitle.textContent = editing ? "タスク編集" : "新規タスク";
  deleteTaskButton.hidden = !editing;

  document.querySelector("#taskId").value = task?.id ?? "";
  document.querySelector("#taskTitle").value = task?.title ?? "";
  document.querySelector("#taskDescription").value = task?.description ?? "";
  document.querySelector("#taskStatus").value = task?.status ?? "todo";
  document.querySelector("#taskPriority").value = task?.priority ?? "medium";
  document.querySelector("#taskAssignee").value = task?.assignee ?? "";
  document.querySelector("#taskDueDate").value = task?.dueDate ?? "";

  taskDialog.showModal();
}

function saveTask(event) {
  event.preventDefault();
  const id = document.querySelector("#taskId").value;
  const payload = {
    title: document.querySelector("#taskTitle").value.trim(),
    description: document.querySelector("#taskDescription").value.trim(),
    status: document.querySelector("#taskStatus").value,
    priority: document.querySelector("#taskPriority").value,
    assignee: document.querySelector("#taskAssignee").value.trim(),
    dueDate: document.querySelector("#taskDueDate").value,
  };

  if (id) {
    tasks = tasks.map((task) => (task.id === id ? { ...task, ...payload } : task));
  } else {
    tasks.push({
      id: crypto.randomUUID(),
      ...payload,
      order: Date.now(),
      createdAt: Date.now(),
    });
  }

  persist();
  taskDialog.close();
  render();
  showToast("保存しました");
}

function deleteCurrentTask() {
  const id = document.querySelector("#taskId").value;
  if (!id) return;
  tasks = tasks.filter((task) => task.id !== id);
  persist();
  taskDialog.close();
  render();
  showToast("削除しました");
}

function seedSampleTasks() {
  if (tasks.length && !confirm("現在のタスクにサンプルを追加しますか？")) return;
  tasks = [...tasks, ...seedTasks.map((task) => ({ ...task, id: crypto.randomUUID() }))];
  persist();
  render();
  showToast("サンプルタスクを追加しました");
}

function clearTasks() {
  if (!tasks.length) return;
  if (!confirm("すべてのタスクを削除しますか？")) return;
  tasks = [];
  persist();
  render();
  showToast("すべて削除しました");
}

function exportTasks() {
  const blob = new Blob([JSON.stringify(tasks, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "kanban-tasks.json";
  link.click();
  URL.revokeObjectURL(url);
}

function setView(nextView) {
  currentView = nextView;
  render();
}

function toggleActionMenu() {
  const willOpen = actionMenu.hidden;
  actionMenu.hidden = !willOpen;
  menuButton.classList.toggle("open", willOpen);
  menuButton.setAttribute("aria-expanded", String(willOpen));
  menuButton.setAttribute("aria-label", willOpen ? "メニューを閉じる" : "メニューを開く");
}

function closeActionMenu() {
  actionMenu.hidden = true;
  menuButton.classList.remove("open");
  menuButton.setAttribute("aria-expanded", "false");
  menuButton.setAttribute("aria-label", "メニューを開く");
}

function closeMenuOnOutsideClick(event) {
  if (actionMenu.hidden) return;
  if (event.target.closest(".menu-wrap")) return;
  closeActionMenu();
}

function closeMenuOnEscape(event) {
  if (event.key === "Escape") closeActionMenu();
}

function getColumnTitle(status) {
  return columns.find((column) => column.id === status)?.title ?? status;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => toast.classList.remove("show"), 1800);
}

function getTaskStart(task) {
  const created = task.createdAt ? new Date(task.createdAt) : new Date();
  return startOfDay(created);
}

function getTaskEnd(task, start) {
  if (!task.dueDate) return addDays(start, 1);
  const due = parseDate(task.dueDate);
  return due < start ? start : due;
}

function getGanttRange(list) {
  const starts = list.map(getTaskStart);
  const ends = list.map((task) => getTaskEnd(task, getTaskStart(task)));
  const min = new Date(Math.min(...starts.map((date) => date.getTime())));
  const max = new Date(Math.max(...ends.map((date) => date.getTime())));
  return {
    start: addDays(min, -1),
    end: addDays(max, 2),
  };
}

function eachDay(start, end) {
  const days = [];
  for (let date = startOfDay(start); date <= end; date = addDays(date, 1)) {
    days.push(date);
  }
  return days;
}

function daysBetween(start, end) {
  const ms = startOfDay(end).getTime() - startOfDay(start).getTime();
  return Math.round(ms / 86400000);
}

function parseDate(value) {
  return startOfDay(new Date(`${value}T00:00:00`));
}

function startOfDay(date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return startOfDay(next);
}

function toDateKey(date) {
  return startOfDay(date).toISOString().slice(0, 10);
}

function formatDate(value) {
  const date = new Date(`${value}T00:00:00`);
  return new Intl.DateTimeFormat("ja-JP", { month: "short", day: "numeric" }).format(date);
}

function todayOffset(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}
