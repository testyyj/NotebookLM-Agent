/**
 * Popup controller — wires UI to background service worker.
 */

// ── Util: send message to background ──
function send(action, payload = {}) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ action, payload }, resp => {
            if (chrome.runtime.lastError) {
                return reject(new Error(chrome.runtime.lastError.message));
            }
            if (!resp) return reject(new Error("No response from background"));
            if (resp.ok) resolve(resp.data);
            else reject(new Error(resp.error));
        });
    });
}

// ── State ──
let activeNotebookId = null;

// ── DOM cache ──
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const nbSelect = $("#active-notebook");
const authError = $("#auth-error");
const nbList = $("#notebook-list");
const srcList = $("#source-list");
const chatArea = $("#chat-messages");
const chatInput = $("#chat-input");
const artifactList = $("#artifact-list");
const genStatus = $("#gen-status");
const genStatusTxt = $("#gen-status-text");
const toastEl = $("#toast");

// ═══════════════════════════════════════
// Tab switching
// ═══════════════════════════════════════
$$(".tab").forEach(tab => {
    tab.addEventListener("click", () => {
        $$(".tab").forEach(t => t.classList.remove("active"));
        $$(".panel").forEach(p => p.classList.remove("active"));
        tab.classList.add("active");
        $(`#panel-${tab.dataset.tab}`).classList.add("active");

        // Lazy-load panel content when switching tabs
        const tabName = tab.dataset.tab;
        if (tabName === "sources" && activeNotebookId) loadSources();
        if (tabName === "artifacts" && activeNotebookId) loadArtifacts();
    });
});

// ═══════════════════════════════════════
// Toast
// ═══════════════════════════════════════
function toast(msg, type = "") {
    toastEl.textContent = msg;
    toastEl.className = `toast show ${type ? "toast-" + type : ""}`;
    toastEl.style.display = "block";
    clearTimeout(toastEl._timer);
    toastEl._timer = setTimeout(() => {
        toastEl.classList.remove("show");
        setTimeout(() => (toastEl.style.display = "none"), 300);
    }, 2500);
}

// ═══════════════════════════════════════
// Notebook operations
// ═══════════════════════════════════════
async function loadNotebooks() {
    try {
        const notebooks = await send("listNotebooks");
        authError.style.display = "none";

        // Populate dropdown
        nbSelect.innerHTML = '<option value="">— 选择笔记本 —</option>';
        notebooks.forEach(nb => {
            const opt = document.createElement("option");
            opt.value = nb.id;
            opt.textContent = nb.title;
            nbSelect.appendChild(opt);
        });

        // Restore saved selection
        const saved = await chrome.storage.local.get("activeNotebookId");
        if (saved.activeNotebookId) {
            nbSelect.value = saved.activeNotebookId;
            activeNotebookId = saved.activeNotebookId;
        }

        // Render notebook cards
        renderNotebooks(notebooks);
    } catch (err) {
        authError.style.display = "block";
        nbList.innerHTML = `<div class="empty-state">❌ ${err.message}</div>`;
    }
}

function renderNotebooks(notebooks) {
    if (!notebooks.length) {
        nbList.innerHTML = '<div class="empty-state">暂无笔记本</div>';
        return;
    }
    nbList.innerHTML = notebooks
        .map(nb => `
      <div class="card ${nb.id === activeNotebookId ? "active-card" : ""}" data-id="${nb.id}">
        <div class="card-body">
          <div class="card-title">${escHtml(nb.title)}</div>
          <div class="card-subtitle">${nb.sourceCount} 数据源</div>
        </div>
        <div class="card-actions">
          <button class="btn btn-ghost btn-sm btn-use" title="使用此笔记本">📌</button>
          <button class="btn btn-danger btn-sm btn-del-nb" title="删除">🗑️</button>
        </div>
      </div>`)
        .join("");

    // Wire up card buttons
    nbList.querySelectorAll(".btn-use").forEach(btn => {
        btn.addEventListener("click", async (e) => {
            e.stopPropagation();
            const id = btn.closest(".card").dataset.id;
            await selectNotebook(id);
        });
    });

    nbList.querySelectorAll(".btn-del-nb").forEach(btn => {
        btn.addEventListener("click", async (e) => {
            e.stopPropagation();
            const card = btn.closest(".card");
            const id = card.dataset.id;
            if (!confirm("确定删除此笔记本？")) return;
            try {
                await send("deleteNotebook", { notebookId: id });
                toast("已删除", "success");
                loadNotebooks();
            } catch (err) {
                toast(err.message, "error");
            }
        });
    });

    // Click card to select
    nbList.querySelectorAll(".card").forEach(card => {
        card.addEventListener("click", () => selectNotebook(card.dataset.id));
    });
}

