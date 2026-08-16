/**
 * ARJ SmartDine Assist — Guest Page Logic (Supabase Realtime + Polling Fallback)
 */

let isWifiConnected = true;
let currentTable = "Table 04";
let isSessionExpired = false;

const COOLDOWN_MS = 90000; // 90 seconds
const SESSION_LIMIT_MS = 90 * 60 * 1000; // 1 hr 30 mins

let cooldowns = {};

const SERVICE_META = {
  call_waiter:  { label: "Call Waiter",  icon: "🍽️" },
  water:        { label: "Water Refill", icon: "💧" },
  clear_table:  { label: "Clear Table",  icon: "🧹" },
  bill:         { label: "Request Bill", icon: "🧾" }
};

// --- LocalStorage Cooldown Persistence ---
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

// --- Session Management (1h 30m limit) ---
function initSession() {
  const sessionKey = `smart_dine_session_${currentTable}`;
  let sessionStart = localStorage.getItem(sessionKey);

  if (!sessionStart) {
    sessionStart = Date.now();
    localStorage.setItem(sessionKey, sessionStart);
  } else {
    sessionStart = parseInt(sessionStart, 10);
  }

  checkSessionStatus(sessionStart);
}

function checkSessionStatus(sessionStartOverride) {
  const sessionKey = `smart_dine_session_${currentTable}`;
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

// --- Check Completed Status ---
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

// --- Supabase Realtime & Polling Setup ---
function initSupabaseListener() {
  const client = window.sbClient;
  if (!client) return;

  // 1. Realtime subscription
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

  // 2. Periodic poll check for completed requests (every 3s)
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
        // If completed recently (within last 15s) and still in cooldown
        if (Date.now() - latest.created_at < 300000 && cooldowns[latest.service_key]) {
          handleCompletedRequest(latest.service, latest.service_key);
        }
      }
    } catch (e) {}
  }, 3000);
}

// --- Table Number from URL ---
function getTableFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const tableNum = params.get("table") || "4";
  const formatted = tableNum.length === 1 ? `0${tableNum}` : tableNum;
  currentTable = `Table ${formatted}`;
  document.getElementById("guest-table-number").textContent = currentTable;
}

// --- Predefined Service Request ---
async function requestService(serviceKey) {
  if (isSessionExpired) {
    document.getElementById("session-modal").classList.add("active");
    return;
  }

  if (!isWifiConnected) {
    document.getElementById("security-modal").classList.add("active");
    return;
  }

  if (cooldowns[serviceKey] && cooldowns[serviceKey] > Date.now()) return;

  const meta = SERVICE_META[serviceKey];
  if (!meta) return;

  // 90s cooldown on this service
  cooldowns[serviceKey] = Date.now() + COOLDOWN_MS;
  saveCooldowns();
  updateCardStates();
  startCooldownTimer(serviceKey);

  // Send to Supabase
  const client = window.sbClient;
  if (client) {
    const alertId = 'alert_' + Date.now();
    try {
      const { error } = await client.from('service_requests').insert([
        {
          id: alertId,
          table_name: currentTable,
          service: meta.label,
          service_key: serviceKey,
          icon: meta.icon,
          status: 'pending',
          created_at: Date.now()
        }
      ]);
      if (error) {
        console.error("Supabase insert error:", error);
      }
    } catch (err) {
      console.error("Network error on insert:", err);
    }
  }

  showSentStatus();
}

// --- Custom Request Submission ---
async function submitCustomRequest() {
  if (isSessionExpired) {
    document.getElementById("session-modal").classList.add("active");
    return;
  }

  if (!isWifiConnected) {
    document.getElementById("security-modal").classList.add("active");
    return;
  }

  const textarea = document.getElementById("custom-request-input");
  if (!textarea) return;

  const text = textarea.value.trim();
  if (!text) return;

  const customKey = 'custom_request';
  if (cooldowns[customKey] && cooldowns[customKey] > Date.now()) return;

  // 90s cooldown
  cooldowns[customKey] = Date.now() + COOLDOWN_MS;
  saveCooldowns();
  updateCardStates();
  startCooldownTimer(customKey);

  // Send to Supabase
  const client = window.sbClient;
  if (client) {
    const alertId = 'alert_' + Date.now();
    try {
      const { error } = await client.from('service_requests').insert([
        {
          id: alertId,
          table_name: currentTable,
          service: text,
          service_key: customKey,
          icon: "📝",
          status: 'pending',
          created_at: Date.now()
        }
      ]);
      if (error) {
        console.error("Supabase custom request error:", error);
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
  const isBlocked = !isWifiConnected || isSessionExpired;

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

  // 2. Custom request form elements
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

function closeSecurityModal() {
  document.getElementById("security-modal").classList.remove("active");
}

function closeSessionModal() {
  document.getElementById("session-modal").classList.remove("active");
}

// --- Init ---
document.addEventListener("DOMContentLoaded", () => {
  getTableFromUrl();
  initSupabaseListener();
  initSession();
  loadCooldowns();

  setInterval(() => {
    checkSessionStatus();
  }, 10000);
});
