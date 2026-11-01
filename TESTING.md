# Validación de SECURITY CAM

Entorno de desarrollo: Node 24.19.0, Python 3.12.14 y Chromium headless con Playwright. Sin iPhone conectado; WebKit no está instalado.

Comprobaciones realizadas y completadas:

- `npm ci --no-audit --no-fund` y `npm run build`: instalación con lockfile y compilación de sintaxis Safari 12.
- `node --check app.js`, `git diff --check`, parseo TOML, igualdad de las dos entradas HTML y hashes del modelo: correctos.
- `tests/smoke.py`: cámara sintética sin micrófono; REC ligado a MediaRecorder; clip real guardado en IndexedDB, reproducible y marcado importante; sirena Web Audio y silencio; movimiento sobre una secuencia controlada; dibujo de zona; carga e inferencia del modelo local; cierre sin excepciones JavaScript.
- `tests/guards.py`: predicciones inyectadas para comprobar que la sirena automática necesita consentimiento, zona y confirmación en modo ALARMA; SILENCIOSO detiene sonido; píxeles de máscara negros y foto; fallo de cuota inyectado con descarga de emergencia, REC apagado y bloqueo de nuevos clips; controles móviles.
- `tests/extras.py`: MP3 de diagnóstico importado, almacenado y decodificado/reproducido con Web Audio; silencio; PIN; persistencia tras recarga; flash deshabilitado sin capacidad; vídeo nativo bloqueado si no puede aplicar máscara; rotación real de clips continuos y desarmado sin reinicio de grabación.
- `tests/torch.py`: capacidades y órdenes simuladas, límite temporal de linterna, alternancia lenta, apagado al desarmar y cancelación de continuación de alarma tras silenciar durante audio pendiente. **No prueba un flash físico.**
- Comprobación adicional en navegador: diagnóstico integral genera una foto y un clip corto real guardado, reinicio manual de cámara y alternativas al simular ausencia de MediaRecorder y Pointer Events.

Los archivos de prueba no son audios ElevenLabs. La precisión de IA con personas, los falsos positivos de movimiento y la detección nocturna no se han medido en una vivienda real. La prueba de inferencia demuestra ejecución del modelo, no su precisión. La prueba de cuota fuerza un error de escritura; no llena el disco.

Pendiente en el iPhone destino: Safari/versión iOS, permisos HTTPS, linterna real, duración y formato de clips, exportación/descargas, reproducción audible de los MP3, interrupciones del sistema, comportamiento prolongado, batería/calor, límites y expulsión de IndexedDB, velocidad de IA, precisión diurna/nocturna y ajuste de zonas. No se ha publicado en Netlify ni se ha validado un despliegue público. No hay transmisión remota.

## Corrección de fluidez e interfaz

- `tests/live.py`: móvil de 390 px con ajustes plegados; vídeo nativo visible; lienzo de anotaciones transparente fuera de zonas. Se bloquea intencionadamente la promesa de inferencia y se comprueba que el contador real de fotogramas del vídeo sigue avanzando (al menos 5 fotogramas en 1,3 s). ON/OFF nocturno cambia filtros reales y persiste tras recarga.
- Se volvieron a ejecutar smoke, guards y extras después de separar el vídeo, análisis reducido y reloj de grabación. Las pruebas funcionales abren explícitamente los paneles avanzados; la prueba de interfaz comprueba que están cerrados por defecto.
- Sigue sin haber medida de fluidez/latencia en el iPhone físico.

## Aviso fijo y sirena condicionada

`tests/warning.py` pasó con el MP3 real adjuntado de 22,125 segundos: reproducción efectiva con Web Audio, ausencia de sirena durante la explicación, cancelación cuando desaparece una detección controlada y sirena únicamente al completar el audio con detección persistente. No hay selectores para subir MP3. Se actualizaron y ejecutaron smoke, guards y extras; el PIN utiliza teclado propio en pantalla. Detecciones de estas pruebas son controladas y no miden precisión física.

## Inicio simplificado

`tests/protect.py` pasa con la nueva pantalla: el usuario selecciona Movimiento y toca Proteger esta imagen; se comprueba cámara real sintética, contexto de sonido activo, zona autorizada y modo de alarma. Una secuencia controlada atraviesa el detector real (sin inyectar banderas de armado ni detección) y reproduce el audio completo antes de activar una sirena Web Audio. El desarmado y navegación a evidencias también se comprueban. No demuestra volumen físico ni comportamiento de Safari en un iPhone.

