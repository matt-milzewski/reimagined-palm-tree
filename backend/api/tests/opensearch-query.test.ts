import test from 'node:test';
import assert from 'node:assert/strict';
import { buildKnnQuery } from '../src/opensearch';

test('buildKnnQuery enforces tenant and dataset filters', () => {
  const query = buildKnnQuery({
    tenantId: 'tenant-123',
    datasetId: 'dataset-abc',
    vector: [0.1, 0.2, 0.3],
    topK: 5
  }) as any;

  assert.equal(query.size, 5);
  assert.ok(query.query?.bool?.filter);

  const filters = query.query.bool.filter;
  assert.ok(filters.some((item: any) => item.term?.tenant_id === 'tenant-123'));
  assert.ok(filters.some((item: any) => item.term?.dataset_id === 'dataset-abc'));

  const knn = query.query.bool.must?.[0]?.knn?.vector;
  assert.ok(knn);
  assert.equal(knn.vector.length, 3);
  assert.equal(knn.k, Math.max(20, 5 * 3));
});
