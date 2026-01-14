import re
from collections import Counter
from typing import Dict, List, Set, Tuple


# Construction abbreviations that should not be dehyphenated
PROTECTED_ABBREVIATIONS: Set[str] = {
    "SWMS", "JSA", "WHS", "OHS", "PCBU", "PPE", "SDS", "MSDS", "TBT", "HSE",
    "ITP", "ITR", "QA", "QC", "NCR", "CAR", "FAT", "SAT",
    "EOT", "VO", "VR", "PC", "DLP", "LOD", "BQ", "BOQ", "SOW", "NTA", "SI",
    "RFI", "TQ", "TBE", "TBC", "TBA", "NTS", "AFC", "IFC", "IFR",
    "WBS", "CPM", "EVM", "PMO", "RFP", "RFQ", "NCC", "BCA",
    "MEP", "HVAC", "FHR", "SWD", "HWS", "CWS", "DB", "MCC", "VSD", "VFD",
    "AS", "NZS",  # Standards prefixes
}


def normalize_whitespace(text: str) -> str:
    """Normalize whitespace while preserving document structure."""
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def dehyphenate(text: str) -> str:
    """
    Remove hyphens at line breaks while preserving construction abbreviations.

    This function is construction-aware and will not dehyphenate text that
    appears to be a construction abbreviation or standard reference.
    """
    def should_dehyphenate(match: re.Match) -> str:
        before = match.group(1)
        after = match.group(2)
        combined = before + after

        # Check if this might be part of a protected abbreviation
        # Look at the context before the hyphen
        start_pos = match.start()
        context_before = text[max(0, start_pos - 10):start_pos + 1].upper()

        # Don't dehyphenate if it looks like a standard reference (AS-NZS, etc.)
        if re.search(r'\b(AS|NZS|BCA|NCC)\s*[-/]?\s*$', context_before):
            return match.group(0)  # Keep original

        # Check if the result would form a protected abbreviation
        for abbr in PROTECTED_ABBREVIATIONS:
            if abbr in combined.upper() or combined.upper() in abbr:
                return match.group(0)  # Keep original

        return before + after

    return re.sub(r"([A-Za-z])\-\n([A-Za-z])", should_dehyphenate, text)


def split_lines(text: str) -> List[str]:
    return [line.strip() for line in text.split("\n") if line.strip()]


def detect_headers_footers(pages: List[Dict], line_count: int = 2) -> Tuple[List[str], List[str], float]:
    if not pages:
        return [], [], 0.0

    header_counter = Counter()
    footer_counter = Counter()
    total_pages = len(pages)

    for page in pages:
        lines = split_lines(page.get("text", ""))
        if not lines:
            continue
        header_lines = lines[:line_count]
        footer_lines = lines[-line_count:]
        header_counter.update(header_lines)
        footer_counter.update(footer_lines)

    threshold = max(2, int(total_pages * 0.6))
    header_lines = [line for line, count in header_counter.items() if count >= threshold and len(line) > 3]
    footer_lines = [line for line, count in footer_counter.items() if count >= threshold and len(line) > 3]

    confidence = 0.0
    if header_lines or footer_lines:
        confidence = min(1.0, (len(header_lines) + len(footer_lines)) / max(1, total_pages))

    return header_lines, footer_lines, confidence


def detect_boilerplate_lines(pages: List[Dict], threshold_ratio: float = 0.7) -> List[str]:
    if not pages:
        return []

    total_pages = len(pages)
    line_counter = Counter()
    for page in pages:
        lines = split_lines(page.get("text", ""))
        line_counter.update(set(lines))

    threshold = max(2, int(total_pages * threshold_ratio))
    boilerplate = [line for line, count in line_counter.items() if count >= threshold and len(line) > 4]
    return boilerplate


def remove_lines(text: str, lines_to_remove: List[str]) -> str:
    if not lines_to_remove:
        return text

    filtered_lines = [
        line for line in split_lines(text)
        if line.strip() not in lines_to_remove
    ]
    return "\n".join(filtered_lines)


def compute_extraction_stats(pages: List[Dict]) -> Dict:
    full_text = "\n".join(page.get("text", "") for page in pages)
    text_length = len(full_text)
    non_alpha = len(re.sub(r"[A-Za-z0-9\s]", "", full_text))
    non_alpha_ratio = non_alpha / text_length if text_length else 1.0

    lines = split_lines(full_text)
    unique_lines = set(lines)
    repeated_line_ratio = 0.0
    if lines:
        repeated_line_ratio = 1 - (len(unique_lines) / len(lines))

    return {
        "textLength": text_length,
        "pageCount": len(pages),
        "nonAlphaRatio": round(non_alpha_ratio, 4),
        "repeatedLineRatio": round(repeated_line_ratio, 4)
    }
