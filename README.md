# Jarvis + SECURITY CAM

**Portada (`/`): Jarvis**, asistente del cuarto que funciona en el navegador: reloj, reconocimiento local de tu cara con saludo por voz, órdenes por voz o texto (hora, día, temporizadores, chistes) y huecos preparados para luces, aire, ventilador, tele y PS5 cuando haya hardware. Las caras se guardan solo en ese móvil. Modelos blazeface/facemesh/faceres de Human 3.3.6 (`models/PROVENANCE.json`).

**Cámara de vigilancia: `/camara`** (lo que sigue).


Aplicación local de vigilancia exclusivamente por personas, orientada a Safari en un iPhone 14 fijo. Cámara nativa en directo, interfaz carbón con tarjetas translúcidas, acceso por PIN local, sin micrófono y sin grabación continua. Se ha retirado el login con cuenta. Los clips y el historial permanecen en este navegador. No se necesita una base de datos remota para vigilar o guardar clips.

## Uso

1. Crea y confirma tu PIN local, o desbloquea con él. El PIN protege controles; no cifra las grabaciones. Al recargar se conserva la configuración, pero debes iniciar y armar de nuevo: nunca se reactiva vigilancia a espaldas de la pantalla de acceso.
2. Inicio muestra el centro de control: vídeo real, tu cámara, eventos recientes y estado local. Pulsa Iniciar cámara: el modelo local empieza a buscar personas y dibuja recuadros verdes con confianza, aunque esté desarmado. La vista previa no inicia grabación ni alarmas. El estado del detector se ve bajo el vídeo: cargando, primer análisis, buscando, persona detectada o error. El mismo flujo nativo se reutiliza en Inicio y Cámaras, sin pedir otro permiso ni crear una segunda captura.
3. Abre Dibujar zona: inicia la cámara si estaba apagada y muestra un editor ampliado. Dibuja con el dedo, mueve el rectángulo o ajusta las esquinas y pulsa Guardar zona. Cancelar conserva la anterior. Puedes volver a imagen completa. La detección se pausa mientras editas; al salir conserva el estado armado anterior. Una máscara privada oculta parte de la imagen, incluidos clips procesados y fotos.
4. Elige un modo y pulsa **Armar sistema**, confirmando el PIN:
   - **Silenciosa**: detecta y guarda clips sin avisos ni sirena.
   - **Disuasoria**: lo mismo, con aviso de voz si habilitas audio automático.
   - **Alarma**: lo mismo, con sirena y/o voz automáticas expresamente habilitadas; linterna solo si existe soporte.
   - **Desarmado**: pulsa Desarmar y confirma PIN. Conserva cámara y recuadros de personas, detiene grabación y alertas automáticas. Desarmar interrumpe un clip en curso y guarda lo capturado.
5. **Solo las personas reconocidas dentro de tu zona pueden iniciar un evento automático.** Movimiento no es una opción ni un disparador, incluso si había ajustes antiguos guardados. Las personas se reconocen al encender la cámara; armar autoriza clips y alertas y requiere que el modelo esté disponible. Si falla la IA se muestra el error, no se generan eventos nuevos y hay un botón Reintentar. No se sustituye por movimiento. Puedes pausar el reconocimiento con su control en Ajustes; armar lo reactiva.
6. Eventos y Clips tienen accesos separados en la navegación inferior. Permiten consultar el historial y reproducir, descargar, marcar importante y eliminar grabaciones. La búsqueda de Inicio encuentra cámara, eventos y clips locales, con o sin tildes. Las miniaturas de eventos se enlazan por ID al clip real; los eventos antiguos sin vínculo no reciben una imagen inventada. Los fallos de guardado conservan una descarga pendiente en memoria y bloquean grabaciones posteriores hasta reiniciar la cámara. Descarga antes de recargar o cerrar.

## Centro de control y diseño

La referencia visual proporcionada se aplica con fondo carbón, superficies translúcidas, bordes discretos, controles compactos, navegación inferior de cinco secciones y un PIN con teclado a juego. No hay reloj/batería de iOS simulados, cámaras de demostración ni fotos de viviendas presentadas como señal real. La cámara apagada muestra una llamada explícita a iniciarla; no se enciende al entrar.

Desde Inicio se puede armar/desarmar con el mismo PIN, tomar una fotografía, grabar un clip manual, detener cámara y ampliar la imagen. Safari sin Fullscreen API usa una vista ampliada CSS con botón Volver. La cuota de almacenamiento solo se muestra como estimación real del navegador; si falta la API, se muestran bytes conocidos de clips y cuota no disponible. No se declara que todo el sistema esté operativo cuando cámara o almacenamiento tienen problemas.

Ajustes conserva perfil local y seguridad y enlaza a configuración de cámara, zona y detección. Al bloquear la aplicación, el visor se oculta detrás del PIN; el funcionamiento en primer plano conserva los límites de Safari descritos abajo.

## Ciclo de evento

