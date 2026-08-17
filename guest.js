/**
 * ARJ SmartDine Assist — Guest Page Logic
 * Server-enforced: Token validation, 60s rate limiting, 90-minute sessions
 * Client-side: Cooldown UI, session countdown display, status cards
 */

let currentTable = "Table 04";
let currentTableNumber = 4;
let currentToken = null;
let isSessionExpired = false;
let isTokenValid = false;

const COOLDOWN_MS = 90000; // 90 seconds (client-side UI cooldown)
const SESSION_LIMIT_MS = 90 * 60 * 1000; // 1 hr 30 mins

let cooldowns = {};

const SERVICE_META = {
  call_waiter:  { label: "Call Waiter",  icon: "🍽️" },
  water:        { label: "Water Refill", icon: "💧" },
  clear_table:  { label: "Clear Table",  icon: "🧹" },
  bill:         { label: "Request Bill", icon: "🧾" }
};

// --- LocalStorage Cooldown Persistence (UI only — server enforces the real limit) ---
function saveCooldowns() {
  localStorage.setItem(`smart_dine_cooldowns_${currentTable}`, JSON.stringify(cooldowns));
}

function loadCooldowns() {
  try {
    const saved = localStorage.getItem(`smart_dine_cooldowns_${currentTable}`);
    if (saved) {
      const parsed = JSON.parse(saved);
      const now = Date.now();
      let hasActiveCooldown = false;

      Object.keys(parsed).forEach(key => {
        if (parsed[key] && parsed[key] > now) {
          cooldowns[key] = parsed[key];
          startCooldownTimer(key);
          hasActiveCooldown = true;
        }
      });

      if (hasActiveCooldown) {
        showSentStatus();
      }
    }
  } catch (e) {
    console.error("Error loading cooldowns:", e);
  }
}

// --- SAFEGUARD 1: Token Validation on Page Load ---
async function validateToken() {
  const params = new URLSearchParams(window.location.search);
  currentToken = params.get("token");
  const tableParam = params.get("table") || "4";
  currentTableNumber = parseInt(tableParam, 10);
  const formatted = tableParam.length === 1 ? `0${tableParam}` : tableParam;
  currentTable = `Table ${formatted}`;
  document.getElementById("guest-table-number").textContent = currentTable;

  // If no token provided, block the page
  if (!currentToken) {
    blockPageWithTokenError();
    return false;
  }

  // Validate token against the database
  const client = window.sbClient;
  if (!client) {
    console.error("Supabase client not ready");
    return false;
  }

  try {
    const { data, error } = await client
      .from('tables')
      .select('table_number, table_name, secret_token')
      .eq('table_number', currentTableNumber)
      .eq('secret_token', currentToken)
      .eq('is_active', true)
      .single();

    if (error || !data) {
      blockPageWithTokenError();
      return false;
    }

    // Token is valid
    isTokenValid = true;
    console.log("Token validated for", data.table_name);
    return true;
  } catch (err) {
    console.error("Token validation error:", err);
    blockPageWithTokenError();
    return false;
  }
}

function blockPageWithTokenError() {
  isTokenValid = false;
  document.getElementById("token-modal").classList.add("active");
}

// --- SAFEGUARD 3: Session Management (display timer, server enforces) ---
function initSession() {
  const sessionKey = `smart_dine_session_${currentTable}_${currentToken}`;
  let sessionStart = localStorage.getItem(sessionKey);

  if (sessionStart) {
    sessionStart = parseInt(sessionStart, 10);
    // If the session is older than 90 minutes, start a new one on fresh reload!
    if (Date.now() - sessionStart > SESSION_LIMIT_MS) {
      sessionStart = null;
      localStorage.removeItem(sessionKey);
    }
  }

  if (!sessionStart) {
    sessionStart = Date.now();
    localStorage.setItem(sessionKey, sessionStart);
  }

  checkSessionStatus(sessionStart);
}

function updateSessionFromServer(remainingMs) {
  // Server told us how much session time is left — update local display
  if (remainingMs !== undefined && remainingMs !== null) {
    const sessionKey = `smart_dine_session_${currentTable}_${currentToken}`;
    const serverSessionStart = Date.now() - (SESSION_LIMIT_MS - remainingMs);
    localStorage.setItem(sessionKey, serverSessionStart);
    checkSessionStatus(serverSessionStart);
  }
}

