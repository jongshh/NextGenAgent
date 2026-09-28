import { createReadStream } from "node:fs";
import { access } from "node:fs/promises";
import http from "node:http";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { Readable } from "node:stream";
import { loadConfig, configPath } from "./config.mjs";
import { HueClient } from "./hue-client.mjs";
import { HueEffectController, validatePlayRequest } from "./effects.mjs";

const host = "127.0.0.1";
const port = Number(process.env.NEXTGEN_HUE_PORT || 4173);
const origin = `http://${host}:${port}`;
const allowedOrigins = new Set([origin, `http://localhost:${port}`]);
const upstreamUrl = (process.env.NEXTGEN_WORKER_URL || "https://nextgenagent-worker.jsindustriests.workers.dev").replace(/\/$/, "");
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const webRoot = resolve(repoRoot, "apps", "web", "dist");
const sessionToken = randomBytes(32).toString("base64url");
const recentResponses = new Set();

let hueController = null;
let setupError = null;
try {
  const config = await loadConfig();
  hueController = new HueEffectController(new HueClient(config), config.targets);
} catch (error) {
  setupError = error instanceof Error ? error.message : String(error);
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", origin);
    if (!isLocalHost(request.headers.host)) return sendJson(response, 403, { error: "invalid_host" });

    if (url.pathname.startsWith("/api/")) {
      if (!authorizeBrowserRequest(request)) return sendJson(response, 403, { error: "forbidden" });
      if (url.pathname.startsWith("/api/hue/")) return await handleHue(request, response, url);
      return await proxyApi(request, response, url);
    }

    return await serveWeb(response, url.pathname);
  } catch (error) {
    console.error(JSON.stringify({ message: "Hue Companion 요청 실패", error: error instanceof Error ? error.message : String(error) }));
    const status = error instanceof RequestError ? error.status : 500;
    if (!response.headersSent) sendJson(response, status, { error: error instanceof RequestError ? error.message : "internal_error" });
    else response.end();
  }
});

server.listen(port, host, () => {
  console.log(`NextGenAgent Hue Companion: ${origin}`);
  console.log(hueController ? "Hue 설정을 불러왔습니다." : `Hue 설정 필요: npm run hue:setup (${setupError || configPath})`);
});

async function handleHue(request, response, url) {
  if (request.method === "GET" && url.pathname === "/api/hue/status") {
    if (!hueController) return sendJson(response, 200, { connected: false, configured: false, message: setupError });
    try {
      await hueController.status();
      return sendJson(response, 200, { connected: true, configured: true });
    } catch (error) {
      return sendJson(response, 200, { connected: false, configured: true, message: error instanceof Error ? error.message : String(error) });
    }
  }

  if (request.method === "POST" && url.pathname === "/api/hue/play") {
    if (!hueController) return sendJson(response, 503, { error: "hue_not_configured" });
    const body = await readJsonBody(request);
    const playRequest = validatePlayRequest(body);
    if (!playRequest) return sendJson(response, 400, { error: "invalid_light_cue" });
    if (recentResponses.has(playRequest.responseId)) return sendJson(response, 200, { ok: true, duplicate: true });

    await hueController.play(playRequest);
    rememberResponse(playRequest.responseId);
    return sendJson(response, 202, { ok: true });
  }

  if (request.method === "POST" && url.pathname === "/api/hue/stop") {
    const responseId = url.searchParams.get("responseId");
    if (responseId && responseId.length > 160) return sendJson(response, 400, { error: "invalid_response_id" });
    await hueController?.stop(responseId || undefined);
    return sendJson(response, 200, { ok: true });
  }

  return sendJson(response, 404, { error: "not_found" });
}

