-- =============================================================
-- ARJ SmartDine Assist — Security Migration
-- Run this ONCE in Supabase SQL Editor
-- =============================================================

-- 1. TABLES: Each physical table has a unique secret token
CREATE TABLE IF NOT EXISTS public.tables (
  id serial PRIMARY KEY,
  table_number int UNIQUE NOT NULL,
  table_name text UNIQUE NOT NULL,
  secret_token text UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Pre-populate tables 1 through 20
INSERT INTO public.tables (table_number, table_name)
SELECT n, 'Table ' || LPAD(n::text, 2, '0')
FROM generate_series(1, 20) AS n
ON CONFLICT (table_number) DO NOTHING;

-- 2. SESSIONS: Server-side 90-minute dining sessions
CREATE TABLE IF NOT EXISTS public.sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name text NOT NULL,
  secret_token text NOT NULL,
  started_at bigint NOT NULL,
  expires_at bigint NOT NULL,
  is_active boolean DEFAULT true
);

-- 3. SECURE RPC FUNCTION: Single entry point for all guest requests
--    Validates token, enforces session, rate-limits — all server-side
CREATE OR REPLACE FUNCTION public.create_service_request(
  p_token text,
  p_table_number int,
  p_service text,
  p_service_key text,
  p_icon text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_table_record record;
  v_session record;
  v_last_request record;
  v_now bigint;
  v_alert_id text;
  v_table_name text;
  v_session_remaining bigint;
BEGIN
  v_now := (EXTRACT(EPOCH FROM now()) * 1000)::bigint;
  v_table_name := 'Table ' || LPAD(p_table_number::text, 2, '0');

  -- ========== SAFEGUARD 1: TOKEN VALIDATION ==========
  SELECT * INTO v_table_record
  FROM public.tables
  WHERE table_number = p_table_number
    AND secret_token = p_token
    AND is_active = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'INVALID_TOKEN',
      'message', 'Invalid or expired table token. Please re-scan the QR code.'
    );
  END IF;

  -- ========== SAFEGUARD 3: SESSION ENFORCEMENT (90 min) ==========
  -- Deactivate any expired sessions first
  UPDATE public.sessions
  SET is_active = false
  WHERE table_name = v_table_name
    AND is_active = true
    AND expires_at <= v_now;

  -- Find an active session
  SELECT * INTO v_session
  FROM public.sessions
  WHERE table_name = v_table_name
    AND secret_token = p_token
    AND is_active = true
    AND expires_at > v_now
  ORDER BY started_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    -- Check if there was a session that just expired (user needs fresh scan)
    IF EXISTS (
      SELECT 1 FROM public.sessions
      WHERE table_name = v_table_name AND secret_token = p_token AND is_active = false
    ) THEN
      -- There was a previous session that expired — check if it expired recently
      -- If any session existed, create a new one (allowing re-use of same QR)
      NULL; -- fall through to create new session below
    END IF;

    -- Create a brand new session
    INSERT INTO public.sessions (table_name, secret_token, started_at, expires_at)
    VALUES (v_table_name, p_token, v_now, v_now + 5400000);

    v_session_remaining := 5400000;
  ELSE
    v_session_remaining := v_session.expires_at - v_now;
  END IF;

  -- ========== SAFEGUARD 2: RATE LIMITING (60s per service_key) ==========
  SELECT * INTO v_last_request
  FROM public.service_requests
  WHERE table_name = v_table_name
    AND service_key = p_service_key
    AND created_at > (v_now - 60000)
  ORDER BY created_at DESC
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'RATE_LIMITED',
      'message', 'Please wait before sending another request.',
      'session_remaining_ms', v_session_remaining
    );
  END IF;

  -- ========== ALL CHECKS PASSED: INSERT REQUEST ==========
  v_alert_id := 'alert_' || v_now::text || '_' || floor(random() * 1000)::text;

  INSERT INTO public.service_requests (id, table_name, service, service_key, icon, status, created_at)
  VALUES (v_alert_id, v_table_name, p_service, p_service_key, p_icon, 'pending', v_now);

  RETURN jsonb_build_object(
    'success', true,
    'alert_id', v_alert_id,
    'session_remaining_ms', v_session_remaining
  );
END;
$$;

-- 4. LOCK DOWN RLS: Remove the open INSERT policy
--    Guests can no longer insert directly — only through the RPC function
DROP POLICY IF EXISTS "Allow public insert" ON public.service_requests;

-- Keep existing read/update/delete for captain dashboard
-- (These should already exist from the initial setup)

-- 5. RLS for the tables table (read-only, so guests can look up their token)
ALTER TABLE public.tables ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read tables"
  ON public.tables FOR SELECT USING (true);

-- 6. RLS for sessions (read-only for guests to check remaining time)
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read sessions"
  ON public.sessions FOR SELECT USING (true);

-- =============================================================
-- DONE! Now run this query to see your table tokens:
-- SELECT table_number, table_name, secret_token FROM public.tables ORDER BY table_number;
-- =============================================================
