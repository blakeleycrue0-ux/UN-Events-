# Servicio opcional de conexión entre móviles

Este servicio transmite únicamente señalización SDP/ICE autenticada. El vídeo viaja cifrado por WebRTC entre móviles o mediante TURN; el servidor no graba vídeo. Las evidencias siguen en IndexedDB del móvil cámara. No hay acceso a clips ni control remoto de sirena desde el visor.

Netlify estático **no ejecuta este servicio ni sustituye TURN**. Sin desplegarlo y configurar un relay no se ofrece acceso garantizado desde otra red. La vigilancia local funciona sin él.

## Producción

Requiere Node 20+, un dominio propio para WSS, HTTPS válido, proceso persistente y relay TURN autenticado. No hay cuentas de usuarios ni base de datos central en esta versión: el emparejamiento usa secretos criptográficos de un solo hogar, con un visor simultáneo.

Configura mediante el gestor de secretos del servidor (no en Git ni en un archivo estático publicado):

- `SIGNALING_ACCESS_TOKEN`: secreto aleatorio de al menos 32 caracteres, exclusivo de la instalación. Generarlo con un gestor de contraseñas; no usar el PIN local ni la clave de los tests. Lo introduce el propietario en el móvil cámara y no se persiste en el navegador.
- `ALLOWED_ORIGINS`: orígenes HTTPS exactos separados por coma, por ejemplo `https://unevents.netlify.app`. Sin comodines.
- `ICE_SERVERS_JSON`: arreglo de servidores TURN autenticados, por ejemplo `[{"urls":["turns:relay.example.com:5349?transport=tcp"],"username":"USUARIO_DEL_RELAY","credential":"CREDENCIAL_DEL_RELAY"}]`. Usar credenciales de corta duración apropiadas a la sesión según el proveedor; no publicar estos valores en la web. Se entregan solo a pares autenticados. Las credenciales estáticas requieren rotación por el operador.
- `TLS_CERT_FILE` y `TLS_KEY_FILE`: rutas al certificado y clave TLS, o usar el proxy local descrito abajo.
- `PORT`: puerto interno (8787 por defecto).

El arranque de producción rechaza ausencia de token, orígenes, TLS o TURN autenticado. La validación de configuración no demuestra que TURN responda: prueba desde Wi-Fi y datos móviles antes de confiar en el acceso remoto.

```sh
npm ci
npm run signal
```

Alternativa TLS: Caddy en el **mismo servidor**, con el servicio escuchando únicamente en 127.0.0.1 y `TRUST_LOCAL_PROXY=1`. Configuración de ejemplo:

```caddyfile
conexion.example.com {
    reverse_proxy 127.0.0.1:8787
}
```

El servicio solo confía en `X-Forwarded-Proto` en ese modo y fuerza el enlace a loopback. No expongas directamente el puerto 8787 a Internet. Con TLS nativo también escucha en loopback; adapta conscientemente el enlace si tu infraestructura lo necesita. Restringe `connect-src wss:` en las cabeceras de Netlify al dominio WSS final una vez conocido.

## Uso

1. En el móvil cámara, abre Vigilancia e inicia cámara/protección y el modo de grabación que quieras.
2. Vuelve a Inicio → Conexión entre móviles. Selecciona Compartir, introduce la URL `wss://.../` y la clave de instalación, y conecta.
3. Copia la clave privada de emparejamiento (192 bits) por un canal de confianza a tu otro móvil.
4. En el visor, Inicio → Ver otra cámara. Introduce URL y clave privada. El visor nunca solicita cámara ni micrófono.
5. Desconectar la cámara revoca la clave. Una habitación y su clave caducan tras una hora; esta versión exige nuevo emparejamiento después. No es un sistema de cuentas persistentes ni vigilancia remota indefinida.

El móvil cámara debe permanecer encendido, con Safari visible y la pantalla desbloqueada. Navegar entre secciones dentro de la web conserva la captura local; ocultar Safari desconecta la conexión remota y conserva la gestión local de pausas existente. No se promete que iOS mantenga cámara al bloquear el móvil.

Si Canvas captureStream está disponible, se transmite el vídeo procesado con máscara. Si falta, solo se permite vídeo nativo sin máscara/zoom; aplicar una máscara o zoom durante esa sesión la desconecta. Las capacidades reales en Safari siguen pendientes de validar. Una conexión activa muestra solo el estado WebRTC observado; no inventa disponibilidad del otro móvil.

## Desarrollo y pruebas

Desarrollo **solo local** permite `ws://127.0.0.1` y `DEVELOPMENT_LOCAL=1`. No usar ese modo en Internet. Los tests contienen claves de fixture explícitamente públicas que no sirven para producción.

```sh
node --test tests/signaling.test.mjs
node tests/remote-fixture.mjs
# En otra terminal, con servidor estático en puerto 8001:
python3 tests/remote.py
```

Las pruebas de autorización, relay de señalización y revocación pasaron. La prueba de vídeo WebRTC **no pasó en esta máquina**: la negociación SDP se completa, pero Chromium no produce candidatos ICE; una prueba mínima independiente, sin este servicio ni esta aplicación, también produjo cero candidatos y no conectó. No se ha validado transporte por TURN ni dos móviles reales en redes distintas. `tests/remote.py` queda como prueba reproducible que falla si el vídeo no llega; no se ha convertido en un test simulado que pase.

El servicio limita tamaño de mensajes, conexiones, habitaciones, frecuencia, un visor por habitación y tiempo de autenticación. Se deniegan orígenes no permitidos. El endpoint `/health` no expone claves, habitaciones ni SDP. No registra credenciales ni vídeo. Para un producto multiusuario faltan cuentas, revocación persistente por dispositivo, auditoría operativa, rotación automática y pruebas reales de disponibilidad.
