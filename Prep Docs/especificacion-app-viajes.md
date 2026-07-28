# Guía de viaje offline — Especificación v1

> Documento de trabajo para construir la aplicación con Claude Code.
> Origen: sesión de planificación del viaje Ronda–Cádiz, julio 2026.
> Primer viaje objetivo: Tailandia, tres semanas.

---

## 1. Qué problema resuelve

Durante el viaje Ronda–Cádiz se generaron guías HTML que funcionaron bien, pero tenían tres fallos estructurales:

1. **Contenido y programa eran la misma cosa.** Cada cambio de horario obligaba a regenerar el archivo entero a mano.
2. **No se podían abrir en el iPhone.** iOS no abre HTML locales, y «Añadir a pantalla de inicio» requiere una URL.
3. **No sabían nada del mundo real.** No conocían la hora, ni la posición, ni qué paradas se habían hecho ya.

La app resuelve los tres. Se construye **una vez**. El contenido llega en **archivos por viaje** que se cargan dentro. Funciona **sin conexión** una vez instalada.

### Reparto de responsabilidades

| Quién | Qué hace |
|---|---|
| Usuario + IA (conversación) | Investigan, verifican horarios, deciden el itinerario |
| IA | Produce los archivos del viaje |
| App | Los lee, los muestra, cuenta el tiempo, avisa, registra |
| Claude Code | Construye la app, una sola vez |

---

## 2. Principios de diseño

Son las reglas que no se negocian. Todo lo demás se deriva de ellas.

### 2.1 Sitios y itinerario van separados

Un **sitio** (`place`) tiene datos estables: coordenadas, horarios, precio, historia. Se describe una vez y sirve para siempre.

Un **itinerario** es una secuencia de referencias a sitios, con lo propio de ese viaje: a qué hora, cuánto rato, por qué.

Esto construye una biblioteca de sitios que sobrevive a los viajes.

### 2.2 Duraciones, nunca horas de reloj

Cada parada guarda `duration` y `travelFrom`. El día guarda `startTime`. **Las horas se calculan al renderizar.**

Cambiar la hora de salida recoloca el día entero automáticamente. En la sesión de Cádiz esto se hizo a mano cinco veces.

### 2.3 Las restricciones son datos, y el plan se valida solo

Si la freiduría tiene `mustArriveBefore: "16:30"` y el Teatro Romano tiene horarios por día de la semana, el validador detecta el conflicto antes de salir de casa.

En la sesión real, el error del Teatro Romano (cierra a las 14:00 los domingos, llegada prevista 16:20) se detectó por casualidad.

### 2.4 Cada dato lleva su nivel de confianza

`verified` con fuente, o `unverified`. La interfaz los distingue visualmente.

Casos reales: «los perros pueden tumbarse en el césped del Parque Genovés» y «los perros entran al patio del Castillo de Santa Catalina» eran suposiciones razonables, no hechos comprobados.

### 2.5 El plan y el registro nunca se pisan

- **El generador (IA) solo escribe el plan.**
- **La app solo escribe el registro.**

Un parche puede reescribir un día entero sin tocar los datos del usuario. Si una parada desaparece del plan, su registro queda huérfano pero no se borra.

### 2.6 Cuando el plan falla, degrada a diario, no a regañina

Si el usuario se sale del plan, la app deja de avisar y pasa a registrar en silencio. Un banner rojo insistiendo sobre una parada a la que ya nadie va es la razón por la que se abandonan estas apps.

---

## 3. Arquitectura

```
┌─────────────────────────────────────────────────┐
│  PWA instalada (pantalla de inicio, standalone) │
├─────────────────────────────────────────────────┤
│  Service worker  → cachea app shell             │
│  IndexedDB       → viajes, planes, registro     │
│  OPFS            → mapas PMTiles (binarios)     │
└─────────────────────────────────────────────────┘
```

- **Sin backend.** Todo local.
- **Alojamiento:** GitHub Pages u otro host estático HTTPS. Solo necesario para instalar y actualizar la app, no durante el viaje.
- **Stack sugerido:** JS puro o framework ligero (Svelte/Preact). Sin dependencias pesadas. El bundle debe ser pequeño porque se cachea entero.

---

## 4. Formato de archivo

### 4.1 Sobre común

Todos los archivos comparten envoltorio:

```json
{
  "format": "trip-file",
  "formatVersion": 1,
  "tripId": "thailand-2026-11",
  "kind": "trip",
  "version": 1,
  "generated": "2026-10-02T18:40:00Z",
  "label": "Plan inicial",
  "payload": { }
}
```

