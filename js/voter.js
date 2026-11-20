import { auth, db, A, F, esc, normCode, sha256Hex, resultsHTML, configured, showConfigWarning, DISCLAIMER } from "./common.js";

const app = document.getElementById("app");
document.getElementById("disclaimer").textContent = DISCLAIMER;

const state = { uid: null, codeHash: null, name: null, polls: { open: [], closed: [] }, voted: {}, picked: {}, confirming: {}, msg: {} };

if (!configured) showConfigWarning(app);
else init();

async function init() {
  try {
    await auth.authStateReady();
    if (auth.currentUser && !auth.currentUser.isAnonymous) await A.signOut(auth);
    if (!auth.currentUser) await A.signInAnonymously(auth);
    state.uid = auth.currentUser.uid;
  } catch (e) {
    app.innerHTML = `<div class="card warn"><h2>No se pudo conectar</h2><p>${esc(e.message)}</p></div>`;
    return;
  }
  const url = new URL(location.href);
  const fromUrl = url.searchParams.get("c");
  if (fromUrl) history.replaceState(null, "", url.pathname); // quita el código de la barra de direcciones
  const code = fromUrl || sessionStorage.getItem("sp_code");
  if (code) await login(code, !!fromUrl);
  else renderLogin();
}

function renderLogin(err = "") {
  app.innerHTML = `<div class="card">
    <h2>Ingresa tu código de consejero</h2>
    <p class="muted">Escribe el código de tu tarjeta o escanea el código QR con la cámara de tu teléfono.</p>
    <form id="f">
      <input class="code-input" id="code" type="text" inputmode="text" autocomplete="off" autocapitalize="characters" placeholder="XXXX-XXXX" maxlength="12" required>
      <p class="msg-err" id="err">${esc(err)}</p>
      <button type="submit" style="width:100%">Entrar</button>
    </form></div>`;
  document.getElementById("f").onsubmit = async (e) => {
    e.preventDefault();
    await login(document.getElementById("code").value);
  };
}

async function login(raw) {
  const code = normCode(raw);
  if (code.length !== 8) return renderLogin("El código debe tener 8 caracteres.");
  try {
    const hash = await sha256Hex(code);
    const snap = await F.getDoc(F.doc(db, "codes", hash));
    if (!snap.exists()) {
      sessionStorage.removeItem("sp_code");
      return renderLogin("Código no válido.");
    }
    state.codeHash = hash;
    state.name = snap.data().name;
    sessionStorage.setItem("sp_code", code);
    startPolls();
  } catch (e) {
    renderLogin("Error de conexión: " + e.message);
  }
}

function logout() {
  sessionStorage.removeItem("sp_code");
  location.reload();
}

function startPolls() {
  for (const status of ["open", "closed"]) {
    F.onSnapshot(
      F.query(F.collection(db, "polls"), F.where("status", "==", status)),
      async (snap) => {
        state.polls[status] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        await refreshVoted();
        render();
      },
      (err) => (app.innerHTML = `<div class="card warn"><p>${esc(err.message)}</p></div>`)
    );
  }
}

async function refreshVoted() {
  await Promise.all(
    state.polls.open.map(async (p) => {
      if (state.voted[p.id]) return;
      const s = await F.getDoc(F.doc(db, "usedCodes", `${p.id}_${state.codeHash}`));
      if (s.exists()) state.voted[p.id] = true;
    })
  );
}

const byDate = (a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0);
const typeLabel = (p) => (p.type === "secret" ? "Voto secreto" : "Voto nominal");

