const $ = id => document.getElementById(id);
const socket = io({ autoConnect: false });
let myName = "";
let profiles = [];
let activeProfile = null;

const notifiedChats = new Set();

function show(id) { ["entry","chat-app","owner-app"].forEach(x => $(x).classList.toggle("hidden", x !== id)); }
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function time(ts) { return new Date(ts).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}); }
function profileById(id) { return profiles.find(p => p.id === id); }

function notifyOwnerOfVisitorMessage(m) {
  if (!ownerConnected || !m || m.from !== "visitor") return;
  const chatKey = String(m.sessionId || m.sender || "visitor") + ":" + m.profileId;
  if (notifiedChats.has(chatKey)) return;
  notifiedChats.add(chatKey);
  const profile = profileById(m.profileId);
  const title = "AfterHours · New message";
  const body = (m.sender || "A visitor") + " messaged " + (profile ? profile.name : "a persona") + ".";
  try {
    if (window.AfterHoursNative && typeof window.AfterHoursNative.notify === "function") {
      window.AfterHoursNative.notify(title, body, String(m.profileId));
    }
  } catch (_) {}
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  try {
    const notice = new Notification(title, {
      body,
      tag: "afterhours-" + chatKey
    });
    notice.onclick = () => {
      window.focus();
      show("owner-app");
      $("owner-room").value = m.profileId;
      $("owner-room").dispatchEvent(new Event("change"));
      notice.close();
    };
  } catch (_) {}
}

async function restoreVisitorSession() {
  try {
    const r = await fetch("/api/session", { credentials: "same-origin" });
    if (!r.ok) return;
    const data = await r.json();
    if (!data.ok) return;
    myName = data.name;
    profiles = data.profiles || [];
    show("chat-app");
    renderProfiles();
    socket.connect();
  } catch (_) {}
}

