// Configura Telegram para los avisos de la dueña (gratis) en 2 minutos.
//   1) En Telegram abre @BotFather → /newbot → ponle nombre → copia el TOKEN.
//   2) Abre tu bot nuevo en Telegram y pulsa «Iniciar» (o escríbele «hola»).
//   3) node scripts/telegram-setup.mjs <TOKEN>
// Comprueba el token, encuentra tu chat, te manda un mensaje de prueba y escribe las dos variables en .env.telegram
// (archivo que NO se sube a git). Para ponerlas en Vercel:  ./scripts/vercel-env.sh .env.telegram
import { writeFileSync } from "node:fs";

const token = process.argv[2] || process.env.TELEGRAM_BOT_TOKEN;
if (!token || !/^\d+:[\w-]{30,}$/.test(token)) {
  console.error("Falta el token del bot (algo como 123456789:AAH...). Uso: node scripts/telegram-setup.mjs <TOKEN>");
  process.exit(1);
}
const api = async (method, body) => {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return r.json();
};

const me = await api("getMe");
if (!me.ok) {
  console.error("Telegram no acepta ese token:", me.description);
  process.exit(1);
}
const bot = me.result.username;
console.log(`✔ Bot encontrado: @${bot}`);

const up = await api("getUpdates");
const chats = new Map();
for (const u of up.result ?? []) {
  const c = u.message?.chat ?? u.my_chat_member?.chat ?? u.channel_post?.chat;
  if (c && (c.type === "private" || c.type === "group" || c.type === "supergroup")) chats.set(String(c.id), c.first_name || c.title || c.username || "chat");
}
if (!chats.size) {
  console.error(`✘ Aún no hay ningún chat: abre https://t.me/${bot}, pulsa «Iniciar» (o escríbele «hola») y vuelve a ejecutar este comando.`);
  process.exit(2);
}
const [chatId, name] = [...chats.entries()].pop();
console.log(`✔ Chat encontrado: ${name} (${chatId})`);

const sent = await api("sendMessage", { chat_id: chatId, text: "✅ Pro Diva ya puede avisarte por aquí: nuevas reservas, cancelaciones y el resumen diario." });
if (!sent.ok) {
  console.error("✘ No pude escribirte:", sent.description);
  process.exit(3);
}
console.log("✔ Mensaje de prueba enviado: mira tu Telegram.");

writeFileSync(new URL("../.env.telegram", import.meta.url), `TELEGRAM_BOT_TOKEN=${token}\nTELEGRAM_CHAT_ID=${chatId}\n`);
console.log("✔ Guardado en .env.telegram (no se sube a git). Siguiente: ./scripts/vercel-env.sh .env.telegram y redesplegar.");
