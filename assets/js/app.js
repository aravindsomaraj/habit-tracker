/* ---------------- state ---------------- */
var storeReady=false;
var habits=[];              // {id, ...data}
var entries={};             // habitId -> { 'YYYY-MM-DD': {done,value,photo,note} }
var view='today', selected=null, calCursor=new Date(), flipAxes=false;

var TEMPLATES=[
  {k:'steps',  label:'🚶 Walking',  emoji:'🚶', unit:'steps',  target:10000, days:90,  metric:'weight (kg)'},
  {k:'gym',    label:'🏋️ Gym',      emoji:'🏋️', unit:'minutes',target:45,    days:90,  metric:'weight (kg)'},
  {k:'read',   label:'📚 Reading',  emoji:'📚', unit:'pages',  target:20,    days:60,  metric:'pages read'},
  {k:'diet',   label:'🥗 Diet',     emoji:'🥗', unit:'kcal',   target:1800,  days:60,  metric:'weight (kg)'},
  {k:'reels',  label:'🎬 Content',  emoji:'🎬', unit:'videos', target:1,     days:30,  metric:'views'},
  {k:'water',  label:'💧 Water',    emoji:'💧', unit:'litres', target:3,     days:30,  metric:'litres'},
  {k:'custom', label:'✨ Custom',   emoji:'🎯', unit:'units',  target:1,     days:30,  metric:'value'}
];

/* ---------------- utils ---------------- */
function key(d){var m=('0'+(d.getMonth()+1)).slice(-2),day=('0'+d.getDate()).slice(-2);return d.getFullYear()+'-'+m+'-'+day;}
function parseKey(s){var p=s.split('-');return new Date(+p[0],+p[1]-1,+p[2]);}
function today(){var d=new Date();d.setHours(0,0,0,0);return d;}
function addDays(d,n){var x=new Date(d.getTime());x.setDate(x.getDate()+n);x.setHours(0,0,0,0);return x;}
function dayDiff(a,b){return Math.round((b-a)/86400000);}
function fmt(n){if(n===null||n===undefined||isNaN(n))return '0';return (Math.round(n*100)/100).toLocaleString('en-IN');}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function pct(a,b){if(!b)return 0;return Math.max(0,Math.min(100,Math.round(a/b*100)));}
function el(id){return document.getElementById(id);}

/* plan: split the goal into ramped phases */
function phases(h){
  var n=Math.max(3,Math.min(6,Math.round(h.days/14)))||3;
  var out=[], per=Math.ceil(h.days/n), start=h.ramp?0.5:1;
  for(var i=0;i<n;i++){
    var frac= n===1?1:(start+(1-start)*(i/(n-1)));
    var t=Math.max(1,Math.round(h.target*frac*100)/100);
    var s=i*per, e=Math.min(h.days,(i+1)*per)-1;
    if(s>e) break;
    out.push({i:i,from:s,to:e,target:t,
      label:'Phase '+(i+1)+' · '+fmt(t)+' '+h.unit+'/day',
      dates:dayLabel(addDays(parseKey(h.start),s))+' → '+dayLabel(addDays(parseKey(h.start),e))});
  }
  return out;
}
function dayLabel(d){return d.toLocaleDateString('en-IN',{day:'numeric',month:'short'});}
function targetFor(h,dayIdx){
  var ph=phases(h);
  for(var i=0;i<ph.length;i++) if(dayIdx>=ph[i].from && dayIdx<=ph[i].to) return ph[i].target;
  return h.target;
}
function idxOf(h,dkey){return dayDiff(parseKey(h.start),parseKey(dkey));}
function entryOf(h,dkey){return (entries[h.id]||{})[dkey]||null;}

function stats(h){
  var E=entries[h.id]||{}, t=today(), start=parseKey(h.start);
  var elapsed=Math.max(0,Math.min(h.days,dayDiff(start,t)+1));
  var done=0, sum=0, missed=0, rest=0, xp=0, hitTarget=0;
  for(var i=0;i<h.days;i++){
    var k=key(addDays(start,i)), e=E[k];
    if(e&&e.rest){rest++;continue;}
    if(e&&e.done){done++;xp+=10;
      if(typeof e.value==='number'&&e.value>=targetFor(h,i)){xp+=5;hitTarget++;}}
    if(e&&typeof e.value==='number')sum+=e.value;
    if(i<dayDiff(start,t) && (!e||!e.done))missed++;
  }
  // current streak — a rest day pauses it instead of killing it
  var cur=0,d=new Date(t),guard=0;
  while(guard++<800){
    var e=E[key(d)];
    if(e&&e.done){cur++;d=addDays(d,-1);continue;}
    if(e&&e.rest){d=addDays(d,-1);continue;}
    if(key(d)===key(t)){d=addDays(d,-1);continue;}
    break;
  }
  var best=0,run=0;
  for(var i=0;i<h.days;i++){var e2=E[key(addDays(start,i))];
    if(e2&&e2.rest)continue;
    if(e2&&e2.done){run++;best=Math.max(best,run);}else run=0;}
  var goalTotal=0; for(var i=0;i<h.days;i++) goalTotal+=targetFor(h,i);
  return {elapsed:elapsed,done:done,missed:missed,rest:rest,sum:sum,streak:cur,best:best,
          goalTotal:goalTotal,xp:xp,hitTarget:hitTarget,
          remaining:Math.max(0,h.days-done-missed), consistency:pct(done,Math.max(1,dayDiff(start,t)+1-rest))};
}
function totalXP(){var x=0;habits.forEach(function(h){x+=stats(h).xp;});return x;}
function levelOf(x){var l=1,need=100,left=x;while(left>=need){left-=need;l++;need=Math.round(need*1.25);}return {lvl:l,into:left,need:need};}

