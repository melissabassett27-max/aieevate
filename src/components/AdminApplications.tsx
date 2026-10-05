import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

type TeamApplication = {
  id: string;
  data: Record<string, string>;
  created_at: string;
  review_status: 'pending' | 'approved' | 'rejected';
  payment_status: 'not_due' | 'pending' | 'paid' | 'rejected';
  payment_checkout_url: string | null;
  payment_amount: number | null;
  payment_currency: string | null;
};

type AccountSaleSubmission = {
  id: string;
  data: Record<string, string>;
  created_at: string;
  review_status: 'pending' | 'approved' | 'rejected';
  seller_payment_status: 'not_due' | 'pending' | 'paid' | 'rejected';
};

async function callAdminApi<T>(path: string, session: Session, body?: object): Promise<T> {
  const response = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(result?.error || 'Admin request failed');
  return result as T;
}

export default function AdminApplications() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [teamApplications, setTeamApplications] = useState<TeamApplication[]>([]);
  const [accountSaleSubmissions, setAccountSaleSubmissions] = useState<AccountSaleSubmission[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [checkoutLinks, setCheckoutLinks] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const loadApplications = async (currentSession: Session) => {
    setLoading(true);
    try {
      const result = await callAdminApi<{
        teamApplications: TeamApplication[];
        accountSaleSubmissions: AccountSaleSubmission[];
      }>('/api/admin-applications', currentSession);
      setTeamApplications(result.teamApplications);
      setAccountSaleSubmissions(result.accountSaleSubmissions);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load applications');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!supabase) {
      setAuthReady(true);
      return;
    }
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });
    return () => subscription.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session) void loadApplications(session);
    else {
      setTeamApplications([]);
      setAccountSaleSubmissions([]);
    }
  }, [session]);

  const signIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase) return;
    setError(null);
    setMessage(null);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) setError(signInError.message);
  };

  const review = async (form: 'team' | 'account-sale', applicationId: string, decision: 'approved' | 'rejected') => {
    if (!session) return;
    setBusyId(applicationId);
    setError(null);
    setMessage(null);
    try {
      await callAdminApi('/api/admin-review', session, { form, applicationId, decision });
      setMessage(`${form === 'team' ? 'Team application' : 'Account sale'} ${decision}.`);
      await loadApplications(session);
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : 'Could not save review');
    } finally {
      setBusyId(null);
    }
  };

  const recordSellerPayment = async (applicationId: string) => {
    if (!session || !window.confirm('Confirm that the $30 seller payment was sent manually?')) return;
    setBusyId(applicationId);
    setError(null);
    setMessage(null);
    try {
      await callAdminApi('/api/admin-seller-payment', session, { applicationId, confirm: true });
      setMessage('Manual seller payment recorded. No transfer was initiated by this app.');
      await loadApplications(session);
    } catch (paymentError) {
      setError(paymentError instanceof Error ? paymentError.message : 'Could not record seller payment');
    } finally {
      setBusyId(null);
    }
  };

  const createCheckout = async (applicationId: string) => {
    if (!session) return;
    setBusyId(applicationId);
    setError(null);
    setMessage(null);
    try {
      const result = await callAdminApi<{ authorizationUrl: string; amount: number; currency: string }>(
        '/api/admin-checkout',
        session,
        { applicationId },
      );
      setCheckoutLinks((previous) => ({ ...previous, [applicationId]: result.authorizationUrl }));
      setMessage(`Checkout created: ${result.currency} ${result.amount / 100}. Copy the link and send it to the approved applicant.`);
      await loadApplications(session);
    } catch (checkoutError) {
      setError(checkoutError instanceof Error ? checkoutError.message : 'Could not create checkout');
    } finally {
      setBusyId(null);
    }
  };

  if (!authReady) return <p className="text-sm text-muted-foreground">Loading admin access…</p>;

  if (!session) {
    return (
      <form onSubmit={signIn} className="mx-auto max-w-md space-y-4">
        <p className="text-sm text-muted-foreground">Sign in with an email listed in the Vercel `ADMIN_EMAILS` environment variable.</p>
        <label className="block text-sm font-medium">
          Email
          <input className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="username" />
        </label>
        <label className="block text-sm font-medium">
          Password
          <input className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required autoComplete="current-password" />
        </label>
        <button className="rounded-md bg-primary px-4 py-2 font-semibold text-primary-foreground" type="submit">Sign in</button>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </form>
    );
  }

  return (
    <section className="mx-auto max-w-5xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <p className="text-sm text-muted-foreground">Admin: {session.user.email}</p>
        <button type="button" className="rounded-md border border-border px-3 py-2 text-sm" onClick={() => void supabase?.auth.signOut()}>Sign out</button>
      </div>
      {error && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
      {message && <p role="status" className="rounded-md border border-primary/30 bg-primary/10 p-3 text-sm">{message}</p>}
      {loading && <p className="text-sm text-muted-foreground">Refreshing applications…</p>}
      {!teamApplications.length && !accountSaleSubmissions.length && !loading && <p className="py-8 text-center text-sm text-muted-foreground">No applications yet.</p>}
      <div className="space-y-10">
        <section>
          <h2 className="border-b border-border pb-3 text-lg font-semibold">Team membership applications</h2>
          <div className="divide-y divide-border">
        {teamApplications.map((application) => (
          <article key={application.id} className="space-y-3 py-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="font-semibold">{application.data.full_name || 'Applicant'}</h2>
                <p className="text-sm text-muted-foreground">{application.data.email} · {application.data.country}</p>
                <p className="mt-1 text-xs text-muted-foreground">Applied {new Date(application.created_at).toLocaleString()}</p>
              </div>
              <p className="text-sm">Review: <strong>{application.review_status}</strong> · Payment: <strong>{application.payment_status}</strong></p>
            </div>
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div><dt className="text-muted-foreground">Experience</dt><dd>{application.data.experience || '—'}</dd></div>
              <div><dt className="text-muted-foreground">Preferred work</dt><dd>{application.data.preferred_experience || '—'}</dd></div>
              <div><dt className="text-muted-foreground">Payout preference</dt><dd>{application.data.payout_method || '—'}</dd></div>
            </dl>
            <div className="flex flex-wrap gap-2">
              {application.review_status === 'pending' && (
                <>
                  <button type="button" disabled={busyId === application.id} onClick={() => void review('team', application.id, 'approved')} className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60">Approve</button>
                  <button type="button" disabled={busyId === application.id} onClick={() => void review('team', application.id, 'rejected')} className="rounded-md border border-border px-3 py-2 text-sm disabled:opacity-60">Reject</button>
                </>
              )}
              {application.review_status === 'approved' && application.payment_status !== 'paid' && (
                <button type="button" disabled={busyId === application.id} onClick={() => void createCheckout(application.id)} className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60">{busyId === application.id ? 'Working…' : 'Create $50 checkout link'}</button>
              )}
            </div>
            {application.payment_status !== 'paid' && (checkoutLinks[application.id] || application.payment_checkout_url) && (
              <div className="break-all rounded-md border border-border bg-secondary/30 p-3 text-sm">
                <p className="font-medium">Send this checkout link to the applicant:</p>
                <a className="text-primary underline" href={checkoutLinks[application.id] || application.payment_checkout_url || '#'} target="_blank" rel="noopener noreferrer">{checkoutLinks[application.id] || application.payment_checkout_url}</a>
              </div>
            )}
          </article>
        ))}
          </div>
        </section>
        <section>
          <h2 className="border-b border-border pb-3 text-lg font-semibold">Account-sale applications · $30 manual seller payment</h2>
          <div className="divide-y divide-border">
            {accountSaleSubmissions.map((submission) => (
              <article key={submission.id} className="space-y-3 py-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h3 className="font-semibold">{submission.data.full_name || 'Seller'}</h3>
                    <p className="text-sm text-muted-foreground">{submission.data.contact_email} · {submission.data.platform}</p>
                    <p className="mt-1 text-xs text-muted-foreground">Submitted {new Date(submission.created_at).toLocaleString()}</p>
                  </div>
                  <p className="text-sm">Review: <strong>{submission.review_status}</strong> · Seller payment: <strong>{submission.seller_payment_status}</strong></p>
                </div>
                <dl className="grid gap-2 text-sm sm:grid-cols-2">
                  <div><dt className="text-muted-foreground">Account login</dt><dd>{submission.data.account_login || '—'}</dd></div>
                  <div><dt className="text-muted-foreground">Account standing</dt><dd>{submission.data.account_standing || '—'}</dd></div>
                  <div><dt className="text-muted-foreground">Reported monthly earnings</dt><dd>{submission.data.monthly_earnings || '—'}</dd></div>
                  <div><dt className="text-muted-foreground">Seller payout method</dt><dd>{submission.data.payout_method || '—'}</dd></div>
                </dl>
                <div className="flex flex-wrap gap-2">
                  {submission.review_status === 'pending' && (
                    <>
                      <button type="button" disabled={busyId === submission.id} onClick={() => void review('account-sale', submission.id, 'approved')} className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60">Approve offer</button>
                      <button type="button" disabled={busyId === submission.id} onClick={() => void review('account-sale', submission.id, 'rejected')} className="rounded-md border border-border px-3 py-2 text-sm disabled:opacity-60">Reject</button>
                    </>
                  )}
                  {submission.review_status === 'approved' && submission.seller_payment_status === 'pending' && (
                    <button type="button" disabled={busyId === submission.id} onClick={() => void recordSellerPayment(submission.id)} className="rounded-md border border-border px-3 py-2 text-sm disabled:opacity-60">Record $30 manual payment</button>
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}
