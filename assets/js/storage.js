// Persistence boundary. Currently uses the original host-provided storage API.
// See database/README.md before connecting a production database.
/* ---------------- storage ---------------- */
function noteStore(msg,warn){
  el('storeNote').innerHTML = msg? '<div class="banner">'+esc(msg)+'</div>' : '';
}
async function boot(){
  try{ DB = await window.claude.use('db'); }catch(e){ DB=null; }
  try{ ASSETS = await window.claude.use('assets'); }catch(e){ ASSETS=null; }
  if(!DB){ noteStore('Saving is unavailable in this view — your entries will only last until you close the page.'); render(); return; }
  storeReady=true; noteStore('');
  DB.collection('habits').onSnapshot(function(snap){
    habits = snap.docs.map(function(d){var o=d.data()||{};o.id=d.id;return o;})
                      .sort(function(a,b){return (a.createdAt||0)-(b.createdAt||0);});
    habits.forEach(watchEntries);
    if(!selected || !habits.some(function(h){return h.id===selected;})) selected = habits.length?habits[0].id:null;
    render();
  }, function(){ noteStore('Live sync hiccuped — reload the page if things look stale.'); });
}
function watchEntries(h){
  if(unsubs[h.id]) return;
  unsubs[h.id]=DB.collection('habits/'+h.id+'/entries').onSnapshot(function(snap){
    var m={}; snap.docs.forEach(function(d){m[d.id]=d.data()||{};});
    entries[h.id]=m; render();
  }, function(){});
}
async function saveHabit(h){
  if(!DB){ habits.push(h); entries[h.id]={}; selected=h.id; render(); return; }
  await DB.doc('habits/'+h.id).set(h);
}
async function saveEntry(h,dkey,patch){
  var prev=entryOf(h,dkey)||{};
  var next=Object.assign({},prev,patch,{ts:Date.now()});
  entries[h.id]=entries[h.id]||{}; entries[h.id][dkey]=next; render();
  if(DB){ try{ await DB.doc('habits/'+h.id+'/entries/'+dkey).set(next); }catch(e){} }
}
async function removeHabit(h){
  habits=habits.filter(function(x){return x.id!==h.id;});
  var E=entries[h.id]||{}; delete entries[h.id];
  if(unsubs[h.id]){unsubs[h.id]();delete unsubs[h.id];}
  if(selected===h.id) selected=habits.length?habits[0].id:null;
  render();
  if(!DB) return;
  try{
    var ks=Object.keys(E);
    for(var i=0;i<ks.length;i++){
      var e=E[ks[i]];
      if(e&&e.photo&&ASSETS){ try{ await ASSETS.delete(e.photo); }catch(_){}}
      try{ await DB.doc('habits/'+h.id+'/entries/'+ks[i]).delete(); }catch(_){}
    }
    await DB.doc('habits/'+h.id).delete();
  }catch(e){}
}

