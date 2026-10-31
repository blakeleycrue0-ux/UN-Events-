# SECURITY CAM con Supabase

Supabase sustituye el servidor WSS propio: Auth controla cuentas, PostgreSQL guarda solo el registro de cámaras y Realtime Broadcast privado transporta SDP/ICE. El vídeo usa WebRTC por TURN y los clips siguen en el teléfono cámara. No se sube vídeo ni MP3 a Supabase Storage. No hay servicio desplegado ni proyecto conectado todavía.

Crear el proyecto puede ser rápido; completar y verificar acceso exterior necesita además el relay y probar dos redes reales. Supabase **no proporciona TURN**. Sin TURN configurado la app bloquea la conexión y lo explica.

## Configuración del propietario

1. Crea un proyecto Supabase. En Auth, crea tu usuario de email y contraseña (o invita y confirma tu email). Usa esa misma cuenta en los dos móviles. No hay formulario público de registro en esta app. Si no necesitas altas públicas, desactiva Allow new users to sign up en el proyecto.
2. En SQL Editor ejecuta `migrations/202610310001_remote.sql`. Es transaccional e idempotente. Activa RLS y rechaza instalar sus políticas si ya hay políticas ajenas sobre realtime.messages: deben revisarse para evitar permisos combinados demasiado amplios. No elimina políticas de otras aplicaciones.
3. Autoriza **solo tu usuario**, sustituyendo el UUID por el que muestra Auth → Users:

```sql
insert into public.remote_memberships (user_id, enabled)
values ('UUID_DE_TU_USUARIO', true)
on conflict (user_id) do update set enabled = true;
```

La tabla de permisos no puede ser modificada desde un cliente autenticado normal. Ninguna cuenta obtiene acceso por el simple hecho de registrarse.

4. Despliega `functions/ice-config` con Supabase CLI, vinculado a tu proyecto:

```sh
supabase link --project-ref REFERENCIA_DEL_PROYECTO
supabase functions deploy ice-config
```

La configuración `verify_jwt=false` del gateway **no autoriza peticiones anónimas**: la función requiere un bearer token, lo valida con `/auth/v1/user` del mismo proyecto y comprueba la membresía mediante RLS. Evita depender de la verificación heredada del gateway cuando se usan claves JWT asimétricas. Un token inválido, otro origen o una cuenta no autorizada no obtiene credenciales.

5. Configura en Edge Functions → Secrets, **sin pegar valores privados en el chat, Git ni la web**:

- `APP_ORIGINS`: orígenes HTTPS exactos separados por coma; para este sitio, `https://unevents.netlify.app`, y otros dominios que controles si son necesarios.
- `TURN_SHARED_SECRET`: secreto de 32+ caracteres del relay Coturn/REST compatible, compartido únicamente entre el relay y esta función.
- `TURN_URLS_JSON`: por ejemplo `["turns:relay.example.com:5349?transport=tcp","turn:relay.example.com:3478?transport=udp"]`, con el host real del relay.

La función genera usuario y contraseña de TURN con HMAC y caducidad de una hora. El secreto permanente nunca llega al navegador. Si tu proveedor de relay utiliza una API diferente a Coturn REST, adapta esta función al API de credenciales efímeras del proveedor; no pongas su token maestro en el cliente. Aún no se ha elegido ni contratado un relay.

6. Publica la app y abre Conexión entre móviles → Mi cuenta de Supabase. En Configurar mi proyecto introduce **URL pública** `https://REFERENCIA.supabase.co` y clave **publishable** o **anon**. Son configuración pública y se guardan localmente. La app rechaza secret y JWT service_role. Nunca uses service_role en Netlify ni en el navegador.
7. Inicia sesión. El móvil cámara debe tener la vigilancia/cámara iniciada, elegir Compartir y pulsar Conectar (requiere PIN local). En el visor usa la misma cuenta, Busca tus cámaras, elige Entrada y conecta. El visor no solicita cámara ni micrófono.

No se han ejecutado estos pasos en un proyecto real: no hay acceso de administración a Supabase en esta sesión.

## Seguridad y funcionamiento

- RLS permite únicamente cámaras del usuario autenticado con membresía habilitada. Un usuario no puede ver ni crear cámaras de otro usuario. Las políticas del canal privado comprueban usuario, membresía y existencia de su cámara.
- Cerrar sesión afecta solo a este móvil, sin revocar la sesión del teléfono cámara. La contraseña del usuario se borra del formulario y no se guarda. La sesión Supabase vive en memoria (`persistSession:false`); al recargar tendrás que introducir el PIN y volver a iniciar sesión para acceso remoto. Los permisos de Realtime dependen también de cómo Supabase renueva/cacha la autorización de canales; no se promete revocación instantánea de un flujo P2P ya establecido.
- El canal usa Broadcast privado; no almacena SDP/ICE en tablas. No hay canales anónimos de vídeo.
- Una cámara atiende a un visor a la vez. Cada anuncio tiene lease/session_id para que una desconexión antigua no retire una nueva publicación. last_seen se marca con reloj de PostgreSQL y la cámara renueva cada 15 s. El visor lista anuncios recientes, no dice que un vídeo esté conectado hasta observar el estado WebRTC.
- El relay se fuerza (`iceTransportPolicy:relay`). La señalización autorizada no demuestra que TURN responda o el vídeo llegue; la UI distingue esos estados.
- La sesión remota termina al caducar sus credenciales (máximo una hora), al desconectar o al ocultar Safari. No hay reconexión automática desatendida ni garantía con el móvil bloqueado. El teléfono cámara debe permanecer desbloqueado y Safari visible.
- La grabación, detección y alarma locales continúan sin Supabase. No hay acceso remoto a evidencias históricas, nube de grabaciones, control remoto de sirena ni notificaciones push en esta fase.
- Nunca se afirma disponibilidad de red ni precisión de IA a partir de las pruebas de autorización.

## Validación realizada

```sh
node --test tests/supabase_rls.test.mjs tests/supabase_edge.test.mjs
python3 tests/supabase_ui.py
```

Se prueba la migración en PostgreSQL local embebido con roles y claims de prueba: aislamiento entre cuentas, rechazo anónimo, cuenta deshabilitada y permisos de Broadcast privado. Las funciones auth.uid y realtime.topic se simulan con los claims de la prueba: esto no sustituye aplicar y verificar políticas en Supabase real.

La función Edge se ejecuta con un runtime Deno simulado y respuestas Auth/RLS controladas; se comprueba rechazo de orígenes/token ausente/membresía y generación HMAC correcta con caducidad. El test del navegador carga el SDK real local, con respuestas HTTP de fixture, para comprobar rechazo de claves privadas, login solo en memoria, logout y bloqueo por ausencia de TURN. No es una prueba contra un proyecto real, ni un test de conexión entre redes.

Pendiente: crear/configurar proyecto, desplegar SQL y Edge Function, configurar relay, probar RLS/Realtime reales y vídeo en Safari entre Wi-Fi y datos móviles. La prueba WebRTC anterior en esta máquina no generó candidatos ICE; no se ha ocultado esa limitación.
