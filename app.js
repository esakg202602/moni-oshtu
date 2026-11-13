import {FilesetResolver,PoseLandmarker,ObjectDetector} from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';

/* ================= ядро ================= */
const $=(s,e=document)=>e.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const view=$('#view'),camPage=$('#camPage');
let TOKEN=localStorage.getItem('tok')||'';
const toast=(m,bad)=>{const t=document.createElement('div');t.className='toast'+(bad?' bad':'');t.textContent=m;$('#toasts').append(t);setTimeout(()=>t.remove(),4500)};
async function api(p,body,method){
  const r=await fetch('/api'+p,{method:method||(body?'POST':'GET'),headers:{'Content-Type':'application/json',Authorization:'Bearer '+TOKEN},body:body?JSON.stringify(body):undefined});
  if(r.status===401&&p!=='/login'){logout();throw new Error('Сессия истекла')}
  const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||('Ошибка '+r.status));return j}
const fd=d=>d?new Date(d).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'—';
const fdur=s=>s>=60?Math.floor(s/60)+' мин '+Math.round(s%60)+' с':Math.round(s)+' с';
const loc=d=>{const x=new Date(d);x.setMinutes(x.getMinutes()-x.getTimezoneOffset());return x.toISOString().slice(0,16)};
const ST={front:['Смотрит вперёд','#15803d'],screen:['ПК / экран','#2563eb'],notebook:['Тетрадь','#7c3aed'],phone:['Телефон','#ea580c'],away:['Отвернулся','#ca8a04'],lying:['Лёжа / на парте','#dc2626'],standing:['Стоит','#0891b2'],board:['У доски','#0f766e'],camera:['Смотрит в камеру','#d97706'],late:['Опоздание','#ca8a04'],absent:['Не пришёл','#dc2626']};
const sl=s=>(ST[s]||[s])[0];
function modal(html,wide){const m=document.createElement('div');m.className='modal';m.innerHTML=`<div class="box${wide?' wide':''}">${html}</div>`;
  m.addEventListener('mousedown',e=>{if(e.target===m)m.close()});m.close=()=>{m.onclose&&m.onclose();m.remove()};document.body.append(m);return m}
const guard=f=>async(...a)=>{try{return await f(...a)}catch(e){toast(e.message,1)}};

/* ================= вход и навигация ================= */
const PAGES={dash:['Панель',pDash],cam:['Камера',null],people:['Люди',pPeople],lessons:['Занятия',pLessons],viol:['Проверка',pViol],rules:['Правила',pRules],rep:['Отчёты',pRep]};
function logout(){TOKEN='';localStorage.removeItem('tok');boot()}
$('#lf').onsubmit=async e=>{e.preventDefault();try{const j=await api('/login',{password:$('#lpw').value});TOKEN=j.token;localStorage.setItem('tok',TOKEN);boot()}catch(x){$('#lerr').textContent=x.message}};
function boot(){
  $('#login').hidden=!!TOKEN;$('#app').hidden=!TOKEN;if(!TOKEN)return;
  $('#nav').innerHTML=`<div class="logo"><i></i>Campus Vision</div>`+Object.entries(PAGES).map(([k,v])=>`<button data-p="${k}">${v[0]}${k==='viol'?'<span class="badge" id="pb" hidden></span>':''}</button>`).join('')+`<div class="sp"></div><button id="lo">Выйти</button>`;
  $('#nav').onclick=e=>{const b=e.target.closest('button');if(!b)return;if(b.id==='lo')return logout();go(b.dataset.p)};
  buildCam();go(location.hash.slice(1)||'dash');
}
async function go(p){
  if(!PAGES[p])p='dash';location.hash=p;
  document.querySelectorAll('#nav [data-p]').forEach(b=>b.classList.toggle('on',b.dataset.p===p));
  const isCam=p==='cam';camPage.hidden=!isCam;view.hidden=isCam;
  if(isCam)return camShow();
  view.innerHTML='<p class="empty">Загрузка…</p>';
  try{await PAGES[p][1]()}catch(e){view.innerHTML=`<p class="empty">${esc(e.message)}</p>`}
  api('/dashboard').then(d=>{const b=$('#pb');if(b){b.hidden=!d.pending;b.textContent=d.pending}}).catch(()=>{});
}

/* ================= панель ================= */
async function pDash(){
  const d=await api('/dashboard');
  view.innerHTML=`<div class="head"><h1>Панель</h1></div>
  <div class="kpis">${[['Занятий сегодня',d.lessons,''],['Пришли вовремя',d.present,'ok'],['Опоздали',d.late,'warn'],['Не пришли',d.absent,'bad'],['Ждут проверки',d.pending,'acc']].map(k=>`<div class="kpi ${k[2]}"><b>${k[1]}</b><span>${k[0]}</span></div>`).join('')}</div>
  <div class="cols"><section class="card"><h2>Больше всего штрафов за 7 дней</h2><table>${d.top.map(t=>`<tr><td>${esc(t.name)}<td>${esc(t.group)}<td class="num"><b>${t.sum}</b></tr>`).join('')||'<tr><td class="empty">Штрафов пока нет</tr>'}</table></section>
  <section class="card"><h2>Последние события</h2><table>${d.recent.map(v=>`<tr><td>${esc(v.person?.full_name)}<td><span class="tag ${v.status==='pending'?'warn':v.status==='rejected'?'bad':'ok'}">${esc(sl(v.state))}</span><td class="num">${v.points}</tr>`).join('')||'<tr><td class="empty">Событий пока нет</tr>'}</table></section></div>`;
}

