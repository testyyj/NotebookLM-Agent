/**
 * Full-page controller for NotebookLM Agent.
 * Imports API directly (extension page has host_permissions).
 */
import * as api from "./src/api.js";

// ── State ──
let activeNotebookId = null;
let notebooks = [];

// ── Folder State ──
const FOLDERS_KEY = "nb_folders";
const FOLDER_MAP_KEY = "nb_folder_map";
const SORT_ORDER_KEY = "nb_sort_order";

const FILTER_ALL = "__ALL__";
const FILTER_UNASSIGNED = "__UNASSIGNED__";
let folders = [];          // sorted flat list of paths, e.g. ["工作", "工作/项目A", "学习"]
let folderMap = {};        // { notebookId: folderPath }
let folderFilter = FILTER_ALL;
let collapsedGroups = {};  // { folderPath: true } for collapsed groups
let customSortOrder = {};  // { folderPath: [nbId, ...] } for drag-and-drop ordering


// ── DOM helpers ──
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

// Picker panel elements
const pickerTrigger = $("#nb-picker-trigger");
const pickerTriggerText = $("#nb-picker-trigger-text");
const pickerPanel = $("#nb-picker-panel");
const pickerSearch = $("#nb-picker-search");
const pickerTree = $("#nb-picker-tree");

// ═══════════════════════════════════════
// Sidebar Navigation
// ═══════════════════════════════════════
const sidebarNav = $(".sidebar-nav");
const NAV_ORDER_KEY = "sidebar_nav_order";

// Restore persisted nav order on load
(async () => {
    const data = await chrome.storage.local.get(NAV_ORDER_KEY);
    const savedOrder = data[NAV_ORDER_KEY];
    if (savedOrder && savedOrder.length) {
        const items = [...sidebarNav.querySelectorAll(".nav-item")];
        const itemMap = new Map(items.map(el => [el.dataset.tab, el]));
        savedOrder.forEach(tab => {
            const el = itemMap.get(tab);
            if (el) sidebarNav.appendChild(el);
        });
        // Append any items not in saved order (new items)
        items.forEach(el => {
            if (!savedOrder.includes(el.dataset.tab)) sidebarNav.appendChild(el);
        });
    }
})();

async function saveNavOrder() {
    const order = [...sidebarNav.querySelectorAll(".nav-item")].map(el => el.dataset.tab);
    await chrome.storage.local.set({ [NAV_ORDER_KEY]: order });
}

// Click handler
$$(".nav-item").forEach(item => {
    item.addEventListener("click", () => {
        $$(".nav-item").forEach(n => n.classList.remove("active"));
        $$(".panel").forEach(p => p.classList.remove("active"));
        item.classList.add("active");
        $(`#panel-${item.dataset.tab}`).classList.add("active");

        // Auto-load data for the active notebook
        const tab = item.dataset.tab;
        if (activeNotebookId) {
            if (tab === "sources") loadSources();
            if (tab === "artifacts") loadArtifacts();
            if (tab === "mapping") loadMapping();
            if (tab === "generate") loadGenerateArtifacts();
        }
        // Podcast publish panel handles no-notebook state internally
        if (tab === "podcast-publish") window.loadPodcastPublishPanel?.();
        // Lazy-load podcast iframe
        if (tab === "podcast") {
            const iframe = $("#podcast-iframe");
            if (iframe && !iframe.src) {
                iframe.src = chrome.runtime.getURL("podcast/dist/src/options/options.html");
            }
        }
        // Render prompts panel on switch
        if (tab === "prompts") {
            renderPromptPanel();
        }
    });
});

// Drag-and-drop reorder for nav items
$$(".nav-item").forEach(item => {
    item.setAttribute("draggable", "true");

    item.addEventListener("dragstart", (e) => {
        item.classList.add("nav-dragging");
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", item.dataset.tab);
    });

    item.addEventListener("dragend", () => {
        item.classList.remove("nav-dragging");
        sidebarNav.querySelectorAll(".nav-item.nav-drag-over").forEach(n => n.classList.remove("nav-drag-over"));
    });

    item.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        const dragging = sidebarNav.querySelector(".nav-item.nav-dragging");
        if (dragging && dragging !== item) {
            sidebarNav.querySelectorAll(".nav-item.nav-drag-over").forEach(n => n.classList.remove("nav-drag-over"));
            item.classList.add("nav-drag-over");
        }
    });

    item.addEventListener("dragleave", () => {
        item.classList.remove("nav-drag-over");
    });

    item.addEventListener("drop", async (e) => {
        e.preventDefault();
        item.classList.remove("nav-drag-over");
        const draggedTab = e.dataTransfer.getData("text/plain");
        const draggedItem = sidebarNav.querySelector(`.nav-item[data-tab="${draggedTab}"]`);
        if (!draggedItem || draggedItem === item) return;

        // Determine insert position based on mouse position
        const rect = item.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        if (e.clientY < midY) {
            sidebarNav.insertBefore(draggedItem, item);
        } else {
            sidebarNav.insertBefore(draggedItem, item.nextSibling);
        }
        await saveNavOrder();
    });
});

// ═══════════════════════════════════════
// Toast
// ═══════════════════════════════════════
function toast(msg, type = "") {
    toastEl.textContent = msg;
    toastEl.className = `toast show ${type ? "toast-" + type : ""}`;
    clearTimeout(toastEl._timer);
    toastEl._timer = setTimeout(() => toastEl.classList.remove("show"), 2800);
}

// ═══════════════════════════════════════
// Notebooks
// ═══════════════════════════════════════
async function loadNotebooks() {
    nbList.innerHTML = '<div class="loading-state"><div class="spinner"></div> 加载笔记本...</div>';
    try {
        notebooks = await api.listNotebooks();
        authError.style.display = "none";

        nbSelect.innerHTML = '<option value="">— 选择笔记本 —</option>';
        notebooks.forEach(nb => {
            const opt = document.createElement("option");
            opt.value = nb.id;
            opt.textContent = nb.title;
            nbSelect.appendChild(opt);
        });

        // Restore saved selection
        const saved = await chrome.storage.local.get("activeNotebookId");
        if (saved.activeNotebookId && notebooks.some(nb => nb.id === saved.activeNotebookId)) {
            activeNotebookId = saved.activeNotebookId;
            nbSelect.value = activeNotebookId;
        }
        // Sync picker trigger text
        updatePickerTriggerText();

        // Load folder state + custom sort order before rendering
        await loadFolderState();
        await loadSortOrder();
        renderNotebooks();
    } catch (err) {
        authError.style.display = "block";
        nbList.innerHTML = `<div class="empty-state">❌ ${escHtml(err.message)}</div>`;
    }
}

// Random notebook icon colors/emojis (like reference)
const NB_ICONS = ['📗', '📕', '📘', '📙', '📓', '📔', '📒'];
function getNotebookIcon(id) {
    // Deterministic icon based on id hash
    let hash = 0;
    for (let i = 0; i < id.length; i++) hash = ((hash << 5) - hash) + id.charCodeAt(i);
    return NB_ICONS[Math.abs(hash) % NB_ICONS.length];
}

// Search & sort state
let nbSearchQuery = "";
let nbSortMode = "created-desc";

function renderNotebooks() {
    if (!notebooks.length) {
        nbList.innerHTML = '<div class="empty-state">暂无笔记本，点击右上角创建</div>';
        return;
    }

    // Enrich notebooks with folder path
    let enriched = notebooks.map(nb => ({
        ...nb,
        folderPath: folderMap[nb.id] || "",
        icon: getNotebookIcon(nb.id),
    }));

    // Apply search filter
    if (nbSearchQuery) {
        const q = nbSearchQuery.toLowerCase();
        enriched = enriched.filter(nb => nb.title.toLowerCase().includes(q));
    }

    // Apply sort
    enriched.sort((a, b) => {
        if (nbSortMode === "title-asc") return a.title.localeCompare(b.title, "zh-Hans-CN", { sensitivity: "base" });
        if (nbSortMode === "title-desc") return b.title.localeCompare(a.title, "zh-Hans-CN", { sensitivity: "base" });
        if (nbSortMode === "created-desc") {
            if (a.createdAt && b.createdAt) return b.createdAt - a.createdAt;
            return b.id.localeCompare(a.id);
        }
        if (nbSortMode === "created-asc") {
            if (a.createdAt && b.createdAt) return a.createdAt - b.createdAt;
            return a.id.localeCompare(b.id);
        }
        return 0;
    });

    if (!enriched.length) {
        nbList.innerHTML = '<div class="empty-state">没有匹配的笔记本</div>';
        return;
    }

    // Group by folder path
    const groups = new Map();
    enriched.forEach(nb => {
        const key = nb.folderPath || FILTER_UNASSIGNED;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(nb);
    });

    // Ensure all registered folders appear even if empty
    for (const fp of folders) {
        if (!groups.has(fp)) groups.set(fp, []);
    }
    // Always show unassigned group
    if (!groups.has(FILTER_UNASSIGNED)) groups.set(FILTER_UNASSIGNED, []);

    // Sort group keys
    const sortedKeys = [...groups.keys()].sort((a, b) => {
        if (a === FILTER_UNASSIGNED) return 1;
        if (b === FILTER_UNASSIGNED) return -1;
        return compareFolderPaths(a, b);
    });

    // Render
    nbList.innerHTML = "";
    sortedKeys.forEach(key => {
        const nbs = groups.get(key);
        const isCollapsed = collapsedGroups[key];

        // Folder name: show leaf name, sub-path as subtitle
        let folderLabel, subPath = "";
        let depth = 0;
        if (key === FILTER_UNASSIGNED) {
            folderLabel = "未分配";
        } else {
            const segments = key.split("/");
            folderLabel = segments[segments.length - 1];
            depth = segments.length - 1; // 0 for root, 1 for sub, etc.
            if (segments.length > 1) subPath = key;
        }
        const indent = depth * 24; // px per level

        // Group header
        const header = document.createElement("div");
        header.className = `folder-group-header ${isCollapsed ? 'collapsed' : ''}`;
        header.dataset.folderKey = key;
        if (indent) header.style.paddingLeft = `${indent + 4}px`;
        const isRealFolder = key !== FILTER_UNASSIGNED;
        header.innerHTML = `
            <span class="folder-toggle">▼</span>
            📂 ${escHtml(folderLabel)}
            ${subPath ? `<span class="folder-group-path">${escHtml(subPath)}</span>` : ''}
            <span class="folder-group-count">(${nbs.length})</span>
            ${isRealFolder ? `<button class="folder-menu-btn" data-folder-key="${escHtml(key)}" title="目录操作">⋯</button>` : ''}
            ${isRealFolder ? `
            <div class="folder-popover" data-folder-key="${escHtml(key)}">
              <button class="folder-popover-item" data-action="add-subfolder">📁 新建子目录</button>
              <button class="folder-popover-item" data-action="rename-folder">✏️ 重命名目录</button>
              <div class="nb-card-popover-sep"></div>
              <button class="folder-popover-item danger" data-action="delete-folder">🗑️ 删除目录</button>
            </div>` : ''}
        `;
        header.addEventListener("click", (e) => {
            if (e.target.closest(".folder-menu-btn") || e.target.closest(".folder-popover")) return;
            collapsedGroups[key] = !collapsedGroups[key];
            header.classList.toggle("collapsed");
            content.classList.toggle("collapsed");
        });
        nbList.appendChild(header);

        // Group content
        const content = document.createElement("div");
        content.className = `folder-group-content ${isCollapsed ? 'collapsed' : ''}`;
        if (indent) content.style.paddingLeft = `${indent}px`;
        // Apply custom drag order only when using default title sort (manual ordering)
        const groupKey = key;
        if (nbSortMode === "title-asc") {
            const order = customSortOrder[groupKey];
            if (order && order.length) {
                const orderMap = {};
                order.forEach((id, i) => orderMap[id] = i);
                nbs.sort((a, b) => {
                    const ai = orderMap[a.id] ?? 9999;
                    const bi = orderMap[b.id] ?? 9999;
                    return ai - bi;
                });
            }
        }

        content.innerHTML = nbs.map(nb => `
          <div class="nb-card ${nb.id === activeNotebookId ? 'selected' : ''}" data-id="${nb.id}" draggable="true">
            <button class="nb-card-menu-btn" data-menu-id="${nb.id}" title="更多操作">⋯</button>
            <div class="nb-card-popover" id="popover-${nb.id}">
              <div class="nb-popover-folder">
                <label>移动到:</label>
                <select data-action="set-folder" data-nb-id="${nb.id}">
                  ${buildFolderOptions(nb.folderPath)}
                </select>
              </div>
              <div class="nb-card-popover-sep"></div>
              <button class="nb-card-popover-item" data-action="open-nb" data-nb-id="${nb.id}">🌐 在 NotebookLM 中打开</button>
              <button class="nb-card-popover-item" data-action="rename-nb" data-nb-id="${nb.id}">✏️ 重命名</button>
              ${nb.folderPath ? `<button class="nb-card-popover-item" data-action="remove-folder" data-nb-id="${nb.id}">📤 从目录移除</button>` : ''}
              <div class="nb-card-popover-sep"></div>
              <button class="nb-card-popover-item danger" data-action="delete-nb" data-nb-id="${nb.id}">🗑️ 删除</button>
            </div>
            <div class="nb-card-top">
              <span class="nb-card-icon">${nb.icon}</span>
              <div class="nb-card-title">${escHtml(nb.title)}</div>
            </div>
            <div class="nb-card-date">${nb.createdAt ? new Date(nb.createdAt).toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }) : ""}</div>
          </div>
        `).join("");
        nbList.appendChild(content);
    });

    // Wire up events
    // "..." menu buttons
    nbList.querySelectorAll(".nb-card-menu-btn").forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const nbId = btn.dataset.menuId;
            const popover = $(`#popover-${nbId}`);
            // Close all other popovers first
            nbList.querySelectorAll(".nb-card-popover.open").forEach(p => {
                if (p !== popover) p.classList.remove("open");
            });
            popover.classList.toggle("open");
        });
    });

    // Click outside to close popovers
    document.addEventListener("click", (e) => {
        if (!e.target.closest(".nb-card-menu-btn") && !e.target.closest(".nb-card-popover")) {
            nbList.querySelectorAll(".nb-card-popover.open").forEach(p => p.classList.remove("open"));
        }
    });

    // Card click to select
    nbList.querySelectorAll(".nb-card").forEach(card => {
        card.addEventListener("click", (e) => {
            if (e.target.closest(".nb-card-menu-btn") || e.target.closest(".nb-card-popover")) return;
            selectNotebook(card.dataset.id);
        });
    });

    // Popover actions
    nbList.querySelectorAll('[data-action="delete-nb"]').forEach(btn => {
        btn.addEventListener("click", async (e) => {
            e.stopPropagation();
            const id = btn.dataset.nbId;
            const nb = notebooks.find(n => n.id === id);
            if (!confirm(`确定删除「${nb?.title || id}」？`)) return;
            try {
                await api.deleteNotebook(id);
                if (activeNotebookId === id) {
                    activeNotebookId = null;
                    chrome.storage.local.remove("activeNotebookId");
                }
                delete folderMap[id];
                await saveFolders();
                toast("已删除", "success");
                loadNotebooks();
            } catch (err) { toast(err.message, "error"); }
        });
    });

    nbList.querySelectorAll('[data-action="open-nb"]').forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const nbId = btn.dataset.nbId;
            window.open(`https://notebooklm.google.com/notebook/${nbId}`, "_blank");
            nbList.querySelectorAll(".nb-card-popover.open").forEach(p => p.classList.remove("open"));
        });
    });

    nbList.querySelectorAll('select[data-action="set-folder"]').forEach(sel => {
        sel.addEventListener("change", async (e) => {
            e.stopPropagation();
            await setNotebookFolder(sel.dataset.nbId, sel.value);
            nbList.querySelectorAll(".nb-card-popover.open").forEach(p => p.classList.remove("open"));
        });
    });

    // Rename action
    nbList.querySelectorAll('[data-action="rename-nb"]').forEach(btn => {
        btn.addEventListener("click", async (e) => {
            e.stopPropagation();
            const id = btn.dataset.nbId;
            const nb = notebooks.find(n => n.id === id);
            const newTitle = prompt("输入新标题:", nb?.title || "");
            if (!newTitle || newTitle.trim() === nb?.title) return;
            try {
                await api.renameNotebook(id, newTitle.trim());
                toast("已重命名", "success");
                nbList.querySelectorAll(".nb-card-popover.open").forEach(p => p.classList.remove("open"));
                loadNotebooks();
            } catch (err) { toast(err.message, "error"); }
        });
    });

    // Remove from folder action
    nbList.querySelectorAll('[data-action="remove-folder"]').forEach(btn => {
        btn.addEventListener("click", async (e) => {
            e.stopPropagation();
            const id = btn.dataset.nbId;
            delete folderMap[id];
            await saveFolders();
            toast("已从目录移除", "success");
            nbList.querySelectorAll(".nb-card-popover.open").forEach(p => p.classList.remove("open"));
            renderNotebooks();
        });
    });

    // ── Folder header context menu events ──
    nbList.querySelectorAll(".folder-menu-btn").forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const header = btn.closest(".folder-group-header");
            const popover = header.querySelector(".folder-popover");
            if (!popover) return;
            // Close all other folder popovers
            nbList.querySelectorAll(".folder-popover.open").forEach(p => {
                if (p !== popover) p.classList.remove("open");
            });
            // Close all notebook popovers
            nbList.querySelectorAll(".nb-card-popover.open").forEach(p => p.classList.remove("open"));
            popover.classList.toggle("open");
        });
    });

    // Rename folder action
    nbList.querySelectorAll('[data-action="rename-folder"]').forEach(btn => {
        btn.addEventListener("click", async (e) => {
            e.stopPropagation();
            const header = btn.closest(".folder-group-header");
            const oldPath = header.dataset.folderKey;
            const oldSegments = oldPath.split("/");
            const oldLeaf = oldSegments[oldSegments.length - 1];
            const newLeaf = prompt("输入新目录名:", oldLeaf);
            if (!newLeaf || newLeaf.trim() === oldLeaf) return;
            const trimmed = newLeaf.trim().replace(/[\/\\]/g, ""); // disallow slashes in leaf name
            if (!trimmed) return;
            const newPath = oldSegments.length > 1
                ? oldSegments.slice(0, -1).join("/") + "/" + trimmed
                : trimmed;
            await renameFolder(oldPath, newPath);
            nbList.querySelectorAll(".folder-popover.open").forEach(p => p.classList.remove("open"));
        });
    });

    // Delete folder action
    nbList.querySelectorAll('[data-action="delete-folder"]').forEach(btn => {
        btn.addEventListener("click", async (e) => {
            e.stopPropagation();
            const header = btn.closest(".folder-group-header");
            const folderPath = header.dataset.folderKey;
            if (!confirm(`确定删除目录「${folderPath}」？\n目录下的笔记本将回到"未分配"。`)) return;
            await deleteFolder(folderPath);
            nbList.querySelectorAll(".folder-popover.open").forEach(p => p.classList.remove("open"));
        });
    });

    // Add subfolder action
    nbList.querySelectorAll('[data-action="add-subfolder"]').forEach(btn => {
        btn.addEventListener("click", async (e) => {
            e.stopPropagation();
            const header = btn.closest(".folder-group-header");
            const parentPath = header.dataset.folderKey;
            const name = prompt("输入子目录名:");
            if (!name || !name.trim()) return;
            const trimmed = name.trim().replace(/[\/\\]/g, "");
            if (!trimmed) return;
            const newPath = parentPath + "/" + trimmed;
            const folderSet = new Set(folders);
            addHierarchyToSet(folderSet, newPath);
            if (folderSet.size === folders.length) {
                toast(`子目录已存在：${newPath}`, "error");
            } else {
                folders = sortFolders(Array.from(folderSet));
                await saveFolders();
                toast(`已创建子目录：${newPath}`, "success");
                renderNotebooks();
            }
            nbList.querySelectorAll(".folder-popover.open").forEach(p => p.classList.remove("open"));
        });
    });

    // ── Drag & Drop ──
    nbList.querySelectorAll(".nb-card[draggable]").forEach(card => {
        card.addEventListener("dragstart", (e) => {
            card.classList.add("dragging");
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", card.dataset.id);
        });

        card.addEventListener("dragend", () => {
            card.classList.remove("dragging");
            nbList.querySelectorAll(".nb-card.drag-over").forEach(c => c.classList.remove("drag-over"));
            nbList.querySelectorAll(".folder-group-header.drag-over").forEach(h => h.classList.remove("drag-over"));
        });

        card.addEventListener("dragover", (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            const dragging = nbList.querySelector(".nb-card.dragging");
            if (dragging && dragging !== card) {
                nbList.querySelectorAll(".nb-card.drag-over").forEach(c => c.classList.remove("drag-over"));
                card.classList.add("drag-over");
            }
        });

        card.addEventListener("dragleave", () => {
            card.classList.remove("drag-over");
        });

        card.addEventListener("drop", async (e) => {
            e.preventDefault();
            card.classList.remove("drag-over");
            const draggedId = e.dataTransfer.getData("text/plain");
            const targetId = card.dataset.id;
            if (draggedId === targetId) return;

            // Check if dropping into a different folder (cross-folder move)
            const draggedFolder = folderMap[draggedId] || "";
            const targetFolder = folderMap[targetId] || "";
            if (draggedFolder !== targetFolder) {
                // Cross-folder move: assign the notebook to the target's folder
                await setNotebookFolder(draggedId, targetFolder);
                return;
            }

            // Same folder: reorder within group
            const container = card.closest(".folder-group-content");
            if (!container) return;
            const cards = [...container.querySelectorAll(".nb-card")];
            const ids = cards.map(c => c.dataset.id);

            const fromIdx = ids.indexOf(draggedId);
            const toIdx = ids.indexOf(targetId);
            if (fromIdx === -1 || toIdx === -1) return;
            ids.splice(fromIdx, 1);
            ids.splice(toIdx, 0, draggedId);

            const groupKey = folderMap[draggedId] || FILTER_UNASSIGNED;
            customSortOrder[groupKey] = ids;
            await saveSortOrder();
            renderNotebooks();
        });
    });

    // ── Folder header as drop target (cross-folder drag) ──
    nbList.querySelectorAll(".folder-group-header").forEach(header => {
        header.addEventListener("dragover", (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            const dragging = nbList.querySelector(".nb-card.dragging");
            if (dragging) {
                nbList.querySelectorAll(".folder-group-header.drag-over").forEach(h => h.classList.remove("drag-over"));
                header.classList.add("drag-over");
            }
        });

        header.addEventListener("dragleave", () => {
            header.classList.remove("drag-over");
        });

        header.addEventListener("drop", async (e) => {
            e.preventDefault();
            header.classList.remove("drag-over");
            const draggedId = e.dataTransfer.getData("text/plain");
            if (!draggedId) return;
            const targetFolderKey = header.dataset.folderKey;
            const newFolder = targetFolderKey === FILTER_UNASSIGNED ? "" : targetFolderKey;
            const currentFolder = folderMap[draggedId] || "";
            if (currentFolder === newFolder) return; // already in this folder
            await setNotebookFolder(draggedId, newFolder);
        });
    });
}

