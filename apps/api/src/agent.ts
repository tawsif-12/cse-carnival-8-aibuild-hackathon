import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { db } from "./db";
import { asyncRoute, HttpError, parse } from "./http";
import { serializeEvent, serializeRoom } from "./serializers";

export const agent = Router();
const chatSchema=z.object({message:z.string().min(1).max(4000),history:z.array(z.object({role:z.enum(["user","assistant"]),content:z.string().max(8000)})).max(20).default([])});
const tools:any[]=[
 {type:"function",name:"list_schedules",description:"Read the live class schedule. Use for next-class and classes-by-day questions.",parameters:{type:"object",properties:{day:{type:["string","null"]},course:{type:["string","null"]}},required:["day","course"],additionalProperties:false},strict:true},
 {type:"function",name:"list_rooms",description:"Read and filter live rooms, including time-specific availability and equipment.",parameters:{type:"object",properties:{type:{type:["string","null"],enum:["classroom","lab","seminar",null]},min_capacity:{type:["number","null"]},equipment:{type:["string","null"],description:"Comma-separated equipment"},date:{type:["string","null"]},start_time:{type:["string","null"]},end_time:{type:["string","null"]}},required:["type","min_capacity","equipment","date","start_time","end_time"],additionalProperties:false},strict:true},
 {type:"function",name:"book_room",description:"Book one specific room only after the user supplied room, date, start/end time, and purpose. Never guess missing values.",parameters:{type:"object",properties:{room_id:{type:"string"},date:{type:"string"},start_time:{type:"string"},end_time:{type:"string"},purpose:{type:"string"}},required:["room_id","date","start_time","end_time","purpose"],additionalProperties:false},strict:true},
 {type:"function",name:"list_events",description:"Read live events. Name is a fuzzy search term.",parameters:{type:"object",properties:{date:{type:["string","null"]},status:{type:["string","null"]},name:{type:["string","null"]}},required:["date","status","name"],additionalProperties:false},strict:true},
 {type:"function",name:"register_event",description:"Register My Student for one event after identifying an unambiguous event and checking current capacity.",parameters:{type:"object",properties:{event_id:{type:"string"}},required:["event_id"],additionalProperties:false},strict:true},
 {type:"function",name:"list_announcements",description:"Read live announcements by priority, optionally including expired notices.",parameters:{type:"object",properties:{priority:{type:["string","null"],enum:["high","medium","low",null]},include_expired:{type:"boolean"}},required:["priority","include_expired"],additionalProperties:false},strict:true},
 {type:"function",name:"list_assignments",description:"Read live assignments, optionally by status or deadline window.",parameters:{type:"object",properties:{status:{type:["string","null"],enum:["pending","submitted","graded","late",null]},due_within_days:{type:["number","null"]}},required:["status","due_within_days"],additionalProperties:false},strict:true}
];
const system=(now:string)=>`You are the CampusOS student assistant for My Student (student_id: my-student). Current campus date/time is ${now}; timezone Asia/Dhaka; university days are Sunday-Thursday.
Always use tools for campus facts, even if the conversation contains an earlier result. Never invent or cache campus data. Interpret relative dates from the supplied current time and state the concrete date when discussing an action.
For next class, read schedules and correctly roll forward across university days. For multi-source questions, call every needed read tool.
Before book_room, require a specific room, date, start time, end time, and purpose. If any is missing or a request says 'any room' without choosing one, ask a concise clarification and do not book. You may list matching available rooms first.
Before register_event, identify exactly one event from fresh data. Ask if matching is ambiguous. Never call destructive CRUD actions; explain that deletions must be done in the dashboard. Respect tool errors and clearly report conflicts/capacity failures. Keep answers concise and friendly. Return plain text without Markdown formatting.`;

type GeminiPart={text?:string;functionCall?:{id?:string;name:string;args?:Record<string,unknown>};functionResponse?:{id?:string;name:string;response:Record<string,unknown>}};
type GeminiContent={role:"user"|"model";parts:GeminiPart[]};
type GeminiResponse={candidates?:Array<{content?:GeminiContent}>;error?:{message?:string}};

function geminiSchema(value:any):any{
 if(Array.isArray(value))return value.map(geminiSchema);
 if(!value||typeof value!=="object")return value;
 const result:any={};
 for(const [key,item] of Object.entries(value)){
  if(key==="strict"||key==="additionalProperties")continue;
  if(key==="type"&&Array.isArray(item)){result.type=item.find(x=>x!=="null")??"string";result.nullable=item.includes("null");continue}
  result[key]=geminiSchema(item);
 }
 return result;
}
const geminiTools=[{functionDeclarations:tools.map(({type:_type,strict:_strict,...tool})=>geminiSchema(tool))}];

