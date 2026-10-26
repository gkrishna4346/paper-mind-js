/**
 * Paper Mind AI — Node.js backend
 * ---------------------------------
 *   1. POST /api/upload    PDF → text per page (unpdf) → chunks → TF-IDF index
 *   2. POST /api/build-kb  identify the document's domain + suggest questions (LLM)
 *   3. POST /api/query     retrieve top chunks → answer grounded ONLY in them (LLM)
 *
 * Run:  npm install  →  cp .env.example .env (add one API key)  →  npm start
 */
import { ROOT, ENV_PATH, ENV_FOUND } from "./lib/env.js";
import path from "node:path";
import express from "express";
import multer from "multer";
import { extractPages } from "./lib/pdf.js";
import { chunkPages, TfidfIndex } from "./lib/retriever.js";
import { askLLM, providerStatus, PROVIDER, MODEL } from "./lib/llm.js";
import { saveDoc, getDoc } from "./lib/store.js";

const PORT = Number(process.env.PORT || 5050);
const MAX_MB = Number(process.env.MAX_UPLOAD_MB || 20);
const FULL_TEXT_LIMIT = 6000; // short documents are sent to the model in full
const TOP_N = 5;

const NOT_FOUND_SENTINEL = "NOT_FOUND_IN_DOCUMENT";
const FALLBACK_MSG = "Dear User, Apologies. The searched content is unavailable in the uploaded document.";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(ROOT, "public"), { maxAge: "1h" }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_MB * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ok = file.mimetype === "application/pdf" || /\.pdf$/i.test(file.originalname);
    cb(ok ? null : Object.assign(new Error("Please upload a PDF file."), { status: 400 }), ok);
  },
});

const docOr410 = (req, res) => {
  const doc = getDoc(req.body?.docId);
  if (!doc) {
    res.status(410).json({ code: "DOC_EXPIRED", error: "This document session has expired. Please upload the PDF again." });
    return null;
  }
  return doc;
};

// ---------------------------------------------------------------------------
app.get("/api/health", (_req, res) => res.json({ ok: true, ...providerStatus() }));

app.post("/api/upload", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded." });
  let extracted;
  try {
    extracted = await extractPages(req.file.buffer);
  } catch (err) {
    const msg = /password/i.test(err.message) ? "This PDF is password-protected." : `Could not read this PDF: ${err.message}`;
    return res.status(400).json({ error: msg });
  }
  const { pages, totalPages } = extracted;
  const fullText = pages.join("\n\n").trim();
  if (fullText.length < 20) {
    return res.status(400).json({ error: "No readable text found in this PDF (it may be a scanned image)." });
  }
  const chunks = chunkPages(pages);
  const docId = saveDoc({ name: req.file.originalname, pages, fullText, chunks, index: new TfidfIndex(chunks) });
  res.json({ docId, name: req.file.originalname, pages: totalPages, characters: fullText.length, chunks: chunks.length });
});

