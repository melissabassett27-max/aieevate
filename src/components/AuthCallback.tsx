import { useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Loader2 } from 'lucide-react';

export default function AuthCallback() {
  useEffect(() => {
    if (!supabase) {
      window.location.href = '/index#team-dashboard';
      return;
    }

    // If a session already exists (link opened in the same tab), go straight in.
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) window.location.href = '/index#team-dashboard';
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session) {
        window.location.href = '/index#team-dashboard';
      }
    });

    // Fallback: if nothing resolves shortly, return to the dashboard.
    const timer = window.setTimeout(() => {
      window.location.href = '/index#team-dashboard';
    }, 4000);

    return () => {
      sub.subscription.unsubscribe();
      window.clearTimeout(timer);
    };
  }, []);

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Confirming your account…
      </p>
    </div>
  );
}
