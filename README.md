# SECURITY CAM

Aplicación local de vigilancia por eventos, orientada a Safari en un iPhone 14 fijo. Cámara nativa en directo, interfaz grafito, sin micrófono y sin grabación continua. Los clips y el historial permanecen en este navegador. No se necesita una base de datos remota para vigilar o guardar clips.

## Uso

1. Crea y confirma tu PIN local, o desbloquea con él. El PIN protege controles; no cifra las grabaciones. Al recargar se conserva la configuración, pero debes iniciar y armar de nuevo: nunca se reactiva vigilancia a espaldas de la pantalla de acceso. La cuenta opcional es independiente.
2. Abre Cámaras → este dispositivo. Inicia la cámara para encuadrar sin detectar ni grabar automáticamente.
3. Dibuja una zona rectangular sobre la imagen para excluir calle y vecinos; puedes reemplazarla arrastrando otra vez o volver a imagen completa. Una máscara privada oculta parte de la imagen, incluidos clips procesados y fotos.
4. Elige un modo y pulsa **Armar sistema**, confirmando el PIN:
   - **Silenciosa**: detecta y guarda clips sin avisos ni sirena.
   - **Disuasoria**: lo mismo, con aviso de voz si habilitas audio automático.
   - **Alarma**: lo mismo, con sirena y/o voz automáticas expresamente habilitadas; linterna solo si existe soporte.
   - **Desarmado**: pulsa Desarmar y confirma PIN. Conserva la cámara, detiene análisis y grabación automática. Desarmar interrumpe un clip en curso y guarda lo capturado.
5. Movimiento es el disparador principal. Personas añade clasificación al mismo episodio. Se pueden activar por separado; si solo está activo Personas, este puede iniciar episodios. La IA es local y se carga al armar con ella habilitada.
6. Actividad permite reproducir, descargar, marcar importante y eliminar clips, y consultar el historial. Los fallos de guardado conservan una descarga pendiente en memoria y bloquean grabaciones posteriores hasta reiniciar la cámara. Descarga antes de recargar o cerrar.

## Ciclo de evento

La comparación de fotogramas aplica compensación de cambios uniformes de luz, umbral por píxel y área mínima. La confirmación es ajustable a 0,5 / 1 / 2 segundos. No garantiza eliminar sombras, lluvia o cambios de exposición no uniformes.

Movimiento confirmado → episodio → un clip de 10 / 20 / 30 / 60 segundos → cooldown de 10 / 20 / 30 / 60 segundos contado desde el fin de la captura. El clip completa su duración aunque termine el movimiento, salvo desarmado, cierre, interrupción o error. Personas puede mejorar la etiqueta del mismo clip, sin duplicarlo.

El episodio se libera tras 4 segundos sin movimiento y sin una persona confirmada reciente. Un episodio persistente no produce otro clip al terminar el cooldown. Se puede permitir explícitamente repetirlo tras cada cooldown. Un episodio nuevo que comienza durante el cooldown queda en el historial sin clip; por defecto no inicia otro al terminar ese cooldown.

La opción Solo manual deshabilita clips automáticos, manteniendo detección/avisos del modo elegido. La grabación manual es una acción explícita, limitada a la duración seleccionada.

## Consumo e imagen

- Predeterminado: captura solicitada a 640 px y 15 fps, análisis a 128 px cada 500 ms, grabación procesada a 640 px/5 fps, personas desactivadas. Los valores reales dependen de la cámara y Safari.
- Calidad de captura/vista previa y resolución de grabación procesada son ajustes separados. La grabación no supera la resolución capturada; sin `canvas.captureStream` se usa la pista nativa y su resolución. Cambiar captura requiere reiniciar cámara y volver a armar; no se oculta ese cambio.
- El modo ahorro limita análisis a 128 px como máximo, a un intervalo mínimo de 500 ms y la IA a un mínimo de 5 segundos. Sin movimiento reciente o un episodio activo no ejecuta IA, salvo modo solo-personas. Ante análisis lento reduce automáticamente resolución. Vídeo nativo y análisis no comparten el bucle de refresco.
- Brillo, contraste y gamma procesan análisis, fotos y clips de canvas; la vista previa nativa aplica brillo/contraste para mantener fluidez. Modo noche mejora digitalmente la imagen y muestra escena oscura según luminosidad real de fotogramas. No proporciona infrarrojos ni visión sin luz.
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

Cuenta/perfil y conexión opcionales se conservan: perfil editado solo local; Supabase Auth y señalización privada requieren configuración real. No se necesita ni se inicia ese servicio para vigilancia local. WebRTC remoto requiere señalización autenticada y normalmente TURN; Netlify estático no proporciona un servidor WSS ni TURN. Infraestructura preparada en `supabase/` y `server/`; no desplegada ni verificada como vídeo remoto fuera de casa. No se publican clips ni señal de cámara sin autenticación.

## Pruebas

```sh
npm test
```

Con servidor activo, Playwright y Chromium instalados. Incluye cámara sintética, fotogramas controlados a través del analizador real, zona con puntero, luz uniforme, clip codificado/guardado/decodificado, clasificación con salida IA controlada, episodio persistente/cooldown, PIN, interfaz, modelo local real, reproducción multimedia y fallos de IndexedDB. No sustituye pruebas físicas de Safari. Véase `TESTING.md`.

Recursos locales: Human 3.3.6 / CenterNet MobileNet opcional; licencia `vendor/HUMAN-LICENSE`, procedencia `models/PROVENANCE.json`. Cliente Supabase local y licencias en `vendor/SUPABASE-LICENSES.txt`.
