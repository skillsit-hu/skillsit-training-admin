import type { JobStatus, OperationName } from '@infra/core/api';

export const OPERATION_LABELS: Record<OperationName, { title: string; description: string }> = {
  init: {
    title: 'Inicializálás',
    description: 'Elindít minden stacket, létrehozza a Gitea felhasználókat, szervezeteket és framework sablonokat a konfiguráció alapján. Ha korábban már futott, előbb Tisztítás kell.',
  },
  start: { title: 'Indítás', description: 'Újraindítja a leállított konténereket.' },
  stop: { title: 'Leállítás', description: 'Leállítja a konténereket (a Traefik és az admin felület kivételével), de nem törli őket és az adatokat.' },
  clean: {
    title: 'Tisztítás',
    description: 'Törli az összes konténert (a Traefik és az admin felület kivételével), az adat volume-okat (adatbázisok, runnerek, csomag-cache), a versenyzői image-eket és a framework klónokat.',
  },
  createUser: {
    title: 'Versenyző létrehozása',
    description: 'Hozzáadja a versenyzőt a futó környezethez (Gitea user, csapat, secretek, MySQL user) és a konfigurációhoz.',
  },
  disableCompetitorLogins: {
    title: 'Versenyzői loginok tiltása',
    description: 'Letiltja az összes versenyző Gitea fiókját (pl. a verseny végén).',
  },
  setupOrgs: { title: 'Alap szervezetek', description: 'Létrehozza az images, frameworks és competitionc Gitea szervezeteket.' },
};

export const STATUS_LABELS: Record<JobStatus, string> = {
  running: 'Fut',
  succeeded: 'Sikeres',
  failed: 'Hiba',
  cancelled: 'Megszakítva',
};

export function formatTime(iso?: string): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('hu-HU', { dateStyle: 'short', timeStyle: 'medium' });
}

export function duration(from: string, to?: string): string {
  const ms = (to ? new Date(to).getTime() : Date.now()) - new Date(from).getTime();
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s} mp` : `${Math.floor(s / 60)} p ${s % 60} mp`;
}
