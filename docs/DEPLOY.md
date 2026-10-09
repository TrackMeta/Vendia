# Publicar Vendia en internet (Vercel)

Tiempo estimado: 15 minutos. Necesitas tu cuenta de GitHub (ya está el repo `TrackMeta/Vendia`) y crear una cuenta gratis en Vercel.

## 1. Crear el proyecto en Vercel

1. Entra a https://vercel.com/signup y regístrate con **"Continue with GitHub"**.
2. Pulsa **Add New… → Project**.
3. Importa el repositorio **TrackMeta/Vendia**. Si no aparece, pulsa "Adjust GitHub App Permissions" y dale acceso.
4. Framework: **Next.js** (se detecta solo). No cambies los comandos de build.

## 2. Variables de entorno

En **Environment Variables**, agrega las mismas de tu `.env.local`.

| Variable | Valor |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | La Project URL de Supabase |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | La Publishable key |
| `SUPABASE_SECRET_KEY` | La Secret key (**secreta**) |
| `APP_ENCRYPTION_KEY` | La misma de tu `.env.local`. **No la cambies nunca**: si cambia, los tokens de Meta guardados dejan de funcionar |
| `CRON_SECRET` | La misma de tu `.env.local` |
| `NEXT_PUBLIC_SITE_URL` | La URL final, por ejemplo `https://vendia.vercel.app` (puedes agregarla después del primer deploy) |

**No subas `SUPABASE_DB_URL`.** Solo sirve para migraciones desde tu PC.

Pulsa **Deploy**. Al terminar tendrás una URL como `https://vendia-xxxx.vercel.app`.

## 3. Configurar Supabase para producción

En Supabase → **Authentication → URL Configuration**:

- **Site URL:** tu URL de Vercel, por ejemplo `https://vendia.vercel.app`.
- **Redirect URLs:** agrega
  - `https://vendia.vercel.app/auth/callback`
  - `http://localhost:3000/auth/callback` (para seguir probando en tu PC)

Sin esto, los correos de confirmación y de recuperación de contraseña apuntarán a `localhost`.

**Recomendado:** en **Authentication → Emails → SMTP Settings**, configura un proveedor de correo propio (Resend, Brevo, etc.). El correo incluido de Supabase tiene un límite bajo de envíos por hora.

## 4. Tarea programada

Además, Supabase (pg_cron, ver `actualizacion-bloque-10.sql`) llama cada hora a `/api/cron/meta-sync` con una llave que genera la propia base (`public.app_internal`), y lee solo las tiendas a las que les toca según su intervalo. Si cambias el dominio de Vendia, actualiza `site_url` en esa tabla.

El archivo `vercel.json` programa `/api/cron/daily` una vez al día: reintenta eventos de Meta y TikTok que fallaron, sincroniza campañas, gasto y métricas de las tiendas conectadas y borra los formularios abandonados de más de 30 días. Vercel la activa sola si `CRON_SECRET` está configurado. En el plan gratis (Hobby) solo se permiten tareas diarias.

## 5. Dominios

**Dominio de Vendia (el panel):**

1. En Vercel → Project → **Settings → Domains**, agrega tu dominio (por ejemplo `vendia.pe`) y sigue las instrucciones de DNS.
2. Después actualiza `NEXT_PUBLIC_SITE_URL` y las URLs de Supabase (paso 3).

**Dominios de los vendedores (sus landings):** se agregan en el panel → **Dominios**. Vendia muestra el registro DNS que deben crear y verifica que apunte a Vercel. Cada dominio también debe existir en Vercel → Settings → Domains. Para que Vendia lo agregue solo, configura en Vercel estas variables (opcional):

| Variable | Dónde se obtiene |
|---|---|
| `VERCEL_TOKEN` | Vercel → Account Settings → Tokens (crea uno solo para Vendia) |
| `VERCEL_PROJECT_ID` | Vercel → Project → Settings → General → Project ID |
| `VERCEL_TEAM_ID` | Solo si el proyecto está en un equipo de Vercel |

## 6. Después de publicar

1. Regístrate en `https://TU-URL/registro` con tu correo real.
2. Hazte administrador desde tu PC:

   ```bash
   npx tsx scripts/make-admin.ts tu@correo.com
   ```

3. Entra a `/admin`.
4. En **Marketing**, conecta tu Pixel y el token de Conversions API, y prueba con el código de prueba de Events Manager.

## Base de datos

- **Proyecto vacío nuevo** (por ejemplo, uno separado para producción): pega `supabase/setup-completo.sql` en el SQL Editor.
- **Cambios futuros:** se agregan como archivos nuevos en `supabase/migrations/`. Antes de aplicarlos, valídalos con `npx tsx scripts/validate-sql.ts`.

## Pruebas automáticas (GitHub Actions)

Cada `push` a `main` corre `.github/workflows/ci.yml`: lint, tipos, tests unitarios, validación de las migraciones SQL y build. Si quieres que también corran los tests contra Supabase y las pruebas de punta a punta, agrega en GitHub → Settings → Secrets and variables → Actions estos secretos (los mismos valores de `.env.local`): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `APP_ENCRYPTION_KEY`. Recomendado: usa un proyecto de Supabase **de pruebas**, no el de producción.

En tu PC: `npm test` (unitarios), `npm run test:db` (base de datos) y `npm run test:e2e` (con la app corriendo en el puerto 3001).