function habitsActiveOn(dkey){
  return habits.filter(function(h){var i=idxOf(h,dkey);return i>=0&&i<h.days;});
}
function pointsForDay(dkey){
  var active=habitsActiveOn(dkey), earned=0, possible=0;
  active.forEach(function(h){
    possible+=15; // 10 base + 5 bonus, per active habit
    var e=entryOf(h,dkey);
    if(e&&e.rest){possible-=15;return;}
    if(e&&e.done){earned+=10;
      var tgt=targetFor(h,idxOf(h,dkey));
      if(typeof e.value==='number'&&e.value>=tgt) earned+=5;
    }
  });
  return {earned:earned,possible:possible};
}
function pointsHistory(days){
  var out=[],t=today();
  for(var i=days-1;i>=0;i--){var k=key(addDays(t,-i));out.push({d:addDays(t,-i),k:k,p:pointsForDay(k).earned});}
  return out;
}

var BADGES=[
  {k:'first', icon:'🌱', t:'First day',   test:function(s,h){return s.done>=1;}},
  {k:'w1',    icon:'🔥', t:'7-day streak',test:function(s){return s.best>=7;}},
  {k:'w2',    icon:'⚡', t:'14 in a row', test:function(s){return s.best>=14;}},
  {k:'half',  icon:'🏅', t:'Halfway',     test:function(s,h){return s.done>=h.days/2;}},
  {k:'m1',    icon:'💎', t:'30-day streak',test:function(s){return s.best>=30;}},
  {k:'sharp', icon:'🎯', t:'25 targets hit',test:function(s){return s.hitTarget>=25;}},
  {k:'done',  icon:'👑', t:'Goal complete',test:function(s,h){return s.done>=h.days;}}
];

/* ---------------- views ---------------- */
function render(){
  var v=el('view');
  Array.prototype.forEach.call(document.querySelectorAll('#tabs button'),function(b){
    b.classList.toggle('on', b.dataset.v===view);
  });
  if(!habits.length){ v.innerHTML=emptyState(); return; }
  if(view==='today') v.innerHTML=todayView();
  else if(view==='progress') v.innerHTML=picker()+progressView();
  else if(view==='calendar') v.innerHTML=picker()+calendarView();
  else if(view==='graph') v.innerHTML=picker()+graphView();
  else if(view==='proof') v.innerHTML=picker()+proofView();
  else v.innerHTML=manageView();
  hydrateProofPhotos();
}
function emptyState(){
  return '<div class="card"><div class="empty"><div class="big">🎯</div>'+
    '<h2>No habits yet</h2><p class="sub">Tell me the habit and the goal — I\'ll break it into daily steps you can tick off.</p>'+
    '<button class="cta" onclick="openNew()">Create my first habit</button></div></div>';
}
function cur(){ return habits.filter(function(h){return h.id===selected;})[0]||habits[0]; }
function picker(){
  if(habits.length<2) return '';
  return '<div class="sel">'+habits.map(function(h){
    return '<button class="'+(h.id===selected?'on':'')+'" onclick="pick(\''+h.id+'\')">'+h.emoji+' '+esc(h.name)+'</button>';
  }).join('')+'</div>';
}
function pick(id){selected=id;render();}