| Campo | Descripción |
|---|---|
| `format` | Constante. Sirve para rechazar archivos ajenos |
| `formatVersion` | Versión del esquema. Permite migraciones futuras |
| `tripId` | Identificador del viaje. Todos los archivos de un viaje lo comparten |
| `kind` | `trip` · `day` · `patch` · `docs` |
| `version` | Entero creciente **por viaje**. La app rechaza cargar versiones anteriores a la aplicada |
| `label` | Texto libre para el diff: «Corrige horarios de Ayutthaya» |

### 4.2 `kind: "trip"` — crea el viaje

Solo puede haber uno por `tripId`, y va primero.

```json
{
  "payload": {
    "title": { "es": "Tailandia", "en": "Thailand" },
    "startDate": "2026-11-08",
    "endDate": "2026-11-29",
    "defaultTimezone": "Asia/Bangkok",
    "languages": ["es", "en"],
    "primaryLanguage": "es",
    "currency": "THB",
    "travellers": { "adults": 2, "children": 0, "dogs": 0 },
    "stays": [ ],
    "places": { },
    "days": [ ]
  }
}
```

### 4.3 `stays` — dónde se duerme

Definen los tramos del viaje. De aquí salen automáticamente las cajas de mapa a recortar.

```json
{
  "id": "stay-bangkok-1",
  "name": "Hotel Riva Surya",
  "place": "riva-surya",
  "from": "2026-11-08",
  "to": "2026-11-12",
  "timezone": "Asia/Bangkok",
  "confirmation": "BKK-4471822",
  "notes": { "es": "Check-in desde las 14:00" }
}
```

### 4.4 `places` — la biblioteca de sitios

Diccionario indexado por id. Reutilizable entre viajes.

```json
{
  "genoves": {
    "id": "genoves",
    "name": "Parque Genovés",
    "nameLocal": "Parque Genovés",
    "coords": [36.5358352, -6.3041746],
    "coordsSource": "places_api",
    "address": "Av. Doctor Gómez Ulla, s/n, 11003 Cádiz",
    "category": "park",

    "hours": {
      "default": [["08:00", "23:00"]],
      "byDay": { "sun": [["08:00", "23:00"]] },
      "closedDays": [],
      "note": { "es": "Sin variación estacional conocida" }
    },

    "cost": {
      "adult": 0,
      "child": 0,
      "currency": "EUR",
      "note": { "es": "Entrada libre" }
    },

    "contact": { "phone": "+34956000000", "url": null },

    "amenities": ["toilets", "shade", "benches", "water", "playground", "cafe"],

    "dog": {
      "allowed": "partial",
      "note": { "es": "Con correa en los paseos. El césped, sin confirmar" },
      "confidence": "unverified"
    },

    "facts": [
      {
        "text": {
          "es": "Zona de juegos junto a la puerta suroeste",
          "en": "Playground near the south-west gate"
        },
        "confidence": "verified",
        "source": "reseñas Google, jul 2026"
      }
    ],

    "deep": {
      "es": "Jardín botánico con más de cien especies...",
      "en": "A botanical garden of over a hundred species..."
    },

    "links": {
      "wikipedia": {
        "es": "https://es.wikipedia.org/wiki/Parque_Genov%C3%A9s",
        "en": null
      },
      "official": null,
      "maps": "https://www.google.com/maps/dir/?api=1&destination=36.5358,-6.3042"
    }
  }
}
```

**Notas sobre campos concretos:**

- `coords`: `[lat, lng]`. Puede ser `null` si no se ha resuelto; la app entonces geocodifica y pide confirmación visual en el mapa.
- `coordsSource`: `places_api` · `geocoded` · `user` · `unresolved`. Las coordenadas alucinadas son el fallo más peligroso del sistema.
- `amenities`: vocabulario cerrado. Alimenta iconos y filtros.
- `dog`: generalizable a `accessibility` en el futuro. Se mantiene por utilidad inmediata.
- `hours.byDay`: claves `mon`…`sun`. Ausencia = usa `default`.

### 4.5 `days` — los días

```json
{
  "id": "d05",
  "date": "2026-11-12",
  "type": "explore",
  "title": { "es": "Ayutthaya en un día" },
  "timezone": "Asia/Bangkok",
  "stay": "stay-bangkok-1",
  "startTime": "07:30",
  "intro": {
    "es": "Texto de introducción, historia y contexto...",
    "en": "..."
  },
  "waypoints": [ ]
}
```

**Tipos de día:**

| Tipo | Forma | Interfaz |
|---|---|---|
| `explore` | Cadena de paradas elásticas con alguna ancla | Línea de tiempo (la de Cádiz) |
| `transit` | Casi todo anclas duras, poca elasticidad | **Cuenta atrás** hasta la salida |
| `open` | Sin plan | Solo la base, mapa y botón de improvisar |

