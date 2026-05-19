import { useState, useRef, useEffect, useCallback } from "react";

const FONTS = `@import url('https://fonts.googleapis.com/css2?family=Space+Mono:ital,wght@0,400;0,700;1,400&family=Syne:wght@400;600;700;800&display=swap');`;

// ─── Model configs ────────────────────────────────────────────────────────────
const FAST_MODEL = {
  id: "qwen/qwen3-coder-480b-a35b-instruct:free",
  name: "Qwen3 Coder 480B",
  provider: "OpenRouter",
  label: "FREE · OpenRouter",
  apiKey: "openrouter",
};

const DEEP_MODELS = [
  { role: "Architect", id: "anthropic/claude-sonnet-4-5", name: "Claude Sonnet 4.5", apiKey: "github", label: "GitHub Edu" },
  { role: "Builder",   id: "google/gemini-pro-1.5",       name: "Gemini 1.5 Pro",   apiKey: "openrouter", label: "OpenRouter" },
  { role: "Refiner",   id: "qwen/qwen3-coder-480b-a35b-instruct:free", name: "Qwen3 Coder 480B", apiKey: "openrouter", label: "Free" },
];

// ─── Preset designs ───────────────────────────────────────────────────────────
const PRESETS = [
  { id: "saas",      label: "SaaS Landing",    icon: "◈", desc: "Hero + features + pricing + CTA" },
  { id: "portfolio", label: "Portfolio",        icon: "◉", desc: "Projects grid + about + contact" },
  { id: "blog",      label: "Blog / Article",  icon: "◫", desc: "Reading-first layout + sidebar" },
  { id: "dashboard", label: "Dashboard",       icon: "◧", desc: "Sidebar nav + metric cards + charts" },
  { id: "store",     label: "E-commerce",      icon: "◪", desc: "Product grid + cart + checkout flow" },
  { id: "agency",    label: "Agency",          icon: "◬", desc: "Bold hero + services + team + footer" },
];

const PRESET_PROMPTS = {
  saas: "Build a modern SaaS landing page with: a bold hero with animated gradient headline, 3-column feature grid with icons, a pricing table (3 tiers: Free/Pro/Enterprise), testimonials section, and a sticky nav. Use a dark theme with electric blue accents. Clean, conversion-optimised. Full HTML/CSS/JS in one file.",
  portfolio: "Build a creative portfolio website with: full-screen hero with name and animated role text, filterable projects grid with hover overlays, an about section with skills bars, and a contact form. Use a minimal light theme with one bold accent color. Full HTML/CSS/JS in one file.",
  blog: "Build a blog layout with: sticky header with nav, a featured article hero, an article grid with category tags, a reading-progress sidebar, and a newsletter signup footer. Use an editorial serif + sans-serif type pairing, warm off-white background. Full HTML/CSS/JS in one file.",
  dashboard: "Build an analytics dashboard with: a collapsible sidebar with nav icons, 4 metric summary cards with sparklines, a line chart for traffic over time, a recent activity table, and a top-right user menu. Dark theme, monospace data font. Full HTML/CSS/JS in one file.",
  store: "Build an e-commerce page with: a product listing grid (8 cards with image, price, add-to-cart), a filter sidebar, a cart slide-out panel, and a checkout summary. Light theme, bold product photography placeholders. Full HTML/CSS/JS in one file.",
  agency: "Build a bold agency website with: an oversized typographic hero, a scrolling marquee of client logos, a services section with large numbered cards, a team grid, and a contact section with a map placeholder. Dark brutalist aesthetic with a single neon accent. Full HTML/CSS/JS in one file.",
};