/* ================= люди ================= */
const PFLT={role:'student',q:''};
async function pPeople(){
  const all=await api('/people');window._people=all;
  const list=all.filter(p=>p.role===PFLT.role&&p.full_name.toLowerCase().includes(PFLT.q.toLowerCase()));
  view.innerHTML=`<div class="head"><h1>Люди</h1><div class="tools">
   <div class="seg"><button data-r="student" class="${PFLT.role==='student'?'on':''}">Студенты</button><button data-r="teacher" class="${PFLT.role==='teacher'?'on':''}">Преподаватели</button></div>
   <input id="q" placeholder="Поиск по ФИО" value="${esc(PFLT.q)}"><button class="btn" id="imp">Импорт списком</button><button class="btn pri" id="add">Добавить</button></div></div>
  <div class="card"><table><thead><tr><th>ФИО<th>Группа<th>Телефон<th>Лицо<th class="num">Рейтинг<th class="num">Модуль<th></tr></thead><tbody>
  ${list.map(p=>`<tr><td>${esc(p.full_name)}<td>${esc(p.group_name)}<td>${esc(p.phone)}<td>${!p.consent?'<span class="tag bad">нет согласия</span>':p.descriptor_count?`<span class="tag ok">${p.descriptor_count} образцов</span>`:'<span class="tag warn">не обучен</span>'}<td class="num">${p.rating_points}<td class="num">${p.module_points}<td class="act"><button class="btn" data-t="${p.id}">Обучить по камере</button> <button class="btn" data-ph="${p.id}">Из фото</button> <button class="btn" data-e="${p.id}">Изменить</button></tr>`).join('')||'<tr><td colspan="7" class="empty">Здесь пусто. Нажмите «Добавить» или «Импорт списком».</tr>'}</tbody></table></div>`;
  view.querySelectorAll('[data-r]').forEach(b=>b.onclick=()=>{PFLT.role=b.dataset.r;pPeople()});
  $('#q').oninput=e=>{PFLT.q=e.target.value;clearTimeout(window._qt);window._qt=setTimeout(pPeople,250)};
  $('#add').onclick=()=>personForm({role:PFLT.role});$('#imp').onclick=importForm;
  const find=id=>all.find(p=>p.id===id);
  view.querySelectorAll('[data-e]').forEach(b=>b.onclick=()=>personForm(find(b.dataset.e)));
  view.querySelectorAll('[data-t]').forEach(b=>b.onclick=guard(()=>trainModal(find(b.dataset.t))));
  view.querySelectorAll('[data-ph]').forEach(b=>b.onclick=()=>photoEnroll(find(b.dataset.ph)));
}
function personForm(p={}){
  const m=modal(`<h3>${p.id?'Изменить':'Новый человек'}</h3><div class="form">
   <label>Роль<select id="fr"><option value="student">Студент<option value="teacher">Преподаватель</select></label>
   <label>ФИО<input id="fn"></label><div class="two"><label>Группа<input id="fg" placeholder="ПИ-1-23"></label><label>Телефон<input id="fp"></label></div>
   <label>ID в системе баллов университета<input id="fx"></label>
   <label class="chk"><input type="checkbox" id="fc"> Письменное согласие на биометрическую идентификацию получено</label></div>
   <div class="row"><button class="btn pri" id="fs">Сохранить</button>${p.id?'<button class="btn bad" id="fdel">Удалить</button>':''}</div>`);
  $('#fr',m).value=p.role||'student';$('#fn',m).value=p.full_name||'';$('#fg',m).value=p.group_name||'';$('#fp',m).value=p.phone||'';$('#fx',m).value=p.external_id||'';$('#fc',m).checked=!!p.consent;
  $('#fs',m).onclick=guard(async()=>{const b={role:$('#fr',m).value,full_name:$('#fn',m).value.trim(),group_name:$('#fg',m).value.trim(),phone:$('#fp',m).value.trim(),external_id:$('#fx',m).value.trim(),consent:$('#fc',m).checked};
    if(!b.full_name)return toast('Введите ФИО',1);p.id?await api('/people/'+p.id,b,'PUT'):await api('/people',b);m.close();pPeople()});
  if(p.id)$('#fdel',m).onclick=guard(async()=>{if(confirm('Удалить '+p.full_name+' и всю историю?')){await api('/people/'+p.id,null,'DELETE');m.close();pPeople()}});
}
function importForm(){
  const m=modal(`<h3>Импорт списком</h3><div class="form"><div class="two"><label>Роль<select id="ir"><option value="student">Студенты<option value="teacher">Преподаватели</select></label><label>Группа<input id="ig" placeholder="ПИ-1-23"></label></div>
  <label>По одному человеку в строке: ФИО; телефон<textarea id="it" placeholder="Иванов Иван Иванович; 0700123456"></textarea></label></div><div class="row"><button class="btn pri" id="is">Добавить всех</button></div>`);
  $('#is',m).onclick=guard(async()=>{const lines=$('#it',m).value.split('\n').map(l=>{const [n,ph]=l.split(';');return{full_name:(n||'').trim(),phone:(ph||'').trim()}});
    const r=await api('/people/bulk',{role:$('#ir',m).value,group_name:$('#ig',m).value.trim(),lines});toast('Добавлено: '+r.added);m.close();pPeople()});
}

/* ================= занятия ================= */
async function pLessons(){
  const from=new Date(Date.now()-14*864e5).toISOString();
  const [ls,ps]=await Promise.all([api('/lessons?from='+from),api('/people')]);
  const groups=[...new Set(ps.filter(p=>p.role==='student'&&p.group_name).map(p=>p.group_name))],teachers=ps.filter(p=>p.role==='teacher');
  const now=new Date(),end=new Date(now.getTime()+5400e3);
  view.innerHTML=`<div class="head"><h1>Занятия</h1></div>
  <section class="card" style="margin-bottom:16px"><h2>Новое занятие</h2><div class="form"><div class="two"><label>Предмет<input id="lt"></label><label>Аудитория<input id="lr"></label></div>
  <div class="two"><label>Группа<select id="lg">${groups.map(g=>`<option>${esc(g)}`).join('')||'<option value="">— сначала добавьте студентов —'}</select></label><label>Преподаватель<select id="lh"><option value="">—${teachers.map(t=>`<option value="${t.id}">${esc(t.full_name)}`).join('')}</select></label></div>
  <div class="two"><label>Начало<input type="datetime-local" id="ls" value="${loc(now)}"></label><label>Конец<input type="datetime-local" id="le" value="${loc(end)}"></label></div>
  <label>Допустимое опоздание, минут<input type="number" id="lgm" value="5" min="0"></label></div><div class="row"><button class="btn pri" id="lc">Создать</button></div></section>
  <section class="card"><table><thead><tr><th>Время<th>Предмет<th>Группа<th>Преподаватель<th>Статус<th></tr></thead><tbody>
  ${ls.map(l=>`<tr><td>${fd(l.starts_at)}<td>${esc(l.title)}<td>${esc(l.group_name)}<td>${esc(l.teacher?.full_name)}<td><span class="tag ${l.status==='closed'?'':'warn'}">${{planned:'запланировано',running:'идёт',closed:'завершено'}[l.status]}</span><td class="act"><button class="btn" data-c="${l.id}">Камера</button> <button class="btn" data-s="${l.id}">Итоги</button> <button class="btn bad" data-d="${l.id}">Удалить</button></tr>`).join('')||'<tr><td colspan="6" class="empty">Занятий нет. Создайте первое выше.</tr>'}</tbody></table></section>`;
  $('#lc').onclick=guard(async()=>{const b={title:$('#lt').value.trim(),room:$('#lr').value.trim(),group_name:$('#lg').value,teacher_id:$('#lh').value,starts_at:new Date($('#ls').value).toISOString(),ends_at:new Date($('#le').value).toISOString(),grace_min:+$('#lgm').value};
    if(!b.title)return toast('Введите предмет',1);await api('/lessons',b);toast('Занятие создано');pLessons()});
  view.querySelectorAll('[data-c]').forEach(b=>b.onclick=()=>{CAM.pick=b.dataset.c;go('cam')});
  view.querySelectorAll('[data-d]').forEach(b=>b.onclick=guard(async()=>{if(confirm('Удалить занятие со всей историей?')){await api('/lessons/'+b.dataset.d,null,'DELETE');pLessons()}}));
  view.querySelectorAll('[data-s]').forEach(b=>b.onclick=guard(async()=>{const s=await api(`/lessons/${b.dataset.s}/summary`);
    modal(`<h3>Итоги занятия</h3><table><thead><tr><th>Кто<th>Статус</tr></thead>${s.attendance.map(a=>`<tr><td>${esc(a.person?.full_name)}<td>${a.status==='present'?'пришёл':a.status==='late'?'опоздал на '+a.late_minutes+' мин':'не пришёл'}</tr>`).join('')}</table>
    <h3 style="margin-top:18px">Что делали</h3>${s.people.map(p=>`<p><b>${esc(p.name)}</b><br>${Object.entries(p.states).map(([k,v])=>`${esc(sl(k))}: ${fdur(v)}`).join(' · ')}</p>`).join('')||'<p class="empty">Данных камеры нет</p>'}`,true)}));
}