## Reproducción multimedia para iPhone

Se sustituyó Web Audio por HTMLAudioElement tanto para el MP3 de aviso como para la sirena local. `tests/media_audio.py` comprueba reproducción real con tiempo avanzando, elemento sin mute, volumen positivo, petición de sesión playback mediante API simulada, silencio inmediato, rechazo de play() inyectado y pausa inesperada. Las pruebas de protección, clips, PIN y secuencia volvieron a pasar con el nuevo reproductor. No se ha verificado el altavoz ni el comportamiento del interruptor de silencio en un iPhone. Las pruebas anteriores que citan Web Audio corresponden al motor sustituido.

## Inicio con cristal y preparación remota

- `tests/shell.py`: Inicio sin permiso de cámara, visor sin cámara local, navegación que conserva captura y regreso a evidencias: pasó.
- `node --test tests/signaling.test.mjs`: autenticación, rechazo de claves, negociación autorizada, revocación y guardas de producción: pasó (2 tests).
- `tests/remote.py`: no pasó. Ambos pares negociaron offer/answer y recopilaron cero candidatos ICE; una prueba mínima de dos RTCPeerConnection independiente de esta app también produjo cero candidatos y no conectó. No se atribuye la falta de vídeo a una causa de red concreta sin más evidencia.
- No se ha desplegado WSS ni TURN ni comprobado vídeo desde redes distintas. La aplicación presenta ese requisito y no afirma conexión antes de observarla. El código de señalización está preparado para despliegue; esto no es una afirmación de disponibilidad remota.

## PIN obligatorio y diseño unificado

Pasaron los formularios reales de `tests/security.py`: doble confirmación, rechazo de PIN incorrecto, entrada al recargar, cancelación que conserva el estado, autorización para activar/desactivar, bloqueo manual, silencio de emergencia sin desarmar y cambio confirmado de PIN (el anterior deja de funcionar). Pasaron también protección con audio y sirena, reproducción multimedia, navegación, grabaciones guardadas y reproducibles, máscaras y clips continuos a través de los controles actuales.

Las capturas se inspeccionaron en un viewport móvil de 390 px. No hay bypass de PIN en producción: los helpers de Playwright crean e introducen un PIN real. Sigue pendiente la validación física de Safari, cámara y audio tras el formulario. El acceso remoto conserva las limitaciones documentadas anteriormente.

## Integración Supabase preparada

Se añaden tests locales de PostgreSQL/RLS con PGlite, de la función Edge con Auth/RLS simulados y del cliente real Supabase con HTTP de fixture. Comprueban aislamiento de cuentas, denegación a anónimos/cuentas deshabilitadas, secreto TURN fuera del cliente, credenciales efímeras, rechazo de claves privadas en UI, sesión en memoria y error explícito si falta TURN. No se ha aplicado SQL ni desplegado ninguna función en un Supabase real; el vídeo exterior y las políticas de Realtime del servicio siguen sin verificar.

Resultado de esta fase Supabase: pasaron 3 pruebas Node (políticas PostgreSQL y 2 casos de función Edge), la prueba del SDK con respuestas HTTP controladas y las regresiones de PIN, protección con audio/sirena, reproducción multimedia e Inicio. No se han ejecutado migraciones ni funciones en un proyecto remoto.

## Sustitución completa por interfaz de aplicación

La suite actual se ejecuta con `npm test`: app_interface (bienvenida, perfil local, cámaras, formularios y grabación real), security (PIN), protect (detección real con vídeo controlado → audio completo → sirena), media_audio (multimedia y errores), people (carga/inferencia real de modelo local) y app_storage (fallo de IndexedDB inyectado con clip codificado y descarga pendiente que sobrevive al refresco de evidencias).

Se mantuvo el motor y se reemplazaron pantallas, estilos y navegación. El perfil editable se guarda localmente; el acceso Supabase real se prueba con el SDK y HTTP de fixture. No se realiza sincronización de nombres de perfil. El vídeo exterior sigue sin validar por las limitaciones registradas anteriormente. El iPhone real continúa siendo una comprobación pendiente.