function checkSessionStatus(sessionStartOverride) {
  const sessionKey = `smart_dine_session_${currentTable}_${currentToken}`;
  let sessionStart = sessionStartOverride || parseInt(localStorage.getItem(sessionKey) || Date.now(), 10);

  const elapsed = Date.now() - sessionStart;
  const remainingMs = SESSION_LIMIT_MS - elapsed;

  const sessionBadge = document.getElementById("session-badge");
  const sessionText = document.getElementById("session-time-text");
  const sessionWarning = document.getElementById("session-warning");

  if (remainingMs <= 0) {
    isSessionExpired = true;
    if (sessionBadge) sessionBadge.style.display = "none";
    if (sessionWarning) sessionWarning.style.display = "flex";
  } else {
    isSessionExpired = false;
    if (sessionWarning) sessionWarning.style.display = "none";
    if (sessionBadge && sessionText) {
      sessionBadge.style.display = "flex";
      const totalSec = Math.floor(remainingMs / 1000);
      const hours = Math.floor(totalSec / 3600);
      const mins = Math.floor((totalSec % 3600) / 60);

      if (hours > 0) {
        sessionText.textContent = `Session: ${hours}h ${mins}m remaining`;
      } else {
        sessionText.textContent = `Session: ${mins}m remaining`;
      }
    }
  }

  updateCardStates();
}

// --- Handle server response errors ---
function handleServerError(result) {
  if (!result || result.success) return false;

  if (result.error === 'INVALID_TOKEN') {
    blockPageWithTokenError();
    return true;
  }
  if (result.error === 'SESSION_EXPIRED') {
    isSessionExpired = true;
    document.getElementById("session-modal").classList.add("active");
    updateCardStates();
    return true;
  }
  if (result.error === 'RATE_LIMITED') {
    document.getElementById("rate-modal").classList.add("active");
    if (result.session_remaining_ms) {
      updateSessionFromServer(result.session_remaining_ms);
    }
    return true;
  }

  return false;
}

// --- Completed request handler ---
function handleCompletedRequest(serviceName, serviceKey) {
  showCompletedStatus(serviceName);
  setTimeout(() => {
    if (serviceKey) {
      delete cooldowns[serviceKey];
      saveCooldowns();
      if (serviceKey === 'custom_request') {
        const textarea = document.getElementById("custom-request-input");
        if (textarea) textarea.value = "";
      }
    }
    updateCardStates();
    hideStatusCard();
  }, 4000);
}

