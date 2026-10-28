# Diseño: tiempos de pose, recursos compartidos y «mi profesional de siempre»

Estado: **implementado (pasos 1–5).** Diferencias respecto a la propuesta: la columna que marca las citas con bloques propios se llama `custom_blocks`; el candado antiguo es ahora `bookings_no_overlap_v3` (`WHERE … AND NOT custom_blocks`); la comparación en sombra se activa con `AVAILABILITY_SHADOW=on`; el editor de Ajustes admite un tipo de recurso por servicio (el motor admite varios). Quedan fuera las variantes por largo de pelo.

## 1. El problema

Hoy una cita es **un único bloque continuo** `[starts_at, blocked_until)` de una profesional, y el candado de Postgres (`bookings_no_overlap_v2`) impide que dos bloques de la misma profesional se solapen.

Eso no puede representar tres cosas que en una peluquería (y en parte en estética) son lo normal:

| Necesidad | Ejemplo | Por qué hoy no cabe |
|---|---|---|
| **Tiempo de pose** | Tinte: 30 min aplicando, 45 min de espera, 30 min aclarando | Mientras la clienta espera, la profesional está bloqueada aunque esté libre. Se pierde del 30 % al 50 % de la capacidad. |
| **Recurso compartido** | Una sola cabina láser, 2 lavacabezas, 1 máquina de microblading | El candado solo conoce profesionales. Dos profesionales pueden citar a la vez dos láseres. |
| **Continuidad** | «Con Laura, como siempre» | La clienta puede elegir profesional, pero el sistema no la recuerda ni se lo propone. |

## 2. Idea central

Dejar de pensar en «un bloque por cita» y pasar a **«varios bloques por cita»**.

```
cita = N bloques
  bloque de profesional  (staff_id, rango)   ← solo cuando la profesional está ocupada de verdad
  bloque de recurso      (resource_id, rango) ← cuando usa la cabina/máquina
```

El candado pasa de la tabla `bookings` a una tabla nueva de bloques. Una cita sin pose y sin recurso tiene **un solo bloque, idéntico al de hoy**: nada cambia para ella.

### 2.1 Datos

```sql
-- Fases de un servicio. La suma de minutos = services.duration_min (ese campo NO cambia de significado).
CREATE TABLE service_phases (
  service_id int NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  position   int NOT NULL,
  kind       text NOT NULL CHECK (kind IN ('active','wait')),
  minutes    int NOT NULL CHECK (minutes > 0),
  PRIMARY KEY (service_id, position)
);
-- Sin filas = una sola fase activa de duration_min (como hoy).

-- Recursos: unidades individuales y exclusivas, agrupadas por tipo.
CREATE TABLE resources (
  id serial PRIMARY KEY, name text NOT NULL, kind text NOT NULL, active boolean NOT NULL DEFAULT true
);                                   -- p. ej. «Cabina láser 1» (kind 'laser'), «Lavacabezas 1..2» (kind 'wash')
CREATE TABLE service_resources (
  service_id int NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  kind       text NOT NULL,
  uses       text NOT NULL DEFAULT 'all' CHECK (uses IN ('all','active')),   -- toda la cita o solo las fases activas
  PRIMARY KEY (service_id, kind)
);

-- Bloques que ocupan de verdad (aquí vive el candado)
CREATE TABLE booking_blocks (
  id          bigserial PRIMARY KEY,
  booking_id  uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  staff_id    int REFERENCES staff(id),
  resource_id int REFERENCES resources(id),
  during      tstzrange NOT NULL,
  live        boolean NOT NULL,          -- espejo de bookings.status IN ('HOLD','CONFIRMED')
  CHECK ((staff_id IS NULL) <> (resource_id IS NULL))
);
ALTER TABLE booking_blocks
  ADD CONSTRAINT blocks_staff_no_overlap    EXCLUDE USING gist (staff_id    WITH =, during WITH &&) WHERE (live AND staff_id IS NOT NULL),
  ADD CONSTRAINT blocks_resource_no_overlap EXCLUDE USING gist (resource_id WITH =, during WITH &&) WHERE (live AND resource_id IS NOT NULL);

-- Foto de las fases en cada cita (si luego cambias el servicio, las citas ya hechas no se mueven)
ALTER TABLE booking_services ADD COLUMN phases jsonb;
ALTER TABLE customers ADD COLUMN preferred_staff_id int REFERENCES staff(id);
```

Los dos candados siguen siendo **de la base de datos**, así que la garantía actual («pase lo que pase en la aplicación, no hay solapes») se mantiene. El error que lanza es el mismo `23P01`, que el código ya sabe convertir en «ese hueco acaba de ocuparse».

### 2.2 Cómo se mantienen sincronizados los bloques

