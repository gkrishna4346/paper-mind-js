// In-memory document store. Each uploaded PDF gets an id; its chunks and
// TF-IDF index stay on the server so the browser never re-sends the full text.
// Entries expire after DOC_TTL_MINUTES of inactivity (default 60).
import { randomUUID } from "node:crypto";

const TTL_MS = Number(process.env.DOC_TTL_MINUTES || 60) * 60 * 1000;
const MAX_DOCS = Number(process.env.MAX_DOCS || 50);
const docs = new Map();

export function saveDoc(doc) {
  const id = randomUUID();
  docs.set(id, { ...doc, touched: Date.now() });
  while (docs.size > MAX_DOCS) docs.delete(docs.keys().next().value); // drop oldest
  return id;
}

export function getDoc(id) {
  const doc = id && docs.get(id);
  if (!doc) return null;
  doc.touched = Date.now();
  return doc;
}

setInterval(() => {
  const now = Date.now();
  for (const [id, d] of docs) if (now - d.touched > TTL_MS) docs.delete(id);
}, 5 * 60 * 1000).unref();