Un día `transit` no es una lista de paradas: es un reloj. Muestra hora de salida, facturación, terminal, tiempo al aeropuerto, y el aviso deja de ser «vas justo» para ser «sal ya».

### 4.6 `waypoints` — las paradas

```json
{
  "id": "wp-05-03",
  "place": "wat-mahathat",
  "duration": 45,
  "travelFrom": 12,
  "travelMode": "walking",
  "priority": "key",
  "dropRank": 6,
  "anchor": null,
  "notes": [
    { "type": "warn", "text": { "es": "Hombros y rodillas cubiertos" } }
  ]
}
```

| Campo | Descripción |
|---|---|
| `duration` | Minutos previstos en el sitio |
| `travelFrom` | Minutos de trayecto **desde la parada anterior** |
| `travelMode` | `walking` · `driving` · `transit` · `cycling` · `flight` |
| `priority` | `key` (no se recorta) · `normal` · `optional` |
| `dropRank` | Entero. Orden de recorte cuando falta tiempo. Menor = se suelta antes |
| `notes[].type` | `info` · `warn` · `dog` · `access` |

### 4.7 `anchor` — los puntos clavados

Lo que convierte una lista en un plan verificable.

```json
{
  "anchor": {
    "type": "closing",
    "time": "16:30",
    "hard": true,
    "label": { "es": "Cierra la freiduría" }
  }
}
```

| `type` | Significado |
|---|---|
| `closing` | El sitio cierra. Hay que **llegar** antes |
| `opening` | El sitio abre. No tiene sentido llegar antes |
| `departure` | Hay que **haber salido** a esa hora (tráfico, tren) |
| `booking` | Reserva con hora |
| `transport` | Vuelo, tren, ferry. Siempre `hard` |

`hard: true` significa que perderlo rompe el día. Alimenta el nivel rojo del aviso.

**Cinco nombres, tres semánticas.** `type` mezcla lo que el ancla *restringe* con
cómo se *llama*. Lo que el motor necesita saber es sólo lo primero:

| Semántica | Tipos | Qué comprueba |
|---|---|---|
| `arriveBy` | `closing` · `booking` · `transport` | La **llegada** debe ser anterior |
| `departBy` | `departure` | La **salida** debe ser anterior: cuenta también la estancia |
| `notBefore` | `opening` | Llegar antes no es un fallo, es tiempo muerto |

El formato de archivo no cambia: la semántica se deriva en el motor
(`anchorSemantic()`). `notBefore` **no entra en el cálculo de holgura** —§6.2 mide
plazos, y llegar pronto no consume tiempo, sobra.

### 4.8 `kind: "day"` — añade o reemplaza un día

```json
{
  "kind": "day",
  "version": 4,
  "label": "Rehace el domingo con el plan corto",
  "payload": {
    "places": { },
    "day": { }
  }
}
```

Reemplaza el día completo por `id`. Puede traer sitios nuevos, que se fusionan en la biblioteca.

### 4.9 `kind: "patch"` — cambios quirúrgicos

```json
{
  "kind": "patch",
  "version": 5,
  "label": "Adelanta la salida de Cádiz y quita Puerta de Tierra",
  "payload": {
    "ops": [
      { "op": "set", "path": "days.d05.startTime", "value": "07:00" },
      { "op": "remove", "path": "days.d05.waypoints.wp-05-02" },
      { "op": "set", "path": "places.genoves.hours.default", "value": [["08:00","21:00"]] },
      { "op": "insertAfter", "path": "days.d05.waypoints.wp-05-04",
        "value": { "id": "wp-05-04b", "place": "…", "duration": 20 } }
    ]
  }
}
```

Operaciones: `set` · `remove` · `insertAfter` · `insertBefore` · `merge`.

**Rutas por id, nunca por índice.** Los índices se rompen en cuanto algo cambia.

### 4.10 `kind: "docs"` — documentos y frases

```json
{
  "kind": "docs",
  "payload": {
    "documents": [
      {
        "id": "doc-vuelo-ida",
        "type": "flight",
        "title": { "es": "Vuelo Madrid–Bangkok" },
        "reference": "TG8452",
        "date": "2026-11-08",
        "fields": [
          { "label": { "es": "Salida" }, "value": "MAD T4 · 12:05" },
          { "label": { "es": "Localizador" }, "value": "QX7T4M" }
        ],
        "image": "data:image/png;base64,…"
      }
    ],
    "phrases": [
      {
        "category": "transporte",
        "es": "Lléveme a esta dirección, por favor",
        "local": "กรุณาพาผมไปที่อยู่นี้",
        "translit": "karúna paa pǒm pai tîi yùu níi"
      }
    ],
    "emergency": [
      { "label": { "es": "Emergencias Tailandia" }, "value": "191" },
      { "label": { "es": "Embajada de España, Bangkok" }, "value": "+66 2 661 8284" }
    ]
  }
}
```

