# SECURITY CAM

Videovigilancia **local** para un móvil fijo. Cámara sin micrófono, movimiento, grabación por clips, IA opcional, audios y alarmas con consentimiento explícito. No transmite vídeo ni sube evidencias. La antigua web se conserva en `archive/eventos.html`.

## Uso y Netlify

La aplicación compilada está incluida. El diagnóstico comprueba escritura local, ausencia de micrófono y codificación de fotografía; con cámara activa y vigilancia desarmada crea además un clip corto real de prueba. Durante vigilancia no interrumpe la grabación existente. Publica esta carpeta en Netlify, con HTTPS. No requiere backend, claves, cuenta de IA ni llamadas a CDN durante su uso. `netlify.toml` configura permisos y cabeceras. No se ha desplegado automáticamente.

Para desarrollar:

```sh
npm ci
npm run build
npm start
```

Servidor local: puerto 8001. Para editar lógica utiliza `src/app.js` y recompila. `index.html` y `Index.html` contienen la misma interfaz para mantener compatible la ruta original; actualiza ambos si editas el HTML. No hace falta instalar paquetes para servir los archivos compilados. Las dependencias npm son solo de compilación. El directorio publicado debe contener `models/` y `vendor/`.

1. Inicia la cámara y acepta permiso. Selecciona otra cámara si hace falta.
2. Pulsa **Habilitar sonido** y prueba cada audio. El aviso ElevenLabs adjuntado está incluido en assets/aviso-seguridad.mp3 (22,1 segundos); no hay carga ni sustitución de audios desde la interfaz. La sirena sintetizada funciona sin MP3. Los avisos no deben afirmar que se graba si has desactivado la grabación; comprueba el contenido de tus archivos.
3. Dibuja la zona de tu entrada. Añade una máscara sobre zonas ajenas. Revisa el encuadre después de cambiar cámara o zoom.
4. Selecciona grabación manual, movimiento, personas o continua. Activa vigilancia. El modo inicial es desarmado y la alarma automática está deshabilitada.
5. Para alarma automática: elige Solo personas o Movimiento, define tu zona (o acepta expresamente toda la imagen de tu propiedad) y habilita Aviso de voz y después sirena. Esta acción selecciona modo ALARMA y prepara el detector. Activa vigilancia y concede sonido con el gesto del botón. Requiere detecciones positivas sucesivas durante el tiempo de confirmación. Movimiento solo puede iniciar la secuencia si se ha seleccionado expresamente como fuente de alarma. La ausencia durante dos inferencias permite crear un nuevo evento de persona. No es identificación biométrica ni seguimiento de identidad.
6. Descarga las evidencias importantes. El botón REC se muestra tras el evento real de inicio de MediaRecorder, y se apaga al detenerse. El registro distingue inicio, guardado y pérdida.

DESARMADO muestra la cámara y permite acciones manuales. SILENCIOSO procesa detectores y graba según el modo de grabación elegido, sin avisos automáticos. DISUASORIO permite avisos seleccionados e iluminación por evento. ALARMA permite sirena y luz lenta por persona confirmada en zona con autorización explícita. Cambiar de modo no reinicia la cámara.

## Directo fluido y modo noche

El monitor utiliza el vídeo nativo de la cámara; no muestra capturas del análisis. El lienzo superior solo dibuja zonas, máscaras y detecciones. Una inferencia lenta no espera para actualizar el vídeo. El movimiento se analiza directamente a 128/192 px; los clips procesados tienen su propio reloj de 5/10 fps. La fuente solicita 720p con restricciones ideales: el iPhone puede entregar otra resolución.

La pantalla principal contiene cámara, vigilancia, grabación y **Noche: AUTO / ON / OFF**. Más controles, ajustes y evidencias están plegados. Noche automática usa luminancia medida con histéresis (activar por debajo de 40/255, desactivar por encima de 65/255). ON fuerza la mejora y OFF la desactiva. El vídeo nativo usa brillo/contraste CSS para evitar copiar píxeles a la pantalla. Gamma se aplica a imágenes de análisis, fotos y clips procesados; no se promete corrección gamma exacta en el directo nativo. No hay visión infrarroja ni recuperación de objetos sin luz.

