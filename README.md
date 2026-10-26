# Paper Mind AI

**Read. Understand. Ask. Instantly.**

🔗 **Live:** https://paper-mind-js.onrender.com

An intelligent PDF reader and Q&A assistant. Upload a PDF, and Paper Mind builds a
searchable knowledge base from it, identifies the document's domain, and answers your
questions using **only** the content of that document, citing the pages it drew from.

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | Plain **HTML / CSS / JavaScript** (no framework, no build step) in `public/` |
| Backend | **Node.js + Express** (`server.js`) |
| PDF text extraction | `unpdf` (page by page, so answers can cite page numbers) |
| Retrieval (the "R" in RAG) | TF-IDF + cosine similarity, written in plain JS (`lib/retriever.js`) |
| Generation | Google **Gemini**, Anthropic **Claude**, or **Hugging Face** models, called over their REST APIs (`lib/llm.js`) |

The browser only ever talks to your own server. Your API key stays on the server.

## Project structure

```
paper-mind-js/
├── server.js          ← Express app + API routes
├── lib/
│   ├── env.js         ← loads .env next to server.js
│   ├── pdf.js         ← PDF → text per page
│   ├── retriever.js   ← chunking + TF-IDF index + search
│   ├── llm.js         ← Gemini / Claude / Hugging Face calls
│   └── store.js       ← in-memory document sessions (auto-expire)
├── public/
│   ├── index.html     ← page markup
│   ├── style.css      ← styling (matches the original design mockup)
│   ├── app.js         ← upload, build KB, ask, render answers
│   └── logo-icon.png, favicon.png, og-image.jpg
├── .env.example
├── render.yaml        ← one-click Render deploy
└── package.json
```

## Run locally

Requires Node.js 20 or newer.

```bash
npm install
cp .env.example .env      # then paste ONE API key into .env
npm start                 # or: npm run dev  (auto-restarts on file changes)
```

Open **http://localhost:5050**.

The terminal prints which keys were found and which provider/model is active. Check that
first if something isn't working.

### Choosing a provider

| Key in `.env` | Provider | Default model |
|---|---|---|
| `GOOGLE_API_KEY` | Gemini | `gemini-2.5-flash` |
| `ANTHROPIC_API_KEY` | Claude | `claude-sonnet-5-5` |
| `HF_API_KEY` | Hugging Face | `meta-llama/Llama-3.3-70B-Instruct` |

If several keys are set, the priority is Gemini → Claude → Hugging Face, unless you set
`LLM_PROVIDER=gemini|anthropic|huggingface`. Override any model with `GEMINI_MODEL`,
`ANTHROPIC_MODEL` or `HF_MODEL`.

## How the RAG pipeline works

1. **Upload** (`POST /api/upload`): the PDF is read page by page, split into overlapping
   ~1,200-character chunks (each tagged with its page), and indexed with TF-IDF. The index
   stays on the server; the browser just keeps a `docId`.
2. **Build Knowledge Base** (`POST /api/build-kb`): the first ~6,000 characters go to the
   LLM, which returns a short domain label (e.g. "Airline HR Policy") and three suggested
   questions.
3. **Ask** (`POST /api/query`): the question is scored against every chunk with cosine
   similarity and the top 5 are sent to the LLM as context (short documents are sent
   whole). The model is told to answer only from that context, or return a fixed token
   if the answer isn't there, which becomes:

   > Dear User, Apologies. The searched content is unavailable in the uploaded document.

   The response includes the page numbers the context came from.

`GET /api/health` reports the active provider and model.

## Deploy to Render

1. Push this folder to GitHub (`.env` and `node_modules` are git-ignored).
2. On render.com choose **New → Blueprint** and select the repo. `render.yaml` sets up
   the build (`npm ci`), start (`npm start`) and health check.
3. When prompted, fill in **one** API key and leave the others blank.

Or set it up by hand: **New → Web Service**, pick the repo, Language **Node**, Build
Command `npm ci`, Start Command `npm start`, Instance Type **Free**, and add your API key
under Environment Variables. Every push to `main` then redeploys automatically.

Notes:
- Render's free tier sleeps after ~15 minutes idle; the first request after that takes
  30–50 seconds. Uploaded documents live in memory, so a restart clears them. The page
  handles this by re-uploading your PDF in the background and retrying automatically.
- Optional settings: `MAX_UPLOAD_MB` (default 20), `DOC_TTL_MINUTES` (default 60).
- Scanned (image-only) PDFs have no text layer and will be rejected. OCR them first.
