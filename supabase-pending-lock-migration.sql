-- =============================================================
-- ARJ SmartDine Assist — Pending Lock & Security Update
-- Run this ONCE in Supabase SQL Editor
-- =============================================================

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

  v_table_name := v_table_record.table_name;

  -- ========== SAFEGUARD 3: SESSION ENFORCEMENT (90 min) ==========
  UPDATE public.sessions
  SET is_active = false
  WHERE table_name = v_table_name
    AND is_active = true
    AND expires_at <= v_now;

  SELECT * INTO v_session
  FROM public.sessions
  WHERE table_name = v_table_name
    AND secret_token = p_token
    AND is_active = true
    AND expires_at > v_now
  ORDER BY started_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    INSERT INTO public.sessions (table_name, secret_token, started_at, expires_at)
    VALUES (v_table_name, p_token, v_now, v_now + 5400000);
    v_session_remaining := 5400000;
  ELSE
    v_session_remaining := v_session.expires_at - v_now;
  END IF;

  -- ========== SAFEGUARD 2: PENDING LOCK & RATE LIMITING ==========
  -- 1. Reject if there is already a 'pending' request for this exact service
  SELECT * INTO v_last_request
  FROM public.service_requests
  WHERE table_name = v_table_name
    AND service_key = p_service_key
    AND status = 'pending'
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'RATE_LIMITED',
      'message', 'You already have a pending request for this service.',
      'session_remaining_ms', v_session_remaining
    );
  END IF;

  -- 2. Reject if the last request was within 60 seconds (even if completed fast)
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