Las **direcciones en escritura local** son la función más valiosa del bloque: enseñarle la pantalla al taxista. Cada `place` puede llevar `nameLocal` y `addressLocal` por el mismo motivo.

---

## 5. El registro del usuario

Vive aparte. **La IA nunca lo escribe. Los parches nunca lo tocan.**

```json
{
  "tripId": "thailand-2026-11",
  "waypoints": {
    "wp-05-03": {
      "status": "visited",
      "arrivedAt": "2026-11-12T09:14:00+07:00",
      "leftAt": "2026-11-12T10:02:00+07:00",
      "note": "Mejor de lo esperado, nos quedamos más rato"
    },
    "wp-05-05": { "status": "skipped", "at": "2026-11-12T12:40:00+07:00" }
  },
  "improvised": [
    {
      "id": "imp-01",
      "dayId": "d05",
      "name": "Puesto de mango sticky rice",
      "coords": [14.3556, 100.5689],
      "at": "2026-11-12T11:20:00+07:00",
      "note": "El mejor del viaje"
    }
  ],
  "days": {
    "d05": { "freeMode": false, "closingNote": "" }
  }
}
```

### 5.1 Estados del waypoint

```
pending → current → visited
                  → skipped
                  → partial
```

- **`partial`** existe porque llegar y quedarse diez minutos en vez de treinta no es ni visitado ni saltado.
- **No se piden motivos de salto.** Se deducen: holgura negativa → tiempo; fuera de horario → cierre; holgura positiva → elección. Solo el cansancio requiere que alguien lo diga, y para eso está el cierre del día.

### 5.2 Ritmo

Al terminar un día, la app compara duración estimada contra real y calcula un multiplicador.

```
Estimado 240 min · Real 297 min · Factor 1.24
```

Se aprende con **un solo viaje**, es aritmética, y es lo único que mejora de verdad la planificación siguiente. Se muestra al planificar el próximo viaje.

---

## 6. Motor de tiempos

### 6.1 Cálculo de horas previstas

```
hora(w[0])   = day.startTime
hora(w[n])   = hora(w[n-1]) + duration(w[n-1]) + travelFrom(w[n])
```

Se recalcula al vuelo. Nunca se guardan horas absolutas en el plan.

### 6.2 Holgura

**No se recalcula el día hacia delante.** Se calcula **hacia atrás desde la próxima ancla**.

```
pendientes = waypoints con status ∈ {pending, current} antes de la próxima ancla
necesario  = Σ duration + Σ travelFrom  de los pendientes
           + travelFrom del waypoint anclado          ← hay que llegar hasta él
           + duration del waypoint anclado, si es departBy
disponible = horaAncla − ahora
holgura    = disponible − necesario
```

Un solo número, y es el único que importa.

**El `travelFrom` del waypoint anclado cuenta.** Hay que recorrer ese trayecto para
llegar al ancla. Omitirlo da holgura de más justo donde equivocarse sale más caro:
en el fixture de Sevilla la diferencia es 15 min de margen sobre la entrada del
Alcázar frente a los 3 reales.

**Anclas vencidas.** Un ancla cuya hora ya pasó pero cuyo waypoint sigue `pending`
—porque se dejó de pulsar el botón, que es lo que pasa siempre— **sale del cálculo**
y se informa aparte una sola vez. Medir contra ella daría un rojo permanente sobre
algo que ya no tiene arreglo, que es exactamente la regañina que prohíbe §2.6.

La holgura depende del registro. Lo que no se marca sigue contando como pendiente,
así que el número se degrada solo si se deja de usar la app. Es el comportamiento
correcto —no se puede adivinar dónde estás— pero conviene saberlo.

### 6.3 Avisos

| Nivel | Condición | Mensaje |
|---|---|---|
| Verde | holgura ≥ 25 min | Nada visible |
| Ámbar | 0 ≤ holgura < 15 min | «Quedan 12 min de margen hasta el cierre de la Freiduría (16:30)» |
| Rojo | holgura < 0 | «No llegas a la Freiduría por 15 min. **Saltando San Sebastián recuperas 40**» |

**La tabla deja un hueco entre 15 y 25 minutos, y no es un olvido: ese hueco *es* la
histéresis.** El nivel no depende sólo de la holgura, sino de dónde venías. Bajando
desde verde te quedas en verde hasta cruzar 15; subiendo desde ámbar te quedas en
ámbar hasta cruzar 25. La banda intermedia es la que impide el parpadeo.

```
if holgura < 0                      → rojo
if venías de rojo y holgura ≤ 10    → rojo
if holgura < 15                     → ámbar
if venías de ámbar y holgura < 25   → ámbar
                                    → verde
```

