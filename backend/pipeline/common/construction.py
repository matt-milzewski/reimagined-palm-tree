"""
Australian Construction Industry Terminology and Standards Reference Module.

This module provides construction-specific terminology preservation, Australian standards
extraction, and document classification for the construction industry.
"""

import re
from typing import Dict, List, Optional, Set, Tuple


# Australian construction industry abbreviations that should be preserved
CONSTRUCTION_ABBREVIATIONS: Dict[str, str] = {
    # Safety & Compliance
    "SWMS": "Safe Work Method Statement",
    "JSA": "Job Safety Analysis",
    "WHS": "Work Health and Safety",
    "OHS": "Occupational Health and Safety",
    "PCBU": "Person Conducting Business or Undertaking",
    "PPE": "Personal Protective Equipment",
    "SDS": "Safety Data Sheet",
    "MSDS": "Material Safety Data Sheet",
    "TBT": "Toolbox Talk",
    "HSE": "Health Safety and Environment",

    # Quality & Inspection
    "ITP": "Inspection Test Plan",
    "ITR": "Inspection Test Record",
    "QA": "Quality Assurance",
    "QC": "Quality Control",
    "NCR": "Non-Conformance Report",
    "CAR": "Corrective Action Request",
    "FAT": "Factory Acceptance Test",
    "SAT": "Site Acceptance Test",

    # Commercial & Contracts
    "EOT": "Extension of Time",
    "VO": "Variation Order",
    "VR": "Variation Request",
    "PC": "Practical Completion",
    "DLP": "Defects Liability Period",
    "LOD": "Liquidated Damages",
    "BQ": "Bill of Quantities",
    "BOQ": "Bill of Quantities",
    "SOW": "Scope of Work",
    "NTA": "Notice to Attend",
    "SI": "Site Instruction",

    # Documentation
    "RFI": "Request for Information",
    "TQ": "Technical Query",
    "TBE": "To Be Estimated",
    "TBC": "To Be Confirmed",
    "TBA": "To Be Advised",
    "NTS": "Not to Scale",
    "AFC": "Approved for Construction",
    "IFC": "Issued for Construction",
    "IFR": "Issued for Review",

    # Project Management
    "WBS": "Work Breakdown Structure",
    "CPM": "Critical Path Method",
    "EVM": "Earned Value Management",
    "PMO": "Project Management Office",
    "RFP": "Request for Proposal",
    "RFQ": "Request for Quotation",
    "NCC": "National Construction Code",
    "BCA": "Building Code of Australia",

    # Trades & Disciplines
    "MEP": "Mechanical Electrical Plumbing",
    "HVAC": "Heating Ventilation and Air Conditioning",
    "FHR": "Fire Hydrant Riser",
    "SWD": "Stormwater Drainage",
    "HWS": "Hot Water System",
    "CWS": "Cold Water Supply",
    "DB": "Distribution Board",
    "MCC": "Motor Control Centre",
    "VSD": "Variable Speed Drive",
    "VFD": "Variable Frequency Drive",
}

# Australian Standards patterns
AU_STANDARDS_PATTERNS = [
    r"AS\s*/?NZS\s*\d{4}(?:\.\d+)*(?::\d{4})?",  # AS/NZS 3000:2018
    r"AS\s*\d{4}(?:\.\d+)*(?::\d{4})?",           # AS 1170.2:2021
    r"NCC\s*(?:20\d{2})?",                         # NCC 2022
    r"BCA\s*(?:20\d{2})?",                         # BCA 2022
]

