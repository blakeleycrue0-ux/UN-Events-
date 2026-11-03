/**
 * Jarvis · vigilante de Gmail (gratis, funciona aunque el Mac esté apagado).
 *
 * Cómo instalarlo (una vez):
 *  1. Entra en https://script.google.com con tu cuenta de Gmail → «Nuevo proyecto».
 *  2. Borra lo que haya y pega TODO este archivo.
 *  3. Abajo, en JARVIS_KEY, escribe tu clave de Jarvis (la misma que en el ordenador).
 *     Este script es privado: solo lo ves tú en tu cuenta de Google.
 *  4. Arriba, elige la función «instalar» y pulsa ▶ Ejecutar. Acepta los permisos.
 *  Listo: cada 5 minutos mira tus emails nuevos (solo la pestaña Principal) y
 *  se los pasa a Jarvis, que decide si te avisa o te llama.
 */
const JARVIS_KEY = "PEGA_AQUI_TU_CLAVE_DE_JARVIS";
const JARVIS_URL = "https://pmzekgfgwlfugfffzhrt.supabase.co/functions/v1/jarvis-call?step=watch";

function instalar() {
  ScriptApp.getProjectTriggers().forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("mirarGmail").timeBased().everyMinutes(5).create();
  mirarGmail();
  Logger.log("Instalado: Jarvis mirará tu Gmail cada 5 minutos.");
}

function mirarGmail() {
  if (!JARVIS_KEY || JARVIS_KEY.indexOf("PEGA_AQUI") === 0) throw new Error("Falta tu clave de Jarvis en JARVIS_KEY");
  // Solo la bandeja Principal de los últimos 2 días (no promociones ni redes sociales).
  const threads = GmailApp.search("in:inbox category:primary newer_than:2d", 0, 15);
  const items = [];
  threads.forEach((thread) => {
    const m = thread.getMessages().pop();
    const from = m.getFrom().replace(/<[^>]*>/, "").replace(/"/g, "").trim();
    items.push({
      id: m.getId(),
      title: (from + ": " + m.getSubject()).slice(0, 190),
      text: m.getPlainBody().replace(/\s+/g, " ").slice(0, 600),
      url: "https://mail.google.com/mail/u/0/#inbox/" + thread.getId(),
    });
  });
  if (!items.length) return;
  const r = UrlFetchApp.fetch(JARVIS_URL, {
    method: "post", contentType: "application/json", muteHttpExceptions: true,
    headers: { "x-jarvis-key": JARVIS_KEY },
    payload: JSON.stringify({ source: "gmail", items: items }),
  });
  Logger.log(r.getResponseCode() + " " + r.getContentText().slice(0, 200));
}
