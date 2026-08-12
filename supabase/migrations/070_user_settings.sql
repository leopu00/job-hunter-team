-- 070_user_settings.sql
--
-- [JHT-CLOUD-SYNC-THEME] Preferenza tema v1 sincronizzata fra browser.
-- Perimetro intenzionalmente stretto: nessun campo lingua, valuta, colonne o
-- JSON generico. Il browser usa direttamente la sessione utente e la RLS.

CREATE TABLE IF NOT EXISTS public.user_settings (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    theme TEXT NOT NULL
        CHECK (theme IN ('dark', 'light', 'system')),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own settings" ON public.user_settings;
CREATE POLICY "Users manage own settings"
    ON public.user_settings FOR ALL
    USING ((SELECT auth.uid()) = user_id)
    WITH CHECK ((SELECT auth.uid()) = user_id);

DROP TRIGGER IF EXISTS user_settings_updated_at ON public.user_settings;
CREATE TRIGGER user_settings_updated_at
    BEFORE UPDATE ON public.user_settings
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
