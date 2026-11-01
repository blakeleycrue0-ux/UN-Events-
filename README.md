# Security Cam

Aplicación estática de cámaras con navegación propia: Inicio, Cámaras, Actividad y Perfil. Conserva el fondo azul proporcionado por el usuario; toda la interfaz anterior se sustituye. La captura, detección, grabación y audio funcionan en el dispositivo. El acceso con cuenta usa Supabase real cuando el propietario lo configura: no hay usuarios de demostración, cámaras ficticias ni login simulado.

## Uso

1. En el primer acceso crea y confirma el PIN local. En futuras aperturas y recargas vuelve a introducirlo.
2. La primera bienvenida permite acceder a una cuenta o usar este dispositivo localmente. No activa cámara ni micrófono al abrir.
3. Inicio muestra el estado real del dispositivo, una vista previa si la cámara está encendida, grabaciones existentes y actividad local. El botón + abre el alta de dispositivo.
4. Cámaras separa este teléfono de las cámaras anunciadas por tu cuenta. No presenta un anuncio como vídeo conectado: eso se comprueba al establecer WebRTC.
5. Abre tu cámara y elige Personas o Movimiento. Armar/desarmar solicita PIN. El aviso ElevenLabs incluido dura 22,1 s; después puede sonar la sirena si la detección continúa. Si desaparece, se cancela según el intervalo de análisis. Silenciar no desarma y permanece disponible sin PIN durante sonido/alarma.
6. Actividad tiene pestañas de clips y eventos. Los clips permiten reproducir, descargar, marcar y eliminar; eliminar y borrar el historial requieren PIN, sin ventanas confirm del navegador. Un clip que no se pudo guardar ofrece una descarga pendiente en esta pantalla y bloquea nuevas grabaciones automáticas.
7. Perfil permite editar nombre, hogar y nombre de cámara **solo en este dispositivo**. La cuenta remota y su sesión son independientes. No se sincroniza el nombre editado con Supabase. Las preferencias se limitan a privacidad, cámara, grabaciones, sonido, iluminación compatible y seguridad.

## Cuenta real y remoto

El acceso email/contraseña llama a Supabase Auth y comprueba que la cuenta tenga membresía autorizada. La contraseña se borra del formulario y la sesión vive en memoria. Solo el URL y clave pública del proyecto se guardan como configuración pública. El SDK se carga localmente al acceder a la cuenta; no es necesario para la vigilancia local. Se rechazan claves secret/service_role en la configuración del navegador.

**No hay un proyecto de producción conectado ni vídeo exterior verificado.** Sigue [supabase/README.md](supabase/README.md) para configurar SQL/RLS, cuentas y credenciales efímeras TURN. Netlify estático no sustituye la señalización ni un relay. El servidor WSS propio anterior sigue disponible como implementación separada en [server/README.md](server/README.md), aunque su configuración técnica ya no forma parte de la interfaz diaria.

No se suben clips, fotos ni sonido a Supabase Storage. No hay notificaciones push, acceso remoto a clips históricos ni control remoto de sirena. La misma cuenta autorizada se utiliza en ambos móviles para el visor opcional; no se inventa un estado de conexión cuando faltan servicios.

## Desarrollo y Netlify

```sh
npm ci
npm run build
npm start
```

Servidor local: puerto 8001. Edita los archivos en `src/` y recompila. La compilación y los modelos locales están incluidos; no hace falta instalar dependencias para servir los archivos ya compilados. `index.html` e `Index.html` se mantienen iguales por compatibilidad con la ruta original. La web de eventos anterior está conservada en `archive/eventos.html`.

`netlify.toml` configura build, permisos y CSP. `.netlifyignore` excluye fuentes de servidor, tests, node_modules y archivos privados del sitio estático. No incluyas valores de credenciales en Git ni en archivos publicados.

- `src/app.js`: cámara, procesamiento, movimiento, persona, IndexedDB, sirena/avisos y eventos.
- `src/security.js`: entrada, creación/cambio de PIN y autorización de acciones.
- `src/shell.js`: pantallas, perfil local, listado de dispositivos y navegación.
- `src/remote.js`: flujo WebRTC opcional y gestión de máscara/capacidades.
- `src/supabase-remote.js`: cuenta y señalización privada con Supabase.
- `supabase/`: migración, función Edge e instrucciones de configuración.

