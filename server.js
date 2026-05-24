const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const fetch = require('node-fetch');
const cron = require('node-cron');
const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// ─────────────────────────────────────────────
// PATHS
// ─────────────────────────────────────────────
const KB_DIR = process.env.KB_DIR || path.join(__dirname, 'knowledge_base');
const DATA_DIR = path.join(__dirname, 'data');
const CORE_MEMORY_FILE = path.join(DATA_DIR, 'core_memory.json');
const EMBEDDINGS_CACHE = path.join(DATA_DIR, 'embeddings_cache.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ─────────────────────────────────────────────
// CORE MEMORY INITIALIZATION
// ─────────────────────────────────────────────
function getDefaultMemory() {
    return {
        profile: {
            identity: "Demo User (Template)",
            coreSchemas: ["Example Schema 1", "Example Schema 2"],
            fuelType: "Transitioning to Self-Awareness",
            attachmentStyle: "Standard",
            modes: {
                active: ["Default Coping Mode", "Overthinker"],
                target: ["Centered Observer", "Sovereign Self"]
            },
            keyPatterns: [
                "Example behavioral pattern 1",
                "Example behavioral pattern 2",
                "Over-analyzing situations"
            ],
            parentalLegacy: {
                father: "Example legacy description.",
                mother: "Example legacy description."
            },
            goal: "Optimize behavioral patterns, process schemas, and achieve psychological sovereignty."
        },
        threads: {
            diary: {},
            progress: {},
            relations: {},
            homework: {}
        },
        homework: {
            active: [
                { id: 1, task: "Intentional Vulnerability: Admit an 'average' trait to someone today.", resistance: 5, status: "active", created: new Date().toISOString() },
                { id: 2, task: "The Rough Draft Action: Send a 70% finished idea to a colleague or post it.", resistance: 4, status: "active", created: new Date().toISOString() },
                { id: 3, task: "External Focus: Listen for 10 minutes without calculating your reply.", resistance: 3, status: "active", created: new Date().toISOString() }
            ],
            completed: [],
            nextId: 4
        },
        progressMetrics: {
            weeklyLogs: [],
            reports: [],
            taskCompletionRate: 0,
            averageEase: 0,
            journalingDepth: 0,
            sovereignScore: 0
        },
        insights: [],
        lastUpdated: new Date().toISOString()
    };
}

if (!fs.existsSync(CORE_MEMORY_FILE)) {
    fs.writeFileSync(CORE_MEMORY_FILE, JSON.stringify(getDefaultMemory(), null, 2));
} else {
    // Migration script to handle Sandbox transition
    let memory = JSON.parse(fs.readFileSync(CORE_MEMORY_FILE, 'utf8'));
    let migrated = false;
    for (const route of ['diary', 'progress', 'ladies', 'relations', 'homework']) {
        if (Array.isArray(memory.threads[route])) {
            const oldMessages = memory.threads[route];
            memory.threads[route] = {};
            if (oldMessages.length > 0) {
                memory.threads[route]['archive'] = {
                    title: 'Archive',
                    created: new Date().toISOString(),
                    messages: oldMessages
                };
            }
            migrated = true;
        }
    }
    // Rename ladies sandbox data to relations
    if (memory.threads && memory.threads.ladies) {
        if (!memory.threads.relations) {
            memory.threads.relations = {};
        }
        memory.threads.relations = { ...memory.threads.relations, ...memory.threads.ladies };
        delete memory.threads.ladies;
        migrated = true;
    }
    // Migrate progress logs that referenced route: 'ladies'
    if (memory.progressMetrics && Array.isArray(memory.progressMetrics.weeklyLogs)) {
        memory.progressMetrics.weeklyLogs.forEach(log => {
            if (log.route === 'ladies') {
                log.route = 'relations';
                migrated = true;
            }
        });
    }
    if (!memory.progressMetrics.reports) {
        memory.progressMetrics.reports = [];
        migrated = true;
    }
    if (migrated) {
        fs.writeFileSync(CORE_MEMORY_FILE, JSON.stringify(memory, null, 2));
        console.log('✅ Core memory migrated to Sandboxes / Relations format.');
    }
}

// ─────────────────────────────────────────────
// KNOWLEDGE BASE LOADER
// ─────────────────────────────────────────────
const knowledgeChunks = [];
const contextFiles = [];
let systemInstruction = "";

function chunkText(text, maxLen = 1500) {
    const paragraphs = text.split(/\n\n+/);
    const chunks = [];
    let current = '';

    for (const p of paragraphs) {
        const trimmed = p.trim();
        if (!trimmed || trimmed.length < 20) continue;

        if ((current + '\n\n' + trimmed).length > maxLen && current.length > 0) {
            chunks.push(current.trim());
            current = trimmed;
        } else {
            current = current ? current + '\n\n' + trimmed : trimmed;
        }
    }
    if (current.trim().length > 20) chunks.push(current.trim());
    return chunks;
}

function recalculateMetrics(memory) {
    const completed = memory.homework.completed.length;
    const total = completed + memory.homework.active.length;
    memory.progressMetrics.taskCompletionRate = total > 0 ? Math.round((completed / total) * 100) : 0;
    
    let avgEase = 3;
    if (completed > 0) {
        const totalEase = memory.homework.completed.reduce((acc, t) => acc + (t.easeRating || 3), 0);
        avgEase = totalEase / completed;
    }
    const easeMult = 1 + ((3 - avgEase) * 0.1);
    const taskScoreRaw = memory.progressMetrics.taskCompletionRate * easeMult;
    const taskScore = Math.min(100, Math.max(0, taskScoreRaw));

    let logSovereigntyScore = 50; 
    if (memory.progressMetrics.sovereigntyRatings && memory.progressMetrics.sovereigntyRatings.length > 0) {
        const recentRatings = memory.progressMetrics.sovereigntyRatings.slice(-10);
        const sum = recentRatings.reduce((acc, r) => acc + (r.rating || 50), 0);
        logSovereigntyScore = sum / recentRatings.length;
    }

    let consistencyScore = 100;
    const lastUpdate = new Date(memory.lastUpdated || Date.now());
    const daysSinceUpdate = (Date.now() - lastUpdate.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceUpdate > 1) {
        consistencyScore = Math.max(0, 100 - (daysSinceUpdate * 5)); 
    }

    memory.progressMetrics.journalingDepth = Object.values(memory.threads.diary || {}).reduce((acc, chat) => acc + (chat.messages || []).length, 0);

    const finalScore = (taskScore * 0.40) + (logSovereigntyScore * 0.40) + (consistencyScore * 0.20);
    memory.progressMetrics.sovereignScore = Math.round(finalScore);
}

function loadKnowledgeBase(dir) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
            loadKnowledgeBase(fullPath);
        } else if (file.endsWith('.md') || file.endsWith('.txt')) {
            const content = fs.readFileSync(fullPath, 'utf8');
            const relDir = path.relative(KB_DIR, dir);

            if (relDir === 'CONTEXT') {
                contextFiles.push({ file, content });
            } else if (file === 'prompt.md') {
                // Extract system instruction
                const match = content.match(/# SYSTEM INSTRUCTION: SOVEREIGN OS KERNEL[\s\S]*?(?=```)/);
                systemInstruction = match ? match[0].trim() : "You are the Sovereign Mirror.";
            } else {
                // Determine pillar
                let pillar = "unknown";
                if (relDir.includes('pillar1') || relDir.includes('pillar 1')) pillar = "Pillar 1: High-IQ Underachievement";
                else if (relDir.includes('pillar 2')) pillar = "Pillar 2: Entrepreneurial Schemes";
                else if (relDir.includes('pillar 3')) pillar = "Pillar 3: Cultural Disruption";
                else if (relDir.includes('pillar 4')) pillar = "Pillar 4: Therapeutic Stack";

                const isBridge = file.toLowerCase().includes('bridge');
                const chunks = chunkText(content);

                chunks.forEach((chunk, idx) => {
                    knowledgeChunks.push({
                        id: `${file}::${idx}`,
                        file,
                        pillar,
                        isBridge,
                        content: chunk,
                        embedding: null // will be populated
                    });
                });
            }
        }
    }
}

