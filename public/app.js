// Paper Mind AI — browser side. Talks only to our own server's /api routes.
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const el = {
    fileInput: $("fileInput"),
    uploadCard: $("uploadCard"),
    uploadTitle: $("uploadTitle"),
    uploadMeta: $("uploadMeta"),
    buildKbBtn: $("buildKbBtn"),
    buildKbLabel: $("buildKbLabel"),
    domainBox: $("domainBox"),
    domainLabel: $("domainLabel"),
    queryForm: $("queryForm"),
    queryInput: $("queryInput"),
    sendBtn: $("sendBtn"),
    suggestions: $("suggestions"),
    answerBody: $("answerBody"),
    resetBtn: $("resetBtn"),
  };

  const PLACEHOLDER = "Answers extracted by Paper Mind will appear here";
  const state = { file: null, docId: null, domain: "", kbReady: false, busy: false };

  // ---------- helpers ----------
  const escapeHtml = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  function inline(s) {
    return s
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/__(.+?)__/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*(?!\s)([^*]+?)\*(?!\*)/g, "$1<em>$2</em>");
  }

  // Small, safe markdown renderer: headings, bullet/numbered lists, bold, italics, code.
  function renderMarkdown(md) {
    const lines = escapeHtml(md).split(/\r?\n/);
    let html = "";
    let list = null;
    const closeList = () => { if (list) { html += `</${list}>`; list = null; } };
    for (const raw of lines) {
      const line = raw.trim();
      let m;
      if (!line) { closeList(); continue; }
      if ((m = line.match(/^#{1,6}\s+(.*)$/))) {
        closeList();
        html += `<h3>${inline(m[1])}</h3>`;
      } else if ((m = line.match(/^[-*•●○▪]\s+(.*)$/))) {
        if (list !== "ul") { closeList(); html += "<ul>"; list = "ul"; }
        html += `<li>${inline(m[1])}</li>`;
      } else if ((m = line.match(/^\d+[.)]\s+(.*)$/))) {
        if (list !== "ol") { closeList(); html += "<ol>"; list = "ol"; }
        html += `<li>${inline(m[1])}</li>`;
      } else {
        closeList();
        html += `<p>${inline(line)}</p>`;
      }
    }
    closeList();
    return html;
  }

  async function api(path, options = {}) {
    const res = await fetch(path, options);
    let data = {};
    try { data = await res.json(); } catch { /* non-JSON (e.g. proxy error page) */ }
    if (!res.ok) {
      const err = new Error(data.error || `Request failed (${res.status}). The server may be waking up — try again in a moment.`);
      err.code = data.code;
      throw err;
    }
    return data;
  }

  const postJson = (path, body) =>
    api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  function formatSize(bytes) {
    return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  function setAnswerPlaceholder(text = PLACEHOLDER, warn = false) {
    el.answerBody.innerHTML = `<p class="placeholder${warn ? " warn" : ""} fade-in">${escapeHtml(text)}</p>`;
  }

  function setQueryEnabled(on) {
    el.queryInput.disabled = !on;
    el.sendBtn.disabled = !on;
    el.suggestions.querySelectorAll("button").forEach((b) => (b.disabled = !on));
  }

  function resetKb() {
    state.kbReady = false;
    state.domain = "";
    el.buildKbBtn.classList.remove("done", "busy", "ready");
    el.buildKbLabel.textContent = "Build Knowledge Base";
    el.domainBox.classList.remove("has-domain");
    el.domainLabel.textContent = "Identified domain name appears here";
    el.suggestions.hidden = true;
    el.suggestions.innerHTML = "";
    setQueryEnabled(false);
    setAnswerPlaceholder();
  }

  // ---------- 1. Upload ----------
  async function uploadFile(file) {
    const form = new FormData();
    form.append("file", file);
    const data = await api("/api/upload", { method: "POST", body: form });
    state.docId = data.docId;
    return data;
  }

  async function handleFile(file) {
    if (!file || state.busy) return;
    if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") {
      showUploadError("That isn't a PDF. Please choose a .pdf file.");
      return;
    }
    state.file = file;
    state.docId = null;
    resetKb();
    el.buildKbBtn.disabled = true;
    el.uploadCard.classList.remove("loaded", "error");
    el.uploadCard.classList.add("busy");
    el.uploadTitle.innerHTML = '<span class="spinner"></span> Reading PDF…';
    el.uploadMeta.textContent = file.name;

    try {
      const info = await uploadFile(file);
      el.uploadCard.classList.add("loaded");
      el.uploadTitle.textContent = file.name;
      el.uploadMeta.textContent = `${info.pages} page${info.pages === 1 ? "" : "s"} · ${formatSize(file.size)} · click to replace`;
      el.buildKbBtn.disabled = false;
      el.buildKbBtn.classList.add("ready");
    } catch (err) {
      state.file = null;
      showUploadError(err.message);
    } finally {
      el.uploadCard.classList.remove("busy");
      el.fileInput.value = "";
    }
  }

  function showUploadError(msg) {
    el.uploadCard.classList.remove("loaded");
    el.uploadCard.classList.add("error");
    el.uploadTitle.textContent = "Couldn't read that file";
    el.uploadMeta.textContent = msg + " Click to try another.";
  }

  el.fileInput.addEventListener("change", () => handleFile(el.fileInput.files[0]));
  el.uploadCard.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); el.fileInput.click(); }
  });
  ["dragenter", "dragover"].forEach((t) =>
    el.uploadCard.addEventListener(t, (e) => { e.preventDefault(); el.uploadCard.classList.add("dragging"); })
  );
  ["dragleave", "drop"].forEach((t) =>
    el.uploadCard.addEventListener(t, (e) => { e.preventDefault(); el.uploadCard.classList.remove("dragging"); })
  );
  el.uploadCard.addEventListener("drop", (e) => handleFile(e.dataTransfer.files[0]));
  // Stop a PDF dropped elsewhere on the page from navigating away.
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => e.preventDefault());

  // If the server restarted (Render free tier sleeps), quietly re-upload and retry once.
  async function withDoc(call) {
    try {
      return await call();
    } catch (err) {
      if (err.code === "DOC_EXPIRED" && state.file) {
        await uploadFile(state.file);
        return call();
      }
      throw err;
    }
  }

  // ---------- 2. Build knowledge base ----------
  el.buildKbBtn.addEventListener("click", async () => {
    if (!state.docId || state.busy) return;
    state.busy = true;
    el.buildKbBtn.disabled = true;
    el.buildKbBtn.classList.remove("ready");
    el.buildKbBtn.classList.add("busy");
    el.buildKbLabel.innerHTML = '<span class="spinner"></span> Analyzing document…';
    el.domainLabel.textContent = "Identifying domain…";

    try {
      const data = await withDoc(() => postJson("/api/build-kb", { docId: state.docId }));
      state.domain = data.domain;
      state.kbReady = true;
      el.buildKbBtn.classList.add("done");
      el.buildKbLabel.textContent = "Knowledge Base Ready";
      el.domainBox.classList.add("has-domain");
      el.domainLabel.innerHTML = `<b>${escapeHtml(data.domain)}</b>`;
      renderSuggestions(data.questions || []);
      setQueryEnabled(true);
      setAnswerPlaceholder("Knowledge base is ready. Ask anything about your document.");
      el.queryInput.focus();
    } catch (err) {
      el.buildKbBtn.disabled = false;
      el.buildKbBtn.classList.add("ready");
      el.buildKbLabel.textContent = "Build Knowledge Base";
      el.domainLabel.textContent = "Identified domain name appears here";
      setAnswerPlaceholder(err.message, true);
    } finally {
      el.buildKbBtn.classList.remove("busy");
      state.busy = false;
    }
  });

  function renderSuggestions(questions) {
    el.suggestions.innerHTML = "";
    questions.forEach((q) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip";
      b.textContent = q;
      b.addEventListener("click", () => { el.queryInput.value = q; ask(); });
      el.suggestions.appendChild(b);
    });
    el.suggestions.hidden = questions.length === 0;
  }

  // ---------- 3. Ask ----------
  async function ask() {
    const q = el.queryInput.value.trim();
    if (!q || !state.kbReady || state.busy) return;
    state.busy = true;
    setQueryEnabled(false);
    el.answerBody.innerHTML = `
      <div class="answer-head"><span class="tag">${escapeHtml(state.domain)}</span></div>
      <p class="question-echo">${escapeHtml(q)}</p>
      <div class="thinking" style="margin:0"><span class="spinner"></span> Searching the document…</div>
      <div class="skeleton"><span></span><span></span><span></span></div>`;

    try {
      const data = await withDoc(() => postJson("/api/query", { docId: state.docId, query: q, domain: state.domain }));
      if (data.found === false) {
        setAnswerPlaceholder(data.message);
      } else {
        const pages = (data.sources || []).map((p) => `<span class="tag">p. ${p}</span>`).join("");
        el.answerBody.innerHTML = `
          <div class="fade-in" style="display:flex;flex-direction:column;flex:1">
            <div class="answer-head"><span class="tag">${escapeHtml(state.domain)}</span></div>
            <p class="question-echo">${escapeHtml(q)}</p>
            <div class="md">${renderMarkdown(data.answer)}</div>
            <div class="sources">
              ${pages ? `<span>Retrieved from</span>${pages}` : ""}
              <span class="answer-actions"><button type="button" class="copy-btn" id="copyBtn">Copy answer</button></span>
            </div>
          </div>`;
        $("copyBtn").addEventListener("click", async (e) => {
          try {
            await navigator.clipboard.writeText(data.answer.replace(/\*\*/g, ""));
            e.target.textContent = "Copied ✓";
          } catch {
            e.target.textContent = "Copy failed";
          }
          setTimeout(() => (e.target.textContent = "Copy answer"), 1600);
        });
      }
    } catch (err) {
      setAnswerPlaceholder(err.message, true);
    } finally {
      state.busy = false;
      setQueryEnabled(true);
      el.queryInput.focus();
      el.queryInput.select();
    }
  }

  el.queryForm.addEventListener("submit", (e) => { e.preventDefault(); ask(); });

  // ---------- Reset ----------
  el.resetBtn.addEventListener("click", () => {
    if (state.busy) return;
    state.file = null;
    state.docId = null;
    resetKb();
    el.buildKbBtn.disabled = true;
    el.queryInput.value = "";
    el.uploadCard.classList.remove("loaded", "error");
    el.uploadTitle.innerHTML = "Upload your PDF<br />Document Here";
    el.uploadMeta.textContent = "Click or drop a file";
  });
})();
