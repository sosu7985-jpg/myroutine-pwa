// MyRoutine Habit Tracker PWA - Pure Vanilla JS Engine (Zero-Babel, 100% Reliable)

(function() {
  const DB = window.MyRoutineDB;

  // App State
  let currentDate = new Date();
  let habits = [];
  let logs = [];
  let activeTab = 'grid'; // 'grid' | 'stats'
  let editingHabit = null;
  let numberModalTarget = null; // { habit, dateStr, log }
  let deferredPrompt = null;

  // Date Helpers
  function formatDate(d) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function getWeekDays(refDate) {
    const d = new Date(refDate);
    const day = d.getDay();
    const diffToSun = d.getDate() - day;
    const sunday = new Date(d.setDate(diffToSun));

    const days = [];
    const dayNames = ['일', '월', '화', '수', '목', '금', '토'];

    for (let i = 0; i < 7; i++) {
      const current = new Date(sunday);
      current.setDate(sunday.getDate() + i);
      days.push({
        dateStr: formatDate(current),
        monthDay: `${current.getMonth() + 1}/${current.getDate()}`,
        dayName: dayNames[i],
        isSunday: i === 0,
        isSaturday: i === 6,
        rawDate: current
      });
    }
    return days;
  }

  // Calculate Stats
  function calculateStats(weekDays) {
    let totalTargetDays = 0;
    let completedDays = 0;
    let restDays = 0;

    if (habits.length === 0) return { percent: 0, completedDays: 0, totalTargetDays: 0, restDays: 0 };

    weekDays.forEach(day => {
      habits.forEach(habit => {
        const log = logs.find(l => l.habit_id === habit.id && (l.log_date === day.dateStr || l.date === day.dateStr));
        if (log && log.status === 'rest') {
          restDays++;
        } else {
          totalTargetDays++;
          if (log && log.status === 'completed') {
            completedDays++;
          }
        }
      });
    });

    const percent = totalTargetDays > 0 ? Math.round((completedDays / totalTargetDays) * 100) : 0;
    return { percent, completedDays, totalTargetDays, restDays };
  }

  // Data Reload
  async function reloadData() {
    habits = await DB.fetchHabits();
    logs = await DB.fetchLogs();
    render();
  }

  // Initialize
  window.addEventListener('DOMContentLoaded', async () => {
    DB.initSupabase();
    DB.subscribeDataChanges(() => {
      reloadData();
    });

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
      render();
    });

    await reloadData();
  });

  // Global Action Handlers
  window.appActions = {
    prevWeek: () => {
      currentDate.setDate(currentDate.getDate() - 7);
      render();
    },
    nextWeek: () => {
      currentDate.setDate(currentDate.getDate() + 7);
      render();
    },
    goToday: () => {
      currentDate = new Date();
      render();
    },
    setTab: (tab) => {
      activeTab = tab;
      render();
    },
    toggleCheckLog: async (habitId, dateStr) => {
      const habit = habits.find(h => h.id === habitId);
      if (!habit) return;
      const log = logs.find(l => l.habit_id === habitId && (l.log_date === dateStr || l.date === dateStr));

      let nextStatus = 'completed';
      if (!log || log.status === 'none') nextStatus = 'completed';
      else if (log.status === 'completed') nextStatus = 'rest';
      else nextStatus = 'none';

      await DB.setHabitLog(habitId, dateStr, nextStatus, nextStatus === 'completed' ? habit.target_value : 0);
      await reloadData();
    },
    openNumberModal: (habitId, dateStr) => {
      const habit = habits.find(h => h.id === habitId);
      const log = logs.find(l => l.habit_id === habitId && (l.log_date === dateStr || l.date === dateStr));
      numberModalTarget = { habit, dateStr, log };
      render();
    },
    closeNumberModal: () => {
      numberModalTarget = null;
      render();
    },
    saveNumberLog: async (habitId, dateStr, status, val) => {
      await DB.setHabitLog(habitId, dateStr, status, val);
      numberModalTarget = null;
      await reloadData();
    },
    openAddHabitModal: () => {
      editingHabit = null;
      document.getElementById('habitModal').classList.remove('hidden');
    },
    openEditHabitModal: (habitId) => {
      editingHabit = habits.find(h => h.id === habitId);
      if (editingHabit) {
        document.getElementById('habitTitleInput').value = editingHabit.title;
        document.getElementById('habitTypeSelect').value = editingHabit.type;
        document.getElementById('habitUnitInput').value = editingHabit.unit || '회';
        document.getElementById('habitTargetInput').value = editingHabit.target_value || 1;
        document.getElementById('habitColorInput').value = editingHabit.color || '#6366f1';
        toggleHabitTypeFields();
        document.getElementById('habitModal').classList.remove('hidden');
      }
    },
    closeHabitModal: () => {
      document.getElementById('habitModal').classList.add('hidden');
    },
    saveHabit: async (e) => {
      e.preventDefault();
      const title = document.getElementById('habitTitleInput').value.trim();
      if (!title) return alert('습관 이름을 입력해 주세요.');

      const type = document.getElementById('habitTypeSelect').value;
      const unit = document.getElementById('habitUnitInput').value.trim() || '회';
      const target_value = Number(document.getElementById('habitTargetInput').value) || 1;
      const color = document.getElementById('habitColorInput').value;

      await DB.addOrUpdateHabit({
        id: editingHabit ? editingHabit.id : null,
        title,
        type,
        unit: type === 'number' ? unit : '회',
        target_value: type === 'number' ? target_value : 1,
        color
      });

      document.getElementById('habitModal').classList.add('hidden');
      await reloadData();
    },
    deleteHabit: async (habitId) => {
      if (confirm('이 습관을 삭제하시겠습니까? 관련 일별 기록도 함께 삭제됩니다.')) {
        await DB.deleteHabit(habitId);
        await reloadData();
      }
    },
    openConfigModal: () => {
      const cfg = DB.getSupabaseConfig();
      document.getElementById('sbUrlInput').value = cfg.url;
      document.getElementById('sbKeyInput').value = cfg.key;
      document.getElementById('configModal').classList.remove('hidden');
    },
    closeConfigModal: () => {
      document.getElementById('configModal').classList.add('hidden');
    },
    saveConfig: (e) => {
      e.preventDefault();
      const url = document.getElementById('sbUrlInput').value.trim();
      const key = document.getElementById('sbKeyInput').value.trim();
      DB.setSupabaseConfig(url, key);
      alert('Supabase 설정이 저장되었습니다. 데이터가 실시간으로 동기화됩니다!');
      document.getElementById('configModal').classList.add('hidden');
      reloadData();
    },
    clearConfig: () => {
      DB.setSupabaseConfig('', '');
      document.getElementById('sbUrlInput').value = '';
      document.getElementById('sbKeyInput').value = '';
      alert('Supabase 연결이 해제되었습니다. 로컬 모드로 전환됩니다.');
      document.getElementById('configModal').classList.add('hidden');
      reloadData();
    },
    installPWA: () => {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then(() => setDeferredPrompt(null));
      } else {
        alert('모바일 Safari 또는 Chrome 메뉴의 [홈 화면에 추가]를 눌러 앱으로 바로 설치할 수 있습니다.');
      }
    }
  };

  // Main UI Render Function
  function render() {
    const root = document.getElementById('app-root');
    if (!root) return;

    const weekDays = getWeekDays(currentDate);
    const todayStr = formatDate(new Date());
    const stats = calculateStats(weekDays);
    const sbConfig = DB.getSupabaseConfig();
    const isSbConnected = Boolean(sbConfig.url && sbConfig.key);

    let html = `
      <div class="max-w-4xl mx-auto px-3 sm:px-6 py-4 pb-20">
        <!-- Header -->
        <header class="glass-panel rounded-2xl p-4 mb-5 flex flex-wrap items-center justify-between gap-3 shadow-lg">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-indigo-600/30 border border-indigo-400/40 flex items-center justify-center text-indigo-400 font-bold text-xl shadow-inner">
              ✓
            </div>
            <div>
              <h1 class="text-xl font-extrabold tracking-tight text-white flex items-center gap-2">
                MyRoutine
                <span class="text-xs px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 font-semibold border border-indigo-500/30">
                  PWA
                </span>
              </h1>
              <p class="text-xs text-slate-400">주간 습관 루틴 & 실시간 동기화</p>
            </div>
          </div>

          <div class="flex items-center flex-wrap gap-2">
            <button 
              onclick="appActions.openConfigModal()"
              class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                isSbConnected 
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20' 
                  : 'bg-amber-500/10 text-amber-400 border-amber-500/30 hover:bg-amber-500/20'
              }"
            >
              <span class="w-2 h-2 rounded-full ${isSbConnected ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}"></span>
              ${isSbConnected ? 'Supabase 연동됨' : '로컬 모드 (DB 설정)'}
            </button>

            ${deferredPrompt ? `
              <button
                onclick="appActions.installPWA()"
                class="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-pink-500/20 text-pink-300 border border-pink-500/30 text-xs font-medium hover:bg-pink-500/30 transition-all"
              >
                앱 설치
              </button>
            ` : ''}

            <button
              onclick="appActions.openAddHabitModal()"
              class="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md shadow-indigo-600/30 transition-all active:scale-95"
            >
              + 습관 추가
            </button>
          </div>
        </header>

        <!-- Week Navigator -->
        <div class="glass-panel rounded-2xl p-4 mb-5 shadow-md flex flex-wrap items-center justify-between gap-4">
          <div class="flex items-center gap-2">
            <button 
              onclick="appActions.prevWeek()"
              class="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 transition-all"
              title="이전 주"
            >
              ◀
            </button>
            
            <button
              onclick="appActions.goToday()"
              class="px-3 py-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-all"
            >
              오늘
            </button>

            <button 
              onclick="appActions.nextWeek()"
              class="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 transition-all"
              title="다음 주"
            >
              ▶
            </button>

            <span class="text-sm font-semibold text-slate-200 ml-1">
              ${weekDays[0].monthDay} ~ ${weekDays[6].monthDay}
            </span>
          </div>

          <div class="flex items-center bg-slate-900/60 p-1 rounded-xl border border-slate-800">
            <button
              onclick="appActions.setTab('grid')"
              class="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'grid' 
                  ? 'bg-indigo-600 text-white shadow-sm' 
                  : 'text-slate-400 hover:text-slate-200'
              }"
            >
              주간 그리드
            </button>
            <button
              onclick="appActions.setTab('stats')"
              class="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'stats' 
                  ? 'bg-indigo-600 text-white shadow-sm' 
                  : 'text-slate-400 hover:text-slate-200'
              }"
            >
              📊 달성률 & 통계
            </button>
          </div>
        </div>

        <!-- Main Content -->
        ${activeTab === 'grid' ? renderGrid(weekDays, todayStr, stats) : renderStats(weekDays)}
      </div>

      <!-- Number Modal Pop-up -->
      ${renderNumberModalHtml()}
    `;

    root.innerHTML = html;
  }

  // Render Grid HTML
  function renderGrid(weekDays, todayStr, stats) {
    return `
      <div class="space-y-4">
        <!-- Progress Bar Banner -->
        <div class="glass-panel rounded-2xl p-4 shadow-md flex items-center justify-between gap-4">
          <div>
            <span class="text-xs font-medium text-slate-400 block mb-1">이번 주 달성률</span>
            <div class="flex items-baseline gap-2">
              <span class="text-2xl font-extrabold text-indigo-400">${stats.percent}%</span>
              <span class="text-xs text-slate-400">
                (${stats.completedDays} / ${stats.totalTargetDays} 완료${stats.restDays > 0 ? `, 쉼 ${stats.restDays}일` : ''})
              </span>
            </div>
          </div>
          <div class="w-36 sm:w-48 bg-slate-800/80 rounded-full h-3 overflow-hidden p-0.5 border border-slate-700/60">
            <div 
              className="bg-gradient-to-r from-indigo-500 to-emerald-400 h-full rounded-full transition-all duration-500 shadow-sm"
              style="width: ${stats.percent}%; background: linear-gradient(90deg, #6366f1, #10b981);"
            ></div>
          </div>
        </div>

        <!-- Grid Table -->
        <div class="glass-panel rounded-2xl overflow-hidden shadow-xl border border-slate-800">
          <div class="overflow-x-auto">
            <table class="w-full border-collapse min-w-[640px]">
              <thead>
                <tr class="border-b border-slate-800 text-xs text-slate-400 bg-slate-950/40">
                  <th class="py-3 px-4 text-left font-medium w-48 sm:w-56">습관 목록 (${habits.length})</th>
                  ${weekDays.map(day => {
                    const isToday = day.dateStr === todayStr;
                    return `
                      <th class="py-3 px-1 text-center font-semibold w-12 sm:w-16 transition-colors ${
                        isToday ? 'today-column-header text-indigo-300' : ''
                      } ${day.isSunday ? 'text-rose-400' : day.isSaturday ? 'text-sky-400' : ''}">
                        <div class="text-[10px] uppercase opacity-75">${day.dayName}</div>
                        <div class="text-sm font-extrabold mt-0.5">${day.monthDay.split('/')[1]}</div>
                        ${isToday ? '<div class="w-1.5 h-1.5 rounded-full bg-indigo-400 mx-auto mt-1 animate-pulse"></div>' : ''}
                      </th>
                    `;
                  }).join('')}
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-800/60">
                ${habits.length === 0 ? `
                  <tr>
                    <td colSpan="8" class="py-12 text-center text-slate-500 text-sm">
                      아직 등록된 습관이 없습니다. <br />
                      상단의 <strong>+ 습관 추가</strong> 버튼을 눌러 새로운 루틴을 시작해보세요!
                    </td>
                  </tr>
                ` : habits.map(habit => renderHabitRow(habit, weekDays, todayStr)).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <div class="text-center text-[11px] text-slate-500 py-1">
          💡 셀 클릭: <strong>체크형</strong>(미완료 ➔ 완료 ➔ 쉼) | <strong>수치형</strong>(숫자 입력 팝업)
        </div>
      </div>
    `;
  }

  // Render Habit Row
  function renderHabitRow(habit, weekDays, todayStr) {
    return `
      <tr class="hover:bg-slate-800/30 transition-colors group">
        <td class="py-3.5 px-4">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2.5 min-w-0">
              <span className="w-3 h-3 rounded-full shrink-0 shadow-sm" style="background-color: ${habit.color || '#6366f1'}; display: inline-block; width: 12px; height: 12px;"></span>
              <div class="truncate">
                <div class="text-sm font-bold text-slate-100 truncate">${habit.title}</div>
                <div class="text-[11px] text-slate-400 mt-0.5">
                  ${habit.type === 'number' ? `목표: ${habit.target_value} ${habit.unit}` : '일반 체크 완료'}
                </div>
              </div>
            </div>

            <div class="flex items-center gap-1 opacity-80 group-hover:opacity-100">
              <button onclick="appActions.openEditHabitModal('${habit.id}')" class="p-1 text-xs text-slate-400 hover:text-slate-200">✏️</button>
              <button onclick="appActions.deleteHabit('${habit.id}')" class="p-1 text-xs text-slate-400 hover:text-rose-400">🗑️</button>
            </div>
          </div>
        </td>

        ${weekDays.map(day => {
          const isToday = day.dateStr === todayStr;
          const log = logs.find(l => l.habit_id === habit.id && (l.log_date === day.dateStr || l.date === day.dateStr));
          const status = log ? log.status : 'none';

          return `
            <td class="py-2 px-1 text-center align-middle ${isToday ? 'today-column-cell' : ''}">
              ${habit.type === 'check' ? `
                <button
                  onclick="appActions.toggleCheckLog('${habit.id}', '${day.dateStr}')"
                  class="w-9 h-9 sm:w-10 sm:h-10 mx-auto rounded-xl flex items-center justify-center text-xs font-bold status-btn ${
                    status === 'completed' 
                      ? 'status-completed animate-pop' 
                      : status === 'rest' 
                      ? 'status-rest' 
                      : 'status-none'
                  }"
                >
                  ${status === 'completed' ? '✓' : status === 'rest' ? '🌙' : ''}
                </button>
              ` : `
                <button
                  onclick="appActions.openNumberModal('${habit.id}', '${day.dateStr}')"
                  class="w-9 h-9 sm:w-10 sm:h-10 mx-auto rounded-xl flex flex-col items-center justify-center leading-none status-btn transition-all ${
                    status === 'completed' 
                      ? 'status-completed animate-pop' 
                      : status === 'rest' 
                      ? 'status-rest' 
                      : log && log.numeric_value > 0
                      ? 'bg-indigo-600/30 text-indigo-300 border border-indigo-500/40'
                      : 'status-none'
                  }"
                >
                  ${status === 'rest' ? '🌙' : log && log.numeric_value > 0 ? `
                    <span class="text-[11px] font-extrabold">${log.numeric_value}</span>
                    <span class="text-[8px] opacity-75">${habit.unit}</span>
                  ` : '<span class="text-xs text-slate-500 font-medium">+</span>'}
                </button>
              `}
            </td>
          `;
        }).join('')}
      </tr>
    `;
  }

  // Render Stats Tab HTML
  function renderStats(weekDays) {
    const habitStats = habits.map(habit => {
      let targetDays = 0;
      let completedDays = 0;
      let restDays = 0;

      weekDays.forEach(day => {
        const log = logs.find(l => l.habit_id === habit.id && (l.log_date === day.dateStr || l.date === day.dateStr));
        if (log && log.status === 'rest') {
          restDays++;
        } else {
          targetDays++;
          if (log && log.status === 'completed') {
            completedDays++;
          }
        }
      });

      const rate = targetDays > 0 ? Math.round((completedDays / targetDays) * 100) : 0;
      return { habit, targetDays, completedDays, restDays, rate };
    });

    let totalTarget = 0;
    let totalComp = 0;
    habitStats.forEach(s => {
      totalTarget += s.targetDays;
      totalComp += s.completedDays;
    });
    const overallRate = totalTarget > 0 ? Math.round((totalComp / totalTarget) * 100) : 0;

    return `
      <div class="space-y-5">
        <div class="glass-panel rounded-2xl p-6 shadow-xl text-center relative overflow-hidden">
          <div class="max-w-xs mx-auto">
            <div class="text-xs font-semibold text-indigo-400 tracking-wider uppercase mb-2">
              주간 총 습관 달성률
            </div>

            <div class="relative inline-flex items-center justify-center my-2">
              <svg class="w-36 h-36 transform -rotate-90">
                <circle cx="72" cy="72" r="58" stroke="currentColor" stroke-width="10" class="text-slate-800" fill="transparent" />
                <circle
                  cx="72" cy="72" r="58"
                  stroke="#6366f1" stroke-width="10"
                  stroke-dasharray="364"
                  stroke-dashoffset="${364 - (364 * overallRate) / 100}"
                  stroke-linecap="round"
                  fill="transparent"
                  class="transition-all duration-1000 ease-out"
                />
              </svg>
              <div class="absolute text-center">
                <span class="text-3xl font-extrabold text-white">${overallRate}%</span>
                <span class="block text-[10px] text-slate-400">Rest 차감 적용</span>
              </div>
            </div>
          </div>
        </div>

        <div class="glass-panel rounded-2xl p-5 shadow-xl space-y-4">
          <h3 class="text-sm font-bold text-slate-200">습관별 주간 달성 분석</h3>

          <div class="space-y-3">
            ${habitStats.map(({ habit, targetDays, completedDays, restDays, rate }) => `
              <div class="bg-slate-900/60 rounded-xl p-3.5 border border-slate-800">
                <div class="flex items-center justify-between text-xs mb-2">
                  <div class="flex items-center gap-2">
                    <span class="w-2.5 h-2.5 rounded-full inline-block" style="background-color: ${habit.color}"></span>
                    <span class="font-bold text-slate-100">${habit.title}</span>
                  </div>
                  <div class="flex items-center gap-2">
                    <span class="text-slate-400">${completedDays} / ${targetDays}일 (쉼 ${restDays}일)</span>
                    <span class="font-extrabold text-indigo-400 text-sm">${rate}%</span>
                  </div>
                </div>

                <div class="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
                  <div 
                    class="h-full rounded-full transition-all duration-700"
                    style="width: ${rate}%; background-color: ${habit.color || '#6366f1'};"
                  ></div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;
  }

  // Render Number Modal Pop-up HTML
  function renderNumberModalHtml() {
    if (!numberModalTarget) return '';

    const { habit, dateStr, log } = numberModalTarget;
    const currentVal = log ? (log.numeric_value || 0) : 0;
    const isRest = log ? log.status === 'rest' : false;

    return `
      <div class="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 z-50">
        <div class="glass-panel w-full max-w-sm rounded-3xl p-6 shadow-2xl modal-animate border border-slate-700">
          <div class="flex items-center justify-between mb-4">
            <div>
              <span class="text-xs text-indigo-400 font-semibold">${dateStr}</span>
              <h3 class="text-lg font-extrabold text-white mt-0.5">${habit.title}</h3>
            </div>
            <button onclick="appActions.closeNumberModal()" class="text-slate-400 hover:text-slate-200 text-lg">✕</button>
          </div>

          <div class="bg-slate-900/80 rounded-2xl p-4 border border-slate-800 mb-4 text-center">
            <div class="text-xs text-slate-400 mb-1">목표: ${habit.target_value || 1} ${habit.unit}</div>

            <div class="flex items-center justify-center gap-3 my-2">
              <button
                onclick="document.getElementById('numValInput').value = Math.max(0, Number(document.getElementById('numValInput').value) - 1)"
                class="w-10 h-10 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-lg font-bold"
              >
                -
              </button>
              <div class="flex items-baseline gap-1">
                <input
                  id="numValInput"
                  type="number"
                  value="${currentVal}"
                  class="w-24 bg-transparent text-center text-3xl font-extrabold text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 rounded-lg"
                />
                <span class="text-sm font-semibold text-slate-400">${habit.unit}</span>
              </div>
              <button
                onclick="document.getElementById('numValInput').value = Number(document.getElementById('numValInput').value) + 1"
                class="w-10 h-10 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-lg font-bold"
              >
                +
              </button>
            </div>

            <div class="flex justify-center gap-2 mt-3">
              <button onclick="document.getElementById('numValInput').value = Number(document.getElementById('numValInput').value) + 5" class="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold">+5</button>
              <button onclick="document.getElementById('numValInput').value = Number(document.getElementById('numValInput').value) + 10" class="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold">+10</button>
              <button onclick="document.getElementById('numValInput').value = Number(document.getElementById('numValInput').value) + 50" class="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold">+50</button>
            </div>
          </div>

          <div class="mb-5">
            <button
              type="button"
              onclick="appActions.saveNumberLog('${habit.id}', '${dateStr}', 'rest', 0)"
              class="w-full py-2.5 rounded-xl border text-xs font-semibold flex items-center justify-center gap-2 transition-all ${
                isRest 
                  ? 'bg-slate-700 text-slate-200 border-slate-500 shadow-inner' 
                  : 'bg-slate-900/50 text-slate-400 border-slate-800 hover:border-slate-700'
              }"
            >
              🌙 ${isRest ? '쉼(Rest) 지정됨' : '오늘 쉼 (휴식일) 지정'}
            </button>
          </div>

          <div class="flex gap-2">
            <button
              onclick="appActions.saveNumberLog('${habit.id}', '${dateStr}', 'none', 0)"
              class="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
            >
              초기화
            </button>
            <button
              onclick="appActions.saveNumberLog('${habit.id}', '${dateStr}', 'completed', Number(document.getElementById('numValInput').value))"
              class="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-lg shadow-indigo-600/30"
            >
              저장하기
            </button>
          </div>
        </div>
      </div>
    `;
  }

  // Toggle habit form type input fields
  window.toggleHabitTypeFields = function() {
    const type = document.getElementById('habitTypeSelect').value;
    const numFields = document.getElementById('numberTypeFields');
    if (type === 'number') numFields.classList.remove('hidden');
    else numFields.classList.add('hidden');
  };

})();
