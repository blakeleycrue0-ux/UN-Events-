# SECURITY CAM

Aplicación local de vigilancia por eventos, orientada a Safari en un iPhone 14 fijo. Cámara nativa en directo, interfaz carbón con tarjetas translúcidas, acceso por PIN local, sin micrófono y sin grabación continua. Se ha retirado el login con cuenta. Los clips y el historial permanecen en este navegador. No se necesita una base de datos remota para vigilar o guardar clips.

## Uso

1. Crea y confirma tu PIN local, o desbloquea con él. El PIN protege controles; no cifra las grabaciones. Al recargar se conserva la configuración, pero debes iniciar y armar de nuevo: nunca se reactiva vigilancia a espaldas de la pantalla de acceso.
2. Inicio muestra el centro de control: vídeo real, tu cámara, eventos recientes y estado local. Pulsa Iniciar cámara para encuadrar sin detectar ni grabar automáticamente. El mismo flujo nativo se reutiliza en Inicio y Cámaras, sin pedir otro permiso ni crear una segunda captura.
3. Abre Dibujar zona: inicia la cámara si estaba apagada y muestra un editor ampliado. Dibuja con el dedo, mueve el rectángulo o ajusta las esquinas y pulsa Guardar zona. Cancelar conserva la anterior. Puedes volver a imagen completa. La detección se pausa mientras editas; al salir conserva el estado armado anterior. Una máscara privada oculta parte de la imagen, incluidos clips procesados y fotos.
4. Elige un modo y pulsa **Armar sistema**, confirmando el PIN:
   - **Silenciosa**: detecta y guarda clips sin avisos ni sirena.
   - **Disuasoria**: lo mismo, con aviso de voz si habilitas audio automático.
   - **Alarma**: lo mismo, con sirena y/o voz automáticas expresamente habilitadas; linterna solo si existe soporte.
   - **Desarmado**: pulsa Desarmar y confirma PIN. Conserva la cámara, detiene análisis y grabación automática. Desarmar interrumpe un clip en curso y guarda lo capturado.
5. Movimiento y personas pueden iniciar episodios de forma independiente, también cuando ambos están activados. Una persona confirmada mejora la clasificación de un episodio de movimiento existente sin duplicarlo. La IA es local y se carga al armar con ella habilitada.
6. Eventos y Clips tienen accesos separados en la navegación inferior. Permiten consultar el historial y reproducir, descargar, marcar importante y eliminar grabaciones. La búsqueda de Inicio encuentra cámara, eventos y clips locales, con o sin tildes. Las miniaturas de eventos se enlazan por ID al clip real; los eventos antiguos sin vínculo no reciben una imagen inventada. Los fallos de guardado conservan una descarga pendiente en memoria y bloquean grabaciones posteriores hasta reiniciar la cámara. Descarga antes de recargar o cerrar.

## Centro de control y diseño

La referencia visual proporcionada se aplica con fondo carbón, superficies translúcidas, bordes discretos, controles compactos, navegación inferior de cinco secciones y un PIN con teclado a juego. No hay reloj/batería de iOS simulados, cámaras de demostración ni fotos de viviendas presentadas como señal real. La cámara apagada muestra una llamada explícita a iniciarla; no se enciende al entrar.

Desde Inicio se puede armar/desarmar con el mismo PIN, tomar una fotografía, grabar un clip manual, detener cámara y ampliar la imagen. Safari sin Fullscreen API usa una vista ampliada CSS con botón Volver. La cuota de almacenamiento solo se muestra como estimación real del navegador; si falta la API, se muestran bytes conocidos de clips y cuota no disponible. No se declara que todo el sistema esté operativo cuando cámara o almacenamiento tienen problemas.

Ajustes conserva perfil local y seguridad y enlaza a configuración de cámara, zona y detección. Al bloquear la aplicación, el visor se oculta detrás del PIN; el funcionamiento en primer plano conserva los límites de Safari descritos abajo.

## Ciclo de evento

La comparación de fotogramas y un fondo adaptativo aplican compensación de luz global y buscan grupos conectados de píxeles. A sensibilidad 60, el mínimo es aproximadamente 0,22% del área válida, frente al 5,5% de la versión anterior. Píxeles aislados no forman una intrusión. Cambios amplios de escena reconstruyen la referencia. La referencia adaptativa conserva evidencia entre muestras, para evitar depender de diferencias grandes en cada fotograma. La confirmación es ajustable a 0,5 / 1 / 2 segundos. No garantiza eliminar sombras, lluvia o cambios de exposición no uniformes.

Movimiento o persona confirmada → episodio → un clip de 10 / 20 / 30 / 60 segundos → cooldown de 10 / 20 / 30 / 60 segundos contado desde el fin de la captura. El clip completa su duración aunque termine el movimiento, salvo desarmado, cierre, interrupción o error. Personas puede mejorar la etiqueta del mismo clip, sin duplicarlo.

El episodio se libera tras 4 segundos sin movimiento y sin una persona confirmada reciente. Un episodio persistente no produce otro clip al terminar el cooldown. Se puede permitir explícitamente repetirlo tras cada cooldown. Un episodio nuevo que comienza durante el cooldown queda en el historial sin clip; por defecto no inicia otro al terminar ese cooldown.

La opción Solo manual deshabilita clips automáticos, manteniendo detección/avisos del modo elegido. La grabación manual es una acción explícita, limitada a la duración seleccionada.

## Consumo e imagen