## Adaptación a iPhone 14 exterior y grabación por eventos — 2026-11-01

La versión actual sustituye las preferencias anteriores de grabación continua/por detector por un ciclo de episodio con clasificación adicional de personas. Predeterminado silencioso, sin IA ni respuesta sonora automática. El acceso PIN y la cámara nativa se conservan; desbloquear ya no sobrescribe sensibilidades, imagen ni ahorro guardados. La interfaz pasa a grafito y expone los ajustes necesarios en paneles de cámara.

Validación disponible: `npm run build`, `npm test`, comparación de los dos entrypoints y `git diff --check`. La suite actual comprende:

- `app_interface.py`: navegación/perfil local, login sin servicio no simulado, cámara real de navegador con fuente sintética, clip manual, eliminación con PIN y miniatura de Inicio enmascarada.
- `security.py`: creación doble, recarga bloqueada, PIN incorrecto/cancelado sin cambios de vigilancia, autorización y silencio inmediato.
- `event_recording.py`: fotogramas controlados pasan por el analizador real; no hay análisis desarmado; se dibuja una zona mediante puntero; no disparan movimiento exterior ni cambios uniformes de iluminación; movimiento confirmado crea un clip codificado real, miniatura y registro IndexedDB; una salida IA controlada mejora la clasificación sin duplicar clip; se decodifica el vídeo guardado; un episodio persistente no se repite tras cooldown y uno nuevo puede iniciar otro; configuración/zona sobreviven a recarga. La clasificación de este test usa un modelo controlado, no evalúa precisión de reconocimiento.
- `protect.py`: modo Alarma y opciones son explícitos; fotogramas de movimiento disparan aviso MP3 completo y sirena multimedia real; desarmado con PIN.
- `media_audio.py`: el audio nativo avanza sin mute, pide sesión playback si existe, silencio inmediato y errores reales de reproducción/rechazo/interrupción. No prueba altavoz físico.
- `people.py`: carga e inferencia del modelo Human/CenterNet local real, en modo solo-personas; no mide precisión en una entrada real.
- `app_storage.py`: fallo de escritura inyectado sobre clip realmente codificado; REC se apaga, queda descarga pendiente y sobrevive al refresco del listado.
- `compatibility.py`: ramas de capacidad simuladas (sin MediaRecorder, sin canvas.captureStream/torch), clip nativo real sin micrófono, rechazo de máscara que no puede protegerse, audio bloqueado conserva vigilancia y muestra su error, permiso de cámara rechazado, descarte de inferencia pendiente tras reinicio y parada al perder pista.

Límites de la comprobación: Chromium en Linux, sin iPhone físico ni WebKit instalado. No verificados Safari real, salida de altavoz/Silencio/Bluetooth, torch del iPhone 14, formato y calidad exactos negociados, cuota/expulsión real de Safari, detección de personas de noche, falsos positivos por lluvia/sombras, temperatura/batería dentro de carcasa ni sesiones de muchas horas. El indicador LOW POWER es configuración y no un sensor. Los avisos de propiedad/abandono separados están desactivados porque solo hay un archivo de voz suministrado. La integración remota preparada no fue desplegada ni certificada como vídeo fuera de casa por esta tarea.

## Corrección de personas pequeñas y edición táctil — 2026-11-01

Esta revisión sustituye los valores y la lógica de detección descritos en la sección anterior. La captura predeterminada es HD 1280, análisis 256, personas activadas con umbral 45% e intervalo 2 s y ahorro desactivado. Se conserva la configuración de zona, máscara, clips y audio durante la migración técnica. Movimiento usa fotogramas y fondo adaptativo, compensación global y componentes conectados. Personas puede iniciar un episodio aunque movimiento esté habilitado y no haya confirmado; las detecciones se fusionan en un solo episodio/clip.

Cambios verificados específicamente:

- Cinco pruebas Node en `detection.test.mjs`: objeto coherente de menos del 0,4% del fotograma, confirmación temporal, rechazo de luz uniforme y ruido aislado, exclusión de zona/máscara, transformación de recortes y retención/deduplicación/caducidad de observaciones entre pasadas. Las cajas retenidas muestran su antigüedad; no se actualiza su timestamp sin detección.
- `zones_touch.py`: eventos táctiles reales del navegador con viewport móvil; dibujar inicia la cámara sin armar, borrador no altera zona guardada, Guardar/Cancelar, arrastre de esquinas y del rectángulo, cancelación del gesto, orientación horizontal, PIN antes de editar armado y persistencia tras recarga. No se usó un iPhone real.
- `event_recording.py`: el objeto de movimiento de la secuencia ahora mide 14 × 76 dentro de 640 × 480; ocupa aproximadamente 0,35% del fotograma y pasa por el analizador real hasta guardar/decodificar un clip. Se conserva exclusión de zona, luz uniforme, clasificación y supresión de clips persistentes.
- `people_trigger.py`: salida de modelo controlada con una imagen estática, ambos detectores habilitados; la persona inicia una grabación silenciosa sin movimiento. Comprueba que las cajas de un detalle de 512 px se remapean a coordenadas de la cámara. No es una medición de precisión del modelo.
- `person_alarm_confirmation.py`: salida de modelo controlada; una observación retenida de persona no activa sirena si una inferencia actual es negativa; una confirmación positiva posterior activa la sirena multimedia real. El clip sigue grabando aunque se cancele la sirena. Se verifica también `protect.py` con aviso MP3 real completo y sirena por movimiento.
- `people.py`: sigue cargando y ejecutando el modelo local real. Se mantiene el conjunto anterior de pruebas de interfaz, PIN, audio, almacenamiento y capacidades.
- `person_detail_photo.py`, ensayo opcional con imagen pública local: modelo real sobre peatones pequeños dentro de una escena 1920 × 1080; a umbral 45%, 0 detecciones en vista general frente a 2 en recorte original, con confianza máxima 31% y 70%, respectivamente. Procedencia y SHA-256 en `tests/fixtures/PEDESTRIANS.md`. No prueba diez metros físicos ni escenas nocturnas.
- `supabase_ui.py`: SDK real con HTTP simulado, sin enviar credenciales de pruebas al proyecto del propietario. La URL/anon proporcionadas quedan precargadas para el cliente, sin iniciar conexiones automáticamente. No se han aplicado migraciones ni desplegado funciones con una clave anon. El dominio del proyecto no está incluido en la política de red de este entorno, por lo que no se verificó el servicio vivo.

Se conservan los límites físicos y de Safari anteriores: sin pruebas de iPhone 14, termómetro, altavoz físico, exterior nocturno, lluvia ni sesiones prolongadas. Los recortes aprovechan la captura original y no crean detalle óptico ni garantizan un alcance de 10 m. No se afirma que el proyecto Supabase esté completamente desplegado o que funcione vídeo remoto.


## Acceso local y azul suave — 2026-11-01

Se retiran los formularios de cuenta y las entradas de vinculación/monitor que dependían de ese acceso. La app carga únicamente detección, motor, PIN y navegación local; los scripts Supabase y WebRTC preparados no se cargan. Se conserva perfil local, PIN, controles de vigilancia, clips y zonas. Las rutas antiguas de cuenta/monitor llevan a Inicio. El tema usa un fondo azul apagado con paneles azul oscuro y conserva los indicadores operativos verdes/rojos.

`app_interface.py` verifica ausencia real de formularios de cuenta, redirección de ruta antigua, ausencia de solicitudes Supabase/WSS, edición/persistencia del perfil, cámara, clip real y navegación de Actividad. La suite `npm test` sigue cubriendo PIN, editor táctil, detección, clips, personas, alarmas, audio y fallos. Las pruebas históricas `supabase_ui.py` corresponden a la interfaz anterior y ya no se aplican a la app local actual. La revisión visual usa capturas móviles de Chromium, sin iPhone físico.


## Respuesta rápida e independencia del ciclo de personas — 2026-11-01

La inferencia de personas deja de bloquear el ciclo de fotogramas/movimiento. Tiene su propio temporizador, conserva exclusión mutua con carga del modelo y confirmación de sirena, y descarta resultados anteriores a cambios de modo, cámara, parámetros, zona o visibilidad. La respuesta rápida empieza con objetivo 350 ms y se adapta al tiempo medido (al menos 1,4 × inferencia y 80 ms de descanso); ahorro mantiene mínimo 5 s. Equilibrado utiliza el intervalo del usuario. El modo rápido no garantiza milisegundos en un iPhone ni elimina trabajo síncrono del modelo en JavaScript.