**Reglas:**

- **El rojo nunca aparece sin proponer la salida.** Se calcula con `dropRank`: se suelta la parada de menor rango hasta que la holgura vuelva a positivo, y se muestra el resultado.
- **Histéresis.** Ámbar aparece por debajo de 15 y desaparece por encima de 25. Rojo aparece por debajo de 0 y se limpia por encima de 10. Sin esto, parpadea al cruzar el umbral.
- **Descartar silencia** hasta que la situación empeore un escalón, no treinta segundos.
- **Marcar `skipped` devuelve tiempo al bote y el banner se actualiza en el acto.** Ese bucle —veo el problema, pulso, veo que se arregla— es lo que hace que la app se sienta útil en vez de acusadora.

### 6.4 Zonas horarias

- Cada `stay` lleva su zona. Cada día hereda la de su `stay`, o usa `defaultTimezone`.
- El «ahora» sale del reloj del dispositivo y se convierte a la zona del día.
- **Días de vuelo:** salida en zona de origen, llegada en zona de destino, ambas etiquetadas explícitamente en la interfaz.
- Guardar siempre ISO 8601 con offset en el registro.

---

## 7. Improvisación y modo libre

### 7.1 Waypoint improvisado

Un botón, siempre visible. Pide **solo el nombre**:

- Coordenadas → del GPS, porque estás allí. Esto además elimina el riesgo de coordenadas inventadas.
- Hora → del reloj.
- Foto y nota → opcionales.

Se guarda en el registro, no en el plan. Al exportar, viaja con el viaje.

### 7.2 Modo libre

Interruptor por día. Cuando se activa:

- Se **silencian todos los avisos**
- La línea de tiempo pasa a segundo plano
- La app registra en silencio: posición, waypoints improvisados, notas
- Al desactivarlo, recalcula holgura desde el estado real

Es la respuesta a «me he salido del plan del todo», que en un viaje largo pasa seguro.

---

## 8. Mapas offline

### 8.1 Decisión clave: recortar, no descargar países

**No descargar Tailandia entera.** Un basemap vectorial de un país son cientos de megas y ahí es donde se choca con las cuotas de iOS.

Se descargan **cajas por `stay`**, con margen, más el país a zoom bajo para el conjunto. Las cajas **se generan automáticamente** a partir de las coordenadas del itinerario.

```
bbox(stay) = envolvente de coords de sus waypoints + margen 3 km
zoom 0–9   → país entero
zoom 10–16 → cajas de stays
```

### 8.2 Stack

| Pieza | Elección | Motivo |
|---|---|---|
| Teselas | **PMTiles** | Archivo único, lectura por rangos, sin descomprimir |
| Render | **MapLibre GL JS** | Vectorial, estilos, GeoJSON encima |
| Almacenamiento | **OPFS** | Sistema de archivos privado del origen. Va bien con binarios grandes y lecturas por rango. En Safari desde la 17 |
| Persistencia | `navigator.storage.persist()` | Evita el desalojo |
| Posición | `watchPosition()` | **El GPS funciona sin datos.** El chip no necesita red, solo las teselas |

Sobre el mapa: la ruta como **GeoJSON LineString**, los waypoints como pines, la posición como punto azul.

**Sin routing ni turn-by-turn.** Es un mapa con una línea pintada. Muchísimo menos trabajo que una app de navegación, y es lo que se pidió.

### 8.3 Trampas conocidas

- **Glyphs tailandeses.** MapLibre carga las fuentes de las etiquetas **aparte** de las teselas. El alfabeto tailandés tiene sus propios rangos Unicode. Si no se cachean explícitamente, el mapa sale mudo justo en el país donde no se sabe leer. **Cachear también los sprites.**
- **Batería.** `watchPosition` continuo se come el móvil en una jornada de ocho horas. Pedir posición al abrir el mapa, no mantener el chip despierto.
- **iOS y segundo plano.** La geolocalización en una PWA **solo funciona con la app en primer plano**. No hay geofencing. El avance de parada es siempre un botón manual.

### 8.4 Spike obligatorio antes de construir

**Este experimento es el go/no-go de toda la funcionalidad de mapas.**

1. Instalar una PWA mínima en el iPhone desde la pantalla de inicio
2. Descargar ~150 MB a OPFS
3. Llamar a `persist()` y verificar que devuelve `true`
4. Cerrar la app, esperar 24-48 h, reabrir
5. Comprobar que el archivo sigue ahí y se lee por rangos

Si falla, el plan B es Organic Maps y no se ha perdido nada.

### 8.5 Plan B: export a GPX

**Mantener en cualquier caso.** Son unas cincuenta líneas y cubre el riesgo del componente más frágil.

