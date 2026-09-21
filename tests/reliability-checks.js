'use strict';
// All external services and authentication below are mocked. No real credentials used.
window.runReliabilityChecks=async function(sources){
for(const source of Object.values(sources)) new Function(source);

function assert(v,m){if(!v)throw Error(m);}
function setup(){
 const calls=[],nodes={},objects=new Set(['user-a/habit-a/old.jpg']);
 let row={id:'entry-a',habit_id:'habit-a',entry_date:'2026-09-21',done:true,rest:false,value:10,metric:null,photo_path:'user-a/habit-a/old.jpg',updated_at:'2026-09-21T00:00:00Z'};
 let handler=null,n=0,now=1000000;
 const el=id=>nodes[id]||(nodes[id]={innerHTML:'',inert:false,disabled:false});
 async function run(q,action){calls.push(q);if(handler){const result=await handler(q);if(result!==undefined)return result;}return action();}
 const bucket={
 upload(path,file,options){return run({op:'upload',path,file,options},()=>{objects.add(path);return {data:{path},error:null};});},
 remove(paths){return run({op:'remove',paths},()=>{paths.forEach(p=>objects.delete(p));return {data:[],error:null};});},
 list(prefix,options){return run({op:'list',prefix,options},()=>({data:[...objects].filter(p=>p.startsWith(prefix+'/')).sort().map(p=>({name:p.slice(prefix.length+1),id:p})).slice(options.offset,options.offset+options.limit),error:null}));},
 createSignedUrl(path,seconds){return run({op:'sign',path,seconds},()=>({data:{signedUrl:'https://signed.example/'+path+'?token=test'},error:null}));}
 };
 const client={storage:{from(name){assert(name==='proof-photos','private bucket');return bucket;}},from(table){
 const q={op:'select',table,filters:[]};
 return {
 select(columns){q.columns=columns;return this;},eq(k,v){q.filters.push([k,v]);return this;},
 order(){return this;},range(a,b){q.range=[a,b];return this;},maybeSingle(){q.single=true;return this;},single(){q.single=true;return this;},
 upsert(payload,options){q.op='upsert';q.payload=payload;q.options=options;return this;},delete(){q.op='delete';return this;},
 then(resolve,reject){return run(q,()=>{
  if(q.op==='upsert'){row={...row,...q.payload};return {data:{...row},error:null};}
  if(q.op==='delete')return {data:{id:'habit-a'},error:null};
  if(q.single)return {data:row?{...row}:null,error:null};
  return {data:q.range[0]===0&&row?[{...row}]:[],error:null};
 }).then(resolve,reject);}
 };}};
 const document={querySelectorAll:()=>[]};
 const fakeDate=class extends Date{static now(){return now;}};
 const state=new Function('window','document','el','crypto','setInterval','setTimeout','Date',`
 var habits=[{id:'habit-a'}],entries={'habit-a':{'2026-09-21':{done:true,rest:false,value:10,metric:null,photo:'user-a/habit-a/old.jpg'}}},selected='habit-a',storeReady=true,view='proof';
 function esc(s){return String(s).replace(/</g,'&lt;');}
 function render(){}
 function byId(id){return habits.find(h=>h.id===id);}
 function entryOf(h,k){return (entries[h.id]||{})[k];}
 ${sources['storage.js']}
 ${sources['photos.js']}
 storageUserId='user-a';
 return {uploadProofPhoto,removeProofPhoto,removeHabit,saveEntry,signedPhoto,loadProofImage,retryProofImage,entryFromRow,
 state(){return {habits,entries,photoUrls,storageBusy};},
 changeAccount(){storageGeneration++;storageUserId='user-b';resetPhotoSession();habits=[];entries={};},
 client:window.getSupabaseClient()};`
 )({getSupabaseClient:()=>client},document,el,{randomUUID:()=> 'unique-'+(++n)},()=>{},()=>{},fakeDate);
 return {...state,calls,objects,el,h:{id:'habit-a'},k:'2026-09-21',getRow:()=>row,setRow:r=>row=r,setHandler:fn=>handler=fn,advance:ms=>now+=ms};
}
async function flush(){for(let i=0;i<30;i++)await Promise.resolve();}


{
const file={type:'image/jpeg',size:500};
let t=setup();
assert(await t.uploadProofPhoto(t.h,t.k,file),'replacement succeeds');
assert(t.calls.map(q=>q.op).join(',')==='select,upload,upsert,remove','replacement order');
const uploaded=t.calls.find(q=>q.op==='upload'),saved=t.calls.find(q=>q.op==='upsert');
assert(uploaded.path==='user-a/habit-a/unique-1.jpg'&&uploaded.options.upsert===false,'owned unique non-overwrite path');
assert(saved.payload.photo_path===uploaded.path&&!saved.payload.photo_path.includes('https:'),'path-only DB');
assert(t.state().entries[t.h.id][t.k].photo===uploaded.path&&!t.objects.has('user-a/habit-a/old.jpg'),'UI and cleanup');
assert(await t.uploadProofPhoto(t.h,t.k,file),'second replacement');
assert(t.calls.filter(q=>q.op==='upload')[1].path!==uploaded.path,'fresh filename every time');
await t.saveEntry(t.h,t.k,{value:12});
assert(!Object.hasOwn(t.calls.filter(q=>q.op==='upsert').at(-1).payload,'photo_path'),'day edits preserve photo');
for(const invalid of [{type:'image/gif',size:10},{type:'image/jpeg',size:5*1024*1024+1},{type:'image/png',size:0}]){
 t=setup();assert(await t.uploadProofPhoto(t.h,t.k,invalid)===false&&t.calls.length===0,'invalid file blocked');
 assert(t.el('storeNote').innerHTML.includes('Could not save'),'validation visible');
}
t=setup();t.setHandler(q=>q.op==='upload'?{error:{message:'Upload denied'}}:undefined);
assert(await t.uploadProofPhoto(t.h,t.k,file)===false&&!t.calls.some(q=>q.op==='upsert'),'upload failure no DB write');
t=setup();t.setHandler(q=>q.op==='upsert'?{error:{message:'DB rejected'}}:undefined);
assert(await t.uploadProofPhoto(t.h,t.k,file)===false,'DB failure');
assert(t.calls.at(-1).op==='remove'&&t.calls.at(-1).paths[0].includes('unique-1'),'new object rollback');
assert(t.objects.has('user-a/habit-a/old.jpg')&&t.state().entries[t.h.id][t.k].photo.endsWith('old.jpg'),'old photo preserved');
t=setup();t.setHandler(q=>q.op==='upsert'?{error:{message:'DB rejected'}}:q.op==='remove'?{error:{message:'Cleanup denied'}}:undefined);
await t.uploadProofPhoto(t.h,t.k,file);assert(t.el('storeNote').innerHTML.includes('Cleanup denied'),'rollback failure visible');
t=setup();t.setHandler(q=>q.op==='remove'?{error:{message:'Old delete failed'}}:undefined);
assert(await t.uploadProofPhoto(t.h,t.k,file),'replacement remains saved if old cleanup fails');
assert(t.state().entries[t.h.id][t.k].photo.includes('unique-1')&&t.el('storeNote').innerHTML.includes('Old delete failed'),'warning and saved state');
t=setup();assert(await t.removeProofPhoto(t.h,t.k),'remove succeeds');
assert(t.calls.map(q=>q.op).join(',')==='select,remove,upsert'&&t.getRow().photo_path===null,'remove then clear');
t=setup();t.setHandler(q=>q.op==='remove'?{error:{message:'Removal denied'}}:undefined);
assert(await t.removeProofPhoto(t.h,t.k)===false&&!t.calls.some(q=>q.op==='upsert'),'failed removal preserves path');
t=setup();t.setHandler(q=>q.op==='upsert'?{error:{message:'DB clear failed'}}:undefined);
await t.removeProofPhoto(t.h,t.k);assert(t.el('storeNote').innerHTML.includes('Retry removing'),'clear failure actionable');
t=setup();for(let i=0;i<205;i++)t.objects.add('user-a/habit-a/file-'+i+'.png');
assert(await t.removeHabit(t.h),'habit cleanup succeeds');
assert(t.objects.size===0&&t.calls.at(-1).op==='delete'&&t.calls.at(-1).table==='habits','only habit deleted after photos');
assert(t.calls.filter(q=>q.op==='remove').length===3&&t.calls.filter(q=>q.op==='list').length===4,'batched paginated cleanup');
for(const operation of ['list','remove']){
 t=setup();t.setHandler(q=>q.op===operation?{error:{message:'Storage denied'}}:undefined);
 assert(await t.removeHabit(t.h)===false&&!t.calls.some(q=>q.op==='delete'),'storage failure blocks habit deletion');
}
t=setup();let a=await t.signedPhoto('user-a/habit-a/old.jpg');let b=await t.signedPhoto('user-a/habit-a/old.jpg');
assert(a.url===b.url&&t.calls.filter(q=>q.op==='sign').length===1,'signed URL cache');
t.advance(56*60*1000);await t.signedPhoto('user-a/habit-a/old.jpg');assert(t.calls.filter(q=>q.op==='sign').length===2,'expiry refresh');
assert(t.entryFromRow(t.getRow()).photo==='user-a/habit-a/old.jpg','refresh path mapping');
let denied=false;try{await t.signedPhoto('other-user/habit-a/file.jpg');}catch(e){denied=true;}assert(denied,'foreign path rejected');
t.changeAccount();assert(Object.keys(t.state().photoUrls).length===0,'cache clear');
t=setup();let resolveUpload;t.setHandler(q=>q.op==='upload'?new Promise(r=>resolveUpload=r):undefined);
let pending=t.uploadProofPhoto(t.h,t.k,file);await flush();t.changeAccount();resolveUpload({data:{path:'user-a/habit-a/unique-1.jpg'},error:null});
assert(await pending===false&&!t.calls.some(q=>q.op==='upsert')&&t.calls.at(-1).op==='remove','stale upload cleanup');


}
{
// Browser runs use the native URL parser. The isolated V8 runner supplies this
// minimal URL fixture because it has no browser globals.
const TestURL=globalThis.URL||class {
 constructor(value){
  const match=/^(https?):\/\/(?:([^:@/]+):([^@/]+)@)?([^/?#]+)([^?#]*)(\?[^#]*)?(#.*)?$/.exec(value);
  if(!match)throw new Error('Invalid URL');
  this.protocol=match[1]+':';this.username=match[2]||'';this.password=match[3]||'';
  this.pathname=match[5]||'/';this.search=match[6]||'';this.hash=match[7]||'';
 }
};

function authSetup(options={}){
 const nodes={};let listener,resets=0;
 const node=id=>nodes[id]||(nodes[id]={hidden:id==='appScreen',disabled:id==='authFields',value:'',textContent:'',
 addEventListener(name,fn){this[name]=fn;},reset(){node('authPassword').value='';}});
 const auth={
 onAuthStateChange(fn){listener=fn;},
 async getSession(){return {data:{session:options.session||null},error:null};},
 async signInWithPassword(){listener('SIGNED_IN',{user:{id:'one'}});return {data:{session:{user:{id:'one'}}},error:null};},
 async signUp(){return {data:{session:null},error:null};},
 async signOut(){listener('SIGNED_OUT',null);return {error:null};},
 ...options.auth};
 const window={location:{origin:'https://habittrackerapp.online',pathname:'/'},getSupabaseClient(){
 if(options.configError)throw new Error('Config unavailable');return {auth};}};
 new Function('window','document','resetTrackerSession','closeModal','setTimeout','clearTimeout',sources['auth.js'])(
 window,{getElementById:node},()=>resets++,()=>{},()=>1,()=>{});
 return {node,auth,event:(e,s)=>listener(e,s),resets:()=>resets};
}
let a=authSetup();assert(a.node('appScreen').hidden&&a.node('authFields').disabled,'auth gate during restoration');
await flush();assert(!a.node('authFields').disabled&&a.node('appScreen').hidden,'signed out form');
await a.node('authForm').submit({preventDefault(){}});assert(!a.node('appScreen').hidden,'login opens app');
let resetCount=a.resets();a.event('TOKEN_REFRESHED',{user:{id:'one'}});assert(a.resets()===resetCount,'token refresh retains data');
a.event('SIGNED_IN',{user:{id:'two'}});assert(a.resets()===resetCount+1,'account switch resets data');
await a.node('logoutBtn').click();assert(a.node('appScreen').hidden&&a.node('authMessage').textContent==='You have logged out.','logout');
a=authSetup({session:{user:{id:'saved'}}});await flush();assert(!a.node('appScreen').hidden,'session reload');
a.event('SIGNED_OUT',null);assert(a.node('appScreen').hidden,'cross-tab logout hides app');
a=authSetup();await flush();a.node('authSwitch').click.call(a.node('authSwitch'));
let redirect;a.auth.signUp=async credentials=>{redirect=credentials.options.emailRedirectTo;return {data:{session:null},error:null};};
await a.node('authForm').submit({preventDefault(){}});
assert(a.node('authMessage').textContent.includes('Check your email')&&a.node('appScreen').hidden&&redirect==='https://habittrackerapp.online/','confirmation signup/production redirect');
a=authSetup({auth:{async signUp(){this.emit();return {data:{session:{user:{id:'new'}}},error:null};}}});await flush();
a.auth.emit=()=>a.event('SIGNED_IN',{user:{id:'new'}});
a.node('authSwitch').click.call(a.node('authSwitch'));await a.node('authForm').submit({preventDefault(){}});
assert(!a.node('appScreen').hidden,'signup with immediate session');
a=authSetup({auth:{async signInWithPassword(){throw new Error('Offline');}}});await flush();
await a.node('authForm').submit({preventDefault(){}});
assert(a.node('authMessage').textContent==='Offline'&&!a.node('authFields').disabled,'network failure re-enables login');
a=authSetup({configError:true});await flush();
assert(a.node('authFields').disabled&&a.node('appScreen').hidden&&a.node('authMessage').textContent==='Config unavailable','config failure stays closed');
let resolveSession;a=authSetup({auth:{getSession(){return new Promise(r=>resolveSession=r);}}});
a.event('SIGNED_IN',{user:{id:'new'}});resolveSession({data:{session:null},error:{message:'Stale error'}});await flush();
assert(!a.node('appScreen').hidden&&a.node('authMessage').textContent!=='Stale error','stale restore error ignored');
a=authSetup({session:{user:{id:'one'}}});await flush();let resolveLogout;
a.auth.signOut=()=>new Promise(r=>resolveLogout=r);
let logoutPending=a.node('logoutBtn').click();a.event('SIGNED_OUT',null);
assert(a.node('authFields').disabled,'login blocked until logout settles');
a.event('SIGNED_IN',{user:{id:'two'}});resolveLogout({error:null});await logoutPending;
assert(!a.node('appScreen').hidden,'old logout cannot hide new account');
a=authSetup();await flush();let calls=0,resolveLogin;
a.auth.signInWithPassword=()=>{calls++;return new Promise(r=>resolveLogin=r);};
let loginPending=a.node('authForm').submit({preventDefault(){}});
await a.node('authForm').submit({preventDefault(){}});
assert(calls===1&&a.node('authFields').disabled&&a.node('logoutBtn').disabled,'duplicate auth submissions blocked');
resolveLogin({error:{message:'Invalid credentials'}});await loginPending;
assert(!a.node('authFields').disabled&&a.node('authMessage').textContent==='Invalid credentials','login failure UI');
a=authSetup({session:{user:{id:'one'}},auth:{async signOut(){return {error:{message:'Logout failed'}};}}});await flush();await a.node('logoutBtn').click();
assert(!a.node('appScreen').hidden&&a.node('accountMessage').textContent==='Logout failed','logout failure stays signed in');
// Client validation is evaluated only with dummy public values, never real credentials.
function configured(config,sdk=true){
 const window={APP_CONFIG:config};
 if(sdk)window.supabase={createClient:(url,key,options)=>({url,key,options})};
 new Function('window','URL',sources['supabase-client.js'])(window,TestURL);return window.getSupabaseClient;
}
const good={SUPABASE_URL:'https://project.example',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test'};
let getClient=configured(good);assert(getClient()===getClient(),'singleton client');
for(const config of [undefined,{}, {...good,SUPABASE_URL:'javascript:alert(1)'},{...good,SUPABASE_URL:'https://user:password@project.example'},{...good,SUPABASE_URL:'https://project.example/path'},{...good,SUPABASE_PUBLISHABLE_KEY:'sb_secret_test'},{...good,SUPABASE_PUBLISHABLE_KEY:'sb_publishable_'}]){
 let rejected=false;try{configured(config)();}catch(error){rejected=true;}assert(rejected,'invalid config rejected before client init');
}
let sdkFailed=false;try{configured(good,false)();}catch(error){sdkFailed=true;}assert(sdkFailed,'missing CDN SDK handled');


}
{
function dbSetup(){
 const calls=[],nodes={},h={id:'h-one',name:'Walk',emoji:'🚶',target:100,unit:'steps',days:60,start_date:'2026-09-21',ramp:true,metric:'weight',created_at:'2026-09-21T00:00:00Z'};
 let rows=Array.from({length:1003},(_,i)=>({id:'entry-'+i,habit_id:h.id,entry_date:'day-'+i,done:true,rest:false,value:'12.5',metric:null,photo_path:null,updated_at:'2026-09-21T00:00:00Z'})),handler=null;
 const el=id=>nodes[id]||(nodes[id]={innerHTML:'',disabled:false,inert:false});
 const client={auth:{getSession:async()=>({data:{session:{user:{id:'owner'}}},error:null})},from(table){
 const q={table,op:'read',filters:[]};
 return {select(columns){q.columns=columns;return this;},eq(k,v){q.filters.push([k,v]);return this;},in(k,v){q.filters.push([k,v]);return this;},
 order(){return this;},range(a,b){q.range=[a,b];return this;},single(){return this;},
 insert(payload){q.op='insert';q.payload=payload;return this;},
 then(resolve,reject){calls.push(q);return Promise.resolve().then(async()=>{
 if(handler){const r=await handler(q);if(r!==undefined)return r;}
 if(q.op==='insert')return {data:{...q.payload,id:'server-id'},error:null};
 return {data:(table==='habits'?[h]:rows).slice(q.range[0],q.range[1]+1),error:null};
 }).then(resolve,reject);}};
 }};
 const api=new Function('window','el','setTimeout',`
 var habits=[],entries={},selected=null,storeReady=false,view='today';
 function esc(s){return String(s);}function render(){}function resetPhotoSession(){}
 ${sources['storage.js']}
 return {boot,saveHabit,
 state(){return {habits,entries,storeReady};},
 reset(){storageGeneration++;habits=[];entries={};storeReady=false;},
 generation(){return storageGeneration;}};`
 )({getSupabaseClient:()=>client},el,()=>{});
 return {...api,calls,el,setHandler:fn=>handler=fn};
}
let db=dbSetup();await db.boot(db.generation());
assert(db.state().storeReady&&db.state().habits[0].start==='2026-09-21','habit loading/date mapping');
assert(Object.keys(db.state().entries['h-one']).length===1003,'entry pagination over 1000 rows');
assert(db.state().entries['h-one']['day-1'].value===12.5&&db.state().entries['h-one']['day-1'].metric===null,'numeric/null mapping');
assert(db.calls[0].filters.some(([k,v])=>k==='user_id'&&v==='owner'),'owner scoped habit read');
await db.saveHabit({...db.state().habits[0],id:'never-send'});
const insert=db.calls.find(q=>q.op==='insert');
assert(!('id' in insert.payload)&&insert.payload.user_id==='owner'&&db.state().habits.at(-1).id==='server-id','DB-generated habit ID');
db=dbSetup();db.setHandler(()=>({data:null,error:{message:'Offline'}}));await db.boot(db.generation());
assert(!db.state().storeReady&&db.el('newBtn').disabled&&db.el('storeNote').innerHTML.includes('Offline'),'load failure visible/writes blocked');
db=dbSetup();let resolveRead;db.setHandler(q=>q.table==='habits'?new Promise(r=>resolveRead=r):undefined);
let loading=db.boot(db.generation());await flush();db.reset();
resolveRead({data:[{id:'old-user-habit'}],error:null});await loading;
assert(!db.state().habits.length&&!Object.keys(db.state().entries).length,'stale load ignored');
// Photo-only writes must not send stale day values from a previously loaded tab.
let photoCase=setup();photoCase.setRow({...photoCase.getRow(),value:99,done:false});
await photoCase.uploadProofPhoto(photoCase.h,photoCase.k,{type:'image/png',size:100});
assert(photoCase.getRow().value===99&&photoCase.getRow().done===false,'photo edit preserves newer database day values');
const change=photoCase.calls.find(q=>q.op==='upsert');
assert(!('done' in change.payload)&&!('value' in change.payload),'only explicit patch fields sent');
photoCase=setup();const original=JSON.stringify(photoCase.state().entries);
photoCase.setHandler(q=>q.op==='upsert'?{error:{message:'Save rejected'}}:undefined);
assert(await photoCase.saveEntry(photoCase.h,photoCase.k,{value:20})===false&&JSON.stringify(photoCase.state().entries)===original,'failed entry save preserves confirmed state');
photoCase=setup();let resolveWrite;
photoCase.setHandler(q=>q.op==='upsert'?new Promise(r=>resolveWrite=r):undefined);
const write=photoCase.saveEntry(photoCase.h,photoCase.k,{value:20});await flush();
const count=photoCase.calls.length;
assert(await photoCase.saveEntry(photoCase.h,photoCase.k,{value:21})===false&&photoCase.calls.length===count,'duplicate write blocked');
photoCase.changeAccount();resolveWrite({data:{...photoCase.getRow(),value:20},error:null});await write;
assert(Object.keys(photoCase.state().entries).length===0,'stale day save ignored');


}
{
function imageFixture(){
 const status={hidden:false,textContent:''},button={hidden:true};
 const parent={querySelector:s=>s==='[role="status"]'?status:s==='button'?button:img};
 const img={dataset:{proofPath:'user-a/habit-a/old.jpg'},parentNode:parent,isConnected:true,hidden:true,src:''};
 button.parentNode=parent;return {img,status,button};
}
let imageCase=setup(),imageUi=imageFixture();
await imageCase.loadProofImage(imageUi.img);imageUi.img.onload();
assert(!imageUi.img.hidden&&imageUi.status.hidden,'signed image display');
imageUi.img.onerror();assert(imageUi.img.hidden&&!imageUi.button.hidden,'download error with retry');
imageCase.retryProofImage(imageUi.button);await flush();
assert(imageCase.calls.filter(q=>q.op==='sign').length===2,'retry regenerates URL');
imageCase=setup();imageUi=imageFixture();
imageCase.setHandler(q=>q.op==='sign'?{error:{message:'Signing failed'}}:undefined);
await imageCase.loadProofImage(imageUi.img);
assert(imageUi.status.textContent.includes('Signing failed')&&!imageUi.button.hidden,'signing error visible');
const uiNodes={};const element=id=>uiNodes[id]||(uiNodes[id]={innerHTML:'',value:'1',checked:true,addEventListener(){}});
const doc={getElementById:element,querySelectorAll:()=>[]};
const app=new Function('document','localStorage','hydrateProofPhotos',`
 ${sources['app.js']}
 habits=[{id:'habit',emoji:'<img src=x onerror=alert(1)>',name:'Safe',days:5,start:'2026-09-21',target:1,unit:'steps',metric:'weight'}];
 entries={habit:{}};storeReady=true;view='manage';render();
 var rendered=el('view').innerHTML;storeReady=false;render();
 return {rendered,loading:el('view').innerHTML};`
)(doc,{getItem:()=>null},()=>{});
assert(app.rendered.includes('&lt;img')&&!app.rendered.includes('<img src=x'),'emoji rendered as text');
assert(app.loading.includes('Loading your habits'),'initial data loading state');

}
return 'PASS: syntax, config validation, auth/session flows, database persistence, private photos, failure handling, duplicates, stale responses, and UI escaping/loading. All service checks used mocks; no live Supabase calls.';
};