`person_latency.py` retiene una inferencia con una promesa controlada y verifica que movimiento sigue muestreando, el vídeo nativo avanza y un clip real comienza mientras se espera. Comprueba una sola inferencia concurrente, descarte de resultado tras desactivar el detector y clasificación rápida posterior con un modelo sintético de 80 ms. En la primera ejecución esta clasificación se observó en 152 ms, que es una medida del fixture en Chromium, no de CenterNet ni del iPhone 14. Se conservan campos de tiempo real para inferencia/cadencia e inicio de grabación desde el evento; no representan latencia física desde la llegada de una persona.

El diseño de PIN/interfaz solicitado en este turno queda pendiente de la imagen de referencia anunciada por el usuario. No se ha aplicado un diseño inventado ni se ha recortado la grabación siguiendo personas sin aclarar esa petición: se conserva imagen completa con recuadros en la vista previa.


## Centro de control de cristal oscuro y PIN — 2026-11-01

La imagen de referencia ya está disponible y esta revisión completa el rediseño visual que quedó pendiente en la sección anterior. Se sustituye la hoja de estilo y se reorganiza Inicio con vídeo real, tarjeta local, eventos, estado y navegación de cinco secciones. Se conserva acceso por PIN local, sin login. El mismo módulo de visor y el mismo MediaStream se mueven entre Inicio y Cámara. La captura no empieza al abrir la app; hace falta una acción del usuario. El PIN usa un panel y teclado oscuro coherentes con el dashboard, conservando sus validaciones y autorización.

`glass_dashboard.py` comprueba: PIN nuevo en móvil; cuenta ausente; estados apagado/directo reales; un solo getUserMedia y mismo ID de stream al navegar; fotogramas de vídeo nativo avanzando en Inicio; descarga JPEG real; clip real desde Inicio, guardado local y miniatura vinculada por clipId/eventId; búsqueda local y navegación al clip exacto; búsqueda sin tildes; navegación de Eventos y Clips; PIN para armar/desarmar desde Inicio, cancelación sin cambios; acceso a almacenamiento; ampliación CSS del tamaño del viewport cuando no existe Fullscreen API; detener cámara y restaurar su estado apagado; ausencia de solicitudes Supabase; y ausencia de desbordamiento horizontal móvil/escritorio.

La suite `npm test` incluye ese recorrido junto a PIN, gestos táctiles de zona, movimiento/personas, latencia, grabaciones, sirena/voz y fallos de almacenamiento/capacidades. `app_interface.py` selecciona Solo manual explícitamente al probar su clip manual para que la fuente sintética de movimiento no interfiera con esa prueba; los clips automáticos se prueban por separado.

Capturas de revisión generadas en Chromium: `/tmp/security-glass-pin.png`, `/tmp/security-glass-home-idle.png`, `/tmp/security-glass-home-live.png` y `/tmp/security-glass-desktop.png`. La imagen activa de pruebas es la cámara sintética del navegador, no una vivienda de ejemplo. No se ha comprobado físicamente Safari/iPhone 14, audio del altavoz, temperatura ni sesiones prolongadas por este cambio visual. Las miniaturas de eventos sin IDs históricos no se infieren por cercanía temporal para evitar vincular pruebas equivocadas.


## Solo personas y recuadros desde la vista previa — 2026-11-01

Esta revisión reemplaza el funcionamiento anterior de eventos por movimiento. El modelo se carga y ejecuta al encender la cámara, sin necesidad de armar. El overlay dibuja exclusivamente personas reconocidas, con borde verde y etiqueta de confianza contrastada. Armar sigue requiriendo PIN y autoriza clips/alertas, mientras que desarmado conserva los recuadros sin grabar automáticamente. Movimiento deja de ser opción visible o fuente de eventos, y se migran preferencias antiguas. La atención visual para elegir recortes sigue siendo interna y no puede grabar ni alertar.

Se añade estado de IA visible en Inicio y Cámara, incluido carga, primer análisis, pausa, reconocimiento, error y reintento. Un fallo del modelo no cambia a movimiento. No se permite armar si el modelo no pudo cargarse. El aviso de cámara apagada se oculta de forma síncrona al iniciarla y no intercepta gestos del editor de zona.

