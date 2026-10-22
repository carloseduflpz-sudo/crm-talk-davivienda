# CRM Talk América · Davivienda — versión 2.0

Consola interna de las 6 campañas Davivienda (TDC, Extrafinanciamiento, Compra de Cartera, UPIN, Seguros y Domiciliaciones), publicada en Cloudflare.

| Pieza | Dónde vive | Qué guarda |
| --- | --- | --- |
| Código | Este repositorio | Pantallas, API, cálculos. **Nunca datos de clientes.** |
| Tablas | Cloudflare **D1** (`crm-talk`) | Clientes, ventas, llamadas, metas, cierres, bitácora |
| Archivos | Cloudflare **R2** (`crm-talk-datos`) | Excel originales, presentaciones generadas, respaldos |
| Login | Usuario y contraseña propios | Usuarios en D1; contraseñas cifradas (PBKDF2); sesiones de 12 h |

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
2. Comando de compilación: `npm run build` (Cloudflare instala las librerías solo; no agregar `npm install`)
3. Comando de despliegue: `npx wrangler d1 migrations apply crm-talk --remote && npx wrangler deploy`
4. Deploy. Desde ahora, cada cambio en `main` se publica solo, y cada pull request genera una vista previa.

Las migraciones crean las tablas y cargan los catálogos (6 campañas, 19 estatus del banco, 143 tipologías de VICI).

### 3. Crear el primer administrador
1. En el Worker: **Settings → Variables and Secrets → Add**.
2. Tipo **Secret**, nombre `SETUP_TOKEN`, valor: una frase larga que solo tú conozcas (mínimo 12 caracteres) → **Deploy**.
3. Abre la app: aparece **Configuración inicial**. Escribe esa frase, tu nombre, tu usuario y tu contraseña.
4. Listo: entras como administrador. Desde **Configuración → Usuarios** das de alta a los demás con una contraseña temporal; al primer ingreso la app les pide crear la suya.

`SETUP_TOKEN` solo sirve mientras no exista ningún usuario. Después puedes borrarlo.

**Seguridad del login:** contraseñas cifradas con sal (nunca se guardan en texto), bloqueo de 15 minutos tras 5 intentos fallidos, sesión en cookie `HttpOnly` + `Secure` + `SameSite=Strict` que vence a las 12 horas, y bitácora de cada ingreso y cambio de usuarios.

### 4. Comprobar
Abre `https://<tu-worker>.workers.dev/api/health`: debe decir `"ok": true`. Luego entra a la app con tu usuario.

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
printf "APP_ENV=development\nSETUP_TOKEN=clave-local-de-prueba\n" > .dev.vars
npm run db:migrate:local
npm run dev          # app + API en http://localhost:8787
npm run check        # tipos + pruebas + compilación
```
La primera vez, la app local muestra la configuración inicial: usa `clave-local-de-prueba` como clave.