// ─── API helpers ──────────────────────────────────────────────────────────────
async function callOpenRouter(apiKey, model, messages, onChunk) {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
      "HTTP-Referer": "https://agentic-os.local",
      "X-Title": "Agentic OS",
    },
    body: JSON.stringify({ model, messages, stream: true, max_tokens: 8000 }),
  });
  if (!res.ok) throw new Error(`OpenRouter error ${res.status}: ${await res.text()}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let full = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const lines = dec.decode(value).split("\n").filter(l => l.startsWith("data: "));
    for (const line of lines) {
      const data = line.slice(6);
      if (data === "[DONE]") continue;
      try {
        const delta = JSON.parse(data)?.choices?.[0]?.delta?.content || "";
        full += delta;
        onChunk(full);
      } catch {}
    }
  }
  return full;
}

async function callGitHub(apiKey, model, messages, onChunk) {
  const res = await fetch("https://models.inference.ai.azure.com/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages, stream: true, max_tokens: 8000 }),
  });
  if (!res.ok) throw new Error(`GitHub Models error ${res.status}: ${await res.text()}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let full = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const lines = dec.decode(value).split("\n").filter(l => l.startsWith("data: "));
    for (const line of lines) {
      const data = line.slice(6);
      if (data === "[DONE]") continue;
      try {
        const delta = JSON.parse(data)?.choices?.[0]?.delta?.content || "";
        full += delta;
        onChunk(full);
      } catch {}
    }
  }
  return full;
}

