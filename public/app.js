const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
const COLORS = ['#6366f1', '#3b82f6', '#06b6d4', '#10b981', '#84cc16', '#f59e0b', '#f97316', '#ef4444', '#ec4899', '#a855f7'];
const state = {
  habits: [],
  logs: [],
  health: null,
  tab: 'today',
  weekRef: new Date(),
  modal: null,
  error: '',
  lastLoaded: null,
  installPrompt: null,
  needsNetworkPermission: false,
  busy: false
};

const app = document.querySelector('#app');
const API_ORIGIN = location.hostname === 'sosu7985-jpg.github.io'
  ? 'https://desktop-mlfbsh0.tail8f353a.ts.net:8443'
  : '';

function localDate(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseDate(value) {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function addDays(date, amount) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function weekDays(reference) {
  const start = addDays(reference, -reference.getDay());
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

function esc(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[char]);
}

function logFor(habitId, date) {
  return state.logs.find((log) => log.habit_id === habitId && log.log_date === date) || null;
}

function scheduled(habit, date) {
  return habit.schedule_type === 'weekly' && habit.schedule_days.includes(parseDate(date).getDay());
}

function activeHabits() {
  return state.habits.filter((habit) => !habit.archived);
}

async function api(path, options = {}) {
  const response = await fetch(`${API_ORIGIN}${path}`, {
    ...options,
    ...(API_ORIGIN ? { targetAddressSpace: 'local' } : {}),
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    cache: 'no-store'
  });
  let payload = {};
  try { payload = await response.json(); } catch {}
  if (!response.ok) throw new Error(payload.error || `서버 오류 (${response.status})`);
  return payload;
}

async function loadData({ quiet = false } = {}) {
  if (state.busy) return;
  state.busy = true;
  try {
    const health = await api('/api/health');
    const [habitData, logData] = await Promise.all([api('/api/habits'), api('/api/logs')]);
    state.health = health;
    state.habits = habitData.habits;
    state.logs = logData.logs;
    state.lastLoaded = new Date();
    state.error = '';
  } catch (error) {
    state.health = null;
    state.error = `서버에 연결할 수 없습니다. ${error.message}`;
    if (!quiet) console.error(error);
  } finally {
    state.busy = false;
    if (!state.modal) render();
  }
}

function completedLogs(habitId) {
  return state.logs
    .filter((log) => log.habit_id === habitId && log.status === 'completed')
    .sort((a, b) => b.log_date.localeCompare(a.log_date));
}

function periodicInfo(habit, today = localDate()) {
  const logs = completedLogs(habit.id);
  if (habit.schedule_type === 'monthly') {
    const completion = logs.find((log) => log.log_date.startsWith(today.slice(0, 7))) || null;
    return {
      completion,
      state: completion ? 'completed' : 'due',
      meta: completion ? `${completion.log_date} 완료` : '이번 달 안에 1회',
      sort: completion ? 3 : 1
    };
  }

  const completion = logs[0] || null;
  const dueDate = completion
    ? localDate(addDays(parseDate(completion.log_date), habit.interval_days))
    : habit.anchor_date;
  const diff = Math.round((parseDate(dueDate) - parseDate(today)) / 86400000);
  if (diff < 0) return { completion, dueDate, state: 'overdue', meta: `${Math.abs(diff)}일 지남 · 예정 ${dueDate}`, sort: 0 };
  if (diff === 0) return { completion, dueDate, state: 'due', meta: `오늘 예정 · ${habit.interval_days}일마다`, sort: 1 };
  return { completion, dueDate, state: 'upcoming', meta: `${diff}일 후 · ${dueDate}`, sort: 2 };
}

function weekMetrics(habits = activeHabits()) {
  const today = localDate();
  const dates = weekDays(state.weekRef).map(localDate).filter((date) => date <= today);
  let targets = 0;
  let completed = 0;
  let partial = 0;
  let rest = 0;
  for (const habit of habits) {
    for (const date of dates) {
      if (!scheduled(habit, date)) continue;
      const log = logFor(habit.id, date);
      if (log?.status === 'rest') { rest++; continue; }
      targets++;
      if (log?.status === 'completed') completed++;
      if (log?.status === 'partial') partial++;
    }
  }
  return { targets, completed, partial, rest, percent: targets ? Math.round(completed / targets * 100) : 0 };
}

function streaks(habit) {
  const today = new Date();
  let current = 0;
  let cursor = new Date(today);
  const todayKey = localDate(cursor);
  if (scheduled(habit, todayKey) && logFor(habit.id, todayKey)?.status !== 'completed') cursor = addDays(cursor, -1);
  for (let i = 0; i < 366; i++, cursor = addDays(cursor, -1)) {
    const key = localDate(cursor);
    if (!scheduled(habit, key)) continue;
    const log = logFor(habit.id, key);
    if (log?.status === 'rest') continue;
    if (log?.status === 'completed') current++;
    else break;
  }

  let best = 0;
  let running = 0;
  for (let i = 365; i >= 0; i--) {
    const date = addDays(today, -i);
    const key = localDate(date);
    if (!scheduled(habit, key)) continue;
    const log = logFor(habit.id, key);
    if (log?.status === 'rest') continue;
    if (log?.status === 'completed') {
      running++;
      best = Math.max(best, running);
    } else running = 0;
  }
  return { current, best };
}

function statusButton(log, label = '+') {
  const status = log?.status || 'none';
  const content = status === 'completed' ? '✓' : status === 'partial' ? `${log.numeric_value}` : status === 'rest' ? '🌙' : label;
  return { status, content };
}

function topHtml() {
  const metrics = weekMetrics();
  const time = state.lastLoaded ? state.lastLoaded.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : '';
  return `
    <header class="topbar">
      <div class="brand"><div class="brand-mark">✓</div><div><h1>MyRoutine</h1><p>나에게 집중하는 작은 기록</p></div></div>
      <button class="status ${state.health ? '' : 'offline'}" data-action="${state.needsNetworkPermission ? 'authorize-network' : 'reload'}">
        <span class="status-dot"></span><span>${state.health ? '서버 연결됨' : state.needsNetworkPermission ? '연결 권한 필요' : '연결 끊김'}</span><span class="status-time">${time}</span>
      </button>
    </header>
    ${state.needsNetworkPermission ? `<div class="notice"><span>설치 화면이 Tailscale 서버에 연결하도록 허용해 주세요.</span><button data-action="authorize-network">Tailscale 서버 연결 허용</button></div>` : ''}
    ${state.error ? `<div class="notice"><span>${esc(state.error)}</span><button data-action="reload">다시 시도</button></div>` : ''}
    <section class="panel hero">
      <div><span class="eyebrow">이번 주</span><h2>${metrics.percent}% 달성</h2><p>${metrics.completed}/${metrics.targets} 완료${metrics.partial ? ` · 진행 중 ${metrics.partial}` : ''}${metrics.rest ? ` · 쉼 ${metrics.rest}` : ''}</p></div>
      <div class="ring" style="--value:${metrics.percent}"><strong>${metrics.percent}%</strong></div>
    </section>`;
}

function todayHtml() {
  const key = localDate();
  const habits = activeHabits().filter((habit) => scheduled(habit, key));
  const periodic = activeHabits()
    .filter((habit) => habit.schedule_type !== 'weekly')
    .map((habit) => ({ habit, info: periodicInfo(habit, key) }))
    .sort((a, b) => a.info.sort - b.info.sort || a.habit.sort_order - b.habit.sort_order);
  const done = habits.filter((habit) => logFor(habit.id, key)?.status === 'completed').length;
  return `
    <div class="section-head"><div><h2>오늘의 루틴</h2><p>${key} · ${done}/${habits.length} 완료</p></div><button class="btn primary" data-action="add-habit">+ 추가</button></div>
    <div class="today-list">
      ${habits.length ? habits.map((habit) => {
        const log = logFor(habit.id, key);
        const button = statusButton(log, habit.type === 'number' ? '+' : '');
        const progress = habit.type === 'number' ? `${log?.numeric_value || 0} / ${habit.target_value} ${esc(habit.unit)}` : button.status === 'completed' ? '오늘 완료' : button.status === 'rest' ? '오늘은 쉼' : '아직 기록 없음';
        return `<article class="panel today-card">
          <span class="habit-dot" style="--habit-color:${habit.color}"></span>
          <div><div class="habit-title">${esc(habit.title)}</div><div class="habit-meta">${progress}</div></div>
          <div class="today-actions">
            <button class="btn small" data-action="set-rest" data-id="${habit.id}" data-date="${key}">쉼</button>
            <button class="check-button ${button.status}" data-action="record" data-id="${habit.id}" data-date="${key}">${button.content}</button>
          </div>
        </article>`;
      }).join('') : `<div class="panel empty"><span class="emoji">🌿</span>오늘 예정된 루틴이 없습니다.<br><button class="btn primary" data-action="add-habit" style="margin-top:12px">첫 루틴 만들기</button></div>`}
    </div>
    ${periodic.length ? `
      <div class="section-head periodic-head"><div><h2>주기 루틴</h2><p>매일 하지 않는 큰 단위의 할 일</p></div></div>
      <div class="periodic-list">${periodic.map(({ habit, info }) => {
        const isChecked = habit.schedule_type === 'monthly' ? Boolean(info.completion) : info.completion?.log_date === key;
        return `<article class="panel periodic-card ${info.state}">
          <span class="habit-dot" style="--habit-color:${habit.color}"></span>
          <div class="periodic-main"><div class="habit-title">${esc(habit.title)}</div><div class="habit-meta">${esc(info.meta)}</div></div>
          <span class="periodic-badge">${isChecked ? '완료' : info.state === 'overdue' ? '기한 지남' : info.state === 'due' ? (habit.schedule_type === 'monthly' ? '이번 달' : '오늘') : '예정'}</span>
          <button class="check-button ${isChecked ? 'completed' : ''}" data-action="periodic-record" data-id="${habit.id}" data-today="${key}" aria-label="${isChecked ? '완료 취소' : '완료'}">${isChecked ? '✓' : ''}</button>
        </article>`;
      }).join('')}</div>` : ''}`;
}

function weekHtml() {
  const days = weekDays(state.weekRef);
  const today = localDate();
  const start = localDate(days[0]);
  const end = localDate(days[6]);
  const habits = activeHabits().filter((habit) => habit.schedule_type === 'weekly');
  return `
    <div class="panel week-toolbar">
      <div class="week-nav"><button class="btn small" data-action="prev-week">‹</button><button class="btn small" data-action="this-week">오늘</button><button class="btn small" data-action="next-week">›</button></div>
      <div class="week-range">${start.slice(5).replace('-', '.')} ~ ${end.slice(5).replace('-', '.')}</div>
    </div>
    <div class="panel table-wrap"><table><thead><tr><th>습관</th>${days.map((date) => {
      const key = localDate(date);
      return `<th class="${key === today ? 'today-col' : ''}">${DAYS[date.getDay()]}<div class="day-number">${date.getDate()}</div></th>`;
    }).join('')}</tr></thead><tbody>
      ${habits.length ? habits.map((habit) => `<tr><td><div class="habit-title">${esc(habit.title)}</div><div class="habit-meta">${habit.type === 'number' ? `목표 ${habit.target_value} ${esc(habit.unit)}` : habit.schedule_days.map((d) => DAYS[d]).join('·')}</div></td>${days.map((date) => {
        const key = localDate(date);
        if (!scheduled(habit, key)) return `<td class="${key === today ? 'today-col' : ''}"><button class="cell-button unscheduled" disabled>–</button></td>`;
        const button = statusButton(logFor(habit.id, key), habit.type === 'number' ? '+' : '');
        return `<td class="${key === today ? 'today-col' : ''}"><button class="cell-button ${button.status}" data-action="record" data-id="${habit.id}" data-date="${key}">${button.content}</button></td>`;
      }).join('')}</tr>`).join('') : `<tr><td colspan="8" class="empty">등록된 루틴이 없습니다.</td></tr>`}
    </tbody></table></div>`;
}

function statsHtml() {
  const habits = activeHabits().filter((habit) => habit.schedule_type === 'weekly');
  const metrics = weekMetrics(habits);
  const streakData = habits.map((habit) => ({ habit, ...streaks(habit) }));
  const bestCurrent = Math.max(0, ...streakData.map((item) => item.current));
  const bestEver = Math.max(0, ...streakData.map((item) => item.best));
  return `
    <div class="section-head"><div><h2>기록 요약</h2><p>미래 날짜와 쉬는 날은 달성률에서 제외합니다.</p></div></div>
    <div class="stats-grid">
      <div class="panel stat"><span>이번 주 달성률</span><strong>${metrics.percent}%</strong></div>
      <div class="panel stat"><span>현재 최장 연속</span><strong>${bestCurrent}일</strong></div>
      <div class="panel stat"><span>365일 최고 연속</span><strong>${bestEver}일</strong></div>
    </div>
    <div class="progress-list">${habits.map((habit) => {
      const one = weekMetrics([habit]);
      const streak = streaks(habit);
      return `<article class="panel progress-item"><div class="progress-top"><strong>${esc(habit.title)}</strong><span>${one.completed}/${one.targets} · 연속 ${streak.current}일</span></div><div class="progress-track"><div class="progress-fill" style="--progress:${one.percent}%;--habit-color:${habit.color}"></div></div></article>`;
    }).join('') || `<div class="panel empty">통계를 표시할 루틴이 없습니다.</div>`}</div>`;
}

function manageHtml() {
  const active = activeHabits();
  const archived = state.habits.filter((habit) => habit.archived);
  const scheduleLabel = (habit) => habit.schedule_type === 'interval'
    ? `${habit.interval_days}일마다`
    : habit.schedule_type === 'monthly'
      ? '매월 1회'
      : habit.schedule_days.map((d) => DAYS[d]).join('·');
  const row = (habit, index, list, isArchived = false) => `<article class="panel manage-row">
    <span class="habit-dot" style="--habit-color:${habit.color}"></span>
    <div class="manage-main"><div class="habit-title">${esc(habit.title)}</div><div class="habit-meta">${scheduleLabel(habit)} · ${habit.type === 'number' ? `${habit.target_value} ${esc(habit.unit)}` : '체크형'}</div></div>
    <div class="manage-actions">
      ${isArchived ? `<button class="btn small" data-action="restore" data-id="${habit.id}">복원</button>` : `<button class="btn small" data-action="move" data-direction="up" data-id="${habit.id}" ${index === 0 ? 'disabled' : ''}>↑</button><button class="btn small" data-action="move" data-direction="down" data-id="${habit.id}" ${index === list.length - 1 ? 'disabled' : ''}>↓</button><button class="btn small" data-action="edit" data-id="${habit.id}">수정</button><button class="btn small danger" data-action="archive" data-id="${habit.id}">보관</button>`}
    </div>
  </article>`;
  return `
    <div class="section-head"><div><h2>루틴 관리</h2><p>삭제 대신 보관하여 기록을 안전하게 유지합니다.</p></div><button class="btn primary" data-action="add-habit">+ 추가</button></div>
    <div class="manage-list">${active.map((habit, index) => row(habit, index, active)).join('') || `<div class="panel empty">활성 루틴이 없습니다.</div>`}</div>
    ${archived.length ? `<div class="section-head"><div><h3>보관된 루틴</h3><p>${archived.length}개</p></div></div><div class="manage-list">${archived.map((habit, index) => row(habit, index, archived, true)).join('')}</div>` : ''}
    <div class="section-head"><div><h3>데이터 관리</h3><p>서버 DB는 매일 자동 백업됩니다.</p></div></div>
    <div class="panel tools">
      <button class="btn" data-action="export">JSON 내보내기</button>
      <button class="btn" data-action="choose-import">JSON 가져오기</button>
      <input class="file-input" id="importFile" type="file" accept="application/json,.json">
      <button class="btn" data-action="backup">서버 백업 지금 만들기</button>
      <button class="btn install-hint" data-action="install">홈 화면에 설치</button>
    </div>`;
}

function habitModalHtml(habit = null) {
  const draft = state.modal?.draft;
  const source = draft || habit || {};
  const selected = source.schedule_days || [0,1,2,3,4,5,6];
  const scheduleType = source.schedule_type || 'weekly';
  const color = source.color || '#6366f1';
  const palette = [...new Set([...COLORS, color])];
  return `<div class="modal-backdrop" data-action="close-modal"><form class="panel modal" id="habitForm" data-id="${habit?.id || ''}" onclick="event.stopPropagation()">
    <h2>${habit ? '루틴 수정' : '새 루틴'}</h2>
    <div class="field"><label for="habitTitle">이름</label><input id="habitTitle" name="title" maxlength="100" required value="${esc(source.title || '')}" placeholder="예: 물 1L 마시기"></div>
    <div class="field"><label for="habitType">기록 방식</label><select id="habitType" name="type"><option value="check" ${source.type !== 'number' ? 'selected' : ''}>체크형</option><option value="number" ${source.type === 'number' ? 'selected' : ''}>수치형</option></select></div>
    <div class="two-col" id="numberFields">
      <div class="field"><label for="targetValue">목표</label><input id="targetValue" name="target_value" type="number" min="0.01" step="0.01" value="${source.target_value || 1}"></div>
      <div class="field"><label for="habitUnit">단위</label><input id="habitUnit" name="unit" maxlength="20" value="${esc(source.unit || '회')}"></div>
    </div>
    <div class="field"><label for="scheduleType">반복 방식</label><select id="scheduleType" name="schedule_type"><option value="weekly" ${scheduleType === 'weekly' ? 'selected' : ''}>요일마다</option><option value="interval" ${scheduleType === 'interval' ? 'selected' : ''}>N일마다</option><option value="monthly" ${scheduleType === 'monthly' ? 'selected' : ''}>매월 1회</option></select></div>
    <div id="weeklyFields" class="schedule-fields"><div class="field"><label>실행 요일</label><div class="day-picker">${DAYS.map((day, index) => `<div><input id="day${index}" name="days" type="checkbox" value="${index}" ${selected.includes(index) ? 'checked' : ''}><label for="day${index}">${day}</label></div>`).join('')}</div></div></div>
    <div id="intervalFields" class="schedule-fields two-col">
      <div class="field"><label for="intervalDays">반복 간격</label><div class="input-with-unit"><input id="intervalDays" name="interval_days" type="number" min="1" max="365" step="1" value="${source.interval_days || 14}"><span>일</span></div></div>
      <div class="field"><label for="anchorDate">첫 예정일</label><input id="anchorDate" name="anchor_date" type="date" value="${source.anchor_date || localDate()}"></div>
    </div>
    <div id="monthlyFields" class="schedule-fields schedule-note">한 달 안에 한 번 완료하면 됩니다. 완료 기록은 주간 달성률과 별도로 관리합니다.</div>
    <fieldset class="field color-field"><legend>색상</legend><div class="color-palette">${palette.map((option, index) => `<div><input id="color${index}" name="color" type="radio" value="${option}" ${option === color ? 'checked' : ''}><label for="color${index}" style="--swatch:${option}" aria-label="${option}"></label></div>`).join('')}</div></fieldset>
    <div class="modal-actions"><button type="button" class="btn" data-action="close-modal">취소</button><button class="btn primary" type="submit">저장</button></div>
  </form></div>`;
}

function numberModalHtml({ habit, date, log }) {
  return `<div class="modal-backdrop" data-action="close-modal"><form class="panel modal" id="numberForm" data-id="${habit.id}" data-date="${date}" onclick="event.stopPropagation()">
    <span class="eyebrow">${date}</span><h2>${esc(habit.title)}</h2>
    <div class="field"><label for="numberValue">목표 ${habit.target_value} ${esc(habit.unit)}</label><input class="number-value" id="numberValue" name="numeric_value" type="number" min="0" step="0.01" value="${log?.numeric_value || 0}" autofocus></div>
    <div class="quick-values"><button type="button" class="btn" data-action="add-value" data-value="1">+1</button><button type="button" class="btn" data-action="add-value" data-value="5">+5</button><button type="button" class="btn" data-action="add-value" data-value="10">+10</button></div>
    <div class="modal-actions"><button type="button" class="btn" data-action="clear-log" data-id="${habit.id}" data-date="${date}">초기화</button><button type="submit" class="btn primary">저장</button></div>
  </form></div>`;
}

function modalHtml() {
  if (!state.modal) return '';
  if (state.modal.type === 'habit') return habitModalHtml(state.modal.habit);
  if (state.modal.type === 'number') return numberModalHtml(state.modal);
  return '';
}

function render() {
  const content = state.tab === 'today' ? todayHtml() : state.tab === 'week' ? weekHtml() : state.tab === 'stats' ? statsHtml() : manageHtml();
  app.innerHTML = `<main class="app-shell">${topHtml()}${content}</main>
    <nav class="tabs" aria-label="주요 메뉴">
      ${[['today','☀️','오늘'],['week','🗓️','주간'],['stats','📊','통계'],['manage','⚙️','관리']].map(([key, icon, label]) => `<button class="tab ${state.tab === key ? 'active' : ''}" data-action="tab" data-tab="${key}"><span>${icon}</span><span>${label}</span></button>`).join('')}
    </nav>${modalHtml()}`;
  const type = document.querySelector('#habitType');
  if (type) updateNumberFields(type.value);
  const scheduleType = document.querySelector('#scheduleType');
  if (scheduleType) updateScheduleFields(scheduleType.value);
}

function toast(message) {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  document.body.append(el);
  setTimeout(() => el.remove(), 2300);
}

function updateNumberFields(type) {
  const fields = document.querySelector('#numberFields');
  if (fields) fields.style.display = type === 'number' ? 'grid' : 'none';
}

function updateScheduleFields(type) {
  const weekly = document.querySelector('#weeklyFields');
  const interval = document.querySelector('#intervalFields');
  const monthly = document.querySelector('#monthlyFields');
  if (weekly) weekly.style.display = type === 'weekly' ? 'block' : 'none';
  if (interval) interval.style.display = type === 'interval' ? 'grid' : 'none';
  if (monthly) monthly.style.display = type === 'monthly' ? 'block' : 'none';
}

function captureHabitDraft(form = document.querySelector('#habitForm')) {
  if (!form || state.modal?.type !== 'habit') return;
  const data = new FormData(form);
  state.modal.draft = {
    title: data.get('title') || '',
    type: data.get('type') || 'check',
    target_value: Number(data.get('target_value')) || 1,
    unit: data.get('unit') || '',
    schedule_type: data.get('schedule_type') || 'weekly',
    schedule_days: data.getAll('days').map(Number),
    interval_days: Number(data.get('interval_days')) || 14,
    anchor_date: data.get('anchor_date') || localDate(),
    color: data.get('color') || '#6366f1'
  };
}

async function mutate(task, success) {
  if (!state.health) return toast('서버 연결을 먼저 확인해 주세요.');
  try {
    await task();
    await loadData({ quiet: true });
    if (success) toast(success);
  } catch (error) {
    state.error = error.message;
    render();
  }
}

async function record(habit, date) {
  const log = logFor(habit.id, date);
  if (habit.type === 'number') {
    state.modal = { type: 'number', habit, date, log };
    render();
    return;
  }
  const status = log ? 'none' : 'completed';
  await mutate(() => api(`/api/logs/${habit.id}/${date}`, { method: 'PUT', body: JSON.stringify({ status }) }));
}

document.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  if (button.classList.contains('modal-backdrop') && event.target !== button) return;
  const action = button.dataset.action;
  if (action === 'tab') { state.tab = button.dataset.tab; state.modal = null; render(); return; }
  if (action === 'authorize-network') {
    state.needsNetworkPermission = false;
    state.error = 'Chrome 권한창이 뜨면 로컬 네트워크 접근을 허용해 주세요.';
    render();
    return loadData();
  }
  if (action === 'reload') return loadData();
  if (action === 'add-habit') { state.modal = { type: 'habit', habit: null, draft: null }; render(); return; }
  if (action === 'close-modal') { state.modal = null; render(); return; }
  if (action === 'prev-week') { state.weekRef = addDays(state.weekRef, -7); render(); return; }
  if (action === 'next-week') { state.weekRef = addDays(state.weekRef, 7); render(); return; }
  if (action === 'this-week') { state.weekRef = new Date(); render(); return; }
  const habit = state.habits.find((item) => item.id === button.dataset.id);
  if (action === 'record' && habit) return record(habit, button.dataset.date);
  if (action === 'periodic-record' && habit) {
    const info = periodicInfo(habit);
    const isChecked = habit.schedule_type === 'monthly' ? Boolean(info.completion) : info.completion?.log_date === button.dataset.today;
    const date = isChecked ? info.completion.log_date : button.dataset.today;
    return record(habit, date);
  }
  if (action === 'set-rest' && habit) {
    const current = logFor(habit.id, button.dataset.date);
    const status = current?.status === 'rest' ? 'none' : 'rest';
    return mutate(() => api(`/api/logs/${habit.id}/${button.dataset.date}`, { method: 'PUT', body: JSON.stringify({ status }) }));
  }
  if (action === 'edit' && habit) { state.modal = { type: 'habit', habit, draft: null }; render(); return; }
  if ((action === 'archive' || action === 'restore') && habit) {
    const archived = action === 'archive';
    return mutate(() => api(`/api/habits/${habit.id}`, { method: 'PUT', body: JSON.stringify({ archived }) }), archived ? '루틴을 보관했습니다.' : '루틴을 복원했습니다.');
  }
  if (action === 'move' && habit) {
    const list = activeHabits();
    const index = list.findIndex((item) => item.id === habit.id);
    const target = button.dataset.direction === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= list.length) return;
    [list[index], list[target]] = [list[target], list[index]];
    return mutate(() => api('/api/habits/reorder', { method: 'POST', body: JSON.stringify({ ids: list.map((item) => item.id) }) }));
  }
  if (action === 'add-value') {
    const input = document.querySelector('#numberValue');
    input.value = String((Number(input.value) || 0) + Number(button.dataset.value));
    return;
  }
  if (action === 'clear-log') {
    state.modal = null;
    return mutate(() => api(`/api/logs/${button.dataset.id}/${button.dataset.date}`, { method: 'PUT', body: JSON.stringify({ status: 'none' }) }), '기록을 초기화했습니다.');
  }
  if (action === 'export') {
    try {
      const data = await api('/api/export');
      const link = document.createElement('a');
      link.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      link.download = `myroutine-${localDate()}.json`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (error) { toast(error.message); }
    return;
  }
  if (action === 'choose-import') { document.querySelector('#importFile')?.click(); return; }
  if (action === 'backup') return mutate(() => api('/api/backup', { method: 'POST', body: '{}' }), '서버 백업을 만들었습니다.');
  if (action === 'install') {
    if (state.installPrompt) {
      await state.installPrompt.prompt();
      state.installPrompt = null;
    } else toast('Chrome 메뉴에서 “홈 화면에 추가”를 선택해 주세요.');
  }
});

