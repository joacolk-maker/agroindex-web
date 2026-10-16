# AgroIndex

**Más información. Mejor decisión.**

Sitio público para explorar precios y volúmenes mayoristas de frutas y hortalizas publicados por ODEPA.

## Arquitectura

- **Interfaz:** Next.js exportado como archivos estáticos y servido por GitHub Pages.
- **Datos públicos:** un manifiesto y once instantáneas compactas en `public/data/`, una por año entre 2016 y 2026. Cada instantánea conserva los 14 campos originales de ODEPA, incluyendo `ID region` y `Origen`.
- **Actualización 2026:** el despliegue consulta directamente la API DataStore oficial de ODEPA y regenera la ventana reciente de la instantánea compacta del año vigente antes de construir la página.
- **Historial inmutable:** la actualización diaria nunca reescribe los snapshots 2016–2025. La selección editorial se aplica mediante `series-rules.json`, sin borrar evidencia histórica.
- **Trazabilidad de conteos:** el manifiesto separa filas de origen (`upstream_rows`), normalizadas/almacenadas (`stored_rows`) y visibles bajo las reglas actuales (`published_rows`).
- **Privacidad:** el navegador no recibe credenciales de base de datos. La actualización oficial es pública y el sitio continúa sirviendo archivos estáticos.
- **Despliegue:** cada cambio en `main` y la ejecución diaria programada activan `.github/workflows/deploy-pages.yml` y actualizan GitHub Pages.

La interfaz carga inicialmente solo el año necesario y descarga otros archivos cuando el rango de fechas los requiere. Los filtros encadenados conservan región, mercado, subsector, producto, variedad, calidad y unidad de comercialización. La capa original también mantiene fecha, ID de región, origen, volumen y los tres campos de precio sin descartarlos.

`pnpm rebuild:odepa-history` reconstruye 2016–2026 directamente desde los recursos anuales oficiales, valida las 14 columnas exactas y genera `odepa-resources.json` con el inventario, licencia y metadatos del catálogo. Este comando es una operación controlada de reconstrucción histórica; la actualización diaria no modifica 2016–2025.

El inventario documenta la frecuencia oficial como diaria en días hábiles y conserva como metodología la descripción publicada por ODEPA: precios y volúmenes de productos frescos transados en grandes cantidades en los principales mercados mayoristas del país.

La lectura de venta conserva el precio original de ODEPA y muestra además un equivalente referencial por kilo cuando la unidad declara su peso o existe un factor de conversión publicado por ODEPA. Las unidades sin una equivalencia defendible se mantienen sin convertir.

## Desarrollo local

```bash
pnpm install
pnpm dev
```

## Actualización diaria

`pnpm sync:odepa` toma como base la última instantánea pública, consulta solamente los últimos 30 días de la API DataStore oficial de ODEPA, reemplaza esa ventana y actualiza `odepa-2026.json` y `manifest.json`. El primer día de cada mes realiza automáticamente una conciliación completa desde la misma API, sin descargar el CSV anual. El workflow lo ejecuta todos los días a las 18:00 de `America/Santiago`, adaptándose automáticamente a UTC−3 y UTC−4, y luego valida 2016–2026, ejecuta lint, construye y publica GitHub Pages solamente cuando existen cambios.

La sincronización diaria sólo lee la fuente pública de ODEPA. No agrega escrituras, tablas ni consumo en Supabase. El workflow detiene la publicación si detecta cualquier modificación de los archivos históricos 2016–2025.

GitHub programa dos posibles horas UTC y una compuerta comprueba el huso horario vigente de Chile. Solamente una continúa hacia ODEPA; la alternativa termina antes de instalar dependencias o consultar datos.

La ventana puede ajustarse con `ODEPA_SYNC_WINDOW_DAYS`; `ODEPA_SYNC_MODE=full` fuerza una conciliación completa y `ODEPA_SYNC_MODE=incremental` fuerza la ventana móvil. Si ODEPA entrega una copia más antigua que la ya publicada o cambia las 14 columnas, la ejecución falla de forma segura y no reemplaza el sitio.

La web distingue `snapshot_generated_at` (cuándo se regeneró la instantánea) de `max_data_date` (la última fecha de mercado disponible). `SUPABASE_SERVICE_KEY` permanece exclusivamente en el repositorio de ingesta y nunca se incorpora al sitio ni a su JavaScript.

Fuente oficial: [ODEPA](https://www.odepa.gob.cl/).