Solo hay **4 sitios** que escriben la hora de una cita (`createHold`, `addServiceToBooking`, `rescheduleBooking`, `createManualBooking`) y **1** que la lee para calcular huecos (`availability.ts`, líneas 81–85). Eso hace viable el cambio.

- **Trigger `AFTER INSERT/UPDATE` en `bookings`:**
  - Al cambiar `status` → actualiza `live` de todos sus bloques (HOLD/CONFIRMED = vivo; EXPIRED/CANCELLED = no).
  - Al cambiar hora o profesional (cambiar la hora de una cita) → desplaza todos sus bloques el mismo delta y cambia `staff_id`.
  - Si la cita **no tiene fases ni recursos**, crea ella sola su único bloque `[starts_at, blocked_until)`. Así el código antiguo y los scripts de prueba siguen funcionando sin tocarlos.
- **Citas con fases o recursos:** la aplicación inserta sus bloques en la misma transacción que la cita (ya existe esa transacción en `createHold`). Se calculan con una función pura y testeable `buildBlocks(visit, startsAt, staffId, resourceIds)`.
- «Añadir un servicio a mi cita» se **desactiva** para citas con fases (solo se ofrece en las simples, como hoy). Es el único flujo que alarga una cita ya hecha y con fases ambiguo.

## 3. Cómo se calculan los huecos

El motor actual calcula **tramos libres** por profesional y busca dónde cabe un bloque continuo. Eso se mantiene para las visitas simples, con un cambio: los tramos ocupados salen de `booking_blocks` (solo bloques activos), de modo que **una visita simple también puede entrar en el hueco de espera de otra cita**.

Para visitas con fases o recursos se añade un camino nuevo:

```
para cada inicio candidato t de la rejilla:
  segmentos activos Si = [t + oi, t + oi + li)         (del patrón de fases de la visita)
  profesional P es válida si:
      - todos los Si caen dentro de su horario (y fuera de sus pausas y cierres)
      - ningún bloque vivo de P solapa ningún Si
      - la visita completa termina antes del cierre (la clienta no puede esperar fuera de horario)
  para cada tipo de recurso requerido:
      - existe una unidad sin bloques vivos solapando el rango que usa (todo o solo activo)
  hueco disponible = existe al menos un P válido y una unidad libre de cada tipo
```

Son consultas `NOT EXISTS` sobre el índice gist de `booking_blocks`: unas pocas miles por petición como máximo (60 días × ~40 inicios × profesionales). Se mide antes de dar el paso por bueno (ver §6).

**Reglas que se simplifican a propósito:**
- La regla de «sin restos» (`smart`) se aplica solo a visitas simples; las visitas con pose usan la rejilla libre. Evita decisiones de optimización difíciles de explicar.
- La espera puede cruzar la pausa del mediodía (la clienta se queda); las fases activas **no**. Es configurable por si se prefiere lo contrario.

**La clienta lo ve así:** «Tinte · 1 h 45 min (incluye 45 min de pose)». Se muestra el total y se explica la pose, no se oculta.

## 4. Recursos

- Al elegir hora el servidor reserva **una unidad concreta** de cada tipo requerido (la primera libre) y la guarda en el bloque; si la elegida se ocupa justo antes, el candado salta igual que hoy.
- `uses = 'all'` (láser, microblading: la máquina está ocupada toda la cita) o `'active'` (lavacabezas: solo mientras se lava).
- Si un tipo no tiene unidades activas, ningún hueco de ese servicio sale (se avisa en Ajustes con un aviso rojo, para no «apagar» un servicio por error).

## 5. «Mi profesional de siempre»

Sin tocar el candado; es la parte más barata y la de mejor retorno.

1. **Se recuerda:** al terminar una cita (`SHOWED`) se recalcula `customers.preferred_staff_id` = profesional más frecuente de sus últimas 5 visitas. En el móvil también se guarda en `pd_profile` para quien reserva sin teléfono verificado aún.
2. **Se propone:** en el paso de elegir profesional, primera opción «Con Laura, como siempre»; después «La primera libre». La disponibilidad ya acepta `staffId`.
3. **No deja en la estacada:** si Laura no tiene hueco en 7 días, se enseña «Con otra profesional hay huecos mañana: ¿te vale?».
4. **Se usa en los mensajes:** «Te echamos de menos» y el retoque llevan `?pro=ID`, y la reserva abre ya con su profesional.
5. **Reparto justo:** `pickStaff` ya reparte por menor carga cuando no hay preferencia, y respeta la preferida (ya implementado).

## 6. Plan por pasos (cada uno se despliega y se puede revertir solo)

