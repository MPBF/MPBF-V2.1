import { describe, expect, it } from "@jest/globals";
import { nextSectionId } from "../server/section-id";
import { nextMasterBatchColorId } from "../server/master-batch-id";
import { nextMachineId } from "../server/machine-id";

describe("administrative string identifier contracts", () => {
  it("continues SEC section IDs using the existing two-digit padding", () => {
    expect(nextSectionId(null)).toBe("SEC01");
    expect(nextSectionId("8", 2)).toBe("SEC09");
    expect(nextSectionId("99", 2)).toBe("SEC100");
  });

  it("uses an MB application ID for new colors rather than supplier/model codes", () => {
    expect(nextMasterBatchColorId(null)).toBe("MB01");
    expect(nextMasterBatchColorId("9", 2)).toBe("MB10");
    expect(nextMasterBatchColorId("99", 2)).toBe("MB100");
  });

  it("continues MAC IDs and explicitly exhausts at MAC999", () => {
    expect(nextMachineId(null)).toBe("MAC01");
    expect(nextMachineId("28")).toBe("MAC29");
    expect(nextMachineId("998")).toBe("MAC999");
    expect(() => nextMachineId("999")).toThrow("MAC999");
  });
});