function render() {
  const open = [...state.polls.open].sort(byDate);
  const closed = [...state.polls.closed].sort(byDate);
  let html = `<div class="card row between"><div><strong>${esc(state.name)}</strong><br><span class="muted">Consejero(a) estatal</span></div>
    <button class="secondary small" id="out">Salir</button></div>`;

  html += `<h2 style="margin:18px 0 8px">Votaciones abiertas</h2>`;
  html += open.length ? open.map(openCard).join("") : `<div class="card muted">No hay votaciones abiertas por ahora.</div>`;
  if (closed.length) {
    html += `<h2 style="margin:18px 0 8px">Resultados</h2>` + closed.map(closedCard).join("");
  }
  app.innerHTML = html;
  document.getElementById("out").onclick = logout;
  app.querySelectorAll("[data-poll]").forEach((el) => {
    const id = el.dataset.poll;
    el.querySelectorAll("input[type=radio]").forEach((r) => (r.onchange = () => (state.picked[id] = r.value)));
    el.querySelector("[data-act=review]")?.addEventListener("click", () => {
      if (state.picked[id] === undefined) return;
      state.confirming[id] = true;
      state.msg[id] = "";
      render();
    });
    el.querySelector("[data-act=back]")?.addEventListener("click", () => {
      state.confirming[id] = false;
      render();
    });
    el.querySelector("[data-act=cast]")?.addEventListener("click", () => cast(id));
  });
}

function openCard(p) {
  const head = `<div class="row between"><h2>${esc(p.title)}</h2><span class="badge open">${typeLabel(p)}</span></div>
    ${p.description ? `<p>${esc(p.description)}</p>` : ""}`;
  if (state.voted[p.id]) {
    return `<div class="card" data-poll="${p.id}">${head}<p class="msg-ok">✔ Tu voto ya fue registrado. Gracias.</p></div>`;
  }
  const picked = state.picked[p.id];
  if (state.confirming[p.id]) {
    return `<div class="card" data-poll="${p.id}">${head}
      <p>Vas a votar: <strong>${esc(p.options[picked])}</strong></p>
      <p class="muted">${p.type === "secret" ? "Tu voto es secreto." : "Esta votación es nominal: se registrará tu nombre junto con tu voto."} No podrás modificarlo.</p>
      <p class="msg-err">${esc(state.msg[p.id] || "")}</p>
      <div class="row"><button data-act="cast">Confirmar voto</button><button class="secondary" data-act="back">Cambiar</button></div></div>`;
  }
  const opts = p.options
    .map((o, i) => `<label class="opt"><input type="radio" name="o_${p.id}" value="${i}" ${String(picked) === String(i) ? "checked" : ""}> ${esc(o)}</label>`)
    .join("");
  return `<div class="card" data-poll="${p.id}">${head}${opts}
    <p class="msg-err">${esc(state.msg[p.id] || "")}</p>
    <button data-act="review" style="width:100%">Continuar</button></div>`;
}

function closedCard(p) {
  return `<div class="card"><div class="row between"><h2>${esc(p.title)}</h2><span class="badge closed">Cerrada · ${typeLabel(p)}</span></div>
    ${p.description ? `<p class="muted">${esc(p.description)}</p>` : ""}
    ${resultsHTML(p, p.results)}</div>`;
}

async function cast(id) {
  const p = state.polls.open.find((x) => x.id === id);
  const idx = state.picked[id];
  if (!p || idx === undefined) return;
  const btn = app.querySelector(`[data-poll="${id}"] [data-act=cast]`);
  if (btn) btn.disabled = true;
  try {
    const b = F.writeBatch(db);
    b.set(F.doc(db, "tickets", `${id}_${state.uid}`), { pollId: id, codeHash: state.codeHash });
    b.set(F.doc(db, "usedCodes", `${id}_${state.codeHash}`), {
      pollId: id, codeHash: state.codeHash, uid: state.uid, name: state.name, at: F.serverTimestamp(),
    });
    const ballot = { pollId: id, option: p.options[idx], at: F.serverTimestamp() };
    if (p.type === "nominal") Object.assign(ballot, { codeHash: state.codeHash, name: state.name });
    b.set(F.doc(F.collection(db, "ballots")), ballot);
    await b.commit();
    state.voted[id] = true;
  } catch (e) {
    state.msg[id] = e.code === "permission-denied"
      ? "No se pudo registrar el voto: la votación pudo cerrarse o tu código ya votó."
      : "Error: " + e.message;
    state.confirming[id] = false;
  }
  render();
}
