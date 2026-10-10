import { describe, it, expect, jest, beforeAll, afterAll, beforeEach } from "@jest/globals";
import { createServer, type Server } from "node:http";
import express from "express";
import { canMonitorProduction } from "../shared/production-monitoring";
import { availableProductionViews, canOpenProductionView } from "../client/src/lib/production-navigation";
import { ProductionMonitoringService } from "../server/production/monitoring";

jest.mock("../server/auth",()=>({requireAuth:(req:any,res:any,next:any)=>{
  if (!req.headers["x-test-grants"]) return res.status(401).json({});
  req.user={id:1,permissions:JSON.parse(req.headers["x-test-grants"]),role_id:10,role_name:"Administrator"};
  next();
}}));
jest.mock("../server/db",()=>({pool:{connect:jest.fn()}}));
import { createProductionRouter } from "../server/production/routes";
const connect=jest.fn<()=>Promise<any>>().mockRejectedValue(new Error("storage reached"));
let server:Server, origin:string;
beforeAll(async()=>{
  const app=express(); app.use(express.json());
  app.use("/api/production",createProductionRouter({connect}));
  app.use((_error:any,_req:any,res:any,_next:any)=>res.status(500).json({message_en:"storage reached"}));
  server=createServer(app);
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  origin=`http://127.0.0.1:${(server.address() as any).port}/api/production/monitoring`;
});
afterAll(()=>new Promise<void>(resolve=>server.close(()=>resolve())));
beforeEach(()=>{connect.mockClear();});
const get=(path:string,permissions:string[]=[])=>fetch(`${origin}${path}`,{headers:{"x-test-grants":JSON.stringify(permissions)}});
describe("explicit effective administrator monitoring boundary",()=>{
  const paths=["/log","/summary","/mixes","/mixes/1","/rolls/1"];
  it.each([[],["*"],["manage_production"],["operate_film"],["view_mixing"],["manage_mixing"]].map(permissions=>({permissions})))("rejects grants $permissions before storage",async({permissions})=>{
    const user={id:1,permissions,role_name:"Administrator",role_name_ar:"مسؤول"};
    expect(canMonitorProduction(user)).toBe(false);
    expect(canOpenProductionView(user,"monitoring")).toBe(false);
    expect(availableProductionViews(user).some(v=>v.view==="monitoring")).toBe(false);
    for(const path of paths) expect((await get(path,permissions)).status).toBe(403);
    expect(connect).not.toHaveBeenCalled();
    await expect(new ProductionMonitoringService({connect}).summary(user)).rejects.toMatchObject({status:403});
    expect(connect).not.toHaveBeenCalled();
  });
  it("uses preview's effective grants, not previous admin identity",async()=>{
    expect(canOpenProductionView({id:1,permissions:["admin"]},"monitoring")).toBe(true);
    expect((await get("/summary",["admin"])).status).toBe(500);
    connect.mockClear();
    expect((await get("/summary",["view_production"])).status).toBe(403);
    expect(connect).not.toHaveBeenCalled();
  });
  it.each(["?limit=101","?limit=0","?stage=done","?from=invalid","?from=2026-10-10&to=2026-10-09","?machine_id=","?search="+ "a".repeat(121),"?unexpected=x"])("validates log filters %s before storage",async query=>{
    expect((await get(`/log${query}`,["admin"])).status).toBe(400);
    expect(connect).not.toHaveBeenCalled();
  });
  it("denies anonymous direct API access",async()=>{
    expect((await fetch(`${origin}/log`)).status).toBe(401);
    expect(connect).not.toHaveBeenCalled();
  });
});