/* -- today -- */
function todayView(){
  var tk=key(today());
  var rows=habits.map(function(h){
    var idx=idxOf(h,tk);
    if(idx<0) return card(h,'Starts '+dayLabel(parseKey(h.start)),null,idx);
    if(idx>=h.days) return card(h,'Goal window finished 🎉',null,idx);
    var e=entryOf(h,tk)||{}, tgt=targetFor(h,idx);
    var task='Day '+(idx+1)+' of '+h.days+' · '+fmt(tgt)+' '+h.unit+(e.rest?' · 😌 rest day':'');
    return card(h,task,e,idx,tgt,tk);
  }).join('');
  var doneToday=habits.filter(function(h){var e=entryOf(h,tk);return e&&e.done;}).length;
  var todayP=pointsForDay(tk), total=totalXP(), topStreak=Math.max.apply(null,habits.map(function(h){return stats(h).streak;}));
  var hist=pointsHistory(14), mood=catMood(doneToday,habits.length);
  return '<div class="card"><div class="catwrap">'+
    '<div class="catbox mood-'+mood+'">'+catAvatar(mood)+'</div>'+
    '<div style="flex:1;min-width:180px"><div class="catlabel">'+catLine(mood,doneToday,habits.length)+'</div>'+
    '<strong style="font-size:15px;display:block;margin-top:2px">'+greeting()+'</strong></div></div>'+
    '<div class="xpwrap" style="margin-top:14px">'+
    '<div class="lvl" style="background:var(--brand);box-shadow:0 4px 0 var(--brand-dark)"><b>'+todayP.earned+'</b><span>TODAY</span></div>'+
    '<div style="flex:1;min-width:190px"><div style="display:flex;justify-content:space-between;margin-bottom:6px">'+
    '<strong style="font-size:15px">Today\'s points</strong><span class="tiny">'+todayP.earned+' / '+(todayP.possible||0)+' pts today</span></div>'+
    '<div class="xpbar"><i style="width:'+pct(todayP.earned,todayP.possible||1)+'%;background:linear-gradient(90deg,var(--brand),var(--brand-dark))"></i></div></div>'+
    '<div class="flame">🔥 '+topStreak+' day'+(topStreak===1?'':'s')+'</div></div>'+
    '<p class="sub" style="margin:14px 0 6px">'+today().toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'long'})+
    ' · '+doneToday+' of '+habits.length+' done today</p>'+
    '<div class="bar"><i style="width:'+pct(doneToday,habits.length)+'%"></i></div>'+
    '<div class="nudge">'+nudge(doneToday,habits.length,topStreak)+'</div></div>'+
    '<div class="card"><h2>Today\'s tasks</h2><p class="sub">Clear these to fill today\'s bar — 10 pts for done, +5 more for hitting the full target. Resets tomorrow.</p>'+rows+'</div>'+
    '<div class="card"><h2>🏦 All-time points</h2><p class="sub">Never resets — this is what today\'s points turn into.</p>'+
    '<div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:14px">'+
    '<div class="lvl" style="background:var(--violet);box-shadow:0 4px 0 #6d3fd6"><b>'+total+'</b><span>TOTAL</span></div>'+
    '<div class="tiny" style="flex:1;min-width:160px">Every point you\'ve ever earned, across every habit — this bar only grows.</div></div>'+
    pointsSparkline(hist)+'</div>'+
    badgeShelf();
}
function greeting(){var h=new Date().getHours();return h<12?'Good morning, let\'s go 👋':h<17?'Afternoon check-in ☀️':'Evening wrap-up 🌙';}
function nudge(done,total,streak){
  if(total&&done===total) return '✅ Clean sweep. Come back tomorrow and the streak keeps climbing.';
  if(streak>=7) return '🔥 '+streak+' days deep — one tick today and the chain stays unbroken.';
  if(done>0) return '💪 '+done+' down, '+(total-done)+' to go. Finish the set.';
  if(streak>0) return '⏳ Nothing logged yet today. Your '+streak+'-day streak is waiting on you.';
  return '🌱 Start small. Day one only has to happen once.';
}
function pointsSparkline(hist){
  var max=Math.max(15,Math.max.apply(null,hist.map(function(p){return p.p;})))*1.15;
  var W=560,H=130,P=8,plot=W-P*2;
  var pts=hist.map(function(p,i){return {x:P+i/(hist.length-1)*plot, y:H-24-(p.p/max)*(H-44), p:p};});
  var line=pts.map(function(pt,i){return (i?'L':'M')+pt.x.toFixed(1)+' '+pt.y.toFixed(1);}).join(' ');
  var area=line+' L'+pts[pts.length-1].x.toFixed(1)+' '+(H-24)+' L'+pts[0].x.toFixed(1)+' '+(H-24)+' Z';
  var bars=pts.map(function(pt){
    return '<circle cx="'+pt.x.toFixed(1)+'" cy="'+pt.y.toFixed(1)+'" r="3.2" fill="var(--violet)"><title>'+dayLabel(pt.p.d)+': '+pt.p.p+' pts</title></circle>';
  }).join('');
  var ticks=pts.filter(function(_,i){return i%3===0;}).map(function(pt){
    return '<text x="'+pt.x.toFixed(1)+'" y="'+(H-6)+'" text-anchor="middle" font-size="10" font-weight="800" fill="var(--muted)" font-family="Nunito,sans-serif">'+dayLabel(pt.p.d)+'</text>';
  }).join('');
  return '<div class="scrollx"><svg viewBox="0 0 '+W+' '+H+'" width="100%" height="'+H+'">'+
    '<defs><linearGradient id="pspark" x1="0" y1="0" x2="0" y2="1">'+
    '<stop offset="0%" stop-color="var(--violet)" stop-opacity="0.35"/><stop offset="100%" stop-color="var(--violet)" stop-opacity="0"/></linearGradient></defs>'+
    '<path d="'+area+'" fill="url(#pspark)"/>'+
    '<path d="'+line+'" fill="none" stroke="var(--violet)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>'+
    bars+ticks+'</svg></div><p class="tiny" style="margin-top:4px">Points earned per day — last 14 days</p>';
}
var CAT_IMGS={
  happy:"assets/images/cat-1.png",
  meh:"assets/images/cat-2.png",
  sad:"assets/images/cat-3.png"
};
function catAvatar(mood){
  return '<img src="'+(CAT_IMGS[mood]||CAT_IMGS.meh)+'" alt="Mood: '+mood+'">';
}
function catMood(done,total){
  if(!total) return 'meh';
  var r=done/total;
  if(r>=0.7) return 'happy';
  if(r>0) return 'meh';
  return 'sad';
}
function catLine(mood,done,total){
  if(mood==='happy') return total&&done===total?'All done — purring with pride 😻':'Great pace — keep it up 🐾';
  if(mood==='meh') return 'Making some progress — a few more to go';
  return 'Nothing logged yet — one tick and the mood lifts';
}
function badgeShelf(){
  var h=cur(), s=stats(h);
  return '<div class="card"><h2>🏆 Trophies — '+h.emoji+' '+esc(h.name)+'</h2><p class="sub">Unlocked as you go. Switch habits on the Progress tab.</p>'+
    '<div class="badges">'+BADGES.map(function(b){
      var got=b.test(s,h);
      return '<div class="badge '+(got?'got':'')+'"><div class="b">'+(got?b.icon:'🔒')+'</div><small>'+b.t+'</small></div>';
    }).join('')+'</div></div>';
}
function confetti(){
  var cols=['#58cc02','#8b5cf6','#1cb0f6','#ffc800','#ff4b7d'];
  for(var i=0;i<34;i++){
    var c=document.createElement('div');
    c.className='conf';
    c.style.left=(Math.random()*100)+'vw';
    c.style.background=cols[i%cols.length];
    c.style.animationDuration=(1.4+Math.random()*1.1)+'s';
    c.style.animationDelay=(Math.random()*.25)+'s';
    if(i%3===0) c.style.borderRadius='50%';
    document.body.appendChild(c);
    setTimeout(function(n){return function(){n.remove();};}(c),3000);
  }
}
function toast(msg){
  var t=document.createElement('div');
  t.textContent=msg;
  t.style.cssText='position:fixed;left:50%;bottom:26px;transform:translateX(-50%);background:var(--violet);color:#fff;padding:12px 22px;border-radius:999px;font-weight:900;z-index:120;box-shadow:0 6px 0 #6d3fd6;font-family:Nunito,sans-serif';
  document.body.appendChild(t);
  setTimeout(function(){t.style.transition='opacity .4s';t.style.opacity='0';},1400);
  setTimeout(function(){t.remove();},1900);
}
function card(h,task,e,idx,tgt,tk){
  var done=e&&e.done, val=(e&&e.value!=null)?e.value:'';
  var controls='';
  if(tk){
    controls='<div class="metricbox"><input type="number" inputmode="decimal" value="'+esc(val)+'" placeholder="0" '+
      'onchange="logValue(\''+h.id+'\',\''+tk+'\',this.value)"><span>'+esc(h.unit)+'</span></div>'+
      '<div class="metricbox" title="'+esc(h.metric)+'"><input type="number" inputmode="decimal" value="'+esc((e&&e.metric!=null)?e.metric:'')+'" placeholder="–" '+
      'onchange="logMetric(\''+h.id+'\',\''+tk+'\',this.value)"><span>'+esc(h.metric)+'</span></div>'+
      '<button class="iconbtn" title="Upload proof photo" onclick="pickPhoto(\''+h.id+'\',\''+tk+'\')">'+(e&&e.photo?'🖼️':'📷')+'</button>'+
      '<button class="tick '+(done?'done':'')+'" onclick="toggle(\''+h.id+'\',\''+tk+'\','+(tgt||0)+')">'+(done?'✓':'')+'</button>';
  }
  return '<div class="hrow"><div class="emoji">'+h.emoji+'</div><div class="info"><div class="name">'+esc(h.name)+'</div>'+
    '<div class="task">'+esc(task)+'</div></div>'+controls+'</div>';
}
function logValue(id,k,v){var h=byId(id);saveEntry(h,k,{value:v===''?null:+v});}
function logMetric(id,k,v){var h=byId(id);saveEntry(h,k,{metric:v===''?null:+v});}
function toggle(id,k,tgt){
  var h=byId(id),e=entryOf(h,k)||{};
  var patch={done:!e.done, rest:false};
  if(!e.done && (e.value==null)) patch.value=tgt;
  var wasDone=!!e.done;
  saveEntry(h,k,patch).then(function(saved){
    if(!saved||wasDone) return;
    var s=stats(h), bonus=(patch.value!=null&&patch.value>=tgt);
    confetti();
    if(s.streak&&s.streak%7===0) toast('🔥 '+s.streak+'-day streak!');
    else toast('+'+(bonus?15:10)+' pts'+(bonus?' — target hit!':''));
    var btn=document.querySelector('.tick.done');
    if(btn){btn.classList.add('pop');setTimeout(function(){btn.classList.remove('pop');},500);}
  });
}
async function markRest(id,k){
  var h=byId(id);
  if(await saveEntry(h,k,{done:false,rest:true})){
    closeModal(); toast('😌 Rest day — streak protected');
  }
}
function byId(id){return habits.filter(function(h){return h.id===id;})[0];}

