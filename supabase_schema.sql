-- ========================================================
-- MyRoutine Habit Tracker PWA - Supabase Database Schema
-- ========================================================
-- 이 SQL 스크립트를 Supabase 대시보드 -> SQL Editor에 복사하여 실행하세요.

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

-- 4. RLS (Row Level Security) 설정 (익명 읽기/쓰기 허용 - 시연용)
ALTER TABLE public.habits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.habit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public access to habits" 
    ON public.habits FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow public access to habit_logs" 
    ON public.habit_logs FOR ALL USING (true) WITH CHECK (true);

-- 5. Realtime (실시간 동기화) 복제 설정
-- Supabase 대시보드 -> Database -> Publications에서 
-- habits 및 habit_logs 테이블의 Realtime을 활성화해야 합니다.
ALTER PUBLICATION supabase_realtime ADD TABLE public.habits;
ALTER PUBLICATION supabase_realtime ADD TABLE public.habit_logs;

-- 샘플 데이터 입력 (테스트용)
INSERT INTO public.habits (id, title, type, unit, target_value, color)
VALUES 
    ('11111111-1111-1111-1111-111111111111', '아침 물 1L 마시기', 'number', 'L', 1, '#3b82f6'),
    ('22222211-1111-1111-1111-111111111111', '팔굽혀펴기 50회', 'number', '회', 50, '#ef4444'),
    ('33333311-1111-1111-1111-111111111111', '매일 독서 30분', 'check', '분', 30, '#10b981'),
    ('44444411-1111-1111-1111-111111111111', '비타민 영양제 챙겨먹기', 'check', '회', 1, '#f59e0b')
ON CONFLICT (id) DO NOTHING;