async function selectNotebook(id) {
    activeNotebookId = id;
    nbSelect.value = id;
    await chrome.storage.local.set({ activeNotebookId: id });

    // Clear cached data so stale content is not shown
    currentSources = [];
    currentArtifacts = [];

    renderNotebooks();
    updatePickerTriggerText();
    renderPickerTree(); // refresh selected state
    const nb = notebooks.find(n => n.id === id);
    toast(`已选择: ${nb?.title || id}`, "success");

    // Auto-refresh right-side content for the currently active tab
    const activeTab = $(".nav-item.active")?.dataset.tab;
    if (activeTab === "sources") loadSources();
    else if (activeTab === "artifacts") loadArtifacts();
    else if (activeTab === "mapping") loadMapping();
    else if (activeTab === "generate") loadGenerateArtifacts();
    else if (activeTab === "podcast-publish") window.loadPodcastPublishPanel?.();
}

// Create
$("#btn-create-nb").addEventListener("click", async () => {
    const btn = $("#btn-create-nb");
    btn.disabled = true;
    try {
        const result = await api.createNotebook();
        toast("已创建新笔记本", "success");
        await loadNotebooks();
        // Open the new notebook in NotebookLM
        if (result && result[0]) {
            const newId = result[0];
            window.open(`https://notebooklm.google.com/notebook/${newId}`, "_blank");
        }
    } catch (err) {
        toast(err.message, "error");
    } finally {
        btn.disabled = false;
    }
});

// Search
$("#nb-search").addEventListener("input", () => {
    nbSearchQuery = $("#nb-search").value.trim();
    renderNotebooks();
});

// Sort
$("#nb-sort").addEventListener("change", () => {
    nbSortMode = $("#nb-sort").value;
    renderNotebooks();
});

// Collapse / Expand all
$("#btn-collapse-all").addEventListener("click", () => {
    // Collapse all current groups
    const allKeys = new Set();
    notebooks.forEach(nb => {
        const fp = folderMap[nb.id] || FILTER_UNASSIGNED;
        allKeys.add(fp);
    });
    allKeys.forEach(k => collapsedGroups[k] = true);
    renderNotebooks();
});

$("#btn-expand-all").addEventListener("click", () => {
    collapsedGroups = {};
    renderNotebooks();
});

// ═══════════════════════════════════════
// Folder Management
// ═══════════════════════════════════════
function normalizeFolderPath(rawPath) {
    if (typeof rawPath !== "string") return "";
    return rawPath.replace(/\\/g, "/").split("/").map(s => s.trim().replace(/\s+/g, " ")).filter(Boolean).join("/");
}

function addHierarchyToSet(targetSet, path) {
    const normalized = normalizeFolderPath(path);
    if (!normalized) return;
    const segments = normalized.split("/");
    for (let i = 1; i <= segments.length; i++) {
        targetSet.add(segments.slice(0, i).join("/"));
    }
}

function compareFolderPaths(a, b) {
    const aParts = a.split("/");
    const bParts = b.split("/");
    const depth = Math.min(aParts.length, bParts.length);
    for (let i = 0; i < depth; i++) {
        const delta = aParts[i].localeCompare(bParts[i], "zh-Hans-CN", { sensitivity: "base" });
        if (delta !== 0) return delta;
    }
    return aParts.length - bParts.length;
}

function sortFolders(paths) {
    return paths.slice().sort(compareFolderPaths);
}

async function loadFolderState() {
    const data = await chrome.storage.local.get([FOLDERS_KEY, FOLDER_MAP_KEY]);
    const folderSet = new Set();

    if (Array.isArray(data[FOLDERS_KEY])) {
        data[FOLDERS_KEY].forEach(p => addHierarchyToSet(folderSet, p));
    }

    const rawMap = data[FOLDER_MAP_KEY] || {};
    folderMap = {};
    for (const [key, val] of Object.entries(rawMap)) {
        const path = normalizeFolderPath(val);
        if (path) {
            folderMap[key] = path;
            addHierarchyToSet(folderSet, path);
        }
    }

    folders = sortFolders(Array.from(folderSet));
}

async function saveFolders() {
    await chrome.storage.local.set({
        [FOLDERS_KEY]: folders,
        [FOLDER_MAP_KEY]: folderMap,
    });
}

async function loadSortOrder() {
    const data = await chrome.storage.local.get(SORT_ORDER_KEY);
    customSortOrder = data[SORT_ORDER_KEY] || {};
}

async function saveSortOrder() {
    await chrome.storage.local.set({ [SORT_ORDER_KEY]: customSortOrder });
}

function folderMatchesFilter(folderPath) {
    if (folderFilter === FILTER_ALL) return true;
    if (folderFilter === FILTER_UNASSIGNED) return !folderPath;
    if (!folderPath) return false;
    return folderPath === folderFilter || folderPath.startsWith(`${folderFilter}/`);
}

function folderOptionLabel(path) {
    const segments = path.split("/");
    const leaf = segments[segments.length - 1];
    const depth = segments.length - 1;
    if (depth === 0) return leaf;
    return `${"  ".repeat(depth)}- ${leaf}`;
}

function buildFolderOptions(selectedPath) {
    let html = `<option value=""${!selectedPath ? ' selected' : ''}>未分配</option>`;
    for (const path of folders) {
        const sel = selectedPath === path ? " selected" : "";
        html += `<option value="${escHtml(path)}"${sel}>${escHtml(folderOptionLabel(path))}</option>`;
    }
    return html;
}

async function createFolderFromInput() {
    const input = $("#new-folder-path");
    const normalized = normalizeFolderPath(input.value);
    if (!normalized) { toast("请输入目录名，如：工作/项目A", "error"); return; }

    const folderSet = new Set(folders);
    addHierarchyToSet(folderSet, normalized);
    if (folderSet.size === folders.length) { toast(`目录已存在：${normalized}`, "error"); return; }

    folders = sortFolders(Array.from(folderSet));
    await saveFolders();
    input.value = "";
    toast(`已创建目录：${normalized}`, "success");
    renderNotebooks();
}

async function setNotebookFolder(nbId, path) {
    const normalized = normalizeFolderPath(path);
    if (!normalized) {
        delete folderMap[nbId];
    } else {
        const folderSet = new Set(folders);
        addHierarchyToSet(folderSet, normalized);
        folders = sortFolders(Array.from(folderSet));
        folderMap[nbId] = normalized;
    }
    await saveFolders();
    toast(normalized ? `已移动到：${normalized}` : "已移出目录", "success");
    renderNotebooks();
}

async function renameFolder(oldPath, newPath) {
    const normalizedNew = normalizeFolderPath(newPath);
    if (!normalizedNew) return;

    // Update folders array: replace old prefix with new
    const newFolderSet = new Set();
    for (const f of folders) {
        if (f === oldPath) {
            addHierarchyToSet(newFolderSet, normalizedNew);
        } else if (f.startsWith(oldPath + "/")) {
            const sub = normalizedNew + f.slice(oldPath.length);
            addHierarchyToSet(newFolderSet, sub);
        } else {
            addHierarchyToSet(newFolderSet, f);
        }
    }
    folders = sortFolders(Array.from(newFolderSet));

    // Update folderMap: update notebook assignments
    for (const [nbId, fp] of Object.entries(folderMap)) {
        if (fp === oldPath) {
            folderMap[nbId] = normalizedNew;
        } else if (fp.startsWith(oldPath + "/")) {
            folderMap[nbId] = normalizedNew + fp.slice(oldPath.length);
        }
    }

    // Update custom sort order keys
    const newSortOrder = {};
    for (const [k, v] of Object.entries(customSortOrder)) {
        if (k === oldPath) {
            newSortOrder[normalizedNew] = v;
        } else if (k.startsWith(oldPath + "/")) {
            newSortOrder[normalizedNew + k.slice(oldPath.length)] = v;
        } else {
            newSortOrder[k] = v;
        }
    }
    customSortOrder = newSortOrder;
    await saveSortOrder();

    await saveFolders();
    toast(`已重命名目录：${oldPath} → ${normalizedNew}`, "success");
    renderNotebooks();
}

async function deleteFolder(folderPath) {
    // Remove folder and its sub-folders
    folders = folders.filter(f => f !== folderPath && !f.startsWith(folderPath + "/"));

    // Unassign all notebooks in this folder (and sub-folders)
    for (const [nbId, fp] of Object.entries(folderMap)) {
        if (fp === folderPath || fp.startsWith(folderPath + "/")) {
            delete folderMap[nbId];
        }
    }

    // Clean up custom sort order for deleted folders
    for (const k of Object.keys(customSortOrder)) {
        if (k === folderPath || k.startsWith(folderPath + "/")) {
            delete customSortOrder[k];
        }
    }
    await saveSortOrder();

    await saveFolders();
    toast(`已删除目录：${folderPath}`, "success");
    renderNotebooks();
}

// Close folder popovers on outside click (registered once, outside renderNotebooks)
document.addEventListener("click", (e) => {
    if (!e.target.closest(".folder-menu-btn") && !e.target.closest(".folder-popover")) {
        nbList.querySelectorAll(".folder-popover.open").forEach(p => p.classList.remove("open"));
    }
});