/* -- photo -- */
function pickPhoto(id,k){
  if(!storeReady||storageBusy) return;
  var generation=storageGeneration,h=byId(id);
  var input=document.createElement('input');
  input.type='file';input.accept='image/jpeg,image/png,image/webp';
  input.onchange=async function(){
    if(generation!==storageGeneration) return;
    var file=input.files&&input.files[0];
    if(file&&await uploadProofPhoto(h,k,file)) closeModal();
  };
  input.click();
}

async function removePhoto(id,k){
  if(!confirm('Remove this proof photo?')) return;
  if(await removeProofPhoto(byId(id),k)) closeModal();
}

/* -- progress -- */
function progressView(){
  var h=cur(), s=stats(h), ph=phases(h), tk=key(today());
  var overall=pct(s.done,h.days);
  var ring=donut(overall,s);
  var week=rangeStats(h,6), month=rangeStats(h,29);
  var steps=ph.map(function(p){
    var i=idxOf(h,tk), active=i>=p.from&&i<=p.to, clear=i>p.to;
    var hit=0; for(var d=p.from;d<=p.to;d++){var e=entryOf(h,key(addDays(parseKey(h.start),d)));if(e&&e.done)hit++;}
    return '<div class="step '+(active?'active':'')+' '+(clear?'clear':'')+'"><div class="dot">'+(clear?'✓':(p.i+1))+'</div>'+
      '<div style="flex:1"><div class="t">'+esc(p.label)+'</div><div class="d">'+esc(p.dates)+' · '+hit+'/'+(p.to-p.from+1)+' days done</div>'+
      '<div class="bar" style="margin-top:8px;height:10px"><i style="width:'+pct(hit,p.to-p.from+1)+'%"></i></div></div></div>';
  }).join('');
  return '<div class="card"><h2>'+h.emoji+' '+esc(h.name)+'</h2><p class="sub">Goal: '+fmt(h.target)+' '+esc(h.unit)+' a day for '+h.days+' days · started '+dayLabel(parseKey(h.start))+'</p>'+
    '<div class="grid two"><div style="display:grid;place-items:center">'+ring+'</div>'+
    '<div><div class="statgrid">'+
      stat(s.streak,'day streak')+stat(s.done+'/'+h.days,'days done')+
      stat(s.consistency+'%','consistency')+stat(s.best,'best streak')+
      stat(s.xp,'points earned')+
    '</div>'+
    '<div style="margin-top:14px"><div class="tiny">Total logged: '+fmt(s.sum)+' / '+fmt(s.goalTotal)+' '+esc(h.unit)+'</div>'+
    '<div class="bar" style="margin-top:6px"><i style="width:'+pct(s.sum,s.goalTotal)+'%;background:var(--violet)"></i></div></div>'+
    '<div style="margin-top:14px"><div class="tiny">This week: '+week.done+'/7 days · '+fmt(week.sum)+' '+esc(h.unit)+'</div>'+
    '<div class="bar" style="margin-top:6px"><i style="width:'+pct(week.done,7)+'%;background:var(--blue)"></i></div></div>'+
    '<div style="margin-top:14px"><div class="tiny">Last 30 days: '+month.done+'/30 days · '+fmt(month.sum)+' '+esc(h.unit)+'</div>'+
    '<div class="bar" style="margin-top:6px"><i style="width:'+pct(month.done,30)+'%;background:var(--amber)"></i></div></div>'+
    '</div></div></div>'+
    '<div class="card"><h2>Your step-by-step plan</h2><p class="sub">The goal, broken into phases that ramp up.</p>'+steps+'</div>'+
    '<div class="card"><h2>Weekly rhythm</h2><p class="sub">Days completed in each of the last 8 weeks.</p>'+weekBars(h)+'</div>';
}
function stat(a,b){return '<div class="stat"><b>'+a+'</b><span>'+b+'</span></div>';}
function rangeStats(h,back){
  var d=0,sum=0,t=today();
  for(var i=back;i>=0;i--){var e=entryOf(h,key(addDays(t,-i)));if(e){if(e.done)d++;if(typeof e.value==='number')sum+=e.value;}}
  return {done:d,sum:sum};
}
function donut(p,s){
  var C=2*Math.PI*54, off=C-(C*p/100);
  return '<svg viewBox="0 0 140 140" width="200" height="200" role="img" aria-label="Overall progress '+p+'%">'+
    '<circle cx="70" cy="70" r="54" fill="none" stroke="var(--line)" stroke-width="16"/>'+
    '<circle cx="70" cy="70" r="54" fill="none" stroke="var(--brand)" stroke-width="16" stroke-linecap="round" '+
    'stroke-dasharray="'+C.toFixed(1)+'" stroke-dashoffset="'+off.toFixed(1)+'" transform="rotate(-90 70 70)"/>'+
    '<text x="70" y="66" text-anchor="middle" font-size="30" font-weight="900" fill="var(--ink)" font-family="Nunito,sans-serif">'+p+'%</text>'+
    '<text x="70" y="86" text-anchor="middle" font-size="11" font-weight="800" fill="var(--muted)" font-family="Nunito,sans-serif">GOAL COMPLETE</text></svg>'+
    '<div class="tiny" style="margin-top:10px;text-align:center">'+s.done+' done · '+s.missed+' missed · '+s.remaining+' to go</div>';
}
function weekBars(h){
  var t=today(),bars=[],max=7;
  for(var w=7;w>=0;w--){
    var d=0,end=addDays(t,-w*7);
    for(var i=0;i<7;i++){var e=entryOf(h,key(addDays(end,-i)));if(e&&e.done)d++;}
    bars.push({d:d,label:w===0?'This wk':'-'+w+'w'});
  }
  var W=560,H=170,bw=W/bars.length;
  var g=bars.map(function(b,i){
    var bh=(b.d/max)*110, x=i*bw+bw*0.2, y=130-bh;
    return '<rect x="'+x.toFixed(1)+'" y="'+y.toFixed(1)+'" width="'+(bw*0.6).toFixed(1)+'" height="'+Math.max(2,bh).toFixed(1)+'" rx="7" fill="var(--brand)"/>'+
      '<text x="'+(x+bw*0.3).toFixed(1)+'" y="'+(y-6).toFixed(1)+'" text-anchor="middle" font-size="12" font-weight="900" fill="var(--muted)" font-family="Nunito,sans-serif">'+b.d+'</text>'+
      '<text x="'+(x+bw*0.3).toFixed(1)+'" y="152" text-anchor="middle" font-size="11" font-weight="800" fill="var(--muted)" font-family="Nunito,sans-serif">'+b.label+'</text>';
  }).join('');
  return '<div class="scrollx"><svg viewBox="0 0 '+W+' '+H+'" width="'+W+'" height="'+H+'">'+g+'</svg></div>';
}