Genera un `.gpx` con waypoints y track. Se importa en **Organic Maps** (OSM offline, gratis, sin anuncios), que pinta la ruta y la posición sin escribir una línea de código.

La app enlaza a coordenadas con URIs `geo:` para abrir ahí cuando haga falta.

---

## 9. Carga de archivos

### 9.1 Mecanismo

Botón **«Cargar archivo de viaje»** con selector de archivos nativo. Acepta `.trip` y `.json`.

Registrar el tipo de archivo en el manifest para que iOS ofrezca la app en «Abrir con».

### 9.2 Secuencia

**Validar y aplicar son cosas distintas, y en ese orden.**

```
VALIDAR — siempre entero, pase lo que pase
  1. Leer el envoltorio: format, formatVersion, tripId, kind
  2. Validar el payload completo (ver §10), sobre una copia
  3. Producir el informe pegable y el plan resultante del ensayo

DECIDIR — aparte
  4. ¿Hay errores? ¿version > la aplicada? ¿tripId conocido?
     → si algo falla: se enseña el informe y NO se aplica

APLICAR — sólo si se puede y se confirma
  5. Calcular el diff sobre el plan del ensayo
  6. MOSTRAR EL DIFF Y PEDIR CONFIRMACIÓN
  7. Aplicar en transacción, guardar en el historial
```

**Por qué no se corta en el paso 4.** Si la comprobación de `version` abortase la
validación, un archivo con la versión mal no llegaría a revisarse nunca, y el bucle
de reparación de §10.3 —copiar los errores, pegárselos a la IA, recibir el archivo
corregido— haría falta repetirlo tantas veces como errores hubiera. Sin conexión no
hay rondas. Se valida todo siempre; la aplicabilidad se informa por separado.

### 9.3 El diff no es opcional

Antes de aplicar, mostrar en lenguaje llano qué cambia:

```
Parche v5 — «Adelanta la salida de Cádiz»

  ~ Domingo 12: salida 07:30 → 07:00
  − Domingo 12: se elimina Puerta de Tierra
  + Domingo 12: se añade Wat Ratchaburana (20 min)
  ~ Parque Genovés: horario 08:00–23:00 → 08:00–21:00

  Tus datos: 3 paradas marcadas, ninguna afectada

              [ Cancelar ]  [ Aplicar ]
```

Con **deshacer** durante toda la sesión. Especialmente importante si el parche llega estando ya de viaje.

### 9.4 Historial

Guardar cada archivo aplicado. Permite reconstruir el estado y revertir.

---

## 10. Validador

**Es lo primero que hay que construir**, antes que la interfaz. Con un validador sólido, el resto es presentación.

### 10.1 Errores estructurales

- Campos obligatorios ausentes, tipos incorrectos
- Referencias rotas: `place` que no existe, `stay` inexistente
- Ids duplicados
- `version` no creciente

### 10.2 Avisos lógicos — el valor real

| Comprobación | Ejemplo real |
|---|---|
| Llegada fuera de horario | «Teatro Romano: llegada 16:20, los domingos cierra a las 14:00» |
| Ancla imposible | «No se llega a la Freiduría antes de 16:30 con las duraciones actuales» |
| Día sobrecargado | «Domingo: 9 h de contenido entre startTime y la última ancla» |
| Coordenadas sospechosas | «Wat Pho está a 340 km del resto de paradas del día» |
| Coordenadas ausentes | «3 sitios sin resolver» |
| Datos sin verificar | «7 datos marcados unverified» |
| Traducciones faltantes | «12 campos sin `en`» |
| Salto geográfico | «2 min de trayecto a pie para 1,3 km: 39 km/h» |
| `travelFrom` obsoleto tras un `remove` | «wp-09 sigue midiendo desde la parada que se acaba de borrar» |
| Id reutilizado | «wp-10 se eliminó y se ha vuelto a crear: el registro se indexa por id» |

**La comprobación de velocidad es asimétrica, y tiene que serlo.** Sobre el propio
fixture bueno de Sevilla hay tramos a 1,1 · 1,5 · 2,4 km/h: la Catedral con cola, un
niño, un rodeo buscando sombra. Todos legítimos. **Ir despacio es una ciudad; ir
demasiado rápido es un dato equivocado.** Sólo se avisa de lo segundo, y con techos
por `travelMode` (a pie 7 km/h, bici 30, coche 130), o el archivo correcto se llena
de ruido y se deja de mirar.

**Las coordenadas sospechosas se miden sobre la biblioteca entera, no día a día**, y
por distancia al vecino más próximo. Así el sitio que se ha ido a Madrid canta
aunque su parada acabe de caerse del itinerario, y un viaje Bangkok–Chiang Mai no da
falsos positivos: cada grupo tiene compañía cerca, y sólo delata al que se queda
solo.

