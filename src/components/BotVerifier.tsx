import { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, Check, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import { Progress } from '@/components/ui/progress';

export type BotCheck = {
  label: string;
  detail: string;
};

type Props = {
  checks: BotCheck[];
  title?: string;
  subtitle?: string;
  buttonLabel?: string;
  autoStart?: boolean;
  /** Scope the auto-start event, e.g. "sell" -> listens for "aielevate:run-bots:sell". */
  event?: string;
  resultTitle?: string;
  resultBody?: string;
};

export default function BotVerifier({
  checks,
  title = 'Verification bot',
  subtitle = 'Isolated sandbox — no human ever opens your credentials.',
  buttonLabel = 'Run bot verification',
  autoStart = false,
  event,
  resultTitle = 'Verification complete',
  resultBody,
}: Props) {
  const [running, setRunning] = useState(false);
  const [doneCount, setDoneCount] = useState(0);
  const [finished, setFinished] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false);

  const run = useCallback(() => {
    setRunning(true);
    setDoneCount(0);
    setFinished(false);
    checks.forEach((_, i) => {
      window.setTimeout(() => setDoneCount(i + 1), 620 * (i + 1));
    });
    window.setTimeout(
      () => {
        setRunning(false);
        setFinished(true);
      },
      620 * checks.length + 450,
    );
  }, [checks]);

  useEffect(() => {
    if (!autoStart) return;
    const eventName = event ? `aielevate:run-bots:${event}` : 'aielevate:run-bots';
    const arm = () => {
      if (startedRef.current) return;
      startedRef.current = true;
      run();
    };
    window.addEventListener(eventName, arm);

    const el = containerRef.current;
    let observer: IntersectionObserver | undefined;
    if (el && typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              arm();
              observer?.disconnect();
            }
          });
        },
        { threshold: 0.2 },
      );
      observer.observe(el);
    }

    return () => {
      window.removeEventListener(eventName, arm);
      observer?.disconnect();
    };
  }, [autoStart, event, run]);

  const progress = checks.length ? Math.round((doneCount / checks.length) * 100) : 0;

  return (
    <div ref={containerRef} className="overflow-hidden rounded-xl border border-border bg-background/60">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-secondary/40 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <Bot className="h-4 w-4" />
            <span className="absolute -right-0.5 -top-0.5 h-2 w-2 animate-pulse rounded-full bg-primary" />
          </span>
          <div>
            <p className="text-sm font-semibold">{title}</p>
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          </div>
        </div>
        {finished && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
            <ShieldCheck className="h-3.5 w-3.5" /> Verified
          </span>
        )}
      </div>

      <div className="p-4">
        <div className="flex items-center gap-3">
          <Progress value={progress} className="h-1.5 flex-1" />
          <span className="font-mono text-xs text-muted-foreground">{progress}%</span>
        </div>

        <ol className="mt-4 space-y-2.5 font-mono text-xs">
          {checks.map((check, i) => {
            const state = i < doneCount ? 'done' : i === doneCount && running ? 'active' : 'pending';
            return (
              <li key={check.label} className="flex items-start gap-3">
                <span
                  className={
                    state === 'done'
                      ? 'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground'
                      : state === 'active'
                        ? 'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/20 text-primary'
                        : 'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground'
                  }
                >
                  {state === 'done' ? (
                    <Check className="h-3 w-3" />
                  ) : state === 'active' ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <span className="h-1.5 w-1.5 rounded-full bg-current" />
                  )}
                </span>
                <span className={state === 'pending' ? 'text-muted-foreground' : 'text-foreground'}>
                  <span className="font-semibold">{check.label}</span>
                  <span className="text-muted-foreground"> — {check.detail}</span>
                </span>
              </li>
            );
          })}
        </ol>

        {finished ? (
          <div className="mt-4 rounded-lg border border-primary/30 bg-primary/10 p-3">
            <p className="flex items-center gap-2 text-sm font-semibold text-primary">
              <Check className="h-4 w-4" /> {resultTitle}
            </p>
            {resultBody && <p className="mt-1 text-xs text-muted-foreground">{resultBody}</p>}
            <button
              type="button"
              onClick={run}
              className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary px-3 py-1.5 text-xs font-semibold hover:bg-secondary/70"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Run again
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={run}
            disabled={running}
            className="mt-4 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {running ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Bot running…
              </>
            ) : (
              <>
                <Bot className="h-4 w-4" /> {buttonLabel}
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