/* -- calendar -- */
function calendarView(){
  var h=cur(), c=calCursor, first=new Date(c.getFullYear(),c.getMonth(),1);
  var startPad=first.getDay(), dim=new Date(c.getFullYear(),c.getMonth()+1,0).getDate();
  var tk=key(today()), cells='';
  ['S','M','T','W','T','F','S'].forEach(function(d){cells+='<div class="dow">'+d+'</div>';});
  for(var i=0;i<startPad;i++) cells+='<div></div>';
  for(var d=1;d<=dim;d++){
    var date=new Date(c.getFullYear(),c.getMonth(),d), k=key(date);
    var idx=idxOf(h,k), inRange=idx>=0&&idx<h.days;
    var e=entryOf(h,k), cls='day'+(inRange?' in':'');
    if(e&&e.rest) cls+=' rest';
    else if(e&&e.done) cls+=' done';
    else if(e&&e.value) cls+=' partial';
    else if(inRange && date<today()) cls+=' miss';
    if(k===tk) cls+=' today';
    var clickable = inRange && date<=today();
    cells+='<div class="'+cls+'" '+(clickable?'onclick="openDay(\''+k+'\')" style="cursor:pointer"':'')+'>'+d+
      (e&&e.photo?'<span class="pin">📸</span>':'')+'</div>';
  }
  return '<div class="card"><div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">'+
    '<button class="pillbtn" onclick="moveMonth(-1)">‹</button>'+
    '<h2 style="flex:1;text-align:center;margin:0">'+c.toLocaleDateString('en-IN',{month:'long',year:'numeric'})+'</h2>'+
    '<button class="pillbtn" onclick="moveMonth(1)">›</button></div>'+
    '<p class="sub" style="text-align:center">'+h.emoji+' '+esc(h.name)+' — tap any past day to fill it in.</p>'+
    '<div class="cal">'+cells+'</div>'+
    '<div class="callegend"><span><i style="background:var(--brand)"></i>Done</span>'+
    '<span><i style="background:var(--amber)"></i>Partial</span>'+
    '<span><i style="background:var(--pink)"></i>Missed</span>'+
    '<span><i style="background:var(--blue)"></i>Rest</span>'+
    '<span><i style="background:var(--violet)"></i>Today</span></div></div>';
}
function moveMonth(n){calCursor=new Date(calCursor.getFullYear(),calCursor.getMonth()+n,1);render();}

