import { useEffect, useRef, useState } from 'react';
import type { LogLine } from '@infra/core/api';
import { cn } from '@/lib/utils';

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[A-Za-z]/g;

export function JobLog({ lines, className }: { lines: LogLine[]; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);

  useEffect(() => {
    if (follow && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [lines, follow]);

  return (
    <div
      ref={ref}
      onScroll={(e) => {
        const el = e.currentTarget;
        setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
      }}
      className={cn(
        'h-[50vh] overflow-auto rounded-lg border bg-zinc-950 p-3 font-mono text-xs leading-relaxed text-zinc-100 md:h-[60vh]',
        className,
      )}
    >
      {lines.length === 0 && <div className="text-zinc-500">Nincs még kimenet…</div>}
      {lines.map((line) => (
        <div key={line.seq} className={cn('break-all whitespace-pre-wrap', line.stream === 'error' && 'text-red-400')}>
          {line.text.replace(ANSI, '')}
        </div>
      ))}
    </div>
  );
}
