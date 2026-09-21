(function(){
  'use strict';
  var client, userId=null, signup=false, busy=false, authRevision=0;
  var form=document.getElementById('authForm');
  var fields=document.getElementById('authFields');
  var password=document.getElementById('authPassword');
  var logout=document.getElementById('logoutBtn');

  function message(id,text){
    var node=document.getElementById(id);
    node.textContent=text;
    node.hidden=!text;
  }

  function applySession(session){
    var nextId=session && session.user ? session.user.id : null;
    if(nextId!==userId){
      resetTrackerSession();
      form.reset();
      message('authMessage','');
      message('accountMessage','');
    }
    userId=nextId;
    document.getElementById('appScreen').hidden=!userId;
    document.getElementById('authScreen').hidden=!!userId;
    if(!userId) closeModal();
  }

  document.getElementById('authSwitch').addEventListener('click',function(){
    if(busy) return;
    signup=!signup;
    document.getElementById('authTitle').textContent=signup?'Create your account':'Welcome back';
    document.getElementById('authDescription').textContent=signup?'Sign up with your email and a password.':'Log in to your account.';
    document.getElementById('authSubmit').textContent=signup?'Sign up':'Log in';
    this.textContent=signup?'Already have an account? Log in':'Create an account';
    password.autocomplete=signup?'new-password':'current-password';
    password.value='';
    message('authMessage','');
  });

  form.addEventListener('submit',async function(event){
    event.preventDefault();
    if(busy || !client) return;
    busy=true; fields.disabled=true;
    var isSignup=signup;
    message('authMessage',isSignup?'Creating your account…':'Logging in…');
    try{
      var credentials={email:document.getElementById('authEmail').value.trim(),password:password.value};
      var result;
      if(isSignup){
        credentials.options={emailRedirectTo:window.location.origin+window.location.pathname};
        result=await client.auth.signUp(credentials);
      }else{
        result=await client.auth.signInWithPassword(credentials);
      }
      if(result.error) throw result.error;
      password.value='';
      // Session events control access; confirmation-required signups have no session.
      if(isSignup && !result.data.session){
        message('authMessage','Check your email for a confirmation link, then return here to log in.');
      }else{
        message('authMessage','');
      }
    }catch(error){
      message('authMessage',error.message||'Sign-in failed. Please try again.');
    }finally{
      busy=false; fields.disabled=false;
    }
  });

  logout.addEventListener('click',async function(){
    if(logout.disabled || !client) return;
    logout.disabled=true;
    message('accountMessage','Logging out…');
    try{
      var result=await client.auth.signOut({scope:'local'});
      if(result.error) throw result.error;
      // Also close the UI if the SDK had no session left to emit an event for.
      applySession(null);
      message('authMessage','You have logged out.');
      message('accountMessage','');
    }catch(error){
      message('accountMessage',error.message||'Logout failed. Please try again.');
    }finally{
      logout.disabled=false;
    }
  });

  async function initialize(){
    try{
      client=window.getSupabaseClient();
      // Keep this callback synchronous: do not call auth methods inside it.
      client.auth.onAuthStateChange(function(event,session){
        authRevision++;
        applySession(session);
      });
      var revision=authRevision;
      var result=await client.auth.getSession();
      // Never overwrite a newer sign-in/sign-out event with an older session read.
      if(revision===authRevision){
        if(result.error) throw result.error;
        applySession(result.data.session);
      }
      message('authMessage',result.error ? result.error.message : '');
      fields.disabled=false;
    }catch(error){
      message('authMessage',error.message||'Unable to restore your session. Reload to try again.');
      fields.disabled=!client;
    }
  }
  initialize();
})();
