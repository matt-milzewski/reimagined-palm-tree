import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDatasetForChat } from '../src/chat-utils';

test('validateDatasetForChat rejects dataset not owned by tenant', () => {
  const result = validateDatasetForChat('tenant-123', { tenantId: 'tenant-999', status: 'READY' });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.statusCode, 404);
  }
});

test('validateDatasetForChat rejects dataset not READY', () => {
  const result = validateDatasetForChat('tenant-123', { tenantId: 'tenant-123', status: 'INDEXING' });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.statusCode, 409);
  }
});
