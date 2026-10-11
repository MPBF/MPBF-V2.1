import express from "express";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { createProductionRouter } from "../server/production/routes";
import type { ConnectionPool } from "../server/production/core";

jest.mock("../server/db", () => ({ pool: {} }));
jest.mock("../server/auth", () => ({
  requireAuth: (req: any,res: any,next: any) => req.user ? next() : res.status(401).json({message:"Login required"}),
}));

describe("raw mixing HTTP validation and authorization", () => {
  let server: ReturnType<ReturnType<typeof express>["listen"]>;
  let origin:string;
  const connect=jest.fn<ConnectionPool["connect"]>();
  const valid=()=>({request_id:randomUUID(),machine_id:"F1",items:[{material_id:1,quantity_kg:"12.25"}]});
  beforeAll(async()=>{
    const app=express();
    app.use(express.json());
    app.use((req,_res,next)=>{
      const grants=req.get("x-test-permissions");
      if(grants!==undefined)req.user={id:7,permissions:grants.split(",").filter(Boolean)} as any;
      next();
    });
    app.use("/api/production",createProductionRouter({connect}));
    app.use((_error: unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>res.status(500).json({message:"Fixture storage boundary"}));
    server=app.listen(0,"127.0.0.1");
    await new Promise<void>(resolve=>server.once("listening",resolve));
    origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  });
  afterAll(()=>new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve())));
  beforeEach(()=>{
    connect.mockReset();
    connect.mockRejectedValue(new Error("Fixture storage boundary"));
  });
  const post=(body:unknown,grants:string|null="operate_film",path="/mixing")=>fetch(origin+"/api/production"+path,{
    method:"POST",headers:{"Content-Type":"application/json",...(grants===null?{}:{"x-test-permissions":grants})},body:JSON.stringify(body),
  });
  it("requires login before any database access",async()=>{
    expect((await post(valid(),null)).status).toBe(401);
    expect(connect).not.toHaveBeenCalled();
  });
  it.each(["operate_printing","operate_cutting","view_mixing","view_raw_inventory"])("rejects %s writes",async(grants)=>{
    expect((await post(valid(),grants)).status).toBe(403);
    expect(connect).not.toHaveBeenCalled();
  });
  it.each(["0","-1","1.234","NaN","1,000","1000000000000","1e2"])("rejects invalid quantity %s",async quantity=>{
    const body=valid();body.items[0].quantity_kg=quantity;
    expect((await post(body)).status).toBe(400);
    expect(connect).not.toHaveBeenCalled();
  });
  it.each(["created_by","created_at","balance_after_kg"])("rejects client-authoritative %s",async field=>{
    expect((await post({...valid(),[field]:"spoofed"})).status).toBe(400);
    expect(connect).not.toHaveBeenCalled();
  });
  it("rejects duplicate materials",async()=>{
    const body=valid();body.items.push({...body.items[0]});
    expect((await post(body)).status).toBe(400);
  });
  it("rejects blank machines and excessive notes",async()=>{
    expect((await post({...valid(),machine_id:""})).status).toBe(400);
    expect((await post({...valid(),notes:"x".repeat(2001)})).status).toBe(400);
  });
  it("accepts a valid film write up to the storage boundary",async()=>{
    expect((await post(valid())).status).toBe(500);
    expect(connect).toHaveBeenCalledTimes(1);
  });
  it.each(["C","ABA","a","",null,1])("rejects invalid screw %s before storage",async screw=>{
    expect((await post({...valid(),screw})).status).toBe(400);
    expect(connect).not.toHaveBeenCalled();
  });
  it.each(["A","B"])("accepts explicit screw %s at route boundary",async screw=>{
    expect((await post({...valid(),screw})).status).toBe(500);
    expect(connect).toHaveBeenCalledTimes(1);
  });
  it("retires free-form creation even for administrators",async()=>{
    expect((await post({request_id:randomUUID(),code:"HDPE",name:"HDPE",name_ar:"خام",opening_kg:"0"},"admin","/raw-materials")).status).toBe(410);
    expect(connect).not.toHaveBeenCalled();
  });
  it.each(["operate_film","view_raw_inventory","view_mixing"])("does not grant %s manual stock write access",async grant=>{
    expect((await post({request_id:randomUUID(),kind:"receipt",items:[{material_id:1,quantity_kg:"1"}]},grant,"/raw-materials/movements")).status).toBe(403);
    expect(connect).not.toHaveBeenCalled();
  });
  it.each(["receipt","issue"])("accepts %s only as a catalogue movement",async kind=>{
    expect((await post({request_id:randomUUID(),kind,items:[{material_id:1,quantity_kg:"1"}]},"manage_raw_materials","/raw-materials/movements")).status).toBe(500);
    expect(connect).toHaveBeenCalledTimes(1);
  });
  it.each(["-1","0","1.234","NaN"])("rejects movement quantity %s",async quantity=>{
    expect((await post({request_id:randomUUID(),kind:"receipt",items:[{material_id:1,quantity_kg:quantity}]},"admin","/raw-materials/movements")).status).toBe(400);
    expect(connect).not.toHaveBeenCalled();
  });
  it.each(["name","code","item_id","created_by","created_at"])("rejects free-form/spoofed movement field %s",async field=>{
    const body={request_id:randomUUID(),kind:"issue",items:[{material_id:1,quantity_kg:"1",[field]:"forged"}]};
    expect((await post(body,"admin","/raw-materials/movements")).status).toBe(400);
    expect(connect).not.toHaveBeenCalled();
  });
  it("rejects invalid direction and duplicate stock lines",async()=>{
    expect((await post({request_id:randomUUID(),kind:"transfer",items:[{material_id:1,quantity_kg:"1"}]},"admin","/raw-materials/movements")).status).toBe(400);
    expect((await post({request_id:randomUUID(),kind:"issue",items:[{material_id:1,quantity_kg:"1"},{material_id:1,quantity_kg:"2"}]},"admin","/raw-materials/movements")).status).toBe(400);
  });
  it("denies unrelated readers without connecting",async()=>{
    expect((await fetch(origin+"/api/production/mixing",{headers:{"x-test-permissions":"operate_cutting"}})).status).toBe(403);
    expect(connect).not.toHaveBeenCalled();
  });
});