// Folder events
$("#btn-create-folder").addEventListener("click", () => createFolderFromInput());
$("#new-folder-path").addEventListener("keydown", e => {
    if (e.key === "Enter") createFolderFromInput();
});
nbSelect.addEventListener("change", () => selectNotebook(nbSelect.value));

// ═══════════════════════════════════════
// Notebook Picker Panel
// ═══════════════════════════════════════
let pickerCollapsed = {}; // collapsed state for picker folders

function updatePickerTriggerText() {
    if (!activeNotebookId) {
        pickerTriggerText.textContent = "— 选择笔记本 —";
        return;
    }
    const nb = notebooks.find(n => n.id === activeNotebookId);
    pickerTriggerText.textContent = nb ? nb.title : activeNotebookId;
}

function togglePicker(forceClose) {
    const isOpen = pickerPanel.classList.contains("open");
    if (forceClose || isOpen) {
        pickerPanel.classList.remove("open");
        pickerTrigger.classList.remove("open");
        pickerSearch.value = "";
    } else {
        renderPickerTree();
        pickerPanel.classList.add("open");
        pickerTrigger.classList.add("open");
        setTimeout(() => pickerSearch.focus(), 50);
    }
}

function renderPickerTree() {
    const query = (pickerSearch.value || "").trim().toLowerCase();

    // Enrich & filter
    let items = notebooks.map(nb => ({
        id: nb.id,
        title: nb.title,
        folderPath: folderMap[nb.id] || "",
        icon: getNotebookIcon(nb.id),
    }));
    if (query) {
        items = items.filter(nb => nb.title.toLowerCase().includes(query));
    }

    if (!items.length) {
        pickerTree.innerHTML = '<div class="nb-picker-empty">没有匹配的笔记本</div>';
        return;
    }

    // Group by folder
    const groups = new Map();
    items.forEach(nb => {
        const key = nb.folderPath || FILTER_UNASSIGNED;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(nb);
    });

    const sortedKeys = [...groups.keys()].sort((a, b) => {
        if (a === FILTER_UNASSIGNED) return 1;
        if (b === FILTER_UNASSIGNED) return -1;
        return compareFolderPaths(a, b);
    });

    pickerTree.innerHTML = "";
    sortedKeys.forEach(key => {
        const nbs = groups.get(key);
        const isCollapsed = pickerCollapsed[key];
        const folderLabel = key === FILTER_UNASSIGNED ? "未分配" : key;

        // Folder header
        const folderEl = document.createElement("div");
        folderEl.className = `nb-picker-folder${isCollapsed ? ' collapsed' : ''}`;
        folderEl.innerHTML = `
            <span class="nb-picker-folder-toggle">▼</span>
            📂 ${escHtml(folderLabel)}
            <span class="nb-picker-folder-count">(${nbs.length})</span>
        `;
        folderEl.addEventListener("click", () => {
            pickerCollapsed[key] = !pickerCollapsed[key];
            folderEl.classList.toggle("collapsed");
            itemsContainer.style.display = pickerCollapsed[key] ? "none" : "";
        });
        pickerTree.appendChild(folderEl);

        // Items container
        const itemsContainer = document.createElement("div");
        itemsContainer.style.display = isCollapsed ? "none" : "";
        nbs.forEach(nb => {
            const item = document.createElement("button");
            item.className = `nb-picker-item${nb.id === activeNotebookId ? ' selected' : ''}`;
            item.innerHTML = `
                <span class="nb-picker-item-icon">${nb.icon}</span>
                <span class="nb-picker-item-title">${escHtml(nb.title)}</span>
                <span class="nb-picker-item-check">✓</span>
            `;
            item.addEventListener("click", () => {
                selectNotebook(nb.id);
                togglePicker(true);
            });
            itemsContainer.appendChild(item);
        });
        pickerTree.appendChild(itemsContainer);
    });
}

// Picker trigger click
pickerTrigger.addEventListener("click", (e) => {
    e.stopPropagation();
    togglePicker();
});

// Search input
pickerSearch.addEventListener("input", () => renderPickerTree());
pickerSearch.addEventListener("click", (e) => e.stopPropagation());

// Close picker on outside click
document.addEventListener("click", (e) => {
    if (!e.target.closest(".nb-picker-panel") && !e.target.closest("#nb-picker-trigger")) {
        togglePicker(true);
    }
});

// Close picker on Escape
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && pickerPanel.classList.contains("open")) {
        togglePicker(true);
    }
});

// ═══════════════════════════════════════
// Sources — with batch download
// ═══════════════════════════════════════
let currentSources = [];

async function loadSources() {
    const scope = $("#source-scope-filter")?.value || "current";
    if (scope === "current" && !activeNotebookId) {
        srcList.innerHTML = '<div class="empty-state">请先在左侧选择一个笔记本</div>';
        return;
    }
    srcList.innerHTML = '<div class="loading-state"><div class="spinner"></div> 加载数据源...</div>';
    try {
        let showNotebook = false;
        if (scope === "current") {
            currentSources = await api.listSources(activeNotebookId);
        } else {
            showNotebook = true;
            let targetNbs = [];
            if (scope === "all") {
                targetNbs = notebooks;
            } else if (scope.startsWith("folder:")) {
                const fp = scope.slice(7);
                targetNbs = notebooks.filter(nb => { const f = folderMap[nb.id]; return f && (f === fp || f.startsWith(fp + "/")); });
            }
            if (!targetNbs.length) { srcList.innerHTML = '<div class="empty-state">该范围内没有笔记本</div>'; return; }
            srcList.innerHTML = `<div class="loading-state"><div class="spinner"></div> 加载 ${targetNbs.length} 个笔记本...</div>`;
            currentSources = [];
            const BATCH = 5;
            for (let i = 0; i < targetNbs.length; i += BATCH) {
                const results = await Promise.all(targetNbs.slice(i, i + BATCH).map(async nb => {
                    try { const s = await api.listSources(nb.id); s.forEach(x => x._notebookTitle = nb.title); return s; }
                    catch { return []; }
                }));
                for (const r of results) currentSources.push(...r);
            }
        }
        renderSources(showNotebook);
    } catch (err) {
        srcList.innerHTML = `<div class="empty-state">❌ ${escHtml(err.message)}</div>`;
    }
}

function renderSources(showNotebook = false) {
    const filterVal = $("#source-type-filter")?.value || "all";
    const searchQ = ($("#source-search")?.value || "").trim().toLowerCase();

    let filtered = filterVal === "all"
        ? currentSources
        : currentSources.filter(s => String(s.typeCode) === filterVal);

    if (searchQ) {
        filtered = filtered.filter(s => {
            const title = (s.title || "").toLowerCase();
            const nb = (s._notebookTitle || "").toLowerCase();
            const url = (s.url || "").toLowerCase();
            return title.includes(searchQ) || nb.includes(searchQ) || url.includes(searchQ);
        });
    }

    const countEl = $("#source-count");
    if (countEl) {
        countEl.textContent = (filterVal !== "all" || searchQ)
            ? `${filtered.length} / ${currentSources.length}`
            : `共 ${currentSources.length} 个数据源`;
    }

    if (!filtered.length) {
        srcList.innerHTML = (filterVal === "all" && !searchQ)
            ? '<div class="empty-state">暂无数据源，在工具栏添加 URL</div>'
            : '<div class="empty-state">没有匹配的数据源</div>';
        return;
    }

    const SOURCE_TYPE_LABELS = {
        1: "Google Docs", 2: "Google Slides", 3: "PDF", 4: "粘贴文本",
        5: "网页", 8: "Markdown", 9: "YouTube", 10: "媒体", 11: "Word",
        13: "图片", 14: "表格", 16: "CSV",
    };

    const SOURCE_TYPE_ICONS = {
        1: "📄", 2: "📊", 3: "📕", 4: "✏️", 5: "🌐",
        8: "📝", 9: "🎬", 10: "🎵", 11: "📃", 13: "🖼️", 14: "📊", 16: "📋",
    };

    const rows = filtered.map(s => {
        const typeLabel = SOURCE_TYPE_LABELS[s.typeCode] || `类型 ${s.typeCode}`;
        const typeIcon = SOURCE_TYPE_ICONS[s.typeCode] || "📎";
        const nbCell = showNotebook && s._notebookTitle ? escHtml(s._notebookTitle) : "—";
        const hasUrl = !!s.url;
        return `<tr data-id="${s.id}" data-type="${s.typeCode}">
          <td><input type="checkbox" class="art-checkbox src-row-check" data-id="${s.id}"></td>
          <td><div class="art-name-cell"><span class="art-name-icon">${typeIcon}</span><span class="art-name-text" title="${escHtml(s.title || '')}">${escHtml(s.title || '未命名')}</span></div></td>
          <td><span class="art-nb-text">${nbCell}</span></td>
          <td><span class="src-type-badge" data-type="${s.typeCode}">${typeLabel}</span></td>
          <td><div class="art-actions-cell">
            ${hasUrl ? `<button class="art-action-btn src-btn-view" data-url="${escHtml(s.url)}" title="打开链接">👁️</button>` : ''}
            <button class="art-action-btn src-btn-dl" data-id="${s.id}" title="下载全文">⬇️</button>
            <button class="art-action-btn src-btn-del danger" data-id="${s.id}" title="删除">🗑</button>
          </div></td>
        </tr>`;
    }).join("");

    srcList.innerHTML = `<table class="art-table"><thead><tr>
      <th style="width:40px"><input type="checkbox" class="art-checkbox" id="src-select-all" title="全选"></th>
      <th>名称</th><th>笔记本</th><th>类型</th><th>操作</th>
    </tr></thead><tbody>${rows}</tbody></table>`;

    // Select-all checkbox
    const selectAll = $("#src-select-all");
    const getRowChecks = () => srcList.querySelectorAll(".src-row-check");
    if (selectAll) {
        selectAll.addEventListener("change", () => {
            getRowChecks().forEach(cb => cb.checked = selectAll.checked);
        });
    }
    getRowChecks().forEach(cb => {
        cb.addEventListener("change", () => {
            const all = getRowChecks();
            const checked = [...all].filter(c => c.checked);
            if (selectAll) {
                selectAll.checked = checked.length === all.length;
                selectAll.indeterminate = checked.length > 0 && checked.length < all.length;
            }
        });
    });

    // View (open URL in new tab)
    srcList.querySelectorAll(".src-btn-view").forEach(btn => {
        btn.addEventListener("click", () => window.open(btn.dataset.url, "_blank"));
    });

    // Per-source download
    srcList.querySelectorAll(".src-btn-dl").forEach(btn => {
        btn.addEventListener("click", async () => {
            const id = btn.dataset.id;
            const src = currentSources.find(s => s.id === id);
            btn.disabled = true;
            btn.textContent = "⏳";
            try {
                const ft = await api.getSourceFulltext(activeNotebookId, id);
                downloadTextFile(
                    `${sanitizeFilename(ft.title || src?.title || "source")}.txt`,
                    ft.content,
                );
                toast("已下载", "success");
            } catch (err) {
                toast(`下载失败: ${err.message}`, "error");
            } finally {
                btn.disabled = false;
                btn.textContent = "⬇️";
            }
        });
    });

    // Delete buttons
    srcList.querySelectorAll(".src-btn-del").forEach(btn => {
        btn.addEventListener("click", async () => {
            const id = btn.dataset.id;
            const src = currentSources.find(s => s.id === id);
            if (!confirm(`确定删除数据源「${src?.title || "未命名"}」？`)) return;
            try {
                await api.deleteSource(activeNotebookId, id);
                currentSources = currentSources.filter(s => s.id !== id);
                renderSources(showNotebook);
                toast("已删除", "success");
            } catch (err) { toast(err.message, "error"); }
        });
    });
}

// Source type filter
$("#source-type-filter")?.addEventListener("change", () => renderSources());

// Source search
$("#source-search")?.addEventListener("input", () => renderSources());

// Source scope filter
$("#source-scope-filter")?.addEventListener("change", () => {
    currentSources = [];
    loadSources();
});

// Refresh sources
$("#btn-refresh-sources")?.addEventListener("click", loadSources);

// Batch download sources (checked or all)
$("#btn-download-all-sources")?.addEventListener("click", async () => {
    const checks = srcList.querySelectorAll(".src-row-check:checked");
    let downloadable;
    if (checks.length > 0) {
        const selectedIds = new Set([...checks].map(c => c.dataset.id));
        downloadable = currentSources.filter(s => selectedIds.has(s.id));
    } else {
        downloadable = [...currentSources];
    }
    if (!downloadable.length) {
        toast("没有可下载的数据源", "error");
        return;
    }
    const btn = $("#btn-download-all-sources");
    btn.disabled = true;
    toast(`开始下载 ${downloadable.length} 个数据源...`);

    let success = 0;
    for (const src of downloadable) {
        try {
            const ft = await api.getSourceFulltext(activeNotebookId, src.id);
            downloadTextFile(
                `${sanitizeFilename(ft.title || src.title || src.id)}.txt`,
                ft.content,
            );
            success++;
        } catch (e) {
            console.warn(`[NB Agent] Failed to download source ${src.id}:`, e);
        }
        await sleep(200);
    }

    toast(`已下载 ${success}/${downloadable.length} 个数据源`, "success");
    btn.disabled = false;
});

// Batch delete sources
$("#btn-batch-delete-sources")?.addEventListener("click", async () => {
    const checks = srcList.querySelectorAll(".src-row-check:checked");
    if (!checks.length) {
        toast("请先勾选要删除的数据源", "error");
        return;
    }
    const selectedIds = [...checks].map(c => c.dataset.id);
    if (!confirm(`确定删除 ${selectedIds.length} 个数据源？此操作不可撤销。`)) return;
    let successCount = 0, failCount = 0;
    for (const id of selectedIds) {
        try {
            await api.deleteSource(activeNotebookId, id);
            currentSources = currentSources.filter(s => s.id !== id);
            successCount++;
        } catch { failCount++; }
    }
    renderSources();
    const msg = failCount
        ? `删除完成：成功 ${successCount}，失败 ${failCount}`
        : `✅ 已删除 ${successCount} 个数据源`;
    toast(msg, failCount ? "error" : "success");
});

// Add URL
$("#btn-add-source").addEventListener("click", async () => {
    const url = $("#source-url").value.trim();
    if (!url || !activeNotebookId) {
        if (!activeNotebookId) toast("请先选择一个笔记本", "error");
        return;
    }
    try {
        await api.addSourceUrl(activeNotebookId, url);
        $("#source-url").value = "";
        toast("数据源已添加", "success");
        loadSources();
    } catch (err) { toast(err.message, "error"); }
});
$("#source-url").addEventListener("keydown", e => {
    if (e.key === "Enter") $("#btn-add-source").click();
});

// ═══════════════════════════════════════
// Chat
// ═══════════════════════════════════════
async function sendChat() {
    const q = chatInput.value.trim();
    if (!q) return;
    if (!activeNotebookId) { toast("请先选择一个笔记本", "error"); return; }
    chatInput.value = "";

    const welcome = chatArea.querySelector(".chat-welcome");
    if (welcome) welcome.remove();
    appendBubble(q, "user");

    // Create streaming bubble (starts as loading indicator)
    const bubble = document.createElement("div");
    bubble.className = "chat-bubble assistant";
    bubble.innerHTML = '<div class="spinner" style="display:inline-block;width:14px;height:14px"></div> 思考中...';
    chatArea.appendChild(bubble);
    chatArea.scrollTop = chatArea.scrollHeight;

    try {
        const answer = await api.askQuestion(activeNotebookId, q, (partialText) => {
            // Update bubble with streaming text
            bubble.textContent = partialText;
            chatArea.scrollTop = chatArea.scrollHeight;
        });
        // Final update with complete answer
        bubble.textContent = answer;
        chatArea.scrollTop = chatArea.scrollHeight;
    } catch (err) {
        bubble.textContent = `❌ ${err.message}`;
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
chatInput.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); }
});

// ═══════════════════════════════════════
// Generate
// ═══════════════════════════════════════
const TYPE_LABELS = {
    1: "播客", 2: "报告", 3: "视频", 4: "测验/闪卡",
    5: "思维导图", 7: "信息图", 8: "幻灯片", 9: "数据表",
};