async function restoreVisitorSession() {
  try {
    const r = await fetch("/api/session", { credentials: "same-origin" });
    if (!r.ok) return;
    const data = await r.json();
    if (!data.ok) return;
    myName = data.name;
    profiles = data.profiles || [];
    show("chat-app");
    renderProfiles();
    socket.connect();
  } catch (_) {}
}

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

}
function joinProfile(id) {
  activeProfile = id; renderProfiles();
  $("delete-chat").disabled = false;
  socket.emit("join-profile", {profileId:id});
  $("messages").innerHTML = '<div class="empty-state"><p>Loading conversation…</p></div>';
}
function addMessage(m) {
  if (m.profileId !== activeProfile) return;
  const empty = $("messages").querySelector(".empty-state"); if (empty) empty.remove();
  const mine = m.from === "visitor";
  const div = document.createElement("div");
  div.className = "message" + (mine ? " mine" : "");
  const imageHtml = typeof m.image === "string" ? (m.mediaType === "video" ? `<video class="chat-image" controls playsinline preload="metadata" src="${m.image}"></video>` : `<img class="chat-image" src="${m.image}" alt="Photo shared in chat" loading="lazy">`) : "";
  div.innerHTML = `<span class="message-meta">${esc(m.sender)} · ${time(m.timestamp)}</span>${imageHtml}${m.text ? `<div class="bubble">${esc(m.text)}</div>` : ""}`;
  $("messages").appendChild(div); $("messages").scrollTop = $("messages").scrollHeight;
}
function renderOwnerMessages() { return; }
function conversationKey(sessionId, profileId) { return String(sessionId || "") + "|" + profileId; }
function renderOwnerConversationOptions() {
  const select = $("owner-room"), selected = select.value;
  const list = Array.from(ownerConversations.values()).sort((x,y) => (y.timestamp || 0) - (x.timestamp || 0));
  select.innerHTML = '<option value="">Choose a visitor conversation…</option>' + list.map(c => {
    const key = conversationKey(c.sessionId,c.profileId);
    return '<option value="' + esc(key) + '">' + esc(c.sender || "Visitor") + ' — ' + esc((profileById(c.profileId) || {}).name || c.profileId) + '</option>';
  }).join("");
  if (list.some(c => conversationKey(c.sessionId,c.profileId) === selected)) select.value = selected;
}
function storeOwnerMessage(m) {
  notifyOwnerOfVisitorMessage(m);
  if (!m.sessionId) return;
  const key = conversationKey(m.sessionId,m.profileId), old = ownerConversations.get(key) || {};
  ownerConversations.set(key,{sessionId:m.sessionId,profileId:m.profileId,sender:m.from === "visitor" ? m.sender : (old.sender || "Visitor"),timestamp:m.timestamp});
  if (!ownerMessages.has(key)) ownerMessages.set(key,[]);
  const arr = ownerMessages.get(key);
  if (!arr.some(x => x.id === m.id)) arr.push(m);
  renderOwnerConversationOptions();
  if (ownerRoom === key) renderOwnerMessages();
}
socket.on("connect_error", err => {
  const message = err.message || "Connection failed.";
  $("entry-error").textContent = message;
  if (!$("owner-app").classList.contains("hidden")) {
    ownerConnected = false;
    ownerAuthPending = false;
    if (ownerAuthTimer) clearTimeout(ownerAuthTimer);
    $("owner-status").textContent = "Chat server connection failed: " + message;
  }
});
socket.on("profiles", list => { profiles = list; renderProfiles(); });
socket.on("profiles-updated", list => { profiles = list; renderProfiles(); renderOwnerProfiles(); });
socket.on("history", list => { $("messages").innerHTML = ""; list.forEach(addMessage); if (!list.length) $("messages").innerHTML = '<div class="empty-state"><div class="empty-symbol">✧</div><h3>Say hello.</h3><p>Your messages will appear here.</p></div>'; });
socket.on("joined-profile", p => {
  $("conversation-head").innerHTML = `<div class="avatar" style="background:${esc(p.color)};color:#2a2034">✦</div><div><h2>${esc(p.name)}, ${p.age}</h2><p>${esc(p.bio || "Ready to chat")}</p></div>`;
  $("message-input").disabled = false; $("visitor-image").disabled = false; $("visitor-view-once").disabled = false; document.querySelector("#message-form button[type=submit]").disabled = false;
});
socket.on("message", addMessage);
socket.on("chat-error", msg => alert(msg));
async function prepareImage(file) {
  if (!file) return "";
  if (file.type.startsWith("video/")) {
    if (!["video/mp4","video/webm","video/quicktime"].includes(file.type)) throw new Error("Use MP4, WebM, or QuickTime video.");
    if (file.size > 6 * 1024 * 1024) throw new Error("Choose a video smaller than 6 MB.");
    return await new Promise((resolve,reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("Could not read this video.")); reader.readAsDataURL(file); });
  }
  if (!file.type.startsWith("image/")) throw new Error("Choose a photo or supported video file.");
  if (file.size > 12 * 1024 * 1024) throw new Error("Choose an image smaller than 12 MB.");
  const source = await new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not read this image.")); };
    img.src = url;
  });
  const scale = Math.min(1, 1200 / source.width, 1200 / source.height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  canvas.getContext("2d").drawImage(source, 0, 0, canvas.width, canvas.height);
  const data = canvas.toDataURL("image/jpeg", 0.76);
  if (data.length > 900_000) throw new Error("Image is too large after compression. Choose a smaller image.");
  return data;
}
$("message-form").addEventListener("submit", async e => {
  e.preventDefault();
  const text = $("message-input").value.trim();
  const file = $("visitor-image").files[0];
  if ((!text && !file) || !activeProfile) return;
  const button = $("message-form").querySelector("button[type=submit]");
  button.disabled = true;
  try {
    const image = file ? await prepareImage(file) : "";
    socket.emit("send-message", {profileId:activeProfile,text,image,mediaType:file && file.type.startsWith("video/") ? "video" : "image",viewOnce:!!file && $("visitor-view-once").checked});
    $("message-input").value = "";
    $("visitor-image").value = "";
  } catch (err) { alert(err.message || "Could not send image."); }
  finally { button.disabled = !activeProfile; }
});
$("delete-chat").addEventListener("click", async () => {
  if (!activeProfile || !confirm("Permanently delete your messages with this persona? This cannot be undone.")) return;
  $("delete-chat").disabled = true;
  try {
    const r = await fetch("/api/chat/" + encodeURIComponent(activeProfile), {method:"DELETE",credentials:"same-origin"});
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "Could not delete chat.");
    $("messages").innerHTML = '<div class="empty-state"><div class="empty-symbol">✧</div><h3>Chat deleted.</h3><p>Your messages with this persona have been removed.</p></div>';
  } catch (err) { alert(err.message || "Could not delete chat."); }
  finally { $("delete-chat").disabled = !activeProfile; }
});
$("leave").addEventListener("click", async () => {
  if (!confirm("Leave this private session? Your in-memory session will be cleared.")) return;
  socket.disconnect();
  await fetch("/api/leave",{method:"POST"});
  activeProfile=null; $("message-input").disabled=true; show("entry");
});
function openHostControl() { show("owner-app"); }
if (new URLSearchParams(location.search).get("owner") === "1") show("owner-app");
$("back-to-chat").addEventListener("click", () => show("chat-app"));
function sendOwnerAuth() {
  if (!ownerAuthPending || !socket.connected) return;
  ownerAuthPending = false;
  socket.emit("owner-auth", {token:ownerToken});
  if (ownerAuthTimer) clearTimeout(ownerAuthTimer);
  ownerAuthTimer = setTimeout(() => {
    if (!ownerConnected) $("owner-status").textContent = "No response from the server. Refresh the page and check the Render logs.";
  }, 8000);
}
restoreVisitorSession();