/* -- graph -- */
function graphView(){
  var h=cur(), t=today(), pts=[], start=parseKey(h.start);
  var span=Math.min(h.days, Math.max(7, dayDiff(start,t)+1));
  for(var i=0;i<span;i++){
    var d=addDays(start,i), e=entryOf(h,key(d));
    pts.push({i:i,d:d,v:(e&&typeof e.value==='number')?e.value:null,tgt:targetFor(h,i),
              m:(e&&typeof e.metric==='number')?e.metric:null});
  }
  return '<div class="card"><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">'+
    '<div style="flex:1"><h2>'+esc(h.unit)+' per day</h2><p class="sub" style="margin:0">Your logged '+esc(h.unit)+' against the phase target.</p></div>'+
    '<button class="pillbtn" onclick="flipAxes=!flipAxes;render()">🔄 Flip axes</button></div>'+
    '<div style="margin-top:14px">'+lineChart(pts,'v','tgt',h)+'</div></div>'+
    (pts.some(function(p){return p.m!=null;})?
      '<div class="card"><h2>'+esc(h.metric)+' over time</h2><p class="sub">Your measurable side-metric.</p>'+lineChart(pts,'m',null,h)+'</div>':'');
}
function lineChart(pts,field,tf,h){
  var vals=pts.filter(function(p){return p[field]!=null;}).map(function(p){return p[field];});
  if(tf) pts.forEach(function(p){vals.push(p[tf]);});
  if(!vals.length) return '<div class="empty">Log a few days and the graph fills in 📈</div>';
  var max=Math.max.apply(null,vals)*1.15, min=0;
  var W=flipAxes?420:620, H=flipAxes?Math.max(320,pts.length*16):280, P=44;
  function X(p){ return flipAxes ? P+((p[field]!=null?p[field]:0)-min)/(max-min||1)*(W-P-16)
                                 : P+(p.i/(Math.max(1,pts.length-1)))*(W-P-16); }
  function Y(p){ return flipAxes ? 20+(p.i/(Math.max(1,pts.length-1)))*(H-40)
                                 : H-30-((p[field]!=null?p[field]:0)-min)/(max-min||1)*(H-60); }
  var have=pts.filter(function(p){return p[field]!=null;});
  var path=have.map(function(p,i){return (i?'L':'M')+X(p).toFixed(1)+' '+Y(p).toFixed(1);}).join(' ');
  var tpath='';
  if(tf){
    tpath=pts.map(function(p,i){
      var q={}; q[field]=p[tf]; q.i=p.i;
      return (i?'L':'M')+X(q).toFixed(1)+' '+Y(q).toFixed(1);
    }).join(' ');
  }
  var dots=have.map(function(p){return '<circle cx="'+X(p).toFixed(1)+'" cy="'+Y(p).toFixed(1)+'" r="4" fill="var(--brand)"><title>'+dayLabel(p.d)+': '+fmt(p[field])+'</title></circle>';}).join('');
  var grid='',labels='';
  for(var g=0;g<=4;g++){
    var v=min+(max-min)*g/4;
    if(!flipAxes){
      var y=H-30-(g/4)*(H-60);
      grid+='<line x1="'+P+'" y1="'+y.toFixed(1)+'" x2="'+(W-16)+'" y2="'+y.toFixed(1)+'" stroke="var(--line)" stroke-width="1"/>';
      labels+='<text x="'+(P-8)+'" y="'+(y+4).toFixed(1)+'" text-anchor="end" font-size="10" font-weight="800" fill="var(--muted)" font-family="Nunito,sans-serif">'+fmt(v)+'</text>';
    }else{
      var x=P+(g/4)*(W-P-16);
      grid+='<line x1="'+x.toFixed(1)+'" y1="16" x2="'+x.toFixed(1)+'" y2="'+(H-20)+'" stroke="var(--line)" stroke-width="1"/>';
      labels+='<text x="'+x.toFixed(1)+'" y="'+(H-6)+'" text-anchor="middle" font-size="10" font-weight="800" fill="var(--muted)" font-family="Nunito,sans-serif">'+fmt(v)+'</text>';
    }
  }
  var ticks='';
  var stepN=Math.max(1,Math.ceil(pts.length/7));
  pts.forEach(function(p){
    if(p.i%stepN) return;
    if(!flipAxes) ticks+='<text x="'+X(p).toFixed(1)+'" y="'+(H-10)+'" text-anchor="middle" font-size="10" font-weight="800" fill="var(--muted)" font-family="Nunito,sans-serif">'+dayLabel(p.d)+'</text>';
    else ticks+='<text x="'+(P-6)+'" y="'+(Y(p)+3).toFixed(1)+'" text-anchor="end" font-size="10" font-weight="800" fill="var(--muted)" font-family="Nunito,sans-serif">'+dayLabel(p.d)+'</text>';
  });
  return '<div class="scrollx"><svg viewBox="0 0 '+W+' '+H+'" width="'+W+'" height="'+H+'">'+grid+
    (tpath?'<path d="'+tpath+'" fill="none" stroke="var(--violet)" stroke-width="2" stroke-dasharray="6 6"/>':'')+
    '<path d="'+path+'" fill="none" stroke="var(--brand)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>'+
    dots+labels+ticks+'</svg></div>'+
    (tf?'<div class="tiny" style="margin-top:8px"><span style="color:var(--brand)">■</span> logged &nbsp; <span style="color:var(--violet)">▬</span> target</div>':'');
}