// ── Prompt Modal state ──
const promptModal = $("#prompt-modal");
const promptInput = $("#prompt-input");
const promptHint = $("#prompt-modal-hint");
let _pendingPromptCard = null; // the card that opened the modal
let _pendingPromptType = null; // the type code for import filtering

function openPromptModal(card) {
    _pendingPromptCard = card;
    _pendingPromptType = card.dataset.type || card.dataset.batchType || null; // works for both regular and batch cards
    const label = card.querySelector(".gen-name")?.textContent || "制品";
    promptHint.textContent = `为「${label}」输入自定义生成指示（可留空使用默认）`;
    promptInput.value = "";
    // Reset import dropdown
    const importDropdown = $("#prompt-import-dropdown");
    if (importDropdown) importDropdown.style.display = "none";
    promptModal.style.display = "flex";
    setTimeout(() => promptInput.focus(), 50);
}

function closePromptModal() {
    promptModal.style.display = "none";
    _pendingPromptCard = null;
    promptInput.value = "";
}

async function doGenerate(card, instructions = null) {
    if (!activeNotebookId) { toast("请先选择一个笔记本", "error"); return; }
    const typeCode = parseInt(card.dataset.type, 10);
    const variant = card.dataset.variant || null;
    const lang = $("#gen-lang")?.value || "zh";
    const label = card.querySelector(".gen-name")?.textContent || TYPE_LABELS[typeCode] || "制品";

    genStatus.style.display = "flex";
    genStatusTxt.textContent = `正在生成${label}...`;

    try {
        await api.generateArtifact(activeNotebookId, typeCode, variant, instructions || null, null, lang);
        genStatusTxt.textContent = `${label}生成请求已提交 ✅`;
        toast(`${label}生成已启动`, "success");
        setTimeout(() => (genStatus.style.display = "none"), 3000);
    } catch (err) {
        genStatusTxt.textContent = `❌ ${err.message}`;
        toast(err.message, "error");
        setTimeout(() => (genStatus.style.display = "none"), 4000);
    }
}

// Inject ✏️ prompt buttons on promptable cards
$$(".gen-card[data-promptable]").forEach(card => {
    const btn = document.createElement("span");
    btn.className = "prompt-btn";
    btn.title = "自定义提示词";
    btn.textContent = "✏️";
    btn.addEventListener("click", (e) => {
        e.stopPropagation(); // prevent card click
        openPromptModal(card);
    });
    card.appendChild(btn);
});

// Card click → generate without prompt (original behavior) — exclude batch cards
$$(".gen-card:not(.gen-card-batch)").forEach(card => {
    card.addEventListener("click", async () => {
        await doGenerate(card);
    });
});

// Prompt modal — submit
$("#prompt-submit").addEventListener("click", async () => {
    const card = _pendingPromptCard;
    if (!card) return;
    const instructions = promptInput.value.trim() || null;
    closePromptModal();
    // Route to batch flow if it's a batch card
    if (card.classList.contains("gen-card-batch")) {
        startBatchFlow(card, instructions);
    } else {
        await doGenerate(card, instructions);
    }
});

// Prompt modal — cancel
$("#prompt-cancel").addEventListener("click", closePromptModal);
$$(".prompt-modal-backdrop").forEach(el => el.addEventListener("click", closePromptModal));

// ═══════════════════════════════════════
// Per-Source Batch Generation
// ═══════════════════════════════════════
{
    const batchDialog = $("#batch-gen-dialog");
    const batchWarning = $("#batch-gen-warning");
    const batchForm = $("#batch-gen-form");
    const batchVariantLabel = $("#batch-gen-variant-label");
    const batchCount = $("#batch-gen-count");
    const batchSourceList = $("#batch-gen-source-list");
    const batchProgress = $("#batch-gen-progress");
    const batchOverall = $("#batch-gen-overall");
    const batchBar = $("#batch-gen-bar");
    const batchText = $("#batch-gen-text");
    const batchConfirm = $("#batch-gen-confirm");
    const batchCancel = $("#batch-gen-cancel");

    const VARIANT_LABELS = {
        deep_dive: "🔍 深入探究 (Deep Dive)",
        brief: "📋 摘要 (Brief)",
        critique: "💬 评论 (Critique)",
        debate: "⚔️ 辩论 (Debate)",
    };

    const SOURCE_TYPE_LABELS_BATCH = {
        1: "Google Docs", 2: "Google Slides", 3: "PDF", 4: "粘贴文本",
        5: "网页", 8: "Markdown", 9: "YouTube", 10: "媒体", 11: "Word",
        13: "图片", 14: "表格", 16: "CSV",
    };

    let _batchSources = [];
    let _batchVariant = null;
    let _batchGenerating = false;
    let _batchInstructions = null;

    // Shared function to start the batch flow (called from card click or prompt submit)
    window.startBatchFlow = async function (card, instructions = null) {
        if (!activeNotebookId) {
            toast("请先选择一个笔记本", "error");
            return;
        }

        const variant = card.dataset.batchVariant;
        _batchVariant = variant;
        _batchInstructions = instructions;
        _batchGenerating = false;

        // Load sources
        genStatus.style.display = "flex";
        genStatusTxt.textContent = "正在加载数据源...";

        try {
            if (!currentSources.length) {
                currentSources = await api.listSources(activeNotebookId);
            }
            _batchSources = currentSources;
        } catch (err) {
            genStatus.style.display = "none";
            toast(`加载数据源失败: ${err.message}`, "error");
            return;
        }
        genStatus.style.display = "none";

        if (!_batchSources.length) {
            toast("该笔记本没有数据源", "error");
            return;
        }

        // Check >20 sources
        if (_batchSources.length > 20) {
            batchWarning.style.display = "";
            batchConfirm.style.display = "none";
            batchCancel.textContent = "关闭";
            batchSourceList.style.display = "none";
            batchCount.textContent = `共 ${_batchSources.length} 个数据源`;
            batchVariantLabel.textContent = VARIANT_LABELS[variant] || variant;
            batchProgress.style.display = "none";
            batchDialog.showModal();
            return;
        }

        // Show confirmation
        batchWarning.style.display = "none";
        batchSourceList.style.display = "";
        batchProgress.style.display = "none";
        batchConfirm.style.display = "";
        batchConfirm.disabled = false;
        batchConfirm.textContent = `🚀 开始生成 (${_batchSources.length})`;
        batchCancel.textContent = "取消";

        batchVariantLabel.textContent = VARIANT_LABELS[variant] || variant;
        batchCount.textContent = _batchInstructions
            ? `将生成 ${_batchSources.length} 个播客音频（含自定义指示）`
            : `将生成 ${_batchSources.length} 个播客音频`;

        // Render source list
        batchSourceList.innerHTML = _batchSources.map((s, i) => {
            const typeLabel = SOURCE_TYPE_LABELS_BATCH[s.typeCode] || "";
            return `
                    <div class="batch-gen-source-item" data-idx="${i}">
                        <span class="source-name">${escHtml(s.title)}</span>
                        <span class="source-type">${typeLabel}</span>
                        <span class="batch-item-status" id="batch-item-${i}"></span>
                    </div>
                `;
        }).join("");

        batchDialog.showModal();
    };

    // Card click → start batch flow without instructions
    $$(".gen-card-batch").forEach(card => {
        card.addEventListener("click", async () => {
            await startBatchFlow(card, null);
        });
    });

    // Confirm — start batch generation
    batchConfirm?.addEventListener("click", async () => {
        if (_batchGenerating || !_batchSources.length || !_batchVariant) return;

        _batchGenerating = true;
        batchConfirm.disabled = true;
        batchConfirm.textContent = "⏳ 生成中...";
        batchProgress.style.display = "";

        let successCount = 0;
        let failCount = 0;

        for (let i = 0; i < _batchSources.length; i++) {
            const source = _batchSources[i];
            const statusEl = $(`#batch-item-${i}`);

            batchOverall.textContent = `正在生成 ${i + 1}/${_batchSources.length}：${source.title}`;
            batchBar.style.width = `${Math.round((i / _batchSources.length) * 100)}%`;
            batchText.textContent = `${source.title}...`;
            if (statusEl) statusEl.textContent = "⏳";

            try {
                const batchLang = $("#gen-lang")?.value || "zh";
                await api.generateArtifact(
                    activeNotebookId,
                    1, // podcast type
                    _batchVariant,
                    _batchInstructions, // custom instructions from prompt modal
                    [source], // single source
                    batchLang
                );
                if (statusEl) statusEl.textContent = "✅";
                successCount++;
            } catch (err) {
                if (statusEl) statusEl.textContent = "❌";
                failCount++;
                console.error(`[Batch Gen] Failed for source "${source.title}":`, err);
            }

            // Small delay between requests to avoid rate limiting
            if (i < _batchSources.length - 1) {
                await new Promise(r => setTimeout(r, 500));
            }
        }

        // Final status
        batchBar.style.width = "100%";
        const summary = failCount
            ? `完成！成功 ${successCount}，失败 ${failCount}`
            : `✅ 全部 ${successCount} 个播客生成请求已提交！`;
        batchOverall.textContent = summary;
        batchText.textContent = summary;
        batchConfirm.textContent = "✅ 已完成";
        batchCancel.textContent = "关闭";
        _batchGenerating = false;

        toast(summary, failCount ? "error" : "success");
    });

    // Cancel / close
    batchCancel?.addEventListener("click", () => {
        if (!_batchGenerating) batchDialog.close();
    });
}

// ═══════════════════════════════════════
// Artifacts — with batch download
// ═══════════════════════════════════════
const STATUS_MAP = {
    1: { label: "生成中", cls: "badge-processing" },
    2: { label: "排队中", cls: "badge-processing" },
    3: { label: "已完成", cls: "badge-completed" },
    4: { label: "失败", cls: "badge-failed" },
};

let currentArtifacts = [];
let artifactSortDir = 0; // 0=none, 1=asc, -1=desc

async function loadArtifacts() {
    const scope = $("#artifact-scope-filter")?.value || "current";
    if (scope === "current" && !activeNotebookId) {
        artifactList.innerHTML = '<div class="empty-state">请先选择一个笔记本</div>';
        return;
    }
    artifactList.innerHTML = '<div class="loading-state"><div class="spinner"></div> 加载制品...</div>';
    try {
        let showNotebook = false;
        if (scope === "current") {
            currentArtifacts = await api.listArtifacts(activeNotebookId);
        } else {
            showNotebook = true;
            let targetNbs = [];
            if (scope === "all") {
                targetNbs = notebooks;
            } else if (scope.startsWith("folder:")) {
                const fp = scope.slice(7);
                targetNbs = notebooks.filter(nb => { const f = folderMap[nb.id]; return f && (f === fp || f.startsWith(fp + "/")); });
            }
            if (!targetNbs.length) { artifactList.innerHTML = '<div class="empty-state">该范围内没有笔记本</div>'; return; }
            artifactList.innerHTML = `<div class="loading-state"><div class="spinner"></div> 加载 ${targetNbs.length} 个笔记本...</div>`;
            currentArtifacts = [];
            const BATCH = 5;
            for (let i = 0; i < targetNbs.length; i += BATCH) {
                const results = await Promise.all(targetNbs.slice(i, i + BATCH).map(async nb => {
                    try { const a = await api.listArtifacts(nb.id); a.forEach(x => x._notebookTitle = nb.title); return a; }
                    catch { return []; }
                }));
                for (const r of results) currentArtifacts.push(...r);
            }
        }
        renderArtifacts(showNotebook);
    } catch (err) {
        artifactList.innerHTML = `<div class="empty-state">❌ ${escHtml(err.message)}</div>`;
    }
}

function renderArtifacts(showNotebook = false) {
    const filterVal = $("#artifact-type-filter")?.value || "all";
    const searchQ = ($("#artifact-search")?.value || "").trim().toLowerCase();

    let filtered = filterVal === "all"
        ? currentArtifacts
        : currentArtifacts.filter(a => String(a.typeCode) === filterVal);

    if (searchQ) {
        filtered = filtered.filter(a => {
            const title = (a.title || "").toLowerCase();
            const nb = (a._notebookTitle || "").toLowerCase();
            return title.includes(searchQ) || nb.includes(searchQ);
        });
    }

    // Sort by name if active
    if (artifactSortDir !== 0) {
        filtered = [...filtered].sort((a, b) => {
            const na = (a.title || "").toLowerCase();
            const nb = (b.title || "").toLowerCase();
            return artifactSortDir * na.localeCompare(nb, "zh");
        });
    }

    const countEl = $("#artifact-count");
    if (countEl) {
        countEl.textContent = (filterVal !== "all" || searchQ)
            ? `${filtered.length} / ${currentArtifacts.length}`
            : `共 ${currentArtifacts.length} 个制品`;
    }

    if (!filtered.length) {
        artifactList.innerHTML = (filterVal === "all" && !searchQ)
            ? '<div class="empty-state">暂无制品，前往「生成」创建</div>'
            : '<div class="empty-state">没有匹配的制品</div>';
        return;
    }

    const TYPE_ICONS_ART = { 1: "🎙️", 2: "📝", 3: "🎬", 4: "❓", 5: "🧠", 7: "🖼️", 8: "📊", 9: "📋" };

    const rows = filtered.map(a => {
        const typeLabel = TYPE_LABELS[a.typeCode] || `类型 ${a.typeCode}`;
        const typeIcon = TYPE_ICONS_ART[a.typeCode] || "📦";
        const canDownload = a.status === 3 && (a.downloadUrl || a.reportContent);
        const nbCell = showNotebook && a._notebookTitle ? escHtml(a._notebookTitle) : "—";
        return `<tr data-id="${a.id}" data-type="${a.typeCode}">
          <td><input type="checkbox" class="art-checkbox art-row-check" data-id="${a.id}"></td>
          <td><div class="art-name-cell"><span class="art-name-icon">${typeIcon}</span><span class="art-name-text" title="${escHtml(a.title || typeLabel)}">${escHtml(a.title || typeLabel)}</span></div></td>
          <td><span class="art-nb-text">${nbCell}</span></td>
          <td><span class="art-type-badge" data-type="${a.typeCode}">${typeLabel}</span></td>
          <td><div class="art-actions-cell">
            <button class="art-action-btn art-btn-rename" data-id="${a.id}" title="重命名">✏️</button>
            ${a.downloadUrl ? `<button class="art-action-btn art-btn-view" data-url="${a.downloadUrl}" title="查看">👁️</button>` : ''}
            ${canDownload ? `<button class="art-action-btn art-btn-dl" data-id="${a.id}" title="下载">⬇️</button>` : ''}
            <button class="art-action-btn art-btn-del danger" data-id="${a.id}" title="删除">🗑</button>
          </div></td>
        </tr>`;
    }).join("");

    const sortArrow = artifactSortDir === 1 ? ' ▲' : artifactSortDir === -1 ? ' ▼' : '';
    artifactList.innerHTML = `<table class="art-table"><thead><tr>
      <th style="width:40px"><input type="checkbox" class="art-checkbox" id="art-select-all" title="全选"></th>
      <th class="art-th-sortable" id="art-sort-name">Aa Name${sortArrow}</th><th>Notebook</th><th>Type</th><th>Actions</th>
    </tr></thead><tbody>${rows}</tbody></table>`;

    // Sort click handler
    $("#art-sort-name")?.addEventListener("click", () => {
        artifactSortDir = artifactSortDir === 1 ? -1 : 1;
        renderArtifacts(showNotebook);
    });

    // Select-all checkbox
    const selectAll = $("#art-select-all");
    const getRowChecks = () => artifactList.querySelectorAll(".art-row-check");
    if (selectAll) {
        selectAll.addEventListener("change", () => {
            getRowChecks().forEach(cb => cb.checked = selectAll.checked);
        });
    }
    getRowChecks().forEach(cb => {
        cb.addEventListener("change", () => {
            const all = getRowChecks();
            const checked = [...all].filter(c => c.checked);
            if (selectAll) {
                selectAll.checked = checked.length === all.length;
                selectAll.indeterminate = checked.length > 0 && checked.length < all.length;
            }
        });
    });

    // Download individual
    artifactList.querySelectorAll(".art-btn-dl").forEach(btn => {
        btn.addEventListener("click", () => {
            const a = currentArtifacts.find(x => x.id === btn.dataset.id);
            if (a) downloadArtifact(a);
        });
    });

    // View (open URL)
    artifactList.querySelectorAll(".art-btn-view").forEach(btn => {
        btn.addEventListener("click", () => window.open(btn.dataset.url, "_blank"));
    });

    // Rename
    artifactList.querySelectorAll(".art-btn-rename").forEach(btn => {
        btn.addEventListener("click", async () => {
            const a = currentArtifacts.find(x => x.id === btn.dataset.id);
            if (!a) return;
            const newTitle = prompt("重命名制品：", a.title || "");
            if (newTitle === null || newTitle.trim() === "" || newTitle === a.title) return;
            try {
                await api.renameArtifact(activeNotebookId, a.id, newTitle.trim());
                a.title = newTitle.trim();
                renderArtifacts(showNotebook);
                toast("重命名成功", "success");
            } catch (err) {
                toast(`重命名失败: ${err.message}`, "error");
            }
        });
    });

    // Delete individual
    artifactList.querySelectorAll(".art-btn-del").forEach(btn => {
        btn.addEventListener("click", async () => {
            const a = currentArtifacts.find(x => x.id === btn.dataset.id);
            if (!a) return;
            if (!confirm(`确定删除制品「${a.title || "未命名"}」？`)) return;
            try {
                await api.deleteArtifact(activeNotebookId, a.id);
                currentArtifacts = currentArtifacts.filter(x => x.id !== a.id);
                renderArtifacts(showNotebook);
                toast("删除成功", "success");
            } catch (err) {
                toast(`删除失败: ${err.message}`, "error");
            }
        });
    });
}

