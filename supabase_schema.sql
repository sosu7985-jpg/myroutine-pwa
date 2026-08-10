-- ========================================================
-- MyRoutine Habit Tracker PWA - Supabase Database Schema (Self-Healing / Re-run Safe)
-- ========================================================
-- 이 SQL 스크립트를 Supabase 대시보드 -> SQL Editor에 전체 복사하여 RUN 하세요.

-- 1. 습관 (Habits) 테이블 생성
CREATE TABLE IF NOT EXISTS public.habits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(100) NOT NULL,
    type VARCHAR(20) NOT NULL CHECK (type IN ('check', 'number')),
    unit VARCHAR(30) DEFAULT '회',
    target_value NUMERIC DEFAULT 1,
    color VARCHAR(30) DEFAULT '#6366f1',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. 습관 일별 수행 기록 (Habit Logs) 테이블 생성
CREATE TABLE IF NOT EXISTS public.habit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    habit_id UUID NOT NULL REFERENCES public.habits(id) ON DELETE CASCADE,
    log_date DATE NOT NULL,
    status VARCHAR(20) NOT NULL CHECK (status IN ('completed', 'rest', 'none')),
    numeric_value NUMERIC DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_habit_date UNIQUE (habit_id, log_date)
);

-- 3. 성능 향상을 위한 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_habit_logs_date ON public.habit_logs(log_date);
CREATE INDEX IF NOT EXISTS idx_habit_logs_habit_id ON public.habit_logs(habit_id);

-- 4. RLS (Row Level Security) 설정 및 기존 정책 재설정
ALTER TABLE public.habits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.habit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public access to habits" ON public.habits;
DROP POLICY IF EXISTS "Allow public access to habit_logs" ON public.habit_logs;

CREATE POLICY "Allow public access to habits" 
    ON public.habits FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow public access to habit_logs" 
    ON public.habit_logs FOR ALL USING (true) WITH CHECK (true);

-- 5. Realtime (실시간 동기화) 복제 활성화
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'habits'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.habits;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'habit_logs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.habit_logs;
  END IF;
END $$;
