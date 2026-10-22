const $ = id => document.getElementById(id);
const socket = io({ autoConnect: false });
let myName = "";
let profiles = [];
let activeProfile = null;
let ownerToken = "";
let ownerConnected = false;
let ownerRoom = "";
let ownerMessages = new Map();

function show(id) { ["entry","chat-app","owner-app"].forEach(x => $(x).classList.toggle("hidden", x !== id)); }
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function time(ts) { return new Date(ts).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}); }
function profileById(id) { return profiles.find(p => p.id === id); }

$("entry-form").addEventListener("submit", async e => {
  e.preventDefault(); $("entry-error").textContent = "";
  const payload = {
    inviteCode: $("invite").value,
    name: $("display-name").value.trim(),
    age: Number($("age").value),
    gender: $("gender").value,
    preference: $("preference").value,
    consent: $("consent").checked
  };
  try {
    const r = await fetch("/api/enter", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "Could not enter.");
    myName = data.name; profiles = data.profiles || [];
    show("chat-app"); renderProfiles();
    socket.connect();
  } catch (err) { $("entry-error").textContent = err.message; }
});

function renderProfiles() {
  $("profile-list").innerHTML = profiles.map(p => `<button class="profile-card ${activeProfile===p.id?"active":""}" data-profile="${esc(p.id)}"><span class="avatar" style="--profile-color:${esc(p.color)}">✦</span><span class="profile-info"><strong>${esc(p.name)}, ${p.age}</strong><span>${esc(p.bio || "Ready to chat")}</span></span></button>`).join("");
  document.querySelectorAll("[data-profile]").forEach(el => el.addEventListener("click", () => joinProfile(el.dataset.profile)));
  const roomSelect = $("owner-room");
  const selected = roomSelect.value;
  roomSelect.innerHTML = '<option value="">Choose a persona…</option>' + profiles.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("");
  roomSelect.value = selected;
}
function joinProfile(id) {
  activeProfile = id; renderProfiles();
  socket.emit("join-profile", {profileId:id});
  $("messages").innerHTML = '<div class="empty-state"><p>Loading conversation…</p></div>';
}
function addMessage(m) {
  if (m.profileId !== activeProfile) return;
  const empty = $("messages").querySelector(".empty-state"); if (empty) empty.remove();
  const mine = m.from === "visitor";
  const div = document.createElement("div");
  div.className = "message" + (mine ? " mine" : "");
  div.innerHTML = `<span class="message-meta">${esc(m.sender)} · ${time(m.timestamp)}</span><div class="bubble">${esc(m.text)}</div>`;
  $("messages").appendChild(div); $("messages").scrollTop = $("messages").scrollHeight;
}
function renderOwnerMessages() {
  const arr = ownerMessages.get(ownerRoom) || [];
  $("owner-messages").innerHTML = arr.length ? arr.map(m => `<div class="owner-message"><strong>${esc(m.sender)} · ${time(m.timestamp)}</strong>${esc(m.text)}</div>`).join("") : '<p class="muted">No messages in this conversation yet.</p>';
  $("owner-messages").scrollTop = $("owner-messages").scrollHeight;
}
function storeOwnerMessage(m) {
  if (!ownerMessages.has(m.profileId)) ownerMessages.set(m.profileId, []);
  const arr = ownerMessages.get(m.profileId);
  if (!arr.some(x => x.id === m.id)) arr.push(m);
  if (ownerRoom === m.profileId) renderOwnerMessages();
}
function renderOwnerProfiles() {
  $("owner-profiles").innerHTML = profiles.map(p => `<div class="owner-profile-row"><span><strong>${esc(p.name)}</strong> · ${p.age}<br><span class="muted">${esc(p.id)}</span></span><button data-delete-profile="${esc(p.id)}">Delete</button></div>`).join("");
  document.querySelectorAll("[data-delete-profile]").forEach(btn => btn.addEventListener("click", async () => {
    if (!confirm("Delete this fictional persona?")) return;
    const r = await fetch("/api/owner/profiles/"+encodeURIComponent(btn.dataset.deleteProfile), {method:"DELETE",headers:{"x-owner-token":ownerToken}});
    const d = await r.json(); if (!r.ok) return alert(d.error || "Delete failed.");
    profiles = d.profiles || profiles.filter(p=>p.id!==btn.dataset.deleteProfile);
    renderProfiles(); renderOwnerProfiles();
  }));
}
socket.on("connect_error", err => { $("entry-error").textContent = err.message || "Connection failed."; });
socket.on("profiles", list => { profiles = list; renderProfiles(); });
socket.on("profiles-updated", list => { profiles = list; renderProfiles(); renderOwnerProfiles(); });
socket.on("history", list => { $("messages").innerHTML = ""; list.forEach(addMessage); if (!list.length) $("messages").innerHTML = '<div class="empty-state"><div class="empty-symbol">✧</div><h3>Say hello.</h3><p>Your messages will appear here.</p></div>'; });
socket.on("joined-profile", p => {
  $("conversation-head").innerHTML = `<div class="avatar" style="background:${esc(p.color)};color:#2a2034">✦</div><div><h2>${esc(p.name)}, ${p.age}</h2><p>${esc(p.bio || "Ready to chat")}</p></div>`;
  $("message-input").disabled = false; document.querySelector("#message-form button").disabled = false;
});
socket.on("message", addMessage);
socket.on("chat-error", msg => alert(msg));
$("message-form").addEventListener("submit", e => {
  e.preventDefault(); const text = $("message-input").value.trim();
  if (!text || !activeProfile) return;
  socket.emit("send-message", {profileId:activeProfile,text});
  $("message-input").value = "";
});
$("leave").addEventListener("click", async () => {
  if (!confirm("Leave this private session? Your in-memory session will be cleared.")) return;
  socket.disconnect();
  await fetch("/api/leave",{method:"POST"});
  activeProfile=null; $("message-input").disabled=true; show("entry");
});
document.querySelector(".footer a").addEventListener("click", e => {
  e.preventDefault(); show("owner-app");
});
$("back-to-chat").addEventListener("click", () => show("chat-app"));
$("owner-connect").addEventListener("click", () => {
  ownerToken = $("owner-token").value;
  if (!ownerToken) { $("owner-status").textContent = "Enter the owner token."; return; }
  socket.emit("owner-auth", {token:ownerToken});
  $("owner-status").textContent = "Checking owner token…";
});
socket.on("owner-auth-result", result => {
  ownerConnected = result.ok;
  $("owner-status").textContent = result.ok ? "Owner console connected." : "Owner token was rejected.";
  if (result.ok) { profiles = result.profiles; renderOwnerProfiles(); renderProfiles(); }
});
$("owner-room").addEventListener("change", () => {
  ownerRoom = $("owner-room").value;
  const p = profileById(ownerRoom);
  $("owner-reply-input").disabled = !ownerConnected || !p;
  $("owner-reply-form").querySelector("button").disabled = !ownerConnected || !p;
  if (ownerConnected && p) {
    socket.emit("owner-join-profile", {profileId:ownerRoom,token:ownerToken});
    renderOwnerMessages();
  }
});
socket.on("owner-history", ({profileId,messages}) => { ownerMessages.set(profileId,messages || []); if(ownerRoom===profileId) renderOwnerMessages(); });
socket.on("owner-inbox", storeOwnerMessage);
$("owner-reply-form").addEventListener("submit", e => {
  e.preventDefault(); const text = $("owner-reply-input").value.trim();
  if (!text || !ownerRoom || !ownerConnected) return;
  socket.emit("owner-reply", {profileId:ownerRoom,text,token:ownerToken});
  $("owner-reply-input").value = "";
});
$("persona-form").addEventListener("submit", async e => {
  e.preventDefault();
  if (!ownerConnected) return $("owner-status").textContent = "Connect the owner console first.";
  const body = {id:$("persona-id").value.trim().toLowerCase(),name:$("persona-name").value.trim(),age:Number($("persona-age").value),bio:$("persona-bio").value.trim(),color:$("persona-color").value};
  const r = await fetch("/api/owner/profiles",{method:"POST",headers:{"Content-Type":"application/json","x-owner-token":ownerToken},body:JSON.stringify(body)});
  const d = await r.json(); if(!r.ok) return $("owner-status").textContent = d.error || "Could not save persona.";
  profiles = d.profiles; renderProfiles(); renderOwnerProfiles(); $("persona-form").reset(); $("persona-age").value=28; $("persona-color").value="#d9b8ff";
});