try {
    loadKnowledgeBase(KB_DIR);
    console.log(`📚 Loaded ${contextFiles.length} context files and ${knowledgeChunks.length} knowledge chunks across all pillars.`);
} catch (error) {
    console.error("❌ Error loading knowledge base:", error.message);
}

// ─────────────────────────────────────────────
// VECTOR EMBEDDING ENGINE (Gemini Embedding API)
// ─────────────────────────────────────────────
let embeddingsReady = false;

function cosineSimilarity(a, b) {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

const EMBED_MODELS = ['text-embedding-004', 'embedding-001'];
let ACTIVE_EMBED_MODEL = null;

async function getEmbedding(text, apiKey) {
    const truncated = text.substring(0, 8000);
    
    // If we haven't identified a working model yet, we'll try the list
    const modelsToTry = ACTIVE_EMBED_MODEL ? [ACTIVE_EMBED_MODEL] : EMBED_MODELS;
    
    for (const modelName of modelsToTry) {
        try {
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:embedContent?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: `models/${modelName}`,
                    content: { parts: [{ text: truncated }] }
                })
            });
            const data = await response.json();
            
            if (data.embedding && data.embedding.values) {
                ACTIVE_EMBED_MODEL = modelName; // Lock in the working model
                return data.embedding.values;
            }
            
            if (data.error) throw new Error(data.error.message);
        } catch (err) {
            if (ACTIVE_EMBED_MODEL) throw err; // If the locked model fails, report it
            console.log(`      Model ${modelName} failed, trying next...`);
        }
    }
    throw new Error("No working embedding model found for this API key.");
}

