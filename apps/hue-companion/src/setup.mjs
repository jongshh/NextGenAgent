import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { saveConfig, configPath } from "./config.mjs";
import { HueClient, hueRequest } from "./hue-client.mjs";

const rl = createInterface({ input, output });
const agents = [
  ["pathfinder", "길을 찾는 사람"],
  ["creator", "창작하는 사람"],
  ["thinker", "생각하는 사람"],
  ["connector", "용기있는 사람"]
];

try {
  console.log("Philips Hue Bridge와 같은 네트워크에 연결되어 있어야 합니다.");
  const bridges = await discoverBridges();
  const bridgeIp = await chooseBridge(bridges);
  const probe = await hueRequest({ bridgeIp, path: "/api/config" });
  if (!probe.fingerprint) throw new Error("Bridge 인증서 지문을 확인하지 못했습니다.");
  console.log(`Bridge 인증서 지문: ${probe.fingerprint}`);

  console.log("\nHue Bridge의 가운데 링크 버튼을 누르세요.");
  console.log("버튼 입력을 감지하면 자동으로 다음 단계로 넘어갑니다.");
  const credentials = await waitForApplicationKey(bridgeIp, probe.fingerprint);
  const baseConfig = {
    bridgeIp,
    applicationKey: credentials.username,
    certificateFingerprint: probe.fingerprint,
    targets: {}
  };
  const client = new HueClient(baseConfig);
  const lights = await listColorLights(bridgeIp, credentials.username, probe.fingerprint);
  if (lights.length < 4) throw new Error(`컬러 조명은 ${lights.length}개만 발견되었습니다. 4개 이상이 필요합니다.`);

  console.log("\n발견된 컬러 조명:");
  lights.forEach((light, index) => console.log(`  ${index + 1}. ${light.metadata?.name || light.id} (${light.id})`));
  const used = new Set();
  for (const [agentId, title] of agents) {
    const selected = await chooseLight(title, lights, used);
    baseConfig.targets[agentId] = selected.id;
    used.add(selected.id);
    await identifyLight(client, selected.id);
  }

  await saveConfig(baseConfig);
  console.log(`\n설정 완료: ${configPath}`);
  console.log("이제 npm run demo:hue 를 실행하세요.");
} catch (error) {
  process.exitCode = 1;
  console.error(`\nHue 설정 오류: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  rl.close();
}

async function discoverBridges() {
  try {
    const response = await fetch("https://discovery.meethue.com/", { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return [];
    const payload = await response.json();
    return Array.isArray(payload) ? payload.filter((item) => typeof item.internalipaddress === "string") : [];
  } catch {
    return [];
  }
}

async function chooseBridge(bridges) {
  if (bridges.length === 1) {
    console.log(`\nHue Bridge를 자동으로 발견했습니다: ${bridges[0].internalipaddress}`);
    return bridges[0].internalipaddress;
  }
  if (bridges.length > 0) {
    console.log("\n발견된 Bridge:");
    bridges.forEach((bridge, index) => console.log(`  ${index + 1}. ${bridge.internalipaddress} (${bridge.id || "ID 없음"})`));
    const answer = (await rl.question("사용할 번호를 입력하거나, 직접 IP를 입력하세요: ")).trim();
    const index = Number(answer) - 1;
    if (Number.isInteger(index) && bridges[index]) return bridges[index].internalipaddress;
    if (isPrivateAddress(answer)) return answer;
  }
  const manual = (await rl.question("Hue Bridge의 로컬 IP 주소를 입력하세요: ")).trim();
  if (!isPrivateAddress(manual)) throw new Error("유효한 로컬 IPv4 주소가 아닙니다.");
  return manual;
}

async function waitForApplicationKey(bridgeIp, fingerprint) {
  const timeoutSeconds = 45;
  for (let elapsed = 0; elapsed < timeoutSeconds; elapsed += 1) {
    const response = await hueRequest({
      bridgeIp,
      path: "/api",
      method: "POST",
      expectedFingerprint: fingerprint,
      body: { devicetype: "nextgenagent#hue-companion", generateclientkey: true }
    });
    const success = response.data?.find?.((item) => item?.success)?.success;
    if (success?.username) {
      process.stdout.write("\rBridge 버튼을 감지했습니다. 인증 완료.                    \n");
      return success;
    }

    const errors = Array.isArray(response.data)
      ? response.data.map((item) => item?.error).filter(Boolean)
      : [];
    const waitingForButton = errors.some((error) => error.type === 101);
    if (!waitingForButton) {
      process.stdout.write("\n");
      throw new Error(`Hue Bridge 인증에 실패했습니다: ${JSON.stringify(response.data)}`);
    }

    const remaining = timeoutSeconds - elapsed;
    process.stdout.write(`\r가운데 버튼 입력 대기 중... ${remaining}초 `);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1000));
  }

  process.stdout.write("\n");
  throw new Error("45초 동안 Bridge 버튼 입력을 감지하지 못했습니다. 다시 실행해 주세요.");
}

async function listColorLights(bridgeIp, applicationKey, fingerprint) {
  const response = await hueRequest({
    bridgeIp,
    path: "/clip/v2/resource/light",
    applicationKey,
    expectedFingerprint: fingerprint
  });
  if (response.status < 200 || response.status >= 300 || !Array.isArray(response.data?.data)) {
    throw new Error("Hue 조명 목록을 가져오지 못했습니다.");
  }
  return response.data.data.filter((light) => light.type === "light" && light.color?.xy);
}

async function chooseLight(title, lights, used) {
  while (true) {
    const answer = Number((await rl.question(`${title}에 사용할 전구 번호: `)).trim()) - 1;
    const selected = lights[answer];
    if (!selected) {
      console.log("목록에 있는 전구 번호를 입력해 주세요.");
      continue;
    }
    if (used.has(selected.id)) {
      console.log("이미 지정한 전구입니다. 다른 전구를 선택해 주세요.");
      continue;
    }
    return selected;
  }
}

async function identifyLight(client, resourceId) {
  const original = await client.getLight(resourceId);
  await client.setLight(resourceId, {
    on: { on: true },
    dimming: { brightness: 55 },
    color: { xy: { x: 0.48, y: 0.45 } },
    dynamics: { duration: 600 }
  });
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 900));
  const restore = { on: { on: Boolean(original.on?.on) }, dynamics: { duration: 600 } };
  if (typeof original.dimming?.brightness === "number") restore.dimming = { brightness: original.dimming.brightness };
  if (original.color?.xy) restore.color = { xy: original.color.xy };
  await client.setLight(resourceId, restore);
}

function isPrivateAddress(value) {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(value);
  if (!match || match.slice(1).some((part) => Number(part) > 255)) return false;
  const [a, b] = match.slice(1).map(Number);
  return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}
