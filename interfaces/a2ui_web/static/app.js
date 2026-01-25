const SESSION_KEY = "seichijunrei:a2ui_session_id";
const CONVERSATION_KEY = "seichijunrei:conversation_history";
const MAX_HISTORY_LENGTH = 50;

function getSessionId() {
  const existing = localStorage.getItem(SESSION_KEY);
  if (existing) return existing;
  const created = `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  localStorage.setItem(SESSION_KEY, created);
  return created;
}

function setSessionPill(sessionId) {
  const el = document.getElementById("session-pill");
  el.textContent = `session: ${sessionId}`;
}

function setBusy(isBusy, stage = "processing") {
  const pill = document.getElementById("busy-pill");
  const input = document.getElementById("chat-input");
  const send = document.getElementById("chat-send");

  if (pill) {
    pill.hidden = !isBusy;
    // Update busy pill text based on stage
    const stageMessages = {
      searching: "Searching...",
      fetching_points: "Fetching locations...",
      planning_route: "Planning route...",
      processing: "Processing...",
    };
    pill.textContent = stageMessages[stage] || stageMessages.processing;
  }
  if (input) input.disabled = isBusy;
  if (send) send.disabled = isBusy;

  document.body.classList.toggle("is-busy", isBusy);
}

function appendChat(role, text) {
  const log = document.getElementById("chat-log");
  const msg = document.createElement("div");
  msg.className = `chat-msg chat-msg--${role}`;
  msg.innerHTML = `
    <div class="chat-msg__role">${role}</div>
    <div class="chat-msg__text"></div>
    <div class="chat-msg__time">${new Date().toLocaleTimeString()}</div>
  `;
  msg.querySelector(".chat-msg__text").textContent = text;
  log.appendChild(msg);
  log.scrollTop = log.scrollHeight;

  // Save to conversation history
  saveToHistory(role, text);
}

function saveToHistory(role, text) {
  try {
    const history = JSON.parse(localStorage.getItem(CONVERSATION_KEY) || "[]");
    history.push({
      role,
      text,
      timestamp: Date.now(),
      sessionId: getSessionId(),
    });
    // Keep only recent messages
    while (history.length > MAX_HISTORY_LENGTH) {
      history.shift();
    }
    localStorage.setItem(CONVERSATION_KEY, JSON.stringify(history));
  } catch (e) {
    console.warn("Failed to save conversation history:", e);
  }
}

function loadConversationHistory() {
  try {
    const history = JSON.parse(localStorage.getItem(CONVERSATION_KEY) || "[]");
    const currentSession = getSessionId();
    // Only load history from current session
    return history.filter((msg) => msg.sessionId === currentSession);
  } catch (e) {
    console.warn("Failed to load conversation history:", e);
    return [];
  }
}

function clearConversationHistory() {
  localStorage.removeItem(CONVERSATION_KEY);
  const log = document.getElementById("chat-log");
  log.innerHTML = "";
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text}`);
  }
  return await res.json();
}

class A2UIRenderer {
  constructor(container, { onAction }) {
    this.container = container;
    this.onAction = onAction;
    this.surfaces = new Map();
  }

  applyMessages(messages) {
    for (const msg of messages) this.applyMessage(msg);
  }

  applyMessage(msg) {
    if (msg.surfaceUpdate) {
      const { surfaceId, components } = msg.surfaceUpdate;
      const surface = this._getSurface(surfaceId);
      for (const c of components) surface.components.set(c.id, c.component);
      return;
    }

    if (msg.beginRendering) {
      const { surfaceId, root } = msg.beginRendering;
      const surface = this._getSurface(surfaceId);
      surface.root = root;
      this.render(surfaceId);
      return;
    }

    if (msg.deleteSurface) {
      const { surfaceId } = msg.deleteSurface;
      this.surfaces.delete(surfaceId);
      this.container.innerHTML = "";
      return;
    }

    // dataModelUpdate not used in this MVP renderer.
  }

  render(surfaceId) {
    const surface = this.surfaces.get(surfaceId);
    if (!surface || !surface.root) return;
    this.container.innerHTML = "";
    const el = this._renderComponent(surface, surface.root);
    this.container.appendChild(el);
  }

  _getSurface(surfaceId) {
    if (!this.surfaces.has(surfaceId)) {
      this.surfaces.set(surfaceId, { id: surfaceId, root: null, components: new Map() });
    }
    return this.surfaces.get(surfaceId);
  }

  _renderComponent(surface, componentId) {
    const wrapper = surface.components.get(componentId);
    if (!wrapper) {
      const missing = document.createElement("div");
      missing.className = "a2ui-card";
      missing.textContent = `Missing component: ${componentId}`;
      return missing;
    }

    const [type] = Object.keys(wrapper);
    const props = wrapper[type] || {};

    switch (type) {
      case "Column":
        return this._renderColumn(surface, props);
      case "Row":
        return this._renderRow(surface, props);
      case "Text":
        return this._renderText(props);
      case "Divider":
        return this._renderDivider();
      case "Card":
        return this._renderCard(surface, props);
      case "Button":
        return this._renderButton(surface, props);
      case "Image":
        return this._renderImage(props);
      default: {
        const unknown = document.createElement("div");
        unknown.className = "a2ui-card";
        unknown.textContent = `Unsupported component type: ${type}`;
        return unknown;
      }
    }
  }