## Validación

Con Playwright, Chromium y el servidor estático en marcha:

```sh
npm test
node --test tests/supabase_rls.test.mjs tests/supabase_edge.test.mjs
python3 tests/supabase_ui.py
```

La suite actual de aplicación cubre onboarding, perfil local, navegación, registro y eliminación real de clips, PIN, audio, aviso completo/sirena, inferencia real del modelo y errores de almacenamiento. La cámara de pruebas es sintética. Las peticiones del test de cuenta se interceptan con respuestas controladas; eso verifica el SDK y la interfaz, no un proyecto remoto real. Los scripts anteriores conservados en tests documentan coberturas de versiones previas; no todos siguen las pantallas actuales.

Resultados e historial: [TESTING.md](TESTING.md). No hay un iPhone conectado a este entorno y WebKit no está instalado. Se requiere probar Safari físico antes de confiar en vigilancia prolongada.

## Límites importantes

- Mantén el móvil alimentado, ventilado, con Safari visible y pantalla desbloqueada. Cámara y análisis pueden detenerse al ocultar la app o bloquear el teléfono. Wake Lock solo se usa si existe. No se mide temperatura; no hay sensor térmico inventado.
- La cámara requiere HTTPS o localhost. Nunca se solicita micrófono. Un permiso/cámara interrumpidos se registran y no se presentan como vídeo en directo válido.
- El vídeo nativo se muestra independientemente del análisis; los cuadros y máscaras se dibujan aparte. La vista previa de Inicio se actualiza cada pocos segundos y también aplica la máscara. No es una transmisión adicional.
- Movimiento usa cambios entre fotogramas con compensación global de luz, umbral de área y confirmación. No garantiza eliminar lluvia o sombras. Personas usa Human 3.3.6/CenterNet MobileNet local, opcional y con intervalos; no identifica personas ni mide precisión en tu entrada.
- Imagen/nocturno/consumo se ajustan automáticamente. No hay visión infrarroja: no se detecta lo que la cámara no puede ver.
- La linterna solo se habilita si getCapabilities expone torch y cada orden se aplica con verificación. Muchas versiones de Safari/iPhone no lo permiten. El parpadeo lento alterna cada 2 s y tiene límite temporal; se apaga al detener vigilancia/cámara.
- Aviso y sirena usan HTMLAudioElement y sesión playback donde se admite. Probar sonido comprueba reproducción de navegador; el altavoz, modo Silencio y salida Bluetooth/AirPlay solo pueden verificarse en el móvil físico.
- IndexedDB y la cuota de Safari no garantizan permanencia. Descarga evidencias importantes. Un error de guardado conserva el clip pendiente solo en memoria hasta descargarlo o cerrar la página. La limpieza opcional protege los marcados importantes, pero Safari puede expulsar todos los datos.
- MediaRecorder/formatos/canvas.captureStream se comprueban. Sin vídeo procesado no se permite grabar o compartir máscaras/zoom que no puedan aplicarse. Las fotos siguen disponibles. La grabación continua rota clips con pequeños huecos de cierre, no es vídeo sin cortes garantizados.
- El PIN es una barrera local, no cifrado ni autenticación de servidor. Borrar datos del sitio elimina el PIN y puede eliminar clips; herramientas del navegador pueden manipularlo. No sustituye la cuenta/token remoto. Se limita el número de intentos localmente.

## Recursos locales

El audio `assets/aviso-seguridad.mp3` fue suministrado por el usuario. La sirena y el tono de prueba son archivos generados localmente. No hay carga/reemplazo de MP3 en la interfaz.

Human/CenterNet y sus pesos provienen de `@vladmandic/human@3.3.6`, con integridad de tarball npm verificada durante la instalación original; atribución/licencia en `vendor/HUMAN-LICENSE` y hashes en `models/PROVENANCE.json`. Licencias del cliente Supabase en `vendor/SUPABASE-LICENSES.txt`.