## Compatibilidad y límites reales

- Cámara: HTTPS y `getUserMedia`; nunca se solicita micrófono. Si la cámara se desconecta, se registra el fallo y hay reinicio manual. Safari exige interacción inicial y puede interrumpir cámara en segundo plano. **No sirve con el iPhone bloqueado ni garantiza vigilancia desatendida.** No hay servicio en segundo plano.
- Scripts compilados con destino de sintaxis Safari 12. Esto no garantiza que todas sus APIs estén disponibles. Grabación web en Safari antiguo puede no existir; en ese caso se informa del fallo y hay fotografía manual. Recomendado iOS 14.5 o posterior, preferiblemente actualizado.
- `MediaRecorder.isTypeSupported` selecciona MP4 o WebM. Si `canvas.captureStream` existe, se graba la imagen procesada con máscara. Si falta, se permite grabación nativa **solo sin máscara ni zoom**. Brillo, contraste y gamma en ese caso se aplican al monitor, análisis y fotografías, no al vídeo nativo; queda registrado. Nunca se graba deliberadamente una máscara sin aplicar. Los clips son de 10/20/30/60 segundos; la grabación continua rota clips con un pequeño intervalo de cierre/guardado, no es vídeo continuo sin huecos.
- Fotos y procesamiento usan Canvas 2D. Brillo/contraste/gamma se aplican por píxel; no dependen del soporte incompleto de filtros Canvas de Safari. No añade detalle que no capte el sensor, visión IR ni garantía nocturna. La advertencia de poca luz usa luminancia medida. La corrección de cambios globales de luminosidad, umbral de área y confirmación de movimiento reducen algunos falsos positivos; **no garantizan filtrar lluvia o sombras**.
- IA: Human 3.3.6, solo objeto CenterNet MobileNet, pesos locales ~4 MB, runtime ~1.6 MB cargados solo al habilitar IA. Rostros, manos, pose y otros modelos desactivados. WebGL, RAM y velocidad dependen del iPhone. Un error deshabilita IA y conserva movimiento. Inferencia secuencial con intervalo configurable; análisis 128/192 px, entrada de IA 320 px, captura nativa objetivo 1280×720 (según el dispositivo), clips procesados hasta 640 px. Baja luz, distancia, obstáculos y campo de visión limitan precisión. El modo bajo consumo reduce frecuencia y resolución; el tiempo real de análisis determina una reducción adicional.
- Flash: se consulta `track.getCapabilities().torch` y se verifica cada `applyConstraints`. Si no existe, los interruptores quedan deshabilitados con explicación. Safari en muchos iPhone no lo permite. El patrón lento cambia estado cada 2 segundos, con un máximo configurado de 120 s. El límite es preventivo; **no mide temperatura**. Se apaga al detener vigilancia o cámara.
- Audio: Web Audio se habilita con gesto. El aviso incluido se decodifica con Web Audio en el dispositivo y los errores se muestran. Usa avisos cortos por memoria y no dependas de volumen suficiente sin probar el altavoz físico. Un error de audio no equivale a una sirena audible.
- IndexedDB: transacciones verificadas; cuota estimada cuando existe la API. Por defecto no se borran clips. Si habilitas limpieza, elimina primero los antiguos no importantes al superar el 80%; si no libera suficiente, detiene nuevos clips. Un fallo de guardado ofrece descarga de emergencia y bloquea nuevas grabaciones hasta reiniciar cámara; Safari puede bloquear la descarga automática: usa el enlace visible. **El clip pendiente está solo en memoria hasta descargarlo.** No protege ante apagado, cierre inesperado o expulsión de almacenamiento por Safari. Ni siquiera marcar importante garantiza permanencia.
- Pantalla activa: usa Wake Lock si está disponible; sin él ajusta manualmente el bloqueo automático del iPhone. Al ocultar Safari, pausa análisis, termina clip y silencia. No promete funcionamiento en segundo plano.
- Batería: indicador solo si `getBattery` existe. No se presenta un sensor de temperatura. No hay medida térmica inventada; se muestra tiempo de análisis real y avisos generales de calor/batería.
- PIN local SHA-256: barrera de interfaz; no autentica remotamente, cifra clips ni resiste acceso a las herramientas del navegador o al almacenamiento. Se puede eliminar borrando los datos del sitio.
- Controles de zona usan Pointer Events (Safari/iOS 13+). En versiones anteriores no hay dibujo táctil: actualiza iOS o utiliza un navegador compatible; no configures alarma automática sin zona.

