// ═══════════════════════════════════════════════════
// Robust JSON extraction from LLM output.
//
// Every "Return ONLY JSON" prompt in this app used to just strip markdown
// code fences before JSON.parse. That's not enough — Haiku in particular
// sometimes prefixes its answer with a sentence of prose ("The existing
// claims suggest...") or a markdown bullet ("* Looking at...") despite the
// instruction, and a bare fence-strip leaves that text in place, so
// JSON.parse throws "Unexpected token T/word at position N". Every call site
// caught this in a try/catch and silently gave up — for the Memory conflict
// checker specifically, that meant a parse failure was indistinguishable
// from "no conflict found", so genuinely conflicting/duplicate facts about
// the same entity never got cross-referenced and just piled up as separate
// nodes instead. This helper strips fences AND extracts the first balanced
// {...} or [...] block, so leading/trailing prose around valid JSON no
// longer breaks parsing.
// ═══════════════════════════════════════════════════
export function parseJSON(raw, fallback = {}) {
  if (!raw) return fallback;
  let text = raw.trim().replace(/```json|```/g, "").trim();
  try { return JSON.parse(text); } catch {}

  const hasBrace = text.indexOf("{") !== -1;
  const hasBracket = text.indexOf("[") !== -1;
  if (!hasBrace && !hasBracket) return fallback;
  const openChar = !hasBrace ? "[" : (!hasBracket ? "{" : (text.indexOf("{") < text.indexOf("[") ? "{" : "["));
  const closeChar = openChar === "{" ? "}" : "]";
  const start = text.indexOf(openChar);
  if (start === -1) return fallback;

  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === openChar) depth++;
    else if (text[i] === closeChar) {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(text.slice(start, i + 1)); } catch { return fallback; }
      }
    }
  }
  return fallback;
}
