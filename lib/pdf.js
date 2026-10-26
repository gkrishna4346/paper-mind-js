// PDF text extraction (replaces pypdf).
// Returns one string per page so answers can cite page numbers.
import { extractText, getDocumentProxy } from "unpdf";

export async function extractPages(buffer) {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  const pages = (Array.isArray(text) ? text : [text]).map((t) =>
    (t || "")
      .replace(/\u0000/g, "")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
  return { totalPages, pages };
}
