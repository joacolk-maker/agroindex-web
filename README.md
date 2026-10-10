# Agroindex

**Por la transparencia de precios.**

Sitio público para explorar precios y volúmenes mayoristas de frutas y hortalizas publicados por ODEPA.

## Arquitectura

- **Interfaz:** Next.js exportado como archivos estáticos y servido por GitHub Pages.
- **Datos públicos:** un manifiesto y once instantáneas compactas en `public/data/`, una por año entre 2016 y 2026.
- **Actualización 2026:** el despliegue consulta la vista pública `precios_web` de Supabase y regenera la instantánea compacta del año vigente antes de construir la página.
- **Privacidad:** el navegador no recibe la clave de servicio. El sincronizador usa únicamente la clave publicable de lectura y el sitio continúa sirviendo archivos estáticos.
- **Despliegue:** cada cambio en `main` y la ejecución diaria programada activan `.github/workflows/deploy-pages.yml` y actualizan GitHub Pages.

La interfaz carga inicialmente solo el año necesario y descarga otros archivos cuando el rango de fechas los requiere. Los filtros encadenados conservan región, mercado, subsector, producto, variedad, calidad y unidad de comercialización.

## Desarrollo local

```bash
pnpm install
pnpm dev
```

## Actualización diaria

`pnpm sync:supabase` descarga `precios_web`, regenera `odepa-2026.json` y actualiza `manifest.json`. El workflow lo ejecuta todos los días a las 14:30 UTC, después de la carga programada de ODEPA, y luego valida 2016–2026, ejecuta lint, construye y publica GitHub Pages.

La web distingue `snapshot_generated_at` (cuándo se regeneró la instantánea) de `max_data_date` (la última fecha de mercado disponible). `SUPABASE_SERVICE_KEY` permanece exclusivamente en el repositorio de ingesta y nunca se incorpora al sitio ni a su JavaScript.

Fuente oficial: [ODEPA](https://www.odepa.gob.cl/).
