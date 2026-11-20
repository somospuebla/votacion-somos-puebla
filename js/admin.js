import { auth, db, A, F, esc, genCode, normCode, sha256Hex, computeResults, resultsHTML, configured, showConfigWarning } from "./common.js";

const $ = (s) => document.querySelector(s);
const S = { polls: [], members: [], ballots: [], used: [], started: false };

if (!configured) showConfigWarning($("#warn"));
else {
  A.onAuthStateChanged(auth, async (user) => {
    if (!user || user.isAnonymous) {
      $("#login").classList.remove("hidden");
      $("#panel").classList.add("hidden");
      return;
    }
    const ok = await F.getDoc(F.doc(db, "admins", user.uid)).then((s) => s.exists(), () => false);
    if (!ok) {
      $("#loginMsg").textContent = `Esta cuenta no es administradora. Su UID es: ${user.uid}`;
      await A.signOut(auth);
      return;
    }
    $("#login").classList.add("hidden");
    $("#panel").classList.remove("hidden");
    start();
  });
}

$("#loginForm").onsubmit = async (e) => {
  e.preventDefault();
  $("#loginMsg").textContent = "";
  try {
    await A.signInWithEmailAndPassword(auth, $("#email").value, $("#pass").value);
  } catch {
    $("#loginMsg").textContent = "Correo o contraseña incorrectos.";
  }
};
$("#logout").onclick = () => A.signOut(auth);

document.querySelectorAll("[data-tab]").forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll("[data-tab]").forEach((x) => x.classList.toggle("active", x === b));
    $("#tab-polls").classList.toggle("hidden", b.dataset.tab !== "polls");
    $("#tab-members").classList.toggle("hidden", b.dataset.tab !== "members");
  };
});

function start() {
  if (S.started) return;
  S.started = true;
  const sub = (name, key, order) =>
    F.onSnapshot(order ? F.query(F.collection(db, name), order) : F.collection(db, name), (snap) => {
      S[key] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      render();
    }, (e) => console.error("Error leyendo " + name + ": " + e.message));
  sub("polls", "polls", F.orderBy("createdAt", "desc"));
  sub("members", "members", F.orderBy("name"));
  sub("ballots", "ballots");
  sub("usedCodes", "used");
}

// ---------- Votaciones ----------
$("#pollForm").onsubmit = async (e) => {
  e.preventDefault();
  const msg = $("#pollMsg");
  msg.textContent = "";
  const options = [...new Set($("#pOpts").value.split("\n").map((s) => s.trim()).filter(Boolean))];
  if (options.length < 2) return (msg.textContent = "Se necesitan al menos 2 opciones distintas.");
  try {
    await F.addDoc(F.collection(db, "polls"), {
      title: $("#pTitle").value.trim(),
      description: $("#pDesc").value.trim(),
      type: $("#pType").value,
      options,
      status: "draft",
      createdAt: F.serverTimestamp(),
    });
    $("#pTitle").value = "";
    $("#pDesc").value = "";
  } catch (err) {
    msg.textContent = err.message;
  }
};

const statusLabel = { draft: "Borrador", open: "Abierta", closed: "Cerrada" };

function pollCard(p) {
  const bs = S.ballots.filter((b) => b.pollId === p.id);
  const used = S.used.filter((u) => u.pollId === p.id);
  const usedHashes = new Set(used.map((u) => u.codeHash));
  const pending = S.members.filter((m) => !usedHashes.has(m.codeHash));
  const res = p.status === "closed" && p.results ? p.results : computeResults(p, bs);
  const actions =
    p.status === "draft"
      ? `<button class="small" data-act="open" data-id="${p.id}">Abrir votación</button>
         <button class="small danger" data-act="del" data-id="${p.id}">Eliminar</button>`
      : p.status === "open"
      ? `<button class="small danger" data-act="close" data-id="${p.id}">Cerrar y publicar resultados</button>`
      : "";
  const stats =
    p.status === "draft"
      ? ""
      : `<p class="muted">Participación: ${used.length} de ${S.members.length} consejeros.
        ${p.status === "open" ? "Conteo en vivo (solo visible para ti)." : ""}</p>
        ${resultsHTML(p, res)}
        ${p.status === "open" && pending.length ? `<details><summary>Faltan por votar (${pending.length})</summary><p class="voters">${pending.map((m) => esc(m.name)).join(", ")}</p></details>` : ""}`;
  return `<div class="card"><div class="row between"><h2>${esc(p.title)}</h2>
    <span class="badge ${p.status}">${statusLabel[p.status]} · ${p.type === "secret" ? "Secreto" : "Nominal"}</span></div>
    ${p.description ? `<p>${esc(p.description)}</p>` : ""}
    ${p.status === "draft" ? `<p class="muted">Opciones: ${p.options.map(esc).join(" · ")}</p>` : ""}
    ${stats}<div class="row" style="margin-top:10px">${actions}</div></div>`;
}

