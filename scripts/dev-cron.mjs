// Ejecuta el ciclo de recordatorios cada minuto en local (en producción lo hace GitHub Actions o tu servicio de cron).
// Uso: npm run cron      (con la web en marcha)
const base = process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3101";
const secret = process.env.CRON_SECRET || "local-cron-secret";
const every = Number(process.env.CRON_EVERY_SEC || 60) * 1000;

async function tick() {
  try {
    const r = await fetch(`${base}/api/cron/reminders`, { method: "POST", headers: { Authorization: `Bearer ${secret}` } });
    const j = await r.json().catch(() => ({}));
    console.log(new Date().toLocaleTimeString("es-ES"), r.status, JSON.stringify(j));
  } catch (e) {
    console.log(new Date().toLocaleTimeString("es-ES"), "sin conexión con la web:", e.message);
  }
}
await tick();
setInterval(tick, every);