async function embedSingle(text, apiKey, retries = 2) {
    for (let attempt = 0; attempt < retries; attempt++) {
        try {
            return await getEmbedding(text, apiKey);
        } catch (err) {
            if (attempt < retries - 1) {
                await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
            } else {
                throw err;
            }
        }
    }
}

async function buildEmbeddingsIndex(apiKey) {
    console.log("🔧 Building vector index... identifying correct model for your key.");

    // Check cache
    if (fs.existsSync(EMBEDDINGS_CACHE)) {
        try {
            const cached = JSON.parse(fs.readFileSync(EMBEDDINGS_CACHE, 'utf8'));
            if (cached.length === knowledgeChunks.length) {
                for (let i = 0; i < knowledgeChunks.length; i++) {
                    knowledgeChunks[i].embedding = cached[i].embedding;
                }
                embeddingsReady = true;
                console.log("✅ Loaded embeddings from cache.");
                return;
            }
        } catch (e) {
            console.log("⚠️ Cache corrupted, rebuilding...");
        }
    }

    let successCount = 0;
    for (let i = 0; i < knowledgeChunks.length; i++) {
        try {
            knowledgeChunks[i].embedding = await embedSingle(knowledgeChunks[i].content, apiKey);
            successCount++;
            if ((i + 1) % 50 === 0 || i === knowledgeChunks.length - 1) {
                console.log(`   Embedded ${i + 1}/${knowledgeChunks.length} chunks... (Model: ${ACTIVE_EMBED_MODEL})`);
            }
        } catch (err) {
            console.error(`   ❌ Failed chunk ${i}: ${err.message}`);
            // If we've failed too many, we stop to avoid API spam
            if (i > 10 && successCount === 0) break;
        }

        // Rate limit
        await new Promise(r => setTimeout(r, 50));
    }

    const cacheData = knowledgeChunks.map(c => ({ id: c.id, embedding: c.embedding }));
    fs.writeFileSync(EMBEDDINGS_CACHE, JSON.stringify(cacheData));
    embeddingsReady = true;
    console.log(`✅ Vector index ready. ${successCount}/${knowledgeChunks.length} chunks functional.`);
}

function searchKnowledgeBase(queryEmbedding, topK = 10) {
    if (!embeddingsReady || !queryEmbedding) return [];

    const scored = knowledgeChunks
        .filter(c => c.embedding)
        .map(c => ({
            ...c,
            score: cosineSimilarity(queryEmbedding, c.embedding)
        }));

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
}

