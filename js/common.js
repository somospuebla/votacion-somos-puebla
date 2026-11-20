import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import * as A from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import * as F from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

export { A, F };
export const configured = !String(firebaseConfig.apiKey).startsWith("PEGA");
export const app = initializeApp(firebaseConfig);
// Sesión por pestaña: así abrir la vista de consejeros no cierra la sesión del administrador.
export const auth = A.initializeAuth(app, { persistence: A.browserSessionPersistence });
export const db = F.getFirestore(app);

const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sin I, O, 0, 1

export function genCode() {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  const s = [...b].map((x) => ALPHA[x % 32]).join("");
  return s.slice(0, 4) + "-" + s.slice(4);
}

export const normCode = (s) => (s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** ballots: [{option, name?}] -> {counts[], voters[][], total} (alineado con poll.options) */
export function computeResults(poll, ballots) {
  const counts = poll.options.map(() => 0);
  // Firestore no admite arreglos anidados: cada opción guarda sus nombres dentro de un objeto.
  const voters = poll.options.map(() => ({ names: [] }));
  for (const b of ballots) {
    const i = poll.options.indexOf(b.option);
    if (i < 0) continue;
    counts[i]++;
    if (poll.type === "nominal" && b.name) voters[i].names.push(b.name);
  }
  voters.forEach((v) => v.names.sort((a, b) => a.localeCompare(b, "es")));
  return { counts, voters: poll.type === "nominal" ? voters : [], total: counts.reduce((a, b) => a + b, 0) };
}

export function resultsHTML(poll, res) {
  if (!res) return '<p class="muted">Sin resultados.</p>';
  const total = res.total || 0;
  const max = Math.max(...(res.counts || [0]));
  const rows = poll.options
    .map((o, i) => {
      const n = res.counts?.[i] || 0;
      const p = total ? Math.round((n * 1000) / total) / 10 : 0;
      const names = poll.type === "nominal" && res.voters?.[i]?.names?.length ? `<p class="voters">${res.voters[i].names.map(esc).join(", ")}</p>` : "";
      return `<div class="bar-row ${n === max && n > 0 ? "lead" : ""}">
        <div class="bar-label"><span>${esc(o)}</span><strong>${n} · ${p}%</strong></div>
        <div class="bar"><span style="width:${p}%"></span></div>${names}</div>`;
    })
    .join("");
  return rows + `<p class="muted">Total de votos: ${total}</p>`;
}

export const DISCLAIMER =
  "Sistema interno de votación del Consejo Estatal. Los resultados son los registrados en esta plataforma.";

export function showConfigWarning(el) {
  el.innerHTML = `<div class="card warn"><h2>Falta configurar Firebase</h2>
    <p>Edita <code>js/firebase-config.js</code> con los datos de tu proyecto. Revisa el README.</p></div>`;
}
