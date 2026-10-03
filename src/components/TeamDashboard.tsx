import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  BadgeCheck,
  Bot,
  Check,
  Coins,
  KeyRound,
  Landmark,
  Loader2,
  Plus,
  RefreshCw,
  ShieldCheck,
  Star,
  TrendingUp,
  Wallet,
} from 'lucide-react';

type ManagedAccount = {
  id: string;
  dbId?: string;
  platform: string;
  status: 'Active' | 'In verification' | 'Cooldown' | 'Needs attention';
  stars: number;
  tasksThisWeek: number;
  monthlyEarnings: number;
};

const MANAGED_ACCOUNTS: ManagedAccount[] = [
  { id: 'OUT-2841', platform: 'Outlier', status: 'Active', stars: 4, tasksThisWeek: 18, monthlyEarnings: 312.5 },
  { id: 'MRC-1177', platform: 'Mercor', status: 'Active', stars: 5, tasksThisWeek: 22, monthlyEarnings: 428.0 },
  { id: 'MIC-3352', platform: 'Micro1', status: 'In verification', stars: 3, tasksThisWeek: 0, monthlyEarnings: 0 },
  { id: 'HSK-0908', platform: 'Handshake AI', status: 'Cooldown', stars: 3, tasksThisWeek: 5, monthlyEarnings: 61.4 },
  { id: 'OUT-5510', platform: 'Outlier', status: 'Needs attention', stars: 2, tasksThisWeek: 2, monthlyEarnings: 18.75 },
];

const PLATFORM_TINT: Record<string, string> = {
  Outlier: 'bg-chart-1/15 text-chart-1 border border-chart-1/30',
  Mercor: 'bg-chart-2/15 text-chart-2 border border-chart-2/30',
  Micro1: 'bg-chart-4/15 text-chart-4 border border-chart-4/30',
  'Handshake AI': 'bg-chart-5/15 text-chart-5 border border-chart-5/30',
};

const STATUS_TINT: Record<ManagedAccount['status'], string> = {
  Active: 'bg-primary/15 text-primary border border-primary/30',
  'In verification': 'bg-chart-4/15 text-chart-4 border border-chart-4/30',
  Cooldown: 'bg-secondary text-muted-foreground border border-border',
  'Needs attention': 'bg-destructive/15 text-destructive border border-destructive/30',
};

const BOT_EVALUATIONS = [
  { label: 'Task quality score', value: 92, note: 'Eval responses rated "excellent" by the QA bot' },
  { label: 'Speed & reliability', value: 84, note: 'Average acceptance-to-submit time: 41 minutes' },
  { label: 'Account hygiene', value: 97, note: 'No flags raised across managed logins' },
];

type EvalEntry = { when: string; account: string; verdict: string; detail: string; tone: 'ok' | 'warn' | 'idle' };

const EVAL_LOG: EvalEntry[] = [
  { when: '2h ago', account: 'MRC-1177', verdict: 'Passed', detail: '12/12 ratings accepted — quality 94', tone: 'ok' },
  { when: 'Yesterday', account: 'OUT-2841', verdict: 'Passed', detail: '6/6 ratings accepted — quality 91', tone: 'ok' },
  { when: '2 days ago', account: 'OUT-5510', verdict: 'Flagged', detail: '2 tasks revised — reply time over limit', tone: 'warn' },
  { when: '3 days ago', account: 'HSK-0908', verdict: 'Cooldown', detail: 'Temporary pause after idle period', tone: 'idle' },
  { when: '5 days ago', account: 'MIC-3352', verdict: 'Pending', detail: 'Awaiting first task batch after verification', tone: 'idle' },
];

type PayoutRow = { period: string; gross: number; yours: number; method: string };

