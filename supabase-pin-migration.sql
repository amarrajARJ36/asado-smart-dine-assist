-- =============================================================
-- ARJ SmartDine Assist — Captain PIN Protection
-- Run this ONCE in Supabase SQL Editor
-- =============================================================

-- 1. Config table for restaurant settings (PIN, etc.)
CREATE TABLE IF NOT EXISTS public.restaurant_config (
  id serial PRIMARY KEY,
  config_key text UNIQUE NOT NULL,
  config_value text NOT NULL,
  updated_at timestamptz DEFAULT now()
);

-- 2. Set the default Captain PIN to 1234 (change this!)
INSERT INTO public.restaurant_config (config_key, config_value)
VALUES ('captain_pin', '1234')
ON CONFLICT (config_key) DO NOTHING;

-- 3. RLS: allow read-only for PIN validation
ALTER TABLE public.restaurant_config ENABLE ROW LEVEL SECURITY;

-- 4. Create a secure RPC function to validate PIN
--    (Never expose the PIN directly to the client)
CREATE OR REPLACE FUNCTION public.validate_captain_pin(p_pin text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stored_pin text;
BEGIN
  SELECT config_value INTO v_stored_pin
  FROM public.restaurant_config
  WHERE config_key = 'captain_pin';

  IF v_stored_pin IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'PIN not configured.');
  END IF;

  IF p_pin = v_stored_pin THEN
    RETURN jsonb_build_object('success', true);
  ELSE
    RETURN jsonb_build_object('success', false, 'error', 'Incorrect PIN.');
  END IF;
END;
$$;

-- =============================================================
-- DONE! Default PIN is 1234. To change it, run:
-- UPDATE public.restaurant_config SET config_value = '5678' WHERE config_key = 'captain_pin';
-- =============================================================
