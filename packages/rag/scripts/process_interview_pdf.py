from __future__ import annotations

import json
import re
import sys
import hashlib
from dataclasses import dataclass
from pathlib import Path

from pypdf import PdfReader


AGENT_TITLES = {
    "길을 찾는 사람": "pathfinder",
    "창작하는 사람": "creator",
    "생각하는 사람": "thinker",
    "연결하는 사람": "connector",
    "용기있는 사람": "connector",
}

PEOPLE_BY_AGENT = {
    "pathfinder": [
        ("miyamoto-shigeru", "미야모토 시게루"),
        ("jensen-huang", "젠슨 황"),
        ("mark-zuckerberg", "마크 저커버그"),
        ("elon-musk", "일론 머스크"),
        ("satoru-iwata", "이와타 사토루"),
    ],
    "creator": [
        ("paik-nam-june", "백남준"),
        ("bong-joon-ho", "봉준호"),
        ("tim-burton", "팀 버튼"),
        ("ludwig-van-beethoven", "베토벤"),
        ("jean-luc-godard", "장 뤽 고다르"),
    ],
    "thinker": [
        ("friedrich-nietzsche", "니체"),
        ("gautama-buddha", "석가모니"),
        ("alain-de-botton", "알랭 드 보통"),
        ("socrates", "소크라테스"),
        ("confucius", "공자"),
    ],
    "connector": [
        ("leonardo-da-vinci", "다빈치"),
        ("douglas-engelbart", "더글러스 엥겔바트"),
        ("king-sejong", "세종대왕"),
        ("thomas-edison", "에디슨"),
        ("james-watt", "제임스 와트"),
    ],
}

PERSON_LOOKUP = {
    agent_id: {person_name: (person_id, person_name) for person_id, person_name in people}
    for agent_id, people in PEOPLE_BY_AGENT.items()
}

# These heading pages were checked against the current four source PDFs.
PERSON_LOOKUP["creator"].update({"반 고흐": ("vincent-van-gogh", "반 고흐"), "백희나": ("baek-hee-na", "백희나")})
PERSON_LOOKUP["thinker"].update({"디오게네스": ("diogenes", "디오게네스"), "예수": ("jesus", "예수")})
PERSON_LOOKUP["connector"] = {
    name: (person_id, name) for person_id, name in [
        ("roald-amundsen", "아문센"), ("um-hong-gil", "엄홍길"),
        ("charles-lindbergh", "찰스 린드버그"), ("neil-armstrong", "닐 암스트롱"), ("yuri-gagarin", "유리 가가린")
    ]
}

SECTION_PATTERNS = [
    ("초기 환경", ["어린 시절", "유년", "성장", "유학", "초기", "대학", "교육"]),
    ("어려움", ["실패", "위기", "좌절", "부진", "갈등", "질병", "차별", "폭력", "고뇌"]),
    ("선택/전환점", ["선택", "전환점", "기회", "입사", "창업", "설립", "결심", "이전"]),
    ("창작/기술 철학", ["철학", "기술", "창작", "예술", "재미", "경험", "서비스", "제품"]),
    ("직접 발언", ["“", "”", '"', "인터뷰", "말합니다", "회상합니다", "설명합니다"]),
    ("현재적 해석", ["평가", "의미", "상징", "영향", "이유", "유산"]),
]

THEME_KEYWORDS = {
    "선택": ["선택", "결심", "판단", "기준"],
    "진로 전환": ["진로", "입사", "이직", "전환", "창업", "사장"],
    "실패 극복": ["실패", "위기", "좌절", "부진", "극복", "생존"],
    "장기 관점": ["장기", "미래", "비전", "로드맵", "언젠가", "끝까지"],
    "동료/환경 선택": ["동료", "팀원", "친구", "환경", "회사", "함께"],
    "창작": ["창작", "예술", "만화", "영화", "음악", "아이디어", "작품"],
    "완벽주의": ["완벽", "수정", "반복", "개선", "다시"],
    "자기 회복": ["회복", "인내", "고통", "절망", "극복"],
    "삶의 태도": ["삶", "태도", "살아", "인생", "성찰"],
    "철학": ["철학", "가치", "윤리", "진리", "지혜"],
    "책임": ["책임", "의무", "올바른", "도덕"],
    "기술": ["기술", "프로그래밍", "칩", "GPU", "기계", "발명", "공학"],
    "사람": ["사람", "인간", "사용자", "플레이어", "학생", "백성"],
    "서비스": ["서비스", "제품", "도구", "사용", "고객"],
    "커뮤니티": ["공동체", "사회", "협업", "집단", "소통"],
    "접근성": ["누구나", "대중", "접근", "직관", "쉬운"],
}


