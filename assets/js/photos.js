// Private proof-photo operations. Only object paths are written to habit_entries.
var PROOF_BUCKET='proof-photos', photoUrls={};
function resetPhotoSession(){photoUrls={};}
function ensurePhotoSession(generation,owner){
  if(generation!==storageGeneration||owner!==storageUserId) throw new Error('Your account changed. Please retry after signing in.');
}
function checkPhotoPath(path,owner){
  if(typeof path!=='string'||path.split('/')[0]!==owner||path.split('/').some(function(p){return !p||p==='.'||p==='..';})){
    throw new Error('This photo path does not belong to the signed-in account.');
  }
}
function photoBucket(client){return client.storage.from(PROOF_BUCKET);}
async function deletePhotoObjects(client,owner,paths){
  paths.forEach(function(path){checkPhotoPath(path,owner);});
  if(!paths.length) return;
  var result=await photoBucket(client).remove(paths);
  if(result.error) throw result.error;
  paths.forEach(function(path){delete photoUrls[path];});
}
function uploadProofPhoto(h,k,file){
  return storageWrite(async function(client,owner,generation){
    if(!h||!byId(h.id)) throw new Error('This habit is no longer available.');
    var extensions={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'};
    var extension=extensions[file.type];
    if(!extension) throw new Error('Choose a JPEG, PNG, or WebP image.');
    if(!file.size||file.size>5*1024*1024) throw new Error('Choose a non-empty image of 5 MB or less.');
    var previous=await currentPhotoPath(client,h.id,k);
    ensurePhotoSession(generation,owner);
    if(previous) checkPhotoPath(previous,owner);
    var path=owner+'/'+h.id+'/'+crypto.randomUUID()+'.'+extension;
    var uploaded=await photoBucket(client).upload(path,file,{contentType:file.type,upsert:false});
    if(uploaded.error) throw uploaded.error;
    var saved;
    try{
      ensurePhotoSession(generation,owner);
      saved=await writeEntryRow(client,h,k,{photo:path});
    }catch(error){
      try{await deletePhotoObjects(client,owner,[path]);}
      catch(cleanup){throw new Error(error.message+' The uploaded file also could not be cleaned up: '+cleanup.message);}
      throw error;
    }
    ensurePhotoSession(generation,owner);
    var warning='';
    if(previous){
      try{await deletePhotoObjects(client,owner,[previous]);}
      catch(error){warning='Your new photo was saved, but the previous file could not be deleted: '+error.message;}
    }
    return function(){entries[h.id][k]=saved;return warning;};
  });
}
async function currentPhotoPath(client,id,k){
  var result=await client.from('habit_entries').select('photo_path')
    .eq('habit_id',id).eq('entry_date',k).maybeSingle();
  if(result.error) throw result.error;
  return result.data&&result.data.photo_path||null;
}
function removeProofPhoto(h,k){
  return storageWrite(async function(client,owner,generation){
    if(!h||!byId(h.id)) throw new Error('This habit is no longer available.');
    var path=await currentPhotoPath(client,h.id,k);
    ensurePhotoSession(generation,owner);
    if(path) await deletePhotoObjects(client,owner,[path]);
    ensurePhotoSession(generation,owner);
    var saved;
    try{saved=await writeEntryRow(client,h,k,{photo:null});}
    catch(error){throw new Error('The photo file was removed, but its entry could not be cleared. Retry removing the photo. '+error.message);}
    return function(){entries[h.id][k]=saved;};
  });
}
async function deleteHabitPhotos(client,owner,id,generation){
  // Read current references, including changes made since this page was loaded.
  var rows=await readPages(function(){
    return client.from('habit_entries').select('id,photo_path').eq('habit_id',id).order('id');
  },generation);
  ensurePhotoSession(generation,owner);
  var paths=rows.filter(function(r){return r.photo_path;}).map(function(r){return r.photo_path;});
  // Include leftover uploads/replacements in this habit's folder. Gather all pages
  // before deleting so offsets do not skip objects as the folder shrinks.
  async function collect(prefix){
    var offset=0;
    while(true){
      ensurePhotoSession(generation,owner);
      var result=await photoBucket(client).list(prefix,{limit:100,offset:offset,sortBy:{column:'name',order:'asc'}});
      if(result.error) throw result.error;
      if(!result.data.length) break;
      for(var item of result.data){
        if(item.id) paths.push(prefix+'/'+item.name);
        else await collect(prefix+'/'+item.name);
      }
      offset+=result.data.length;
    }
  }
  await collect(owner+'/'+id);
  paths=Array.from(new Set(paths));
  for(var i=0;i<paths.length;i+=100){
    ensurePhotoSession(generation,owner);
    await deletePhotoObjects(client,owner,paths.slice(i,i+100));
  }
}
// Signed URLs are cached only in memory, refreshed before their one-hour expiry.
function signedPhoto(path){
  checkPhotoPath(path,storageUserId);
  var cached=photoUrls[path];
  if(cached&&cached.expires>Date.now()) return cached.promise;
  var generation=storageGeneration,owner=storageUserId;
  var record={expires:Date.now()+55*60*1000};
  record.promise=photoBucket(window.getSupabaseClient()).createSignedUrl(path,3600).then(function(result){
    ensurePhotoSession(generation,owner);
    if(result.error) throw result.error;
    if(!result.data||!result.data.signedUrl) throw new Error('No photo download URL was returned.');
    return {url:result.data.signedUrl,expires:record.expires};
  }).catch(function(error){
    if(photoUrls[path]===record) delete photoUrls[path];
    throw error;
  });
  photoUrls[path]=record;
  return record.promise;
}
function proofImage(path,alt){
  return '<span class="proof-image"><img data-proof-path="'+esc(path)+'" alt="'+esc(alt)+'" hidden>'+
    '<span class="tiny" role="status">Loading photo…</span><button class="pillbtn" type="button" hidden onclick="retryProofImage(this)">Retry photo</button></span>';
}
function retryProofImage(button){
  var img=button.parentNode.querySelector('img');
  delete photoUrls[img.dataset.proofPath];
  img.dataset.photoExpires='';
  loadProofImage(img);
}
async function loadProofImage(img){
  if(img.dataset.photoLoading==='true'||Number(img.dataset.photoExpires)>Date.now()) return;
  var generation=storageGeneration,path=img.dataset.proofPath;
  var message=img.parentNode.querySelector('[role="status"]'),button=img.parentNode.querySelector('button');
  img.dataset.photoLoading='true'; button.hidden=true;message.hidden=false;message.textContent='Loading photo…';
  function current(){return generation===storageGeneration&&img.isConnected;}
  function failed(error){
    if(!current()) return;
    img.hidden=true;img.dataset.photoLoading='false';img.dataset.photoExpires=String(Infinity);
    message.hidden=false;message.textContent='Could not load photo. '+error.message;button.hidden=false;
  }
  try{
    var signed=await signedPhoto(path);
    if(!current()) return;
    img.onload=function(){if(current()){message.hidden=true;img.hidden=false;img.dataset.photoLoading='false';}};
    img.onerror=function(){delete photoUrls[path];failed(new Error('Check your connection or retry the photo.'));};
    img.dataset.photoExpires=String(signed.expires);img.src=signed.url;
  }catch(error){failed(error);}
}
function hydrateProofPhotos(){
  document.querySelectorAll('img[data-proof-path]').forEach(loadProofImage);
}
setInterval(hydrateProofPhotos,60*1000);