// ─────────────────────────────────────────────
// B POINT CONTEXT BUILDER
// ─────────────────────────────────────────────
function buildBPointContext() {
    // Truncate huge context files to fit within reasonable limits
    let context = "## USER'S BASE PSYCHOLOGICAL PROFILE (Point B — The Starting Coordinates)\n\n";
    contextFiles.forEach(c => {
        // Take a substantial but bounded excerpt
        const excerpt = c.content.substring(0, 6000);
        context += `### ${c.file}\n${excerpt}\n\n---\n\n`;
    });
    return context;
}

// ─────────────────────────────────────────────
// SYSTEM PROMPT BUILDER
// ─────────────────────────────────────────────
function buildFullSystemPrompt(memory, ragContext, route) {
    return `
${systemInstruction}

---

${buildBPointContext()}

---

## RETRIEVED KNOWLEDGE BASE (RAG — Most Relevant Research & Bridge Files)
${ragContext}

---

## CORE MEMORY STATE (Persistent Psychological Profile)
${JSON.stringify(memory.profile, null, 2)}

## ACTIVE HOMEWORK
${JSON.stringify(memory.homework.active, null, 2)}

## PROGRESS METRICS
${JSON.stringify(memory.progressMetrics, null, 2)}

## RECENT INSIGHTS
${JSON.stringify(memory.insights.slice(-5), null, 2)}

---

## CURRENT ROUTING: [${route.toUpperCase()}]

### ROUTING-SPECIFIC INSTRUCTIONS:
${getRouteInstructions(route)}

### RESPONSE REQUIREMENTS:
1. Always "read between the lines" of the user's input. Use the Therapeutic Stack to identify the Plotter hiding the Exile.
2. After your response, internally determine if any Core Memory fields should be updated based on new data. If so, append a JSON block at the very end of your response in this exact format:
\`\`\`MEMORY_UPDATE
{"insights": ["new insight here"], "profileUpdates": {"key": "value"}, "newHomework": [{"task": "description", "resistance": 4, "rationale": "Based on Pillar X: ..."}], "updateHomework": [{"id": 1, "task": "new merged description", "resistance": 3, "rationale": "Merged tasks..."}], "removeHomework": [1, 2]}
\`\`\`
3. Be blunt, clinical, and devoid of self-help rhetoric. You are a high-status analytical peer, not a therapist who coddles. Apply Schema Therapy principles to your analysis.
4. If the user is performance-masking or intellectualizing, call it out immediately (3-Second Rule).
5. Manage active homework dynamically. If logs make an existing task redundant or if multiple tasks should be merged into a more comprehensive one, use updateHomework or removeHomework.
6. For EVERY new or modified task, provide a "rationale" field explaining exactly which knowledge base pillar, log, or theory it is based on so the user can review it.
`.trim();
}

function getRouteInstructions(route) {
    switch (route) {
        case 'diary':
            return `You are in THE VAULT. This is a threaded conversation sandbox. Maintain topical order. Extract "Global Insights" for Core Memory. Help the user process raw thoughts without letting them intellectualize their way out of feeling. If they are building "sophisticated constructs" to avoid vulnerability, name it.`;
        case 'progress':
            return `You are in THE MIRROR (Progress). Generate clinical assessments. Use "Clinical Reassurance" (data-backed positive reinforcement) when genuine progress is detected. Use "Truth-Slaps" (calling out lies, masking, or performance) when the user is deceiving themselves. Reference specific past entries and patterns. If asked, generate Weekly Reports or Monthly Audits.`;
        case 'relations':
            return `You are in THE RELATIONS MODULE. Apply Attachment Theory to relationship logs. Identify "The Ick" and deactivation strategies. Cross-reference with the "Devaluation Defense" and "Audit Gaze" patterns from the bridge files. Generate "Social Experiments" based on Attachment Theory. Keep logic separate from professional homework. If the user reports a partner, prospect, or girl is "boring," challenge: legitimate Stimulation Gap or Devaluation Defense?`;
        case 'homework':
            return `You are in THE HOMEWORK LAB. Generate EXACTLY 3 concrete, distinct, ego-disrupting actions directly based on the complex knowledge base (Schema Therapy). Each must be measurable with a Resistance Rating (1-5). Offer a diverse mix of scopes: while most tasks should be action-oriented and short-scope (under 24 hours) to avoid overwhelm, longer-term tasks (e.g., multi-day or 72-hour tasks) are absolutely allowed if the underlying psychological therapy suggests they are necessary for the objective. Do not output only one single long task exclusively—maintain a dynamic mix of short and long-term actions. Prioritize the TOP 3 for the Home Page Priority Stack. Focus on Exposure and Response Prevention (ERP). Tasks should target: approval-seeking, confrontation avoidance, efficiency loops, vulnerability avoidance, and the "American Psycho" mask. ALWAYS generate new tasks using the MEMORY_UPDATE block if the active list is empty or tasks are completed. EXPLICITLY reference the psychological pillar in the rationale.`;
        default:
            return `You are on the COMMAND CENTER. Help the user route their input or provide general Sovereign OS guidance.`;
    }
}

