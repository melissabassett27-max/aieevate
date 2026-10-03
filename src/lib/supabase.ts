import { createClient } from '@supabase/supabase-js'
const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL
const supabaseKey = import.meta.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY || import.meta.env.PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  console.warn('Supabase is not configured. Member authentication and live dashboard data are unavailable.')
}

export const supabase = supabaseUrl && supabaseKey
  ? createClient(supabaseUrl, supabaseKey)
  : null