async function selectNotebook(id) {
    activeNotebookId = id;
    nbSelect.value = id;
    await chrome.storage.local.set({ activeNotebookId: id });
    // Refresh cards to show active state
    nbList.querySelectorAll(".card").forEach(c => {
        c.classList.toggle("active-card", c.dataset.id === id);
    });
    toast("已切换笔记本", "success");
}

// Create notebook
$("#btn-create-nb").addEventListener("click", async () => {
    const title = $("#new-nb-title").value.trim();
    if (!title) return;
    try {
        await send("createNotebook", { title });
        $("#new-nb-title").value = "";
        toast("已创建", "success");
        loadNotebooks();
    } catch (err) {
        toast(err.message, "error");
    }
});

// Notebook dropdown change
nbSelect.addEventListener("change", () => {
    selectNotebook(nbSelect.value);
});

// ═══════════════════════════════════════
// Sources
// ═══════════════════════════════════════
async function loadSources() {
    if (!activeNotebookId) {
        srcList.innerHTML = '<div class="empty-state">请先选择一个笔记本</div>';
        return;
    }
    srcList.innerHTML = '<div class="loading-placeholder">加载中</div>';
    try {
        const sources = await send("listSources", { notebookId: activeNotebookId });
        if (!sources.length) {
            srcList.innerHTML = '<div class="empty-state">暂无数据源</div>';
            return;
        }
        srcList.innerHTML = sources.map(s => `
      <div class="card" data-id="${s.id}">
        <div class="card-body">
          <div class="card-title">${escHtml(s.title)}</div>
        </div>
        <div class="card-actions">
          <button class="btn btn-danger btn-sm btn-del-src" title="删除">🗑️</button>
        </div>
      </div>`).join("");

        srcList.querySelectorAll(".btn-del-src").forEach(btn => {
            btn.addEventListener("click", async (e) => {
                e.stopPropagation();
                const id = btn.closest(".card").dataset.id;
                try {
                    await send("deleteSource", { notebookId: activeNotebookId, sourceId: id });
                    toast("已删除", "success");
                    loadSources();
                } catch (err) { toast(err.message, "error"); }
            });
        });
    } catch (err) {
        srcList.innerHTML = `<div class="empty-state">❌ ${err.message}</div>`;
    }
}

// Add URL source
$("#btn-add-source").addEventListener("click", async () => {
    const url = $("#source-url").value.trim();
    if (!url || !activeNotebookId) return;
    try {
        await send("addSourceUrl", { notebookId: activeNotebookId, url });
        $("#source-url").value = "";
        toast("数据源已添加", "success");
        loadSources();
    } catch (err) { toast(err.message, "error"); }
});