// Artifact type filter
$("#artifact-type-filter")?.addEventListener("change", () => renderArtifacts());

// Artifact search
$("#artifact-search")?.addEventListener("input", () => renderArtifacts());

// Artifact scope filter
$("#artifact-scope-filter")?.addEventListener("change", () => {
    currentArtifacts = [];
    loadArtifacts();
});

async function downloadArtifact(a) {
    const typeLabel = TYPE_LABELS[a.typeCode] || "制品";
    const basename = sanitizeFilename(a.title || typeLabel);

    if (a.reportContent) {
        downloadTextFile(`${basename}.md`, a.reportContent);
        toast("报告已下载", "success");
    } else if (a.downloadUrl) {
        try {
            // Fetch the file first to create a same-origin blob URL
            // (cross-origin <a download> is ignored by browsers)
            const resp = await fetch(a.downloadUrl);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const blob = await resp.blob();
            const blobUrl = URL.createObjectURL(blob);

            const link = document.createElement("a");
            link.href = blobUrl;
            // Detect file extension from content type
            const ct = resp.headers.get("content-type") || "";
            let ext = "";
            if (ct.includes("audio/")) ext = ct.includes("wav") ? ".wav" : ".mp3";
            else if (ct.includes("video/")) ext = ".mp4";
            else if (ct.includes("pdf")) ext = ".pdf";
            link.download = basename + ext;
            document.body.appendChild(link);
            link.click();
            link.remove();
            // Revoke after a short delay to ensure download starts
            setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
            toast(`${typeLabel}已开始下载`, "success");
        } catch (err) {
            console.error(`[Download] Failed to download "${a.title}":`, err);
            // Fallback: open in new tab
            window.open(a.downloadUrl, "_blank");
            toast(`${typeLabel}下载中（已在新标签打开）`, "success");
        }
    }
}


// ── Podcast publish (sidebar panel) ──
{
    const audioList = $("#podcast-audio-list");
    const audioInfo = $("#podcast-audio-info");
    const channelListEl = $("#podcast-channel-list");
    const noAudioMsg = $("#podcast-no-audio");
    const formArea = $("#podcast-form-area");

    const progressDiv = $("#podcast-progress");
    const progressBar = $("#podcast-progress-bar");
    const progressText = $("#podcast-progress-text");
    const overallStatus = $("#podcast-overall-status");
    const selCount = $("#podcast-sel-count");
    const publishBtn = $("#podcast-publish-btn");

    let podcastArtifacts = [];
    let podcastChannels = [];
    let podcastConfig = null;
    let isPublishing = false;
    let ppSortKey = null;  // null | 'epNum' | 'format' | 'status' | 'time' | 'sources'
    let ppSortDir = 0;     // 0=none, 1=asc, -1=desc

    // Listen for progress updates from background
    chrome.runtime.onMessage.addListener((msg) => {
        if (msg.type !== "PODCAST_PUBLISH_PROGRESS") return;
        progressDiv.style.display = "";
        progressBar.style.width = `${msg.percent}%`;
        progressText.textContent = msg.text;
    });

    const PP_STATUS_MAP = {
        1: { label: "生成中", cls: "pp-status-processing" },
        2: { label: "排队中", cls: "pp-status-processing" },
        3: { label: "已完成", cls: "pp-status-completed" },
        4: { label: "失败", cls: "pp-status-failed" },
    };

    function updatePublishState() {
        const checkedCount = audioList.querySelectorAll('.pp-row-check:checked').length;
        const completedCount = podcastArtifacts.filter(a => a.status === 3 && a.downloadUrl).length;
        const selectedChannel = document.querySelector('input[name="podcast-channel"]:checked');

        selCount.textContent = `已选 ${checkedCount} / ${completedCount} 个可发布播客`;
        audioInfo.textContent = selectedChannel ? `频道: ${selectedChannel.dataset.title}` : "⚠️ 请选择一个频道";

        const canPublish = checkedCount > 0 && selectedChannel && !isPublishing;
        publishBtn.disabled = !canPublish;
        if (!isPublishing) {
            publishBtn.textContent = `🚀 发布选择的播客 (${checkedCount})`;
        }
    }

    // Helper: get sources for an artifact (same logic as mapping module)
    function ppGetArtifactSources(a) {
        if (a.sourceIds && a.sourceIds.length > 0) {
            const sourceMap = new Map();
            currentSources.forEach(s => sourceMap.set(s.id, s));
            const matched = a.sourceIds.map(sid => sourceMap.get(sid)).filter(Boolean);
            return matched.length > 0 ? matched : currentSources;
        }
        return currentSources;
    }

    // Helper: build source chip HTML
    function ppBuildSourceChips(srcList) {
        return srcList.map(s => {
            const icon = SOURCE_TYPE_ICONS[s.typeCode] || "📎";
            return `<span class="mapping-source-chip"><span class="source-type-icon">${icon}</span>${escHtml(s.title)}</span>`;
        }).join("");
    }

    function renderPodcastTable() {
        if (!podcastArtifacts.length) {
            audioList.innerHTML = '<div class="empty-state">暂无播客制品</div>';
            return;
        }

        // Pre-compute sortable data
        const itemsWithMeta = podcastArtifacts.map((a, i) => {
            const artSources = ppGetArtifactSources(a);
            return { a, origIdx: i, artSources };
        });

        // Sort if active
        if (ppSortKey && ppSortDir !== 0) {
            itemsWithMeta.sort((x, y) => {
                let cmp = 0;
                switch (ppSortKey) {
                    case 'format': cmp = ((x.a.formatType || "").localeCompare(y.a.formatType || "", "zh")); break;
                    case 'status': cmp = (x.a.status || 0) - (y.a.status || 0); break;
                    case 'time': cmp = (x.a.createdAt ? new Date(x.a.createdAt).getTime() : 0) - (y.a.createdAt ? new Date(y.a.createdAt).getTime() : 0); break;
                    case 'sources': cmp = x.artSources.length - y.artSources.length; break;
                }
                return ppSortDir * cmp;
            });
        }

        const rows = itemsWithMeta.map((item, displayIdx) => {
            const { a, origIdx, artSources } = item;
            const i = origIdx;
            const isCompleted = a.status === 3 && a.downloadUrl;
            const st = PP_STATUS_MAP[a.status] || { label: `状态 ${a.status}`, cls: "" };
            const formatLabel = a.formatType ? (FORMAT_TYPE_LABELS[a.formatType] || a.formatType) : "—";
            const timeStr = a.createdAt
                ? new Date(a.createdAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
                : "—";
            const epNum = displayIdx + 1;

            // Build sources column
            const needsCollapse = artSources.length > 1;
            const collapsedCls = needsCollapse ? "collapsed" : "";
            const expandBtn = needsCollapse
                ? `<button class="mapping-expand-btn" data-action="toggle-sources">+${artSources.length - 1} 更多</button>`
                : "";
            const sourcesHtml = ppBuildSourceChips(artSources) + expandBtn;

            return `<tr data-id="${a.id}" data-idx="${i}" id="podcast-item-wrap-${i}" draggable="true" class="pp-draggable-row">
                <td class="pp-drag-handle" title="拖拽排序">⠿</td>
                <td class="pp-ep-num">${epNum}</td>
                <td><input type="checkbox" class="art-checkbox pp-row-check" data-idx="${i}" ${isCompleted ? "checked" : ""} ${isCompleted ? "" : "disabled"}></td>
                <td>
                    <div class="art-name-cell">
                        <span class="art-name-icon">🎙️</span>
                        <span class="art-name-text" title="${escHtml(a.title || `播客 ${i + 1}`)}">${escHtml(a.title || `播客 ${i + 1}`)}</span>
                        <span class="podcast-audio-status" id="podcast-item-status-${i}"></span>
                    </div>
                </td>
                <td><span class="mapping-format-tag">${formatLabel}</span></td>
                <td><span class="pp-status-badge ${st.cls}">${st.label}</span></td>
                <td class="pp-time-cell">${timeStr}</td>
                <td><div class="mapping-sources ${collapsedCls}">${sourcesHtml}</div></td>
            </tr>`;
        }).join("");

        const sortArrow = (key) => ppSortKey === key ? (ppSortDir === 1 ? ' ▲' : ppSortDir === -1 ? ' ▼' : '') : '';

        audioList.innerHTML = `<table class="art-table pp-podcast-table"><thead><tr>
            <th style="width:32px"></th>
            <th style="width:60px">节目序号</th>
            <th style="width:40px"><input type="checkbox" class="art-checkbox" id="pp-select-all" title="全选已完成"></th>
            <th>名称</th>
            <th class="art-th-sortable" data-sort-key="format">格式类型${sortArrow('format')}</th>
            <th class="art-th-sortable" data-sort-key="status">状态${sortArrow('status')}</th>
            <th class="art-th-sortable" data-sort-key="time">创建时间${sortArrow('time')}</th>
            <th class="art-th-sortable" data-sort-key="sources">关联数据源${sortArrow('sources')}</th>
        </tr></thead><tbody>${rows}</tbody></table>`;

        // Sort click handlers
        audioList.querySelectorAll('.art-th-sortable[data-sort-key]').forEach(th => {
            th.addEventListener('click', () => {
                const key = th.dataset.sortKey;
                // Save checked state
                const checkedIds = new Set();
                audioList.querySelectorAll('.pp-row-check:checked').forEach(cb => {
                    const idx = Number(cb.dataset.idx);
                    checkedIds.add(podcastArtifacts[idx]?.id);
                });
                if (ppSortKey === key) {
                    ppSortDir = ppSortDir === 1 ? -1 : ppSortDir === -1 ? 0 : 1;
                    if (ppSortDir === 0) ppSortKey = null;
                } else {
                    ppSortKey = key;
                    ppSortDir = 1;
                }
                renderPodcastTable();
                // Restore checked state
                audioList.querySelectorAll('.pp-row-check').forEach(cb => {
                    const idx = Number(cb.dataset.idx);
                    if (checkedIds.has(podcastArtifacts[idx]?.id)) cb.checked = true;
                });
                updatePublishState();
            });
        });

        // Toggle collapsed sources
        audioList.querySelectorAll("[data-action='toggle-sources']").forEach(btn => {
            btn.addEventListener('click', () => {
                const container = btn.closest('.mapping-sources');
                const isCollapsed = container.classList.toggle('collapsed');
                const count = container.querySelectorAll('.mapping-source-chip').length - 1;
                btn.textContent = isCollapsed ? `+${count} 更多` : '收起';
            });
        });

        // Select-all: only selects completed rows
        const selectAll = $("#pp-select-all");
        const getRowChecks = () => audioList.querySelectorAll(".pp-row-check");
        const getEnabledChecks = () => audioList.querySelectorAll(".pp-row-check:not(:disabled)");

        if (selectAll) {
            selectAll.addEventListener("change", () => {
                getEnabledChecks().forEach(cb => cb.checked = selectAll.checked);
                updatePublishState();
            });
        }

        getRowChecks().forEach(cb => {
            cb.addEventListener("change", () => {
                const enabled = getEnabledChecks();
                const checked = [...enabled].filter(c => c.checked);
                if (selectAll) {
                    selectAll.checked = enabled.length > 0 && checked.length === enabled.length;
                    selectAll.indeterminate = checked.length > 0 && checked.length < enabled.length;
                }
                updatePublishState();
            });
        });

        // ── Drag-and-drop reordering ──
        let dragSrcIdx = null;
        const tbody = audioList.querySelector("tbody");

        tbody.addEventListener("dragstart", (e) => {
            const row = e.target.closest("tr.pp-draggable-row");
            if (!row) return;
            dragSrcIdx = Number(row.dataset.idx);
            row.classList.add("pp-dragging");
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", dragSrcIdx);
        });

        tbody.addEventListener("dragover", (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            const row = e.target.closest("tr.pp-draggable-row");
            if (!row) return;
            // Remove previous indicators
            tbody.querySelectorAll(".pp-drag-over-top, .pp-drag-over-bottom").forEach(r => {
                r.classList.remove("pp-drag-over-top", "pp-drag-over-bottom");
            });
            // Determine if cursor is in top or bottom half of the row
            const rect = row.getBoundingClientRect();
            const midY = rect.top + rect.height / 2;
            if (e.clientY < midY) {
                row.classList.add("pp-drag-over-top");
            } else {
                row.classList.add("pp-drag-over-bottom");
            }
        });

        tbody.addEventListener("dragleave", (e) => {
            const row = e.target.closest("tr.pp-draggable-row");
            if (row) {
                row.classList.remove("pp-drag-over-top", "pp-drag-over-bottom");
            }
        });

        tbody.addEventListener("drop", (e) => {
            e.preventDefault();
            tbody.querySelectorAll(".pp-drag-over-top, .pp-drag-over-bottom").forEach(r => {
                r.classList.remove("pp-drag-over-top", "pp-drag-over-bottom");
            });
            const row = e.target.closest("tr.pp-draggable-row");
            if (!row || dragSrcIdx === null) return;
            let dropIdx = Number(row.dataset.idx);
            if (dropIdx === dragSrcIdx) return;

            // Determine insert position based on cursor position
            const rect = row.getBoundingClientRect();
            const midY = rect.top + rect.height / 2;
            const insertAfter = e.clientY >= midY;

            // Save checked state
            const checkedIds = new Set();
            audioList.querySelectorAll(".pp-row-check:checked").forEach(cb => {
                const idx = Number(cb.dataset.idx);
                checkedIds.add(podcastArtifacts[idx]?.id);
            });

            // Reorder the array
            const [moved] = podcastArtifacts.splice(dragSrcIdx, 1);
            // Recalculate drop index after removal
            let insertIdx = dropIdx;
            if (dragSrcIdx < dropIdx) insertIdx--;
            if (insertAfter) insertIdx++;
            podcastArtifacts.splice(insertIdx, 0, moved);

            // Re-render and restore checked state
            renderPodcastTable();
            audioList.querySelectorAll(".pp-row-check").forEach(cb => {
                const idx = Number(cb.dataset.idx);
                if (checkedIds.has(podcastArtifacts[idx]?.id)) {
                    cb.checked = true;
                }
            });
            updatePublishState();
        });

        tbody.addEventListener("dragend", () => {
            dragSrcIdx = null;
            tbody.querySelectorAll(".pp-dragging, .pp-drag-over-top, .pp-drag-over-bottom").forEach(r => {
                r.classList.remove("pp-dragging", "pp-drag-over-top", "pp-drag-over-bottom");
            });
        });
    }

    function renderChannelList() {
        if (!podcastChannels.length) {
            channelListEl.innerHTML = '<div class="pp-channel-empty">⚠️ 未发现频道，请点击“频道管理”新建一个频道</div>';
            return;
        }
        channelListEl.innerHTML = podcastChannels.map(ch => {
            const coverHtml = ch.coverUrl
                ? `<img class="pp-channel-cover" src="${escHtml(ch.coverUrl)}" alt="">`
                : `<div class="pp-channel-cover pp-channel-cover-placeholder">📻</div>`;
            return `
            <label class="pp-channel-card">
                <input type="radio" name="podcast-channel" value="${ch.id}" data-title="${escHtml(ch.title)}">
                ${coverHtml}
                <div class="pp-channel-info">
                    <div class="pp-channel-title">${escHtml(ch.title)}</div>
                    <div class="pp-channel-meta">
                        ${ch.author ? `<span>${escHtml(ch.author)}</span>` : ''}
                        ${ch.category ? `<span>${escHtml(ch.category)}</span>` : ''}
                    </div>
                </div>
                <div class="pp-channel-actions">
                    <button class="pp-ch-action-btn" data-action="manage" data-id="${ch.id}" title="管理内容">📁</button>
                    <button class="pp-ch-action-btn" data-action="copy-rss" data-id="${ch.id}" title="复制 RSS 链接">📋</button>
                    <button class="pp-ch-action-btn" data-action="edit" data-id="${ch.id}" title="编辑频道">✏️</button>
                    <button class="pp-ch-action-btn pp-ch-action-danger" data-action="delete" data-id="${ch.id}" title="删除频道">🗑️</button>
                </div>
            </label>`;
        }).join("");

        // Auto-select first channel
        const firstRadio = channelListEl.querySelector('input[type="radio"]');
        if (firstRadio) firstRadio.checked = true;

        channelListEl.querySelectorAll('input[type="radio"]').forEach(r => {
            r.addEventListener("change", updatePublishState);
        });

        // Handle broken cover images
        channelListEl.querySelectorAll('.pp-channel-cover').forEach(img => {
            if (img.tagName === 'IMG') {
                img.addEventListener('error', () => { img.style.display = 'none'; });
            }
        });

        // Action button handlers
        channelListEl.querySelectorAll('.pp-ch-action-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                const action = btn.dataset.action;
                const chId = btn.dataset.id;
                const ch = podcastChannels.find(c => c.id === chId);
                if (!ch) return;

                if (action === 'manage' || action === 'edit') {
                    const dialog = $("#pp-channel-dialog");
                    dialog?.showModal();
                    // Send command to iframe to open the specific dialog
                    const iframe = $("#podcast-channel-iframe");
                    const iframeAction = action === 'manage' ? 'open-manage' : 'open-edit';
                    // Wait briefly for iframe to be ready
                    setTimeout(() => {
                        iframe?.contentWindow?.postMessage(
                            { source: 'podcast-publish', action: iframeAction, channelId: chId },
                            '*'
                        );
                    }, 300);
                } else if (action === 'copy-rss') {
                    const cdnBase = podcastConfig?.cdnDomain?.replace(/\/+$/, '') || '';
                    const rssUrl = cdnBase ? `${cdnBase}/${ch.xmlPath}` : ch.xmlPath;
                    try {
                        await navigator.clipboard.writeText(rssUrl);
                        toast(`已复制 RSS 链接`, "success");
                    } catch {
                        toast("复制失败，请手动复制", "error");
                    }
                } else if (action === 'delete') {
                    if (!confirm(`确定要删除频道「${ch.title}」吗？\n（OSS 上的文件不会被删除）`)) return;
                    podcastChannels = podcastChannels.filter(c => c.id !== chId);
                    await chrome.storage.local.set({ podcast_channels: podcastChannels });
                    renderChannelList();
                    updatePublishState();
                    toast(`已删除频道「${ch.title}」`, "success");
                }
            });
        });
    }

    async function loadPodcastPublishPanel() {
        if (!activeNotebookId) {
            noAudioMsg.style.display = "";
            noAudioMsg.textContent = "⚠️ 请先选择一个笔记本";
            formArea.style.display = "none";
            return;
        }

        // Fetch artifacts and sources if empty
        if (!currentArtifacts.length || !currentSources.length) {
            noAudioMsg.style.display = "";
            noAudioMsg.textContent = "⏳ 加载播客中...";
            formArea.style.display = "none";
            try {
                const [artifacts, sources] = await Promise.all([
                    currentArtifacts.length ? currentArtifacts : api.listArtifacts(activeNotebookId),
                    currentSources.length ? currentSources : api.listSources(activeNotebookId),
                ]);
                currentArtifacts = artifacts;
                if (!currentSources.length) currentSources = sources;
            } catch (e) {
                noAudioMsg.textContent = "❌ 加载制品失败: " + e.message;
                return;
            }
        }

        // Show ALL podcast artifacts (typeCode 1), sorted by creation time ascending (oldest = Ep 1)
        podcastArtifacts = currentArtifacts.filter(
            a => a.typeCode === 1
        ).sort((a, b) => {
            const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            return ta - tb;
        });

        if (!podcastArtifacts.length) {
            noAudioMsg.style.display = "";
            noAudioMsg.textContent = "⚠️ 没有找到播客制品，请先生成播客";
            formArea.style.display = "none";
            return;
        }

        noAudioMsg.style.display = "none";
        formArea.style.display = "";
        progressDiv.style.display = "none";
        isPublishing = false;

        // Render podcast table
        renderPodcastTable();

        // Load channels from background
        try {
            const resp = await chrome.runtime.sendMessage({ type: "LOAD_PODCAST_CONFIG" });
            podcastChannels = resp?.ok && resp.channels?.length ? resp.channels : [];
            podcastConfig = resp?.ok ? resp.config : null;
        } catch {
            podcastChannels = [];
        }
        renderChannelList();
        updatePublishState();
    }

    // Expose correctly to window so it can be called from the sidebar routing
    window.loadPodcastPublishPanel = loadPodcastPublishPanel;

    // Listen for storage changes to update the channel list
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === "local" && changes["podcast_channels"] && $("#panel-podcast-publish")?.classList.contains("active")) {
            podcastChannels = changes["podcast_channels"].newValue || [];
            const prevSelected = document.querySelector('input[name="podcast-channel"]:checked')?.value;
            renderChannelList();
            // Restore previous selection if still available
            if (prevSelected) {
                const radio = channelListEl.querySelector(`input[value="${prevSelected}"]`);
                if (radio) radio.checked = true;
            }
            updatePublishState();
        }
    });

    // Publish button — batch publish selected podcasts
    publishBtn?.addEventListener("click", async () => {
        const checkboxes = audioList.querySelectorAll('.pp-row-check:checked');
        const selected = [...checkboxes].map(cb => podcastArtifacts[Number(cb.dataset.idx)]);
        if (!selected.length) return;

        const selectedChannel = document.querySelector('input[name="podcast-channel"]:checked');
        const currentChannelId = selectedChannel?.value;
        if (!currentChannelId) {
            toast("请选择一个频道", "error");
            return;
        }

        isPublishing = true;
        publishBtn.disabled = true;
        publishBtn.textContent = "⏳ 发布中...";
        progressDiv.style.display = "";

        // Open a persistent port to keep the service worker alive
        const port = chrome.runtime.connect({ name: "podcast-publish" });

        let successCount = 0;
        let failCount = 0;
        const failedItems = [];
        const publishResults = []; // { title, epNum, action, ok }

        for (let i = 0; i < selected.length; i++) {
            const artifact = selected[i];
            const idx = podcastArtifacts.indexOf(artifact);
            // Get the display-order episode number from the rendered table (reflects sorting)
            const epNumCell = audioList.querySelector(`#podcast-item-wrap-${idx} .pp-ep-num`);
            const epNum = epNumCell ? parseInt(epNumCell.textContent, 10) : (idx + 1);
            const statusEl = $(`#podcast-item-status-${idx}`);
            const wrapEl = $(`#podcast-item-wrap-${idx}`);

            overallStatus.textContent = `正在发布 ${i + 1}/${selected.length}：${artifact.title || "播客"}`;
            if (statusEl) statusEl.textContent = "⏳";
            progressBar.style.width = `${Math.round((i / selected.length) * 100)}%`;

            // Remove any previous error message
            wrapEl?.querySelector(".podcast-audio-error")?.remove();

            try {
                // Send publish via port and wait for done/error response
                const doneText = await new Promise((resolve, reject) => {
                    const handler = (msg) => {
                        if (msg.type !== "PODCAST_PUBLISH_PROGRESS") return;
                        progressText.textContent = msg.text;
                        if (msg.state === "done") {
                            port.onMessage.removeListener(handler);
                            resolve(msg.text);
                        } else if (msg.state === "error") {
                            port.onMessage.removeListener(handler);
                            reject(new Error(msg.text));
                        }
                    };
                    port.onMessage.addListener(handler);

                    port.postMessage({
                        type: "PUBLISH_PODCAST",
                        payload: {
                            wavUrl: artifact.downloadUrl,
                            channelId: currentChannelId,
                            title: artifact.title || `播客 ${idx + 1}`,
                            description: "",
                            episodeNumber: epNum,
                        },
                    });
                });

                if (statusEl) statusEl.textContent = "✅";
                successCount++;
                publishResults.push({ title: artifact.title || `播客 ${epNum}`, epNum, action: doneText, ok: true });
            } catch (err) {
                const errMsg = err instanceof Error ? err.message : String(err);
                // Clean up the error prefix (remove leading ❌ if present from background)
                const cleanMsg = errMsg.replace(/^❌\s*/, "");
                if (statusEl) {
                    statusEl.textContent = "❌";
                    statusEl.title = cleanMsg; // tooltip on hover
                }
                failCount++;
                failedItems.push({ title: artifact.title, error: cleanMsg });
                publishResults.push({ title: artifact.title || `播客 ${epNum}`, epNum, action: cleanMsg, ok: false });
                console.error(`[Podcast] Failed to publish "${artifact.title}":`, err);

                // Show inline error message below the item
                if (wrapEl) {
                    const existingErr = wrapEl.querySelector(".podcast-audio-error");
                    if (existingErr) existingErr.remove();
                    const errorTd = wrapEl.querySelector("td:nth-child(2)");
                    if (errorTd) {
                        const errorDiv = document.createElement("div");
                        errorDiv.className = "podcast-audio-error";
                        errorDiv.textContent = cleanMsg;
                        errorTd.appendChild(errorDiv);
                    }
                }
            }
        }

        // Disconnect keepalive port
        try { port.disconnect(); } catch (_) { }

        // Final status with detailed summary
        progressBar.style.width = "100%";
        const headline = failCount
            ? `完成！成功 ${successCount}，失败 ${failCount}`
            : `✅ 全部 ${successCount} 个播客发布成功！`;
        overallStatus.textContent = headline;

        // Build detailed result list
        const detailLines = publishResults.map(r => {
            const icon = r.ok ? "✅" : "❌";
            // Strip emoji prefix from action text for cleaner display
            const actionClean = r.action.replace(/^[✅❌🔍📥🔄📤📝]\s*/, "");
            return `${icon} Ep.${r.epNum}「${r.title}」— ${actionClean}`;
        });
        progressText.innerHTML = detailLines.map(l => escHtml(l)).join("<br>");

        publishBtn.disabled = true;
        isPublishing = false;
        updatePublishState();
    });
}

