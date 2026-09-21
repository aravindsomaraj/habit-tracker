// Supabase persistence. Authentication and client configuration live separately.
var storageGeneration=0, storageUserId=null, storageBusy=false;
var HABIT_COLUMNS='id,name,emoji,target,unit,days,start_date,metric,ramp,created_at';
var ENTRY_COLUMNS='id,habit_id,entry_date,done,rest,value,metric,updated_at';

function noteStore(msg){
  var html=msg?'<div class="banner" role="status">'+esc(msg)+'</div>':'';
  el('storeNote').innerHTML=html;
  if(el('modalStoreNote')) el('modalStoreNote').innerHTML=html;
}
function storageLock(busy){
  storageBusy=busy;
  el('newBtn').disabled=busy||!storeReady;
  el('view').inert=busy||!storeReady;
  el('modalRoot').inert=busy;
}
function habitFromRow(row){
  return {id:row.id,name:row.name,emoji:row.emoji,target:Number(row.target),
    unit:row.unit,days:row.days,start:row.start_date,metric:row.metric,
    ramp:row.ramp,createdAt:Date.parse(row.created_at)};
}
function entryFromRow(row){
  return {done:!!row.done,rest:!!row.rest,
    value:row.value==null?null:Number(row.value),
    metric:row.metric==null?null:Number(row.metric),
    ts:Date.parse(row.updated_at),photo:null};
}
// Called by the existing tracker reset hook, including logout/account switches.
function resetStorageSession(){
  var generation=++storageGeneration;
  storageUserId=null; storeReady=false;
  storageLock(false);
  // Run outside the synchronous auth callback to avoid the auth client's lock.
  setTimeout(function(){boot(generation);},0);
}
async function readPages(makeQuery,generation){
  var rows=[],offset=0;
  while(generation===storageGeneration){
    var result=await makeQuery().range(offset,offset+499);
    if(result.error) throw result.error;
    if(!result.data.length) break;
    rows=rows.concat(result.data);
    offset+=result.data.length;
  }
  return rows;
}
async function boot(generation){
  if(generation!==storageGeneration) return;
  try{
    var client=window.getSupabaseClient();
    var sessionResult=await client.auth.getSession();
    if(generation!==storageGeneration) return;
    if(sessionResult.error) throw sessionResult.error;
    var session=sessionResult.data.session;
    if(!session){noteStore('');return;}
    storageUserId=session.user.id;
    noteStore('Loading your habits…');
    var rows=await readPages(function(){
      return client.from('habits').select(HABIT_COLUMNS)
        .eq('user_id',storageUserId).order('created_at').order('id');
    },generation);
    var loadedHabits=rows.map(habitFromRow),loadedEntries={};
    loadedHabits.forEach(function(h){loadedEntries[h.id]={};});
    // Bound the URL length and paginate entries instead of relying on the API row cap.
    for(var i=0;i<loadedHabits.length && generation===storageGeneration;i+=100){
      var ids=loadedHabits.slice(i,i+100).map(function(h){return h.id;});
      var daily=await readPages(function(){
        return client.from('habit_entries').select(ENTRY_COLUMNS)
          .in('habit_id',ids).order('id');
      },generation);
      daily.forEach(function(row){loadedEntries[row.habit_id][row.entry_date]=entryFromRow(row);});
    }
    if(generation!==storageGeneration) return;
    habits=loadedHabits; entries=loadedEntries;
    selected=habits.length?habits[0].id:null;
    storeReady=true; storageLock(false); noteStore(''); render();
  }catch(error){
    if(generation!==storageGeneration) return;
    storeReady=false; storageLock(false);
    noteStore('Could not load your habits. Reload to retry. '+(error.message||'Please check your connection.'));
  }
}
// Serialize UI writes and publish only confirmed server results. A reset invalidates
// pending responses so data/errors from an old account cannot enter the new UI.
async function storageWrite(action){
  if(storageBusy) return false;
  if(!storeReady||!storageUserId){noteStore('Your habits are not loaded yet. Reload if loading failed.');return false;}
  var generation=storageGeneration,owner=storageUserId;
  storageLock(true); noteStore('Saving…');
  try{
    var commit=await action(window.getSupabaseClient(),owner);
    if(generation!==storageGeneration) return false;
    commit(); noteStore(''); render();
    return true;
  }catch(error){
    if(generation===storageGeneration){
      // Re-render numeric inputs from confirmed data after a failed write.
      render();
      noteStore('Could not save your change. '+(error.message||'Please check your connection.')+' Reload to check the saved data before retrying.');
    }
    return false;
  }finally{
    if(generation===storageGeneration) storageLock(false);
  }
}
function saveHabit(h){
  return storageWrite(async function(client,owner){
    var result=await client.from('habits').insert({user_id:owner,
      name:h.name,emoji:h.emoji,target:h.target,unit:h.unit,days:h.days,
      start_date:h.start,metric:h.metric,ramp:h.ramp,
      created_at:new Date().toISOString()}).select(HABIT_COLUMNS).single();
    if(result.error) throw result.error;
    var saved=habitFromRow(result.data);
    return function(){habits.push(saved);entries[saved.id]={};selected=saved.id;view='progress';};
  });
}
function saveEntry(h,dkey,patch){
  return storageWrite(async function(client){
    if(!h||!byId(h.id)) throw new Error('This habit is no longer available.');
    var next=Object.assign({done:false,rest:false,value:null,metric:null},entryOf(h,dkey)||{},patch);
    var result=await client.from('habit_entries').upsert({habit_id:h.id,entry_date:dkey,
      done:next.done,rest:next.rest,value:next.value,metric:next.metric,
      updated_at:new Date().toISOString()
    },{onConflict:'habit_id,entry_date',defaultToNull:false}).select(ENTRY_COLUMNS).single();
    if(result.error) throw result.error;
    var saved=entryFromRow(result.data);
    return function(){entries[h.id]=entries[h.id]||{};entries[h.id][dkey]=saved;};
  });
}
function removeHabit(h){
  return storageWrite(async function(client,owner){
    if(!h||!byId(h.id)) throw new Error('This habit is no longer available.');
    var result=await client.from('habits').delete().eq('id',h.id)
      .eq('user_id',owner).select('id').single();
    if(result.error) throw result.error;
    return function(){
      habits=habits.filter(function(x){return x.id!==h.id;});delete entries[h.id];
      if(selected===h.id) selected=habits.length?habits[0].id:null;
    };
  });
}
