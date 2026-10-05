import https from "node:https";

export class HueClient {
  async listLights() {
    const response = await hueRequest({ bridgeIp: this.bridgeIp, path: '/clip/v2/resource', applicationKey: this.applicationKey, expectedFingerprint: this.certificateFingerprint });
    ensureHueSuccess(response);
    const resources = response.data?.data || [];
    return resources.filter(item => item.type === 'light').map(light => ({ ...light,
      connectivity: resources.find(item => item.type === 'zigbee_connectivity' && item.owner?.rid === light.owner?.rid)?.status || 'unknown'
    }));
  }
  constructor(config) {
    this.bridgeIp = config.bridgeIp;
    this.applicationKey = config.applicationKey;
    this.certificateFingerprint = normalizeFingerprint(config.certificateFingerprint);
  }

  async getLight(resourceId) {
    const response = await hueRequest({
      bridgeIp: this.bridgeIp,
      path: `/clip/v2/resource/light/${encodeURIComponent(resourceId)}`,
      applicationKey: this.applicationKey,
      expectedFingerprint: this.certificateFingerprint
    });
    ensureHueSuccess(response);
    const light = response.data?.data?.[0];
    if (!light) throw new Error(`Hue light ${resourceId} 응답이 비어 있습니다.`);
    return light;
  }

  async setLight(resourceId, body) {
    const response = await hueRequest({
      bridgeIp: this.bridgeIp,
      path: `/clip/v2/resource/light/${encodeURIComponent(resourceId)}`,
      method: "PUT",
      applicationKey: this.applicationKey,
      expectedFingerprint: this.certificateFingerprint,
      body
    });
    ensureHueSuccess(response);
  }
}

export function hueRequest({
  bridgeIp,
  path,
  method = "GET",
  applicationKey,
  expectedFingerprint,
  body,
  timeoutMs = 5000
}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    let peerFingerprint = "";
    let settled = false;
    const finishReject = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    const request = https.request({
      hostname: bridgeIp,
      port: 443,
      path,
      method,
      agent: false,
      rejectUnauthorized: false,
      timeout: timeoutMs,
      headers: {
        Accept: "application/json",
        Connection: "close",
        ...(applicationKey ? { "hue-application-key": applicationKey } : {}),
        ...(payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {})
      }
    }, (response) => {
      const chunks = [];
      let size = 0;
      response.on("data", (chunk) => {
        size += chunk.length;
        if (size > 1_000_000) {
          response.destroy(new Error("Hue 응답이 제한 크기를 초과했습니다."));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        if (settled) return;
        settled = true;
        const raw = Buffer.concat(chunks).toString("utf8");
        let data = null;
        try {
          data = raw ? JSON.parse(raw) : null;
        } catch {
          reject(new Error("Hue Bridge가 JSON이 아닌 응답을 반환했습니다."));
          return;
        }
        resolve({ status: response.statusCode || 0, data, fingerprint: peerFingerprint });
      });
      response.on("error", finishReject);
    });

    request.on("socket", (socket) => {
      const verifyPeerCertificate = () => {
        const certificate = socket.getPeerCertificate();
        peerFingerprint = normalizeFingerprint(certificate?.fingerprint256 || "");
        if (!peerFingerprint) {
          socket.destroy(new Error("Hue Bridge 인증서 지문을 읽지 못했습니다."));
          return;
        }
        if (expectedFingerprint && peerFingerprint !== normalizeFingerprint(expectedFingerprint)) {
          socket.destroy(new Error("Hue Bridge 인증서가 초기 설정 때와 다릅니다."));
        }
      };

      const existingCertificate = socket.getPeerCertificate();
      if (existingCertificate?.fingerprint256) verifyPeerCertificate();
      else socket.once("secureConnect", verifyPeerCertificate);
    });
    request.on("timeout", () => request.destroy(new Error("Hue Bridge 요청 시간이 초과되었습니다.")));
    request.on("error", finishReject);
    if (payload) request.write(payload);
    request.end();
  });
}

function ensureHueSuccess(response) {
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Hue Bridge 요청 실패 (${response.status})`);
  }
  const errors = response.data?.errors;
  if (Array.isArray(errors) && errors.length > 0) {
    throw new Error(`Hue Bridge 오류: ${JSON.stringify(errors[0])}`);
  }
}

function normalizeFingerprint(value) {
  return String(value).replace(/:/g, "").toUpperCase();
}