async function proxyApi(request, response, url) {
  const body = request.method === "GET" || request.method === "HEAD" ? undefined : await readBody(request, 1_000_000);
  const upstreamOrigin = new URL(upstreamUrl).origin;
  const upstream = await fetch(`${upstreamUrl}${url.pathname}${url.search}`, {
    method: request.method,
    headers: {
      Accept: request.headers.accept || "application/json",
      Origin: upstreamOrigin,
      ...(request.headers["content-type"] ? { "Content-Type": request.headers["content-type"] } : {}),
      ...(request.headers.cookie ? { Cookie: request.headers.cookie } : {})
    },
    body
  });
  const headers = {
    "Content-Type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  };
  const setCookies = typeof upstream.headers.getSetCookie === "function"
    ? upstream.headers.getSetCookie()
    : [upstream.headers.get("set-cookie")].filter(Boolean);
  if (setCookies.length > 0) {
    // The companion is bound to local HTTP only. Preserve HttpOnly/SameSite while
    // removing Secure so the upstream admin session cookie can be stored locally.
    headers["Set-Cookie"] = setCookies.map((cookie) => cookie.replace(/;\s*Secure/gi, ""));
  }
  response.writeHead(upstream.status, headers);
  if (!upstream.body) return response.end();
  Readable.fromWeb(upstream.body).pipe(response);
}

async function serveWeb(response, pathname) {
  let relativePath;
  try {
    relativePath = decodeURIComponent(pathname).replace(/^\/+/, "");
  } catch {
    return sendJson(response, 400, { error: "bad_path" });
  }
  const candidate = resolve(webRoot, relativePath || "index.html");
  const safeCandidate = candidate === webRoot || candidate.startsWith(`${webRoot}${sep}`);
  let filePath = safeCandidate ? candidate : resolve(webRoot, "index.html");
  try {
    await access(filePath);
  } catch {
    filePath = resolve(webRoot, "index.html");
  }

  const extension = extname(filePath).toLowerCase();
  const mime = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".webp": "image/webp"
  }[extension] || "application/octet-stream";
  response.writeHead(200, {
    "Content-Type": mime,
    "Cache-Control": extension === ".html" ? "no-store" : "public, max-age=3600",
    "Set-Cookie": `hue_session=${sessionToken}; HttpOnly; SameSite=Strict; Path=/`
  });
  createReadStream(filePath).pipe(response);
}

function authorizeBrowserRequest(request) {
  const originHeader = request.headers.origin;
  if (originHeader) {
    if (!allowedOrigins.has(originHeader)) return false;
  } else {
    const secFetchSite = request.headers["sec-fetch-site"];
    if (secFetchSite && secFetchSite !== "same-origin" && secFetchSite !== "none") return false;
    const referer = request.headers.referer;
    if (referer) {
      try {
        const refererOrigin = new URL(referer).origin;
        if (!allowedOrigins.has(refererOrigin)) return false;
      } catch {
        return false;
      }
    }
  }

  const cookies = Object.fromEntries((request.headers.cookie || "").split(";").map((part) => {
    const index = part.indexOf("=");
    return index < 0 ? [part.trim(), ""] : [part.slice(0, index).trim(), part.slice(index + 1)];
  }));
  return safeEqual(cookies.hue_session || "", sessionToken);
}

function isLocalHost(value) {
  return value === `${host}:${port}` || value === `localhost:${port}`;
}

function safeEqual(left, right) {
  const leftHash = Buffer.from(left.padEnd(right.length, "\0").slice(0, right.length));
  const rightHash = Buffer.from(right);
  return left.length === right.length && timingSafeEqual(leftHash, rightHash);
}

async function readJsonBody(request) {
  const body = await readBody(request, 64_000);
  try {
    return JSON.parse(body.toString("utf8"));
  } catch {
    throw new RequestError(400, "invalid_json");
  }
}

function readBody(request, limit) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        request.destroy();
        reject(new RequestError(413, "body_too_large"));
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolveBody(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function rememberResponse(responseId) {
  recentResponses.add(responseId);
  if (recentResponses.size > 100) recentResponses.delete(recentResponses.values().next().value);
}

function sendJson(response, status, value) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(value));
}

class RequestError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
  }
}

async function shutdown(signal) {
  console.log(`${signal}: Hue 상태를 복원하고 종료합니다.`);
  await hueController?.stop().catch((error) => console.error(error));
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 4000).unref();
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