/* -- proof -- */
function proofView(){
  var h=cur(), E=entries[h.id]||{};
  var ks=Object.keys(E).filter(function(k){return E[k].photo;}).sort();
  if(!ks.length) return '<div class="card"><h2>Proof shots</h2><p class="sub">Upload progress pics from the Today tab or a calendar day — body shots, finished pages, posted reels.</p><div class="empty"><div class="big">📸</div>Nothing uploaded yet</div></div>';
  return '<div class="card"><h2>'+h.emoji+' Proof shots</h2><p class="sub">'+ks.length+' uploads · oldest to newest</p><div class="gal">'+
    ks.map(function(k){var e=E[k];
      return '<figure>'+proofImage(e.photo,'Proof from '+k)+
        '<figcaption>'+dayLabel(parseKey(k))+(e.value!=null?'<br>'+fmt(e.value)+' '+esc(h.unit):'')+'</figcaption>'+
        '<button class="pillbtn" onclick="removePhoto(\''+h.id+'\',\''+k+'\')">Remove</button></figure>';
    }).join('')+'</div></div>';
}

/* -- manage -- */
function manageView(){
  return '<div class="card"><h2>Your habits</h2><p class="sub">Finished a goal or want to drop one? Delete it here — daily entries and proof photos go with it.</p>'+
    habits.map(function(h){var s=stats(h);
      return '<div class="hrow"><div class="emoji">'+h.emoji+'</div><div class="info"><div class="name">'+esc(h.name)+'</div>'+
      '<div class="task">'+fmt(h.target)+' '+esc(h.unit)+'/day · '+h.days+' days · '+s.done+' done · '+pct(s.done,h.days)+'% complete · '+s.xp+' pts</div>'+
      '<div class="bar" style="margin-top:8px;height:10px"><i style="width:'+pct(s.done,h.days)+'%"></i></div></div>'+
      '<button class="cta danger" onclick="confirmDelete(\''+h.id+'\')">Delete</button></div>';
    }).join('')+
    '<button class="cta" onclick="openNew()" style="margin-top:6px">+ Add another habit</button></div>';
}
function confirmDelete(id){
  var h=byId(id);
  modal('<h3>Delete "'+esc(h.name)+'"?</h3><p class="sub">Every daily entry and proof photo for this habit is removed for good.</p>'+
    '<div class="modal-actions"><button class="cta ghost" onclick="closeModal()">Keep it</button>'+
    '<button class="cta danger" onclick="doDelete(\''+id+'\')">Delete forever</button></div>');
}
async function doDelete(id){ if(await removeHabit(byId(id))) closeModal(); }

