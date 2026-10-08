# Vendia

Plataforma de **landing pages + pedidos contraentrega (COD) para Perú**, enfocada en vendedores que usan Meta Ads.
Mide lo que importa: **CPA por pedido entregado y utilidad real**, no formularios.

- Plan y arquitectura: [docs/PLAN.md](docs/PLAN.md)
- Reporte de la Fase 1: [docs/FASE-1.md](docs/FASE-1.md)

## Stack

Next.js 16 · TypeScript · Tailwind · shadcn/ui · Supabase (Postgres + Auth + Storage, RLS) · Vercel

## Desarrollo local

```bash
npm install
cp .env.example .env.local   # completa las claves de Supabase
npm run dev                  # http://localhost:3000
```

| Comando | Qué hace |
|---|---|
| `npm test` | Tests unitarios |
| `npm run test:db` | Tests de integración contra Supabase (RLS, pedidos, estados) |
| `npm run lint` / `npm run typecheck` | Calidad de código |
| `npm run build` | Build de producción |
| `npm run ubigeo:build` | Regenera el seed de ubigeo desde `data/ubigeo/` |
| `npm run db:migrate` | Aplica `supabase/migrations` (requiere `SUPABASE_DB_URL`) |
| `npx tsx scripts/create-test-user.ts` | Crea un usuario de prueba (credenciales en `.env.test.local`) |

Base de datos nueva: pegar `supabase/setup-completo.sql` en Supabase → SQL Editor → Run.
