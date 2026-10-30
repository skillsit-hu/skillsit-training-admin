import { CheckCircle2, CircleSlash, Loader2, XCircle } from 'lucide-react';
import type { JobStatus } from '@infra/core/api';
import { Badge } from '@/components/ui/badge';
import { STATUS_LABELS } from '@/lib/labels';

export function JobStatusBadge({ status }: { status: JobStatus }) {
  const icon = {
    running: <Loader2 className="animate-spin" />,
    succeeded: <CheckCircle2 />,
    failed: <XCircle />,
    cancelled: <CircleSlash />,
  }[status];
  return (
    <Badge variant={status === 'failed' ? 'destructive' : status === 'succeeded' ? 'secondary' : 'outline'}>
      {icon}
      {STATUS_LABELS[status]}
    </Badge>
  );
}