const PAYOUT_HISTORY: PayoutRow[] = [
  { period: 'Week of Oct 20', gross: 152.4, yours: 137.16, method: 'Bitcoin (BTC)' },
  { period: 'Week of Oct 13', gross: 198.75, yours: 178.88, method: 'USDT' },
  { period: 'Week of Oct 6', gross: 164.0, yours: 147.6, method: 'Bitcoin (BTC)' },
  { period: 'Week of Sep 29', gross: 121.3, yours: 109.17, method: 'Bank transfer' },
];

const STAR_LADDER = [
  { stars: 1, accounts: '1 account', perk: 'Starter assignment' },
  { stars: 2, accounts: '2 accounts', perk: 'Second account after 20 rated tasks' },
  { stars: 3, accounts: '4 accounts', perk: 'Access to higher-paying task pools' },
  { stars: 4, accounts: '7 accounts', perk: 'Priority verification & weekly payouts' },
  { stars: 5, accounts: '12 accounts', perk: 'Team lead track — earn override on members you mentor' },
];

const TONE_CLASS: Record<'ok' | 'warn' | 'idle', string> = {
  ok: 'bg-primary/15 text-primary border border-primary/30',
  warn: 'bg-destructive/15 text-destructive border border-destructive/30',
  idle: 'bg-secondary text-muted-foreground border border-border',
};