**Los horarios que cruzan medianoche son legales.** `[["20:00","02:00"]]` es un
mercado nocturno, no un intervalo invertido. Sólo se marca como error cuando el
cierre cae después de las 06:00, que ya no es de madrugada sino un dato al revés.

### 10.3 Formato del error, pensado para pegar de vuelta

```
[E102] days.d05.waypoints.wp-05-07 → place "wat-arun-museum" no existe en places
[W211] days.d05.waypoints.wp-05-03 → llegada prevista 16:20; cierra domingos 14:00
[W240] places.genoves.facts[1] → confidence "unverified" sin source
```

Se copia el bloque, se le pega a la IA, devuelve el archivo corregido. **Ese bucle de reparación importa más que el propio esquema.**

### 10.4 Catálogo de códigos

| Código | Qué es |
|---|---|
| `E001` | `version` no creciente |
| `E100` · `E101` | Campo obligatorio ausente · sobre inválido |
| `E102` · `E103` · `E105` | Referencia rota a `place` · `day` · `stay` |
| `E104` | Id duplicado |
| `E110` · `E111` · `E112` · `E113` | Duración negativa · tipo incorrecto · hora inválida · intervalo horario inválido |
| `E120` | Ruta por índice en vez de por id |
| `E130` · `E131` | Operación desconocida · ruta no encontrada |
| `W211` · `W212` · `W213` · `W214` · `W215` | Llegada fuera de horario · ancla inalcanzable · día sobrecargado · horario desconocido · ancla vencida |
| `W230` · `W231` · `W232` | Coordenadas sospechosas · velocidad implausible · coordenadas ausentes |
| `W240` | `confidence: verified` sin `source` |
| `W250` | Traducción faltante |
| `W260` · `W261` · `W262` | Se borra un waypoint con registro · `travelFrom` del sucesor obsoleto · id reutilizado |

Los tres últimos existen porque el registro se indexa por id de waypoint. Un `remove`
deja al sucesor midiendo desde una parada que ya no está, y un id reutilizado hereda
en silencio los datos del anterior. Ninguno de los dos rompe el archivo, y por eso
son avisos y no errores; los dos arruinan el viaje si nadie los ve.

---

## 11. Librería y exportación

### 11.1 Librería

Pantalla de inicio con los viajes: activo, próximos, terminados. Un viaje pasa a terminado cuando pasa su `endDate`.

De cada uno: fechas, número de días, paradas visitadas frente a planificadas, mapa en miniatura.

### 11.2 Exportación `.trip`

Un `.zip` con extensión propia:

```
viaje.trip
├── manifest.json      formato, tripId, versión, fecha de exportación
├── plan.json          plan consolidado tras aplicar todos los archivos
├── journal.json       el registro del usuario
├── history/           archivos originales aplicados, en orden
└── media/             fotos de waypoints improvisados
```

Registrar la extensión en el manifest de la PWA para que iOS la abra en la app.

**Para qué sirve:** devolvérselo a la IA al planificar el siguiente viaje, con datos reales en vez de estimaciones optimistas.

---

## 12. PWA

### 12.1 Requisitos

```html
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<link rel="apple-touch-icon" href="…">
<link rel="manifest" href="manifest.json">
```

```json
{
  "display": "standalone",
  "start_url": "./",
  "theme_color": "#1F6070",
  "background_color": "#DCE2E1",
  "icons": [ { "src": "icon-180.png", "sizes": "180x180", "type": "image/png" } ]
}
```

### 12.2 Service worker

- **App shell:** precache en install. Estrategia cache-first.
- **Datos:** en IndexedDB, no en la caché del SW.
- **Actualización:** comprobar al arrancar con red. Nunca actualizar sin avisar durante un viaje activo.

### 12.3 El aviso crítico sobre el almacenamiento

**Safari borra el almacenamiento de sitios web no visitados en 7 días.**

**Las PWA instaladas en la pantalla de inicio están exentas.**

Si no se instala, se llega al destino con la caché vacía. La app debe **detectar si se está ejecutando instalada** y, si no lo está, mostrar un aviso permanente hasta que se instale.

```js
const instalada = window.matchMedia('(display-mode: standalone)').matches
                  || window.navigator.standalone === true;
```

### 12.4 Alojamiento

GitHub Pages. Gratis, HTTPS, dominio propio opcional. **Solo se toca para instalar y actualizar la app.** Durante el viaje no se usa la red.

---

## 13. Alcance

### v1 — el viaje de Tailandia