Persona reconocida → episodio → un clip de 10 / 20 / 30 / 60 segundos → cooldown de 10 / 20 / 30 / 60 segundos desde el fin de captura. El clip completa su duración aunque la persona se vaya, salvo desarmado, cierre, interrupción o error. El episodio se libera al dejar de haber observaciones recientes de personas. Una persona persistente no produce clips infinitos; repetir después del cooldown requiere permiso explícito en el ajuste correspondiente.

El sistema conserva un análisis visual ligero para iluminación y para elegir recortes donde buscar personas pequeñas. Es solo una ayuda interna de enfoque: nunca crea eventos de movimiento, clips, avisos o sirenas. Se conservan historial y clips antiguos; las entradas de movimiento anteriores se identifican como históricas, sin nuevos disparos de ese tipo.

La opción Solo manual deshabilita clips automáticos, manteniendo detección/avisos del modo elegido. La grabación manual es una acción explícita, limitada a la duración seleccionada.

## Consumo e imagen

- Predeterminado revisado para iPhone 14: captura solicitada a 1280 px y 15 fps, análisis a 256 px cada 500 ms, grabación procesada a 640 px/10 fps y personas activadas con confianza mínima 45% y respuesta rápida. En modo rápido el objetivo inicial es un ciclo de 350 ms; se amplía según el tiempo real de inferencia y deja al menos 80 ms de descanso. No garantiza ese plazo en el dispositivo. El modo equilibrado usa el intervalo configurado (2 s inicialmente). La primera carga tras actualizar migra esos valores técnicos; conserva zona, máscara, clips y opciones de sonido. Mejora el detalle con mayor consumo que el ajuste anterior de ahorro. Los valores reales dependen de la cámara y Safari.
- Calidad de captura/vista previa y resolución de grabación procesada son ajustes separados. La grabación no supera la resolución capturada; sin `canvas.captureStream` se usa la pista nativa y su resolución. Cambiar captura requiere reiniciar cámara y volver a armar; no se oculta ese cambio.
- El modo ahorro limita análisis a 128 px como máximo, a un intervalo mínimo de 500 ms y la IA a un mínimo de 5 segundos. La IA habilitada analiza periódicamente incluso sin movimiento para no perder personas pequeñas o quietas. Ante análisis visual auxiliar lento reduce su resolución; el tiempo de inferencia no reduce por sí solo la resolución del análisis auxiliar. Vídeo nativo y análisis no comparten el bucle de refresco.
- Brillo, contraste y gamma procesan análisis, fotos y clips de canvas; la vista previa nativa aplica brillo/contraste para mantener fluidez. Modo noche mejora digitalmente la imagen y muestra escena oscura según luminosidad real de fotogramas. No proporciona infrarrojos ni visión sin luz.
- La IA recibe imágenes de hasta 512 px y alterna vista general y detalles solapados. Los detalles se recortan desde el vídeo original, usando cambios visuales recientes como foco cuando existen. Este enfoque no genera eventos por cambios visuales: solo el reconocimiento de una persona puede hacerlo. Para no perder personas entre pasadas, se conservan observaciones hasta tres intervalos de IA; las cajas antiguas muestran su antigüedad y caducan sin renovar la hora observada. La desaparición tiene esa latencia de análisis. Antes de activar una sirena automática por personas se exige además una inferencia actual, tanto con aviso previo como sin él; una caja retenida no basta. La comprobación comparte el bloqueo de inferencia, y si no puede confirmar cancela la sirena. El modelo conserva hasta 32 candidatos de objetos antes de seleccionar personas, evitando el tope anterior de ocho objetos en escenas con coches. Se hace una sola inferencia cada vez, en un ciclo asíncrono independiente del análisis de movimiento. Una promesa de IA pendiente no detiene el muestreo de movimiento ni el inicio de clips. Safari puede seguir bloqueando trabajo JavaScript durante partes síncronas del modelo: no se promete independencia de hilos ni aceleración física inexistente. La vista muestra duración de inferencia, ciclo observado e inicio del último clip medido desde el evento confirmado; no mide el tiempo desde que una persona aparece físicamente en la escena. Cuadros y máscaras se transforman a las coordenadas originales. La zona admite el centro o los pies de la persona; no se actúa por detecciones totalmente ajenas. El recorte no cambia la vista previa ni la grabación y no recupera detalle óptico que no existe. No mide distancias ni garantiza 10 metros: valida la entrada con personas a la distancia real, luz y encuadre definitivos.
- LOW POWER indica una configuración. No se muestra una temperatura ni un estado térmico inventado.

**La pantalla debe permanecer encendida. La cámara web no puede funcionar de forma fiable con el iPhone bloqueado. Una carcasa cerrada puede provocar calor.** Mantén sombra y revisa temperatura/batería físicamente; reduce calidad o detén el sistema si iOS avisa. Wake Lock solo se solicita cuando existe; no garantiza funcionamiento prolongado.

## Audio, linterna y privacidad

Se conserva el MP3 ElevenLabs suministrado (`assets/aviso-seguridad.mp3`), la sirena y el tono de prueba local. No se suben ni reemplazan sonidos. Los controles de advertencia específica de propiedad/abandono están desactivados con explicación porque no hay archivos distintos disponibles; no se presentan como tres voces que no existen.

