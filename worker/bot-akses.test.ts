// worker/bot-akses.test.ts — batas kapabilitas bot Telegram per role.
// Fokus: designer TIDAK boleh dapat satu pun perintah inventory, dan chat-nya
// harus bebas tool; admin justru harus tetap penuh (tidak ada regresi).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { kapabilitas } from "../lib/d1/peran";

describe("kapabilitas bot per role", () => {
  it("owner/high_admin/admin tetap penuh dan ber-tool", () => {
    for (const role of ["owner", "high_admin", "admin"]) {
      const k = kapabilitas(role);
      assert.equal(k.bolehPerintah, true, role);
      assert.equal(k.bolehGambar, true, role);
      assert.equal(k.chatTanpaTool, false, role);
    }
  });

  it("designer: gambar + chat desain saja, tanpa perintah dan tanpa tool", () => {
    const k = kapabilitas("designer");
    assert.equal(k.bolehPerintah, false);
    assert.equal(k.bolehGambar, true);
    assert.equal(k.chatTanpaTool, true);
  });

  it("guest dan role tak dikenal ditolak habis (fail-closed)", () => {
    for (const role of ["guest", "", "staff"]) {
      const k = kapabilitas(role);
      assert.equal(k.bolehPerintah, false, role);
      assert.equal(k.bolehGambar, false, role);
    }
  });
});
