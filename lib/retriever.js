// Retrieval step of the RAG pipeline (replaces scikit-learn).
// Chunks the document page by page, builds a TF-IDF index once at upload time,
// and ranks chunks against each query by cosine similarity.

const STOP_WORDS = new Set(`a about above after again against all am an and any are aren't as at be because
been before being below between both but by can can't cannot could couldn't did didn't do does doesn't
doing don't down during each few for from further had hadn't has hasn't have haven't having he he'd he'll
he's her here here's hers herself him himself his how how's i i'd i'll i'm i've if in into is isn't it it's
its itself let's me more most mustn't my myself no nor not of off on once only or other ought our ours
ourselves out over own same shan't she she'd she'll she's should shouldn't so some such than that that's
the their theirs them themselves then there there's these they they'd they'll they're they've this those
through to too under until up very was wasn't we we'd we'll we're we've were weren't what what's when
when's where where's which while who who's whom why why's with won't would wouldn't you you'd you'll
you're you've your yours yourself yourselves also may shall will etc per via within upon`.split(/\s+/));

// Very small suffix stemmer so "leaves"/"leave", "employees"/"employee",
// "approved"/"approval" etc. land on the same term.
function stem(w) {
  if (w.length <= 4) return w;
  for (const suf of ["ational", "ations", "ation", "ments", "ment", "ness", "ings", "ing", "ies", "ied", "ers", "er", "ed", "es", "s", "al"]) {
    if (w.endsWith(suf) && w.length - suf.length >= 3) {
      const base = w.slice(0, -suf.length);
      return suf === "ies" || suf === "ied" ? base + "y" : base;
    }
  }
  return w;
}

export function tokenize(text) {
  return (text.toLowerCase().match(/[a-z0-9][a-z0-9'’-]*/g) || [])
    .map((t) => t.replace(/['’]s$/, "").replace(/['’-]/g, ""))
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t))
    .map(stem);
}

// Split each page into overlapping ~size-char chunks, breaking on whitespace.
export function chunkPages(pages, size = 1200, overlap = 200) {
  const chunks = [];
  pages.forEach((pageText, idx) => {
    const text = pageText.trim();
    if (!text) return;
    let start = 0;
    while (start < text.length) {
      let end = Math.min(start + size, text.length);
      if (end < text.length) {
        const ws = text.lastIndexOf(" ", end);
        if (ws > start + size * 0.6) end = ws;
      }
      chunks.push({ id: chunks.length, page: idx + 1, text: text.slice(start, end).trim() });
      if (end >= text.length) break;
      let next = end - overlap;
      const ws = text.indexOf(" ", next);
      if (ws !== -1 && ws < end) next = ws + 1;
      start = Math.max(next, start + 1);
    }
  });
  return chunks;
}

function normalize(vec) {
  let sum = 0;
  for (const v of vec.values()) sum += v * v;
  const n = Math.sqrt(sum) || 1;
  for (const [k, v] of vec) vec.set(k, v / n);
  return vec;
}

export class TfidfIndex {
  constructor(chunks) {
    this.chunks = chunks;
    const df = new Map();
    const tfs = chunks.map((c) => {
      const tf = new Map();
      for (const t of tokenize(c.text)) tf.set(t, (tf.get(t) || 0) + 1);
      for (const t of tf.keys()) df.set(t, (df.get(t) || 0) + 1);
      return tf;
    });
    const N = chunks.length;
    // Smooth IDF, same formula scikit-learn uses.
    this.idf = new Map([...df].map(([t, d]) => [t, Math.log((1 + N) / (1 + d)) + 1]));
    this.vectors = tfs.map((tf) => {
      const v = new Map();
      for (const [t, c] of tf) v.set(t, (1 + Math.log(c)) * this.idf.get(t)); // sublinear tf
      return normalize(v);
    });
  }

  search(query, topN = 5) {
    const qtf = new Map();
    for (const t of tokenize(query)) if (this.idf.has(t)) qtf.set(t, (qtf.get(t) || 0) + 1);
    if (!qtf.size) return [];
    const q = new Map();
    for (const [t, c] of qtf) q.set(t, (1 + Math.log(c)) * this.idf.get(t));
    normalize(q);

    return this.vectors
      .map((vec, i) => {
        let score = 0;
        for (const [t, w] of q) score += w * (vec.get(t) || 0);
        return { chunk: this.chunks[i], score };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topN);
  }
}
