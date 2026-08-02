import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const sourcePath = path.resolve(process.argv[2] || "DB/꿈다락 AI 데이터베이스.pdf");
const varsPath = path.resolve("apps/worker/.dev.vars");
const vars = parseVars(await readFile(varsPath, "utf8"));
const apiKey = vars.OPENAI_API_KEY;
const vectorStoreId = vars.OPENAI_VECTOR_STORE_ID;

if (!apiKey || !vectorStoreId) {
  throw new Error("OPENAI_API_KEY and OPENAI_VECTOR_STORE_ID are required in apps/worker/.dev.vars");
}

const bytes = await readFile(sourcePath);
const filename = path.basename(sourcePath);
const sha256 = createHash("sha256").update(bytes).digest("hex");
const attachedFiles = await listAttachedFiles(vectorStoreId);
const sameSourceFiles = [];

for (const attached of attachedFiles) {
  const fileId = attached.id || attached.file_id;
  if (!fileId) continue;
  const metadata = await openai(`/files/${fileId}`);
  if (metadata.filename === filename) {
    sameSourceFiles.push({ fileId, attributes: attached.attributes || {} });
  }
}

if (sameSourceFiles.some(({ attributes }) => attributes.sha256 === sha256)) {
  console.log(`Vector Store already contains the current ${filename} (${sha256.slice(0, 12)}).`);
  process.exit(0);
}

const uploadForm = new FormData();
uploadForm.set("purpose", "assistants");
uploadForm.set("file", new Blob([bytes], { type: "application/pdf" }), filename);
const uploaded = await openai("/files", { method: "POST", body: uploadForm });

await openai(`/vector_stores/${vectorStoreId}/files`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    file_id: uploaded.id,
    attributes: {
      source: "dream-mentor-db",
      sha256,
      updated_at: "2026-08-02"
    }
  })
});

const deadline = Date.now() + 5 * 60 * 1000;
while (Date.now() < deadline) {
  const status = await openai(`/vector_stores/${vectorStoreId}/files/${uploaded.id}`);
  if (status.status === "completed") {
    for (const stale of sameSourceFiles) {
      await openai(`/vector_stores/${vectorStoreId}/files/${stale.fileId}`, { method: "DELETE" });
    }
    console.log(
      `Indexed ${filename} as ${uploaded.id}; replaced ${sameSourceFiles.length} older attachment(s).`
    );
    process.exit(0);
  }
  if (status.status === "failed" || status.status === "cancelled") {
    throw new Error(`Vector Store ingestion ${status.status}: ${JSON.stringify(status.last_error)}`);
  }
  await new Promise((resolve) => setTimeout(resolve, 2500));
}

throw new Error("Timed out waiting for Vector Store ingestion.");

async function listAttachedFiles(storeId) {
  const files = [];
  let after;
  do {
    const query = new URLSearchParams({ limit: "100" });
    if (after) query.set("after", after);
    const page = await openai(`/vector_stores/${storeId}/files?${query}`);
    files.push(...(page.data || []));
    after = page.has_more ? page.last_id : undefined;
  } while (after);
  return files;
}

async function openai(endpoint, init = {}) {
  const response = await fetch(`https://api.openai.com/v1${endpoint}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(init.headers || {})
    }
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`OpenAI ${response.status}: ${payload?.error?.message || "request failed"}`);
  }
  return payload;
}

function parseVars(raw) {
  return Object.fromEntries(
    raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
      })
  );
}
