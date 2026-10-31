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