// ═══════════════════════════════════════
// Chat
// ═══════════════════════════════════════
async function sendChat() {
    const q = chatInput.value.trim();
    if (!q || !activeNotebookId) {
        if (!activeNotebookId) toast("请先选择一个笔记本", "error");
        return;
    }
    chatInput.value = "";

    // Remove welcome
    const welcome = chatArea.querySelector(".chat-welcome");
    if (welcome) welcome.remove();

    // User bubble
    appendBubble(q, "user");

    // Loading indicator
    const loadingDiv = document.createElement("div");
    loadingDiv.className = "chat-bubble assistant";
    loadingDiv.innerHTML = '<span class="spinner" style="display:inline-block;width:12px;height:12px"></span> 思考中...';
    chatArea.appendChild(loadingDiv);
    chatArea.scrollTop = chatArea.scrollHeight;

    try {
        const answer = await send("askQuestion", {
            notebookId: activeNotebookId,
            question: q,
        });
        loadingDiv.remove();
        appendBubble(answer, "assistant");
    } catch (err) {
        loadingDiv.remove();
        appendBubble(`❌ ${err.message}`, "assistant");
    }
}

function appendBubble(text, role) {
    const div = document.createElement("div");
    div.className = `chat-bubble ${role}`;
    div.textContent = text;
    chatArea.appendChild(div);
    chatArea.scrollTop = chatArea.scrollHeight;
}

$("#btn-send").addEventListener("click", sendChat);
chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendChat();
    }
});

// ═══════════════════════════════════════
// Generate
// ═══════════════════════════════════════
const TYPE_LABELS = {
    1: "播客", 2: "报告", 3: "视频", 4: "测验",
    5: "思维导图", 7: "信息图", 8: "幻灯片", 9: "数据表",
};

$$(".gen-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
        if (!activeNotebookId) {
            toast("请先选择一个笔记本", "error");
            return;
        }
        const typeCode = parseInt(btn.dataset.type, 10);
        const label = TYPE_LABELS[typeCode] || "制品";

        genStatus.style.display = "flex";
        genStatusTxt.textContent = `正在生成${label}...`;

        try {
            await send("generateArtifact", {
                notebookId: activeNotebookId,
                typeCode,
            });
            genStatusTxt.textContent = `${label}生成请求已提交 ✅`;
            toast(`${label}生成已启动`, "success");
            setTimeout(() => (genStatus.style.display = "none"), 3000);
        } catch (err) {
            genStatusTxt.textContent = `❌ ${err.message}`;
            toast(err.message, "error");
            setTimeout(() => (genStatus.style.display = "none"), 4000);
        }
    });
});

// ═══════════════════════════════════════
// Artifacts
// ═══════════════════════════════════════
const STATUS_MAP = {
    1: { label: "生成中", cls: "badge-processing" },
    2: { label: "排队中", cls: "badge-processing" },
    3: { label: "已完成", cls: "badge-completed" },
    4: { label: "失败", cls: "badge-failed" },
};

async function loadArtifacts() {
    if (!activeNotebookId) {
        artifactList.innerHTML = '<div class="empty-state">请先选择一个笔记本</div>';
        return;
    }
    artifactList.innerHTML = '<div class="loading-placeholder">加载中</div>';
    try {
        const artifacts = await send("listArtifacts", { notebookId: activeNotebookId });
        if (!artifacts.length) {
            artifactList.innerHTML = '<div class="empty-state">暂无制品，前往"生成"创建</div>';
            return;
        }
        artifactList.innerHTML = artifacts.map(a => {
            const status = STATUS_MAP[a.status] || { label: `状态 ${a.status}`, cls: "" };
            const typeLabel = TYPE_LABELS[a.typeCode] || `类型 ${a.typeCode}`;
            return `
        <div class="card">
          <div class="card-body">
            <div class="card-title">${escHtml(a.title || typeLabel)}</div>
            <div class="card-subtitle">${typeLabel}</div>
          </div>
          <span class="badge ${status.cls}">${status.label}</span>
        </div>`;
        }).join("");
    } catch (err) {
        artifactList.innerHTML = `<div class="empty-state">❌ ${err.message}</div>`;
    }
}

// ═══════════════════════════════════════
// Helpers
// ═══════════════════════════════════════
function escHtml(str) {
    const d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
}

// ═══════════════════════════════════════
// Init
// ═══════════════════════════════════════
document.addEventListener("DOMContentLoaded", () => {
    loadNotebooks();
});