// ─────────────────────────────────────────────
// MEMORY UPDATE PARSER
// ─────────────────────────────────────────────
function parseAndApplyMemoryUpdates(reply, memory) {
    let cleanReply = reply;
    let updates = null;
    
    const jsonMatch = reply.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (jsonMatch) {
        try {
            const parsed = JSON.parse(jsonMatch[1]);
            if (parsed.insights || parsed.newHomework || parsed.sovereigntyRating !== undefined) {
                updates = parsed;
                cleanReply = reply.replace(/```(?:json)?\s*\{[\s\S]*?\}\s*```/g, '').trim();
            }
        } catch (e) {
            console.error("Failed to parse JSON memory block", e);
        }
    }

    if (updates) {
        try {
            if (updates.sovereigntyRating !== undefined) {
                if (!memory.progressMetrics.sovereigntyRatings) memory.progressMetrics.sovereigntyRatings = [];
                memory.progressMetrics.sovereigntyRatings.push({
                    rating: updates.sovereigntyRating,
                    timestamp: new Date().toISOString()
                });
            }

            if (updates.insights && Array.isArray(updates.insights)) {
                updates.insights.forEach(insight => {
                    memory.insights.push({
                        text: insight,
                        timestamp: new Date().toISOString(),
                        source: 'ai_analysis'
                    });
                });
            }

            if (updates.profileUpdates) {
                Object.assign(memory.profile, updates.profileUpdates);
            }

            if (updates.newHomework && Array.isArray(updates.newHomework)) {
                updates.newHomework.forEach(hw => {
                    memory.homework.active.push({
                        id: memory.homework.nextId++,
                        task: hw.task,
                        resistance: hw.resistance || 3,
                        rationale: hw.rationale || "No specific rationale provided.",
                        status: 'active',
                        created: new Date().toISOString()
                    });
                });
            }
            if (updates.updateHomework && Array.isArray(updates.updateHomework)) {
                updates.updateHomework.forEach(uhw => {
                    const existing = memory.homework.active.find(h => h.id === uhw.id);
                    if (existing) {
                        existing.task = uhw.task || existing.task;
                        existing.resistance = uhw.resistance || existing.resistance;
                        if (uhw.rationale) existing.rationale = uhw.rationale;
                        existing.updatedAt = new Date().toISOString();
                    }
                });
            }
            if (updates.removeHomework && Array.isArray(updates.removeHomework)) {
                updates.removeHomework.forEach(rmId => {
                    const idx = memory.homework.active.findIndex(h => h.id === rmId);
                    if (idx !== -1) {
                        const removed = memory.homework.active.splice(idx, 1)[0];
                        removed.status = 'removed_or_merged';
                        memory.homework.completed.push(removed);
                    }
                });
            }

            memory.lastUpdated = new Date().toISOString();
        } catch (e) {
            console.error("⚠️ Failed to parse memory update:", e.message);
        }
    }

    return { cleanReply, memory };
}

