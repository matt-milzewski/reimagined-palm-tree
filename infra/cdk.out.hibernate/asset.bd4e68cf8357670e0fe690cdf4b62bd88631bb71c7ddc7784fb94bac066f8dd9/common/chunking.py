import re
from typing import Dict, List, Optional, Tuple


# Section boundary patterns for construction documents
SECTION_BOUNDARY_PATTERNS = [
    r"^CLAUSE\s+\d+",                    # CLAUSE 1, CLAUSE 2.1
    r"^SECTION\s+\d+",                   # SECTION 1, SECTION 2
    r"^PART\s+[A-Z0-9]+",                # PART A, PART 1
    r"^APPENDIX\s+[A-Z0-9]+",            # APPENDIX A
    r"^SCHEDULE\s+[A-Z0-9]+",            # SCHEDULE 1
    r"^ATTACHMENT\s+[A-Z0-9]+",          # ATTACHMENT A
    r"^\d+\.\d+(?:\.\d+)*\s+[A-Z]",      # 1.2.3 Title format
    r"^[A-Z]\d+\.\d+",                   # A1.2 spec format
]


def is_section_boundary(line: str) -> bool:
    """Check if a line represents a section boundary."""
    line = line.strip()
    for pattern in SECTION_BOUNDARY_PATTERNS:
        if re.match(pattern, line, re.IGNORECASE):
            return True
    return False


def find_best_split_point(text: str, max_len: int) -> int:
    """
    Find the best point to split text, preferring section boundaries.

    Args:
        text: Text to split
        max_len: Maximum length for the split

    Returns:
        Index of the best split point
    """
    if len(text) <= max_len:
        return len(text)

    # Look for section boundaries within the allowed range
    lines = text[:max_len].split('\n')
    accumulated_len = 0

    for i, line in enumerate(lines):
        line_len = len(line) + 1  # +1 for newline
        if accumulated_len + line_len > max_len:
            break

        # Check if next line is a section boundary (if it exists)
        if i + 1 < len(lines) and is_section_boundary(lines[i + 1]):
            # Split before the section boundary
            return accumulated_len + len(line)

        accumulated_len += line_len

    # Fall back to word boundary
    slice_text = text[:max_len]
    last_space = slice_text.rfind(" ")
    if last_space > max_len * 0.6:
        return last_space

    return max_len


def split_long_text(text: str, max_len: int, respect_sections: bool = True) -> List[str]:
    """
    Split long text into segments, optionally respecting section boundaries.

    Args:
        text: Text to split
        max_len: Maximum segment length
        respect_sections: Whether to respect construction document section boundaries

    Returns:
        List of text segments
    """
    segments = []
    start = 0
    text_length = len(text)

    while start < text_length:
        remaining = text[start:]
        if len(remaining) <= max_len:
            segment = remaining.strip()
            if segment:
                segments.append(segment)
            break

        if respect_sections:
            end = start + find_best_split_point(remaining, max_len)
        else:
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
    overlap: int = 200,
    respect_sections: bool = True
) -> List[Dict]:
    """
    Chunk pages into segments suitable for embedding.

    This function is construction-aware and will attempt to respect
    section boundaries in construction documents when respect_sections is True.

    Args:
        pages: List of page dictionaries with 'pageNumber' and 'text' keys
        min_len: Minimum chunk length before creating a new chunk
        max_len: Maximum chunk length
        overlap: Number of characters to overlap between chunks
        respect_sections: Whether to respect construction document section boundaries

    Returns:
        List of chunk dictionaries with 'text', 'pageRange', and 'length' keys
    """
    segments: List[Tuple[int, str]] = []
    for page in pages:
        page_number = page.get("pageNumber")
        text = (page.get("text") or "").strip()
        if not text:
            continue
        if len(text) <= max_len:
            segments.append((page_number, text))
        else:
            for segment in split_long_text(text, max_len, respect_sections):
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
