import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { JobEvent, JobSummary, LogLine } from '@infra/core/api';

/** Follows a job over SSE: replays its log, then appends new lines until it finishes. */
export function useJobStream(jobId: string | null) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [job, setJob] = useState<JobSummary | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    setLines([]);
    setJob(null);
    if (!jobId) return;

    let lastSeq = -1;
    let source: EventSource | null = null;
    let closed = false;

    const connect = () => {
      source = new EventSource(`/api/jobs/${jobId}/events?after=${lastSeq}`);
      source.onmessage = (message) => {
        const event = JSON.parse(message.data) as JobEvent;
        if (event.type === 'line') {
          lastSeq = event.line.seq;
          setLines((prev) => [...prev, event.line]);
        } else {
          setJob(event.job);
          if (event.job.status !== 'running') {
            closed = true;
            source?.close();
            queryClient.invalidateQueries({ queryKey: ['jobs'] });
            queryClient.invalidateQueries({ queryKey: ['status'] });
          }
        }
      };
      source.onerror = () => {
        source?.close();
        if (!closed) setTimeout(() => !closed && connect(), 2000);
      };
    };
    connect();

    return () => {
      closed = true;
      source?.close();
    };
  }, [jobId, queryClient]);

  return { lines, job };
}
