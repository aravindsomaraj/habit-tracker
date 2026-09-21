// Opt-in accountability features. Social records never include values, notes, or proof photos.
var socialGeneration=0, socialReady=false, socialLoading=false, socialError='', socialProfile=null;
var socialFriends=[], socialRequests=[], socialFeed=[], socialShares=[];
var chatConversationId=null, chatFriendName='', chatChannel=null;

function resetSocialSession(){
  stopChatSubscription(); chatConversationId=null; chatFriendName='';
  socialGeneration++; socialReady=false; socialLoading=false; socialError=''; socialProfile=null;
  socialFriends=[]; socialRequests=[]; socialFeed=[]; socialShares=[];
  var generation=socialGeneration;
  setTimeout(function(){loadSocial(generation);},0);
}
function socialMessage(text){
  var node=el('socialMessage');
  if(node){node.textContent=text||'';node.hidden=!text;}
}
function socialView(){
  if(socialLoading) return '<div class="card"><p class="sub">Loading your accountability circle…</p></div>';
  if(socialError) return '<div class="card"><h2>Friends are not set up yet</h2><p class="sub">'+esc(socialError)+'</p></div>';
  if(!socialProfile) return profileSetupView();
  var received=socialRequests.filter(function(row){return row.addressee_id===socialProfile.id;});
  var sent=socialRequests.filter(function(row){return row.requester_id===socialProfile.id;});
  return '<p class="banner" id="socialMessage" hidden role="status"></p>'+friendInviteView()+
    '<div class="grid two">'+friendRequestsView(received,sent)+sharingView()+'</div>'+feedView();
}
function profileSetupView(){
  return '<div class="card"><h2>Set up Friends</h2><p class="sub">Choose a handle friends can use to find you. Your email, notes, values, and proof photos remain private.</p>'+ 
    '<label class="f"><span>Display name</span><input id="socialDisplayName" maxlength="40" autocomplete="nickname" placeholder="How friends see you"></label>'+ 
    '<label class="f"><span>Handle</span><input id="socialHandle" maxlength="24" autocomplete="username" placeholder="e.g. madhav"></label>'+ 
    '<button class="cta" onclick="saveSocialProfile()">Save profile</button></div>';
}
function friendInviteView(){
  return '<div class="card"><h2>Your accountability circle</h2><p class="sub">Invite someone by their exact handle. They must accept before they can see shared completions.</p>'+ 
    '<div class="social-invite"><input id="friendHandle" maxlength="24" placeholder="Friend handle" autocomplete="off"><button class="cta" onclick="sendFriendRequest()">Send request</button></div></div>';
}
function friendRequestsView(received,sent){
  var html='<div class="card"><h2>Friends</h2>';
  if(!socialFriends.length) html+='<p class="sub">No accepted friends yet.</p>';
  else html+='<div class="social-list">'+socialFriends.map(function(friend){return '<div><b>'+esc(friend.display_name)+'</b><span>@'+esc(friend.handle)+'</span><span class="social-actions"><button class="pillbtn" onclick="openChat(\''+friend.id+'\')">Message</button><button class="pillbtn" onclick="removeFriendship(\''+friend.friendship_id+'\')">Remove</button><button class="pillbtn danger-outline" onclick="blockFriendship(\''+friend.friendship_id+'\')">Block</button></span></div>';}).join('')+'</div>';
  if(received.length){html+='<h3 class="social-heading">Requests for you</h3><div class="social-list">'+received.map(function(row){return '<div><b>'+esc(row.person.display_name)+'</b><span>@'+esc(row.person.handle)+'</span><span class="social-actions"><button class="pillbtn" onclick="acceptFriendRequest(\''+row.id+'\')">Accept</button><button class="pillbtn danger-outline" onclick="blockFriendship(\''+row.id+'\')">Block</button></span></div>';}).join('')+'</div>';}
  if(sent.length){html+='<h3 class="social-heading">Sent</h3><div class="social-list">'+sent.map(function(row){return '<div><b>'+esc(row.person.display_name)+'</b><span>@'+esc(row.person.handle)+'</span><button class="pillbtn" onclick="removeFriendship(\''+row.id+'\')">Cancel</button></div>';}).join('')+'</div>';}
  return html+'</div>';
}
function sharingView(){
  var count=socialShares.length;
  return '<div class="card"><h2>Sharing</h2><p class="sub">Share only completion events. Values, notes, missed days, and proof photos are never included.</p>'+ 
    '<p class="social-summary">'+count+' active habit-friend share'+(count===1?'':'s')+'</p>'+ 
    (habits.length?'<button class="pillbtn" onclick="openSharing()">Manage sharing</button>':'<p class="tiny">Create a habit first to share progress.</p>')+'</div>';
}
function feedView(){
  var html='<div class="card"><h2>Friend activity</h2>';
  if(!socialFeed.length) html+='<p class="sub">Shared completions from friends will appear here.</p>';
  else html+='<div class="social-feed">'+socialFeed.map(function(item){return '<div><span class="social-avatar">✓</span><p><b>'+esc(item.person.display_name)+'</b> completed <b>'+esc(item.habit_label)+'</b><small>'+esc(item.occurred_on)+'</small></p></div>';}).join('')+'</div>';
  return html+'</div>';
}
async function loadSocial(generation){
  if(generation!==socialGeneration||socialLoading) return;
  socialLoading=true; socialError='';
  try{
    var client=window.getSupabaseClient(), sessionResult=await client.auth.getSession();
    if(generation!==socialGeneration) return;
    var user=sessionResult.data&&sessionResult.data.session&&sessionResult.data.session.user;
    if(!user) return;
    var profileResult=await client.from('profiles').select('id,handle,display_name').eq('id',user.id).maybeSingle();
    if(profileResult.error) throw profileResult.error;
    socialProfile=profileResult.data||null;
    if(!socialProfile) return;
    var friendshipResult=await client.from('friendships').select('id,requester_id,addressee_id,status,created_at').or('requester_id.eq.'+user.id+',addressee_id.eq.'+user.id).order('created_at',{ascending:false});
    if(friendshipResult.error) throw friendshipResult.error;
    var rows=friendshipResult.data||[], ids=rows.map(function(row){return row.requester_id===user.id?row.addressee_id:row.requester_id;});
    var peopleResult=ids.length?await client.from('profiles').select('id,handle,display_name').in('id',ids):{data:[],error:null};
    if(peopleResult.error) throw peopleResult.error;
    var people={};(peopleResult.data||[]).forEach(function(person){people[person.id]=person;});
    socialFriends=rows.filter(function(row){return row.status==='accepted';}).map(function(row){var person=people[row.requester_id===user.id?row.addressee_id:row.requester_id];if(person) person=Object.assign({},person,{friendship_id:row.id});return person;}).filter(Boolean);
    socialRequests=rows.filter(function(row){return row.status==='pending';}).map(function(row){row.person=people[row.requester_id===user.id?row.addressee_id:row.requester_id];return row;}).filter(function(row){return row.person;});
    var sharesResult=await client.from('habit_shares').select('habit_id,viewer_id').eq('owner_id',user.id);
    if(sharesResult.error) throw sharesResult.error;
    socialShares=sharesResult.data||[];
    var feedResult=await client.from('social_activities').select('id,actor_id,habit_label,occurred_on,created_at').neq('actor_id',user.id).order('created_at',{ascending:false}).limit(50);
    if(feedResult.error) throw feedResult.error;
    var feed=feedResult.data||[], actorIds=Array.from(new Set(feed.map(function(row){return row.actor_id;})));
    var actorsResult=actorIds.length?await client.from('profiles').select('id,handle,display_name').in('id',actorIds):{data:[],error:null};
    if(actorsResult.error) throw actorsResult.error;
    var actors={};(actorsResult.data||[]).forEach(function(person){actors[person.id]=person;});
    socialFeed=feed.map(function(row){row.person=actors[row.actor_id];return row;}).filter(function(row){return row.person;});
    socialReady=true;
  }catch(error){
    if(generation===socialGeneration) socialError='Social features require the social database migration. '+(error.message||'Please try again.');
  }finally{
    if(generation===socialGeneration){socialLoading=false;if(view==='social') render();}
  }
}
async function saveSocialProfile(){
  var name=(el('socialDisplayName').value||'').trim(), handle=(el('socialHandle').value||'').trim().toLowerCase().replace(/^@/,'');
  if(!name||name.length>40||!/^[a-z0-9_]{3,24}$/.test(handle)){alert('Use a display name and a 3–24 character handle containing lowercase letters, numbers, or _.');return;}
  try{
    var client=window.getSupabaseClient(), session=await client.auth.getSession(), user=session.data.session&&session.data.session.user;
    if(!user) throw new Error('Sign in again and retry.');
    var result=await client.from('profiles').upsert({id:user.id,display_name:name,handle:handle,discoverable:true},{onConflict:'id'});
    if(result.error) throw result.error;
    socialMessage('Profile saved.'); await loadSocialAfterWrite();
  }catch(error){alert(error.message||'Could not save your profile.');}
}
async function sendFriendRequest(){
  var handle=(el('friendHandle').value||'').trim().toLowerCase().replace(/^@/,'');
  if(!handle) return;
  try{
    var client=window.getSupabaseClient(), found=await client.from('profiles').select('id,handle').eq('handle',handle).maybeSingle();
    if(found.error) throw found.error;
    if(!found.data) throw new Error('No discoverable profile has that handle.');
    if(found.data.id===socialProfile.id) throw new Error('You cannot add yourself.');
    var result=await client.from('friendships').insert({requester_id:socialProfile.id,addressee_id:found.data.id,status:'pending'});
    if(result.error) throw result.error;
    await loadSocialAfterWrite('Friend request sent.');
  }catch(error){socialMessage(error.message||'Could not send the friend request.');}
}
async function acceptFriendRequest(id){
  try{
    var result=await window.getSupabaseClient().rpc('accept_friendship',{request_id:id});
    if(result.error) throw result.error;
    await loadSocialAfterWrite('Friend request accepted.');
  }catch(error){socialMessage(error.message||'Could not accept the friend request.');}
}
async function removeFriendship(id){
  if(!confirm('Remove this connection? All sharing between you will also be removed.')) return;
  try{
    var result=await window.getSupabaseClient().rpc('remove_friendship',{friendship_id:id});
    if(result.error) throw result.error;
    await loadSocialAfterWrite('Friend removed and sharing cleared.');
  }catch(error){socialMessage(error.message||'Could not remove this friend.');}
}
async function blockFriendship(id){
  if(!confirm('Block this person? They cannot send another request, and all sharing between you will be removed.')) return;
  try{
    var result=await window.getSupabaseClient().rpc('block_friendship',{friendship_id:id});
    if(result.error) throw result.error;
    await loadSocialAfterWrite('Person blocked and sharing cleared.');
  }catch(error){socialMessage(error.message||'Could not block this person.');}
}
async function openChat(friendId){
  try{
    var friend=socialFriends.filter(function(row){return row.id===friendId;})[0];
    if(!friend) throw new Error('This friend is no longer available.');
    var friendName=friend.display_name;
    var client=window.getSupabaseClient(), result=await client.rpc('start_direct_conversation',{friend_id:friendId});
    if(result.error) throw result.error;
    chatConversationId=result.data; chatFriendName=friendName;
    modal('<div class="chat-head"><div><h3>Chat with '+esc(friendName)+'</h3><p class="sub">Only you and '+esc(friendName)+' can read these messages.</p></div><button class="pillbtn" onclick="closeModal()">Close</button></div><div id="chatMessages" class="chat-messages" role="log" aria-live="polite"><p class="tiny">Loading messages…</p></div><form class="chat-compose" onsubmit="sendChatMessage();return false;"><input id="chatInput" maxlength="2000" autocomplete="off" placeholder="Write a message" required><button class="cta" type="submit">Send</button></form>');
    await loadChatMessages(); startChatSubscription();
  }catch(error){socialMessage(error.message||'Could not open this chat.');}
}
async function loadChatMessages(){
  if(!chatConversationId) return;
  var box=el('chatMessages');
  try{
    var result=await window.getSupabaseClient().from('chat_messages').select('id,sender_id,body,created_at').eq('conversation_id',chatConversationId).order('created_at',{ascending:true}).limit(100);
    if(result.error) throw result.error;
    if(!box||!chatConversationId) return;
    box.innerHTML=(result.data||[]).map(chatMessageHtml).join('')||'<p class="tiny">No messages yet. Say hello.</p>';
    box.scrollTop=box.scrollHeight;
  }catch(error){if(box) box.innerHTML='<p class="tiny">Could not load messages. '+esc(error.message||'Please retry.')+'</p>';}
}
function chatMessageHtml(message){
  var mine=message.sender_id===socialProfile.id;
  return '<div class="chat-message '+(mine?'mine':'')+'" data-chat-id="'+esc(message.id)+'"><span>'+esc(message.body)+'</span><small>'+esc(mine?'You':chatFriendName)+' · '+esc(new Date(message.created_at).toLocaleTimeString('en-IN',{hour:'numeric',minute:'2-digit'}))+'</small></div>';
}
function appendChatMessage(message){
  var box=el('chatMessages');
  if(!box||message.conversation_id!==chatConversationId||box.querySelector('[data-chat-id="'+message.id+'"]')) return;
  if(box.querySelector('.tiny')) box.innerHTML='';
  box.insertAdjacentHTML('beforeend',chatMessageHtml(message)); box.scrollTop=box.scrollHeight;
}
async function sendChatMessage(){
  var input=el('chatInput'), body=(input.value||'').trim();
  if(!body||!chatConversationId) return;
  input.disabled=true;
  try{
    var result=await window.getSupabaseClient().from('chat_messages').insert({conversation_id:chatConversationId,sender_id:socialProfile.id,body:body}).select('id,conversation_id,sender_id,body,created_at').single();
    if(result.error) throw result.error;
    input.value=''; appendChatMessage(result.data);
  }catch(error){alert(error.message||'Could not send your message.');}
  finally{input.disabled=false;input.focus();}
}
function startChatSubscription(){
  stopChatSubscription();
  if(!chatConversationId) return;
  var conversationId=chatConversationId, client=window.getSupabaseClient();
  chatChannel=client.channel('chat:'+conversationId).on('postgres_changes',{event:'INSERT',schema:'public',table:'chat_messages',filter:'conversation_id=eq.'+conversationId},function(payload){
    if(chatConversationId===conversationId) appendChatMessage(payload.new);
  }).subscribe();
}
function stopChatSubscription(){
  if(chatChannel){window.getSupabaseClient().removeChannel(chatChannel);chatChannel=null;}
}
function closeChat(){stopChatSubscription();chatConversationId=null;chatFriendName='';}
function openSharing(){
  var friendIds={};socialFriends.forEach(function(friend){friendIds[friend.id]=friend;});
  var html='<h3>Share completion updates</h3><p class="sub">Choose which friends can see a habit being marked complete. Nothing else is shared.</p>';
  habits.forEach(function(habit){
    html+='<div class="share-habit"><b>'+esc(habit.emoji)+' '+esc(habit.name)+'</b>';
    if(!socialFriends.length) html+='<span class="tiny">Add and accept a friend first.</span>';
    socialFriends.forEach(function(friend){var active=socialShares.some(function(share){return share.habit_id===habit.id&&share.viewer_id===friend.id;});html+='<label><input type="checkbox" '+(active?'checked':'')+' onchange="setHabitShare(\''+habit.id+'\',\''+friend.id+'\',this.checked)"> '+esc(friend.display_name)+'</label>';});
    html+='</div>';
  });
  modal(html+'<div class="modal-actions"><button class="cta ghost" onclick="closeModal()">Done</button></div>');
}
async function setHabitShare(habitId,viewerId,active){
  try{
    var client=window.getSupabaseClient(), result;
    if(active) result=await client.from('habit_shares').insert({habit_id:habitId,owner_id:socialProfile.id,viewer_id:viewerId});
    else result=await client.from('habit_shares').delete().eq('habit_id',habitId).eq('owner_id',socialProfile.id).eq('viewer_id',viewerId);
    if(result.error) throw result.error;
    await loadSocialAfterWrite();
  }catch(error){socialMessage(error.message||'Could not update sharing.');}
}
async function recordSocialCompletion(habit,date){
  if(!socialReady||!socialProfile||!socialShares.some(function(share){return share.habit_id===habit.id;})) return;
  try{
    var result=await window.getSupabaseClient().from('social_activities').upsert({actor_id:socialProfile.id,habit_id:habit.id,habit_label:habit.name,kind:'completed',occurred_on:date},{onConflict:'actor_id,habit_id,kind,occurred_on',ignoreDuplicates:true});
    if(result.error) throw result.error;
  }catch(_){/* Completion is already saved; social publishing is best-effort. */}
}
async function removeSocialCompletion(habit,date){
  if(!socialReady||!socialProfile) return;
  try{
    var result=await window.getSupabaseClient().from('social_activities').delete()
      .eq('actor_id',socialProfile.id).eq('habit_id',habit.id).eq('kind','completed').eq('occurred_on',date);
    if(result.error) throw result.error;
  }catch(_){/* The habit entry is the source of truth; a later share can publish a new completion. */}
}
async function loadSocialAfterWrite(message){
  var generation=socialGeneration; socialLoading=false; await loadSocial(generation); if(message) socialMessage(message);
}
