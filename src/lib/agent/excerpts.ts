const MIN_CHUNK_CHARS = 40;
const TARGET_CHUNK_CHARS = 800;
const MAX_BLOCK_CHARS = 1_200;
export const MAX_EXCERPTS_PER_SOURCE = 25;

function readable(block: string): string {
  return block
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function splitLong(block: string): string[] {
  const sentences = block.match(/[^.!?\n]+[.!?]*\s*/g) ?? [block];
  const pieces: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (current && current.length + sentence.length > TARGET_CHUNK_CHARS) {
      pieces.push(current.trim());
      current = "";
    }
    current += sentence;
  }
  if (current.trim()) pieces.push(current.trim());
  return pieces.map((piece) => piece.slice(0, MAX_BLOCK_CHARS));
}

/**
 * Deterministic chunking of page text the server fetched itself. Excerpts are
 * never built from text the agent hands back, because an agent-supplied
 * "excerpt" is model output and could carry a fact the page never stated.
 */
export function chunkMarkdown(markdown: string, maxChunks = MAX_EXCERPTS_PER_SOURCE): string[] {
  const blocks = markdown
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map(readable)
    // Navigation crumbs, lone links and image-only blocks carry nothing citable.
    .filter((block) => block.replace(/[#*_>`|\-\s]/g, "").length >= MIN_CHUNK_CHARS);

  const chunks: string[] = [];
  let current = "";
  const flush = () => {
    if (current.trim()) chunks.push(current.trim());
    current = "";
  };
  for (const block of blocks) {
    if (block.length > MAX_BLOCK_CHARS) {
      flush();
      chunks.push(...splitLong(block));
      continue;
    }
    if (current && current.length + block.length + 1 > TARGET_CHUNK_CHARS) flush();
    current = current ? `${current}\n${block}` : block;
  }
  flush();
  return chunks.slice(0, maxChunks);
}

/** The discovery record as citable text, built only from allowlisted fields. */
export function discoveryEvidenceText(record: Record<string, unknown>): string {
  const field = (key: string) => (typeof record[key] === "string" || typeof record[key] === "number" ? String(record[key]).trim() : "");
  const fromJobAds = field("discovery_source") === "linkedin_job_ads";
  return [
    `Company record from LinkedIn ${fromJobAds ? "job ads" : "company search"} (via Apify) for ${field("company_name")} (${field("domain")}).`,
    field("hiring") && `Open job ads on LinkedIn, posted in the last month: ${field("hiring")}.`,
    field("linkedin_members") && `People on LinkedIn who list this company as their employer: ${field("linkedin_members")}.`,
    field("headcount") && `Size band the company chose for its LinkedIn page: ${field("headcount")}.`,
    field("location") && `Headquarters: ${field("location")}.`,
    field("industry") && `Industry: ${field("industry")}.`,
    field("company_type") && `Company type: ${field("company_type")}.`,
    field("specialities") && `Specialities the company lists: ${field("specialities")}.`,
    field("funding") && `Funding: ${field("funding")}.`,
    field("description") && `Company description: ${field("description")}`,
  ].filter(Boolean).join("\n");
}
