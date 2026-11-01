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

La pantalla principal contiene el estado de protección, selector Personas/Movimiento y el botón Proteger esta imagen. Noche es automática; los controles manuales de cámara quedan en el panel secundario. Más controles, ajustes y evidencias están plegados. Noche automática usa luminancia medida con histéresis (activar por debajo de 40/255, desactivar por encima de 65/255). ON fuerza la mejora y OFF la desactiva. El vídeo nativo usa brillo/contraste CSS para evitar copiar píxeles a la pantalla. Gamma se aplica a imágenes de análisis, fotos y clips procesados; no se promete corrección gamma exacta en el directo nativo. No hay visión infrarroja ni recuperación de objetos sin luz.

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

Antes de usarlo en una entrada real, verifica en tu iPhone: permisos HTTPS, cámara trasera estable durante varias horas, MP4 descargado y reproducible, reproducción del aviso incluido y volumen, flash si se ofrece, comportamiento con poca luz, zona y máscara, falsos positivos, velocidad/consumo, límites de Safari y recuperación tras interrupciones. No se ha medido precisión con personas reales ni rendimiento térmico de un iPhone.

## Dependencias locales

`vendor/human.source.js`, `vendor/human.js`, `models/centernet.json` y `models/centernet.bin` proceden del paquete npm `@vladmandic/human@3.3.6`; tarball verificado contra `dist.integrity` SHA-512 del registro npm. Licencia del paquete en `vendor/HUMAN-LICENSE`; CenterNet MobileNet se atribuye en la documentación del proyecto Human a MB3-CenterNet (https://github.com/610265158/mobilenetv3_centernet). Solo se copian los archivos necesarios. `models/PROVENANCE.json` contiene hash SHA-256 de cada archivo de modelo. La aplicación no descarga modelos ni ejecutables de terceros durante vigilancia.

## Aviso seguido de sirena

Se confirma la detección durante el tiempo configurado antes de reproducir el audio suministrado. Solo después de que termine el aviso se inicia la sirena si la detección continúa, con vigilancia, permiso automático y zona válidos. Si desaparece durante la explicación, se detiene el aviso y se cancela la sirena. Para personas esto se evalúa con cada resultado de IA; el intervalo de análisis determina el retraso de cancelación y no equivale a seguimiento perfecto. Para movimiento se cancela al dejar de observar movimiento confirmado; una persona inmóvil puede no mantener ese detector. Un fallo de audio cancela la escalada; no se sustituye por una sirena inesperada. `tests/warning.py` reproduce el MP3 real completo y prueba cancelación y escalada con detecciones controladas.

El PIN se introduce y crea desde un teclado numérico propio de la app, sin cuadros de prompt del navegador. Conserva las limitaciones de seguridad local descritas arriba.

## Pantalla Inicio y protección en un paso

La nueva pantalla separa el estado de protección de la vista de cámara. **Proteger esta imagen** habilita sonido desde el gesto, inicia cámara, prepara el detector elegido y autoriza alarma sobre la zona guardada o toda la imagen de la propiedad, según el texto visible. Si no puede preparar cámara, sonido o IA, muestra el error y no dice que esté protegida. Movimiento es una alternativa cuando IA no puede cargar. No basta con ver un rectángulo para que la sirena esté armada: el estado Inicio lo indica expresamente. El botón también desarma. Brillo, contraste y gamma se restablecen automáticamente al activar y sus controles ya no se muestran; el modo noche automático sigue basado en luz medida.

La confirmación del flujo rápido es de un segundo. Movimiento conserva actividad durante 2,5 s para tolerar pausas entre fotogramas; después cancela el aviso si no hay nuevos cambios. Personas se evalúa según su intervalo de inferencia. El aviso dura 22,1 s antes de sirena y sigue cancelándose si la detección termina. El contador y los mensajes distinguen preparar, desarmado, vigilancia silenciosa, aviso y sirena. La interfaz no puede verificar el altavoz físico ni el modo silencioso del iPhone.

`tests/protect.py` utiliza el botón real de inicio sin inyectar banderas de armado, zona o audio; un vídeo de movimiento controlado pasa por el detector real, reproduce el MP3 y activa la sirena al terminar si persiste.

## Audio en Safari e iPhone en silencio

El aviso y la sirena ahora se reproducen con un único HTMLAudioElement reutilizado, desde archivos locales. La sirena es assets/sirena.mp3 y la comprobación inicial usa assets/comprobar-sonido.wav. Se solicita navigator.audioSession.type=playback cuando la API existe. No se usa Web Audio para reproducir avisos ni sirena: que un AudioContext figure running no demuestra salida por altavoz, especialmente con el modo Silencio de iOS. El botón Probar sonido está siempre en Inicio y reproduce el aviso con interacción directa. play() rechazado, errores del archivo y pausas inesperadas deshabilitan el estado de audio y muestran un error real. El diagnóstico incluye estado del elemento, código de error y sesión. El volumen físico, la salida Bluetooth/AirPlay, el interruptor de silencio y las diferencias de iOS siguen necesitando prueba real; la web no puede medir lo que oye una persona. Las notas anteriores de Web Audio describen la implementación sustituida.

## Inicio independiente y conexión entre móviles

La ruta principal abre el nuevo Inicio con el fondo proporcionado por el usuario y tarjetas de cristal. `#camera` conserva la vigilancia existente y `#remote` abre el emparejamiento/visor. Navegar dentro de la web no debe confundirse con pasar Safari a segundo plano: la fuente de cámara se conserva en un contenedor mínimo mientras el usuario ve Inicio o Conexión. El visor no solicita cámara ni micrófono.

Se incluye un servicio WebSocket autenticado para preparar WebRTC, separado de Netlify. **No está desplegado ni hay acceso desde fuera de casa activado.** Lee [server/README.md](server/README.md) para infraestructura, secretos seguros, TURN, claves temporales y pruebas pendientes. La grabación principal continúa siendo local en el móvil cámara; no hay sincronización de clips entre dispositivos ni grabación en la nube. Las afirmaciones anteriores de que no existe transporte remoto describen la versión local anterior: ahora existe implementación opcional, sin servicio de producción configurado.

Para validar el Inicio: `python3 tests/shell.py`. Para la autorización del servicio: `node --test tests/signaling.test.mjs`. El test opcional `tests/remote.py` sigue sin completar vídeo en este entorno y requiere validación con ICE/TURN operativo.

## PIN obligatorio y diseño unificado

Todas las pantallas usan el fondo azul y tarjetas de cristal. Al abrir o recargar se exige desbloqueo: si no hay PIN local, se crea uno de 6 a 12 cifras y se repite para confirmar. Un PIN existente de versiones anteriores se conserva. No se guarda una sesión que omita el PIN en futuras cargas. Bloquear desde la cabecera vuelve a pedirlo sin desarmar la vigilancia.

Activar/desactivar vigilancia, detener la cámara, reiniciarla durante vigilancia, cambiar el detector o la zona durante vigilancia, sirena manual, compartir la cámara y cambiar el PIN requieren verificación local. Cancelar o equivocarse no ejecuta la acción. Cambiar el PIN exige conocer el anterior y confirmar dos veces el nuevo. Silenciar permanece inmediato —también desde el teclado de PIN cuando hay vigilancia— y no desarma el sistema. Las interrupciones reales de cámara o sistema se siguen gestionando automáticamente sin exigir un PIN para detener una captura fallida.

El PIN es una barrera local de interfaz con comprobación en el navegador: no cifra los clips ni impide manipular el sitio desde herramientas de desarrollo, borrar almacenamiento o reinstalar la web. No sustituye el token/clave del servicio remoto. Cinco intentos fallidos provocan una espera local de 30 segundos; esa espera tampoco es autenticación de servidor. Si se borran los datos del sitio se pierden el PIN y potencialmente las evidencias guardadas. Si no se puede guardar/comprobar el PIN, se bloquea el acceso con explicación.

Las Preferencias visibles se reducen a cámara, zona/máscara, modo y duración de grabación, gestión de espacio, volumen, iluminación compatible y cambio de PIN. Brillo, contraste, gamma, umbrales y frecuencia de análisis se ajustan automáticamente; sus controles ya no se ofrecen al usuario. `tests/security.py` comprueba los flujos con formularios reales y `tests/pin_helpers.py` introduce un PIN real en las regresiones, sin bypass en producción.

## Supabase opcional para los dos móviles

Se añade autenticación con cuenta, registro de cámaras con RLS y señalización privada Realtime. El SDK se incluye localmente (~225 KB) y solo se carga al iniciar sesión remota. El funcionamiento principal no depende de Supabase. No hay proyecto ni relay de producción conectados. Sigue [supabase/README.md](supabase/README.md): crear proyecto, aplicar SQL, habilitar tu usuario y configurar la función de credenciales TURN. No se prometen vídeo exterior ni almacenamiento en la nube antes de completar y verificar esos pasos.