// ─────────────────────────────────────────────
// CHAT MODEL FALLBACK ENGINE
// ─────────────────────────────────────────────
const CHAT_MODELS = [
    'gemini-3.0-flash',
    'gemini-3.0-pro',
    'gemini-2.5-flash',
    'gemini-2.0-flash-exp',
    'gemini-1.5-pro-latest',
    'gemini-1.5-flash-latest',
    'gemini-1.5-pro',
    'gemini-1.5-flash'
];
let ACTIVE_CHAT_MODEL = null;

async function generateContentWithFallback(apiKey, payload) {
    const modelsToTry = ACTIVE_CHAT_MODEL ? [ACTIVE_CHAT_MODEL] : CHAT_MODELS;
    let lastError = null;
    
    for (const modelName of modelsToTry) {
        try {
            console.log(`[Kernel] Attempting chat generation with model: ${modelName}`);
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await response.json();
            
            if (data.error) {
                if (data.error.message.toLowerCase().includes('not found') || 
                    data.error.message.toLowerCase().includes('no longer available') || 
                    data.error.message.toLowerCase().includes('not supported') ||
                    data.error.code === 404) {
                    lastError = data.error.message;
                    if (ACTIVE_CHAT_MODEL) ACTIVE_CHAT_MODEL = null;
                    continue;
                }
                return data; // Return other errors (like quota or invalid API key) directly to be handled
            }
            
            ACTIVE_CHAT_MODEL = modelName;
            console.log(`[Kernel] Successfully locked in chat model: ${modelName}`);
            return data;
        } catch (err) {
            lastError = err.message;
            if (ACTIVE_CHAT_MODEL) ACTIVE_CHAT_MODEL = null;
        }
    }
    return { error: { message: `All fallback models failed. Last error: ${lastError}` } };
}

// ─────────────────────────────────────────────
// API ROUTES
// ─────────────────────────────────────────────

// Initialize embeddings
app.post('/api/init', async (req, res) => {
    const { apiKey } = req.body;
    if (!apiKey) return res.status(400).json({ error: "API key required." });

    if (embeddingsReady) {
        return res.json({ status: 'ready', chunks: knowledgeChunks.length });
    }

    try {
        await buildEmbeddingsIndex(apiKey);
        res.json({ status: 'ready', chunks: knowledgeChunks.length });
    } catch (err) {
        res.status(500).json({ error: `Embedding build failed: ${err.message}` });
    }
});

app.get('/api/init/status', (req, res) => {
    res.json({ ready: embeddingsReady, chunks: knowledgeChunks.length });
});

