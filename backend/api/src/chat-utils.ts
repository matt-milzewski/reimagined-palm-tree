export type DatasetEligibility =
  | { ok: true }
  | { ok: false; statusCode: number; message: string };

export function validateDatasetForChat(tenantId: string, dataset?: Record<string, any>): DatasetEligibility {
  if (!dataset || dataset.tenantId !== tenantId) {
    return { ok: false, statusCode: 404, message: 'Dataset not found.' };
  }
  if (dataset.status !== 'READY') {
    return {
      ok: false,
      statusCode: 409,
      message: `Dataset is not ready for chat. Status: ${dataset.status || 'UNKNOWN'}.`
    };
  }
  return { ok: true };
}