// ── Channel management dialog ──
{
    const dialog = $("#pp-channel-dialog");
    const openBtn = $("#btn-pp-manage-channels");
    const newBtn = $("#btn-pp-new-channel");
    const closeBtn = $("#btn-pp-close-dialog");
    const iframe = $("#podcast-channel-iframe");

    openBtn?.addEventListener("click", () => dialog?.showModal());
    newBtn?.addEventListener("click", () => {
        dialog?.showModal();
        const nb = notebooks.find(n => n.id === activeNotebookId);
        setTimeout(() => {
            iframe?.contentWindow?.postMessage(
                { source: 'podcast-publish', action: 'open-new', notebookName: nb?.title || '' },
                '*'
            );
        }, 300);
    });
    closeBtn?.addEventListener("click", () => dialog?.close());
    dialog?.addEventListener("click", (e) => {
        if (e.target === dialog) dialog.close();
    });
}

// ── Batch Podcast Rename (in Podcast Publish panel) ──
$("#btn-pp-batch-rename")?.addEventListener("click", async () => {
    if (!activeNotebookId) {
        toast("请先选择一个笔记本", "error");
        return;
    }

    // Ensure data is loaded
    if (!currentArtifacts.length || !currentSources.length) {
        try {
            const [sources, artifacts] = await Promise.all([
                api.listSources(activeNotebookId),
                api.listArtifacts(activeNotebookId),
            ]);
            currentSources = sources;
            currentArtifacts = artifacts;
        } catch (err) {
            toast(`加载数据失败: ${err.message}`, "error");
            return;
        }
    }

    const podcastArts = currentArtifacts.filter(a => a.typeCode === 1);
    if (!podcastArts.length) {
        toast("当前笔记本没有播客类型的制品", "error");
        return;
    }

    const renameList = [];
    for (const a of podcastArts) {
        const rawFormat = a.formatType ? (FORMAT_TYPE_LABELS[a.formatType] || a.formatType) : (TYPE_LABELS[1] || "播客");
        const formatPart = rawFormat.replace(/^\S+\s/, "").trim() || rawFormat;
        const originalName = a.title || (TYPE_LABELS[1] || "播客");
        const newName = `${formatPart}-${originalName}`;
        if (newName !== a.title) {
            renameList.push({ artifact: a, newName, oldName: a.title || "(未命名)" });
        }
    }

    if (!renameList.length) {
        toast("所有播客制品名称已符合规范，无需重命名", "success");
        return;
    }

    if (!confirm(`将重命名 ${renameList.length} 个播客制品，是否继续？`)) return;

    let successCount = 0, failCount = 0;
    const btn = $("#btn-pp-batch-rename");
    const originalText = btn.textContent;
    btn.disabled = true;

    for (let i = 0; i < renameList.length; i++) {
        const { artifact, newName } = renameList[i];
        btn.textContent = `⏳ ${i + 1}/${renameList.length}...`;
        try {
            await api.renameArtifact(activeNotebookId, artifact.id, newName);
            artifact.title = newName;
            successCount++;
        } catch (err) {
            failCount++;
            console.error(`[BatchRename] Failed for "${artifact.id}":`, err);
        }
        if (i < renameList.length - 1) await new Promise(r => setTimeout(r, 300));
    }

    btn.disabled = false;
    btn.textContent = originalText;

    const summary = failCount
        ? `重命名完成！成功 ${successCount}，失败 ${failCount}`
        : `✅ 全部 ${successCount} 个播客制品已重命名`;
    toast(summary, failCount ? "error" : "success");

    // Refresh podcast publish panel
    currentArtifacts = [];
    window.loadPodcastPublishPanel?.();
});

// Batch download selected artifacts (or all if none selected)
$("#btn-download-all-artifacts")?.addEventListener("click", async () => {
    const checks = artifactList.querySelectorAll(".art-row-check:checked");
    let downloadable;
    if (checks.length > 0) {
        const selectedIds = new Set([...checks].map(c => c.dataset.id));
        downloadable = currentArtifacts.filter(a => selectedIds.has(a.id) && a.status === 3 && (a.downloadUrl || a.reportContent));
    } else {
        downloadable = currentArtifacts.filter(a => a.status === 3 && (a.downloadUrl || a.reportContent));
    }
    if (!downloadable.length) {
        toast("没有可下载的已完成制品", "error");
        return;
    }
    toast(`开始下载 ${downloadable.length} 个制品...`);
    for (const a of downloadable) {
        await downloadArtifact(a);
        await sleep(800);
    }
    toast(`已下载 ${downloadable.length} 个制品`, "success");
});

