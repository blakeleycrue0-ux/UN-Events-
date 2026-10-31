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
