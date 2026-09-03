import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { CampaignStore } from "../dist/infrastructure/campaign-store.js";

test("tenant campaign counters exclude terminal campaigns and count monthly commitments", () => {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE campaigns(id TEXT PRIMARY KEY, status TEXT NOT NULL, scheduled_at TEXT);
    CREATE TABLE campaign_targets(id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL);
    INSERT INTO campaigns VALUES
      ('draft', 'draft', NULL),
      ('september', 'scheduled', '2026-09-10T00:00:00.000Z'),
      ('august', 'completed', '2026-08-10T00:00:00.000Z'),
      ('cancelled', 'cancelled', '2026-09-11T00:00:00.000Z');
    INSERT INTO campaign_targets VALUES
      ('target-1', 'september'),
      ('target-2', 'september'),
      ('target-3', 'august'),
      ('target-4', 'cancelled');
  `);
  const store = new CampaignStore(database);

  assert.equal(store.activeCampaignCount(), 2);
  assert.equal(
    store.committedDeliveryCountBetween("2026-09-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z"),
    2,
  );
  database.close();
});
