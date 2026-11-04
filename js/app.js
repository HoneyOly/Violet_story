(()=>{
const $=s=>document.querySelector(s),L=$('#L'),R=$('#R'),book=$('#book'),cover=$('#cover'),shift=$('#shift');
const KEY='skbook-progress',TXT='assets/book.txt';
const reduce=matchMedia('(prefers-reduced-motion:reduce)').matches;
const esc=s=>s.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const RAD=Math.PI/180;
let blocks=[],pages=[],chapters=[],cur=0,single=false,busy=false,ratio=null,opened=false,drag=null;
const sPage=new Audio('assets/page.mp3'),sAmb=new Audio('assets/ambient.mp3');
sAmb.loop=true;sAmb.volume=.4;
const play=()=>{try{sPage.currentTime=0;sPage.play().catch(()=>{});}catch(e){}};

// stacked 3D layers = thickness of the book
for(const [id,side] of [['sL','L'],['sR','R']]){const s=$('#'+id);
 let h='<i class="bd" style="transform:translateZ(-30px)"></i>';
 for(let i=1;i<=8;i++)h+=`<i style="transform:translateZ(-${i*3}px)"></i>`;
 s.innerHTML=h;}

function parse(t){blocks=[];t.replace(/\r/g,'').split('\n').forEach(l=>{l=l.trim();if(!l)return;let m;
 if(m=l.match(/^%\s+(.*)/))$('#ttl').textContent=m[1];
 else if(m=l.match(/^#\s+(.*)/))blocks.push({t:'h',s:m[1]});
 else if(m=l.match(/^\[img:([^|\]]+)\|?([^\]]*)\]$/))blocks.push({t:'i',src:m[1].trim(),cap:m[2].trim()});
 else blocks.push({t:'p',s:l});});}
const loadImg=src=>new Promise(r=>{const i=new Image();i.onload=()=>r(1);i.onerror=()=>r(0);i.src=src;});

async function paginate(){
 pages=[];chapters=[];
 const m=document.createElement('div');m.className='measure';R.append(m);
 const lim=()=>m.getBoundingClientRect().top+m.clientHeight*.91;
 const fits=()=>{const l=m.lastElementChild;return !l||l.getBoundingClientRect().bottom<=lim();};
 const flush=()=>{if(m.innerHTML.trim())pages.push(m.innerHTML);m.innerHTML='';};
 for(const b of blocks){
  if(b.t==='h'){flush();chapters.push({title:b.s,page:pages.length});m.insertAdjacentHTML('beforeend',`<h2>${esc(b.s)}</h2>`);}
  else if(b.t==='i'){
   const ok=await loadImg(b.src);
   const f=`<figure>${ok?`<img src="${esc(b.src)}" alt="${esc(b.cap)}">`:''}${b.cap?`<figcaption>${esc(b.cap)}</figcaption>`:''}</figure>`;
   m.insertAdjacentHTML('beforeend',f);
   if(!fits()&&m.children.length>1){m.lastElementChild.remove();flush();m.insertAdjacentHTML('beforeend',f);}
  }else{
   let w=b.s.split(/\s+/),cont=false;
   while(w.length){
    const p=document.createElement('p');if(cont)p.className='cont';m.append(p);
    let lo=0,hi=w.length;
    while(lo<hi){const mid=Math.ceil((lo+hi)/2);p.textContent=w.slice(0,mid).join(' ');if(fits())lo=mid;else hi=mid-1;}
    if(lo===0){if(m.children.length>1){p.remove();flush();continue;}lo=1;}
    p.textContent=w.slice(0,lo).join(' ');w=w.slice(lo);cont=true;
    if(w.length)flush();
   }
  }
 }
 flush();m.remove();
}

const pg=i=>i>=0&&i<pages.length?`<div class="page">${pages[i]}<div class="num">${i+1}</div></div>`:'';
function show(){
 L.innerHTML=single?'':pg(cur);R.innerHTML=single?pg(cur):pg(cur+1);
 $('#prev').disabled=cur<=0;$('#next').disabled=cur+(single?1:2)>=pages.length;
 try{localStorage.setItem(KEY,JSON.stringify({cur,total:pages.length}));}catch(e){}
}

// ---- page turning (drag like a real page, or click) ----
function startLeaf(dir){
 const to=cur+dir*(single?1:2);
 if(busy||!opened||to<0||to>=pages.length)return null;
 busy=true;
 const leaf=document.createElement('div');let front,back='';
 const sb=single&&dir<0;
 if(single){leaf.className='leaf fwd';R.innerHTML=pg(dir>0?to:cur);front=pg(sb?to:cur);}
 else if(dir>0){leaf.className='leaf fwd';front=pg(cur+1);back=pg(to);R.innerHTML=pg(to+1);}
 else{leaf.className='leaf bwd';front=pg(cur);back=pg(to+1);L.innerHTML=pg(to);}
 leaf.innerHTML=`<div class="face">${front}</div><div class="face back">${back}</div>`;
 book.append(leaf);
 return {leaf,to,dir,sb,th:sb?180:0,k:0};
}
function setAngle(d,th,ms){
 const l=d.leaf,s=Math.sin(th*RAD),sign=(d.dir>0||single)?-1:1;
 l.style.transition=ms?`transform ${ms}ms cubic-bezier(.45,.05,.3,1)`:'none';
 l.style.setProperty('--s',s);
 l.style.transform=`rotateY(${sign*th}deg) skewY(${d.k*s*-6}deg)`;
 d.th=th;
}
function finish(d,turned,ms){
 const end=turned?(d.sb?0:180):(d.sb?180:0);
 if(turned)play();
 setAngle(d,end,reduce?0:ms);
 setTimeout(()=>{d.leaf.remove();if(turned)cur=d.to;show();busy=false;},reduce?0:ms+30);
}
function clickTurn(dir){const d=startLeaf(dir);if(!d)return;setAngle(d,d.th,0);d.leaf.offsetWidth;finish(d,true,900);}

function angleAt(d,e){
 const r=book.getBoundingClientRect();
 const spine=single?r.left:r.left+r.width/2,W=single?r.width:r.width/2;
 let p=(e.clientX-spine)/W;if(!single&&d.dir<0)p=-p;
 d.k=(e.clientY-r.top)/r.height-.5;
 return Math.acos(Math.max(-1,Math.min(1,p)))/RAD;
}
function down(e){
 if(!opened||busy)return;
 const dir=single?(e.clientX<innerWidth*.25?-1:1):(e.currentTarget===R?1:-1);
 drag={dir,x:e.clientX,y:e.clientY,d:null,t:Date.now()};
}
addEventListener('pointermove',e=>{
 if(!drag)return;
 if(!drag.d){if(Math.hypot(e.clientX-drag.x,e.clientY-drag.y)<8)return;
  drag.d=startLeaf(drag.dir);if(!drag.d){drag=null;return;}}
 setAngle(drag.d,angleAt(drag.d,e),0);
});
addEventListener('pointerup',e=>{
 if(!drag)return;const g=drag;drag=null;
 if(!g.d){clickTurn(g.dir);return;}
 const d=g.d,th=d.th,v=(e.clientX-g.x);
 const turned=d.sb?th<90:th>90;
 finish(d,turned,Math.max(300,Math.abs((turned?(d.sb?0:180):(d.sb?180:0))-th)*5));
});
L.addEventListener('pointerdown',down);R.addEventListener('pointerdown',down);

// ---- opening the book ----
function openBook(){
 if(opened||busy||!pages.length)return;
 opened=busy=true;play();
 shift.classList.remove('closed');
 const ms=reduce?0:1500;
 cover.style.transition=`transform ${ms}ms cubic-bezier(.5,0,.25,1)`;
 cover.style.transform='rotateY(-180deg)';
 setTimeout(()=>{cover.style.transition='opacity .35s';cover.style.opacity=0;},ms);
 setTimeout(()=>{cover.style.display='none';busy=false;},ms+380);
}
cover.addEventListener('click',openBook);

function jump(p){if(!opened)return;cur=single?p:p&~1;show();$('#toc').hidden=true;}
function buildToc(){const t=$('#toc');t.innerHTML='';
 chapters.forEach(c=>{const b=document.createElement('button');b.textContent=c.title;b.onclick=()=>{if(!opened)openBook();setTimeout(()=>jump(c.page),opened?0:50);};t.append(b);});}

async function build(){
 single=innerWidth<760;document.body.classList.toggle('single',single);
 await paginate();buildToc();
 if(ratio!==null){cur=Math.min(pages.length-1,Math.round(ratio*pages.length));ratio=null;}
 cur=Math.max(0,single?cur:cur&~1);show();
}
async function init(){
 try{const s=JSON.parse(localStorage.getItem(KEY)||'null');if(s)ratio=s.cur/s.total;}catch(e){}
 try{const r=await fetch(TXT);if(!r.ok)throw 0;parse(await r.text());}
 catch(e){R.innerHTML='<div class="page"><p>Не удалось загрузить assets/book.txt. Откройте сайт через веб-сервер или GitHub Pages.</p></div>';return;}
 await document.fonts.ready;await build();
}
$('#prev').onclick=()=>clickTurn(-1);$('#next').onclick=()=>clickTurn(1);
addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' ')openBook();if(e.key==='ArrowRight')clickTurn(1);if(e.key==='ArrowLeft')clickTurn(-1);});
$('#tocBtn').onclick=()=>{const t=$('#toc');t.hidden=!t.hidden;};
$('#sndBtn').onclick=e=>{if(sAmb.paused){sAmb.play().catch(()=>{});e.target.textContent='♪ Лес: вкл';}else{sAmb.pause();e.target.textContent='♪ Лес: выкл';}};
let tm,lastW=innerWidth,lastH=innerHeight;
addEventListener('resize',()=>{clearTimeout(tm);tm=setTimeout(()=>{if(innerWidth===lastW&&Math.abs(innerHeight-lastH)<120)return;
 lastW=innerWidth;lastH=innerHeight;ratio=cur/Math.max(1,pages.length);build();},300);});
init();
})();