- [x] Validador con errores pegables
- [~] Carga de archivos con diff y deshacer — *diff y ensayo hechos; falta deshacer e interfaz*
- [x] Modelo de datos completo (§4) — *§5, el registro, pendiente*
- [x] Vista de día `explore` con línea de tiempo bilingüe
- [ ] Vista de día `transit` con cuenta atrás
- [x] Motor de tiempos: horas calculadas, holgura, avisos con histéresis
- [~] Estados de waypoint y propuesta de recorte por `dropRank` — *recorte hecho; estados sin persistir*
- [ ] Waypoint improvisado y modo libre
- [ ] Documentos, frases y direcciones en escritura local
- [ ] Mapa offline PMTiles + MapLibre **(sujeto al spike)**
- [ ] Export GPX
- [ ] Librería y export `.trip`
- [ ] PWA instalable con detección de instalación

### Después

- Fotos por marca de tiempo cruzando el carrete con las horas de cada parada
- Resumen de cierre del día
- Multiplicador de ritmo aplicado a la planificación
- Biblioteca de sitios compartida entre viajes
- Distribución pública con generación por IA del usuario

---

## 14. Orden de construcción

1. **Spike de OPFS.** Decide si los mapas entran en v1. Dos horas. — *pendiente, va en paralelo*
2. ~~**Modelo y validador.**~~ ✅ Hecho con el fixture de Sevilla en vez del de Cádiz.
3. ~~**Vista de día estática.**~~ ✅ **Hito superado: el HTML del domingo 13 sale de `sevilla-test.trip.json`.**
4. ~~**Motor de tiempos y avisos.**~~ ✅ Simulables cambiando el reloj (`npm run sevilla`).
5. **Estados, improvisación, modo libre.** ← *siguiente*
6. **Carga de archivos con diff.** — *el diff está; falta deshacer e interfaz*
7. **PWA y offline.**
8. **Mapa**, si el spike salió bien. Si no, GPX.
9. **Librería y exportación.**

**El paso 3 era la prueba de fuego, y la pasó.** El modelo aguantó los once waypoints
del domingo sin forzar el esquema. Los tres ajustes que hicieron falta (§4.7, §6.2,
§6.3) son de motor, no de formato: ningún archivo de viaje cambia.

**Decisión de plataforma: PWA, no nativo.** Una app nativa firmada con un Apple ID
gratuito **deja de arrancar a los 7 días**, y el viaje son tres semanas. Con cuenta
de pago el certificado dura un año, así que nativo sólo es viable pagando los 99 $/año.
Una PWA instalada no caduca. Además, de los siete riesgos de §15, cuatro son de
almacenamiento y afectan casi sólo a los 150 MB de teselas: el plan, el registro y el
armazón son unos pocos megas, muy lejos de la presión de desalojo.

### 14.1 Núcleo construido

Sin framework, sin empaquetador y sin paso de compilación: Node ejecuta el TypeScript
directamente. Dependencias de ejecución: ninguna. El núcleo es independiente de la
plataforma, así que sobrevive intacto si algún día se cambia de armazón.

```
src/model/     esquema §4
src/core/      time · schedule (§6.1–6.2) · hours · geo · alerts (§6.3)
src/patch/     paths (§4.9) · apply · diff (§9.3)
src/validate/  issues (§10.3) · plan (§10.2) · validate (§9.2)
src/render/    vista de día bilingüe
```

```bash
npm test        # 41 pruebas
npm run sevilla # pasada completa sobre los fixtures
```

---

## 15. Riesgos

| Riesgo | Mitigación |
|---|---|
| OPFS no persiste 150 MB en iOS | Spike previo. Plan B: Organic Maps + GPX |
| Coordenadas alucinadas por la IA | `coordsSource`, geocodificación, confirmación visual en mapa |
| El esquema no aguanta un viaje largo | Paso 3: reproducir Cádiz antes de seguir |
| Sin conexión no se puede reparar un archivo malo | Validador estricto **antes** de salir; el plan viaja completo |
| Safari desaloja la caché | Detección de instalación + aviso permanente |
| Mapa mudo en Tailandia | Cachear glyphs de rangos tailandeses y sprites |
| Sobreingeniería | v1 cerrada. Todo lo demás va a «Después» |

---

## Apéndice — Datos de prueba

Usar el itinerario Cádiz del 26 de julio de 2026 como caso de prueba, porque contiene los casos difíciles reales:

- 17 waypoints con dos anclas duras (freiduría 16:30, salida 17:00)
- Un conflicto de horario detectable (Teatro Romano, domingos hasta las 14:00)
- Dos datos `unverified` (césped del Genovés, perros en Santa Catalina)
- Una parada opcional con `dropRank` bajo (Castillo de San Sebastián)
- Contenido bilingüe completo
- Un orden de recorte ya decidido: San Sebastián, Candelaria, Puerta de Tierra, El Pópulo

Si la app reproduce esa guía desde JSON y detecta el conflicto del Teatro Romano, el modelo funciona.