app.post("/api/build-kb", async (req, res) => {
  const doc = docOr410(req, res);
  if (!doc) return;
  try {
    const raw = await askLLM(
      "You classify documents. Read the excerpt and reply with ONLY a JSON object, no code fences, of the form " +
        '{"domain": "<2-5 word label naming the professional domain, industry or document type, e.g. Airline HR Policy>", ' +
        '"questions": ["<question 1>", "<question 2>", "<question 3>"]} ' +
        "where the questions are three short, specific questions a reader could ask that this document clearly answers.",
      `Document excerpt:\n\n${doc.fullText.slice(0, FULL_TEXT_LIMIT)}`,
      { maxTokens: 400 }
    );
    const { domain, questions } = parseKb(raw);
    doc.domain = domain;
    res.json({ domain, questions });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

function parseKb(raw) {
  const json = raw.match(/\{[\s\S]*\}/);
  if (json) {
    try {
      const obj = JSON.parse(json[0]);
      const domain = String(obj.domain || "").trim().replace(/^["'.]+|["'.]+$/g, "");
      const questions = Array.isArray(obj.questions)
        ? obj.questions.map((q) => String(q).trim()).filter(Boolean).slice(0, 3)
        : [];
      if (domain) return { domain, questions };
    } catch { /* fall through */ }
  }
  // Model ignored the JSON instruction — treat the first line as the label.
  const domain = raw.split("\n")[0].replace(/[{}"`*]|domain\s*:/gi, "").trim().replace(/[.,]+$/, "");
  return { domain: domain.slice(0, 60) || "General Document", questions: [] };
}

app.post("/api/query", async (req, res) => {
  const doc = docOr410(req, res);
  if (!doc) return;
  const question = String(req.body?.query || "").trim().slice(0, 1000);
  if (!doc.domain && req.body?.domain) doc.domain = String(req.body.domain).slice(0, 80); // after an auto re-upload
  if (!question) return res.status(400).json({ error: "Please type a question." });

  // Retrieval: whole document if short, otherwise the top TF-IDF chunks.
  let passages;
  if (doc.fullText.length <= FULL_TEXT_LIMIT) {
    passages = doc.pages.map((text, i) => ({ page: i + 1, text, score: null })).filter((p) => p.text);
  } else {
    const hits = doc.index.search(question, TOP_N);
    const ranked = hits.length ? hits : doc.chunks.slice(0, TOP_N).map((chunk) => ({ chunk, score: 0 }));
    passages = ranked.map(({ chunk, score }) => ({ page: chunk.page, text: chunk.text, score }));
  }

  const context = passages.map((p, i) => `[Passage ${i + 1} | page ${p.page}]\n${p.text}`).join("\n\n---\n\n");
  const system =
    "You are Paper Mind AI, a professional document Q&A assistant. Answer the user's question using ONLY the " +
    "information in the DOCUMENT CONTEXT below — never use outside knowledge and never guess. Present the answer " +
    "clearly: short paragraphs and bullet points where helpful, and bold key figures, dates or terms using " +
    "**double asterisks**. Do not mention passage numbers. If, and only if, the requested information genuinely " +
    `cannot be found in the context, reply with exactly this single token and nothing else: ${NOT_FOUND_SENTINEL}` +
    (doc.domain ? `\n\nDocument domain: ${doc.domain}` : "") +
    `\n\nDOCUMENT CONTEXT:\n${context}`;

  try {
    const answer = await askLLM(system, `User question: ${question}`);
    if (!answer || answer.includes(NOT_FOUND_SENTINEL)) {
      return res.json({ found: false, message: FALLBACK_MSG });
    }
    const sources = [...new Set(passages.map((p) => p.page))].sort((a, b) => a - b);
    res.json({ found: true, answer, domain: doc.domain || "", sources });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Unknown API routes → JSON 404; everything else → the app.
app.use("/api", (_req, res) => res.status(404).json({ error: "Not found." }));

// Error handler (multer limits, bad JSON, etc.)
app.use((err, _req, res, _next) => {
  if (err.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: `PDF is larger than ${MAX_MB} MB.` });
  res.status(err.status || 500).json({ error: err.message || "Unexpected server error." });
});

app.listen(PORT, () => {
  const s = providerStatus();
  console.log("-".repeat(60));
  console.log(`Paper Mind AI — .env at ${ENV_PATH} (${ENV_FOUND ? "found" : "not found, using environment"})`);
  console.log(`Keys found: ${Object.entries(s.keysFound).map(([k, v]) => `${k}=${v ? "yes" : "no"}`).join(", ")}`);
  console.log(`Active provider: ${PROVIDER || "NONE — set an API key!"}${MODEL ? ` (${MODEL})` : ""}`);
  console.log(`Listening on http://localhost:${PORT}`);
  console.log("-".repeat(60));
});