@dataclass
class PageText:
    page: int
    text: str


@dataclass
class PersonFragment:
    agent_id: str
    person_id: str
    person_name: str
    page: int
    text: str


def normalize_text(text: str) -> str:
    text = text.replace("\u3000", " ").replace("\x00", " ")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n\s*\n+", "\n", text)
    text = re.sub(r" *\n *", "\n", text)
    return text.strip()


def compact_for_chunk(text: str) -> str:
    text = re.sub(r"\s+", " ", text)
    text = re.sub(r"\s+([,.!?])", r"\1", text)
    return text.strip()


def page_label(text: str) -> str:
    return compact_for_chunk(text).strip(" .")


def split_structured_fragments(pages: list[PageText], forced_agent: str | None = None) -> list[PersonFragment]:
    fragments: list[PersonFragment] = []
    current_agent: str | None = forced_agent
    current_person: tuple[str, str] | None = None

    for page in pages:
        label = page_label(page.text)
        if label in AGENT_TITLES:
            if forced_agent and AGENT_TITLES[label] != forced_agent:
                raise ValueError("PDF role does not match sources.json")
            current_agent = AGENT_TITLES[label]
            current_person = None
            continue

        if current_agent and label in PERSON_LOOKUP[current_agent]:
            current_person = PERSON_LOOKUP[current_agent][label]
            continue

        if not current_agent or not current_person or not label:
            continue

        body = page.text
        body = re.sub(rf"^{re.escape(current_person[1])}\s*\n?", "", body, count=1).strip()
        if body:
            fragments.append(
                PersonFragment(
                    current_agent,
                    current_person[0],
                    current_person[1],
                    page.page,
                    body,
                )
            )

    return fragments


def split_legacy_fragments(pages: list[PageText]) -> list[PersonFragment]:
    fragments: list[PersonFragment] = []
    current_person: tuple[str, str] | None = None
    legacy_people = PEOPLE_BY_AGENT["pathfinder"]

    for page in pages:
        headings: list[tuple[int, int, str, str]] = []
        for person_id, person_name in legacy_people:
            for match in re.finditer(re.escape(person_name), page.text):
                headings.append((match.start(), match.end(), person_id, person_name))
        headings.sort(key=lambda item: item[0])

        if not headings:
            if current_person and page.text:
                fragments.append(
                    PersonFragment("pathfinder", current_person[0], current_person[1], page.page, page.text)
                )
            continue

        if current_person and headings[0][0] > 0:
            before_heading = page.text[: headings[0][0]].strip()
            if before_heading:
                fragments.append(
                    PersonFragment("pathfinder", current_person[0], current_person[1], page.page, before_heading)
                )

        for index, (_start, end, person_id, person_name) in enumerate(headings):
            next_start = headings[index + 1][0] if index + 1 < len(headings) else len(page.text)
            body = page.text[end:next_start].strip()
            current_person = (person_id, person_name)
            if body:
                fragments.append(PersonFragment("pathfinder", person_id, person_name, page.page, body))

    return fragments


def infer_section_title(text: str) -> str:
    best_title = "현재적 해석"
    best_hits = -1
    for title, keywords in SECTION_PATTERNS:
        hits = sum(1 for keyword in keywords if keyword in text)
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
    tags = [tag for tag, keywords in THEME_KEYWORDS.items() if any(keyword in text for keyword in keywords)]
    return tags or ["현재적 해석"]


def infer_quote_level(text: str) -> str:
    if ("“" in text and "”" in text) or text.count('"') >= 2:
        return "direct_quote"
    if any(marker in text for marker in ["말합니다", "회상합니다", "설명합니다", "인터뷰"]):
        return "paraphrase"
    return "summary"


def infer_confidence(text: str, quote_level: str) -> str:
    uncertainty_markers = [
        "원문 인터뷰까지 직접 확인",
        "가장 안전합니다",
        "전해집니다",
        "알려져 있습니다",
        "wikipedia",
    ]
    if any(marker in text.lower() for marker in uncertainty_markers):
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