Probar sonido autoriza reproducción con un gesto y comprueba el resultado real de HTMLAudioElement. En iOS se solicita sesión playback si está disponible. Un bloqueo se registra y no impide vigilancia silenciosa. Volumen web, modo Silencio, volumen físico y salidas Bluetooth/AirPlay pueden comportarse de forma distinta; compruébalo en el móvil. Silenciar es inmediato y no desarma. No se llama automáticamente a la policía.

Alarma automática requiere modo Alarma, zona autorizada, sirena habilitada y confirmación adicional según el origen elegido. La voz previa es opcional; si está habilitada, solo pasa a sirena al terminar el aviso si persiste la detección. Cada episodio solo inicia una secuencia de alarma, respetando intervalo mínimo entre episodios.

Torch se habilita únicamente si la pista expone la capacidad real; cada orden se verifica. Si falla, se deshabilitan linterna y parpadeo con su error. El parpadeo es lento (2 s), con límite temporal configurable. Safari puede no exponerlo incluso en un iPhone con flash físico.

## Grabaciones y límites de Safari

IndexedDB conserva blobs, miniaturas, fecha/hora, clasificación e importancia. REC aparece solo cuando MediaRecorder confirma inicio; se apaga al terminar o fallar. Se comprueban formatos MP4/WebM disponibles. Sin MediaRecorder se ofrece fotografía y se deshabilita vídeo.

Antes de cada clip se comprueba una política local de 100 clips / 480 MB y la cuota estimada del origen si está disponible. El borrado automático es opcional y respeta clips importantes. La política limita la colección antes de iniciar un clip, no su tamaño final. **Safari puede expulsar todos los datos**, incluidos importantes. Navegación privada, poco espacio o borrar datos del sitio pueden perder evidencias. Descárgalas regularmente; no hay garantía de archivo permanente.

Sin vídeo procesado no se permite grabar máscaras/zoom que perderían su protección al usar pista nativa. Se informa del límite y se mantienen fotos manuales. No se graba audio del micrófono. No se promete actividad fiable con pestaña oculta, bloqueo, reinicio o cierre de Safari.

## Desarrollo y Netlify

```sh
npm ci
npm run build
npm start
```

Servidor estático en puerto 8001. `src/app.js` contiene el motor; `src/security.js`, autorización local; `src/shell.js`, navegación y perfil. Compilados en la raíz para Netlify. La app de cámara vive en `camara.html` (servida en `/camara`); la portada `index.html` es Jarvis (`src/jarvis.js`, `jarvis.css`). `netlify.toml` publica `.` con HTTPS de Netlify, CSP y micrófono deshabilitado; `.netlifyignore` excluye servidores, fuentes, pruebas y secretos. La web de eventos original sigue en `archive/eventos.html`.

El perfil se edita y guarda solo en este dispositivo. La interfaz ya no incluye login, formularios de email/contraseña, accesos a vincular cuentas ni monitor remoto dependiente de esa cuenta. Las rutas antiguas `#account` y `#remote` vuelven a Inicio. La vigilancia local no contacta con Supabase. La conexión opcional entre móviles se abre en Añadir cámara → Usar otro móvil y usa una identidad de dispositivo con Supabase Anonymous Auth, sin formularios de login. El enlace privado es de un uso y caduca a los diez minutos. La sesión del dispositivo se conserva en este navegador; borrar los datos del sitio pierde sus vínculos. Los clips permanecen en el iPhone cámara. Con el directo abierto, el visor puede armar (eligiendo modo), desarmar y silenciar el iPhone cámara confirmando su propio PIN. El servicio necesita instalar SQL, habilitar Anonymous Auth y desplegar la función de TURN: consulta [instalación paso a paso](supabase/PAIRING_SETUP.md). No se ha desplegado ni probado este servicio en el proyecto real desde esta sesión.

## Pruebas

```sh
npm test
```

Con servidor activo, Playwright y Chromium instalados. Incluye cámara sintética, fotogramas controlados a través del analizador real, zona con puntero y gestos táctiles móviles, rechazo de movimiento como disparador, recuadro de personas antes de armar, clip codificado/guardado/decodificado, clasificación con salida IA controlada, episodio persistente/cooldown, PIN, interfaz, modelo local real, reproducción multimedia y fallos de IndexedDB. No sustituye pruebas físicas de Safari. Los ensayos opcionales `python3 tests/person_detail_photo.py RUTA_A_BUS_JPG` y `python3 tests/people_photo_preview.py RUTA_A_BUS_JPG` comprueban el modelo real y los recuadros de la app sobre una fotografía pública de peatones; instrucciones y procedencia en `tests/fixtures/PEDESTRIANS.md`. No sustituye la validación a 10 m en la vivienda. Véase `TESTING.md`.

Recursos locales: Human 3.3.6 / CenterNet MobileNet opcional; licencia `vendor/HUMAN-LICENSE`, procedencia `models/PROVENANCE.json`. Cliente Supabase local y licencias en `vendor/SUPABASE-LICENSES.txt`.
