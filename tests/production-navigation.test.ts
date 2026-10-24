import 
{
 describe, expect, it 
}
 from "@jest/globals"
;

import 
{
 availableProductionViews, canOpenProductionView, initialProductionPath 
}
 from "../client/src/lib/production-navigation"
;
import { canOpenPlanningView } from "../client/src/lib/planning-navigation";

import type 
{
 ProductionUser 
}
 from "../shared/production"
;

import 
{
 initialProductionRoleBinding 
}
 from "../shared/production-role"
;


const user = (...permissions: string[]): ProductionUser => (
{
 id: 7, permissions 
}
)
;

const tabs = (account: ProductionUser) => availableProductionViews(account).map(item => item.view)
;


describe("production operator tab boundaries", () => 
{

  it.each(["film", "printing", "cutting"] as const)("limits %s operators despite general read grants", stage => 
{

    const account = user(`operate_${stage}`, "view_production", "view_production_hall", "receive_production", "view_finished_inventory")
;

    expect(tabs(account)).toEqual(stage === "film" ? ["film", "mixing"] : [stage])
;

    expect(initialProductionPath(account)).toBe(`/production/${stage}`)
;

    expect(canOpenPlanningView(account, "management")).toBe(false);
    for (const view of ["film", "printing", "cutting", "hall", "warehouse"] as const)
{

      expect(canOpenProductionView(account, view)).toBe(view === stage)
;

    
}

    expect(canOpenProductionView(account, "roll")).toBe(true)
;

  
}
)
;

  it.each(["film", "printing", "cutting"] as const)("keeps the minimal %s operator grant functional", stage => 
{

    const account = user(`operate_${stage}`)
;

    expect(tabs(account)).toEqual(stage === "film" ? ["film", "mixing"] : [stage])
;

    expect(initialProductionPath(account)).toBe(`/production/${stage}`)
;

  
}
)
;

  it("shows all explicitly granted stages for multi-stage operators", () => 
{

    const account = user("view_production", "operate_printing", "operate_cutting")
;

    expect(tabs(account)).toEqual(["printing", "cutting"])
;

    expect(initialProductionPath(account)).toBe("/production/printing")
;

    expect(canOpenProductionView(account, "film")).toBe(false)
;

  
}
)
;

  it("keeps administrator tabs unchanged, including during an admin role preview", () => 
{

    const account = user("admin", "operate_film")
;

    expect(tabs(account)).toEqual(["film", "printing", "cutting", "mixing"])
;

    expect(initialProductionPath(account)).toBe("/production/film")
;

  
}
)
;

  it("keeps production management grants unchanged even with an operational grant", () => 
{

    const account = user("manage_production", "operate_film")
;

    expect(tabs(account)).toEqual(["film", "printing", "cutting", "mixing"])
;

    expect(initialProductionPath(account)).toBe("/production/film")
;

    expect(canOpenProductionView(account, "hall")).toBe(false)
;

  
}
)
;

  it("preserves general read, receiving and inventory navigation for non-operators", () => 
{

    expect(tabs(user("view_production"))).toEqual(["film", "printing", "cutting"])
;

    expect(tabs(user("receive_production"))).toEqual([])
;

    expect(tabs(user("view_finished_inventory"))).toEqual([])
;

  
}
)
;

  it.each([
    
{
 stage: "film", role_name: "Extruder Operator", role_name_ar: "مشغل فيلم",
      permissions: ["view_home", "view_user_dashboard", "view_film_dashboard", "view_mixing", "view_production"] 
}
,
    
{
 stage: "printing", role_name: "Printing Operator", role_name_ar: "مشغل طباعة",
      permissions: ["view_home", "view_user_dashboard", "view_printing_dashboard"] 
}
,
    
{
 stage: "cutting", role_name: "Cutting Operator", role_name_ar: "مشغل تقطيع",
      permissions: ["view_home", "view_user_dashboard", "view_cutting_dashboard"] 
}
,
  ] as const)("keeps legacy $stage read-only operator roles stage-specific", fixture => 
{

    const account: ProductionUser = 
{
 ...fixture, id: 7, permissions: [...fixture.permissions],
      production_role_binding: initialProductionRoleBinding(
{
 name: fixture.role_name, name_ar: fixture.role_name_ar, permissions: [...fixture.permissions] 
}
) 
}
;

    expect(tabs(account)).toEqual(fixture.stage === "film" ? ["film", "mixing"] : [fixture.stage])
;

    expect(initialProductionPath(account)).toBe(`/production/${fixture.stage}`)
;

    for (const other of ["film", "printing", "cutting"] as const) 
{

      expect(canOpenProductionView(account, other)).toBe(other === fixture.stage)
;

    
}

    expect(canOpenPlanningView(account, "management")).toBe(false)
;

    expect(canOpenProductionView(account, "roll")).toBe(true)
;

  
}
)
;

  it("does not mistake Sales' film dashboard visibility for an operator role", () => 
{

    const account = 
{
 ...user("view_production", "view_film_dashboard"), role_name: "Sales Representative", role_name_ar: "مندوب مبيعات" 
}
;

    expect(tabs(account)).toEqual(["film", "printing", "cutting"])
;

    expect(initialProductionPath(account)).toBe("/production/film")
;

  
}
)
;

  it("does not invent access from an operator role name without grants", () => 
{

    expect(tabs(
{
 ...user(), role_name: "Extruder Operator" 
}
)).toEqual([])
;

    expect(tabs(
{
 ...user("*"), role_name_ar: "مشغل الفيلم" 
}
)).toEqual([])
;

  
}
)
;

  it("supports an Arabic operator role name when the English name is absent", () => 
{

    expect(tabs(
{
 ...user("view_production", "view_film_dashboard"), role_name_ar: "مشغل الفيلم",
      production_role_binding: initialProductionRoleBinding(
{
 name_ar: "مشغل الفيلم" 
}
) 
}
)).toEqual(["film"])
;

  
}
)
;

  it.each([
    
{
 role_name: "Evening team", role_name_ar: "فريق المساء" 
}
,
    
{
 role_name: "Printing Operator", role_name_ar: "مشغل القص" 
}
,
    
{
 role_name: "", role_name_ar: "" 
}
,
  ])("does not change persisted film navigation after renaming to %j", names => 
{

    const account: ProductionUser = 
{
 ...user("view_production", "view_film_dashboard"), ...names,
      production_role_binding: 
{
 mode: "operator", stages: ["film"] 
}
 
}
;

    expect(tabs(account)).toEqual(["film"])
;

    expect(initialProductionPath(account)).toBe("/production/film")
;

    expect(canOpenProductionView(account, "printing")).toBe(false)
;

    expect(canOpenProductionView(account, "cutting")).toBe(false)
;

  
}
)
;

  it("hides a bound stage when its actual grants are revoked, despite general read", () => 
{

    const account: ProductionUser = 
{
 ...user("view_production"), production_role_binding: 
{
 mode: "operator", stages: ["film"] 
}
 
}
;

    expect(tabs(account)).toEqual([])
;

    expect(initialProductionPath(account)).toBeNull()
;

    expect(canOpenProductionView(account, "film")).toBe(false)
;

  
}
)
;

  it("supports multiple bound read-only stages, revocation, and an empty selection", () => 
{

    const account: ProductionUser = 
{
 ...user("view_production", "view_film_dashboard", "view_cutting_dashboard", "operate_printing"),
      production_role_binding: 
{
 mode: "operator", stages: ["film", "cutting"] 
}
 
}
;

    expect(tabs(account)).toEqual(["film", "cutting"])
;

    account.permissions = ["view_production", "view_cutting_dashboard"]
;

    expect(tabs(account)).toEqual(["cutting"])
;

    account.production_role_binding = 
{
 mode: "operator", stages: [] 
}
;

    expect(tabs(account)).toEqual([])
;

  
}
)
;

  it.each(["admin", "manage_production"])("preserves %s management regardless of binding", permission => 
{

    const account: ProductionUser = 
{
 ...user(permission), production_role_binding: 
{
 mode: "operator", stages: ["film"] 
}
 
}
;

    expect(tabs(account).slice(0, 3)).toEqual(["film", "printing", "cutting"])
;

  
}
)
;

  it("does not turn renamed Sales into an operator or grant authority through a binding", () => 
{

    const account: ProductionUser = 
{
 ...user("view_production", "view_film_dashboard"), role_name: "Film Operator",
      production_role_binding: 
{
 mode: "general", stages: [] 
}
 
}
;

    expect(tabs(account)).toEqual(["film", "printing", "cutting"])
;

    account.permissions = []
;

    expect(tabs(account)).toEqual([])
;

  
}
)
;

  it.each([[], ["*"], ["view_reports"]].map(permissions => (
{
 permissions 
}
)))(
    "does not invent production grants from $permissions", (
{
 permissions 
}
) => 
{

      expect(tabs(user(...permissions))).toEqual([])
;

      expect(initialProductionPath(user(...permissions))).toBeNull()
;

      expect(canOpenProductionView(user(...permissions), "roll")).toBe(false)
;

    
}
,
  )
;

}
)
;