/* ================= проверка нарушений ================= */
let VST='pending';
async function pViol(){
  const vs=await api('/violations?status='+VST);
  view.innerHTML=`<div class="head"><h1>Проверка</h1><div class="seg">${[['pending','Ждут решения'],['applied','Применены'],['rejected','Отклонены']].map(s=>`<button data-s="${s[0]}" class="${VST===s[0]?'on':''}">${s[1]}</button>`).join('')}</div></div>
  <div class="card"><table><thead><tr><th>Когда<th>Кто<th>Что<th>Длительность<th class="num">Баллы<th></tr></thead><tbody>
  ${vs.map(v=>`<tr><td>${fd(v.created_at)}<td>${esc(v.person?.full_name)}<br><small>${esc(v.person?.group_name)} · ${esc(v.lesson?.title)}</small><td><span class="tag warn">${esc(sl(v.state))}</span><td>${v.seconds?fdur(v.seconds):'—'}<td class="num"><b>${v.points}</b><td class="act">${v.status==='pending'?`<button class="btn pri" data-a="${v.id}">Применить</button> <button class="btn" data-x="${v.id}">Отклонить</button>`:''}</tr>`).join('')||'<tr><td colspan="6" class="empty">Здесь пусто</tr>'}</tbody></table></div>`;
  view.querySelectorAll('[data-s]').forEach(b=>b.onclick=()=>{VST=b.dataset.s;pViol()});
  const rev=(id,action)=>guard(async()=>{await api(`/violations/${id}/review`,{action});go('viol')});
  view.querySelectorAll('[data-a]').forEach(b=>b.onclick=rev(b.dataset.a,'approve'));
  view.querySelectorAll('[data-x]').forEach(b=>b.onclick=rev(b.dataset.x,'reject'));
}

/* ================= правила ================= */
async function pRules(){
  const rs=await api('/rules');
  view.innerHTML=`<div class="head"><h1>Правила баллов</h1></div><p style="color:var(--mute);margin-top:-8px">Минус — штраф, плюс — бонус. Если «Авто» выключено, нарушение сначала попадает на проверку человеком.</p>
  <div class="card"><table><thead><tr><th>Событие<th>Для кого<th>От, сек<th>Баллы<th>За след. минуту<th>Куда<th>Авто<th>Вкл</tr></thead><tbody>
  ${rs.map(r=>`<tr data-id="${r.id}"><td><b>${esc(sl(r.state))}</b><br><small>${esc(r.label)}</small><td><select data-f="role">${['student','teacher','both'].map(o=>`<option value="${o}" ${r.role===o?'selected':''}>${{student:'студент',teacher:'преподаватель',both:'все'}[o]}`).join('')}</select>
  <td><input data-f="min_seconds" type="number" value="${r.min_seconds}" style="width:80px"><td><input data-f="base_points" type="number" step="0.5" value="${r.base_points}" style="width:80px"><td><input data-f="per_minute_points" type="number" step="0.5" value="${r.per_minute_points}" style="width:80px">
  <td><select data-f="target">${['both','rating','module'].map(o=>`<option value="${o}" ${r.target===o?'selected':''}>${{both:'рейтинг и модуль',rating:'рейтинг',module:'модуль'}[o]}`).join('')}</select>
  <td><input data-f="auto_apply" type="checkbox" ${r.auto_apply?'checked':''}><td><input data-f="active" type="checkbox" ${r.active?'checked':''}></tr>`).join('')}</tbody></table></div>`;
  view.querySelectorAll('[data-f]').forEach(i=>i.onchange=guard(async()=>{const tr=i.closest('tr'),b={};
    tr.querySelectorAll('[data-f]').forEach(x=>{const k=x.dataset.f;b[k]=x.type==='checkbox'?x.checked:x.type==='number'?+x.value:x.value});
    await api('/rules/'+tr.dataset.id,b,'PUT');toast('Сохранено')}));
}