$("#pollList").onclick = async (e) => {
  const btn = e.target.closest("button[data-act]");
  if (!btn) return;
  const p = S.polls.find((x) => x.id === btn.dataset.id);
  const ref = F.doc(db, "polls", p.id);
  try {
    if (btn.dataset.act === "open") {
      if (!S.members.length && !confirm("No hay consejeros registrados. ¿Abrir de todos modos?")) return;
      await F.updateDoc(ref, { status: "open", openedAt: F.serverTimestamp() });
    } else if (btn.dataset.act === "del") {
      if (confirm("¿Eliminar este borrador?")) await F.deleteDoc(ref);
    } else if (btn.dataset.act === "close") {
      if (!confirm("Al cerrar ya no se podrá votar y los resultados serán visibles para todos los consejeros. ¿Continuar?")) return;
      const snap = await F.getDocs(F.query(F.collection(db, "ballots"), F.where("pollId", "==", p.id)));
      const results = computeResults(p, snap.docs.map((d) => d.data()));
      await F.updateDoc(ref, { status: "closed", results, closedAt: F.serverTimestamp() });
    }
  } catch (err) {
    alert("Error: " + err.message);
  }
};

// ---------- Consejeros ----------
$("#memberForm").onsubmit = async (e) => {
  e.preventDefault();
  const msg = $("#memberMsg");
  msg.textContent = "";
  const names = $("#mNames").value.split("\n").map((s) => s.trim()).filter(Boolean);
  if (!names.length) return;
  try {
    for (let i = 0; i < names.length; i += 150) {
      const b = F.writeBatch(db);
      for (const name of names.slice(i, i + 150)) {
        const code = normCode(genCode());
        const codeHash = await sha256Hex(code);
        b.set(F.doc(db, "codes", codeHash), { name, at: F.serverTimestamp() });
        b.set(F.doc(F.collection(db, "members")), { name, code, codeHash, at: F.serverTimestamp() });
      }
      await b.commit();
    }
    $("#mNames").value = "";
  } catch (err) {
    msg.textContent = err.message;
  }
};

const fmt = (c) => c.slice(0, 4) + "-" + c.slice(4);

$("#memberRows").onclick = async (e) => {
  const btn = e.target.closest("button[data-act]");
  if (!btn) return;
  const m = S.members.find((x) => x.id === btn.dataset.id);
  if (btn.dataset.act === "print") printCards([m]);
  if (btn.dataset.act === "delm" && confirm(`¿Eliminar a ${m.name}? Su código dejará de funcionar.`)) {
    try {
      const b = F.writeBatch(db);
      b.delete(F.doc(db, "members", m.id));
      b.delete(F.doc(db, "codes", m.codeHash));
      await b.commit();
    } catch (err) {
      console.error(err);
      alert("No se pudo quitar a " + m.name + ": " + (err.code || "") + " " + err.message);
    }
  }
};
$("#printAll").onclick = () => S.members.length && printCards(S.members);

function printCards(list) {
  const base = new URL("index.html", location.href).href;
  const area = $("#printArea");
  area.innerHTML = list
    .map((m) => `<div class="pcard"><h3>Consejo Estatal · Somos Puebla</h3><p>${esc(m.name)}</p>
      <div class="qr" data-url="${esc(base + "?c=" + m.code)}"></div>
      <div class="pcode">${fmt(m.code)}</div>
      <p>Escanea el QR o entra a ${esc(base)} e ingresa tu código.</p>
      <p><strong>Personal e intransferible. No lo compartas.</strong></p></div>`)
    .join("");
  area.querySelectorAll(".qr").forEach((el) => new QRCode(el, { text: el.dataset.url, width: 130, height: 130, correctLevel: QRCode.CorrectLevel.M }));
  setTimeout(() => window.print(), 400);
}

function render() {
  $("#pollList").innerHTML = S.polls.length ? S.polls.map(pollCard).join("") : '<div class="card muted">Aún no hay votaciones.</div>';
  $("#mCount").textContent = S.members.length;
  $("#memberRows").innerHTML = S.members
    .map((m) => `<tr><td>${esc(m.name)}</td><td><code class="code">${fmt(m.code)}</code></td>
      <td class="row"><button class="secondary small" data-act="print" data-id="${m.id}">Tarjeta</button>
      <button class="secondary small" data-act="delm" data-id="${m.id}">Quitar</button></td></tr>`)
    .join("");
}