- Predeterminado revisado para iPhone 14: captura solicitada a 1280 px y 15 fps, análisis a 256 px cada 500 ms, grabación procesada a 640 px/10 fps y personas activadas con confianza mínima 45% y respuesta rápida. En modo rápido el objetivo inicial es un ciclo de 350 ms; se amplía según el tiempo real de inferencia y deja al menos 80 ms de descanso. No garantiza ese plazo en el dispositivo. El modo equilibrado usa el intervalo configurado (2 s inicialmente). La primera carga tras actualizar migra esos valores técnicos; conserva zona, máscara, clips y opciones de sonido. Mejora el detalle con mayor consumo que el ajuste anterior de ahorro. Los valores reales dependen de la cámara y Safari.
- Calidad de captura/vista previa y resolución de grabación procesada son ajustes separados. La grabación no supera la resolución capturada; sin `canvas.captureStream` se usa la pista nativa y su resolución. Cambiar captura requiere reiniciar cámara y volver a armar; no se oculta ese cambio.
- El modo ahorro limita análisis a 128 px como máximo, a un intervalo mínimo de 500 ms y la IA a un mínimo de 5 segundos. La IA habilitada analiza periódicamente incluso sin movimiento para no perder personas pequeñas o quietas. Ante análisis de movimiento lento reduce su resolución; el tiempo de inferencia no reduce por sí solo la resolución de movimiento. Vídeo nativo y análisis no comparten el bucle de refresco.
- Brillo, contraste y gamma procesan análisis, fotos y clips de canvas; la vista previa nativa aplica brillo/contraste para mantener fluidez. Modo noche mejora digitalmente la imagen y muestra escena oscura según luminosidad real de fotogramas. No proporciona infrarrojos ni visión sin luz.
- La IA recibe imágenes de hasta 512 px y alterna vista general y detalles solapados. Los detalles se recortan desde el vídeo original, usando cambios visuales recientes como foco cuando existen. Este enfoque también funciona con los eventos de movimiento desactivados: no genera avisos de movimiento en ese caso. Para no perder personas entre pasadas, se conservan observaciones hasta tres intervalos de IA; las cajas antiguas muestran su antigüedad y caducan sin renovar la hora observada. La desaparición tiene esa latencia de análisis. Antes de activar una sirena automática por personas se exige además una inferencia actual, tanto con aviso previo como sin él; una caja retenida no basta. La comprobación comparte el bloqueo de inferencia, y si no puede confirmar cancela la sirena. El modelo conserva hasta 32 candidatos de objetos antes de seleccionar personas, evitando el tope anterior de ocho objetos en escenas con coches. Se hace una sola inferencia cada vez, en un ciclo asíncrono independiente del análisis de movimiento. Una promesa de IA pendiente no detiene el muestreo de movimiento ni el inicio de clips. Safari puede seguir bloqueando trabajo JavaScript durante partes síncronas del modelo: no se promete independencia de hilos ni aceleración física inexistente. La vista muestra duración de inferencia, ciclo observado e inicio del último clip medido desde el evento confirmado; no mide el tiempo desde que una persona aparece físicamente en la escena. Cuadros y máscaras se transforman a las coordenadas originales. La zona admite el centro o los pies de la persona; no se actúa por detecciones totalmente ajenas. El recorte no cambia la vista previa ni la grabación y no recupera detalle óptico que no existe. No mide distancias ni garantiza 10 metros: valida la entrada con personas a la distancia real, luz y encuadre definitivos.
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

Servidor estático en puerto 8001. `src/app.js` contiene el motor; `src/security.js`, autorización local; `src/shell.js`, navegación y perfil. Compilados en la raíz para Netlify; `index.html` e `Index.html` deben coincidir. `netlify.toml` publica `.` con HTTPS de Netlify, CSP y micrófono deshabilitado; `.netlifyignore` excluye servidores, fuentes, pruebas y secretos. La web de eventos original sigue en `archive/eventos.html`.

El perfil se edita y guarda solo en este dispositivo. La interfaz ya no incluye login, formularios de email/contraseña, accesos a vincular cuentas ni monitor remoto dependiente de esa cuenta. Las rutas antiguas `#account` y `#remote` vuelven a Inicio. La app no carga los scripts de Supabase/WebRTC ni inicia conexiones a esos servicios. Conserva el PIN local y la autorización de vigilancia. El código preparatorio del servicio permanece en el repositorio, inactivo, para poder retomarlo más adelante sin publicar vídeo sin autenticación.

## Pruebas

```sh
npm test
```

Con servidor activo, Playwright y Chromium instalados. Incluye cámara sintética, fotogramas controlados a través del analizador real, zona con puntero y gestos táctiles móviles, movimiento pequeño, rechazo de ruido aislado, luz uniforme, clip codificado/guardado/decodificado, clasificación con salida IA controlada, episodio persistente/cooldown, PIN, interfaz, modelo local real, reproducción multimedia y fallos de IndexedDB. No sustituye pruebas físicas de Safari. El ensayo opcional `python3 tests/person_detail_photo.py RUTA_A_BUS_JPG` comprueba el modelo con una fotografía pública de peatones; instrucciones y procedencia en `tests/fixtures/PEDESTRIANS.md`. No sustituye la validación a 10 m en la vivienda. Véase `TESTING.md`.

Recursos locales: Human 3.3.6 / CenterNet MobileNet opcional; licencia `vendor/HUMAN-LICENSE`, procedencia `models/PROVENANCE.json`. Cliente Supabase local y licencias en `vendor/SUPABASE-LICENSES.txt`.
