from typing import Dict, List, Tuple


def split_long_text(text: str, max_len: int) -> List[str]:
    segments = []
    start = 0
    text_length = len(text)

    while start < text_length:
        end = min(start + max_len, text_length)
        if end < text_length:
            slice_text = text[start:end]
            last_space = slice_text.rfind(" ")
            if last_space > max_len * 0.6:
                end = start + last_space
        segment = text[start:end].strip()
        if segment:
            segments.append(segment)
        start = end

    return segments


def chunk_pages(
    pages: List[Dict],
    min_len: int = 800,
    max_len: int = 1200,
    overlap: int = 200
) -> List[Dict]:
    segments: List[Tuple[int, str]] = []
    for page in pages:
        page_number = page.get("pageNumber")
        text = (page.get("text") or "").strip()
        if not text:
            continue
        if len(text) <= max_len:
            segments.append((page_number, text))
        else:
            for segment in split_long_text(text, max_len):
                segments.append((page_number, segment))

    chunks = []
    current_text = ""
    current_pages: List[int] = []

    for page_number, segment_text in segments:
        if not current_text:
            current_text = segment_text
            current_pages = [page_number]
            continue

        prospective_len = len(current_text) + 1 + len(segment_text)
        if prospective_len > max_len and len(current_text) >= min_len:
            chunk_pages_range = (min(current_pages), max(current_pages))
            chunks.append(
                {
                    "text": current_text,
                    "pageRange": chunk_pages_range,
                    "length": len(current_text)
                }
            )
            overlap_text = current_text[-overlap:] if overlap > 0 else ""
            overlap_text = overlap_text.strip()
            if overlap_text:
                available = max_len - len(segment_text) - 1
                if available <= 0:
                    overlap_text = ""
                elif available < len(overlap_text):
                    overlap_text = overlap_text[-available:]
            current_text = (overlap_text + " " + segment_text).strip() if overlap_text else segment_text
            current_pages = [current_pages[-1], page_number] if current_pages else [page_number]
        else:
            current_text = (current_text + " " + segment_text).strip()
            if page_number not in current_pages:
                current_pages.append(page_number)

    if current_text:
        chunk_pages_range = (min(current_pages), max(current_pages)) if current_pages else (0, 0)
        chunks.append({
            "text": current_text,
            "pageRange": chunk_pages_range,
            "length": len(current_text)
        })

    return chunks


def chunk_warnings(chunks: List[Dict], min_warn: int = 500, max_warn: int = 1500) -> List[Dict]:
    warnings = []
    for chunk in chunks:
        length = chunk.get("length", 0)
        if length < min_warn:
            warnings.append({
                "type": "CHUNK_TOO_SMALL",
                "severity": "WARN",
                "description": f"Chunk length {length} is below recommended minimum.",
                "recommendation": "Increase chunk size or adjust overlap for better context."
            })
        if length > max_warn:
            warnings.append({
                "type": "CHUNK_TOO_LARGE",
                "severity": "WARN",
                "description": f"Chunk length {length} exceeds recommended maximum.",
                "recommendation": "Reduce chunk size to avoid embedding truncation."
            })
    return warnings