// --- Supabase Realtime Listener ---
function initSupabaseListener() {
  const client = window.sbClient;
  if (!client) return;

  // 1. Realtime subscription for completed requests
  try {
    client
      .channel(`guest_channel_${currentTable}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'service_requests' },
        (payload) => {
          const updated = payload.new;
          if (updated && updated.table_name === currentTable && updated.status === 'completed') {
            handleCompletedRequest(updated.service, updated.service_key);
          }
        }
      )
      .subscribe();
  } catch (e) {
    console.warn("Realtime listener error:", e);
  }

  // 2. Polling fallback for completed requests (every 3s)
  setInterval(async () => {
    if (Object.keys(cooldowns).length === 0) return;
    try {
      const { data } = await client
        .from('service_requests')
        .select('*')
        .eq('table_name', currentTable)
        .eq('status', 'completed')
        .order('created_at', { ascending: false })
        .limit(1);

      if (data && data.length > 0) {
        const latest = data[0];
        if (Date.now() - latest.created_at < 300000 && cooldowns[latest.service_key]) {
          handleCompletedRequest(latest.service, latest.service_key);
        }
      }
    } catch (e) {}
  }, 3000);
}

// --- SECURE Service Request (via RPC) ---
async function requestService(serviceKey) {
  if (!isTokenValid) {
    blockPageWithTokenError();
    return;
  }

  if (isSessionExpired) {
    document.getElementById("session-modal").classList.add("active");
    return;
  }

  if (cooldowns[serviceKey] && cooldowns[serviceKey] > Date.now()) return;

  const meta = SERVICE_META[serviceKey];
  if (!meta) return;

  // Optimistic UI: apply cooldown immediately
  cooldowns[serviceKey] = Date.now() + COOLDOWN_MS;
  saveCooldowns();
  updateCardStates();
  startCooldownTimer(serviceKey);

  // Call secure RPC function (server validates token, session, rate limit)
  const client = window.sbClient;
  if (client) {
    try {
      const { data, error } = await client.rpc('create_service_request', {
        p_token: currentToken,
        p_table_number: currentTableNumber,
        p_service: meta.label,
        p_service_key: serviceKey,
        p_icon: meta.icon
      });

      if (error) {
        console.error("RPC error:", error);
        // Revert cooldown on error
        delete cooldowns[serviceKey];
        saveCooldowns();
        updateCardStates();
        return;
      }

      if (data && !data.success) {
        // Server rejected — revert cooldown and show appropriate modal
        delete cooldowns[serviceKey];
        saveCooldowns();
        updateCardStates();
        handleServerError(data);
        return;
      }

      // Success — update session timer from server response
      if (data && data.session_remaining_ms) {
        updateSessionFromServer(data.session_remaining_ms);
      }
    } catch (err) {
      console.error("Network error on service request:", err);
    }
  }

  showSentStatus();
}

// --- SECURE Custom Request (via RPC) ---
async function submitCustomRequest() {
  if (!isTokenValid) {
    blockPageWithTokenError();
    return;
  }

  if (isSessionExpired) {
    document.getElementById("session-modal").classList.add("active");
    return;
  }

  const textarea = document.getElementById("custom-request-input");
  if (!textarea) return;

  const text = textarea.value.trim();
  if (!text) return;

  const customKey = 'custom_request';
  if (cooldowns[customKey] && cooldowns[customKey] > Date.now()) return;

  // Optimistic cooldown
  cooldowns[customKey] = Date.now() + COOLDOWN_MS;
  saveCooldowns();
  updateCardStates();
  startCooldownTimer(customKey);

  const client = window.sbClient;
  if (client) {
    try {
      const { data, error } = await client.rpc('create_service_request', {
        p_token: currentToken,
        p_table_number: currentTableNumber,
        p_service: text,
        p_service_key: customKey,
        p_icon: "📝"
      });

      if (error) {
        console.error("RPC error:", error);
        delete cooldowns[customKey];
        saveCooldowns();
        updateCardStates();
        return;
      }

      if (data && !data.success) {
        delete cooldowns[customKey];
        saveCooldowns();
        updateCardStates();
        handleServerError(data);
        return;
      }

      if (data && data.session_remaining_ms) {
        updateSessionFromServer(data.session_remaining_ms);
      }
    } catch (err) {
      console.error("Network error on custom request:", err);
    }
  }

  showSentStatus();
}

function startCooldownTimer(serviceKey) {
  const interval = setInterval(() => {
    if (!cooldowns[serviceKey] || cooldowns[serviceKey] <= Date.now()) {
      clearInterval(interval);
      delete cooldowns[serviceKey];
      saveCooldowns();
      if (serviceKey === 'custom_request') {
        const textarea = document.getElementById("custom-request-input");
        if (textarea) textarea.value = "";
      }
      updateCardStates();
    }
  }, 1000);
}

// --- Card & Form States ---
function updateCardStates() {
  const isBlocked = isSessionExpired || !isTokenValid;

  // 1. Predefined cards
  document.querySelectorAll('.svc-card').forEach(card => {
    const key = card.getAttribute('data-svc');
    const isCooling = cooldowns[key] && cooldowns[key] > Date.now();

    if (isBlocked) {
      card.classList.add('disabled');
      if (!isCooling) card.classList.remove('sent');
    } else if (isCooling) {
      card.classList.add('sent');
      card.classList.remove('disabled');
    } else {
      card.classList.remove('disabled', 'sent');
    }
  });

  // 2. Custom request form
  const customTextarea = document.getElementById("custom-request-input");
  const customBtn = document.getElementById("btn-send-custom");
  const customKey = 'custom_request';
  const isCustomCooling = cooldowns[customKey] && cooldowns[customKey] > Date.now();

  if (customTextarea && customBtn) {
    if (isBlocked || isCustomCooling) {
      customTextarea.disabled = true;
      customBtn.disabled = true;
      customBtn.classList.add('disabled');
      if (isCustomCooling) {
        customBtn.textContent = "✓ Request Sent";
      } else if (isSessionExpired) {
        customBtn.textContent = "Session Expired";
      } else {
        customBtn.textContent = "Send Request";
      }
    } else {
      customTextarea.disabled = false;
      customBtn.disabled = false;
      customBtn.classList.remove('disabled');
      customBtn.textContent = "Send Request";
    }
  }
}

// --- Status Card ---
function showSentStatus() {
  const card = document.getElementById("status-card");
  card.classList.add('visible');
  card.className = "status-card success visible";
  document.querySelector(".status-check").textContent = "✓";
  document.getElementById("status-title").textContent = "Request Sent";
  document.getElementById("status-msg").textContent = "Our team has received your request.";
  document.getElementById("status-eta").textContent = "Estimated response time: 2–3 minutes";
}

function showCompletedStatus() {
  const card = document.getElementById("status-card");
  card.classList.add('visible');
  card.className = "status-card success visible";
  document.querySelector(".status-check").textContent = "✓";
  document.getElementById("status-title").textContent = "Completed";
  document.getElementById("status-msg").textContent = "A team member is on the way.";
  document.getElementById("status-eta").textContent = "";
}

function hideStatusCard() {
  document.getElementById("status-card").classList.remove('visible');
}

function closeSessionModal() {
  document.getElementById("session-modal").classList.remove("active");
}

function closeRateModal() {
  document.getElementById("rate-modal").classList.remove("active");
}

// --- Init ---
document.addEventListener("DOMContentLoaded", async () => {
  const tokenOk = await validateToken();

  if (tokenOk) {
    initSupabaseListener();
    initSession();
    loadCooldowns();
  }

  // Periodically check session status (every 10s)
  setInterval(() => {
    if (isTokenValid) checkSessionStatus();
  }, 10000);
});
