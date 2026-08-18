-- =============================================================
-- ARJ SmartDine Assist — Daily Analytics RPC
-- Run this ONCE in Supabase SQL Editor
-- =============================================================

CREATE OR REPLACE FUNCTION public.get_daily_stats(p_start_of_day_ms bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total int;
  v_top text;
  v_breakdown jsonb;
BEGIN
  -- 1. Total requests today
  SELECT COUNT(*) INTO v_total
  FROM public.service_requests
  WHERE created_at >= p_start_of_day_ms;

  -- 2. Most requested service
  SELECT service INTO v_top
  FROM public.service_requests
  WHERE created_at >= p_start_of_day_ms
  GROUP BY service
  ORDER BY COUNT(*) DESC
  LIMIT 1;

  IF v_top IS NULL THEN
    v_top := '-';
  END IF;

  -- 3. Breakdown of all services
  SELECT jsonb_agg(
           jsonb_build_object(
             'service', service,
             'count', request_count
           )
         ) INTO v_breakdown
  FROM (
    SELECT service, COUNT(*) as request_count
    FROM public.service_requests
    WHERE created_at >= p_start_of_day_ms
    GROUP BY service
    ORDER BY request_count DESC
  ) subquery;

  IF v_breakdown IS NULL THEN
    v_breakdown := '[]'::jsonb;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'total_requests', COALESCE(v_total, 0),
    'most_requested', v_top,
    'breakdown', v_breakdown
  );
END;
$$;
