import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Server } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';

export function LoginPage() {
  const queryClient = useQueryClient();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      queryClient.setQueryData(['session'], await api.login(username, password));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Server className="size-5" />
          </div>
          <CardTitle>Infra Admin</CardTitle>
          <CardDescription>Jelentkezz be a main-config.json root felhasználójával.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="username">Felhasználónév</Label>
              <Input id="username" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">Jelszó</Label>
              <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={pending}>
              Bejelentkezés
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
