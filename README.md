# CRM Talk América · Davivienda — versión 2.0

Consola interna de las 6 campañas Davivienda (TDC, Extrafinanciamiento, Compra de Cartera, UPIN, Seguros y Domiciliaciones), publicada en Cloudflare.

| Pieza | Dónde vive | Qué guarda |
| --- | --- | --- |
| Código | Este repositorio | Pantallas, API, cálculos. **Nunca datos de clientes.** |
| Tablas | Cloudflare **D1** (`crm-talk`) | Clientes, ventas, llamadas, metas, cierres, bitácora |
| Archivos | Cloudflare **R2** (`crm-talk-datos`) | Excel originales, presentaciones generadas, respaldos |
| Login | Cloudflare **Access** | Solo entran los correos autorizados |

## Estructura

```
apps/web/          Pantallas (React + TypeScript + Tailwind)
apps/api/          Worker: API (Hono) y, más adelante, tareas programadas
packages/core/     Las 6 campañas, clasificación de estatus y tipologías, roles
packages/db/       Esquema de tablas (Drizzle) y migraciones SQL
scripts/           Utilidades (p. ej. regenerar los catálogos iniciales)
wrangler.jsonc     Configuración de Cloudflare
```

## Puesta en marcha (una sola vez)

### 1. Crear el almacenamiento en Cloudflare
1. **Storage & Databases → D1 → Create** → nombre `crm-talk`. Copia su **Database ID**.
2. **R2 → Create bucket** → nombre `crm-talk-datos` (privado).
3. En `wrangler.jsonc`, reemplaza `REEMPLAZAR_CON_ID_DE_D1` por el Database ID → commit.

### 2. Conectar este repositorio (despliegue automático)
1. **Workers & Pages → Create → Import a repository** → elige este repositorio.
2. Comando de compilación: `npm run build`
3. Comando de despliegue: `npx wrangler d1 migrations apply crm-talk --remote && npx wrangler deploy`
4. Deploy. Desde ahora, cada cambio en `main` se publica solo, y cada pull request genera una vista previa.

Las migraciones crean las tablas y cargan los catálogos (6 campañas, 19 estatus del banco, 143 tipologías de VICI).

### 3. Proteger el acceso (Cloudflare Access)
1. En el Worker: **Settings → Domains & Routes** → junto a `workers.dev` pulsa **Enable Cloudflare Access** (y lo mismo en **Preview URLs**).
2. Copia el **AUD Tag** que aparece y pégalo en `ACCESS_AUD` dentro de `wrangler.jsonc`.
3. En la política de Access, deja solo los correos de los 3 usuarios.
4. En `ADMIN_EMAILS` (`wrangler.jsonc`) escribe esos 3 correos separados por coma → commit.

Mientras `ACCESS_AUD` esté vacío, la app abre pero la API **no entrega datos** (falla cerrada, a propósito).

### 4. Comprobar
Abre `https://<tu-worker>.workers.dev/api/health`: debe decir `"ok": true`. Luego entra a la app con tu correo.

## Cómo se trabaja

1. Cada cambio va en una rama y abre un **pull request**.
2. GitHub corre tipos, pruebas y compilación (*Calidad*). Cloudflare publica una vista previa.
3. Se revisa la vista previa y se aprueba el pull request.
4. Al unirse a `main`, se publica a producción. Para regresar: **Deployments → Rollback**.

## Reglas que no se rompen
- Ningún Excel, CSV, `.json.gz` ni `.pptx` real entra al repositorio (`.gitignore` los bloquea). Los archivos de prueba van en `tests/fixtures/` y llevan **datos inventados**.
- Toda cifra sale de las funciones de `packages/core`: una sola definición por métrica.
- Cambiar el esquema = editar `packages/db/src/schema.ts` **y** agregar una migración nueva en `packages/db/migrations/` (la prueba `schema.test.ts` verifica que coincidan). Nunca se edita una migración ya aplicada.

## Desarrollo local (opcional)
```
npm install
printf "AUTH_MODE=dev\nAPP_ENV=development\nDEV_USER_EMAIL=tu@correo\n" > .dev.vars
npm run db:migrate:local
npm run dev          # app + API en http://localhost:8787
npm run check        # tipos + pruebas + compilación
```
El atajo `AUTH_MODE=dev` solo funciona con `APP_ENV=development`; en producción y vistas previas se ignora.
