import { describe, it, expect } from "vitest";

describe("RLS withTenant", () => {
  it("throws when companyId is empty", async () => {
    // Import withTenant without triggering env/db (mock the module)
    const { withTenant } = await import("@/lib/db/rls");

    const mockDb = {
      transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
        return cb({
          execute: async () => {},
        });
      },
    };

    await expect(
      withTenant(mockDb, "", async () => "result")
    ).rejects.toThrow("withTenant requires a non-empty companyId");
  });

  it("executes SET LOCAL and callback inside transaction", async () => {
    const { withTenant } = await import("@/lib/db/rls");
    const executedQueries: string[] = [];

    const mockDb = {
      transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
        return cb({
          execute: async (query: { queryChunks?: string[] }) => {
            executedQueries.push("SET LOCAL");
          },
        });
      },
    };

    const result = await withTenant(
      mockDb,
      "005d57cd-a683-4dd7-b573-ffdf02ed8146",
      async () => "tenant-result"
    );

    expect(result).toBe("tenant-result");
    expect(executedQueries).toContain("SET LOCAL");
  });
});
