// Supabase & LocalStorage Data Layer for MyRoutine PWA

(function() {
  const STORAGE_KEYS = {
    SUPABASE_URL: 'myroutine_sb_url',
    SUPABASE_KEY: 'myroutine_sb_key',
    LOCAL_HABITS: 'myroutine_habits_data_v3',
    LOCAL_LOGS: 'myroutine_logs_data_v3'
  };

  // Helper: Sanitize Supabase URL (strip trailing /rest/v1 and slashes)
  function sanitizeUrl(rawUrl) {
    if (!rawUrl) return '';
    let cleaned = rawUrl.trim();
    cleaned = cleaned.replace(/\/rest\/v1\/?$/i, '');
    cleaned = cleaned.replace(/\/+$/, '');
    return cleaned;
  }

  // Helper: Generate valid UUID v4
  function generateUUID() {
    if (window.crypto && window.crypto.randomUUID) {
      return window.crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  const INITIAL_HABITS = [
    { id: '11111111-1111-1111-1111-111111111111', title: '💧 아침 물 1L 마시기', type: 'number', unit: 'L', target_value: 1, color: '#3b82f6', created_at: new Date().toISOString() },
    { id: '22222211-1111-1111-1111-111111111111', title: '💪 팔굽혀펴기 50회', type: 'number', unit: '회', target_value: 50, color: '#ef4444', created_at: new Date().toISOString() },
    { id: '33333311-1111-1111-1111-111111111111', title: '📖 매일 독서 30분', type: 'check', unit: '분', target_value: 30, color: '#10b981', created_at: new Date().toISOString() },
    { id: '44444411-1111-1111-1111-111111111111', title: '💊 비타민 영양제 먹기', type: 'check', unit: '회', target_value: 1, color: '#f59e0b', created_at: new Date().toISOString() }
  ];

  let supabaseClient = null;
  let realtimeSubscription = null;
  let listeners = [];
  let authenticatedUserId = null;

  function isServiceRoleKey(key) {
    try {
      const payload = JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      return payload.role === 'service_role';
    } catch (_) {
      return false;
    }
  }

  function getSupabaseConfig() {
    return {
      url: localStorage.getItem(STORAGE_KEYS.SUPABASE_URL) || '',
      key: localStorage.getItem(STORAGE_KEYS.SUPABASE_KEY) || ''
    };
  }

  function setSupabaseConfig(url, key) {
    const cleanedUrl = sanitizeUrl(url);
    const cleanedKey = (key || '').trim();

    if (!cleanedUrl || !cleanedKey) {
      localStorage.removeItem(STORAGE_KEYS.SUPABASE_URL);
      localStorage.removeItem(STORAGE_KEYS.SUPABASE_KEY);
      supabaseClient = null;
      authenticatedUserId = null;
    } else {
      localStorage.setItem(STORAGE_KEYS.SUPABASE_URL, cleanedUrl);
      localStorage.setItem(STORAGE_KEYS.SUPABASE_KEY, cleanedKey);
    }
    const initialized = initSupabase();
    notifyListeners();
    return initialized;
  }

  async function initSupabase() {
    const { url, key } = getSupabaseConfig();
    const cleanedUrl = sanitizeUrl(url);

    if (cleanedUrl && key && window.supabase && window.supabase.createClient) {
      try {
        supabaseClient = window.supabase.createClient(cleanedUrl, key);
        console.log('[Supabase] Initialized successfully with URL:', cleanedUrl);
        const { data } = await supabaseClient.auth.getSession();
        authenticatedUserId = data.session?.user?.id || null;
        if (authenticatedUserId) await setupRealtime();
      } catch (e) {
        console.error('[Supabase] Initialization error:', e);
        supabaseClient = null;
        authenticatedUserId = null;
      }
    } else {
      supabaseClient = null;
      authenticatedUserId = null;
    }
    return Boolean(authenticatedUserId);
  }

  async function setupRealtime() {
    if (!supabaseClient || !authenticatedUserId) return;
    if (realtimeSubscription) {
      supabaseClient.removeChannel(realtimeSubscription);
    }

    realtimeSubscription = supabaseClient
      .channel('public:myroutine')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'habits', filter: `user_id=eq.${authenticatedUserId}` }, () => {
        console.log('[Realtime] Habits updated');
        notifyListeners();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'habit_logs', filter: `user_id=eq.${authenticatedUserId}` }, () => {
        console.log('[Realtime] Habit Logs updated');
        notifyListeners();
      })
      .subscribe((status) => {
        console.log('[Supabase Realtime Status]:', status);
      });
  }

  async function connectSupabase(url, key, email, password, createAccount) {
    const cleanedUrl = sanitizeUrl(url);
    const cleanedKey = (key || '').trim();
    if (!/^https:\/\//i.test(cleanedUrl)) throw new Error('Supabase HTTPS URL을 확인해 주세요.');
    if (!cleanedKey) throw new Error('Anon public key를 입력해 주세요.');
    if (isServiceRoleKey(cleanedKey)) throw new Error('service_role 키는 브라우저에 저장할 수 없습니다. anon key를 사용해 주세요.');
    if (!email || !email.includes('@')) throw new Error('로그인 이메일을 확인해 주세요.');
    if (!password || password.length < 8) throw new Error('비밀번호는 8자 이상이어야 합니다.');

    localStorage.setItem(STORAGE_KEYS.SUPABASE_URL, cleanedUrl);
    localStorage.setItem(STORAGE_KEYS.SUPABASE_KEY, cleanedKey);
    await initSupabase();
    const authResult = createAccount
      ? await supabaseClient.auth.signUp({ email, password })
      : await supabaseClient.auth.signInWithPassword({ email, password });
    if (authResult.error) throw authResult.error;
    authenticatedUserId = authResult.data.session?.user?.id || null;
    if (!authenticatedUserId) return { needsConfirmation: true };

    const { error } = await supabaseClient.from('habits').select('id').limit(1);
    if (error) {
      authenticatedUserId = null;
      throw new Error(`DB 권한 또는 스키마 확인 필요: ${error.message}`);
    }
    await setupRealtime();
    notifyListeners();
    return { needsConfirmation: false };
  }

  function isConnected() {
    return Boolean(supabaseClient && authenticatedUserId);
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
    if (supabaseClient && authenticatedUserId) {
      try {
        const { data, error } = await supabaseClient.from('habits').select('*').order('created_at', { ascending: true });
        if (!error && data) {
          setLocal(STORAGE_KEYS.LOCAL_HABITS, data);
          return data;
        } else if (error) {
          console.error('[Supabase] Fetch habits error:', error);
          authenticatedUserId = null;
        }
      } catch (e) {
        console.warn('[Supabase] Fetch habits fallback to LocalStorage', e);
        authenticatedUserId = null;
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
    const isUUID = habitData.id && habitData.id.length === 36 && habitData.id.includes('-');
    const id = isUUID ? habitData.id : generateUUID();

    const habit = {
      id,
      title: habitData.title,
      type: habitData.type || 'check',
      unit: habitData.unit || (habitData.type === 'number' ? '회' : ''),
      target_value: Number(habitData.target_value) || 1,
      color: habitData.color || '#6366f1',
      created_at: habitData.created_at || new Date().toISOString()
    };
    if (authenticatedUserId) habit.user_id = authenticatedUserId;

    let habits = getLocal(STORAGE_KEYS.LOCAL_HABITS, INITIAL_HABITS);
    const index = habits.findIndex(h => h.id === id);
    if (index >= 0) {
      habits[index] = habit;
    } else {
      habits.push(habit);
    }
    setLocal(STORAGE_KEYS.LOCAL_HABITS, habits);

    if (supabaseClient && authenticatedUserId) {
      try {
        const { error } = await supabaseClient.from('habits').upsert(habit);
        if (error) {
          authenticatedUserId = null;
          throw error;
        }
      } catch (e) {
        authenticatedUserId = null;
        console.error('[Supabase] Habit upsert failed:', e);
        throw e;
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

    if (supabaseClient && authenticatedUserId) {
      try {
        const { error: logError } = await supabaseClient.from('habit_logs').delete().eq('habit_id', habitId);
        const { error: habitError } = await supabaseClient.from('habits').delete().eq('id', habitId);
        if (logError || habitError) throw logError || habitError;
      } catch (e) {
        authenticatedUserId = null;
        console.error('[Supabase] Habit delete failed:', e);
        throw e;
      }
    }

    notifyListeners();
  }

  async function fetchLogs() {
    if (supabaseClient && authenticatedUserId) {
      try {
        const { data, error } = await supabaseClient.from('habit_logs').select('*');
        if (!error && data) {
          setLocal(STORAGE_KEYS.LOCAL_LOGS, data);
          return data;
        } else if (error) {
          console.error('[Supabase] Fetch logs error:', error);
          authenticatedUserId = null;
        }
      } catch (e) {
        console.warn('[Supabase] Fetch logs fallback to LocalStorage', e);
        authenticatedUserId = null;
      }
    }

    return getLocal(STORAGE_KEYS.LOCAL_LOGS, []);
  }

  async function setHabitLog(habitId, dateStr, status, numericValue = 0) {
    const logs = getLocal(STORAGE_KEYS.LOCAL_LOGS, []);
    const index = logs.findIndex(l => l.habit_id === habitId && (l.log_date === dateStr || l.date === dateStr));

    const isUUID = index >= 0 && logs[index].id && logs[index].id.length === 36 && logs[index].id.includes('-');
    const logId = isUUID ? logs[index].id : generateUUID();

    const updatedLog = {
      id: logId,
      habit_id: habitId,
      log_date: dateStr,
      status: status,
      numeric_value: Number(numericValue) || 0,
      updated_at: new Date().toISOString()
    };
    if (authenticatedUserId) updatedLog.user_id = authenticatedUserId;

    if (status === 'none') {
      if (index >= 0) logs.splice(index, 1);
    } else {
      if (index >= 0) logs[index] = updatedLog;
      else logs.push(updatedLog);
    }
    setLocal(STORAGE_KEYS.LOCAL_LOGS, logs);

    if (supabaseClient && authenticatedUserId) {
      try {
        if (status === 'none') {
          const { error } = await supabaseClient.from('habit_logs').delete().eq('habit_id', habitId).eq('log_date', dateStr);
          if (error) throw error;
        } else {
          const { error } = await supabaseClient.from('habit_logs').upsert(updatedLog);
          if (error) throw error;
        }
      } catch (e) {
        authenticatedUserId = null;
        console.error('[Supabase] Log upsert failed:', e);
        throw e;
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
    connectSupabase,
    isConnected,
    subscribeDataChanges,
    fetchHabits,
    addOrUpdateHabit,
    deleteHabit,
    fetchLogs,
    setHabitLog
  };
})();