/* ---------------- new habit ---------------- */
var draft={t:'steps'};
function openNew(){
  if(!storeReady||storageBusy) return;
  var tpl=TEMPLATES.filter(function(x){return x.k===draft.t;})[0];
  modal('<h3>New habit</h3>'+
   '<div class="chips">'+TEMPLATES.map(function(x){return '<button class="chip '+(x.k===draft.t?'on':'')+'" onclick="draft.t=\''+x.k+'\';openNew()">'+x.label+'</button>';}).join('')+'</div>'+
   '<label class="f"><span>Habit name</span><input id="f_name" value="'+esc(tpl.k==='custom'?'':tpl.label.replace(/^\S+\s/,''))+'" placeholder="e.g. Walk 10k steps"></label>'+
   '<div class="row2"><label class="f"><span>Daily goal</span><input id="f_target" type="number" value="'+tpl.target+'"></label>'+
   '<label class="f"><span>Unit</span><input id="f_unit" value="'+esc(tpl.unit)+'"></label></div>'+
   '<div class="row2"><label class="f"><span>Duration (days)</span><input id="f_days" type="number" value="'+tpl.days+'"></label>'+
   '<label class="f"><span>Start date</span><input id="f_start" type="date" value="'+key(today())+'"></label></div>'+
   '<label class="f"><span>Extra metric to track</span><input id="f_metric" value="'+esc(tpl.metric)+'" placeholder="weight (kg), views, bodyfat %"></label>'+
   '<label class="f"><span>Emoji</span><input id="f_emoji" value="'+tpl.emoji+'" maxlength="4" style="width:90px"></label>'+
   '<label class="f" style="display:flex;gap:10px;align-items:center"><input id="f_ramp" type="checkbox" checked style="width:20px;height:20px">'+
   '<span style="margin:0;text-transform:none;letter-spacing:0;font-size:14px;color:var(--ink)">Ease in — start at half the goal and ramp up</span></label>'+
   '<div class="modal-actions"><button class="cta ghost" onclick="closeModal()">Cancel</button>'+
   '<button class="cta" onclick="createHabit()">Create plan</button></div>');
}
async function createHabit(){
  var name=(el('f_name').value||'').trim()||'My habit';
  var h={
    name:name, emoji:(el('f_emoji').value||'🎯').trim()||'🎯',
    target:Math.max(0.1,+el('f_target').value||1), unit:(el('f_unit').value||'units').trim(),
    days:Math.max(1,Math.min(730,Math.round(+el('f_days').value)||30)),
    start:el('f_start').value||key(today()),
    metric:(el('f_metric').value||'value').trim(),
    ramp:el('f_ramp').checked };
  if(await saveHabit(h)) closeModal();
}

/* -- day editor -- */
function openDay(k){
  var h=cur(), e=entryOf(h,k)||{}, idx=idxOf(h,k);
  modal('<h3>'+parseKey(k).toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'long'})+'</h3>'+
    '<p class="sub">'+h.emoji+' '+esc(h.name)+' · day '+(idx+1)+' target '+fmt(targetFor(h,idx))+' '+esc(h.unit)+'</p>'+
    '<div class="row2"><label class="f"><span>'+esc(h.unit)+' done</span><input id="d_val" type="number" value="'+esc(e.value!=null?e.value:'')+'"></label>'+
    '<label class="f"><span>'+esc(h.metric)+'</span><input id="d_met" type="number" value="'+esc(e.metric!=null?e.metric:'')+'"></label></div>'+
    (e.photo?proofImage(e.photo,'Proof from '+k):'')+
    '<button class="cta ghost" onclick="pickPhoto(\''+h.id+'\',\''+k+'\')">📷 '+(e.photo?'Replace':'Add')+' proof photo</button>'+
    (e.photo?'<button class="pillbtn" onclick="removePhoto(\''+h.id+'\',\''+k+'\')">Remove photo</button>':'')+
    '<button class="cta ghost" style="margin-left:8px" onclick="markRest(\''+h.id+'\',\''+k+'\')">😌 Rest day</button>'+
    '<p class="tiny" style="margin-top:10px">A rest day pauses your streak instead of breaking it — planned time off beats guilt.</p>'+
    '<div class="modal-actions"><button class="cta ghost" onclick="closeModal()">Close</button>'+
    '<button class="cta" onclick="saveDay(\''+h.id+'\',\''+k+'\')">'+(e.done?'Update':'Mark done')+'</button></div>');
}
async function saveDay(id,k){
  var h=byId(id), v=el('d_val').value, m=el('d_met').value;
  if(await saveEntry(h,k,{value:v===''?null:+v, metric:m===''?null:+m, done:true,rest:false})) closeModal();
}

/* ---------------- modal / chrome ---------------- */
function modal(html){ el('modalRoot').innerHTML='<div class="scrim" onclick="if(event.target===this)closeModal()"><div class="modal"><div id="modalStoreNote"></div>'+html+'</div></div>'; hydrateProofPhotos(); }
function closeModal(){ el('modalRoot').innerHTML=''; }

el('tabs').addEventListener('click',function(e){
  var b=e.target.closest('button'); if(!b) return; view=b.dataset.v; render();
});
el('newBtn').onclick=openNew;
el('themeBtn').onclick=function(){
  var r=document.documentElement, now=r.getAttribute('data-theme');
  var dark = now ? now==='dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  r.setAttribute('data-theme', dark?'light':'dark');
  try{localStorage.setItem('sl_theme',dark?'light':'dark');}catch(_){}
};
try{var st=localStorage.getItem('sl_theme'); if(st) document.documentElement.setAttribute('data-theme',st);}catch(_){}

// The existing auth hook resets the UI and schedules persistence startup.
function resetTrackerSession(){
  resetStorageSession();
  habits=[]; entries={}; selected=null;
  view='today'; calCursor=new Date(); flipAxes=false; draft={t:'steps'};
  closeModal();
  noteStore('');
  render();
}
