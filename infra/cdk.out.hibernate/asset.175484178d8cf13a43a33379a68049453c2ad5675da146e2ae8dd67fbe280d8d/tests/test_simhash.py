from common.simhash import simhash, hamming_distance


def test_simhash_similarity():
    text_a = "This is a sample document about invoices and payments."
    text_b = "This is a sample document about invoices and payment schedules."
    hash_a = simhash(text_a)
    hash_b = simhash(text_b)
    distance = hamming_distance(hash_a, hash_b)
    assert distance <= 10


def test_simhash_difference():
    text_a = "Quarterly financial report for Q1."
    text_b = "Employee handbook policies and benefits overview."
    hash_a = simhash(text_a)
    hash_b = simhash(text_b)
    distance = hamming_distance(hash_a, hash_b)
    assert distance > 10