// Batch delete selected artifacts
$("#btn-batch-delete-artifacts")?.addEventListener("click", async () => {
    const checks = artifactList.querySelectorAll(".art-row-check:checked");
    if (!checks.length) {
        toast("请先勾选要删除的制品", "error");
        return;
    }
    const selectedIds = [...checks].map(c => c.dataset.id);
    if (!confirm(`确定删除 ${selectedIds.length} 个制品？此操作不可撤销。`)) return;
    let successCount = 0, failCount = 0;
    for (const id of selectedIds) {
        try {
            await api.deleteArtifact(activeNotebookId, id);
            currentArtifacts = currentArtifacts.filter(x => x.id !== id);
            successCount++;
        } catch { failCount++; }
    }
    renderArtifacts();
    const msg = failCount
        ? `删除完成：成功 ${successCount}，失败 ${failCount}`
        : `✅ 已删除 ${successCount} 个制品`;
    toast(msg, failCount ? "error" : "success");
});

// Refresh
$("#btn-refresh-artifacts")?.addEventListener("click", loadArtifacts);

// ═══════════════════════════════════════
// Mapping Panel — Source ↔ Artifact
// ═══════════════════════════════════════

const MAPPING_TYPE_ICONS = {
    1: "🎙️", 2: "📝", 3: "🎬", 4: "❓", 5: "🧠",
    7: "🖼️", 8: "📊", 9: "📋",
};
const SOURCE_TYPE_ICONS = {
    1: "📄", 2: "📊", 3: "📕", 4: "✏️", 5: "🌐",
    8: "📝", 9: "🎬", 10: "🎵", 11: "📃", 13: "🖼️", 14: "📊", 16: "📋",
};
const FORMAT_TYPE_LABELS = {
    "Deep Dive": "🔍 深入探究", "Brief": "📋 摘要",
    "Critique": "💬 评论", "Debate": "⚔️ 辩论",
    "Detailed": "📑 详细", "Presenter": "🎤 演示",
};

// Populate all scope filter dropdowns with folder options
function populateScopeFilters() {
    ["#mapping-scope-filter", "#source-scope-filter", "#artifact-scope-filter"].forEach(selId => {
        const sel = $(selId);
        if (!sel) return;
        const oldGroup = sel.querySelector("optgroup");
        if (oldGroup) oldGroup.remove();
        if (folders.length) {
            const group = document.createElement("optgroup");
            group.label = "📁 目录";
            for (const f of folders) {
                const opt = document.createElement("option");
                opt.value = `folder:${f}`;
                opt.textContent = `  ${f}`;
                group.appendChild(opt);
            }
            sel.appendChild(group);
        }
    });
}

async function loadMapping() {
    const contentEl = $("#mapping-content");
    const scope = $("#mapping-scope-filter")?.value || "current";

    if (scope === "current" && !activeNotebookId) {
        contentEl.innerHTML = '<div class="empty-state">请先选择一个笔记本</div>';
        return;
    }
    contentEl.innerHTML = '<div class="loading-state"><div class="spinner"></div> 加载映射数据...</div>';

    try {
        let allSources = [];
        let allArtifacts = [];
        let showNotebook = false;

        if (scope === "current") {
            const [sources, artifacts] = await Promise.all([
                currentSources.length ? currentSources : api.listSources(activeNotebookId),
                currentArtifacts.length ? currentArtifacts : api.listArtifacts(activeNotebookId),
            ]);
            if (!currentSources.length) currentSources = sources;
            if (!currentArtifacts.length) currentArtifacts = artifacts;
            allSources = sources;
            allArtifacts = artifacts;
        } else {
            showNotebook = true;
            let targetNotebooks = [];
            if (scope === "all") {
                targetNotebooks = notebooks;
            } else if (scope.startsWith("folder:")) {
                const folderPath = scope.slice(7);
                targetNotebooks = notebooks.filter(nb => {
                    const nbFolder = folderMap[nb.id];
                    return nbFolder && (nbFolder === folderPath || nbFolder.startsWith(folderPath + "/"));
                });
            }
            if (!targetNotebooks.length) {
                contentEl.innerHTML = '<div class="empty-state">该范围内没有笔记本</div>';
                return;
            }
            contentEl.innerHTML = `<div class="loading-state"><div class="spinner"></div> 加载 ${targetNotebooks.length} 个笔记本数据...</div>`;
            const BATCH = 5;
            for (let i = 0; i < targetNotebooks.length; i += BATCH) {
                const batch = targetNotebooks.slice(i, i + BATCH);
                const results = await Promise.all(batch.map(async nb => {
                    try {
                        const [src, art] = await Promise.all([
                            api.listSources(nb.id),
                            api.listArtifacts(nb.id),
                        ]);
                        src.forEach(s => s._notebookTitle = nb.title);
                        art.forEach(a => a._notebookTitle = nb.title);
                        return { sources: src, artifacts: art };
                    } catch { return { sources: [], artifacts: [] }; }
                }));
                for (const r of results) {
                    allSources.push(...r.sources);
                    allArtifacts.push(...r.artifacts);
                }
            }
        }

        const completed = allArtifacts.filter(a => a.status === 3).length;
        const processing = allArtifacts.filter(a => a.status === 1 || a.status === 2).length;
        $("#mapping-source-count").textContent = allSources.length;
        $("#mapping-artifact-count").textContent = allArtifacts.length;
        $("#mapping-completed-count").textContent = completed;
        $("#mapping-processing-count").textContent = processing;

        renderMapping(allSources, allArtifacts, showNotebook);
    } catch (err) {
        contentEl.innerHTML = `<div class="empty-state">❌ ${escHtml(err.message)}</div>`;
    }
}

function renderMapping(sources, artifacts, showNotebook = false) {
    const contentEl = $("#mapping-content");

    if (!artifacts.length) {
        contentEl.innerHTML = '<div class="empty-state">暂无制品，前往「生成」创建</div>';
        return;
    }

    // Build a quick lookup: sourceId → source object
    const sourceMap = new Map();
    sources.forEach(s => sourceMap.set(s.id, s));

    // Helper: build source chips HTML for a list of sources
    function buildSourceChips(srcList) {
        return srcList.map(s => {
            const icon = SOURCE_TYPE_ICONS[s.typeCode] || "📎";
            return `<span class="mapping-source-chip"><span class="source-type-icon">${icon}</span>${escHtml(s.title)}</span>`;
        }).join("");
    }

    // Helper: determine which sources this artifact uses
    function getArtifactSources(a) {
        if (a.sourceIds && a.sourceIds.length > 0) {
            const matched = a.sourceIds.map(sid => sourceMap.get(sid)).filter(Boolean);
            return matched.length > 0 ? matched : sources;
        }
        return sources; // default: all sources
    }

    // Build table rows
    let rows = "";
    for (const a of artifacts) {
        const typeIcon = MAPPING_TYPE_ICONS[a.typeCode] || "📦";
        const typeLabel = TYPE_LABELS[a.typeCode] || `类型 ${a.typeCode}`;
        const st = STATUS_MAP[a.status] || { label: `状态 ${a.status}`, cls: "" };
        const statusCls = a.status === 3 ? "mapping-status-completed"
            : a.status === 4 ? "mapping-status-failed" : "mapping-status-processing";

        const artSources = getArtifactSources(a);
        const needsCollapse = artSources.length > 1;
        const collapsedCls = needsCollapse ? "collapsed" : "";
        const expandBtn = needsCollapse
            ? `<button class="mapping-expand-btn" data-action="toggle-sources">+${artSources.length - 1} 更多</button>`
            : "";
        const sourcesHtml = buildSourceChips(artSources) + expandBtn;

        const canDownload = a.status === 3 && (a.downloadUrl || a.reportContent);

        const formatLabel = a.formatType ? (FORMAT_TYPE_LABELS[a.formatType] || a.formatType) : "";
        const formatHtml = formatLabel
            ? `<span class="mapping-format-tag">${formatLabel}</span>`
            : `<span class="mapping-format-na">—</span>`;

        const timeStr = a.createdAt
            ? new Date(a.createdAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
            : "—";

        const nbLabel = showNotebook && a._notebookTitle
            ? `<div class="mapping-nb-label">📓 ${escHtml(a._notebookTitle)}</div>`
            : "";

        rows += `<tr data-artifact-id="${a.id}" data-can-download="${canDownload ? '1' : ''}">
            <td>
                <div class="mapping-name-cell">
                    <span class="mapping-name-text">${escHtml(a.title || typeLabel)}</span>
                    <button class="mapping-actions-btn" data-action="show-menu" title="操作">⋯</button>
                </div>
                ${nbLabel}
            </td>
            <td><span class="mapping-type-tag">${typeIcon} ${typeLabel}</span></td>
            <td>${formatHtml}</td>
            <td><span class="mapping-status ${statusCls}">${st.label}</span></td>
            <td><span class="mapping-time">${timeStr}</span></td>
            <td><div class="mapping-sources ${collapsedCls}">${sourcesHtml}</div></td>
        </tr>`;
    }

    contentEl.innerHTML = `
        <div class="mapping-table-wrap">
            <table class="mapping-table">
                <thead>
                    <tr>
                        <th style="width:24%">制品名称<div class="mapping-col-resize"></div></th>
                        <th style="width:8%">类型<div class="mapping-col-resize"></div></th>
                        <th style="width:9%">格式类型<div class="mapping-col-resize"></div></th>
                        <th style="width:7%">状态<div class="mapping-col-resize"></div></th>
                        <th style="width:10%">创建时间<div class="mapping-col-resize"></div></th>
                        <th>关联数据源</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>`;

    // ── Event: toggle collapsed sources ──
    contentEl.querySelectorAll("[data-action='toggle-sources']").forEach(btn => {
        btn.addEventListener("click", () => {
            const container = btn.closest(".mapping-sources");
            const isCollapsed = container.classList.toggle("collapsed");
            const count = container.querySelectorAll(".mapping-source-chip").length - 1;
            btn.textContent = isCollapsed ? `+${count} 更多` : "收起";
        });
    });

    // ── Shared context-menu dropdown (appended to body, positioned at mouse) ──
    let dropdown = document.getElementById("mapping-ctx-menu");
    if (!dropdown) {
        dropdown = document.createElement("div");
        dropdown.id = "mapping-ctx-menu";
        dropdown.className = "mapping-dropdown";
        document.body.appendChild(dropdown);
    }
    let activeArtifactId = null;

    function closeMenu() {
        dropdown.classList.remove("open");
        activeArtifactId = null;
    }

    function showMenu(artId, canDownload, x, y) {
        activeArtifactId = artId;
        dropdown.innerHTML = `
            <button class="mapping-dropdown-item" data-action="rename"><span class="dd-icon">✏️</span>重命名</button>
            ${canDownload ? '<button class="mapping-dropdown-item" data-action="download"><span class="dd-icon">⬇️</span>下载</button>' : ''}
            <button class="mapping-dropdown-item" data-action="info"><span class="dd-icon">ℹ️</span>查看信息</button>
            <button class="mapping-dropdown-item mapping-dropdown-danger" data-action="delete"><span class="dd-icon">🗑️</span>删除</button>
        `;
        // Position at mouse, clamped to viewport
        const menuW = 160, menuH = 180;
        const left = Math.min(x, window.innerWidth - menuW - 8);
        const top = Math.min(y, window.innerHeight - menuH - 8);
        dropdown.style.left = left + "px";
        dropdown.style.top = top + "px";
        dropdown.classList.add("open");

        // Bind actions
        dropdown.querySelector("[data-action='rename']").onclick = () => doRename(artId);
        if (canDownload) dropdown.querySelector("[data-action='download']").onclick = () => doDownload(artId);
        dropdown.querySelector("[data-action='info']").onclick = () => doInfo(artId);
        dropdown.querySelector("[data-action='delete']").onclick = () => doDelete(artId);
    }

    // ── Event: action menu toggle (show at mouse position) ──
    contentEl.querySelectorAll("[data-action='show-menu']").forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            e.preventDefault();
            const row = btn.closest("tr");
            const artId = row.dataset.artifactId;
            const canDownload = row.dataset.canDownload === "1";
            if (activeArtifactId === artId && dropdown.classList.contains("open")) {
                closeMenu();
            } else {
                showMenu(artId, canDownload, e.clientX, e.clientY);
            }
        });
    });

    // ── Dropdown action handlers ──
    async function doRename(artId) {
        const a = currentArtifacts.find(x => x.id === artId);
        if (!a) return;
        const row = contentEl.querySelector(`tr[data-artifact-id="${artId}"]`);
        const nameEl = row?.querySelector(".mapping-name-text");
        const oldTitle = a.title || "";
        const newTitle = prompt("输入新名称：", oldTitle);
        closeMenu();
        if (newTitle === null || !newTitle.trim() || newTitle.trim() === oldTitle) return;
        a.title = newTitle.trim();
        if (nameEl) nameEl.textContent = a.title;
        try {
            await api.renameArtifact(activeNotebookId, artId, a.title);
            toast("已重命名", "success");
            await new Promise(r => setTimeout(r, 500));
            currentSources = []; currentArtifacts = [];
            await loadMapping();
        } catch (err) {
            a.title = oldTitle;
            if (nameEl) nameEl.textContent = oldTitle;
            toast(`重命名失败: ${err.message}`, "error");
        }
    }

    function doDownload(artId) {
        const a = currentArtifacts.find(x => x.id === artId);
        if (a) downloadArtifact(a);
        closeMenu();
    }

    function doInfo(artId) {
        const a = currentArtifacts.find(x => x.id === artId);
        if (!a) return;
        const artSources = getArtifactSources(a);
        const srcNames = artSources.map(s => `  • ${s.title}`).join("\n");
        const info = [
            `制品名称: ${a.title || "(未命名)"}`,
            `ID: ${a.id}`,
            `类型: ${TYPE_LABELS[a.typeCode] || a.typeCode}`,
            `状态: ${(STATUS_MAP[a.status] || {}).label || a.status}`,
            a.downloadUrl ? `下载链接: ${a.downloadUrl.slice(0, 80)}...` : "",
            `\n关联数据源 (${artSources.length}):`,
            srcNames,
        ].filter(Boolean).join("\n");
        alert(info);
        closeMenu();
    }

    async function doDelete(artId) {
        const a = currentArtifacts.find(x => x.id === artId);
        if (!a) return;
        const label = a.title || TYPE_LABELS[a.typeCode] || "制品";
        if (!confirm(`确定要删除「${label}」吗？此操作不可撤销。`)) {
            closeMenu();
            return;
        }
        closeMenu();
        try {
            await api.deleteArtifact(activeNotebookId, artId);
            toast(`已删除「${label}」`, "success");
            currentSources = []; currentArtifacts = [];
            await loadMapping();
        } catch (err) {
            toast(`删除失败: ${err.message}`, "error");
        }
    }

    // ── Column resize handles ──
    initColumnResize(contentEl);

    // Global click to close menu (remove previous listener to avoid accumulation)
    if (renderMapping._closeHandler) {
        document.removeEventListener("click", renderMapping._closeHandler);
    }
    renderMapping._closeHandler = closeMenu;
    document.addEventListener("click", closeMenu);
}

/** Make table columns resizable by dragging header dividers */
function initColumnResize(container) {
    const handles = container.querySelectorAll(".mapping-col-resize");
    handles.forEach(handle => {
        handle.addEventListener("mousedown", (e) => {
            e.preventDefault();
            const th = handle.parentElement;
            const table = th.closest("table");
            const startX = e.pageX;
            const startWidth = th.offsetWidth;

            handle.classList.add("resizing");
            table.style.tableLayout = "fixed";

            // Set initial widths for all th if not set
            if (!th.style.width || th.style.width.endsWith("%")) {
                const ths = [...table.querySelectorAll("thead th")];
                ths.forEach(t => { t.style.width = t.offsetWidth + "px"; });
            }

            function onMouseMove(ev) {
                const diff = ev.pageX - startX;
                th.style.width = Math.max(60, startWidth + diff) + "px";
            }
            function onMouseUp() {
                handle.classList.remove("resizing");
                document.removeEventListener("mousemove", onMouseMove);
                document.removeEventListener("mouseup", onMouseUp);
            }
            document.addEventListener("mousemove", onMouseMove);
            document.addEventListener("mouseup", onMouseUp);
        });
    });
}