| Paso | Qué se hace | Cambio visible | Cómo se comprueba | Reversión |
|---|---|---|---|---|
| **1. Espejo** | Tablas nuevas, trigger, relleno (`backfill`) de los bloques de las citas vivas. Los dos candados viejo y nuevo conviven. | **Ninguno** | Para cada cita viva hay exactamente un bloque idéntico; el e2e original sigue verde (134) | Borrar el trigger y las tablas; `bookings_no_overlap_v2` no se ha tocado |
| **2. Lectura** | `availability.ts` lee de `booking_blocks`. | **Ninguno** | **Comparación en sombra:** durante unos días, cada petición de huecos calcula con ambas consultas y registra cualquier diferencia; cero diferencias = se da por bueno | Volver a leer de `bookings` (un `if`) |
| **3. Fases** | `service_phases`, editor en Ajustes («Fases»), `buildBlocks`, camino nuevo de huecos, etiqueta «incluye pose». `bookings_no_overlap_v2` pasa a `WHERE NOT phased`. | Solo para los servicios con fases que configures | Modelo de referencia aparte (como el del e2e actual) con pares y tríos de servicios con y sin fases; carrera de 6 personas sobre el mismo hueco de espera | Quitar las fases del servicio: vuelve al bloque único |
| **4. Recursos** | `resources`, `service_resources`, asignación de unidad, aviso en Ajustes. | Solo para servicios con recurso | Dos profesionales a la vez sobre la misma máquina: gana una, la otra recibe «ocupado» | Quitar el recurso del servicio |
| **5. Habitual** | `preferred_staff_id`, opción en el paso de profesional, `?pro=`. | Opción nueva en la reserva | Pruebas unitarias del cálculo + e2e | Ocultar la opción |

Regla de oro: **hasta el paso 3 no cambia nada para ninguna clienta.** Los pasos 1 y 2 son «obras bajo el suelo».

### Pruebas que se escriben antes del código
- **Invariantes** (propiedad): para cualquier secuencia aleatoria de reservas, cambios de hora y cancelaciones, nunca hay dos bloques vivos de la misma profesional ni de la misma unidad solapados.
- **Referencia independiente**: un modelo en JS del cálculo de huecos, comparado con el SQL como ya hace `scripts/e2e.mjs`, ahora con fases y recursos.
- **Carreras**: 6 peticiones simultáneas por el mismo hueco, y por un hueco que solo existe porque otra cita está esperando.
- **Pagos**: la señal con Stripe y el webhook no cambian, pero se repite el escenario «pagó y el hueco se ocupó» con una cita con fases.

## 7. Riesgos y cómo se reducen

| Riesgo | Mitigación |
|---|---|
| Que bloques y citas se desincronicen (estado, hora, profesional) | Trigger único; prueba de invariantes; comprobación nocturna que alerta (`SELECT` de citas vivas sin bloques o bloques vivos de citas canceladas) en el panel |
| Rendimiento del camino nuevo | Medición con 60 días, 3 profesionales y 5 000 citas sintéticas antes de activarlo; límite de 5 s por petición; el camino simple no cambia |
| La clienta no entiende «pose» | Texto claro en la reserva, en la confirmación y en el recordatorio («llega a las 10:00; hasta las 11:15 puedes descansar») |
| Un servicio mal configurado vacía la agenda | Validación: suma de fases = duración; aviso rojo si un recurso requerido no tiene unidades; vista previa de huecos en el editor |
| Cambio de hora en citas con fases | Se reutiliza la misma lógica (`buildBlocks` con el nuevo inicio); si no cabe, se rechaza como hoy |

## 8. Esfuerzo estimado

Pasos 1–2: ~2 días (más unos días de comparación en sombra) · Paso 3: 2–3 días · Paso 4: 1–2 días · Paso 5: ~1 día · Editor de Ajustes y textos: 1 día.

## 9. Decisiones que necesito de ti

1. **¿Es una peluquería de verdad o solo estética?** El seed actual es de estética (uñas, pestañas, láser). Si hay tintes, mechas o mascarillas, indícame 3–4 servicios con sus fases (activo/espera/activo).
2. **Recursos:** ¿qué hay realmente que no se pueda duplicar? (cabina láser, máquina de microblading, lavacabezas, sillón de pedicura…) y cuántas unidades de cada.
3. **¿Puede la clienta esperar durante la pausa del mediodía?** (Propuesta: sí en la espera, no en las fases activas.)
4. **Precio y duración por largo de pelo** (corto / medio / largo): es el siguiente paso natural en peluquería y encaja como «variantes de servicio»; no está en este diseño, dime si lo quieres incluir.
5. **¿Aprobado empezar por los pasos 1 y 2?** No cambian nada visible y dejan listo el terreno.