def build_chunks(source_pdf: Path, agent_id: str | None = None) -> list[dict]:
    reader = PdfReader(str(source_pdf))
    pages = [
        PageText(index + 1, normalize_text(page.extract_text() or ""))
        for index, page in enumerate(reader.pages)
    ]
    is_structured = any(page_label(page.text) in AGENT_TITLES for page in pages)
    fragments = split_structured_fragments(pages, agent_id) if is_structured or agent_id else split_legacy_fragments(pages)
    chunks: list[dict] = []

    for fragment in fragments:
        for local_index, content in enumerate(split_page_chunks(fragment.text), start=1):
            section_title = infer_section_title(content)
            quote_level = infer_quote_level(content)
            chunks.append(
                {
                    "id": f"{fragment.agent_id}-{fragment.person_id}-p{fragment.page:03d}-{local_index:02d}",
                    "personId": fragment.person_id,
                    "personName": fragment.person_name,
                    "agentIds": [fragment.agent_id],
                    "sectionTitle": section_title,
                    "lifeStage": infer_life_stage(section_title, content),
                    "themeTags": infer_theme_tags(content),
                    "sourceFile": source_pdf.as_posix(),
                    "pageRange": [fragment.page, fragment.page],
                    "quoteLevel": quote_level,
                    "confidence": infer_confidence(content, quote_level),
                    "reviewStatus": "needs_review",
                    "sourceTitle": source_pdf.stem,
                    "content": content,
                }
            )
    return chunks


def main() -> None:
    if len(sys.argv) >= 2 and sys.argv[1] == "--all":
        root = Path(__file__).resolve().parents[3]
        sources = json.loads((root / "packages/rag/sources.json").read_text(encoding="utf-8"))
        destination = Path(sys.argv[2]) if len(sys.argv) > 2 else root / "data/processed"
        previous_path = root / "data/processed/dream-mentor.chunks.json"
        previous = json.loads(previous_path.read_text(encoding="utf-8")) if previous_path.exists() else []
        reviews = {(tuple(c["agentIds"]), c["personId"], compact_for_chunk(c["content"])): c for c in previous}
        all_chunks = []
        manifest_sources = []
        for source in sources:
            pdf = root / source["path"]
            extracted = build_chunks(pdf, source["agentId"])
            if not extracted:
                raise ValueError(f"No chunks extracted from {source['path']}")
            for chunk in extracted:
                chunk["sourceFile"] = source["path"]
                prior = reviews.get((tuple(chunk["agentIds"]), chunk["personId"], compact_for_chunk(chunk["content"])))
                if prior:
                    for key in ("reviewStatus", "sourceUrl", "verifiedAt"):
                        if key in prior: chunk[key] = prior[key]
            all_chunks.extend(extracted)
            manifest_sources.append({**source, "sha256": hashlib.sha256(pdf.read_bytes()).hexdigest(), "pages": len(PdfReader(pdf).pages), "chunks": len(extracted)})
        version = hashlib.sha256(json.dumps([(s["agentId"], s["sha256"]) for s in manifest_sources], separators=(",", ":")).encode()).hexdigest()[:24]
        destination.mkdir(parents=True, exist_ok=True)
        (destination / "dream-mentor.chunks.json").write_text(json.dumps(all_chunks, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        (destination / "db-manifest.json").write_text(json.dumps({"version": version, "sources": manifest_sources}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        (destination / "db-bundle.json").write_text(json.dumps({"manifest": {"version": version, "sources": manifest_sources}, "chunks": all_chunks}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"Processed {len(all_chunks)} chunks from four PDFs; version {version}")
        return
    if len(sys.argv) != 3:
        raise SystemExit("Usage: process_interview_pdf.py <source.pdf> <output.json>")

    source_pdf = Path(sys.argv[1])
    output_path = Path(sys.argv[2])
    output_path.parent.mkdir(parents=True, exist_ok=True)
    chunks = build_chunks(source_pdf)
    output_path.write_text(json.dumps(chunks, ensure_ascii=False, indent=2), encoding="utf-8")

    counts: dict[str, int] = {}
    for chunk in chunks:
        agent_id = chunk["agentIds"][0]
        counts[agent_id] = counts.get(agent_id, 0) + 1
    print(f"Wrote {len(chunks)} chunks to {output_path}: {counts}")


if __name__ == "__main__":
    main()
