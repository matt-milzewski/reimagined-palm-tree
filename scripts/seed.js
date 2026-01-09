#!/usr/bin/env node
const apiBase = (process.env.API_BASE_URL || '').replace(/\/$/, '');
const accessToken = process.env.ACCESS_TOKEN;
const name = process.env.DATASET_NAME || 'Seed Dataset';

if (!apiBase || !accessToken) {
  console.error('Missing API_BASE_URL or ACCESS_TOKEN');
  process.exit(1);
}

async function main() {
  const response = await fetch(`${apiBase}/datasets`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: accessToken
    },
    body: JSON.stringify({ name })
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || 'Seed failed');
  }

  const data = await response.json();
  console.log('Created dataset:', data.datasetId);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