function extractCode(text) {
  const m = text.match(/```(?:html|HTML)?\n?([\s\S]*?)```/);
  if (m) return m[1].trim();
  if (text.includes("<!DOCTYPE") || text.includes("<html")) return text.trim();
  return text;
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function AgenticOS() {
  const [screen, setScreen] = useState("setup"); // setup | home | building | preview
  const [keys, setKeys] = useState({ github: "", openrouter: "" });
  const [mode, setMode] = useState("fast"); // fast | deep
  const [preset, setPreset] = useState(null);
  const [customPrompt, setCustomPrompt] = useState("");
  const [output, setOutput] = useState("");
  const [logs, setLogs] = useState([]);
  const [building, setBuilding] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("preview");
  const iframeRef = useRef();
  const logRef = useRef();

  useEffect(() => {
    const saved = localStorage.getItem("agentic-os-keys");
    if (saved) try { setKeys(JSON.parse(saved)); } catch {}
  }, []);

  const saveKeys = (k) => {
    setKeys(k);
    try { localStorage.setItem("agentic-os-keys", JSON.stringify(k)); } catch {}
  };

  const addLog = useCallback((msg, type = "info") => {
    setLogs(l => [...l, { msg, type, t: Date.now() }]);
    setTimeout(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, 50);
  }, []);

  const getPrompt = () => {
    const base = preset ? PRESET_PROMPTS[preset] : customPrompt;
    return base || customPrompt;
  };

  const buildFast = async () => {
    const prompt = getPrompt();
    if (!prompt) return;
    const apiKey = keys.openrouter;
    if (!apiKey) { addLog("OpenRouter API key required for fast mode", "error"); return; }
    addLog("⚡ Fast mode — single model pass", "system");
    addLog(`Model: ${FAST_MODEL.name}`, "info");
    setOutput("");
    const messages = [
      { role: "system", content: "You are an expert web developer. Generate complete, beautiful, working HTML/CSS/JS in a single file. Always wrap the full code in ```html ... ``` fences. Include all styles inline. Make it visually stunning and production-ready." },
      { role: "user", content: prompt }
    ];
    await callOpenRouter(apiKey, FAST_MODEL.id, messages, (chunk) => {
      setOutput(chunk);
    });
    addLog("✓ Build complete", "success");
    setScreen("preview");
  };

  const buildDeep = async () => {
    const prompt = getPrompt();
    if (!prompt) return;
    setOutput("");

    addLog("🧠 Deep mode — multi-model pipeline", "system");

    // Step 1: Architect (GitHub or OpenRouter)
    const arch = DEEP_MODELS[0];
    const archKey = arch.apiKey === "github" ? keys.github : keys.openrouter;
    if (!archKey) { addLog(`${arch.name} key missing — skipping to builder`, "warn"); }
    
    let blueprint = "";
    if (archKey) {
      addLog(`[1/3] ${arch.name} — planning architecture...`, "info");
      const archMessages = [
        { role: "system", content: "You are a senior web architect. Given a website brief, produce a detailed technical blueprint: sections, components, interactions, color palette, fonts, and layout strategy. Be specific and technical. No code yet." },
        { role: "user", content: prompt }
      ];
      try {
        blueprint = await callGitHub(archKey, "gpt-4o", archMessages, () => {});
        addLog(`✓ Blueprint ready (${blueprint.length} chars)`, "success");
      } catch (e) {
        addLog(`Architect error: ${e.message} — using prompt directly`, "warn");
        blueprint = prompt;
      }
    } else {
      blueprint = prompt;
    }

    // Step 2: Builder (OpenRouter)
    const builderKey = keys.openrouter;
    if (!builderKey) { addLog("OpenRouter key required for builder step", "error"); return; }
    addLog(`[2/3] Gemini/Qwen3 — building full website...`, "info");
    const buildMessages = [
      { role: "system", content: "You are an expert frontend engineer. Take the architecture blueprint and build a complete, stunning, working HTML/CSS/JS website in a single file. Use modern CSS, smooth animations, and pixel-perfect design. Wrap in ```html ... ``` fences." },
      { role: "user", content: `Blueprint:\n${blueprint}\n\nOriginal brief:\n${prompt}` }
    ];
    let built = "";
    try {
      built = await callOpenRouter(builderKey, "google/gemini-pro-1.5", buildMessages, (chunk) => {
        setOutput(chunk);
      });
      addLog("✓ Initial build done", "success");
    } catch (e) {
      addLog(`Builder error: ${e.message} — falling back to Qwen3`, "warn");
      built = await callOpenRouter(builderKey, FAST_MODEL.id, buildMessages, (chunk) => setOutput(chunk));
    }

    // Step 3: Refiner
    addLog(`[3/3] Qwen3 Coder — refining & polishing...`, "info");
    const refineMessages = [
      { role: "system", content: "You are a senior UI polish expert. Take this website code and improve it: fix any bugs, enhance animations, improve typography, ensure responsiveness, add micro-interactions, and make it feel premium. Return the complete improved code in ```html ... ``` fences." },
      { role: "user", content: `Improve this website:\n\`\`\`html\n${extractCode(built)}\n\`\`\`` }
    ];
    try {
      await callOpenRouter(builderKey, FAST_MODEL.id, refineMessages, (chunk) => setOutput(chunk));
      addLog("✓ Polish complete", "success");
    } catch (e) {
      addLog(`Refiner error: ${e.message} — using builder output`, "warn");
    }

    addLog("🎉 Deep build complete!", "success");
    setScreen("preview");
  };

  const handleBuild = async () => {
    if (building) return;
    const prompt = getPrompt();
    if (!prompt && !preset) { addLog("Choose a preset or enter a prompt", "error"); return; }
    setBuilding(true);
    setLogs([]);
    setScreen("building");
    try {
      if (mode === "fast") await buildFast();
      else await buildDeep();
    } catch (e) {
      addLog(`Fatal: ${e.message}`, "error");
    }
    setBuilding(false);
  };

  const finalCode = extractCode(output);

  const downloadCode = () => {
    const blob = new Blob([finalCode], { type: "text/html" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "website.html"; a.click();
  };

  // ─── Styles ──────────────────────────────────────────────────────────────────
  const S = {
    app: { fontFamily: "'Syne', sans-serif", background: "#080b0f", color: "#e8e4dc", minHeight: "100vh", display: "flex", flexDirection: "column" },
    topbar: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 24px", borderBottom: "1px solid #1a1f28", background: "#080b0f" },
    logo: { fontFamily: "'Space Mono', monospace", fontSize: 13, color: "#4ade80", letterSpacing: "0.12em", fontWeight: 700 },
    topNav: { display: "flex", gap: 6 },
    topBtn: (active) => ({ fontFamily: "'Space Mono', monospace", fontSize: 11, padding: "5px 14px", borderRadius: 4, border: "1px solid", borderColor: active ? "#4ade80" : "#2a3040", background: active ? "rgba(74,222,128,0.08)" : "transparent", color: active ? "#4ade80" : "#6b7685", cursor: "pointer", letterSpacing: "0.08em" }),
    main: { flex: 1, display: "flex", overflow: "hidden" },
    panel: { flex: 1, padding: 32, overflowY: "auto" },
    label: { fontFamily: "'Space Mono', monospace", fontSize: 11, color: "#4ade80", letterSpacing: "0.1em", marginBottom: 8, display: "block" },
    input: { width: "100%", background: "#0e1218", border: "1px solid #1e2530", borderRadius: 6, padding: "10px 14px", color: "#e8e4dc", fontFamily: "'Space Mono', monospace", fontSize: 13, outline: "none", boxSizing: "border-box" },
    textarea: { width: "100%", background: "#0e1218", border: "1px solid #1e2530", borderRadius: 6, padding: "12px 14px", color: "#e8e4dc", fontFamily: "'Space Mono', monospace", fontSize: 12, outline: "none", resize: "vertical", minHeight: 100, boxSizing: "border-box" },
    section: { marginBottom: 28 },
    sectionTitle: { fontSize: 13, fontWeight: 700, color: "#e8e4dc", marginBottom: 14, textTransform: "uppercase", letterSpacing: "0.08em" },
    modeRow: { display: "flex", gap: 10, marginBottom: 0 },
    modeCard: (active) => ({ flex: 1, padding: "14px 18px", borderRadius: 8, border: "1px solid", borderColor: active ? "#4ade80" : "#1e2530", background: active ? "rgba(74,222,128,0.06)" : "#0e1218", cursor: "pointer", transition: "all .15s" }),
    modeTitle: (active) => ({ fontWeight: 700, fontSize: 15, color: active ? "#4ade80" : "#9aa3b0", marginBottom: 4 }),
    modeDesc: { fontSize: 12, color: "#5a6270", fontFamily: "'Space Mono', monospace", lineHeight: 1.5 },
    presetGrid: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 },
    presetCard: (active) => ({ padding: "12px 14px", borderRadius: 8, border: "1px solid", borderColor: active ? "#4ade80" : "#1e2530", background: active ? "rgba(74,222,128,0.06)" : "#0e1218", cursor: "pointer", transition: "all .15s" }),
    presetIcon: { fontSize: 20, marginBottom: 6, display: "block" },
    presetLabel: (active) => ({ fontSize: 13, fontWeight: 700, color: active ? "#4ade80" : "#c8d0da", marginBottom: 3 }),
    presetDesc: { fontSize: 11, color: "#5a6270", fontFamily: "'Space Mono', monospace" },
    buildBtn: (dis) => ({ width: "100%", padding: "14px 0", borderRadius: 8, border: "none", background: dis ? "#1a2030" : "linear-gradient(135deg, #4ade80, #22c55e)", color: dis ? "#3a4555" : "#080b0f", fontFamily: "'Space Mono', monospace", fontWeight: 700, fontSize: 14, letterSpacing: "0.1em", cursor: dis ? "not-allowed" : "pointer", marginTop: 24, transition: "all .2s" }),
    // Building screen
    buildScreen: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 40 },
    buildTitle: { fontFamily: "'Space Mono', monospace", fontSize: 13, color: "#4ade80", letterSpacing: "0.15em", marginBottom: 24, textAlign: "center" },
    logBox: { width: "100%", maxWidth: 560, background: "#0a0e14", border: "1px solid #1e2530", borderRadius: 10, padding: 16, height: 260, overflowY: "auto", fontFamily: "'Space Mono', monospace", fontSize: 11 },
    logLine: (t) => ({ color: t === "error" ? "#f87171" : t === "success" ? "#4ade80" : t === "system" ? "#facc15" : t === "warn" ? "#fb923c" : "#6b7685", marginBottom: 6 }),
    spinner: { width: 36, height: 36, border: "3px solid #1e2530", borderTop: "3px solid #4ade80", borderRadius: "50%", margin: "0 auto 20px", animation: "spin 0.8s linear infinite" },
    // Preview screen
    previewBar: { display: "flex", alignItems: "center", gap: 10, padding: "10px 20px", borderBottom: "1px solid #1a1f28", background: "#080b0f" },
    tabBtn: (active) => ({ fontFamily: "'Space Mono', monospace", fontSize: 11, padding: "5px 14px", borderRadius: 4, border: "1px solid", borderColor: active ? "#4ade80" : "#2a3040", background: active ? "rgba(74,222,128,0.08)" : "transparent", color: active ? "#4ade80" : "#6b7685", cursor: "pointer" }),
    iframe: { flex: 1, border: "none", background: "#fff" },
    codeBox: { flex: 1, background: "#060a0e", color: "#a8b5c5", fontFamily: "'Space Mono', monospace", fontSize: 11, padding: 24, overflowY: "auto", lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-all" },
    dlBtn: { fontFamily: "'Space Mono', monospace", fontSize: 11, padding: "5px 16px", borderRadius: 4, border: "1px solid #4ade80", background: "rgba(74,222,128,0.1)", color: "#4ade80", cursor: "pointer", marginLeft: "auto" },
    backBtn: { fontFamily: "'Space Mono', monospace", fontSize: 11, padding: "5px 12px", borderRadius: 4, border: "1px solid #2a3040", background: "transparent", color: "#6b7685", cursor: "pointer" },
  };

  const hasKey = mode === "fast" ? !!keys.openrouter : (!!keys.github || !!keys.openrouter);

  // ─── Setup screen ─────────────────────────────────────────────────────────
  if (screen === "setup") return (
    <div style={S.app}>
      <style>{FONTS}{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <div style={S.topbar}>
        <span style={S.logo}>AGENTIC/OS v1.0</span>
        <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 11, color: "#3a4555" }}>configure → build → ship</span>
      </div>
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 40 }}>
        <div style={{ width: "100%", maxWidth: 480 }}>
          <div style={{ marginBottom: 36 }}>
            <div style={{ fontSize: 28, fontWeight: 800, marginBottom: 8 }}>Connect your keys</div>
            <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 12, color: "#5a6270" }}>Keys stored locally in your browser only</div>
          </div>

          <div style={S.section}>
            <span style={S.label}>GITHUB EDUCATION TOKEN</span>
            <input style={S.input} type="password" placeholder="ghp_xxxxxxxxxxxxxxxxxxxx" value={keys.github} onChange={e => saveKeys({ ...keys, github: e.target.value })} />
            <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, color: "#3a4555", marginTop: 6 }}>github.com/settings/tokens → generate with models:read</div>
          </div>

          <div style={S.section}>
            <span style={S.label}>OPENROUTER API KEY</span>
            <input style={S.input} type="password" placeholder="sk-or-xxxxxxxxxxxxxxxxxxxx" value={keys.openrouter} onChange={e => saveKeys({ ...keys, openrouter: e.target.value })} />
            <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, color: "#3a4555", marginTop: 6 }}>openrouter.ai/settings/keys</div>
          </div>

          <button style={S.buildBtn(!(keys.github || keys.openrouter))} onClick={() => setScreen("home")} disabled={!(keys.github || keys.openrouter)}>
            ENTER THE OS →
          </button>
        </div>
      </div>
    </div>
  );

  // ─── Building screen ───────────────────────────────────────────────────────
  if (screen === "building") return (
    <div style={S.app}>
      <style>{FONTS}{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <div style={S.topbar}>
        <span style={S.logo}>AGENTIC/OS</span>
        <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 11, color: mode === "fast" ? "#4ade80" : "#facc15" }}>
          {mode === "fast" ? "⚡ FAST MODE" : "🧠 DEEP MODE"}
        </span>
      </div>
      <div style={S.buildScreen}>
        <div style={S.spinner} />
        <div style={S.buildTitle}>BUILDING YOUR WEBSITE</div>
        <div style={S.logBox} ref={logRef}>
          {logs.map((l, i) => (
            <div key={i} style={S.logLine(l.type)}>{`> ${l.msg}`}</div>
          ))}
          {building && <div style={{ color: "#4ade80", animation: "blink 1s infinite" }}>_</div>}
        </div>
        {output && (
          <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 11, color: "#3a4555", marginTop: 14 }}>
            {output.length} chars generated
          </div>
        )}
      </div>
    </div>
  );

  // ─── Preview screen ────────────────────────────────────────────────────────
  if (screen === "preview") return (
    <div style={{ ...S.app, height: "100vh" }}>
      <style>{FONTS}{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <div style={S.topbar}>
        <span style={S.logo}>AGENTIC/OS</span>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button style={S.backBtn} onClick={() => setScreen("home")}>← back</button>
          <button style={S.tabBtn(activeTab === "preview")} onClick={() => setActiveTab("preview")}>Preview</button>
          <button style={S.tabBtn(activeTab === "code")} onClick={() => setActiveTab("code")}>Code</button>
          <button style={S.dlBtn} onClick={downloadCode}>↓ Download HTML</button>
        </div>
      </div>
      {activeTab === "preview" ? (
        <iframe
          ref={iframeRef}
          style={S.iframe}
          srcDoc={finalCode}
          sandbox="allow-scripts allow-same-origin"
          title="Generated website"
        />
      ) : (
        <div style={S.codeBox}>{finalCode}</div>
      )}
    </div>
  );

  // ─── Home / Build screen ───────────────────────────────────────────────────
  return (
    <div style={S.app}>
      <style>{FONTS}{`@keyframes spin{to{transform:rotate(360deg)}} * { box-sizing: border-box; }`}</style>
      <div style={S.topbar}>
        <span style={S.logo}>AGENTIC/OS v1.0</span>
        <div style={S.topNav}>
          <button style={S.topBtn(true)}>Build</button>
          <button style={S.topBtn(false)} onClick={() => setScreen("setup")}>Keys</button>
          {output && <button style={S.topBtn(false)} onClick={() => setScreen("preview")}>Preview →</button>}
        </div>
      </div>

      <div style={S.main}>
        <div style={S.panel}>
          {/* Mode selector */}
          <div style={S.section}>
            <div style={S.sectionTitle}>Build mode</div>
            <div style={S.modeRow}>
              <div style={S.modeCard(mode === "fast")} onClick={() => setMode("fast")}>
                <div style={S.modeTitle(mode === "fast")}>⚡ Fast</div>
                <div style={S.modeDesc}>One model, one pass.<br/>Qwen3 Coder 480B (free)<br/>~30 seconds</div>
              </div>
              <div style={S.modeCard(mode === "deep")} onClick={() => setMode("deep")}>
                <div style={S.modeTitle(mode === "deep")}>🧠 Deep</div>
                <div style={S.modeDesc}>3-model pipeline.<br/>Architect → Builder → Refiner<br/>~2–3 minutes</div>
              </div>
            </div>
            {mode === "deep" && (
              <div style={{ marginTop: 12, padding: "10px 14px", background: "#0a0e14", borderRadius: 8, border: "1px solid #1e2530", fontFamily: "'Space Mono', monospace", fontSize: 11, color: "#5a6270", lineHeight: 1.7 }}>
                {DEEP_MODELS.map((m, i) => (
                  <div key={i} style={{ color: (m.apiKey === "github" && !keys.github) || (m.apiKey === "openrouter" && !keys.openrouter) ? "#f87171" : "#6b7685" }}>
                    [{i + 1}] {m.role}: {m.name} · <span style={{ color: "#4ade80" }}>{m.label}</span>
                    {(m.apiKey === "github" && !keys.github) && " ← key missing"}
                    {(m.apiKey === "openrouter" && !keys.openrouter) && " ← key missing"}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Preset designs */}
          <div style={S.section}>
            <div style={S.sectionTitle}>Preset designs</div>
            <div style={S.presetGrid}>
              {PRESETS.map(p => (
                <div key={p.id} style={S.presetCard(preset === p.id)} onClick={() => { setPreset(preset === p.id ? null : p.id); setCustomPrompt(""); }}>
                  <span style={S.presetIcon}>{p.icon}</span>
                  <div style={S.presetLabel(preset === p.id)}>{p.label}</div>
                  <div style={S.presetDesc}>{p.desc}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Custom prompt */}
          <div style={S.section}>
            <span style={S.label}>OR DESCRIBE YOUR SITE</span>
            <textarea
              style={S.textarea}
              placeholder="Describe your website in detail — layout, colors, features, tech stack..."
              value={preset ? PRESET_PROMPTS[preset] : customPrompt}
              onChange={e => { setPreset(null); setCustomPrompt(e.target.value); }}
            />
          </div>

          {/* Build button */}
          <button
            style={S.buildBtn(!hasKey || building)}
            onClick={handleBuild}
            disabled={!hasKey || building}
          >
            {building ? "BUILDING..." : `${mode === "fast" ? "⚡" : "🧠"} BUILD WEBSITE`}
          </button>

          {!hasKey && (
            <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 11, color: "#f87171", marginTop: 10, textAlign: "center" }}>
              {mode === "fast" ? "OpenRouter key required" : "At least one API key required"} → <span style={{ cursor: "pointer", textDecoration: "underline" }} onClick={() => setScreen("setup")}>add keys</span>
            </div>
          )}
        </div>

        {/* Right panel: live log */}
        <div style={{ width: 280, borderLeft: "1px solid #1a1f28", padding: 20, overflowY: "auto", background: "#060a0e" }}>
          <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 11, color: "#4ade80", letterSpacing: "0.1em", marginBottom: 14 }}>ACTIVITY LOG</div>
          <div ref={logRef} style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, lineHeight: 1.7 }}>
            {logs.length === 0 && <div style={{ color: "#2a3040" }}>No activity yet...</div>}
            {logs.map((l, i) => (
              <div key={i} style={S.logLine(l.type)}>{`> ${l.msg}`}</div>
            ))}
          </div>

          {output && (
            <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid #1a1f28" }}>
              <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 11, color: "#4ade80", marginBottom: 8 }}>LAST OUTPUT</div>
              <button style={{ ...S.tabBtn(true), display: "block", width: "100%", marginBottom: 6 }} onClick={() => setScreen("preview")}>View Preview →</button>
              <button style={{ ...S.tabBtn(false), display: "block", width: "100%", marginBottom: 6 }} onClick={downloadCode}>↓ Download HTML</button>
            </div>
          )}

          <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid #1a1f28" }}>
            <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 11, color: "#3a4555", marginBottom: 10 }}>KEYS STATUS</div>
            <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, lineHeight: 1.8 }}>
              <div style={{ color: keys.github ? "#4ade80" : "#3a4555" }}>{keys.github ? "✓" : "○"} GitHub Edu</div>
              <div style={{ color: keys.openrouter ? "#4ade80" : "#3a4555" }}>{keys.openrouter ? "✓" : "○"} OpenRouter</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
