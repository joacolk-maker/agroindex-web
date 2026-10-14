# AgroIndex

**Más información. Mejor decisión.**

Sitio público para explorar precios y volúmenes mayoristas de frutas y hortalizas publicados por ODEPA.

## Arquitectura

- **Interfaz:** Next.js exportado como archivos estáticos y servido por GitHub Pages.
- **Datos públicos:** un manifiesto y once instantáneas compactas en `public/data/`, una por año entre 2016 y 2026.
- **Actualización 2026:** el despliegue consulta la vista pública `precios_web` de Supabase y regenera la instantánea compacta del año vigente antes de construir la página.
- **Historial inmutable:** la actualización diaria nunca reescribe los snapshots 2016–2025. La selección editorial se aplica mediante `series-rules.json`, sin borrar evidencia histórica.
- **Trazabilidad de conteos:** el manifiesto separa filas de origen (`upstream_rows`), normalizadas/almacenadas (`stored_rows`) y visibles bajo las reglas actuales (`published_rows`).
- **Privacidad:** el navegador no recibe la clave de servicio. El sincronizador usa únicamente la clave publicable de lectura y el sitio continúa sirviendo archivos estáticos.
- **Despliegue:** cada cambio en `main` y la ejecución diaria programada activan `.github/workflows/deploy-pages.yml` y actualizan GitHub Pages.

La interfaz carga inicialmente solo el año necesario y descarga otros archivos cuando el rango de fechas los requiere. Los filtros encadenados conservan región, mercado, subsector, producto, variedad, calidad y unidad de comercialización.

La lectura de venta conserva el precio original de ODEPA y muestra además un equivalente referencial por kilo cuando la unidad declara su peso o existe un factor de conversión publicado por ODEPA. Las unidades sin una equivalencia defendible se mantienen sin convertir.

## Desarrollo local

```bash
pnpm install
pnpm dev
```

## Actualización diaria

`pnpm sync:supabase` toma como base la última instantánea pública, vuelve a consultar solamente los últimos 30 días de `precios_web`, reemplaza esa ventana y actualiza `odepa-2026.json` y `manifest.json`. El primer día de cada mes realiza automáticamente una conciliación completa. El workflow lo ejecuta todos los días a las 18:00 de `America/Santiago`, adaptándose automáticamente a UTC−3 y UTC−4, y luego valida 2016–2026, ejecuta lint, construye y publica GitHub Pages solamente cuando existen cambios.

La sincronización sólo lee la vista pública de Supabase. No agrega escrituras, tablas ni almacenamiento en Supabase. El workflow detiene la publicación si detecta cualquier modificación de los archivos históricos 2016–2025.

GitHub programa dos posibles horas UTC y una compuerta comprueba el huso horario vigente de Chile. Solamente una continúa hacia Supabase; la alternativa termina antes de instalar dependencias o consultar datos.

La ventana puede ajustarse con `ODEPA_SYNC_WINDOW_DAYS`; `ODEPA_SYNC_MODE=full` fuerza una conciliación completa y `ODEPA_SYNC_MODE=incremental` fuerza la ventana móvil. Si Supabase entrega una copia más antigua que la ya publicada, la ejecución falla de forma segura y no reemplaza el sitio.

La web distingue `snapshot_generated_at` (cuándo se regeneró la instantánea) de `max_data_date` (la última fecha de mercado disponible). `SUPABASE_SERVICE_KEY` permanece exclusivamente en el repositorio de ingesta y nunca se incorpora al sitio ni a su JavaScript.

Fuente oficial: [ODEPA](https://www.odepa.gob.cl/).
