import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { appConnectionString } from "./database";

describe("database connections", () => {
  it("uses Supabase's transaction pooler for the app, keeping the same host and credentials", () => {
    const url = new URL(appConnectionString("postgresql://postgres.ref:secret@aws-1-eu-west-1.pooler.supabase.com:5432/postgres"));
    assert.equal(url.port, "6543");
    assert.equal(url.hostname, "aws-1-eu-west-1.pooler.supabase.com");
    assert.equal(url.username, "postgres.ref");
    assert.equal(url.password, "secret");
  });

  it("leaves other hosts and ports alone", () => {
    assert.equal(new URL(appConnectionString("postgresql://u:p@db.ref.supabase.co:5432/postgres")).port, "5432");
    assert.equal(new URL(appConnectionString("postgresql://u:p@aws-1-eu-west-1.pooler.supabase.com:6543/postgres")).port, "6543");
    assert.equal(new URL(appConnectionString("postgresql://u:p@localhost:5432/postgres")).port, "5432");
  });
});
