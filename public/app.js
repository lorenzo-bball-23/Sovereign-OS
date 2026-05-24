document.addEventListener('DOMContentLoaded', () => {
    // ─────────────────────────────────────────
    // DOM References
    // ─────────────────────────────────────────
    const navLinks = document.querySelectorAll('.nav-links li');
    const views = document.querySelectorAll('.view');
    const settingsBtn = document.getElementById('settings-btn');
    const apiModal = document.getElementById('api-modal');
    const saveApiBtn = document.getElementById('save-api-key');
    const apiKeyInput = document.getElementById('api-key-input');
    const mainInput = document.getElementById('main-input');
    const routeBtns = document.querySelectorAll('.route-btn');
    const sendBtns = document.querySelectorAll('.send-btn');
    const sectionInputs = document.querySelectorAll('.section-input');
    const initOverlay = document.getElementById('init-overlay');
    const initStatus = document.getElementById('init-status');
    const weeklyReportBtn = document.getElementById('weekly-report-btn');

    // ─────────────────────────────────────────
    // State
    // ─────────────────────────────────────────
    let currentApiKey = localStorage.getItem('sovereign_api_key') || '';
    let isInitialized = false;
    let currentChats = { diary: null, relations: null, homework: null };
    let appState = null;

    // ─────────────────────────────────────────
    // Initialization
    // ─────────────────────────────────────────
    if (!currentApiKey) {
        apiModal.classList.remove('hidden');
    } else {
        initializeKernel();
    }

    async function initializeKernel() {
        if (!currentApiKey) return;

        // Check if already initialized
        try {
            const statusRes = await fetch('/api/init/status');
            const statusData = await statusRes.json();
            if (statusData.ready) {
                isInitialized = true;
                loadState();
                return;
            }
        } catch (e) { /* server not ready yet */ }

        // Show init overlay
        initOverlay.classList.remove('hidden');
        initStatus.textContent = 'Building vector index from knowledge base... (first run only)';

        try {
            const res = await fetch('/api/init', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ apiKey: currentApiKey })
            });
            const data = await res.json();

            if (data.error) {
                initStatus.textContent = `Error: ${data.error}`;
                setTimeout(() => initOverlay.classList.add('hidden'), 3000);
                return;
            }

            isInitialized = true;
            initStatus.textContent = `✓ Kernel initialized. ${data.chunks} knowledge chunks indexed.`;
            setTimeout(() => initOverlay.classList.add('hidden'), 1500);
            loadState();
        } catch (e) {
            initStatus.textContent = 'Connection failed. Is the server running? (npm start)';
        }
    }

    async function loadState() {
        try {
            const res = await fetch('/api/state');
            const state = await res.json();
            appState = state;
            renderHomework(state.homework);
            updateMetrics(state.metrics);
            
            if (state.metrics && state.metrics.reports) {
                renderReports(state.metrics.reports);
            }
            
            if (state.threads) {
                // Progress is still a flat array (from earlier version) or we handle it specially
                // Actually in server.js we made all threads nested. Wait, /api/state sends all threads.
                // Let's render chat lists for the sandboxed routes
                ['diary', 'relations', 'homework'].forEach(route => {
                    renderChatList(route, state.threads[route]);
                    
                    // If a chat is selected, re-render it
                    if (currentChats[route] && state.threads[route][currentChats[route]]) {
                        renderChat(route, state.threads[route][currentChats[route]].messages);
                    } else {
                        // clear chat container
                        const container = document.getElementById(`chat-${route}`);
                        if (container) container.innerHTML = '';
                        const wrap = document.getElementById(`chat-container-${route}`);
                        if (wrap && !currentChats[route]) wrap.classList.add('hidden');
                    }
                });
                
                // Progress is a special case since we didn't add a sandbox UI for it, but the data is nested.
                // We'll just flatten it for the Mirror view, or we can use the 'archive' or latest chat.
                // To keep it simple, we'll flatten all progress messages and sort by time.
                const progressContainer = document.getElementById('chat-progress');
                if (progressContainer && state.threads['progress']) {
                    progressContainer.innerHTML = '';
                    let allProgMsgs = [];
                    Object.values(state.threads['progress']).forEach(c => allProgMsgs.push(...c.messages));
                    allProgMsgs.sort((a,b) => new Date(a.timestamp) - new Date(b.timestamp));
                    allProgMsgs.forEach(msg => renderMessage('progress', msg.text, msg.role));
                }
            }
        } catch (e) {
            console.error('Failed to load state:', e);
        }
    }

    // ─────────────────────────────────────────
    // Event Listeners
    // ─────────────────────────────────────────
    settingsBtn.addEventListener('click', () => {
        apiKeyInput.value = currentApiKey;
        apiModal.classList.remove('hidden');
    });

    saveApiBtn.addEventListener('click', () => {
        const val = apiKeyInput.value.trim();
        if (val) {
            currentApiKey = val;
            localStorage.setItem('sovereign_api_key', val);
            apiModal.classList.add('hidden');
            initializeKernel();
        }
    });

    apiKeyInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') saveApiBtn.click();
    });

    // Navigation
    navLinks.forEach(link => {
        link.addEventListener('click', () => switchView(link.dataset.route));
    });

    // Home routing buttons
    routeBtns.forEach(btn => {
        btn.addEventListener('click', async () => {
            const text = mainInput.value.trim();
            if (!text) return;
            if (!currentApiKey) { apiModal.classList.remove('hidden'); return; }

            const route = btn.dataset.target;
            switchView(route);
            mainInput.value = '';
            
            // If sandbox route, force new session
            if (['diary', 'relations', 'homework'].includes(route)) {
                currentChats[route] = 'chat_' + Date.now();
                document.getElementById(`chat-container-${route}`).classList.remove('hidden');
                document.getElementById(`chat-title-${route}`).textContent = 'New Session';
                document.getElementById(`chat-${route}`).innerHTML = '';
            }
            
            renderMessage(route, text, 'user');
            await sendToKernel(route, text);
        });
    });

    // New Session buttons
    document.querySelectorAll('.new-chat-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const route = btn.dataset.route;
            currentChats[route] = 'chat_' + Date.now();
            
            const containerWrap = document.getElementById(`chat-container-${route}`);
            if (containerWrap) containerWrap.classList.remove('hidden');
            
            const title = document.getElementById(`chat-title-${route}`);
            if (title) title.textContent = 'New Session';
            
            const chatBox = document.getElementById(`chat-${route}`);
            if (chatBox) chatBox.innerHTML = '';
            
            document.querySelectorAll(`#chat-list-${route} li`).forEach(li => li.classList.remove('active'));
        });
    });

    // Section send buttons
    sendBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const route = btn.dataset.route;
            const input = document.querySelector(`.section-input[data-route="${route}"]`);
            const text = input.value.trim();
            if (!text) return;
            if (!currentApiKey) { apiModal.classList.remove('hidden'); return; }

            input.value = '';
            renderMessage(route, text, 'user');
            sendToKernel(route, text);
        });
    });

    // Enter to send in section inputs
    sectionInputs.forEach(input => {
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                const route = input.dataset.route;
                const btn = document.querySelector(`.send-btn[data-route="${route}"]`);
                btn.click();
            }
        });
    });

    // Enter to focus routing in main input
    mainInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            // Default route to diary
            const text = mainInput.value.trim();
            if (!text) return;
            if (!currentApiKey) { apiModal.classList.remove('hidden'); return; }
            switchView('diary');
            mainInput.value = '';
            
            currentChats['diary'] = 'chat_' + Date.now();
            document.getElementById(`chat-container-diary`).classList.remove('hidden');
            document.getElementById(`chat-title-diary`).textContent = 'New Session';
            document.getElementById(`chat-diary`).innerHTML = '';
            
            renderMessage('diary', text, 'user');
            sendToKernel('diary', text);
        }
    });

    // Weekly report
    weeklyReportBtn.addEventListener('click', async () => {
        if (!currentApiKey) { apiModal.classList.remove('hidden'); return; }
        weeklyReportBtn.disabled = true;
        weeklyReportBtn.textContent = 'Generating...';
        renderMessage('progress', '[Requesting Weekly Clinical Report...]', 'user');

        try {
            const res = await fetch('/api/report/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ apiKey: currentApiKey, type: 'Weekly' })
            });
            const data = await res.json();
            if (data.error) {
                renderMessage('progress', `**Report Error:** ${data.error}`, 'model');
            } else {
                renderMessage('progress', data.report, 'report');
            }
        } catch (e) {
            renderMessage('progress', '**Connection Error:** Could not generate report.', 'model');
        }

        weeklyReportBtn.disabled = false;
        weeklyReportBtn.innerHTML = '<i class="ph ph-file-text"></i> Generate Weekly Report';
    });

    // ─────────────────────────────────────────
    // View switching
    // ─────────────────────────────────────────
    function switchView(route) {
        navLinks.forEach(l => l.classList.remove('active'));
        const navItem = document.querySelector(`.nav-links li[data-route="${route}"]`);
        if (navItem) navItem.classList.add('active');

        views.forEach(v => {
            v.classList.remove('active');
            v.classList.add('hidden');
        });
        const targetView = document.getElementById(`view-${route}`);
        if (targetView) {
            targetView.classList.remove('hidden');
            targetView.classList.add('active');
        }
    }

    // ─────────────────────────────────────────
    // Rendering
    // ─────────────────────────────────────────
    function renderMessage(route, text, role) {
        const container = document.getElementById(`chat-${route}`);
        if (!container) return;

        // Remove empty state if present
        const empty = container.querySelector('.empty-state');
        if (empty) empty.remove();

        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${role}`;

        if (typeof marked !== 'undefined') {
            msgDiv.innerHTML = marked.parse(text);
        } else {
            msgDiv.textContent = text;
        }

        container.appendChild(msgDiv);
        container.scrollTop = container.scrollHeight;
    }

    function renderChatList(route, chatsObj) {
        const list = document.getElementById(`chat-list-${route}`);
        if (!list) return;
        list.innerHTML = '';
        
        if (!chatsObj) return;
        
        // Sort by created date desc
        const sorted = Object.entries(chatsObj).sort((a, b) => new Date(b[1].created) - new Date(a[1].created));
        
        sorted.forEach(([id, data]) => {
            const li = document.createElement('li');
            li.textContent = data.title;
            if (currentChats[route] === id) li.classList.add('active');
            
            li.addEventListener('click', () => {
                currentChats[route] = id;
                document.querySelectorAll(`#chat-list-${route} li`).forEach(n => n.classList.remove('active'));
                li.classList.add('active');
                
                document.getElementById(`chat-container-${route}`).classList.remove('hidden');
                document.getElementById(`chat-title-${route}`).textContent = data.title;
                renderChat(route, data.messages);
            });
            
            list.appendChild(li);
        });
    }

    function renderChat(route, messages) {
        const container = document.getElementById(`chat-${route}`);
        if (!container) return;
        container.innerHTML = '';
        messages.forEach(msg => renderMessage(route, msg.text, msg.role));
    }

    function renderReports(reports) {
        const list = document.getElementById('reports-list');
        if (!list) return;
        list.innerHTML = '';
        
        if (!reports || reports.length === 0) {
            list.innerHTML = '<li style="justify-content:center; color:var(--text-muted); border:none; background:transparent;">No checkpoints yet. Generate a report.</li>';
            return;
        }
        
        const sorted = [...reports].sort((a, b) => new Date(b.date) - new Date(a.date));
        sorted.forEach(rep => {
            const li = document.createElement('li');
            const d = new Date(rep.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            li.innerHTML = `<span>${rep.type} Report</span><span class="rep-date">${d}</span>`;
            
            li.addEventListener('click', () => {
                // Show report in the progress chat box as a view
                document.getElementById('chat-progress').innerHTML = '';
                renderMessage('progress', `**${rep.type} Report - ${d}**\n\n${rep.content}`, 'report');
            });
            
            list.appendChild(li);
        });
    }

    function showTypingIndicator(route) {
        const container = document.getElementById(`chat-${route}`);
        if (!container) return;
        const indicator = document.createElement('div');
        indicator.className = 'typing-indicator';
        indicator.id = `typing-${route}`;
        indicator.innerHTML = '<span></span><span></span><span></span>';
        container.appendChild(indicator);
        container.scrollTop = container.scrollHeight;
    }

    function hideTypingIndicator(route) {
        const indicator = document.getElementById(`typing-${route}`);
        if (indicator) indicator.remove();
    }

    function renderHomework(tasks) {
        const list = document.getElementById('homework-list');
        if (!list) return;
        list.innerHTML = '';

        if (!tasks || tasks.length === 0) {
            list.innerHTML = '<li style="color:var(--text-muted);justify-content:center;">No active homework. Use the Lab to generate tasks.</li>';
            return;
        }

        tasks.forEach(task => {
            const li = document.createElement('li');
            const r = Math.min(5, Math.max(1, task.resistance || 3));
            li.innerHTML = `
                <div style="display:flex; align-items:center; gap: 8px; width: 100%;">
                    <span class="resistance r-${r}">R${r}</span>
                    <span class="hw-task-text" style="flex:1;">${task.task}</span>
                    <button class="hw-info-btn" style="background:transparent; border:none; color:var(--accent); font-weight:bold; cursor:pointer;" title="View Rationale">...</button>
                    <button class="hw-complete-btn" data-id="${task.id}" title="Mark as completed">Done</button>
                </div>
                <div class="hw-rationale" style="font-size: 0.85em; color: var(--text-muted); margin-top: 5px; margin-bottom: 5px; padding-left: 35px; border-left: 2px solid var(--accent); display:none;">
                    <em>${task.rationale || "No specific rationale provided."}</em>
                </div>
            `;
            list.appendChild(li);
        });

        // Info toggle buttons
        list.querySelectorAll('.hw-info-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const rationaleDiv = e.target.closest('li').querySelector('.hw-rationale');
                if (rationaleDiv.style.display === 'none') {
                    rationaleDiv.style.display = 'block';
                } else {
                    rationaleDiv.style.display = 'none';
                }
            });
        });

        // Complete buttons
        list.querySelectorAll('.hw-complete-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const id = parseInt(btn.dataset.id);
                
                let easeInput = prompt("Rate the ease of this task (1-10, where 10 is easiest) and add any notes on your experience:", "5");
                if (easeInput === null) return; // User cancelled
                
                const easeValue = parseInt(easeInput) || 5;
                const notes = easeInput.replace(/^\d+\s*/, '').trim() || "";

                try {
                    const res = await fetch('/api/homework/complete', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ taskId: id, ease: easeValue, notes: notes })
                    });
                    const data = await res.json();
                    if (data.success) {
                        renderHomework(data.homework);
                        if (data.metrics) updateMetrics(data.metrics);
                        loadState(); // also refresh full state
                        
                        // Automatically notify the kernel to process completion and generate new tasks
                        const sysMsg = `[TASK COMPLETED]: Task ID ${id} done. Ease rating: ${easeValue}/10. Notes: "${notes}". Please analyze this progress using Schema Therapy principles, and generate new, specific homework tasks based on the complex knowledge base if the active list is getting low.`;
                        renderMessage('homework', sysMsg, 'user');
                        sendToKernel('homework', sysMsg);
                    }
                } catch (e) {
                    console.error('Failed to complete task:', e);
                }
            });
        });
    }

    function updateMetrics(metrics) {
        if (!metrics) return;

        const sovereign = document.getElementById('m-sovereign');
        const completion = document.getElementById('m-completion');
        const depth = document.getElementById('m-depth');
        const logs = document.getElementById('m-logs');
        const progressPct = document.getElementById('progress-pct');
        const progressFill = document.getElementById('progress-fill');

        if (sovereign) sovereign.textContent = metrics.sovereignScore || 0;
        if (completion) completion.textContent = (metrics.taskCompletionRate || 0) + '%';
        if (depth) depth.textContent = metrics.journalingDepth || 0;
        if (logs) logs.textContent = (metrics.weeklyLogs || []).length;
        if (progressPct) progressPct.textContent = (metrics.sovereignScore || 0) + '%';
        if (progressFill) progressFill.style.width = (metrics.sovereignScore || 0) + '%';
    }

    // ─────────────────────────────────────────
    // API Communication
    // ─────────────────────────────────────────
    async function sendToKernel(route, message) {
        showTypingIndicator(route);

        // Progress has no sandbox, but backend expects chatId. Use a default.
        const chatId = route === 'progress' ? 'progress_main' : (currentChats[route] || 'chat_' + Date.now());
        if (route !== 'progress') currentChats[route] = chatId;

        try {
            const res = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message,
                    contextRoute: route,
                    chatId: chatId,
                    apiKey: currentApiKey
                })
            });

            const data = await res.json();
            hideTypingIndicator(route);

            if (data.error) {
                renderMessage(route, `**System Error:** ${data.error}`, 'model');
            } else {
                renderMessage(route, data.reply, 'model');

                // Update homework on home page
                if (data.homework) renderHomework(data.homework);
                if (data.metrics) updateMetrics(data.metrics);
                
                // Refresh state to grab new generated titles or reports
                loadState();
            }
        } catch (err) {
            hideTypingIndicator(route);
            renderMessage(route, `**Connection Error:** Kernel offline. Is the server running?`, 'model');
        }
    }
});