document.addEventListener('change', async (event) => {
  if (event.target.id === 'habitType') updateNumberFields(event.target.value);
  if (event.target.id === 'scheduleType') updateScheduleFields(event.target.value);
  if (event.target.closest('#habitForm')) captureHabitDraft();
  if (event.target.id === 'importFile' && event.target.files?.[0]) {
    if (!confirm('현재 서버 데이터를 백업한 뒤 가져온 파일로 교체합니다. 계속할까요?')) return;
    try {
      const data = JSON.parse(await event.target.files[0].text());
      await api('/api/import', { method: 'POST', body: JSON.stringify(data) });
      await loadData();
      toast('데이터를 가져왔습니다.');
    } catch (error) { toast(`가져오기 실패: ${error.message}`); }
  }
});

document.addEventListener('input', (event) => {
  if (event.target.closest('#habitForm')) captureHabitDraft();
});

document.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (event.target.id === 'habitForm') {
    captureHabitDraft(event.target);
    const form = new FormData(event.target);
    const body = {
      title: form.get('title'),
      type: form.get('type'),
      target_value: Number(form.get('target_value')),
      unit: form.get('unit'),
      color: form.get('color'),
      schedule_type: form.get('schedule_type'),
      schedule_days: form.getAll('days').map(Number),
      interval_days: Number(form.get('interval_days')),
      anchor_date: form.get('anchor_date')
    };
    const id = event.target.dataset.id;
    try {
      await api(id ? `/api/habits/${id}` : '/api/habits', { method: id ? 'PUT' : 'POST', body: JSON.stringify(body) });
      state.modal = null;
      await loadData({ quiet: true });
      toast('루틴을 저장했습니다.');
    } catch (error) {
      state.error = error.message;
      render();
    }
    return;
  }
  if (event.target.id === 'numberForm') {
    const form = new FormData(event.target);
    const id = event.target.dataset.id;
    const date = event.target.dataset.date;
    state.modal = null;
    return mutate(() => api(`/api/logs/${id}/${date}`, { method: 'PUT', body: JSON.stringify({ status: 'record', numeric_value: Number(form.get('numeric_value')) }) }), '기록을 저장했습니다.');
  }
});

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  state.installPrompt = event;
});
window.addEventListener('appinstalled', () => {
  state.installPrompt = null;
  toast('MyRoutine 설치가 완료되었습니다.');
});
window.addEventListener('focus', () => { if (!state.modal) loadData({ quiet: true }); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && !state.modal) loadData({ quiet: true }); });
setInterval(() => { if (!state.modal) loadData({ quiet: true }); }, 60_000);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(new URL('./sw.js?v=2', import.meta.url), { scope: './' }).catch(() => {
      // The web app remains usable in the browser even if registration fails.
    });
  });
}

render();

async function initialize() {
  if (API_ORIGIN && 'permissions' in navigator) {
    try {
      const permission = await navigator.permissions.query({ name: 'local-network-access' });
      if (permission.state === 'prompt') {
        state.needsNetworkPermission = true;
        render();
        return;
      }
      if (permission.state === 'denied') {
        state.error = 'Chrome 사이트 설정에서 로컬 네트워크 접근을 허용해 주세요.';
        render();
        return;
      }
    } catch {
      // Older browsers request access directly when the API call starts.
    }
  }
  loadData();
}

initialize();
