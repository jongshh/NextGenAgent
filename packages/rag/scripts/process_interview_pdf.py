from __future__ import annotations

import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path

from pypdf import PdfReader


PERSON_STARTS = [
    ("miyamoto-shigeru", "미야모토 시게루", "미야모토 시게루"),
    ("jensen-huang", "젠슨 황", "젠슨 황"),
    ("mark-zuckerberg", "마크 저커버그", "마크 저커버그"),
    ("elon-musk", "일론 머스크", "일론 머스크"),
    ("satoru-iwata", "이와타 사토루", "이와타 사토루"),
]

SECTION_PATTERNS = [
    ("초기 환경", ["어린 시절", "성장", "유학", "초기", "대학", "교육"]),
    ("어려움", ["실패", "위기", "좌절", "부진", "존폐", "징계", "차별", "폭력"]),
    ("선택/전환점", ["선택", "전환점", "기회", "입사", "창업", "설립", "결심", "이전"]),
    ("창작/기술 철학", ["철학", "기술", "재미", "경험", "서비스", "제품", "조작", "탐험"]),
    ("직접 발언", ["“", "”", "인터뷰", "말합니다", "회상합니다", "설명합니다"]),
    ("현재적 해석", ["평가", "의미", "상징", "영향", "이유"]),
]

THEME_KEYWORDS = {
    "선택": ["선택", "결심", "판단", "기준"],
    "진로 전환": ["진로", "입사", "이직", "전환", "창업", "사장"],
    "실패 극복": ["실패", "위기", "좌절", "부진", "극복", "생존"],
    "장기 관점": ["장기", "미래", "비전", "로드맵", "언젠가", "끝까지"],
    "동료/환경 선택": ["동료", "팀원", "친구", "환경", "회사", "함께"],
    "창작": ["창작", "만화", "게임", "아이디어", "작품"],
    "기술": ["기술", "프로그래밍", "칩", "GPU", "로켓", "코딩"],
    "사람": ["사람", "사용자", "플레이어", "학생", "서비스"],
}


@dataclass
class PageText:
    page: int
    text: str


@dataclass
class PersonFragment:
    person_id: str
    person_name: str
    page: int
    text: str


def normalize_text(text: str) -> str:
    text = text.replace("\u3000", " ")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n\s*\n+", "\n", text)
    text = re.sub(r" *\n *", "\n", text)
    return text.strip()


def compact_for_chunk(text: str) -> str:
    text = re.sub(r"\s+", " ", text)
    text = re.sub(r"\s+([,.!?])", r"\1", text)
    return text.strip()


def split_person_fragments(pages: list[PageText]) -> list[PersonFragment]:
    fragments: list[PersonFragment] = []
    current_person: tuple[str, str] | None = None

    for page in pages:
        headings: list[tuple[int, int, str, str]] = []
        for person_id, person_name, heading in PERSON_STARTS:
            for match in re.finditer(re.escape(heading), page.text):
                headings.append((match.start(), match.end(), person_id, person_name))
        headings.sort(key=lambda item: item[0])

        if not headings:
            if current_person and page.text.strip():
                fragments.append(PersonFragment(current_person[0], current_person[1], page.page, page.text))
            continue

        first_start = headings[0][0]
        if current_person and first_start > 0:
            before_heading = page.text[:first_start].strip()
            if before_heading:
                fragments.append(PersonFragment(current_person[0], current_person[1], page.page, before_heading))

        for index, (_start, end, person_id, person_name) in enumerate(headings):
            next_start = headings[index + 1][0] if index + 1 < len(headings) else len(page.text)
            body = page.text[end:next_start].strip()
            current_person = (person_id, person_name)
            if body:
                fragments.append(PersonFragment(person_id, person_name, page.page, body))

    return fragments


def infer_section_title(text: str) -> str:
    sample = text[:300]
    best_title = "현재적 해석"
    best_hits = -1
    for title, keywords in SECTION_PATTERNS:
        hits = sum(1 for keyword in keywords if keyword in sample or keyword in text)
        if hits > best_hits:
            best_title = title
            best_hits = hits
    return best_title


def infer_life_stage(section_title: str, text: str) -> str:
    if section_title == "초기 환경":
        return "youth"
    if "창업" in text or "입사" in text or "설립" in text:
        return "early_career"
    if section_title == "어려움":
        return "hardship"
    if section_title == "선택/전환점":
        return "turning_point"
    return "reflection"


def infer_theme_tags(text: str) -> list[str]:
    tags = []
    for tag, keywords in THEME_KEYWORDS.items():
        if any(keyword in text for keyword in keywords):
            tags.append(tag)
    return tags or ["현재적 해석"]


def infer_quote_level(text: str) -> str:
    if "“" in text and "”" in text:
        return "direct_quote"
    if "말합니다" in text or "회상합니다" in text or "설명합니다" in text or "인터뷰" in text:
        return "paraphrase"
    return "summary"


def infer_confidence(text: str, quote_level: str) -> str:
    uncertainty_markers = ["원문 인터뷰까지 직접 확인", "가장 안전합니다", "전해집니다", "알려져 있습니다"]
    if any(marker in text for marker in uncertainty_markers):
        return "low"
    if quote_level == "direct_quote":
        return "high"
    return "medium"


def split_page_chunks(text: str) -> list[str]:
    paragraphs = [compact_for_chunk(part) for part in re.split(r"\n+", text) if compact_for_chunk(part)]
    chunks: list[str] = []
    buffer: list[str] = []
    size = 0
    for paragraph in paragraphs:
        buffer.append(paragraph)
        size += len(paragraph)
        if size >= 700:
            chunks.append(" ".join(buffer))
            buffer = []
            size = 0
    if buffer:
        chunks.append(" ".join(buffer))
    return [chunk for chunk in chunks if len(chunk) >= 80]


def build_chunks(source_pdf: Path) -> list[dict]:
    reader = PdfReader(str(source_pdf))
    pages = [
        PageText(index + 1, normalize_text(page.extract_text() or ""))
        for index, page in enumerate(reader.pages)
    ]
    fragments = split_person_fragments(pages)
    chunks: list[dict] = []

    for fragment in fragments:
        for local_index, content in enumerate(split_page_chunks(fragment.text), start=1):
            section_title = infer_section_title(content)
            quote_level = infer_quote_level(content)
            chunks.append(
                {
                    "id": f"{fragment.person_id}-p{fragment.page:02d}-{local_index:02d}",
                    "personId": fragment.person_id,
                    "personName": fragment.person_name,
                    "agentIds": ["pathfinder"],
                    "sectionTitle": section_title,
                    "lifeStage": infer_life_stage(section_title, content),
                    "themeTags": infer_theme_tags(content),
                    "sourceFile": source_pdf.as_posix(),
                    "pageRange": [fragment.page, fragment.page],
                    "quoteLevel": quote_level,
                    "confidence": infer_confidence(content, quote_level),
                    "content": content,
                }
                )
    return chunks


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("Usage: process_interview_pdf.py <source.pdf> <output.json>")

    source_pdf = Path(sys.argv[1])
    output_path = Path(sys.argv[2])
    output_path.parent.mkdir(parents=True, exist_ok=True)
    chunks = build_chunks(source_pdf)
    output_path.write_text(json.dumps(chunks, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {len(chunks)} chunks to {output_path}")


if __name__ == "__main__":
    main()
