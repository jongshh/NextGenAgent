import assert from "node:assert/strict";
import test from "node:test";
import { splitIntoSpokenSentences } from "../apps/web/src/text";

test("spoken text is split into Korean sentence bubbles", () => {
  assert.deepEqual(
    splitIntoSpokenSentences("나도 고민했어요. 그래도 작은 일부터 시작했죠! 지금은 어떤가요?"),
    ["나도 고민했어요.", "그래도 작은 일부터 시작했죠!", "지금은 어떤가요?"]
  );
});

test("blank lines do not create empty bubbles", () => {
  assert.deepEqual(splitIntoSpokenSentences("첫 문장입니다.\n\n둘째 문장입니다."), [
    "첫 문장입니다.",
    "둘째 문장입니다."
  ]);
});