function Stars({ count, size = 3.5 }: { count: number; size?: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${count} out of 5 stars`}>
      {Array.from({ length: 5 }, (_, i) => (
        <Star
          key={i}
          style={{ width: `${size * 4}px`, height: `${size * 4}px` }}
          className={i < count ? 'fill-chart-4 text-chart-4' : 'text-muted-foreground/40'}
        />
      ))}
    </span>
  );
}

const money = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return days === 1 ? 'Yesterday' : `${days} days ago`;
}

function normalizeStatus(value: string | null | undefined): ManagedAccount['status'] {
  const allowed: ManagedAccount['status'][] = ['Active', 'In verification', 'Cooldown', 'Needs attention'];
  return allowed.includes(value as ManagedAccount['status'])
    ? (value as ManagedAccount['status'])
    : 'In verification';
}

export default function TeamDashboard() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [liveAccounts, setLiveAccounts] = useState<ManagedAccount[]>([]);
  const [liveLog, setLiveLog] = useState<EvalEntry[]>([]);
  const [livePayouts, setLivePayouts] = useState<PayoutRow[]>([]);
  const [loadingData, setLoadingData] = useState(false);

  const [sampleAccounts, setSampleAccounts] = useState<ManagedAccount[]>(MANAGED_ACCOUNTS);
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [requestSent, setRequestSent] = useState(false);
  const [scores, setScores] = useState(BOT_EVALUATIONS);
  const [log, setLog] = useState<EvalEntry[]>(EVAL_LOG);
  const [evalRunning, setEvalRunning] = useState(false);

  const live = Boolean(session);

  const loadLiveData = useCallback(async () => {
    if (!supabase) return;
    setLoadingData(true);
    const [accRes, evalRes, payRes] = await Promise.all([
      supabase.from('managed_accounts').select('*').order('created_at', { ascending: true }),
      supabase.from('bot_evaluations').select('*').order('created_at', { ascending: false }).limit(20),
      supabase.from('task_payouts').select('*').order('created_at', { ascending: false }).limit(12),
    ]);

    setLiveAccounts(
      (accRes.data ?? []).map((r) => ({
        id: r.account_ref || String(r.id).slice(0, 8).toUpperCase(),
        dbId: r.id,
        platform: r.platform,
        status: normalizeStatus(r.status),
        stars: Number(r.stars ?? 0),
        tasksThisWeek: Number(r.tasks_this_week ?? 0),
        monthlyEarnings: Number(r.monthly_earnings ?? 0),
      })),
    );

    setLiveLog(
      (evalRes.data ?? []).map((r) => ({
        when: relativeTime(r.created_at),
        account: r.account_ref || String(r.account_id ?? '').slice(0, 8).toUpperCase() || '—',
        verdict: r.verdict,
        detail: r.detail ?? '',
        tone: r.verdict === 'Flagged' ? 'warn' : r.verdict === 'Passed' ? 'ok' : 'idle',
      })),
    );

    setLivePayouts(
      (payRes.data ?? []).map((r) => ({
        period: r.period,
        gross: Number(r.gross ?? 0),
        yours: Number(r.member_share ?? 0),
        method: r.method ?? '—',
      })),
    );

    setLoadingData(false);
  }, []);

  useEffect(() => {
    if (!supabase) {
      setAuthReady(true);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
      if (data.session) void loadLiveData();
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      if (next) void loadLiveData();
      else {
        setLiveAccounts([]);
        setLiveLog([]);
        setLivePayouts([]);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [loadLiveData]);

  const accounts = live ? liveAccounts : sampleAccounts;

  const totals = useMemo(() => {
    const gross = accounts.reduce((s, a) => s + a.monthlyEarnings, 0);
    return { gross, yours: gross * 0.9, platform: gross * 0.1 };
  }, [accounts]);

  const avgStars = accounts.length ? Math.round(accounts.reduce((s, a) => s + a.stars, 0) / accounts.length) : 0;
  const passRate = liveLog.length
    ? Math.round((liveLog.filter((l) => l.tone === 'ok').length / liveLog.length) * 100)
    : 0;

  const displayScores = live
    ? [
        { label: 'Task quality score', value: passRate, note: `${liveLog.length} bot evaluations logged` },
        { label: 'Speed & reliability', value: passRate, note: 'Share of evaluations the bot passed' },
        { label: 'Account hygiene', value: avgStars * 20, note: 'Derived from your account ratings' },
      ]
    : scores;

  const displayLog = live ? liveLog : log;
  const displayPayouts = live ? livePayouts : PAYOUT_HISTORY;

  const runAccountCheck = async (account: ManagedAccount) => {
    if (checkingId || live) return;
    setCheckingId(account.id);
    setSampleAccounts((prev) =>
      prev.map((item) => (item.id === account.id ? { ...item, status: 'In verification' } : item)),
    );
    window.setTimeout(() => {
      setSampleAccounts((prev) =>
        prev.map((item) =>
          item.id === account.id ? { ...item, status: 'Active', stars: Math.min(5, item.stars + 1) } : item,
        ),
      );
      setLog((prev) => [
        { when: 'just now', account: account.id, verdict: 'Passed', detail: 'Sample bot check completed', tone: 'ok' },
        ...prev,
      ]);
      setCheckingId(null);
    }, 1900);
  };

  const requestAccount = async () => {
    if (live) return;
    setRequestSent(true);
  };

  const runEvaluation = async () => {
    if (evalRunning || live) return;
    setEvalRunning(true);
    window.setTimeout(() => {
      setScores((prev) => prev.map((score) => ({ ...score, value: Math.min(99, score.value + 1) })));
      setLog((prev) =>
        [
          {
            when: 'just now',
            account: 'FLEET',
            verdict: 'Passed',
            detail: `Sample fleet sweep — ${sampleAccounts.length} accounts re-scored`,
            tone: 'ok' as const,
          },
          ...prev,
        ].slice(0, 6),
      );
      setEvalRunning(false);
    }, 2200);
  };

  if (!authReady) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header strip */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-card p-5">
        <div>
          <p className="text-sm text-muted-foreground">{live ? 'Signed in as' : 'Sample member'}</p>
          <p className="text-lg font-semibold">
            {live ? (session?.user.user_metadata?.full_name || session?.user.email) : 'Jordan M. · Member since Aug 2025'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <BadgeCheck className="h-5 w-5 text-primary" />
          <div>
            <p className="text-sm font-medium">{live ? 'Member account' : 'Sample profile'}</p>
            <div className="mt-1 flex items-center gap-2">
              <Stars count={avgStars} size={3} />
              <span className="text-xs text-muted-foreground">avg. rating across accounts</span>
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={requestAccount}
          disabled={live || requestSent}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-70"
        >
          {live ? (
            <>
              <Plus className="h-4 w-4" /> Assignment unavailable
            </>
          ) : requestSent ? (
            <>
              <Check className="h-4 w-4" /> Request sent — bot screening
            </>
          ) : (
            <>
              <Plus className="h-4 w-4" /> Request new account
            </>
          )}
        </button>
      </div>

      {/* Bots online strip */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-primary/25 bg-primary/5 px-5 py-3 text-sm">
        <span className="inline-flex items-center gap-2 font-medium text-primary">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/60" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
          </span>
          {live ? 'Read-only dashboard' : 'Sample dashboard'}
        </span>
        <span className="text-muted-foreground">{live ? 'Account assignment, bot checks, and payouts are not connected.' : 'Sample records and simulated actions'}</span>
        <span className="ml-auto font-mono text-xs text-muted-foreground">
          {live ? (loadingData ? 'syncing…' : 'live records') : 'simulation'}
        </span>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="accounts" className="gap-4">
        <TabsList className="h-auto w-full flex-wrap justify-start gap-1 p-1">
          <TabsTrigger value="accounts" className="gap-2 px-4 py-2">
            <KeyRound className="h-4 w-4" /> Accounts
          </TabsTrigger>
          <TabsTrigger value="earnings" className="gap-2 px-4 py-2">
            <Coins className="h-4 w-4" /> Earnings
          </TabsTrigger>
          <TabsTrigger value="evaluations" className="gap-2 px-4 py-2">
            <Bot className="h-4 w-4" /> Bot evaluations
          </TabsTrigger>
          <TabsTrigger value="ladder" className="gap-2 px-4 py-2">
            <ShieldCheck className="h-4 w-4" /> Star ladder
          </TabsTrigger>
        </TabsList>

        {/* Accounts tab */}
        <TabsContent value="accounts">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <KeyRound className="h-5 w-5 text-primary" /> Accounts assigned to you ({accounts.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {live && accounts.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border bg-secondary/30 p-6 text-center">
                  <Bot className="mx-auto h-6 w-6 text-primary" />
                  <p className="mt-2 text-sm font-medium">No accounts yet</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {live ? 'Account assignments are managed by the team and are not connected yet.' : 'Request an account to preview the sample workflow.'}
                  </p>
                </div>
              ) : (
                <>
                  <table className="w-full min-w-[720px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="pb-3 pr-4 font-medium">Account</th>
                        <th className="pb-3 pr-4 font-medium">Platform</th>
                        <th className="pb-3 pr-4 font-medium">Status</th>
                        <th className="pb-3 pr-4 font-medium">Rating</th>
                        <th className="pb-3 pr-4 font-medium">Tasks / week</th>
                        <th className="pb-3 pr-4 text-right font-medium">This month</th>
                        <th className="pb-3 text-right font-medium">Bot</th>
                      </tr>
                    </thead>
                    <tbody>
                      {accounts.map((a) => (
                        <tr key={a.dbId ?? a.id} className="border-b border-border/50 last:border-0">
                          <td className="py-3 pr-4 font-mono text-xs text-muted-foreground">{a.id}</td>
                          <td className="py-3 pr-4">
                            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${PLATFORM_TINT[a.platform] ?? 'bg-secondary text-muted-foreground'}`}>
                              {a.platform}
                            </span>
                          </td>
                          <td className="py-3 pr-4">
                            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_TINT[a.status]}`}>
                              {a.status}
                            </span>
                          </td>
                          <td className="py-3 pr-4"><Stars count={a.stars} size={3} /></td>
                          <td className="py-3 pr-4">{a.tasksThisWeek}</td>
                          <td className="py-3 pr-4 text-right font-semibold">{money(a.monthlyEarnings)}</td>
                          <td className="py-3 text-right">
                            <button
                              type="button"
                              onClick={() => runAccountCheck(a)}
                              disabled={live || checkingId !== null}
                              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary px-2.5 py-1.5 text-xs font-semibold hover:bg-secondary/70 disabled:opacity-50"
                            >
                              {checkingId === a.id ? (
                                <>
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking…
                                </>
                              ) : (
                                <>
                                  <Bot className="h-3.5 w-3.5" /> {live ? 'Unavailable' : 'Run check'}
                                </>
                              )}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="mt-4 text-xs text-muted-foreground">
                    {live
                      ? 'Live account data is read-only. Bot checks are not connected yet.'
                      : 'Sample mode only: run a simulated bot check on any sample account.'}
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Earnings tab */}
        <TabsContent value="earnings">
          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Coins className="h-5 w-5 text-primary" /> This month's task earnings
                </CardTitle>
                <Badge variant="secondary" className="gap-1">
                  <TrendingUp className="h-3.5 w-3.5" /> 90/10 split
                </Badge>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="rounded-lg border border-border bg-secondary/50 p-4">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Gross task earnings</p>
                    <p className="mt-1 text-2xl font-bold">{money(totals.gross)}</p>
                  </div>
                  <div className="rounded-lg border border-primary/30 bg-primary/10 p-4">
                    <p className="text-xs uppercase tracking-wide text-primary/80">You keep (90%)</p>
                    <p className="mt-1 text-2xl font-bold text-primary">{money(totals.yours)}</p>
                  </div>
                  <div className="rounded-lg border border-border bg-secondary/50 p-4">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Platform fee (10%)</p>
                    <p className="mt-1 text-2xl font-bold">{money(totals.platform)}</p>
                  </div>
                </div>
                <div className="mt-4">
                  <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                    <span>Your share</span>
                    <span>Platform share</span>
                  </div>
                  <div className="flex h-3 w-full overflow-hidden rounded-full">
                    <div className="h-full bg-primary" style={{ width: '90%' }} />
                    <div className="h-full bg-chart-1/60" style={{ width: '10%' }} />
                  </div>
                </div>

                <h3 className="mt-6 text-sm font-semibold">Payout history</h3>
                {displayPayouts.length === 0 ? (
                  <p className="mt-2 rounded-lg border border-dashed border-border bg-secondary/30 p-4 text-xs text-muted-foreground">
                    No payouts yet. Your first weekly settlement appears here once tasks are completed and the payout rails
                    are switched on.
                  </p>
                ) : (
                  <div className="mt-2 overflow-x-auto">
                    <table className="w-full min-w-[520px] text-left text-sm">
                      <thead>
                        <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                          <th className="pb-2 pr-4 font-medium">Period</th>
                          <th className="pb-2 pr-4 font-medium">Gross</th>
                          <th className="pb-2 pr-4 font-medium">You received</th>
                          <th className="pb-2 font-medium">Sent to</th>
                        </tr>
                      </thead>
                      <tbody>
                        {displayPayouts.map((p) => (
                          <tr key={p.period} className="border-b border-border/50 last:border-0">
                            <td className="py-2.5 pr-4">{p.period}</td>
                            <td className="py-2.5 pr-4 text-muted-foreground">{money(p.gross)}</td>
                            <td className="py-2.5 pr-4 font-semibold text-primary">{money(p.yours)}</td>
                            <td className="py-2.5">
                              <span className="rounded-full border border-border bg-secondary px-2.5 py-1 text-xs">{p.method}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Wallet className="h-5 w-5 text-primary" /> Payout settings
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <div className="rounded-lg border border-border bg-secondary/40 p-3">
                  <p className="flex items-center gap-2 font-medium"><Landmark className="h-4 w-4 text-primary" /> Settlement currency</p>
                  <p className="mt-1 text-muted-foreground">{live ? 'Not configured' : 'Bitcoin (BTC) — sample display.'}</p>
                </div>
                <div className="rounded-lg border border-border bg-secondary/40 p-3">
                  <p className="font-medium">Frequency</p>
                  <p className="mt-1 text-muted-foreground">{live ? 'Payout schedule is not configured.' : 'Sample schedule: Fridays at 3★ and above.'}</p>
                </div>
                <div className="rounded-lg border border-border bg-secondary/40 p-3">
                  <p className="font-medium">Linked wallet</p>
                  <p className="mt-1 font-mono text-xs text-muted-foreground">{live ? 'Not configured' : 'Sample wallet (not verified)'}</p>
                </div>
                <div className="rounded-lg border border-dashed border-border bg-background p-3 text-xs text-muted-foreground">
                  {live
                    ? 'Payout processing and automated settlement are not connected. Records shown here are read-only.'
                    : 'Sample dashboard data only; no payments or payouts are processed.'}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Bot evaluations tab */}
        <TabsContent value="evaluations">
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Bot className="h-5 w-5 text-primary" /> Bot work evaluation
                </CardTitle>
                <button
                  type="button"
                  onClick={runEvaluation}
                  disabled={live || evalRunning}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary px-3 py-1.5 text-xs font-semibold hover:bg-secondary/70 disabled:opacity-60"
                >
                  {evalRunning ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Sweeping fleet…
                    </>
                  ) : (
                    <>
                      <RefreshCw className="h-3.5 w-3.5" /> {live ? 'Unavailable' : 'Run evaluation'}
                    </>
                  )}
                </button>
              </CardHeader>
              <CardContent className="space-y-4">
                {displayScores.map((e) => (
                  <div key={e.label}>
                    <div className="flex justify-between text-sm">
                      <span className="font-medium">{e.label}</span>
                      <span className="font-semibold text-primary">{e.value}</span>
                    </div>
                    <Progress value={e.value} className="mt-1.5 h-2" />
                    <p className="mt-1 text-xs text-muted-foreground">{e.note}</p>
                  </div>
                ))}
                <div className="rounded-lg border border-border bg-secondary/50 p-3 text-xs text-muted-foreground">
                  Your bot score decides how many accounts you're assigned next cycle. Keep quality above 85 to move up.
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Recent evaluations</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {displayLog.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border bg-secondary/30 p-4 text-xs text-muted-foreground">
                    No evaluations yet. Run a check on an account and the bot's verdicts will be logged here.
                  </p>
                ) : (
                  displayLog.map((e, i) => (
                    <div key={`${e.account}-${e.when}-${i}`} className="rounded-lg border border-border bg-secondary/30 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-mono text-xs text-muted-foreground">{e.account}</span>
                        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${TONE_CLASS[e.tone]}`}>{e.verdict}</span>
                      </div>
                      <p className="mt-1.5 text-sm">{e.detail}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{e.when}</p>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Star ladder tab */}
        <TabsContent value="ladder">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldCheck className="h-5 w-5 text-primary" /> Star ladder — earn more accounts over time
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="rounded-lg border border-primary/30 bg-primary/10 p-4 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium">Your current rating: {avgStars}★</span>
                  <span className="text-primary">Next: 5★ unlocks 12 accounts + team-lead track</span>
                </div>
                <Progress value={(avgStars / 5) * 100} className="mt-2 h-2" />
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                {STAR_LADDER.map((tier) => (
                  <div
                    key={tier.stars}
                    className={`rounded-lg border p-4 ${
                      tier.stars === avgStars ? 'border-primary/50 bg-primary/10' : 'border-border bg-secondary/40'
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <Stars count={tier.stars} size={3} />
                      <span className="text-sm font-semibold">{tier.stars}★</span>
                    </div>
                    <p className="mt-2 text-sm font-medium">{tier.accounts}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{tier.perk}</p>
                    {tier.stars === avgStars && <p className="mt-2 text-xs font-semibold text-primary">You are here</p>}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