/* ================= отчёты ================= */
async function pRep(){
  const ps=await api('/people');
  view.innerHTML=`<div class="head"><h1>Отчёты</h1><div class="tools"><select id="rp"><option value="">Выберите человека…${ps.map(p=>`<option value="${p.id}">${esc(p.full_name)} (${esc(p.group_name||'преп.')})`).join('')}</select><button class="btn" id="ex">Скачать баллы (CSV)</button></div></div><div id="rb"></div>`;
  $('#ex').onclick=guard(async()=>{const r=await fetch('/api/export/points.csv',{headers:{Authorization:'Bearer '+TOKEN}});const u=URL.createObjectURL(await r.blob());Object.assign(document.createElement('a'),{href:u,download:'points.csv'}).click()});
  $('#rp').onchange=guard(async e=>{if(!e.target.value)return;const d=await api(`/people/${e.target.value}/report`);const mx=Math.max(1,...Object.values(d.totals));
    $('#rb').innerHTML=`<div class="kpis"><div class="kpi acc"><b>${d.person.rating_points}</b><span>Рейтинг</span></div><div class="kpi acc"><b>${d.person.module_points}</b><span>Модуль</span></div></div>
    <div class="cols"><section class="card"><h2>Чем занимался за 30 дней</h2>${Object.entries(d.totals).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<div class="bar"><span>${esc(sl(k))}</span><div style="width:${v/mx*100}%;background:${(ST[k]||[0,'#64748b'])[1]}"></div><span>${fdur(v)}</span></div>`).join('')||'<p class="empty">Данных нет</p>'}</section>
    <section class="card"><h2>Корректировка баллов</h2><div class="form"><div class="two"><label>Баллы (±)<input id="pd" type="number" step="0.5"></label><label>Причина<input id="pr"></label></div></div><div class="row"><button class="btn pri" id="pa">Применить</button></div></section></div>
    <section class="card" style="margin-top:16px"><h2>Посещаемость</h2><table>${d.attendance.map(a=>`<tr><td>${fd(a.lesson?.starts_at)}<td>${esc(a.lesson?.title)}<td>${a.status==='present'?'пришёл':a.status==='late'?'опоздал на '+a.late_minutes+' мин':'не пришёл'}</tr>`).join('')||'<tr><td class="empty">Нет записей</tr>'}</table></section>
    <section class="card" style="margin-top:16px"><h2>История баллов</h2><table>${d.points.map(p=>`<tr><td>${fd(p.created_at)}<td>${esc(sl(p.reason))}<td class="num"><b>${p.delta>0?'+':''}${p.delta}</b></tr>`).join('')||'<tr><td class="empty">Пока пусто</tr>'}</table></section>`;
    $('#pa').onclick=guard(async()=>{const delta=+$('#pd').value;if(!delta)return;await api('/points',{person_id:e.target.value,delta,reason:$('#pr').value||'Ручная корректировка'});toast('Готово');e.target.onchange(e)})});
}

/* ================= камера: модели и настройки ================= */
const FA='https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.13/model/';
const MPW='https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const POSE_URL='https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
const OBJ_URL='https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite';
const CFG=Object.assign({pitchDown:.10,yawAway:.45,hold:3,zx0:.05,zx1:.40,inputSize:416,learn:true,thr:.5},JSON.parse(localStorage.getItem('cfg')||'{}'));
const CAM={run:false,tracks:[],tid:0,buf:[],seen:{},lost:[],lesson:null,roster:null,pick:null,pose:null,obj:null};
let RECO=[],RMAP={},faceReady,mpReady,ROOM={samples:[]};
const ensureFace=()=>faceReady||(faceReady=(async()=>{for(const n of['tinyFaceDetector','faceLandmark68Net','faceRecognitionNet'])await faceapi.nets[n].loadFromUri(FA)})().catch(e=>{faceReady=null;throw e}));
const ensureMP=()=>mpReady||(mpReady=(async()=>{
  try{const fs=await FilesetResolver.forVisionTasks(MPW);
    const mk=async(C,url,opt)=>{for(const d of['GPU','CPU']){try{return await C.createFromOptions(fs,{baseOptions:{modelAssetPath:url,delegate:d},runningMode:'VIDEO',...opt})}catch(e){console.warn(d,e)}}};
    CAM.pose=await mk(PoseLandmarker,POSE_URL,{numPoses:8});
    CAM.obj=await mk(ObjectDetector,OBJ_URL,{scoreThreshold:.3,maxResults:25,categoryAllowlist:['cell phone','laptop','book','tv','keyboard']});
  }catch(e){console.error(e);toast('Поза и предметы недоступны — работает только распознавание лиц',1)}})());

/* ---- внешний вид: цвет формы/одежды с поправкой на свет ---- */
const AC=document.createElement('canvas');AC.width=320;AC.height=180;const ACX=AC.getContext('2d',{willReadFrequently:true});
function frameData(v){ACX.drawImage(v,0,0,320,180);const im=ACX.getImageData(0,0,320,180),d=im.data;let s=0,n=0;for(let i=0;i<d.length;i+=64){s+=Math.max(d[i],d[i+1],d[i+2])/255;n++}im.lum=Math.max(.05,s/n);return im}
function torso(e){
  if(e.pose){const L=e.pose[11],R=e.pose[12];if(L.visibility>.4&&R.visibility>.4){const x0=Math.min(L.x,R.x),w=Math.abs(L.x-R.x),y=(L.y+R.y)/2;const hv=e.pose[23].visibility>.4&&e.pose[24].visibility>.4;
    return{x0:x0+w*.15,x1:x0+w*.85,y0:y+w*.1,y1:Math.max(y+w*.4,hv?(e.pose[23].y+e.pose[24].y)/2:y+w*1.2)}}}
  if(e.fb){const b=e.fb;return{x0:b.x-.5*b.w,x1:b.x+1.5*b.w,y0:b.y+1.4*b.h,y1:b.y+3*b.h}}return null}
function getApp(e,img){const r=torso(e);if(!r)return null;const W=320,H=180,d=img.data;
  const x0=Math.max(0,r.x0*W|0),x1=Math.min(W,r.x1*W|0),y0=Math.max(0,r.y0*H|0),y1=Math.min(H,r.y1*H|0);
  const hist=new Array(12).fill(0);let sv=0,vv=0,n=0;
  for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){const i=(y*W+x)*4,R=d[i],G=d[i+1],B=d[i+2],mx=Math.max(R,G,B),mn=Math.min(R,G,B),s=mx?(mx-mn)/mx:0;let hu=0;
    if(mx!==mn){const dd=mx-mn;hu=mx===R?((G-B)/dd)%6:mx===G?(B-R)/dd+2:(R-G)/dd+4;hu=(hu*60+360)%360}
    hist[Math.floor(hu/30)%12]+=s;sv+=s;vv+=mx/255;n++}
  if(n<20)return null;const tot=hist.reduce((a,b)=>a+b,0)||1;return{h:hist.map(x=>+(x/tot).toFixed(3)),s:+(sv/n).toFixed(3),v:+(vv/n/img.lum).toFixed(3)}}
const c01=x=>Math.max(0,Math.min(1,x));
function sim(a,b){let hi=0;for(let i=0;i<12;i++)hi+=Math.min(a.h[i],b.h[i]);return .5*hi+.25*c01(1-2*Math.abs(a.s-b.s))+.25*c01(1-2*Math.abs(a.v-b.v))}
const appSim=(p,a)=>Math.max(0,...(p?.appearance||[]).map(s=>sim(a,s)));
function matchFace(d){let b=null,b2=null;
  for(const p of RECO){let m=9;for(const q of p.desc){const x=faceapi.euclideanDistance(d,q);if(x<m)m=x}
    if(!b||m<b.d){b2=b;b={p,d:m}}else if(!b2||m<b2.d)b2={p,d:m}}
  return b?{p:b.p,d:b.d,p2:b2&&b2.p,margin:b2?b2.d-b.d:1}:{}}

/* ================= камера: интерфейс ================= */
function buildCam(){
  camPage.innerHTML=`<div class="head"><h1>Камера</h1></div><div class="camgrid">
  <div class="stage"><video id="vid" autoplay muted playsinline></video><canvas id="ov"></canvas><div class="hud" id="hud" hidden></div><div class="msg" id="camMsg">Выберите занятие справа и нажмите «Старт».<br>Камера работает прямо в браузере: видео никуда не отправляется, на сервер уходят только события.</div></div>
  <aside class="side"><div class="card"><select id="clesson"></select><select id="ccam"></select>
    <div class="row" style="margin-top:0"><button class="btn pri big" id="cstart">Старт</button><button class="btn big" id="cstop" disabled>Пауза</button><button class="btn bad big" id="cfin" disabled>Завершить занятие</button></div><div class="row"><button class="btn" id="ctrain">Обучить камеру и комнату</button></div></div>
  <div class="card"><h2>Сейчас в кадре <small id="unk" style="color:var(--mute);font-weight:400"></small></h2><div class="live" id="live"><p class="empty">Камера выключена</p></div></div>
  <div class="card"><h2>Список группы</h2><div class="ros" id="roster"></div></div>
  <div class="card"><details><summary>Калибровка</summary><div class="form">
   <label>Наклон головы вниз = тетрадь/телефон<input type="number" step="0.01" id="k_pitchDown" value="${CFG.pitchDown}"></label>
   <label>Поворот в сторону = «отвернулся»<input type="number" step="0.05" id="k_yawAway" value="${CFG.yawAway}"></label>
   <label>Задержка смены состояния, сек<input type="number" step="1" id="k_hold" value="${CFG.hold}"></label>
   <div class="two"><label>Доска от, %<input type="number" id="k_zx0" value="${Math.round(CFG.zx0*100)}"></label><label>до, %<input type="number" id="k_zx1" value="${Math.round(CFG.zx1*100)}"></label></div>
   <label>Точность лиц<select id="k_inputSize">${[320,416,512,608].map(s=>`<option ${CFG.inputSize===s?'selected':''}>${s}`).join('')}</select></label>
   <label class="chk"><input type="checkbox" id="k_learn" ${CFG.learn?'checked':''}> Дообучать по ходу занятий</label></div></details></div></aside></div>`;
  CAM.video=$('#vid');CAM.ov=$('#ov');
  for(const k of['pitchDown','yawAway','hold','zx0','zx1','inputSize','learn'])$('#k_'+k).onchange=e=>{const el=e.target;CFG[k]=el.type==='checkbox'?el.checked:+el.value/(k.startsWith('zx')?100:1);localStorage.setItem('cfg',JSON.stringify(CFG))};
  $('#cstart').onclick=guard(startCam);$('#cstop').onclick=guard(()=>stopCam(false));$('#ctrain').onclick=guard(trainRoom);
  $('#cfin').onclick=guard(async()=>{if(confirm('Завершить занятие? Не пришедшие будут отмечены и получат штраф.'))await stopCam(true)});
}
function setRunUI(){$('#cstart').disabled=CAM.run;$('#cstop').disabled=!CAM.run;$('#cfin').disabled=!CAM.lesson;$('#clesson').disabled=CAM.run;$('#hud').hidden=!CAM.run}
async function camShow(){
  const ls=await api('/lessons?from='+new Date(Date.now()-2*864e5).toISOString());
  const sel=$('#clesson'),cur=CAM.run?CAM.lesson.id:(CAM.pick||sel.value);
  sel.innerHTML=ls.filter(l=>l.status!=='closed'||l.id===CAM.lesson?.id).map(l=>`<option value="${l.id}">${fd(l.starts_at)} · ${esc(l.title)} · ${esc(l.group_name)}</option>`).join('')||'<option value="">Нет открытых занятий — создайте в «Занятиях»</option>';
  if(cur)sel.value=cur;
  if(!CAM.run)try{const dv=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='videoinput');$('#ccam').innerHTML=dv.map((d,i)=>`<option value="${d.deviceId}">${esc(d.label||'Камера '+(i+1))}</option>`).join('')}catch{}
  setRunUI();
}
async function startCam(){
  const lid=$('#clesson').value;if(!lid)return toast('Выберите занятие',1);
  const msg=$('#camMsg');msg.hidden=false;msg.textContent='Загружаю модели распознавания (первый раз ~20 сек)…';
  await ensureFace();await ensureMP();
  RECO=(await api('/recognition')).map(p=>({...p,desc:(p.descriptors||[]).map(a=>new Float32Array(a))}));
  if(!RECO.length)toast('Нет обученных людей с согласием — сначала раздел «Люди»',1);
  CAM.roster=await api(`/lessons/${lid}/roster`);CAM.lesson=CAM.roster.lesson;RMAP={};
  try{ROOM=await api('/room-model?room='+encodeURIComponent(CAM.lesson.room||''))}catch{ROOM={samples:[]}}
  for(const p of CAM.roster.people)RMAP[p.id]=p;for(const p of RECO)RMAP[p.id]=Object.assign(RMAP[p.id]||{},p);
  CAM.seen={};for(const a of CAM.roster.attendance)if(a.status!=='absent')CAM.seen[a.person_id]=a;
  const dev=$('#ccam').value;
  const stream=await navigator.mediaDevices.getUserMedia({video:{deviceId:dev?{exact:dev}:undefined,width:{ideal:1280},height:{ideal:720}}});
  CAM.video.srcObject=stream;await CAM.video.play();msg.hidden=true;
  CAM.run=true;CAM.tracks=[];CAM.lost=[];CAM.fps=0;setRunUI();await api(`/lessons/${lid}/start`,{});loop();
}
async function stopCam(finish){
  CAM.run=false;const now=Date.now();CAM.tracks.forEach(t=>endSeg(t,Math.min(now,t.last+1000)));CAM.tracks=[];
  CAM.video.srcObject?.getTracks().forEach(t=>t.stop());CAM.video.srcObject=null;
  await flush();
  if(finish&&CAM.lesson){const r=await api(`/lessons/${CAM.lesson.id}/close`,{});toast('Занятие завершено. Не пришли: '+r.absent);CAM.lesson=null}
  CAM.ov.getContext('2d').clearRect(0,0,CAM.ov.width,CAM.ov.height);$('#camMsg').hidden=false;$('#camMsg').textContent='Камера остановлена';
  $('#live').innerHTML='<p class="empty">Камера выключена</p>';setRunUI();camShow();
}
window.addEventListener('beforeunload',e=>{if(CAM.run){e.preventDefault();e.returnValue=''}});

/* ================= камера: главный цикл ================= */
async function loop(){
  if(!CAM.run)return;const t0=performance.now();
  try{await step()}catch(e){console.error(e)}
  CAM.fps=.8*(CAM.fps||0)+.2*(1000/(performance.now()-t0));
  if(CAM.run)setTimeout(loop,Math.max(20,300-(performance.now()-t0)));
}
function region(e){
  if(e.pose){const p=e.pose.filter(q=>q.visibility>.3);if(p.length>3){const xs=p.map(q=>q.x),ys=p.map(q=>q.y);return{x0:Math.min(...xs)-.04,x1:Math.max(...xs)+.04,y0:Math.min(...ys)-.04,y1:Math.max(...ys)+.06}}}
  const b=e.fb;return{x0:b.x-b.w,x1:b.x+2*b.w,y0:b.y-.2*b.h,y1:b.y+4*b.h}}
async function step(){
  if(CAM.paused)return;const v=CAM.video,W=v.videoWidth,H=v.videoHeight;if(!W)return;const now=Date.now(),img=frameData(v);
  const faces=await faceapi.detectAllFaces(v,new faceapi.TinyFaceDetectorOptions({inputSize:CFG.inputSize,scoreThreshold:.4})).withFaceLandmarks().withFaceDescriptors();
  const poses=CAM.pose?CAM.pose.detectForVideo(v,performance.now()).landmarks:[];
  const dets=CAM.obj?CAM.obj.detectForVideo(v,performance.now()).detections:[];
  /* 1. сущности: лицо + тело */
  const ents=[];
  for(const f of faces){const b=f.detection.box;ents.push({face:f,box:{x:b.x,y:b.y,w:b.width,h:b.height},fb:{x:b.x/W,y:b.y/H,w:b.width/W,h:b.height/H},cx:(b.x+b.width/2)/W,cy:(b.y+b.height/2)/H})}
  for(const lm of poses){const n=lm[0];let best=null,bd=9;
    for(const e of ents){if(e.pose)continue;const d=Math.hypot(e.cx-n.x,e.cy-n.y),lim=Math.max(.06,e.fb.h*1.2);if(d<lim&&d<bd){bd=d;best=e}}
    if(best)best.pose=lm;else{const vis=lm.filter(q=>q.visibility>.3),xs=vis.map(q=>q.x),ys=vis.map(q=>q.y);if(vis.length<4)continue;
      ents.push({pose:lm,cx:n.x,cy:n.y,box:{x:Math.min(...xs)*W,y:Math.min(...ys)*H,w:(Math.max(...xs)-Math.min(...xs))*W,h:(Math.max(...ys)-Math.min(...ys))*H}})}}
  for(const e of ents)e.reg=region(e);
  /* 2. предметы (телефон, ноутбук, книга) -> ближайшему человеку */
  for(const d of dets){const bb=d.boundingBox,o={n:d.categories[0].categoryName,cx:(bb.originX+bb.width/2)/W,cy:(bb.originY+bb.height/2)/H};
    let best=null,bd=9;for(const e of ents){const r=e.reg,pad=['tv','laptop','keyboard'].includes(o.n)?.08:0;if(o.cx>r.x0-pad&&o.cx<r.x1+pad&&o.cy>r.y0-pad&&o.cy<r.y1+pad){const dd=Math.hypot(o.cx-e.cx,o.cy-e.cy);if(dd<bd){bd=dd;best=e}}}
    if(best)(best.objs||=[]).push(o)}
  /* 3. треки: кто есть кто */
  const used=new Set();
  for(const e of ents){let bt=null,bd=.12;for(const t of CAM.tracks){if(used.has(t))continue;const d=Math.hypot(t.cx-e.cx,t.cy-e.cy);if(d<bd){bd=d;bt=t}}
    if(!bt)bt=newTrack(e,img,now);used.add(bt);Object.assign(bt,{cx:e.cx,cy:e.cy,last:now,e});bt.n++;
    identify(bt,e,now);const st=classify(bt,e,W,H);if(st)setState(bt,st,now);
    if(now-bt.appT>3000){const a=getApp(e,img);if(a){bt.app=a;bt.appT=now}}}
  CAM.tracks=CAM.tracks.filter(t=>{if(now-t.last<8000)return true;endSeg(t,t.last);if(t.personId&&t.app)CAM.lost.push({personId:t.personId,cx:t.cx,cy:t.cy,app:t.app,t:now});return false});
  CAM.lost=CAM.lost.filter(l=>now-l.t<60000);
  draw(W,H);
  if(now-(CAM.ui||0)>1000){CAM.ui=now;renderLive();$('#hud').textContent=`${CAM.fps.toFixed(1)} к/с · людей: ${CAM.tracks.length}`}
}
function newTrack(e,img,now){
  const t={id:++CAM.tid,personId:null,votes:{},cx:e.cx,cy:e.cy,last:now,n:0,state:null,pb:.5,app:getApp(e,img),appT:now,lastLearn:now};
  if(t.app)for(const L of CAM.lost)if(Math.hypot(L.cx-e.cx,L.cy-e.cy)<.12&&sim(L.app,t.app)>.8&&!CAM.tracks.some(x=>x.personId===L.personId)){t.personId=L.personId;CAM.lost=CAM.lost.filter(x=>x!==L);break}
  CAM.tracks.push(t);return t}
function identify(t,e,now){
  if(!e.face||!RECO.length)return;const m=matchFace(e.face.descriptor);
  if(!m.p||m.d>CFG.thr)return;
  if(m.margin<.04){const a=t.app;if(!(a&&appSim(m.p,a)>.8&&appSim(m.p,a)>appSim(m.p2,a)))return}
  t.votes[m.p.id]=(t.votes[m.p.id]||0)+1;
  const top=Object.entries(t.votes).sort((a,b)=>b[1]-a[1])[0];
  if(top[1]>=2&&t.personId!==top[0]){
    const other=CAM.tracks.find(x=>x!==t&&x.personId===top[0]);
    if(other&&now-other.last<3000)return;
    if(other){endSeg(other,other.last);other.personId=null}
    endSeg(t,now);t.personId=top[0];onIdentified(t)}
  if(CFG.learn&&t.personId&&m.d<.4&&t.app&&now-t.lastLearn>180000){t.lastLearn=now;api(`/people/${t.personId}/samples`,{descriptors:[Array.from(e.face.descriptor)],appearance:[t.app]}).catch(()=>{})}
}
function onIdentified(t){
  const pid=t.personId;if(CAM.seen[pid])return;CAM.seen[pid]={status:'present'};
  api('/attendance/seen',{lesson_id:CAM.lesson.id,person_id:pid}).then(a=>{CAM.seen[pid]=a;toast(`${RMAP[pid]?.full_name}: ${a.status==='late'?'опоздал на '+a.late_minutes+' мин':'пришёл'}`,a.status==='late')}).catch(e=>{delete CAM.seen[pid];toast(e.message,1)})}

/* ---- обученная модель взгляда (k-NN по примерам, снятым в этой комнате) ---- */
function gazeLabel(yaw,pr,cx){
  const S=ROOM.samples;if(S.length<15)return null;
  const d=S.map(x=>({c:x.c,d:Math.hypot((x.y-yaw)*1.2,(x.p-pr)*2.5,(x.x-cx)*.5)})).sort((a,b)=>a.d-b.d).slice(0,7);
  if(d[0].d>.6)return null;const v={};d.forEach(x=>v[x.c]=(v[x.c]||0)+1/(x.d+.05));
  return Object.entries(v).sort((a,b)=>b[1]-a[1])[0][0]}
async function trainRoom(){
  if(!CAM.run)return toast('Сначала нажмите «Старт» и сядьте на место студента перед камерой',1);
  const steps=[['camera','Смотрите прямо в объектив камеры'],['board','Смотрите на доску / интерактивную панель'],['screen','Смотрите на свой монитор или ноутбук'],['notebook','Опустите взгляд на тетрадь или стол'],['away','Отвернитесь в сторону']];
  const m=modal(`<h3>Обучение камеры и комнаты</h3><p style="color:var(--mute)">Сядьте на рабочее место студента. Программа запомнит, как выглядит взгляд «в камеру», «на доску», «на монитор», «в тетрадь» и «в сторону» именно с этого места. Повторите на 2–3 разных местах (ближний ряд, дальний, у окна).</p><h2 id="tr_p" style="margin:14px 0">Образцов сейчас: ${ROOM.samples.length}</h2><div class="row"><button class="btn pri" id="tr_go">Начать (около 40 сек)</button><button class="btn bad" id="tr_clear">Стереть обучение</button></div>`);
  const room=CAM.lesson.room||'',save=()=>api('/room-model',{room,samples:ROOM.samples},'PUT');
  $('#tr_clear',m).onclick=guard(async()=>{if(!confirm('Стереть всё обучение этой комнаты?'))return;ROOM.samples=[];await save();$('#tr_p',m).textContent='Образцов сейчас: 0'});
  $('#tr_go',m).onclick=guard(async()=>{
    $('#tr_go',m).disabled=true;CAM.paused=true;const add=[];
    try{for(const [c,txt] of steps){
      for(let i=3;i>0&&document.body.contains(m);i--){$('#tr_p',m).textContent=`${txt} — через ${i}`;await new Promise(r=>setTimeout(r,1000))}
      const t1=Date.now();let n=0;$('#tr_p',m).textContent=txt+' — держите взгляд';
      while(Date.now()-t1<4500&&document.body.contains(m)){
        const r=await faceapi.detectSingleFace(CAM.video,new faceapi.TinyFaceDetectorOptions({inputSize:CFG.inputSize,scoreThreshold:.4})).withFaceLandmarks();
        if(r){const p=r.landmarks.positions,b=r.detection.box,eL={x:(p[36].x+p[39].x)/2,y:(p[36].y+p[39].y)/2},eR={x:(p[42].x+p[45].x)/2,y:(p[42].y+p[45].y)/2},mx=(eL.x+eR.x)/2,my=(eL.y+eR.y)/2,ed=Math.hypot(eR.x-eL.x,eR.y-eL.y)||1;
          add.push({c,y:+((p[30].x-mx)/ed).toFixed(3),p:+((p[30].y-my)/Math.max(1,p[8].y-my)).toFixed(3),x:+((b.x+b.width/2)/CAM.video.videoWidth).toFixed(3)});n++}
        await new Promise(r=>setTimeout(r,200))}
      if(n<4){toast('Лицо плохо видно на шаге «'+txt+'». Повторите.',1)}}
      ROOM.samples=[...ROOM.samples,...add].slice(-600);await save();toast('Обучено: добавлено образцов '+add.length+', всего '+ROOM.samples.length);m.close()}
    finally{CAM.paused=false}})}
/* ---- что делает человек: поза головы + тело + предметы ---- */
function classify(t,e,W,H){
  const f=e.face,lm=e.pose,o=e.objs||[];let yaw=0,delta=0,pr=0,g=null;
  if(f){const p=f.landmarks.positions,eL={x:(p[36].x+p[39].x)/2,y:(p[36].y+p[39].y)/2},eR={x:(p[42].x+p[45].x)/2,y:(p[42].y+p[45].y)/2};
    const mx=(eL.x+eR.x)/2,my=(eL.y+eR.y)/2,ed=Math.hypot(eR.x-eL.x,eR.y-eL.y)||1;
    yaw=(p[30].x-mx)/ed;pr=(p[30].y-my)/Math.max(1,p[8].y-my);delta=pr-t.pb}
  const has=n=>o.some(x=>x.n===n),phone=o.find(x=>x.n==='cell phone');
  let angle=0,drop=9,rise=0,knees=false,wrist=false;
  if(lm){const L=lm[11],R=lm[12];
    if(L.visibility>.4&&R.visibility>.4){const sx=(L.x+R.x)/2,sy=(L.y+R.y)/2,sw=Math.max(8,Math.hypot((L.x-R.x)*W,(L.y-R.y)*H));
      if(lm[23].visibility>.4&&lm[24].visibility>.4)angle=Math.atan2(Math.abs((lm[23].x+lm[24].x)/2-sx)*W,((lm[23].y+lm[24].y)/2-sy)*H)*57.3;
      if(lm[0].visibility>.3)drop=(sy-lm[0].y)*H/sw;
      if(t.sy0==null){t.sy0=sy;t.sw0=sw}else rise=(t.sy0-sy)*H/t.sw0;t.geo={sy,sw}}
    knees=lm[25].visibility>.5||lm[26].visibility>.5;
    if(phone)wrist=[15,16].some(i=>lm[i].visibility>.4&&Math.hypot(lm[i].x-phone.cx,lm[i].y-phone.cy)<.08)}
  const standing=rise>.8||(RMAP[t.personId]?.role==='teacher'&&knees);let s=null;
  if(angle>60||drop<.1||(f&&delta>.28))s='lying';
  else if(phone&&(delta>.06||wrist||!f))s='phone';
  else if(standing)s=(t.cx>CFG.zx0&&t.cx<CFG.zx1)?'board':'standing';
  else if(f&&(g=gazeLabel(yaw,pr,t.cx)))s=g==='board'?'front':g;
  else if(f&&Math.abs(yaw)>CFG.yawAway)s='away';
  else if(f?delta>CFG.pitchDown:drop<.45)s='notebook';
  else if(has('laptop')||has('tv'))s=(!f||delta>-.08)?'screen':'front';
  else if(f||lm)s='front';
  if(s==='front'&&f&&Math.abs(yaw)<.25)t.pb+=.03*delta;
  if(t.geo&&s&&!['standing','board','lying'].includes(s)){t.sy0+=.02*(t.geo.sy-t.sy0);t.sw0+=.02*(t.geo.sw-t.sw0)}
  return s}
function setState(t,raw,now){
  if(!t.state){t.state=raw;t.since=now}
  else if(raw!==t.state){
    if(t.cand!==raw){t.cand=raw;t.cs=now}
    else if(now-t.cs>=CFG.hold*1000){endSeg(t,t.cs);t.state=raw;t.since=t.cs;t.cand=null}}
  else t.cand=null;
  if(t.personId&&!t.seg)t.seg={state:t.state,start:t.since}}
function endSeg(t,end){const s=t.seg;t.seg=null;
  if(s&&t.personId&&end-s.start>=2000)CAM.buf.push({person_id:t.personId,state:s.state,started_at:new Date(s.start).toISOString(),ended_at:new Date(end).toISOString()})}
async function flush(){
  if(!CAM.buf.length||!CAM.lesson)return;const segs=CAM.buf.splice(0);
  try{await api('/activity',{lesson_id:CAM.lesson.id,segments:segs})}catch(e){CAM.buf.unshift(...segs);toast('Не удалось сохранить события: '+e.message,1)}}
setInterval(()=>{if(CAM.run)flush()},10000);

/* ---- рисование и список ---- */
function draw(W,H){
  const c=CAM.ov;if(c.width!==W){c.width=W;c.height=H}const x=c.getContext('2d');x.clearRect(0,0,W,H);
  x.strokeStyle='#ffffff88';x.setLineDash([10,8]);x.lineWidth=2;x.strokeRect(CFG.zx0*W,4,(CFG.zx1-CFG.zx0)*W,H-8);x.setLineDash([]);
  const fs=Math.max(14,W/70);x.font=`600 ${fs}px Onest,sans-serif`;x.fillStyle='#ffffffaa';x.fillText('зона доски',CFG.zx0*W+8,fs+8);
  for(const t of CAM.tracks){if(!t.e||Date.now()-t.last>1500)continue;const b=t.e.box,col=t.personId?(ST[t.state]||[0,'#fff'])[1]:'#94a3b8';
    x.strokeStyle=col;x.lineWidth=3;x.strokeRect(b.x,b.y,b.w,b.h);
    const label=(t.personId?(RMAP[t.personId]?.full_name||'').split(' ').slice(0,2).join(' '):'Не опознан')+' · '+(t.state?sl(t.state):'…'),tw=x.measureText(label).width+14;
    x.fillStyle=col;x.fillRect(b.x,Math.max(0,b.y-fs-10),tw,fs+10);x.fillStyle='#fff';x.fillText(label,b.x+7,Math.max(fs+2,b.y-8))}}
function renderLive(){
  const ids=CAM.tracks.filter(t=>t.personId&&Date.now()-t.last<3000).sort((a,b)=>(RMAP[a.personId]?.full_name||'').localeCompare(RMAP[b.personId]?.full_name||''));
  $('#live').innerHTML=ids.map(t=>{const [l,c]=ST[t.state]||['…','#999'];return `<div class="pl"><i style="background:${c}"></i><div>${esc(RMAP[t.personId]?.full_name)}<small>${CAM.seen[t.personId]?.status==='late'?'опоздал · ':''}${Math.round((Date.now()-t.since)/1000)} с в этом состоянии</small></div><span class="chip" style="color:${c}">${l}</span></div>`}).join('')||'<p class="empty">Пока никого не узнал</p>';
  const unk=CAM.tracks.filter(t=>!t.personId&&Date.now()-t.last<3000).length;$('#unk').textContent=unk?`· не опознано: ${unk}`:'';
  $('#roster').innerHTML=(CAM.roster?.people||[]).map(p=>{const s=CAM.seen[p.id];return `<span class="${s?(s.status==='late'?'late':'ok'):''}">${esc(p.full_name.split(' ').slice(0,2).join(' '))}</span>`}).join('')}

/* ================= обучение: по камере и по фото ================= */
async function trainModal(p){
  if(!p.consent)return toast('Сначала отметьте согласие на биометрию: кнопка «Изменить»',1);
  let stream;const m=modal(`<h3>Обучение: ${esc(p.full_name)}</h3><video id="tv" autoplay muted playsinline></video><p id="tm" style="color:var(--mute)">Загружаю модели…</p><div class="row"><button class="btn pri" id="tg" disabled>Начать (около 15 сек)</button></div>`);
  m.onclose=()=>stream?.getTracks().forEach(t=>t.stop());
  await ensureFace();stream=await navigator.mediaDevices.getUserMedia({video:{width:1280,height:720}});
  if(!document.body.contains(m))return stream.getTracks().forEach(t=>t.stop());
  const v=$('#tv',m);v.srcObject=stream;await v.play();$('#tm',m).textContent='Лицо и плечи должны быть в кадре. Нажмите «Начать».';$('#tg',m).disabled=false;
  $('#tg',m).onclick=guard(async()=>{
    $('#tg',m).disabled=true;const prompts=['Смотрите прямо','Чуть поверните голову влево','Чуть вправо','Чуть наклоните голову вниз','Улыбнитесь','Смотрите прямо'],desc=[],app=[];
    for(let i=0;i<18&&document.body.contains(m);i++){
      $('#tm',m).textContent=`${prompts[Math.floor(i/3)]} (${i+1}/18)`;
      const r=await faceapi.detectSingleFace(v,new faceapi.TinyFaceDetectorOptions({inputSize:416,scoreThreshold:.5})).withFaceLandmarks().withFaceDescriptor();
      if(r){desc.push(Array.from(r.descriptor));if(i%3===0){const b=r.detection.box,W=v.videoWidth,H=v.videoHeight,a=getApp({fb:{x:b.x/W,y:b.y/H,w:b.width/W,h:b.height/H}},frameData(v));if(a)app.push(a)}}
      await new Promise(res=>setTimeout(res,800))}
    if(desc.length<6){$('#tg',m).disabled=false;return toast('Лицо видно плохо. Добавьте света и повторите.',1)}
    await api(`/people/${p.id}/samples`,{descriptors:desc,appearance:app});toast(`Обучено: ${desc.length} образцов лица, ${app.length} образцов одежды`);m.close();pPeople()})}
function photoEnroll(p){
  if(!p.consent)return toast('Сначала отметьте согласие на биометрию: кнопка «Изменить»',1);
  const inp=Object.assign(document.createElement('input'),{type:'file',accept:'image/*',multiple:true});
  inp.onchange=guard(async()=>{toast('Обрабатываю фото…');await ensureFace();const desc=[];
    for(const f of inp.files){const im=await new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=rej;i.src=URL.createObjectURL(f)});
      const r=await faceapi.detectSingleFace(im,new faceapi.TinyFaceDetectorOptions({inputSize:608,scoreThreshold:.3})).withFaceLandmarks().withFaceDescriptor();if(r)desc.push(Array.from(r.descriptor))}
    if(!desc.length)return toast('На фото не найдено лицо',1);await api(`/people/${p.id}/samples`,{descriptors:desc});toast('Добавлено образцов: '+desc.length);pPeople()});
  inp.click()}

boot();
