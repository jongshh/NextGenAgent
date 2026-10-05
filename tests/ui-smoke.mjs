import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const baseUrl = process.env.E2E_BASE_URL ?? "http://localhost:5173";
const outputDir = path.resolve("artifacts/screenshots");
const runId = Date.now().toString(36);
await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ channel: "msedge", headless: true });
const results = {};

try {
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await desktop.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.screenshot({ path: path.join(outputDir, "session-gate-desktop.png"), fullPage: true });
  await page.getByRole("textbox", { name: "참여 ID", exact: true }).fill(`desktop-${runId}`);
  await page.getByRole("button", { name: "참여 ID로 계속", exact: true }).click();
  await page.getByTestId("mentor-pathfinder").waitFor({ state: "visible" });
  const defaultVersionA = await page.getByTestId("ui-version-a").getAttribute("aria-selected");
  await page.screenshot({ path: path.join(outputDir, "hub-desktop.png"), fullPage: true });

  const mentorIds = ["pathfinder", "creator", "thinker", "connector"];
  const activeMentors = [];
  for (const mentorId of mentorIds) {
    const cardButton = page.getByTestId(`mentor-${mentorId}`);
    activeMentors.push({ mentorId, enabled: await cardButton.isEnabled() });
  }

  await page.getByTestId("mentor-pathfinder").click();
  await page.getByTestId("dialogue-box").click();
  await page.getByLabel("선배에게 보낼 말").fill("첫 줄");
  await page.getByLabel("선배에게 보낼 말").press("Shift+Enter");
  const shiftEnterWorks = (await page.getByLabel("선배에게 보낼 말").inputValue()).includes("\n");

  await page.getByLabel("선배에게 보낼 말").fill(
    "저는 곧 대학을 졸업하는데 무엇을 준비해야 할까요?"
  );
  await page.getByLabel("선배에게 보낼 말").press("Enter");
  await page.locator(".thinking-line").waitFor({ state: "visible", timeout: 5000 });
  const thinkingDotsA = await page.locator(".thinking-line .thinking-dots > span").count();
  await page.locator(".thinking-line").waitFor({ state: "hidden", timeout: 90000 });
  await page.getByTestId("choice-1").waitFor({ state: "visible", timeout: 90000 });
  await page.getByTestId("dialogue-box").click();
  await page.waitForFunction(() => {
    const image = document.querySelector(".mentor-portrait img");
    return image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0;
  });
  await page.waitForTimeout(500);

  const choices = await page.locator('[data-testid^="choice-"]').count();
  await page.screenshot({
    path: path.join(outputDir, "conversation-desktop.png"),
    fullPage: true
  });

  await page.getByLabel("이 답변의 바탕 열기").click();
  const sourceDrawer = page.getByRole("dialog", { name: "이 답변의 바탕" });
  await sourceDrawer.waitFor({ state: "visible" });
  await page.waitForTimeout(650);
  const sourceDrawerVisible = await sourceDrawer.isVisible();
  await page.screenshot({
    path: path.join(outputDir, "sources-desktop.png"),
    fullPage: true
  });
  await sourceDrawer.getByLabel("이 답변의 바탕 닫기").click();

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId('dialogue-box').waitFor({ state: 'visible' });
  const sessionRestored = await page.getByTestId("dialogue-box").isVisible();

  await page.getByLabel("선배 선택으로 돌아가기").click();
  await page.getByTestId("ui-version-b").click();
  await page.getByTestId("mentor-pathfinder").click();
  await page.getByTestId("conversation-b-transcript").waitFor({ state: "visible" });
  const sharedSessionInB =
    (await page.getByTestId("user-turn").count()) > 0 &&
    (await page.getByTestId("assistant-turn").count()) > 1;

  const userBubble = page.locator(".conversation-b-line.user").last();
  const assistantBubble = page.locator(".conversation-b-line.assistant").last();
  const userBox = await userBubble.boundingBox();
  const assistantBox = await assistantBubble.boundingBox();
  const dmAlignmentWorks = Boolean(userBox && assistantBox && userBox.x > assistantBox.x);

  await page.getByLabel("선배에게 보낼 말").fill("졸업 뒤 첫 선택이 계속 두려워요.");
  await page.getByLabel("선배에게 보낼 말").press("Enter");
  await page.locator(".conversation-b-thinking").waitFor({ state: "visible", timeout: 5000 });
  const thinkingDotsB = await page.locator(".conversation-b-thinking .thinking-dots > span").count();
  await page.locator(".conversation-b-thinking").waitFor({ state: "hidden", timeout: 90000 });
  const latestAssistantTurn = page.getByTestId("assistant-turn").last();
  await latestAssistantTurn.locator(".conversation-b-line.assistant").first().waitFor({ state: "visible" });
  const stagedSentenceCount = await latestAssistantTurn.locator(".conversation-b-line.assistant").count();
  await page.getByTestId("conversation-b-transcript").click({ position: { x: 400, y: 100 } });
  await page.getByTestId("choice-b-1").waitFor({ state: "visible", timeout: 10000 });
  const completedSentenceCount = await latestAssistantTurn.locator(".conversation-b-line.assistant").count();
  const sentenceRevealWorks = stagedSentenceCount < completedSentenceCount;

  await latestAssistantTurn.getByLabel("길을 찾는 사람 답변의 바탕 열기").click();
  const sourceDrawerB = page.getByRole("dialog", { name: "이 답변의 바탕" });
  await sourceDrawerB.waitFor({ state: "visible" });
  const sourceDrawerBVisible = await sourceDrawerB.isVisible();
  await sourceDrawerB.getByLabel("이 답변의 바탕 닫기").click();

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId('conversation-b-transcript').waitFor({ state: 'visible' });
  const versionBRestored = await page.getByTestId("conversation-b-transcript").isVisible();
  await page.screenshot({
    path: path.join(outputDir, "conversation-b-desktop.png"),
    fullPage: true
  });

  results.desktop = {
    choices,
    thinkingDotsA,
    thinkingDotsB,
    shiftEnterWorks,
    sourceDrawerVisible,
    sessionRestored,
    activeMentors,
    defaultVersionA,
    sharedSessionInB,
    dmAlignmentWorks,
    sentenceRevealWorks,
    sourceDrawerBVisible,
    versionBRestored,
    pageErrors
  };
  await desktop.close();

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mobilePage = await mobile.newPage();
  await mobilePage.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await mobilePage.getByRole("textbox", { name: "참여 ID", exact: true }).fill(`mobile-${runId}`);
  await mobilePage.getByRole("button", { name: "참여 ID로 계속", exact: true }).click();
  await mobilePage.getByTestId("mentor-pathfinder").waitFor({ state: "visible" });
  await mobilePage.getByTestId("mentor-pathfinder").click();
  await mobilePage.getByTestId("dialogue-box").click();
  await mobilePage.locator(".mentor-portrait").waitFor({ state: "visible" });
  await mobilePage.waitForTimeout(500);

  const keySelectors = [
    ".conversation-toolbar",
    ".mentor-portrait",
    '[data-testid="dialogue-box"]',
    ".conversation-composer"
  ];
  const viewportChecks = [];
  for (const selector of keySelectors) {
    const box = await mobilePage.locator(selector).boundingBox();
    viewportChecks.push({
      selector,
      box,
      visible: Boolean(
        box &&
          box.x >= 0 &&
          box.y >= 0 &&
          box.x + box.width <= 390 &&
          box.y < 844
      )
    });
  }

  await mobilePage.screenshot({
    path: path.join(outputDir, "conversation-mobile.png"),
    fullPage: true
  });
  results.mobile = { viewportChecks };
  await mobile.close();

  const mobileB = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mobileBPage = await mobileB.newPage();
  await mobileBPage.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await mobileBPage.getByRole("textbox", { name: "참여 ID", exact: true }).fill(`mobile-b-${runId}`);
  await mobileBPage.getByRole("button", { name: "참여 ID로 계속", exact: true }).click();
  await mobileBPage.getByTestId("mentor-pathfinder").waitFor({ state: "visible" });
  await mobileBPage.getByTestId("ui-version-b").click();
  await mobileBPage.getByTestId("mentor-pathfinder").click();
  await mobileBPage.getByTestId("conversation-b-transcript").waitFor({ state: "visible" });
  await mobileBPage.waitForTimeout(900);

  const mobileBSelectors = [
    ".conversation-b-toolbar",
    ".conversation-b-line.assistant",
    ".conversation-b-composer"
  ];
  const mobileBViewportChecks = [];
  for (const selector of mobileBSelectors) {
    const box = await mobileBPage.locator(selector).first().boundingBox();
    mobileBViewportChecks.push({
      selector,
      box,
      visible: Boolean(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= 390 && box.y < 844)
    });
  }
  await mobileBPage.screenshot({
    path: path.join(outputDir, "conversation-b-mobile.png"),
    fullPage: true
  });
  results.mobileB = { viewportChecks: mobileBViewportChecks };
  await mobileB.close();

  const passed =
    results.desktop.choices === 3 &&
    results.desktop.thinkingDotsA === 3 &&
    results.desktop.thinkingDotsB === 3 &&
    results.desktop.shiftEnterWorks &&
    results.desktop.sourceDrawerVisible &&
    results.desktop.sessionRestored &&
    results.desktop.defaultVersionA === "true" &&
    results.desktop.sharedSessionInB &&
    results.desktop.dmAlignmentWorks &&
    results.desktop.sentenceRevealWorks &&
    results.desktop.sourceDrawerBVisible &&
    results.desktop.versionBRestored &&
    results.desktop.activeMentors.every((mentor) => mentor.enabled) &&
    results.desktop.pageErrors.length === 0 &&
    results.mobile.viewportChecks.every((check) => check.visible) &&
    results.mobileB.viewportChecks.every((check) => check.visible);

  console.log(JSON.stringify({ passed, ...results }, null, 2));
  if (!passed) process.exitCode = 1;
} finally {
  await browser.close();
}