## Arquitectura para un monitor remoto futuro

La captura, detectores, almacenamiento y avisos son servicios locales coordinados por el estado de sesión. Los eventos se publican mediante `security:event` en `document` (sin vídeo ni credenciales). Una futura capa de transporte debe suscribirse a eventos y recibir un flujo de cámara bajo una sesión autenticada explícita, sin alterar el flujo local. No existe ahora transporte remoto, endpoint de vídeo ni servidor abierto.

WebRTC requeriría un servicio de señalización autenticado (por ejemplo WSS), autorización/emparejamiento, intercambio SDP/ICE y normalmente STUN/TURN con credenciales efímeras. Netlify estático puede alojar la interfaz, pero no por sí solo señalización persistente ni un relay TURN. No exponer una cámara con un enlace público sin autenticación. La app local no depende de esa futura infraestructura.

## Validación

Resultados y límites de las pruebas en [TESTING.md](TESTING.md).

Con Python Playwright y Chromium instalados, servidor en puerto 8001:

```sh
python3 tests/smoke.py
python3 tests/guards.py
python3 tests/extras.py
python3 tests/torch.py
python3 tests/live.py
```

La cámara de Chromium es sintética. Se prueba codificación real, guardado/transacción, reproducción del clip, marca importante, cámara sin audio, sirena real Web Audio, movimiento con una secuencia controlada, dibujo de zona y carga/inferencia real del modelo local. Las pruebas de autorización usan predicciones de IA inyectadas (no demuestran precisión de reconocimiento); las de cuota fuerzan el fallo de guardado (no llenan el disco). El test de linterna simula capacidades y órdenes: no demuestra funcionamiento de un flash físico. El tono MP3 de tests/fixtures es un tono de diagnóstico generado, no un archivo ElevenLabs. WebKit no está instalado en esta máquina.

Antes de usarlo en una entrada real, verifica en tu iPhone: permisos HTTPS, cámara trasera estable durante varias horas, MP4 descargado y reproducible, importación de tus MP3/volumen, flash si se ofrece, comportamiento con poca luz, zona y máscara, falsos positivos, velocidad/consumo, límites de Safari y recuperación tras interrupciones. No se ha medido precisión con personas reales ni rendimiento térmico de un iPhone.

## Dependencias locales

`vendor/human.source.js`, `vendor/human.js`, `models/centernet.json` y `models/centernet.bin` proceden del paquete npm `@vladmandic/human@3.3.6`; tarball verificado contra `dist.integrity` SHA-512 del registro npm. Licencia del paquete en `vendor/HUMAN-LICENSE`; CenterNet MobileNet se atribuye en la documentación del proyecto Human a MB3-CenterNet (https://github.com/610265158/mobilenetv3_centernet). Solo se copian los archivos necesarios. `models/PROVENANCE.json` contiene hash SHA-256 de cada archivo de modelo. La aplicación no descarga modelos ni ejecutables de terceros durante vigilancia.

## Aviso seguido de sirena

Se confirma la detección durante el tiempo configurado antes de reproducir el audio suministrado. Solo después de que termine el aviso se inicia la sirena si la detección continúa, con vigilancia, permiso automático y zona válidos. Si desaparece durante la explicación, se detiene el aviso y se cancela la sirena. Para personas esto se evalúa con cada resultado de IA; el intervalo de análisis determina el retraso de cancelación y no equivale a seguimiento perfecto. Para movimiento se cancela al dejar de observar movimiento confirmado; una persona inmóvil puede no mantener ese detector. Un fallo de audio cancela la escalada; no se sustituye por una sirena inesperada. `tests/warning.py` reproduce el MP3 real completo y prueba cancelación y escalada con detecciones controladas.

El PIN se introduce y crea desde un teclado numérico propio de la app, sin cuadros de prompt del navegador. Conserva las limitaciones de seguridad local descritas arriba.