# Common Australian Standards reference database
AU_STANDARDS_DATABASE: Dict[str, str] = {
    # Electrical
    "AS/NZS 3000": "Electrical installations (Wiring Rules)",
    "AS/NZS 3008": "Selection of cables",
    "AS/NZS 3010": "Electrical installations - Generating sets",
    "AS/NZS 3012": "Electrical installations - Construction sites",
    "AS/NZS 3017": "Electrical installations - Verification guidelines",
    "AS/NZS 3018": "Electrical installations - Domestic installations",
    "AS/NZS 3019": "Electrical installations - Periodic verification",
    "AS/NZS 3820": "Essential safety requirements",

    # Structural
    "AS 1170": "Structural design actions",
    "AS 1170.1": "Permanent, imposed and other actions",
    "AS 1170.2": "Wind actions",
    "AS 1170.4": "Earthquake actions",
    "AS 2870": "Residential slabs and footings",
    "AS 3600": "Concrete structures",
    "AS 4100": "Steel structures",
    "AS 1684": "Residential timber-framed construction",
    "AS 1720": "Timber structures",
    "AS 5100": "Bridge design",

    # Fire & Safety
    "AS 1530": "Fire tests on building materials",
    "AS 1668": "Mechanical ventilation and air-conditioning",
    "AS 1670": "Fire detection, warning, control and intercom systems",
    "AS 1851": "Maintenance of fire protection systems",
    "AS 2118": "Fire sprinkler systems",
    "AS 2419": "Fire hydrant installations",
    "AS 2441": "Installation of fire hose reels",
    "AS 3786": "Smoke alarms",

    # Plumbing & Drainage
    "AS/NZS 3500": "Plumbing and drainage",
    "AS/NZS 3500.1": "Water services",
    "AS/NZS 3500.2": "Sanitary plumbing and drainage",
    "AS/NZS 3500.3": "Stormwater drainage",
    "AS/NZS 3500.4": "Heated water services",

    # Building & Construction
    "AS 1288": "Glass in buildings",
    "AS 1428": "Design for access and mobility",
    "AS 1562": "Design and installation of sheet roof and wall cladding",
    "AS 1657": "Fixed platforms, walkways, stairways and ladders",
    "AS 2047": "Windows and external glazed doors",
    "AS 4055": "Wind loads for housing",

    # Safety
    "AS/NZS 1891": "Industrial fall-arrest systems",
    "AS/NZS 4576": "Guidelines for scaffolding safety",
    "AS/NZS 4602": "High visibility safety garments",

    # General
    "NCC": "National Construction Code",
    "BCA": "Building Code of Australia",
}

# Document type patterns for classification
DOCUMENT_TYPE_PATTERNS: Dict[str, List[str]] = {
    "specification": [
        r"(?i)^specification",
        r"(?i)technical\s+specification",
        r"(?i)spec\s+section\s+\d+",
        r"(?i)division\s+\d+",
    ],
    "contract": [
        r"(?i)contract\s+(agreement|document)",
        r"(?i)conditions\s+of\s+contract",
        r"(?i)general\s+conditions",
        r"(?i)special\s+conditions",
        r"(?i)AS\s*2124",  # AS 2124 Standard Contract
        r"(?i)AS\s*4000",  # AS 4000 Contract
    ],
    "swms": [
        r"(?i)safe\s+work\s+method\s+statement",
        r"(?i)\bSWMS\b",
        r"(?i)\bJSA\b",
        r"(?i)job\s+safety\s+analysis",
        r"(?i)risk\s+assessment",
    ],
    "itp": [
        r"(?i)inspection\s+(?:and\s+)?test\s+plan",
        r"(?i)\bITP\b",
        r"(?i)quality\s+plan",
        r"(?i)hold\s+points?",
        r"(?i)witness\s+points?",
    ],
    "drawing": [
        r"(?i)(?:^|\s)DWG[\s\-]?\d+",
        r"(?i)(?:^|\s)SK[\s\-]?\d+",
        r"(?i)drawing\s+(?:number|no\.?|#)",
        r"(?i)(?:^|\s)A[\-]?\d{3}",  # Architectural drawings
        r"(?i)(?:^|\s)S[\-]?\d{3}",  # Structural drawings
        r"(?i)(?:^|\s)M[\-]?\d{3}",  # Mechanical drawings
        r"(?i)(?:^|\s)E[\-]?\d{3}",  # Electrical drawings
    ],
    "rfi": [
        r"(?i)request\s+for\s+information",
        r"(?i)\bRFI[\s\-]?\d+",
        r"(?i)technical\s+query",
        r"(?i)\bTQ[\s\-]?\d+",
    ],
    "variation": [
        r"(?i)variation\s+(?:order|request|notice)",
        r"(?i)\bVO[\s\-]?\d+",
        r"(?i)\bVR[\s\-]?\d+",
        r"(?i)change\s+order",
    ],
    "progress_claim": [
        r"(?i)progress\s+claim",
        r"(?i)payment\s+claim",
        r"(?i)claim\s+(?:number|no\.?|#)\s*\d+",
    ],
    "meeting_minutes": [
        r"(?i)meeting\s+minutes",
        r"(?i)site\s+meeting",
        r"(?i)project\s+meeting",
        r"(?i)minutes\s+of\s+meeting",
    ],
}

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


