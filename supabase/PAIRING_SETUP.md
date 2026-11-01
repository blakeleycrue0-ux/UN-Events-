# Activar la conexión entre dos móviles

El proyecto ya incluye la interfaz y el servicio de emparejamiento. **Esta sesión no tiene acceso de administración a Supabase ni claves de TURN: no se han instalado estos componentes en tu proyecto real.** Publicar la web en Netlify no instala la base de datos ni la función Edge.

URL pública y clave anon ya configuradas para `pmzekgfgwlfugfffzhrt`. No necesitas repetirlas ni crear un login con email. Las claves privadas se introducen únicamente en los secretos de Supabase.

## 1. Identificar cada móvil sin login

Abre [Authentication del proyecto](https://supabase.com/dashboard/project/pmzekgfgwlfugfffzhrt/auth/providers). En **Sign In / Providers → Anonymous Sign-Ins** habilita los accesos anónimos. El proyecto debe permitir nuevas identidades. Supabase autentica cada instalación con un UUID y token propios; “anónimo” no significa canal público.

Se aplica la limitación de creación de usuarios del proyecto. Si tu proyecto exige CAPTCHA, la integración de su widget queda pendiente: el cliente no puede saltárselo. La aplicación muestra los errores de Auth.

## 2. Instalar los permisos y las invitaciones

Abre [SQL Editor](https://supabase.com/dashboard/project/pmzekgfgwlfugfffzhrt/sql/new), copia **todo** el contenido de [`migrations/202611010001_pairing.sql`](migrations/202611010001_pairing.sql) y pulsa **Run**.

Esta migración funciona por sí sola, sin instalar la migración antigua de login. Si ya existe la anterior, ambas pueden convivir: usan tablas y prefijos de canal diferentes. La nueva migración es idempotente, habilita RLS y no da permiso de escritura directa al navegador. Si hay políticas Realtime ajenas, se detiene para revisarlas; no borra permisos de otras aplicaciones.

Las únicas tablas nuevas guardan vínculos y actividad de conexión. No guardan imágenes, audio ni clips. El enlace privado contiene un secreto aleatorio de 256 bits en el fragmento `#invite=…`, que no se envía al servidor web. Se envía a Supabase únicamente su hash SHA-256; tampoco se permite leer ese hash desde REST. La aceptación es atómica, caduca a los diez minutos y solo vale una vez.

## 3. Preparar TURN sin montar un servidor

Supabase transporta la señalización, **no el vídeo**. Para conectar Wi-Fi con datos móviles esta implementación exige un relay TURN autenticado.

Opción alojada: en Cloudflare, abre **Realtime → TURN**, crea una clave TURN y conserva su **Key ID** y **API Token**. Revisa las condiciones/cuota del proveedor antes de activarlo. El código admite la API de credenciales efímeras de Cloudflare; no se ha probado contra una cuenta real en esta sesión.

En [Edge Functions → Secrets de Supabase](https://supabase.com/dashboard/project/pmzekgfgwlfugfffzhrt/functions/secrets), configura:

| Nombre | Valor |
| --- | --- |
| `APP_ORIGINS` | El origen exacto de la web que abres, sin barra final. Ejemplo: `https://unevents.netlify.app`. Si usas varios dominios propios, sepáralos por coma. |
| `CLOUDFLARE_TURN_KEY_ID` | Key ID de TURN |
| `CLOUDFLARE_TURN_API_TOKEN` | API Token de esa clave TURN |

**No pegues el API Token aquí en el chat, en Git, en Netlify público ni en el formulario de la app.** El navegador recibe credenciales efímeras de una hora; no la clave del proveedor.

Alternativa si ya dispones de Coturn compatible con REST: omite los dos secretos de Cloudflare y configura `TURN_SHARED_SECRET` (32+ caracteres) y `TURN_URLS_JSON`, compartiendo el secreto únicamente entre Coturn y la función. No hace falta instalar ambas opciones.

## 4. Desplegar la función de conexión

En [Edge Functions](https://supabase.com/dashboard/project/pmzekgfgwlfugfffzhrt/functions), crea/despliega una función llamada **`ice-config`** con el contenido íntegro de [`functions/ice-config/index.ts`](functions/ice-config/index.ts). Es un solo archivo, sin dependencias externas.

Desactiva **Verify JWT with legacy secret** en la configuración de esta función. El gateway heredado puede rechazar tokens firmados con claves nuevas. **La función sí exige y valida el token** consultando Auth y comprueba el vínculo mediante RLS antes de emitir credenciales TURN. No se vuelve pública por desactivar ese control heredado.

Si usas CLI, el archivo `config.toml` ya contiene esa opción:

```sh
supabase link --project-ref pmzekgfgwlfugfffzhrt
supabase functions deploy ice-config
```

## 5. Enlazar los móviles

Publica la rama con estos cambios en Netlify. Después:

1. **Móvil visor:** desbloquea la app con su PIN → Cámaras → `+` → **Usar otro móvil** → **Crear invitación**. Confirma el PIN y copia/comparte el enlace.
2. **iPhone cámara:** abre ese enlace en **Safari**, crea su propio PIN si es la primera vez y pulsa **Aceptar y vincular este iPhone**. El PIN no se envía al otro móvil.
3. En ese iPhone, pulsa **Activar cámara y compartir**, confirma el PIN y permite la cámara. No se solicita micrófono. Mantén Safari visible y el teléfono desbloqueado.
4. **Móvil visor:** pulsa **Actualizar conexiones → Ver directo**, confirma su PIN. `LIVE` aparece únicamente cuando el elemento de vídeo reproduce fotogramas; la suscripción al canal o la negociación SDP no bastan.
5. Para clips por personas, **arma la vigilancia en el iPhone cámara**. Compartir el directo no arma ni inicia grabación continua. Los clips y el historial se quedan allí; el visor no tiene descarga de clips ni control remoto de sirena en esta versión.

Cada vínculo conecta un visor con un iPhone cámara. Puedes registrar varias cámaras, pero este cliente abre un solo directo a la vez. Desvincular requiere PIN. Durante un directo, los permisos se revisan aproximadamente cada doce segundos; si desaparece la conexión al servicio, se cierra el directo. No se promete revocación instantánea de una conexión P2P ya establecida. Las leases caducan tras 45 segundos sin renovación y una pestaña antigua no puede retirar la lease de otra nueva.

El directo se corta al bloquear la app, ocultar Safari, cambiar/detener la cámara o caducar las credenciales (sesión máxima de 55 minutos); para continuar pulsa conectar de nuevo. Los vínculos sobreviven a recargas porque la identidad del dispositivo se guarda en el navegador. **Borrar los datos del sitio pierde esa identidad:** sin cuenta de recuperación, tendrás que generar otro enlace. No compartas ni reutilices la misma sesión del navegador entre dispositivos.

## Validación antes de usarlo fuera de casa

Prueba primero en la misma red, luego deja el iPhone cámara en Wi-Fi y pasa el visor a datos móviles. Comprueba llegada de fotogramas, pausa/reconexión, revocación desde ambos extremos y un clip local por persona. Prueba físicamente Safari, temperatura, batería y duración con la carcasa real. La pantalla debe permanecer encendida y una carcasa cerrada puede provocar calor.

Se han probado PostgreSQL/RLS, flujo UI con SDK real y servicio controlado, y negociación SDP de dos navegadores Chromium. **No se ha validado vídeo a través de TURN real, este proyecto Supabase desplegado, Safari en un iPhone físico ni dos redes externas.** La app presenta los fallos de Auth, SQL y TURN en lugar de simular una conexión.
