// What Jarvis says by itself (without Claude), in English or Spanish.
import { pick, normalize, has } from "./common.js";

export const T = {
  en: {
    start: "Click anywhere to wake me up", waking: "Booting up…", listening: "Listening…", idleHint: "Say “Jarvis…” or press Space",
    online: (n) => pick([`Systems online. Good to have you back, ${n}.`, `All systems online, ${n}.`, `Online and at your service, ${n}.`]),
    morning: "Good morning", afternoon: "Good afternoon", evening: "Good evening",
    greetTail: ["What are we doing today?", "How can I help?", "Good to see you.", "Everything is ready."],
    notHeard: "I didn't catch that.", micDenied: "I need the microphone. Allow it in Chrome.",
    needKey: "Add your Jarvis key in settings so I can talk.",
    time: (t) => `It's ${t}.`, date: (d) => `Today is ${d}.`, timerSet: (x) => `Done. Timer set for ${x}.`,
    timerBad: "I didn't get how long the timer should be.", timerUp: (n) => `${n}, time's up.`,
    device: (d) => `I can't control ${d} yet. Once the universal remote arrives, I'll take care of it.`,
    leaving: (n) => `See you later, ${n}. I'll keep an eye on the door.`,
    thanks: ["You're welcome.", "Any time.", "My pleasure."],
    who: "I'm Jarvis, the assistant of this room.", how: "Running at a hundred percent. And you?",
    help: "Ask me anything. I can play music, open Teams or Gmail, search the web, set timers, email you, and I know who comes through the door.",
    unknown: "I didn't understand that.", yes: ["Yes?", "At your service.", "I'm listening."],
    jokes: ["I'd tell you a UDP joke, but you might not get it.", "There are ten kinds of people: those who understand binary and those who don't."],
    refused: "I'd rather not answer that one.",
    thinkErr: { "Claude key rejected": "My brain's key was rejected. Check ANTHROPIC_API_KEY in Supabase.", "Claude credit exhausted": "My brain has run out of Claude credit.", "Claude busy": "My brain is busy. Try again in a moment.", "Brain not configured": "My brain isn't set up yet. Add ANTHROPIC_API_KEY in Supabase.", "Wrong Jarvis key": "The Jarvis key doesn't match Supabase." },
    thinkDown: "I can't reach my brain right now.",
    devices: { luz: "the lights", aire: "the air conditioning", ventilador: "the fan", tele: "the TV" },
    stranger: "Someone I don't recognise is at the door.",
    media: { pause: "Paused.", resume: "Playing.", next: "Next one.", louder: "Louder.", quieter: "Quieter." },
  },
  es: {
    start: "Haz clic para despertarme", waking: "Arrancando…", listening: "Te escucho…", idleHint: "Di «Jarvis…» o pulsa Espacio",
    online: (n) => pick([`Sistemas en línea. Bienvenido, ${n}.`, `Todo listo, ${n}.`]),
    morning: "Buenos días", afternoon: "Buenas tardes", evening: "Buenas noches",
    greetTail: ["¿Qué hacemos hoy?", "¿En qué te ayudo?", "Me alegro de verte.", "Todo listo por aquí."],
    notHeard: "No te he oído.", micDenied: "Necesito el micrófono. Permítelo en Chrome.",
    needKey: "Pon tu clave de Jarvis en ajustes para que pueda hablar.",
    time: (t) => `Son las ${t}.`, date: (d) => `Hoy es ${d}.`, timerSet: (x) => `Vale, temporizador de ${x}.`,
    timerBad: "No he entendido el tiempo del temporizador.", timerUp: (n) => `${n}, se acabó el tiempo.`,
    device: (d) => `Todavía no puedo controlar ${d}. Cuando llegue el mando universal, lo conecto.`,
    leaving: (n) => `Hasta luego, ${n}. Vigilo la puerta.`,
    thanks: ["De nada.", "Para eso estoy.", "Cuando quieras."],
    who: "Soy Jarvis, el asistente de tu cuarto.", how: "Funcionando al cien por cien. ¿Y tú?",
    help: "Pregúntame lo que quieras. Pongo música, abro Teams o Gmail, busco en internet, pongo temporizadores, te mando emails y sé quién entra por la puerta.",
    unknown: "No te he entendido.", yes: ["¿Sí?", "A tu servicio.", "Te escucho."],
    jokes: ["Hay diez tipos de personas: las que entienden binario y las que no."],
    refused: "Prefiero no contestar a eso.",
    thinkErr: { "Claude key rejected": "La clave de mi cerebro no vale. Revisa ANTHROPIC_API_KEY en Supabase.", "Claude credit exhausted": "Mi cerebro se ha quedado sin crédito de Claude.", "Claude busy": "Mi cerebro está ocupado. Prueba en un momento.", "Brain not configured": "Mi cerebro aún no está configurado.", "Wrong Jarvis key": "La clave de Jarvis no coincide con la de Supabase." },
    thinkDown: "Ahora no puedo conectar con mi cerebro.",
    devices: { luz: "las luces", aire: "el aire acondicionado", ventilador: "el ventilador", tele: "la tele" },
    stranger: "Hay alguien en la puerta que no reconozco.",
    media: { pause: "Pausa.", resume: "Seguimos.", next: "Siguiente.", louder: "Más alto.", quieter: "Más bajo." },
  },
};

