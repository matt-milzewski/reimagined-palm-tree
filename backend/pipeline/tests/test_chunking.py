from common.chunking import chunk_pages


def test_chunking_respects_limits():
    pages = []
    for i in range(1, 6):
        text = ("Page " + str(i) + " content. ") * 80
        pages.append({"pageNumber": i, "text": text})

    chunks = chunk_pages(pages, min_len=800, max_len=1200, overlap=200)

    assert len(chunks) >= 3
    for chunk in chunks:
        assert chunk["length"] <= 1200


def test_chunking_page_ranges():
    pages = [
        {"pageNumber": 1, "text": "A" * 900},
        {"pageNumber": 2, "text": "B" * 900}
    ]
    chunks = chunk_pages(pages, min_len=800, max_len=1200, overlap=200)
    for chunk in chunks:
        start, end = chunk["pageRange"]
        assert start >= 1
        assert end <= 2