- `people_preview.py`: preferencias antiguas se convierten a solo personas; una salida controlada del modelo produce píxeles verdes reales en el overlay antes de armar; Inicio también muestra el recuadro; no hay clips ni sirena en vista previa; armar permite un clip real por persona; eventos de movimiento se rechazan; un fallo de inferencia muestra error y un reintento real recupera el detector.
- `people.py`: el modelo Human/CenterNet real carga y ejecuta en vista previa sin armar ni pedir micrófono.
- `people_loading.py`: se bloquea la descarga real de `centernet.bin`; el error se muestra y no se puede armar. Tras restaurar el archivo, el reintento carga pesos reales y vuelve a inferir. Se detectó que `models.loaded()` del SDK devuelve el nombre incluso con pesos fallidos: ahora se verifican `models.stats()` y los bytes cargados; el reinicio público del SDK invalida su caché parcial antes del siguiente intento. También se comprueba `result.error` de la inferencia, no solo excepciones.
- `people_photo_preview.py RUTA_A_BUS_JPG`, ensayo opcional con el archivo público documentado en `tests/fixtures/PEDESTRIANS.md`: el modelo local real reconoce un peatón y el overlay de la app lo encuadra antes de armar. En la primera ejecución se observó confianza 48%; no hubo grabación. Captura `/tmp/security-real-people-preview.png`. No usa predicciones simuladas; la entrada es una fotografía de prueba, no un iPhone físico ni una prueba de alcance.
- `event_recording.py`: imagen con cambios/movimiento no genera eventos cuando la salida de persona está vacía; una persona de fixture inicia clip real, miniatura, IndexedDB y decodificación; persiste supresión por episodio/cooldown, desarmado con PIN y ausencia de logs nuevos de movimiento.
- `protect.py` y `person_alarm_confirmation.py`: salidas de personas controladas disparan aviso MP3 y sirena multimedia reales, exigiendo confirmación actual de persona. No se depende de movimiento.
- `person_latency.py`: IA retenida no graba automáticamente; el vídeo y un clip manual real siguen funcionando; el resultado desactivado se descarta y una persona posterior sí inicia clip, con una sola inferencia a la vez.
- Las pruebas de navegación, PIN y capacidades usan `empty_people_model` de forma explícita para aislar esos flujos del reconocimiento. El modelo real se prueba por separado. Los tests puros de `detection.test.mjs` corresponden a atención visual/recortes, no a un detector de movimiento habilitado para vigilancia.

Se conservan los límites físicos anteriores: no se ha comprobado la cámara, Safari, calor ni altavoz de un iPhone real. Los recuadros no garantizan identificar a todas las personas, visión sin luz ni alcance de diez metros. El estado de IA hace visibles esas limitaciones y errores en vez de afirmar detección inexistente.


## Invitaciones entre móviles — 2026-11-01

El flujo nuevo no restaura email/login ni la antigua cuenta compartida. Usa Anonymous Auth persistente por instalación después del PIN. La vigilancia local sin emparejamiento no carga el SDK ni contacta con Supabase. `supabase-config.js` contiene únicamente configuración pública y se permite cargarlo localmente en las pruebas de ausencia de tráfico cloud.

- `pairing_rls.test.mjs`: PostgreSQL local/PGlite, migración idempotente, permisos de columnas y RPC, rechazo de rol anon y terceros, ocultación del hash, un solo uso/caducidad, separación visor/cámara, lease exclusiva, rechazo de cierre antiguo, canales privados de ambos miembros, revocación y cuota por instalación. Claims Auth y realtime.topic son fixtures; no se ha aplicado SQL en el proyecto real.
- `supabase_edge.test.mjs`: la función valida Auth y el vínculo consultando REST con el bearer del solicitante y RLS antes de generar credenciales. Cubre configuración Coturn, credenciales alojadas Cloudflare filtradas a TURN, TTL, ausencia de filtración del token maestro, proveedor caído y denegación sin llamar al proveedor. El proveedor y Auth son respuestas controladas, no servicios reales.
- `pairing_ui.py`: dos contextos Chromium aislados, SDK Supabase local real y servicio HTTP/Realtime controlado; creación con PIN, copia de enlace, fragmento retirado de URL y retenido solo en sessionStorage hasta aceptación, recarga pendiente, aceptación explícita sin cámara, sesión de dispositivo persistente, errores de SQL/TURN reales del cliente, permisos de cámara solo en host, canal privado y ofertas/respuestas SDP reales del navegador, ausencia de LIVE sin fotogramas, bloqueo desconecta/libera lease, replay denegado y desvinculación. La señalización de fixture usa el protocolo Phoenix del SDK y no simula éxito de vídeo. `supabase_ui.py` remite a esta prueba en sustitución del login antiguo eliminado.
- Regresiones: panel glass, PIN/entrada/recarga/armado y cancelación, navegación, perfil y vista previa de personas siguen comprobándose en sus pruebas existentes. `npm test` incluye invitaciones, SQL y Edge.