// Lines for family members spotted by the wall camera (always English, as asked).
export const FAMILY = {
  mom: [
    "Hi Mum! Are you here to make my bed, or to drop off some clean clothes?",
    "Hello Mum. The room is under control... mostly. Did you bring the laundry?",
    "Welcome, Mum. If you're looking for dirty plates, I saw nothing. Officially.",
  ],
  dad: [
    "Hello Dad. Don't worry, the air conditioning is off. I'm watching the electricity bill for you.",
    "Hi Dad. Checking whether the air conditioning is on again? Relax, everything's under control.",
    "Good to see you, Dad. Yes, the lights are off. Every euro is safe.",
  ],
};

export function greeting(lang, name) {
  const h = new Date().getHours(), s = T[lang] || T.en;
  const part = h >= 6 && h < 13 ? s.morning : h >= 13 && h < 21 ? s.afternoon : s.evening;
  return `${part}, ${name}. ${pick(s.greetTail)}`;
}

const devices = [
  { id: "luz", names: ["luz", "luces", "led", "leds", "lampara", "light", "lights", "lamp"] },
  { id: "aire", names: ["aire", "aire acondicionado", "clima", "air conditioning", "ac", "aircon"] },
  { id: "ventilador", names: ["ventilador", "fan"] },
  { id: "tele", names: ["tele", "television", "televisor", "tv"] },
];
const numbers = { un: 1, uno: 1, una: 1, a: 1, an: 1, one: 1, dos: 2, two: 2, tres: 3, three: 3, cuatro: 4, four: 4, cinco: 5, five: 5, seis: 6, six: 6, siete: 7, seven: 7, ocho: 8, eight: 8, nueve: 9, nine: 9, diez: 10, ten: 10, quince: 15, fifteen: 15, veinte: 20, twenty: 20, treinta: 30, thirty: 30 };

// Instant local actions. Returns { say, timer? } or null.
export function quick(raw, lang, name) {
  const text = normalize(raw), s = T[lang] || T.en;
  const timer = /temporizador|alarma|avisame|cuenta atras|timer|remind me in/.test(text) &&
    /(\d+|un|uno|una|a|an|one|dos|two|tres|three|cuatro|four|cinco|five|seis|six|siete|seven|ocho|eight|nueve|nine|diez|ten|quince|fifteen|veinte|twenty|treinta|thirty|media|half an?) ?(minutos?|minutes?|segundos?|seconds?|horas?|hours?)/.exec(text);
  if (timer) {
    const half = /^(media|half)/.test(timer[1]);
    const n = half ? 0.5 : /\d+/.test(timer[1]) ? +timer[1] : numbers[timer[1]];
    const unit = /^seg|^sec/.test(timer[2]) ? 1000 : /^hora|^hour/.test(timer[2]) ? 3600000 : 60000;
    const ms = n * unit;
    if (!ms || ms > 6 * 3600000) return { say: s.timerBad };
    const label = half ? (lang === "es" ? "media hora" : "half an hour") : `${n} ${timer[2]}`;
    return { say: s.timerSet(label), timer: { ms, label } };
  }
  const device = devices.find((d) => d.names.some((n) => has(text, n.split(" ")[0]) && text.includes(n)));
  if (device && /enciende|encender|apaga|apagar|pon|quita|turn|switch|power/.test(text)) return { say: s.device(s.devices[device.id]) };
  return null;
}
// Basic answers when Claude is not reachable.
export function offline(raw, lang, name) {
  const text = normalize(raw), s = T[lang] || T.en, locale = lang === "es" ? "es-ES" : "en-GB";
  if (has(text, "hora", "time")) return s.time(new Date().toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }));
  if ((has(text, "dia", "fecha", "date", "day")) && !has(text, "buenos")) return s.date(new Date().toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" }));
  if (has(text, "hola", "buenas", "buenos", "hey", "hello", "hi")) return greeting(lang, name);
  if (has(text, "chiste", "joke")) return pick(s.jokes);
  if (has(text, "gracias", "thanks", "thank")) return pick(s.thanks);
  if (/quien eres|who are you/.test(text)) return s.who;
  if (/como estas|que tal|how are you/.test(text)) return s.how;
  if (/que (puedes|sabes) hacer|ayuda|what can you do|help/.test(text)) return s.help;
  return "";
}