// Main chat endpoint
app.post('/api/chat', async (req, res) => {
    try {
        const { message, contextRoute, chatId, apiKey } = req.body;

        if (!apiKey) return res.status(400).json({ error: "API key required." });
        if (!chatId) return res.status(400).json({ error: "Chat ID required for sandboxes." });

        // Auto-init embeddings if not done
        if (!embeddingsReady) {
            try {
                await buildEmbeddingsIndex(apiKey);
            } catch (e) {
                return res.status(500).json({ error: `Embedding init failed: ${e.message}` });
            }
        }

        const memory = JSON.parse(fs.readFileSync(CORE_MEMORY_FILE, 'utf8'));
        
        // Initialize chat if it doesn't exist
        if (!memory.threads[contextRoute][chatId]) {
            const dateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
            const titleSnippet = message.substring(0, 30).replace(/\n/g, ' ') + (message.length > 30 ? '...' : '');
            memory.threads[contextRoute][chatId] = {
                title: `${dateStr} - ${titleSnippet}`,
                created: new Date().toISOString(),
                messages: []
            };
        }

        const thread = memory.threads[contextRoute][chatId].messages;

        // Vector search
        let ragContext = "";
        try {
            const queryEmb = await getEmbedding(message, apiKey);
            const results = searchKnowledgeBase(queryEmb, 10);
            ragContext = results.map(r =>
                `[${r.pillar} | ${r.isBridge ? 'BRIDGE' : 'PAPER'} | ${r.file} | score: ${r.score.toFixed(3)}]\n${r.content}`
            ).join('\n\n---\n\n');
        } catch (e) {
            console.error("⚠️ RAG search failed, proceeding without:", e.message);
            ragContext = "(RAG unavailable for this query)";
        }

        const fullSystemPrompt = buildFullSystemPrompt(memory, ragContext, contextRoute);

        // Build conversation history (last 20 messages for context)
        const geminiHistory = thread.slice(-20).map(msg => ({
            role: msg.role === 'user' ? 'user' : 'model',
            parts: [{ text: msg.text }]
        }));

        geminiHistory.push({
            role: 'user',
            parts: [{ text: message }]
        });

        // Call Gemini with Fallback Engine
        const data = await generateContentWithFallback(apiKey, {
            system_instruction: { parts: [{ text: fullSystemPrompt }] },
            contents: geminiHistory,
            generationConfig: {
                temperature: 0.75,
                maxOutputTokens: 4096
            }
        });

        if (data.error) {
            console.error("Gemini API Error:", data.error);
            return res.status(500).json({ error: data.error.message });
        }

        const rawReply = data.candidates[0].content.parts[0].text;

        // Parse memory updates from the reply
        const { cleanReply, memory: updatedMemory } = parseAndApplyMemoryUpdates(rawReply, memory);

        // Save thread
        thread.push({ role: 'user', text: message, timestamp: new Date().toISOString() });
        thread.push({ role: 'model', text: cleanReply, timestamp: new Date().toISOString() });
        memory.threads[contextRoute][chatId].messages = thread;

        // Update progress metrics
        updatedMemory.progressMetrics.weeklyLogs.push({
            date: new Date().toISOString(),
            route: contextRoute,
            messageLength: message.length
        });
        // Keep only last 90 days of logs
        const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
        updatedMemory.progressMetrics.weeklyLogs = updatedMemory.progressMetrics.weeklyLogs.filter(l => l.date > ninetyDaysAgo);

        // Recalculate metrics
        // Recalculate metrics
        updatedMemory.lastUpdated = new Date().toISOString();
        recalculateMetrics(updatedMemory);

        fs.writeFileSync(CORE_MEMORY_FILE, JSON.stringify(updatedMemory, null, 2));

        res.json({
            reply: cleanReply,
            homework: updatedMemory.homework.active,
            metrics: updatedMemory.progressMetrics
        });

    } catch (error) {
        console.error("Server error:", error);
        res.status(500).json({ error: "Internal server error: " + error.message });
    }
});

// Get current state
app.get('/api/state', (req, res) => {
    try {
        const memory = JSON.parse(fs.readFileSync(CORE_MEMORY_FILE, 'utf8'));
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        res.json({
            homework: memory.homework.active,
            metrics: memory.progressMetrics,
            insights: memory.insights.slice(-5),
            profile: memory.profile,
            threads: memory.threads
        });
    } catch (e) {
        res.status(500).json({ error: "Failed to read state." });
    }
});

// Complete a homework task
app.post('/api/homework/complete', (req, res) => {
    const { taskId, ease } = req.body;
    try {
        const memory = JSON.parse(fs.readFileSync(CORE_MEMORY_FILE, 'utf8'));
        const idx = memory.homework.active.findIndex(h => h.id === taskId);
        if (idx !== -1) {
            const task = memory.homework.active.splice(idx, 1)[0];
            task.status = 'completed';
            task.completedAt = new Date().toISOString();
            task.easeRating = ease || 3;
            task.completionNotes = req.body.notes || "";
            memory.homework.completed.push(task);

            // Recalculate metrics immediately
            // Recalculate metrics immediately
            memory.lastUpdated = new Date().toISOString();
            recalculateMetrics(memory);
            memory.lastUpdated = new Date().toISOString();

            fs.writeFileSync(CORE_MEMORY_FILE, JSON.stringify(memory, null, 2));
            res.json({ success: true, homework: memory.homework.active.slice(0, 3), metrics: memory.progressMetrics });
        } else {
            res.status(404).json({ error: "Task not found." });
        }
    } catch (e) {
        res.status(500).json({ error: "Failed to complete task." });
    }
});

// ─────────────────────────────────────────────
// CRON SCHEDULER & REPORTS
// ─────────────────────────────────────────────