Captura local de revisión: `/tmp/security-camera-invitation.png`. No se ha probado vídeo real por TURN, API real de Cloudflare, Supabase real, Wi-Fi frente a datos móviles, iPhone físico, Safari o temperatura. Los vínculos necesitan los pasos administrativos de `supabase/PAIRING_SETUP.md`; un build de Netlify no despliega estos componentes.

### Instalación en la tabla Realtime gestionada

Tras el error real `42501: must be owner of table messages`, las dos migraciones dejan de ejecutar ALTER TABLE/GRANT sobre `realtime.messages`. La documentación oficial de Supabase confirma que RLS ya está activo y que `supautils` permite a postgres crear políticas sin ser propietario. Las pruebas locales ahora preconfiguran RLS/grants como prerrequisitos de la plataforma. La prueba de emparejamiento rechaza la reintroducción de ALTER TABLE, verifica que sin RLS la instalación falla y revierte las tablas nuevas, y vuelve a comprobar aislamiento, caducidad, leases y revocación con RLS activo. PGlite no simula la extensión supautils; sigue pendiente reejecutar el SQL corregido en el proyecto real.


## Control remoto desde el visor — 2026-11-01

El visor vinculado recibe el estado de la cámara cada 2 s y puede enviar tres órdenes por el canal privado del directo: armar/cambiar modo, desarmar y silenciar. Armar/desarmar exigen el PIN local del visor; la cámara ejecuta la misma rutina que su botón Armar (exige modelo de personas y cámara activa) y responde con el resultado. `tests/pairing_ui.py` lo comprueba con dos navegadores, SDK real y servicio controlado. No se ha probado con Supabase real ni en iPhones físicos.


## Jarvis en la portada y cámara en /camara — 2026-11-01

La app de vigilancia pasa a `camara.html` (`/camara` en Netlify) sin cambios de funcionamiento; las pruebas usan esa ruta y siguen pasando. Los enlaces de invitación antiguos a la portada se redirigen a `/camara`. `tests/jarvis.py`: los modelos reales de caras cargan y analizan la cámara sintética sin pedir micrófono; órdenes de hora, día, temporizador (aviso real a 1 s), chistes y dispositivos aún no conectados; registro de cara, saludo una vez por llegada y ninguno a desconocidos con un detector controlado; persistencia y borrado; redirección de invitaciones. No hay foto real de una cara en las pruebas: la precisión del reconocimiento facial y el reconocimiento de voz de Safari solo se validan en el iPhone.


## Jarvis: diseño de cristal, voz ElevenLabs y escucha robusta — 2026-11-01

Portada rediseñada (negro, cuadrícula, burbuja de cristal que flota, escucha y habla; se toca para hablar). Voz con ElevenLabs mediante la función `jarvis-voice`, que guarda la clave del proveedor en Supabase y exige una clave privada de Jarvis. `tests/jarvis_voice.test.mjs` cubre origen, clave, longitud de texto, errores del proveedor y que la clave nunca vuelve al navegador. `tests/jarvis.py` simula ElevenLabs y un reconocedor que se cuelga: respuesta normal, reconocedor sin evento final, silencio, micrófono denegado y cancelación; en todos la burbuja vuelve a reposo. El modelo de caras se pausa mientras escucha o habla. Sin probar todavía con la cuenta real de ElevenLabs ni en Safari del iPhone.
