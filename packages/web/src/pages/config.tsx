import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff, KeyRound, Pencil, Plus, Save, Trash2, UserPlus, X } from 'lucide-react';
import { toast } from 'sonner';
import { competitorSchema, configSchema, type Competitor, type MainConfig } from '@infra/core/schema';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ConfirmOperation } from '@/components/run-operation';
import { api, HttpError } from '@/lib/api';

type Issues = Record<string, string>;

function issuesOf(error: { issues: { path: (string | number)[]; message: string }[] }): Issues {
  return Object.fromEntries(error.issues.map((i) => [i.path.join('.'), i.message]));
}

function randomPassword(length = 16): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

function Field({ id, label, error, children }: { id: string; label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function PasswordInput({ id, value, onChange, invalid }: { id: string; value: string; onChange: (v: string) => void; invalid?: boolean }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="flex gap-2">
      <Input id={id} type={visible ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={invalid} className="font-mono" />
      <Button type="button" variant="outline" size="icon" onClick={() => setVisible((v) => !v)} aria-label="Jelszó megjelenítése">
        {visible ? <EyeOff /> : <Eye />}
      </Button>
    </div>
  );
}

interface CompetitorDialogProps {
  open: boolean;
  initial: Competitor | null;
  existing: string[];
  onClose: () => void;
  onSave: (c: Competitor) => void;
}

function CompetitorDialog({ open, initial, existing, onClose, onSave }: CompetitorDialogProps) {
  const [draft, setDraft] = useState<Competitor>({ name: '', username: '', password: '', subdomain: '' });
  const [issues, setIssues] = useState<Issues>({});
  const [subdomainTouched, setSubdomainTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDraft(initial ?? { name: '', username: '', password: randomPassword(), subdomain: '' });
    setSubdomainTouched(!!initial);
    setIssues({});
  }, [open, initial]);

  const set = (patch: Partial<Competitor>) => setDraft((d) => ({ ...d, ...patch }));

  const save = () => {
    const candidate = { ...draft, name: draft.name?.trim() || undefined };
    const parsed = competitorSchema.safeParse(candidate);
    const next = parsed.success ? {} : issuesOf(parsed.error);
    if (existing.includes(candidate.username) && candidate.username !== initial?.username) next.username = 'Már létezik ilyen felhasználó';
    setIssues(next);
    if (Object.keys(next).length === 0 && parsed.success) onSave(parsed.data);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{initial ? 'Versenyző szerkesztése' : 'Új versenyző'}</DialogTitle>
          <DialogDescription>A változás a Konfiguráció mentésekor kerül a main-config.json-ba.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Field id="c-name" label="Név (opcionális)">
            <Input id="c-name" value={draft.name ?? ''} onChange={(e) => set({ name: e.target.value })} />
          </Field>
          <Field id="c-username" label="Felhasználónév" error={issues.username}>
            <Input
              id="c-username"
              value={draft.username}
              aria-invalid={!!issues.username}
              onChange={(e) => {
                const username = e.target.value.trim();
                set(subdomainTouched ? { username } : { username, subdomain: username.toLowerCase().replace(/[^a-z0-9-]/g, '') });
              }}
            />
          </Field>
          <Field id="c-subdomain" label="Aldomain" error={issues.subdomain}>
            <Input
              id="c-subdomain"
              value={draft.subdomain}
              aria-invalid={!!issues.subdomain}
              onChange={(e) => {
                setSubdomainTouched(true);
                set({ subdomain: e.target.value.trim() });
              }}
            />
          </Field>
          <Field id="c-password" label="Jelszó" error={issues.password}>
            <div className="flex gap-2">
              <div className="flex-1">
                <PasswordInput id="c-password" value={draft.password} onChange={(password) => set({ password })} invalid={!!issues.password} />
              </div>
              <Button type="button" variant="outline" size="icon" onClick={() => set({ password: randomPassword() })} aria-label="Jelszó generálása">
                <KeyRound />
              </Button>
            </div>
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Mégse
          </Button>
          <Button onClick={save}>{initial ? 'Módosítás' : 'Hozzáadás'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateInEnvButton({ competitor, dirty, compact }: { competitor: Competitor; dirty: boolean; compact?: boolean }) {
  const args = { username: competitor.username, password: competitor.password, subdomain: competitor.subdomain, name: competitor.name };
  return (
    <ConfirmOperation name="createUser" destructive={false} args={args}>
      {(open) => (
        <Button
          variant="outline"
          size={compact ? 'icon-sm' : 'sm'}
          title="Létrehozás a futó környezetben"
          onClick={() => (dirty ? toast.warning('Előbb mentsd a konfigurációt.') : open())}
        >
          <UserPlus />
          {!compact && 'Létrehozás a környezetben'}
        </Button>
      )}
    </ConfirmOperation>
  );
}

export function ConfigPage() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['config'], queryFn: api.config });
  const [draft, setDraft] = useState<MainConfig | null>(null);
  const [issues, setIssues] = useState<Issues>({});
  const [newModule, setNewModule] = useState('');
  const [dialog, setDialog] = useState<{ open: boolean; index: number | null }>({ open: false, index: null });

  useEffect(() => {
    if (query.data && !draft) setDraft(query.data);
  }, [query.data, draft]);

  const dirty = useMemo(() => !!draft && !!query.data && JSON.stringify(draft) !== JSON.stringify(query.data), [draft, query.data]);

  const save = useMutation({
    mutationFn: (config: MainConfig) => api.saveConfig(config),
    onSuccess: (saved) => {
      queryClient.setQueryData(['config'], saved);
      setDraft(saved);
      setIssues({});
      toast.success('Konfiguráció mentve');
    },
    onError: (err: Error) => {
      if (err instanceof HttpError && err.body.issues) setIssues(issuesOf({ issues: err.body.issues }));
      toast.error(err.message);
    },
  });

  if (query.isError) return <p className="text-sm text-destructive">{(query.error as Error).message}</p>;
  if (!draft) return <p className="text-sm text-muted-foreground">Betöltés…</p>;

  const set = (patch: Partial<MainConfig>) => setDraft({ ...draft, ...patch });
  const https = draft.enableHttps === true || draft.enableHttps === 'true';

  const submit = () => {
    const parsed = configSchema.safeParse(draft);
    if (!parsed.success) {
      setIssues(issuesOf(parsed.error));
      toast.error('A konfiguráció hibás, nézd át a jelölt mezőket.');
      return;
    }
    save.mutate(parsed.data);
  };

  const addModule = () => {
    const value = newModule.trim();
    if (!value) return;
    if (draft.modules.includes(value)) return toast.error('Ez a modul már szerepel.');
    set({ modules: [...draft.modules, value] });
    setNewModule('');
  };

  const editing = dialog.index === null ? null : draft.competitors[dialog.index];

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Konfiguráció</h1>
          <p className="text-sm text-muted-foreground">config/main-config.json</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Általános</CardTitle>
          <CardDescription>A root felhasználó a Gitea és a MySQL admin, egyben az admin felület belépési adata is.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <Field id="domain" label="Domain" error={issues.domain}>
            <Input id="domain" value={draft.domain} aria-invalid={!!issues.domain} onChange={(e) => set({ domain: e.target.value.trim() })} />
          </Field>
          <div className="flex items-center justify-between gap-3 rounded-lg border p-3 md:self-end">
            <div>
              <Label htmlFor="https">HTTPS</Label>
              <p className="text-xs text-muted-foreground">Traefik websecure entrypoint és TLS.</p>
            </div>
            <Switch id="https" checked={https} onCheckedChange={(checked) => set({ enableHttps: checked })} />
          </div>
          <Field id="username" label="Root felhasználónév" error={issues.username}>
            <Input id="username" value={draft.username} aria-invalid={!!issues.username} onChange={(e) => set({ username: e.target.value.trim() })} />
          </Field>
          <Field id="password" label="Root jelszó" error={issues.password}>
            <PasswordInput id="password" value={draft.password} onChange={(password) => set({ password })} invalid={!!issues.password} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Modulok</CardTitle>
          <CardDescription>
            A versenyzői oldalak címe: <span className="font-mono">&lt;aldomain&gt;-&lt;modul&gt;.{draft.domain}</span>
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="flex flex-wrap gap-2">
            {draft.modules.length === 0 && <span className="text-sm text-muted-foreground">Nincs modul.</span>}
            {draft.modules.map((m) => (
              <Badge key={m} variant="secondary" className="h-7 gap-1 pr-1 font-mono">
                {m}
                <button type="button" aria-label={`${m} törlése`} className="rounded p-0.5 hover:bg-background" onClick={() => set({ modules: draft.modules.filter((x) => x !== m) })}>
                  <X className="size-3" />
                </button>
              </Badge>
            ))}
          </div>
          <div className="flex max-w-md gap-2">
            <Input
              placeholder="pl. module_a"
              value={newModule}
              onChange={(e) => setNewModule(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addModule();
                }
              }}
            />
            <Button variant="outline" onClick={addModule}>
              <Plus />
              Hozzáadás
            </Button>
          </div>
          {issues.modules && <p className="text-xs text-destructive">{issues.modules}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Versenyzők ({draft.competitors.length})</CardTitle>
          <CardDescription>Inicializáláskor mind létrejön. Futó környezetbe egyenként a „Létrehozás a környezetben” gombbal vehetsz fel újat.</CardDescription>
          <CardAction>
            <Button size="sm" onClick={() => setDialog({ open: true, index: null })}>
              <Plus />
              Új versenyző
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {draft.competitors.length === 0 && <p className="text-sm text-muted-foreground">Nincs versenyző.</p>}

          {/* Mobile: card list */}
          <div className="grid gap-2 md:hidden">
            {draft.competitors.map((c, i) => (
              <div key={`${c.username}-${i}`} className="flex items-center gap-2 rounded-lg border p-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{c.name || c.username}</div>
                  <div className="truncate font-mono text-xs text-muted-foreground">
                    {c.username} · {c.subdomain}
                  </div>
                  {Object.keys(issues).some((k) => k.startsWith(`competitors.${i}.`)) && <div className="text-xs text-destructive">Hibás adatok</div>}
                </div>
                <CreateInEnvButton competitor={c} dirty={dirty} compact />
                <Button variant="ghost" size="icon-sm" aria-label="Szerkesztés" onClick={() => setDialog({ open: true, index: i })}>
                  <Pencil />
                </Button>
                <Button variant="ghost" size="icon-sm" aria-label="Törlés" onClick={() => set({ competitors: draft.competitors.filter((_, j) => j !== i) })}>
                  <Trash2 />
                </Button>
              </div>
            ))}
          </div>

          {/* Desktop: table */}
          {draft.competitors.length > 0 && (
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Név</TableHead>
                    <TableHead>Felhasználónév</TableHead>
                    <TableHead>Aldomain</TableHead>
                    <TableHead className="text-right">Műveletek</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {draft.competitors.map((c, i) => (
                    <TableRow key={`${c.username}-${i}`}>
                      <TableCell>{c.name || <span className="text-muted-foreground">–</span>}</TableCell>
                      <TableCell className="font-mono">
                        {c.username}
                        {Object.keys(issues).some((k) => k.startsWith(`competitors.${i}.`)) && <span className="ml-2 text-xs text-destructive">hibás</span>}
                      </TableCell>
                      <TableCell className="font-mono">{c.subdomain}</TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <CreateInEnvButton competitor={c} dirty={dirty} />
                          <Button variant="ghost" size="icon-sm" aria-label="Szerkesztés" onClick={() => setDialog({ open: true, index: i })}>
                            <Pencil />
                          </Button>
                          <Button variant="ghost" size="icon-sm" aria-label="Törlés" onClick={() => set({ competitors: draft.competitors.filter((_, j) => j !== i) })}>
                            <Trash2 />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <CompetitorDialog
        open={dialog.open}
        initial={editing}
        existing={draft.competitors.map((c) => c.username)}
        onClose={() => setDialog({ open: false, index: null })}
        onSave={(competitor) => {
          const competitors = [...draft.competitors];
          if (dialog.index === null) competitors.push(competitor);
          else competitors[dialog.index] = competitor;
          set({ competitors });
          setDialog({ open: false, index: null });
        }}
      />

      {/* Sticky save bar */}
      <div className="sticky bottom-0 z-20 -mx-4 -mb-4 border-t bg-background/95 px-4 py-3 backdrop-blur md:-mx-6 md:-mb-6 md:px-6">
        <div className="flex items-center justify-end gap-2">
          {dirty && <span className="mr-auto text-sm text-muted-foreground">Nem mentett változások</span>}
          <Button variant="outline" disabled={!dirty || save.isPending} onClick={() => query.data && (setDraft(query.data), setIssues({}))}>
            Elvetés
          </Button>
          <Button disabled={!dirty || save.isPending} onClick={submit}>
            <Save />
            Mentés
          </Button>
        </div>
      </div>
    </div>
  );
}