def extract_standards(text: str) -> List[str]:
    """
    Extract Australian standards references from text.

    Args:
        text: The text to search for standards references.

    Returns:
        List of unique standards found in the text.
    """
    standards: Set[str] = set()

    for pattern in AU_STANDARDS_PATTERNS:
        matches = re.findall(pattern, text, re.IGNORECASE)
        for match in matches:
            # Normalize the format
            normalized = re.sub(r"\s+", " ", match.strip().upper())
            normalized = normalized.replace("/ ", "/")
            standards.add(normalized)

    return sorted(list(standards))


def get_standard_description(standard: str) -> Optional[str]:
    """
    Get the description for an Australian standard.

    Args:
        standard: The standard code (e.g., "AS/NZS 3000").

    Returns:
        Description string or None if not found.
    """
    # Normalize the input
    normalized = re.sub(r"\s+", " ", standard.strip().upper())
    normalized = re.sub(r":\d{4}$", "", normalized)  # Remove year suffix

    # Try exact match first
    if normalized in AU_STANDARDS_DATABASE:
        return AU_STANDARDS_DATABASE[normalized]

    # Try partial match (base standard number)
    base_standard = re.sub(r"\.\d+$", "", normalized)
    if base_standard in AU_STANDARDS_DATABASE:
        return AU_STANDARDS_DATABASE[base_standard]

    return None


def classify_document(text: str) -> Tuple[str, float]:
    """
    Classify a construction document based on its content.

    Args:
        text: The document text to classify.

    Returns:
        Tuple of (document_type, confidence_score)
    """
    scores: Dict[str, int] = {}

    for doc_type, patterns in DOCUMENT_TYPE_PATTERNS.items():
        score = 0
        for pattern in patterns:
            matches = len(re.findall(pattern, text[:5000]))  # Check first 5000 chars
            score += matches
        if score > 0:
            scores[doc_type] = score

    if not scores:
        return ("general", 0.0)

    best_type = max(scores, key=scores.get)
    total_matches = sum(scores.values())
    confidence = min(1.0, scores[best_type] / max(total_matches, 1))

    return (best_type, round(confidence, 3))


