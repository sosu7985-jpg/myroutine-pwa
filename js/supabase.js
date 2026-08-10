// Supabase & LocalStorage Data Layer for MyRoutine PWA

(function() {
  const STORAGE_KEYS = {
    SUPABASE_URL: 'myroutine_sb_url',
    SUPABASE_KEY: 'myroutine_sb_key',
    LOCAL_HABITS: 'myroutine_habits_data_v2',
    LOCAL_LOGS: 'myroutine_logs_data_v2'
  };

  const INITIAL_HABITS = [
    { id: 'h-1', title: '💧 아침 물 1L 마시기', type: 'number', unit: 'L', target_value: 1, color: '#3b82f6', created_at: new Date().toISOString() },
    { id: 'h-2', title: '💪 팔굽혀펴기 50회', type: 'number', unit: '회', target_value: 50, color: '#ef4444', created_at: new Date().toISOString() },
    { id: 'h-3', title: '📖 매일 독서 30분', type: 'check', unit: '분', target_value: 30, color: '#10b981', created_at: new Date().toISOString() },
    { id: 'h-4', title: '💊 비타민 영양제 먹기', type: 'check', unit: '회', target_value: 1, color: '#f59e0b', created_at: new Date().toISOString() }
  ];

  let supabaseClient = null;
  let realtimeSubscription = null;
  let listeners = [];

  function getSupabaseConfig() {
    return {
      url: localStorage.getItem(STORAGE_KEYS.SUPABASE_URL) || '',
      key: localStorage.getItem(STORAGE_KEYS.SUPABASE_KEY) || ''
    };
  }

  function setSupabaseConfig(url, key) {
    if (!url || !key) {
      localStorage.removeItem(STORAGE_KEYS.SUPABASE_URL);
      localStorage.removeItem(STORAGE_KEYS.SUPABASE_KEY);
      supabaseClient = null;
    } else {
      localStorage.setItem(STORAGE_KEYS.SUPABASE_URL, url);
      localStorage.setItem(STORAGE_KEYS.SUPABASE_KEY, key);
    }
    initSupabase();
    notifyListeners();
  }

  function initSupabase() {
    const { url, key } = getSupabaseConfig();
    if (url && key && window.supabase && window.supabase.createClient) {
      try {
        supabaseClient = window.supabase.createClient(url, key);
        console.log('[Supabase] Initialized successfully');
        setupRealtime();
      } catch (e) {
        console.error('[Supabase] Initialization error:', e);
        supabaseClient = null;
      }
    } else {
      supabaseClient = null;
    }
  }

  function setupRealtime() {
    if (!supabaseClient) return;
    if (realtimeSubscription) {
      supabaseClient.removeChannel(realtimeSubscription);
    }

    realtimeSubscription = supabaseClient
      .channel('public:myroutine')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'habits' }, () => {
        notifyListeners();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'habit_logs' }, () => {
        notifyListeners();
      })
      .subscribe((status) => {
        console.log('[Supabase Realtime Status]:', status);
      });
  }

  function subscribeDataChanges(callback) {
    listeners.push(callback);
    return () => {
      listeners = listeners.filter(cb => cb !== callback);
    };
  }

  function notifyListeners() {
    listeners.forEach(cb => cb());
  }

  function getLocal(key, defaultValue) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : defaultValue;
    } catch (e) {
      return defaultValue;
    }
  }

  function setLocal(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  async function fetchHabits() {
    if (supabaseClient) {
      try {
        const { data, error } = await supabaseClient.from('habits').select('*').order('created_at', { ascending: true });
        if (!error && data) {
          setLocal(STORAGE_KEYS.LOCAL_HABITS, data);
          return data;
        }
      } catch (e) {
        console.warn('[Supabase] Fetch habits fallback to LocalStorage', e);
      }
    }

    let habits = getLocal(STORAGE_KEYS.LOCAL_HABITS, null);
    if (!habits || habits.length === 0) {
      habits = INITIAL_HABITS;
      setLocal(STORAGE_KEYS.LOCAL_HABITS, habits);
    }
    return habits;
  }

  async function addOrUpdateHabit(habitData) {
    const id = habitData.id || (window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID() : 'h-' + Date.now());
    const habit = {
      id,
      title: habitData.title,
      type: habitData.type || 'check',
      unit: habitData.unit || (habitData.type === 'number' ? '회' : ''),
      target_value: Number(habitData.target_value) || 1,
      color: habitData.color || '#6366f1',
      created_at: habitData.created_at || new Date().toISOString()
    };

    let habits = getLocal(STORAGE_KEYS.LOCAL_HABITS, INITIAL_HABITS);
    const index = habits.findIndex(h => h.id === id);
    if (index >= 0) {
      habits[index] = habit;
    } else {
      habits.push(habit);
    }
    setLocal(STORAGE_KEYS.LOCAL_HABITS, habits);

    if (supabaseClient) {
      try {
        await supabaseClient.from('habits').upsert(habit);
      } catch (e) {
        console.error('[Supabase] Habit upsert failed:', e);
      }
    }

    notifyListeners();
    return habit;
  }

  async function deleteHabit(habitId) {
    let habits = getLocal(STORAGE_KEYS.LOCAL_HABITS, []);
    habits = habits.filter(h => h.id !== habitId);
    setLocal(STORAGE_KEYS.LOCAL_HABITS, habits);

    let logs = getLocal(STORAGE_KEYS.LOCAL_LOGS, []);
    logs = logs.filter(l => l.habit_id !== habitId);
    setLocal(STORAGE_KEYS.LOCAL_LOGS, logs);

    if (supabaseClient) {
      try {
        await supabaseClient.from('habits').delete().eq('id', habitId);
        await supabaseClient.from('habit_logs').delete().eq('habit_id', habitId);
      } catch (e) {
        console.error('[Supabase] Habit delete failed:', e);
      }
    }

    notifyListeners();
  }

  async function fetchLogs() {
    if (supabaseClient) {
      try {
        const { data, error } = await supabaseClient.from('habit_logs').select('*');
        if (!error && data) {
          setLocal(STORAGE_KEYS.LOCAL_LOGS, data);
          return data;
        }
      } catch (e) {
        console.warn('[Supabase] Fetch logs fallback to LocalStorage', e);
      }
    }

    return getLocal(STORAGE_KEYS.LOCAL_LOGS, []);
  }

  async function setHabitLog(habitId, dateStr, status, numericValue = 0) {
    const logs = getLocal(STORAGE_KEYS.LOCAL_LOGS, []);
    const index = logs.findIndex(l => l.habit_id === habitId && (l.log_date === dateStr || l.date === dateStr));

    const updatedLog = {
      id: index >= 0 ? logs[index].id : (window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID() : 'l-' + Date.now()),
      habit_id: habitId,
      log_date: dateStr,
      status: status, // 'completed' | 'rest' | 'none'
      numeric_value: Number(numericValue) || 0,
      updated_at: new Date().toISOString()
    };

    if (status === 'none') {
      if (index >= 0) logs.splice(index, 1);
    } else {
      if (index >= 0) logs[index] = updatedLog;
      else logs.push(updatedLog);
    }
    setLocal(STORAGE_KEYS.LOCAL_LOGS, logs);

    if (supabaseClient) {
      try {
        if (status === 'none') {
          await supabaseClient.from('habit_logs').delete().eq('habit_id', habitId).eq('log_date', dateStr);
        } else {
          await supabaseClient.from('habit_logs').upsert(updatedLog);
        }
      } catch (e) {
        console.error('[Supabase] Log upsert failed:', e);
      }
    }

    notifyListeners();
    return updatedLog;
  }

  // Export to global window object
  window.MyRoutineDB = {
    getSupabaseConfig,
    setSupabaseConfig,
    initSupabase,
    subscribeDataChanges,
    fetchHabits,
    addOrUpdateHabit,
    deleteHabit,
    fetchLogs,
    setHabitLog
  };
})();
