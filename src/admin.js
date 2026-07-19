const app = document.querySelector("#adminApp");
const TOKEN_KEY = "self-reviser.admin.access-token.v1";
const state = { token: "", sessions: [], selected: null, filters: { q: "", status: "", date: "" } };

function escapeHtml(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"); }
function formatDate(value) { return value ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/London" }).format(new Date(value)) : "—"; }
function tokenFromLocation() { const hash = new URLSearchParams(location.hash.slice(1)); return hash.get("access_token") || ""; }
function setToken(token) { state.token = token; if (token) sessionStorage.setItem(TOKEN_KEY, token); else sessionStorage.removeItem(TOKEN_KEY); }
async function request(url, options = {}) { const response = await fetch(url, { ...options, headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}), ...(options.headers || {}) } }); const payload = await response.json().catch(() => ({})); if (!response.ok) { const error = new Error(payload.error || "Request failed."); error.status = response.status; throw error; } return payload; }

function renderLogin(message = "") {
  app.innerHTML = `<section class="login"><div class="panel"><header><h1>Private archive</h1></header><div class="panel-body"><p class="muted">Self Reviser exhibition archive. Access is limited to invited administrator email accounts.</p><form id="loginForm"><label class="field">Email address<input id="email" type="email" required autocomplete="email" /></label><button type="submit">Send sign-in link</button></form><p class="notice">${escapeHtml(message)}</p></div></div></section>`;
  document.querySelector("#loginForm").addEventListener("submit", async (event) => { event.preventDefault(); const email = document.querySelector("#email").value; const button = event.currentTarget.querySelector("button"); button.disabled = true; try { const result = await request("/api/admin/auth/request-link", { method: "POST", body: JSON.stringify({ email }) }); renderLogin(result.message); } catch { renderLogin("The sign-in link could not be requested. Check the administrator setup."); } });
}

function renderArchive(user) {
  app.innerHTML = `<header class="admin-header"><div><p class="admin-kicker">Self Reviser / private archive</p><h1>Exhibition sessions</h1></div><div class="meta">Signed in as ${escapeHtml(user.email)}<br /><button id="signOut" class="secondary">Sign out</button></div></header><div class="admin-grid"><section class="panel"><header><h2>Sessions</h2><span id="sessionCount" class="meta"></span></header><div class="panel-body"><form id="filters" class="filters"><input name="q" placeholder="Search text" /><select name="status"><option value="">All states</option><option value="active">Active</option><option value="completed">Completed</option><option value="incomplete">Incomplete</option></select><input name="date" type="date" /><button type="submit">Filter</button></form><div id="sessionList" class="session-list"></div></div></section><section class="panel"><header><h2>Session detail</h2><div id="detailActions" class="detail-actions"></div></header><div id="sessionDetail" class="detail-empty">Select a session to inspect its Draft, Editorial Notes and Revision history.</div></section></div>`;
  document.querySelector("#signOut").addEventListener("click", () => { setToken(""); renderLogin("Signed out."); });
  document.querySelector("#filters").addEventListener("submit", (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); state.filters = { q: form.get("q") || "", status: form.get("status") || "", date: form.get("date") || "" }; void loadSessions(); });
}

function renderSessionList() {
  document.querySelector("#sessionCount").textContent = `${state.sessions.length} shown`;
  const list = document.querySelector("#sessionList");
  list.innerHTML = state.sessions.length ? state.sessions.map((session) => `<button class="session-row ${state.selected?.id === session.id ? "active" : ""}" data-session-id="${session.id}"><span class="session-number">${String(session.sequence_number).padStart(4, "0")}</span><span><strong>${escapeHtml(session.author_label || "Visitor session")}</strong><br /><span class="meta">${formatDate(session.created_at)} · ${session.word_count || 0} words · ${session.paragraph_count} paragraphs</span></span><span class="status ${escapeHtml(session.status)}">${escapeHtml(session.status)}</span></button>`).join("") : '<p class="detail-empty">No sessions match these filters.</p>';
  list.querySelectorAll(".session-row").forEach((button) => button.addEventListener("click", () => void loadSession(button.dataset.sessionId)));
}

async function loadSessions() { try { const query = new URLSearchParams(Object.entries(state.filters).filter(([, value]) => value)); const result = await request(`/api/admin/sessions?${query}`); state.sessions = result.sessions; renderSessionList(); } catch (error) { if (error.status === 401) { setToken(""); renderLogin("Your sign-in session has expired."); } } }

function renderSessionDetail(session) {
  const documentState = session.document_state || {}; const paragraphs = Array.isArray(documentState.paragraphs) ? documentState.paragraphs : [];
  const detail = document.querySelector("#sessionDetail");
  document.querySelector("#detailActions").innerHTML = `<button id="downloadJson" class="secondary">Download JSON</button>`;
  document.querySelector("#downloadJson").addEventListener("click", () => void downloadJson(session.id, session.sequence_number));
  detail.className = "document-view";
  detail.innerHTML = `<p class="meta">Session ${String(session.sequence_number).padStart(4, "0")} · ${escapeHtml(session.status)} · created ${formatDate(session.created_at)} · updated ${formatDate(session.updated_at)}</p>${paragraphs.map((paragraph, index) => `<section><p>${escapeHtml(paragraph.text)}</p>${(paragraph.comments || []).map((note) => `<div class="note"><strong>Editorial note</strong><br />${escapeHtml(note.text)}<br /><span class="meta">Source: ${escapeHtml(note.source_quote)}</span></div>`).join("")}${(paragraph.revision?.history || []).map((pass) => `<details class="pass"><summary>Revision Pass ${pass.pass_number} · ${escapeHtml(pass.status || "completed")}</summary><pre>${escapeHtml(JSON.stringify(pass, null, 2))}</pre></details>`).join("")}</section>`).join("") || '<p>No saved paragraphs.</p>'}`;
}

async function loadSession(id) { try { const result = await request(`/api/admin/sessions/${id}`); state.selected = result.session; renderSessionList(); renderSessionDetail(result.session); } catch (error) { if (error.status === 401) { setToken(""); renderLogin("Your sign-in session has expired."); } } }

async function downloadJson(id, sequence) { try { const response = await fetch(`/api/admin/sessions/${id}/json`, { headers: { Authorization: `Bearer ${state.token}` } }); if (!response.ok) throw new Error("Download unavailable."); const blob = await response.blob(); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `self-reviser-session-${String(sequence).padStart(4, "0")}.json`; link.click(); URL.revokeObjectURL(url); } catch { alert("JSON download could not be generated."); } }

async function boot() { const hashToken = tokenFromLocation(); if (hashToken) { setToken(hashToken); history.replaceState({}, document.title, location.pathname); } else setToken(sessionStorage.getItem(TOKEN_KEY) || ""); if (!state.token) return renderLogin(); try { const user = await request("/api/admin/me"); renderArchive(user); await loadSessions(); } catch { setToken(""); renderLogin("Sign in with your administrator email."); } }
void boot();