async function generateAndSaveReport(apiKey, type) {
    console.log(`Generating ${type} Report...`);
    const memory = JSON.parse(fs.readFileSync(CORE_MEMORY_FILE, 'utf8'));
    
    // Gather all messages across all active sandboxes from the last 7 or 30 days
    const days = type === 'Weekly' ? 7 : 30;
    const timeAgo = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    
    let recentDiaryCount = 0; let recentDiaryText = "";
    let recentRelationsCount = 0; let recentRelationsText = "";
    let recentHomeworkCount = 0;

    for (const [route, chats] of Object.entries(memory.threads)) {
        for (const [chatId, chatData] of Object.entries(chats)) {
            const recentMessages = chatData.messages.filter(m => m.timestamp > timeAgo && m.role === 'user');
            if (route === 'diary') {
                recentDiaryCount += recentMessages.length;
                recentDiaryText += recentMessages.map(m => m.text).join('\n---\n');
            } else if (route === 'relations') {
                recentRelationsCount += recentMessages.length;
                recentRelationsText += recentMessages.map(m => m.text).join('\n---\n');
            } else if (route === 'homework') {
                recentHomeworkCount += recentMessages.length;
            }
        }
    }

    const completedRecent = memory.homework.completed.filter(h => h.completedAt > timeAgo);

    const reportPrompt = `
${systemInstruction}

Generate a ${type.toUpperCase()} CLINICAL REPORT for the Sovereign OS user. Be blunt and data-driven.

## Data from this period:
- Diary entries: ${recentDiaryCount}
- Relationship/Social logs: ${recentRelationsCount}
- Homework completions: ${completedRecent.length}
- Active homework remaining: ${memory.homework.active.length}
- Sovereign Score: ${memory.progressMetrics.sovereignScore}/100

## Recent user messages (diary excerpt):
${recentDiaryText.substring(0, 3000)}

## Recent user messages (relations excerpt):
${recentRelationsText.substring(0, 3000)}

Generate:
1. A "Clinical Reassurance" section for genuine progress (data-backed).
2. A "Truth-Slap" section calling out any masking, avoidance, or intellectualization patterns observed.
3. A "Priority Recalibration" with updated thoughts on current trajectory.
4. A "Sovereign Score Analysis" explaining where the user stands.
`.trim();

    try {
        const data = await generateContentWithFallback(apiKey, {
            contents: [{ role: 'user', parts: [{ text: reportPrompt }] }],
            generationConfig: { temperature: 0.6, maxOutputTokens: 4096 }
        });
        
        if (data.error) throw new Error(data.error.message);
        
        const reportText = data.candidates[0].content.parts[0].text;
        
        const report = {
            id: 'rep_' + Date.now(),
            type,
            date: new Date().toISOString(),
            content: reportText
        };
        
        memory.progressMetrics.reports.push(report);
        fs.writeFileSync(CORE_MEMORY_FILE, JSON.stringify(memory, null, 2));
        console.log(`✅ ${type} report generated and saved as checkpoint.`);
        return report;
    } catch (e) {
        console.error("❌ Report generation failed: " + e.message);
        throw e;
    }
}

// Scheduled Jobs
cron.schedule('0 18 * * 5', async () => {
    // Every Friday at 18:00
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey) await generateAndSaveReport(apiKey, "Weekly");
});

cron.schedule('0 18 28 * *', async () => {
    // 28th of every month
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey) await generateAndSaveReport(apiKey, "Monthly");
});

// Generate report manually (for testing or via UI button)
app.post('/api/report/generate', async (req, res) => {
    const { apiKey, type } = req.body; // type = 'Weekly' or 'Monthly'
    if (!apiKey) return res.status(400).json({ error: "API key required." });
    try {
        const report = await generateAndSaveReport(apiKey, type || 'Weekly');
        res.json({ report });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`\n🟣 ═══════════════════════════════════════════`);
    console.log(`   SOVEREIGN OS v2.5 — Kernel Active`);
    console.log(`   http://localhost:${PORT}`);
    console.log(`   Knowledge Base: ${knowledgeChunks.length} chunks loaded`);
    console.log(`   Context Files: ${contextFiles.length} loaded`);
    console.log(`🟣 ═══════════════════════════════════════════\n`);
});