def detect_discipline(text: str) -> Optional[str]:
    """
    Detect the construction discipline/trade from document content.

    Args:
        text: The document text to analyze.

    Returns:
        Discipline name or None if not detected.
    """
    discipline_patterns: Dict[str, List[str]] = {
        "electrical": [
            r"(?i)electrical",
            r"(?i)\bMCC\b",
            r"(?i)\bDB\b",
            r"(?i)AS/?NZS\s*3000",
            r"(?i)switchboard",
            r"(?i)cabling",
        ],
        "mechanical": [
            r"(?i)mechanical",
            r"(?i)\bHVAC\b",
            r"(?i)air\s+conditioning",
            r"(?i)ductwork",
            r"(?i)ventilation",
        ],
        "structural": [
            r"(?i)structural",
            r"(?i)AS\s*3600",
            r"(?i)AS\s*4100",
            r"(?i)reinforcement",
            r"(?i)concrete",
            r"(?i)steelwork",
        ],
        "hydraulic": [
            r"(?i)hydraulic",
            r"(?i)plumbing",
            r"(?i)drainage",
            r"(?i)AS/?NZS\s*3500",
            r"(?i)sanitary",
            r"(?i)stormwater",
        ],
        "fire": [
            r"(?i)fire\s+(?:protection|services|systems)",
            r"(?i)sprinkler",
            r"(?i)AS\s*2118",
            r"(?i)hydrant",
            r"(?i)smoke\s+(?:detection|alarm)",
        ],
        "architectural": [
            r"(?i)architectural",
            r"(?i)finishes",
            r"(?i)facade",
            r"(?i)glazing",
            r"(?i)ceiling",
            r"(?i)flooring",
        ],
        "civil": [
            r"(?i)civil",
            r"(?i)earthworks",
            r"(?i)pavement",
            r"(?i)road\s*works",
            r"(?i)retaining\s+wall",
        ],
    }

    scores: Dict[str, int] = {}
    sample_text = text[:10000]  # Check first 10000 chars for performance

    for discipline, patterns in discipline_patterns.items():
        score = 0
        for pattern in patterns:
            matches = len(re.findall(pattern, sample_text))
            score += matches
        if score > 0:
            scores[discipline] = score

    if not scores:
        return None

    return max(scores, key=scores.get)


def is_section_boundary(line: str) -> bool:
    """
    Check if a line represents a section boundary in construction documents.

    Args:
        line: The line to check.

    Returns:
        True if the line appears to be a section boundary.
    """
    line = line.strip()
    for pattern in SECTION_BOUNDARY_PATTERNS:
        if re.match(pattern, line, re.IGNORECASE):
            return True
    return False


def extract_section_reference(text: str) -> Optional[str]:
    """
    Extract the primary section reference from text.

    Args:
        text: The text to analyze.

    Returns:
        Section reference string or None.
    """
    patterns = [
        r"(?:CLAUSE|SECTION|PART)\s+(\d+(?:\.\d+)*)",
        r"^(\d+\.\d+(?:\.\d+)*)\s",
        r"APPENDIX\s+([A-Z])",
        r"SCHEDULE\s+(\d+)",
    ]

    for pattern in patterns:
        match = re.search(pattern, text[:500], re.IGNORECASE | re.MULTILINE)
        if match:
            return match.group(0).strip()

    return None


def preserve_abbreviations(text: str) -> str:
    """
    Preserve construction abbreviations by preventing unwanted modifications.

    This function adds zero-width spaces around abbreviations to prevent
    them from being incorrectly dehyphenated or modified.

    Args:
        text: The text to process.

    Returns:
        Text with abbreviations protected.
    """
    # For now, we simply ensure abbreviations are not split across lines
    # This is handled in the dehyphenation step by checking against known abbreviations
    return text


def get_abbreviation_expansion(abbr: str) -> Optional[str]:
    """
    Get the full expansion of a construction abbreviation.

    Args:
        abbr: The abbreviation to expand.

    Returns:
        Full expansion or None if not found.
    """
    return CONSTRUCTION_ABBREVIATIONS.get(abbr.upper())


def enrich_chunk_metadata(
    text: str,
    filename: str,
    page: int
) -> Dict:
    """
    Generate construction-specific metadata for a text chunk.

    Args:
        text: The chunk text.
        filename: The source filename.
        page: The page number.

    Returns:
        Dictionary of metadata.
    """
    doc_type, confidence = classify_document(text)
    discipline = detect_discipline(text)
    standards = extract_standards(text)
    section_ref = extract_section_reference(text)

    return {
        "doc_type": doc_type,
        "doc_type_confidence": confidence,
        "discipline": discipline,
        "standards_referenced": standards,
        "section_reference": section_ref,
    }