async function generateGemini(contents:GeminiContent[],now:string){
 const key=process.env.GEMINI_API_KEY;if(!key)throw new HttpError(503,"Set GEMINI_API_KEY in apps/api/.env to enable the agent");
 const model=process.env.GEMINI_MODEL??"gemini-3.6-flash";
 const response=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,{method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":key},body:JSON.stringify({systemInstruction:{parts:[{text:system(now)}]},contents,tools:geminiTools,toolConfig:{functionCallingConfig:{mode:"AUTO"}},generationConfig:{temperature:.2,maxOutputTokens:1200}})});
 const body=await response.json() as GeminiResponse;
 if(!response.ok)throw new HttpError(response.status===401||response.status===403?503:502,body.error?.message??`Gemini request failed (${response.status})`);
 const content=body.candidates?.[0]?.content;if(!content)throw new HttpError(502,"Gemini returned no response");return content;
}

async function execute(name:string,args:any){
 if(name==="list_schedules")return db.schedule.findMany({where:{day:args.day??undefined,course:args.course?{contains:args.course}:undefined},orderBy:[{day:"asc"},{start_time:"asc"}]});
 if(name==="list_rooms"){
  const records=await db.room.findMany({where:{type:args.type??undefined,capacity:args.min_capacity?{gte:args.min_capacity}:undefined,status:"available",bookings:args.date&&args.start_time&&args.end_time?{none:{date:args.date,start_time:{lt:args.end_time},end_time:{gt:args.start_time}}}:undefined},include:{bookings:true},orderBy:{room_number:"asc"}});
  const wanted=String(args.equipment??"").split(",").map(x=>x.trim().toLowerCase()).filter(Boolean);return records.map(serializeRoom).filter(r=>wanted.every(w=>r.equipment.some(e=>e.toLowerCase()===w)));
 }
 if(name==="book_room")return db.$transaction(async tx=>{const room=await tx.room.findUnique({where:{id:args.room_id}});if(!room)throw new HttpError(404,"Room not found");if(room.status!=="available")throw new HttpError(409,"Room is unavailable");if(args.start_time>=args.end_time)throw new HttpError(400,"End time must be after start time");const conflict=await tx.booking.findFirst({where:{room_id:room.id,date:args.date,start_time:{lt:args.end_time},end_time:{gt:args.start_time}}});if(conflict)throw new HttpError(409,"That room is already booked during the requested time");await tx.booking.create({data:{booking_id:`bk-${randomUUID()}`,booked_by:"My Student",date:args.date,start_time:args.start_time,end_time:args.end_time,purpose:args.purpose,room_id:room.id}});return serializeRoom(await tx.room.findUniqueOrThrow({where:{id:room.id},include:{bookings:true}}))});
 if(name==="list_events"){const rows=await db.event.findMany({where:{date:args.date??undefined,status:args.status??undefined},include:{registrations:true},orderBy:[{date:"asc"},{start_time:"asc"}]});const q=String(args.name??"").toLowerCase();return rows.map(serializeEvent).filter(e=>!q||`${e.name} ${e.description}`.toLowerCase().includes(q));}
 if(name==="register_event")return db.$transaction(async tx=>{const event=await tx.event.findUnique({where:{id:args.event_id},include:{registrations:true}});if(!event)throw new HttpError(404,"Event not found");if(event.registered>=event.capacity||event.status==="full")throw new HttpError(409,"Event is full");if(event.registrations.some(r=>r.student_id==="my-student"))throw new HttpError(409,"You are already registered");await tx.registration.create({data:{event_id:event.id,student_id:"my-student",name:"My Student"}});const registered=event.registered+1;return serializeEvent(await tx.event.update({where:{id:event.id},data:{registered,status:registered>=event.capacity?"full":event.status},include:{registrations:true}}))});
 if(name==="list_announcements"){const today=new Date().toLocaleDateString("en-CA",{timeZone:"Asia/Dhaka"});return db.announcement.findMany({where:{priority:args.priority??undefined,expires:args.include_expired?undefined:{gte:today}},orderBy:{date:"desc"}})}
 if(name==="list_assignments"){const today=new Date().toLocaleDateString("en-CA",{timeZone:"Asia/Dhaka"});let end:string|undefined;if(args.due_within_days!==null){const d=new Date();d.setDate(d.getDate()+args.due_within_days);end=d.toLocaleDateString("en-CA",{timeZone:"Asia/Dhaka"})}return db.assignment.findMany({where:{status:args.status??undefined,deadline:end?{gte:today,lte:end}:undefined},orderBy:{deadline:"asc"}})}
 throw new HttpError(400,`Unknown tool: ${name}`);
}

agent.post("/chat",asyncRoute(async(req,res)=>{
 const input=parse(chatSchema,req.body),now=new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Dhaka",dateStyle:"full",timeStyle:"short"}).format(new Date());
 const contents:GeminiContent[]=[...input.history.map(item=>({role:item.role==="assistant"?"model" as const:"user" as const,parts:[{text:item.content}]})),{role:"user",parts:[{text:input.message}]}];
 const used:string[]=[];let content=await generateGemini(contents,now);
 for(let turn=0;turn<8;turn++){
  contents.push(content);const calls=content.parts.filter(part=>part.functionCall).map(part=>part.functionCall!);if(!calls.length)break;
  const responses:GeminiPart[]=[];
  for(const call of calls){used.push(call.name);try{responses.push({functionResponse:{id:call.id,name:call.name,response:{result:await execute(call.name,call.args??{})}}})}catch(error){responses.push({functionResponse:{id:call.id,name:call.name,response:{error:error instanceof Error?error.message:"Tool failed"}}})}}
  contents.push({role:"user",parts:responses});content=await generateGemini(contents,now);
 }
 const message=content.parts.map(part=>part.text??"").join("").trim();res.json({message:message||"I couldn't complete that request.",tools_used:[...new Set(used)]});
}));