  _childrenList(children) {
    if (!children || !children.explicitList) return [];
    return children.explicitList;
  }

  _renderColumn(surface, props) {
    const el = document.createElement("div");
    el.className = "a2ui-column";
    for (const id of this._childrenList(props.children)) {
      el.appendChild(this._renderComponent(surface, id));
    }
    return el;
  }

  _renderRow(surface, props) {
    const el = document.createElement("div");
    el.className = "a2ui-row";
    for (const id of this._childrenList(props.children)) {
      el.appendChild(this._renderComponent(surface, id));
    }
    return el;
  }

  _valueToString(v) {
    if (!v) return "";
    if (typeof v.literalString === "string") return v.literalString;
    return "";
  }

  _renderText(props) {
    const usage = props.usageHint || "body";
    const text = this._valueToString(props.text);
    let el;
    if (usage === "h2") el = document.createElement("h2");
    else if (usage === "h3") el = document.createElement("h3");
    else if (usage === "h4") el = document.createElement("h4");
    else el = document.createElement("div");

    if (usage === "caption") el.className = "a2ui-caption";
    else if (usage === "body") el.className = "a2ui-body";
    else el.className = `a2ui-${usage}`;

    el.textContent = text;
    return el;
  }

  _renderDivider() {
    const el = document.createElement("hr");
    el.className = "a2ui-divider";
    return el;
  }

  _renderCard(surface, props) {
    const el = document.createElement("div");
    el.className = "a2ui-card";
    if (props.child) el.appendChild(this._renderComponent(surface, props.child));
    return el;
  }

  _renderButton(surface, props) {
    const el = document.createElement("button");
    el.className = "a2ui-button";
    if (props.primary) el.classList.add("a2ui-button--primary");

    if (props.child) el.appendChild(this._renderComponent(surface, props.child));

    const action = props.action;
    if (action && action.name) {
      el.addEventListener("click", () => this.onAction(action));
    }

    return el;
  }

  _renderImage(props) {
    const el = document.createElement("img");
    el.className = "a2ui-image";
    el.loading = "lazy";
    el.src = this._valueToString(props.url);
    return el;
  }
}

const sessionId = getSessionId();
setSessionPill(sessionId);

const renderer = new A2UIRenderer(document.getElementById("a2ui-surface"), {
  onAction: async (action) => {
    if (action && typeof action.name === "string" && action.name.startsWith("open_url:")) {
      const url = action.name.slice("open_url:".length);
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }

    // Determine processing stage from action
    let stage = "processing";
    if (action.name && action.name.startsWith("select_candidate_")) {
      stage = "fetching_points";
    } else if (action.name === "reset") {
      stage = "processing";
    }

    try {
      setBusy(true, stage);
      const result = await postJson("/api/action", {
        session_id: sessionId,
        action_name: action.name,
      });
      if (result.assistant_text) appendChat("assistant", result.assistant_text);
      renderer.applyMessages(result.a2ui_messages || []);
    } catch (err) {
      appendChat("assistant", `Action error: ${err.message}`);
    } finally {
      setBusy(false);
    }
  },
});

async function bootstrap() {
  try {
    setBusy(true, "processing");

    // Restore conversation history from localStorage
    const history = loadConversationHistory();
    const log = document.getElementById("chat-log");
    for (const msg of history) {
      const msgEl = document.createElement("div");
      msgEl.className = `chat-msg chat-msg--${msg.role}`;
      msgEl.innerHTML = `
        <div class="chat-msg__role">${msg.role}</div>
        <div class="chat-msg__text"></div>
        <div class="chat-msg__time">${new Date(msg.timestamp).toLocaleTimeString()}</div>
      `;
      msgEl.querySelector(".chat-msg__text").textContent = msg.text;
      log.appendChild(msgEl);
    }
    if (history.length > 0) {
      log.scrollTop = log.scrollHeight;
    }

    const result = await postJson("/api/chat", {
      session_id: sessionId,
      message: "/status",
    });
    if (result.assistant_text) appendChat("assistant", result.assistant_text);
    renderer.applyMessages(result.a2ui_messages || []);
  } catch (err) {
    appendChat("assistant", `Init error: ${err.message}`);
  } finally {
    setBusy(false);
  }
}

bootstrap();

document.getElementById("chat-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = document.getElementById("chat-input");
  const text = input.value.trim();
  if (!text) return;

  appendChat("user", text);
  input.value = "";

  // Determine processing stage from message content
  let stage = "processing";
  if (text.toLowerCase().includes("search") || text.match(/^[a-zA-Z\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf]/)) {
    stage = "searching";
  }

  try {
    setBusy(true, stage);
    const result = await postJson("/api/chat", { session_id: sessionId, message: text });
    if (result.assistant_text) appendChat("assistant", result.assistant_text);
    renderer.applyMessages(result.a2ui_messages || []);
  } catch (err) {
    appendChat("assistant", `Error: ${err.message}`);
  } finally {
    setBusy(false);
  }
});
