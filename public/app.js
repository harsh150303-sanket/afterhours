const $ = id => document.getElementById(id);
const socket = io({ autoConnect: false });
let myName = "";
let profiles = [];
let activeProfile = null;
let ownerToken = "";
let ownerConnected = false;
let ownerRoom = "";
let ownerSessionId = "";
let ownerMessages = new Map();
let ownerConversations = new Map();
let ownerAuthPending = false;
let ownerAuthTimer = null;
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
  const roomSelect = $("owner-room");
  const selected = roomSelect.value;
  roomSelect.innerHTML = '<option value="">Choose a persona…</option>' + profiles.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("");
  roomSelect.value = selected;
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
  const imageHtml = typeof m.image === "string" && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(m.image) ? `<img class="chat-image" src="${m.image}" alt="Image shared in chat" loading="lazy">` : "";
  div.innerHTML = `<span class="message-meta">${esc(m.sender)} · ${time(m.timestamp)}</span>${imageHtml}${m.text ? `<div class="bubble">${esc(m.text)}</div>` : ""}`;
  $("messages").appendChild(div); $("messages").scrollTop = $("messages").scrollHeight;
}
function renderOwnerMessages() {
  const arr = ownerMessages.get(ownerRoom) || [];
  $("owner-messages").innerHTML = arr.length ? arr.map(m => {
    const imageHtml = typeof m.image === "string" && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(m.image) ? `<img class="chat-image" src="${m.image}" alt="Image shared in chat" loading="lazy">` : "";
    return `<div class="owner-message"><strong>${esc(m.sender)} · ${time(m.timestamp)}</strong>${imageHtml}${m.text ? `<div>${esc(m.text)}</div>` : ""}</div>`;
  }).join("") : '<p class="muted">No messages in this conversation yet.</p>';
  $("owner-messages").scrollTop = $("owner-messages").scrollHeight;
}
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
  $("message-input").disabled = false; $("visitor-image").disabled = false; document.querySelector("#message-form button[type=submit]").disabled = false;
});
socket.on("message", addMessage);
socket.on("chat-error", msg => alert(msg));
async function prepareImage(file) {
  if (!file) return "";
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file.");
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
    socket.emit("send-message", {profileId:activeProfile,text,image});
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
$("open-host-control").addEventListener("click", openHostControl);
document.querySelector(".footer a").addEventListener("click", e => {
  e.preventDefault(); openHostControl();
});
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
$("owner-connect").addEventListener("click", () => {
  ownerToken = $("owner-token").value;
  if (!ownerToken) { $("owner-status").textContent = "Enter the owner token."; return; }
  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission().catch(() => {});
  }
  ownerConnected = false;
  ownerAuthPending = true;
  $("owner-status").textContent = "Connecting to server…";
  if (!socket.connected) {
    socket.connect();
    if (ownerAuthTimer) clearTimeout(ownerAuthTimer);
    ownerAuthTimer = setTimeout(() => {
      if (ownerAuthPending) {
        ownerAuthPending = false;
        $("owner-status").textContent = "Chat server is not connected. Refresh and try again.";
      }
    }, 8000);
  } else {
    sendOwnerAuth();
  }
});
socket.on("connect", sendOwnerAuth);
socket.on("disconnect", () => {
  if (ownerConnected) $("owner-status").textContent = "Disconnected. Reconnect to receive chat notifications.";
  ownerConnected = false;
});
socket.on("owner-auth-result", result => {
  if (ownerAuthTimer) clearTimeout(ownerAuthTimer);
  ownerConnected = result.ok;
  $("owner-status").textContent = result.ok
    ? ("Owner console connected." + (("Notification" in window && Notification.permission === "granted") ? " Chat notifications are enabled." : " Allow browser notifications to receive alerts."))
    : "Owner token was rejected. Check OWNER_TOKEN in Render.";
  if (result.ok) { profiles = result.profiles; renderOwnerProfiles(); renderProfiles(); ownerConversations.clear(); ownerMessages.clear(); $("owner-room").innerHTML = '<option value="">Waiting for visitor messages…</option>'; }
});
$("owner-room").addEventListener("change", () => {
  ownerRoom = $("owner-room").value;
  const cv = ownerConversations.get(ownerRoom), p = cv ? profileById(cv.profileId) : null;
  ownerSessionId = cv ? cv.sessionId : "";
  const enabled = !!(ownerConnected && p && ownerSessionId);
  $("owner-reply-input").disabled = !enabled;
  $("owner-image").disabled = !enabled;
  $("owner-reply-form").querySelector("button").disabled = !enabled;
  if (enabled) {
    socket.emit("owner-join-profile", {profileId:cv.profileId,sessionId:ownerSessionId,token:ownerToken});
    renderOwnerMessages();
  } else $("owner-messages").innerHTML = '<p class="muted">Choose a visitor conversation.</p>';
});
socket.on("owner-history", ({profileId,sessionId,messages}) => {
  const key = conversationKey(sessionId,profileId);
  ownerMessages.set(key,messages || []);
  if (messages && messages.length) {
    const v = [...messages].reverse().find(m => m.from === "visitor");
    ownerConversations.set(key,{sessionId,profileId,sender:v ? v.sender : "Visitor",timestamp:messages[messages.length-1].timestamp});
    renderOwnerConversationOptions();
  }
  if(ownerRoom===key) renderOwnerMessages();
});
socket.on("owner-inbox", storeOwnerMessage);
$("owner-reply-form").addEventListener("submit", async e => {
  e.preventDefault();
  const text = $("owner-reply-input").value.trim();
  const file = $("owner-image").files[0];
  if ((!text && !file) || !ownerRoom || !ownerConnected) return;
  const button = $("owner-reply-form").querySelector("button[type=submit]");
  button.disabled = true;
  try {
    const image = file ? await prepareImage(file) : "";
    socket.emit("owner-reply", {profileId:ownerConversations.get(ownerRoom)?.profileId,sessionId:ownerSessionId,text,image,token:ownerToken});
    $("owner-reply-input").value = "";
    $("owner-image").value = "";
  } catch (err) { alert(err.message || "Could not send image."); }
  finally { button.disabled = !ownerConnected || !ownerRoom || !ownerSessionId; }
});
$("persona-form").addEventListener("submit", async e => {
  e.preventDefault();
  if (!ownerConnected) return $("owner-status").textContent = "Connect the owner console first.";
  const body = {id:$("persona-id").value.trim().toLowerCase(),name:$("persona-name").value.trim(),age:Number($("persona-age").value),bio:$("persona-bio").value.trim(),color:$("persona-color").value};
  const r = await fetch("/api/owner/profiles",{method:"POST",headers:{"Content-Type":"application/json","x-owner-token":ownerToken},body:JSON.stringify(body)});
  const d = await r.json(); if(!r.ok) return $("owner-status").textContent = d.error || "Could not save persona.";
  profiles = d.profiles; renderProfiles(); renderOwnerProfiles(); $("persona-form").reset(); $("persona-age").value=28; $("persona-color").value="#d9b8ff";
});


restoreVisitorSession();


restoreVisitorSession();