// ── Scope filter change ──
$("#mapping-scope-filter")?.addEventListener("change", () => {
    currentSources = [];
    currentArtifacts = [];
    loadMapping();
});

// ═══════════════════════════════════════
// Generate Panel — Existing Artifacts
// ═══════════════════════════════════════

async function loadGenerateArtifacts() {
    const contentEl = $("#gen-artifacts-content");
    if (!contentEl) return;

    if (!activeNotebookId) {
        contentEl.innerHTML = '<div class="empty-state">请先选择一个笔记本</div>';
        return;
    }
    contentEl.innerHTML = '<div class="loading-state"><div class="spinner"></div> 加载制品数据...</div>';

    try {
        const [sources, artifacts] = await Promise.all([
            currentSources.length ? currentSources : api.listSources(activeNotebookId),
            currentArtifacts.length ? currentArtifacts : api.listArtifacts(activeNotebookId),
        ]);
        if (!currentSources.length) currentSources = sources;
        if (!currentArtifacts.length) currentArtifacts = artifacts;

        renderGenerateArtifacts(sources, artifacts);
    } catch (err) {
        contentEl.innerHTML = `<div class="empty-state">❌ ${escHtml(err.message)}</div>`;
    }
}

function renderGenerateArtifacts(sources, artifacts) {
    const contentEl = $("#gen-artifacts-content");
    if (!contentEl) return;

    if (!artifacts.length) {
        contentEl.innerHTML = '<div class="empty-state">暂无制品</div>';
        return;
    }

    const sourceMap = new Map();
    sources.forEach(s => sourceMap.set(s.id, s));

    function buildSourceChips(srcList) {
        return srcList.map(s => {
            const icon = SOURCE_TYPE_ICONS[s.typeCode] || "📎";
            return `<span class="mapping-source-chip"><span class="source-type-icon">${icon}</span>${escHtml(s.title)}</span>`;
        }).join("");
    }

    function getArtifactSources(a) {
        if (a.sourceIds && a.sourceIds.length > 0) {
            const matched = a.sourceIds.map(sid => sourceMap.get(sid)).filter(Boolean);
            return matched.length > 0 ? matched : sources;
        }
        return sources;
    }

    let rows = "";
    for (const a of artifacts) {
        const typeIcon = MAPPING_TYPE_ICONS[a.typeCode] || "📦";
        const typeLabel = TYPE_LABELS[a.typeCode] || `类型 ${a.typeCode}`;
        const st = STATUS_MAP[a.status] || { label: `状态 ${a.status}`, cls: "" };
        const statusCls = a.status === 3 ? "mapping-status-completed"
            : a.status === 4 ? "mapping-status-failed" : "mapping-status-processing";

        const artSources = getArtifactSources(a);
        const needsCollapse = artSources.length > 1;
        const collapsedCls = needsCollapse ? "collapsed" : "";
        const expandBtn = needsCollapse
            ? `<button class="mapping-expand-btn" data-action="toggle-sources">+${artSources.length - 1} 更多</button>`
            : "";
        const sourcesHtml = buildSourceChips(artSources) + expandBtn;

        const formatLabel = a.formatType ? (FORMAT_TYPE_LABELS[a.formatType] || a.formatType) : "";
        const formatHtml = formatLabel
            ? `<span class="mapping-format-tag">${formatLabel}</span>`
            : `<span class="mapping-format-na">—</span>`;

        const timeStr = a.createdAt
            ? new Date(a.createdAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
            : "—";

        rows += `<tr>
            <td><span class="mapping-name-text">${escHtml(a.title || typeLabel)}</span></td>
            <td><span class="mapping-type-tag">${typeIcon} ${typeLabel}</span></td>
            <td>${formatHtml}</td>
            <td><span class="mapping-status ${statusCls}">${st.label}</span></td>
            <td><span class="mapping-time">${timeStr}</span></td>
            <td><div class="mapping-sources ${collapsedCls}">${sourcesHtml}</div></td>
        </tr>`;
    }

    contentEl.innerHTML = `
        <div class="mapping-table-wrap">
            <table class="mapping-table">
                <thead>
                    <tr>
                        <th style="width:24%">制品名称</th>
                        <th style="width:8%">类型</th>
                        <th style="width:9%">格式类型</th>
                        <th style="width:7%">状态</th>
                        <th style="width:10%">创建时间</th>
                        <th>关联数据源</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>`;

    // Toggle collapsed sources
    contentEl.querySelectorAll("[data-action='toggle-sources']").forEach(btn => {
        btn.addEventListener("click", () => {
            const container = btn.closest(".mapping-sources");
            const isCollapsed = container.classList.toggle("collapsed");
            const count = container.querySelectorAll(".mapping-source-chip").length - 1;
            btn.textContent = isCollapsed ? `+${count} 更多` : "收起";
        });
    });
}

$("#btn-refresh-mapping")?.addEventListener("click", () => {
    // Force re-fetch by clearing cached data
    currentSources = [];
    currentArtifacts = [];
    loadMapping();
});

// ── Batch Podcast Rename ──
$("#btn-batch-rename-podcast")?.addEventListener("click", async () => {
    if (!activeNotebookId) {
        toast("请先选择一个笔记本", "error");
        return;
    }

    // Ensure data is loaded
    if (!currentArtifacts.length || !currentSources.length) {
        try {
            const [sources, artifacts] = await Promise.all([
                api.listSources(activeNotebookId),
                api.listArtifacts(activeNotebookId),
            ]);
            currentSources = sources;
            currentArtifacts = artifacts;
        } catch (err) {
            toast(`加载数据失败: ${err.message}`, "error");
            return;
        }
    }

    // Filter podcast artifacts (typeCode === 1)
    const podcastArtifacts = currentArtifacts.filter(a => a.typeCode === 1);
    if (!podcastArtifacts.length) {
        toast("当前笔记本没有播客类型的制品", "error");
        return;
    }

    // Preview rename list
    const renameList = [];
    for (const a of podcastArtifacts) {
        // Use format type (e.g. "深入探究", "摘要") instead of generic "播客"
        const rawFormat = a.formatType ? (FORMAT_TYPE_LABELS[a.formatType] || a.formatType) : (TYPE_LABELS[1] || "播客");
        // Strip emoji prefix if present (e.g. "🔍 深入探究" → "深入探究")
        const formatPart = rawFormat.replace(/^\S+\s/, "").trim() || rawFormat;
        const originalName = a.title || (TYPE_LABELS[1] || "播客");
        const newName = `${formatPart}-${originalName}`;
        if (newName !== a.title) {
            renameList.push({ artifact: a, newName, oldName: a.title || "(未命名)" });
        }
    }

    if (!renameList.length) {
        toast("所有播客制品名称已符合规范，无需重命名", "success");
        return;
    }

    if (!confirm(`将重命名 ${renameList.length} 个播客制品，是否继续？`)) return;

    let successCount = 0;
    let failCount = 0;
    const btn = $("#btn-batch-rename-podcast");
    const originalText = btn.textContent;
    btn.disabled = true;

    for (let i = 0; i < renameList.length; i++) {
        const { artifact, newName } = renameList[i];
        btn.textContent = `⏳ ${i + 1}/${renameList.length}...`;
        try {
            await api.renameArtifact(activeNotebookId, artifact.id, newName);
            artifact.title = newName;
            successCount++;
        } catch (err) {
            failCount++;
            console.error(`[BatchRename] Failed for "${artifact.id}":`, err);
        }
        // Small delay between API calls
        if (i < renameList.length - 1) {
            await new Promise(r => setTimeout(r, 300));
        }
    }

    btn.disabled = false;
    btn.textContent = originalText;

    const summary = failCount
        ? `重命名完成！成功 ${successCount}，失败 ${failCount}`
        : `✅ 全部 ${successCount} 个播客制品已重命名`;
    toast(summary, failCount ? "error" : "success");

    // Refresh mapping
    currentSources = [];
    currentArtifacts = [];
    await loadMapping();
});


// ═══════════════════════════════════════
// Prompt Template Management
// ═══════════════════════════════════════
const PROMPT_TEMPLATES_KEY = "prompt_templates";
let promptTemplates = [];

const PROMPT_CATEGORY_LABELS = {
    "1": "🎙️ 播客",
    "2": "📝 报告",
    "8": "📊 幻灯片",
    "3": "🎬 视频",
    "general": "🌐 通用",
};

async function loadPromptTemplates() {
    const data = await chrome.storage.local.get(PROMPT_TEMPLATES_KEY);
    promptTemplates = data[PROMPT_TEMPLATES_KEY] || [];
}

async function savePromptTemplates() {
    await chrome.storage.local.set({ [PROMPT_TEMPLATES_KEY]: promptTemplates });
}

function renderPromptPanel() {
    const listEl = $("#prompt-list");
    const filterVal = $("#prompt-type-filter")?.value || "all";
    const filtered = filterVal === "all"
        ? promptTemplates
        : promptTemplates.filter(t => t.category === filterVal);

    // Update count
    const countEl = $("#prompt-count");
    if (countEl) {
        countEl.textContent = filterVal === "all"
            ? `共 ${promptTemplates.length} 个`
            : `${filtered.length} / ${promptTemplates.length}`;
    }

    if (!filtered.length) {
        listEl.innerHTML = filterVal === "all"
            ? '<div class="empty-state">暂无提示词模板，点击右上角新建</div>'
            : '<div class="empty-state">该类型暂无模板</div>';
        return;
    }

    // Sort by createdAt desc
    const sorted = [...filtered].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    listEl.innerHTML = sorted.map(t => {
        const catLabel = PROMPT_CATEGORY_LABELS[t.category] || t.category;
        const isGeneral = t.category === "general";
        const dateStr = t.createdAt ? new Date(t.createdAt).toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
        return `
        <div class="prompt-mgmt-card" data-id="${t.id}">
            <div class="prompt-mgmt-card-body">
                <div class="prompt-mgmt-card-header">
                    <span class="prompt-mgmt-card-name">${escHtml(t.name)}</span>
                    <span class="prompt-type-badge${isGeneral ? ' type-general' : ''}">${catLabel}</span>
                </div>
                <div class="prompt-mgmt-card-preview">${escHtml(t.content)}</div>
                <div class="prompt-mgmt-card-meta">${dateStr}</div>
            </div>
            <div class="prompt-mgmt-card-actions">
                <button class="btn btn-ghost btn-sm btn-edit-tpl" title="编辑">✏️</button>
                <button class="btn btn-danger btn-sm btn-del-tpl" title="删除">🗑️</button>
            </div>
        </div>`;
    }).join("");

    // Edit buttons
    listEl.querySelectorAll(".btn-edit-tpl").forEach(btn => {
        btn.addEventListener("click", () => {
            const id = btn.closest(".prompt-mgmt-card").dataset.id;
            const tpl = promptTemplates.find(t => t.id === id);
            if (tpl) openPromptEditor(tpl);
        });
    });

    // Delete buttons
    listEl.querySelectorAll(".btn-del-tpl").forEach(btn => {
        btn.addEventListener("click", async () => {
            const id = btn.closest(".prompt-mgmt-card").dataset.id;
            if (!confirm("确定删除这个提示词模板？")) return;
            promptTemplates = promptTemplates.filter(t => t.id !== id);
            await savePromptTemplates();
            toast("已删除", "success");
            renderPromptPanel();
        });
    });
}

// ── Prompt Editor Dialog ──
{
    const editorDialog = $("#prompt-editor-dialog");
    const editorTitle = $("#prompt-editor-title");
    const editorName = $("#prompt-editor-name");
    const editorCategory = $("#prompt-editor-category");
    const editorContent = $("#prompt-editor-content");
    let _editingId = null;

    window.openPromptEditor = function (tpl) {
        if (tpl) {
            _editingId = tpl.id;
            editorTitle.textContent = "✏️ 编辑提示词模板";
            editorName.value = tpl.name;
            editorCategory.value = tpl.category;
            editorContent.value = tpl.content;
        } else {
            _editingId = null;
            editorTitle.textContent = "✏️ 新建提示词模板";
            editorName.value = "";
            editorCategory.value = "general";
            editorContent.value = "";
        }
        editorDialog.showModal();
        setTimeout(() => editorName.focus(), 50);
    };

    $("#btn-new-prompt")?.addEventListener("click", () => openPromptEditor(null));

    $("#prompt-editor-cancel")?.addEventListener("click", () => editorDialog.close());

    // Close on backdrop click (dialog native)
    editorDialog?.addEventListener("click", (e) => {
        if (e.target === editorDialog) editorDialog.close();
    });

    $("#prompt-editor-save")?.addEventListener("click", async () => {
        const name = editorName.value.trim();
        const category = editorCategory.value;
        const content = editorContent.value.trim();
        if (!name) { toast("请输入模板名称", "error"); return; }
        if (!content) { toast("请输入提示词内容", "error"); return; }

        if (_editingId) {
            const idx = promptTemplates.findIndex(t => t.id === _editingId);
            if (idx >= 0) {
                promptTemplates[idx] = { ...promptTemplates[idx], name, category, content };
            }
        } else {
            promptTemplates.push({
                id: crypto.randomUUID(),
                name,
                category,
                content,
                createdAt: Date.now(),
            });
        }

        await savePromptTemplates();
        editorDialog.close();
        toast(_editingId ? "已更新" : "已创建", "success");
        renderPromptPanel();
    });
}

// ── Prompt filter ──
$("#prompt-type-filter")?.addEventListener("change", () => renderPromptPanel());

// ── Import Template into Prompt Modal ──
{
    const importBtn = $("#prompt-import-btn");
    const importDropdown = $("#prompt-import-dropdown");

    function closeImportDropdown() {
        if (importDropdown) importDropdown.style.display = "none";
    }

    importBtn?.addEventListener("click", async (e) => {
        e.stopPropagation();
        e.preventDefault();

        // Toggle dropdown
        const isOpen = importDropdown.style.display === "block";
        if (isOpen) {
            closeImportDropdown();
            return;
        }

        // Ensure templates loaded
        if (!promptTemplates.length) await loadPromptTemplates();

        // Filter by current type + general
        const typeCode = _pendingPromptType;
        const matching = promptTemplates.filter(t =>
            t.category === "general" || t.category === typeCode
        );

        if (!matching.length) {
            importDropdown.innerHTML = '<div class="prompt-import-empty">暂无匹配的模板，请先在「提示管理」中创建</div>';
        } else {
            importDropdown.innerHTML = matching.map(t => {
                const catLabel = PROMPT_CATEGORY_LABELS[t.category] || t.category;
                const preview = (t.content || "").slice(0, 60).replace(/\n/g, " ");
                return `
                <button class="prompt-import-item" data-id="${t.id}" type="button">
                    <span class="prompt-import-item-name">${escHtml(t.name)}</span>
                    <span class="prompt-type-badge${t.category === 'general' ? ' type-general' : ''}" style="font-size:10px;padding:1px 6px">${catLabel}</span>
                    <span class="prompt-import-item-preview">${escHtml(preview)}…</span>
                </button>`;
            }).join("");
        }

        importDropdown.style.display = "block";

        // Handle selection
        importDropdown.querySelectorAll(".prompt-import-item").forEach(item => {
            item.addEventListener("click", (ev) => {
                ev.stopPropagation();
                const tpl = promptTemplates.find(t => t.id === item.dataset.id);
                if (tpl) {
                    promptInput.value = tpl.content;
                    promptInput.focus();
                    toast(`已导入模板「${tpl.name}」`, "success");
                }
                closeImportDropdown();
            });
        });
    });

    // Close dropdown on outside click
    document.addEventListener("click", (e) => {
        if (importDropdown && !e.target.closest(".prompt-import-bar")) {
            closeImportDropdown();
        }
    });
}

// ═══════════════════════════════════════
// Helpers
// ═══════════════════════════════════════
function escHtml(str) {
    const d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
}

function sanitizeFilename(name) {
    return name.replace(/[/\\?%*:|"<>]/g, "_").slice(0, 100);
}

function downloadTextFile(filename, content) {
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ═══════════════════════════════════════
// Init
// ═══════════════════════════════════════
document.addEventListener("DOMContentLoaded", async () => {
    await loadFolderState();
    populateScopeFilters();
    await loadPromptTemplates();
    loadNotebooks();
});
