import { useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import type { OperationName } from '@infra/core/api';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { OPERATION_LABELS } from '@/lib/labels';
import { useSession } from '@/lib/session';

export function useRunOperation() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: ({ name, args }: { name: OperationName; args?: Record<string, unknown> }) => api.runOperation(name, args),
    onSuccess: (job) => {
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
      queryClient.invalidateQueries({ queryKey: ['status'] });
      toast.success(`${OPERATION_LABELS[job.operation].title} elindult`);
      navigate(`/jobs/${job.id}`);
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

interface ConfirmProps {
  name: OperationName;
  destructive: boolean;
  disabled?: boolean;
  args?: Record<string, unknown>;
  /** Render prop so callers can use their own button. */
  children: (open: () => void) => ReactNode;
}

/** Asks for confirmation (typing the domain for destructive operations) before starting an operation. */
export function ConfirmOperation({ name, destructive, args, children }: ConfirmProps) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const { session } = useSession();
  const run = useRunOperation();
  const label = OPERATION_LABELS[name];
  const expected = session?.domain ?? '';
  const confirmed = !destructive || typed === expected;

  return (
    <>
      {children(() => {
        setTyped('');
        setOpen(true);
      })}
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{label.title}?</AlertDialogTitle>
            <AlertDialogDescription>{label.description}</AlertDialogDescription>
          </AlertDialogHeader>
          {destructive && (
            <div className="grid gap-2">
              <Label htmlFor="confirm-domain">
                A megerősítéshez írd be a domaint: <span className="font-mono font-semibold">{expected}</span>
              </Label>
              <Input id="confirm-domain" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Mégse</AlertDialogCancel>
            <AlertDialogAction
              variant={destructive ? 'destructive' : 'default'}
              disabled={!confirmed || run.isPending}
              onClick={() => run.mutate({ name, args })}
            >
              Futtatás
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
