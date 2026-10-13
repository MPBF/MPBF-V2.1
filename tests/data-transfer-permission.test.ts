import express from "express";
import {afterAll,beforeAll,describe,expect,it,jest} from "@jest/globals";
import { createDataTransferRouter } from "../server/data-transfer/routes";
jest.mock("../server/db",()=>({pool:{query:jest.fn()},db:{}}));
describe("general data transfer uses effective explicit admin permission",()=>{
 let server:ReturnType<ReturnType<typeof express>["listen"]>,origin:string;
 const service:any={schema:jest.fn(async()=>({ready:true,tables:[]})),reject:jest.fn(async()=>{})};
 beforeAll(async()=>{
   const app=express();app.use(express.json());app.use((req,_res,next)=>{
     if(req.headers["x-grants"]!==undefined)req.user={id:1,role_id:Number(req.headers["x-role"]||1),
       permissions:String(req.headers["x-grants"]).split(","),original_user:{id:1,permissions:["admin"]}} as any;
     next();
   });app.use("/data",createDataTransferRouter(service));server=app.listen(0,"127.0.0.1");
   await new Promise<void>(resolve=>server.once("listening",resolve));origin=`http://127.0.0.1:${(server.address() as any).port}`;
 });
 afterAll(()=>new Promise<void>(resolve=>server.close(()=>resolve())));
 it.each(["","*","manage_users","view_finished_inventory"])("blocks %s on schema/uploads/export/apply/download before processing",async(grants)=>{
   for(const [path,method] of [["schema","GET"],["read-file","POST"],["export","POST"],["apply","POST"],
     ["backups/00000000-0000-0000-0000-000000000000","GET"]] as const){
     const response=await fetch(`${origin}/data/${path}`,{method,headers:{"x-grants":grants,"x-role":"10"}});
     expect(response.status).toBe(403);
   }
 });
 it("rejects unauthenticated requests",async()=>expect((await fetch(`${origin}/data/schema`)).status).toBe(401));
 it.each(["1","10"])("accepts admin regardless of role %s",async(role)=>{
   const response=await fetch(`${origin}/data/schema`,{headers:{"x-grants":"admin","x-role":role}});
   expect(response.status).toBe(200);expect(response.headers.get("cache-control")).toBe("no-store");
 });
 it("does not give a role-preview user original administrator powers",async()=>{
   expect((await fetch(`${origin}/data/schema`,{headers:{"x-grants":"manage_orders","x-role":"10"}})).status).toBe(403);
 });
});
