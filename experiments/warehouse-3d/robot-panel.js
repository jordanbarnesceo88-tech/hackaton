/* global createRobotDetailViewer, createRobotWorkHistory */
(function () {
  'use strict';
  const phases = { incidentStop:'Остановлен: инцидент',trafficWait:'Уступает дорогу',idle:'Ожидание задания',toPickup:'К погрузке',loading:'Погрузка',toDrop:'Перевозка',unloading:'Выгрузка',waitPoint:'Очередь к точке',toCharger:'К зарядке',waitCharger:'Очередь к зарядке',charging:'Зарядка',transit:'Переход к секции',working:'Уборка секции',toDock:'На базу',waitingDock:'Очередь на базе',parking:'На парковку',done:'Работа завершена' };
  const tones = {incidentStop:'#a74031',trafficWait:'#aa5847',idle:'#697b80',toPickup:'#467b96',loading:'#ac7327',toDrop:'#176d73',unloading:'#975b32',waitPoint:'#aa5847',toCharger:'#7c6990',waitCharger:'#aa5847',charging:'#7b6132',transit:'#467b96',working:'#26735d',toDock:'#7c6990',waitingDock:'#aa5847',parking:'#697b80',done:'#697b80'};
  const time = s => [Math.floor(s/3600),Math.floor(s%3600/60),Math.floor(s%60)].map(v=>String(v).padStart(2,'0')).join(':');
  const num = (v,d=1) => Number.isFinite(v) ? v.toLocaleString('ru-RU',{maximumFractionDigits:d}) : '—';
  const node = (tag,cls,value) => { const el=document.createElement(tag); if(cls)el.className=cls;if(value!=null)el.textContent=value;return el; };
  function facts(host, rows) { host.replaceChildren(...rows.map(([k,v])=>{const wrap=node('div');wrap.append(node('dt','',k),node('dd','',v));return wrap;})); }
  window.createRobotInspection = function ({Core,onSeek,onSelectRobot}) {
    const dialog=node('dialog','robot-dialog'); dialog.id='robot-dialog';dialog.setAttribute('aria-labelledby','rd-title');
    dialog.innerHTML=`<header class="rd-header"><div><h2 id="rd-title">Робот</h2><p id="rd-subtitle"></p></div><button id="rd-close" aria-label="Закрыть окно робота" autofocus>×</button></header>
      <div class="rd-layout"><div class="rd-machine"><div id="rd-canvas" class="rd-canvas" aria-label="Подробная 3D-модель робота. Перетаскивайте для вращения, колесо для масштаба"></div><div class="rd-tools"><button id="rd-assembled" aria-pressed="true">В сборе</button><button id="rd-exploded" aria-pressed="false">Показать узлы</button><button id="rd-reset">Сбросить вид</button></div><details id="rd-construction" class="rd-construction"><summary>Узлы и устройство робота</summary><div class="rd-part"><h3 id="rd-part-name">Устройство робота</h3><p id="rd-part-description">Выберите узел на модели или под ней.</p><p id="rd-part-source" class="note"></p></div><nav id="rd-parts" class="rd-parts" aria-label="Узлы робота"></nav></details></div>
      <div class="rd-info"><section><h3>В выбранный момент · <span id="rd-clock"></span></h3><p id="rd-state" class="rd-live-state"></p><div class="rd-reading"><div><b id="rd-soc"></b><span>заряд батареи</span></div><div><b id="rd-speed"></b><span>скорость, м/с</span></div><div><b id="rd-done"></b><span id="rd-done-label"></span></div></div><dl id="rd-live" class="fact-list"></dl></section><section><h3>Работа к выбранному моменту</h3><dl id="rd-summary" class="fact-list"></dl></section><section><h3>Характеристики визуального референса</h3><img id="rd-reference-photo" class="rd-source-photo" alt="Фото робота с сайта производителя"><dl id="rd-passport" class="fact-list"></dl><p id="rd-reference-note" class="note"></p><p class="note"><a id="rd-source" target="_blank" rel="noopener noreferrer">Страница производителя ↗</a></p></section><p class="note">Телеметрия рассчитана симуляцией. Датчики и внутренние узлы не являются измерениями с оборудования.</p></div></div>
      <section class="rd-history"><div class="rd-history-heading"><h3>Работа робота во времени</h3><span id="rd-history-status" class="note"></span></div><div class="rd-timeline"><button id="rd-back" aria-label="На минуту назад">−1 мин</button><input id="rd-time" type="range" min="0" max="1" value="0" aria-label="Момент работы робота"><output id="rd-time-value"></output><button id="rd-forward" aria-label="На минуту вперёд">+1 мин</button></div><div class="work-scroll"><div id="rd-history-track"></div></div><p id="rd-history-caption" class="work-caption"></p></section>`;
    document.body.append(dialog);
    const $=id=>document.getElementById(id);
    const main=node('section','work-history');main.id='work-history';main.setAttribute('aria-label','Ретроспектива работы парка');
    main.innerHTML='<div class="rd-history-heading"><h3>Работа парка во времени</h3><label>Масштаб <select id="work-zoom"><option value="1">Вся смена</option><option value="2">×2</option><option value="4">×4</option><option value="8">×8</option></select></label></div><p>Верхняя полоса — задания и секции, нижняя — состояния. Наведите для сводки; нажмите или протяните по дорожке, чтобы разобрать выбранный момент. Светлая часть — ещё не проигранный прогноз модели.</p><div id="work-legend" class="work-legend"></div><p id="work-status" class="note" role="status">История появится после расчёта.</p><div class="work-scroll"><div id="work-lanes"></div></div><p id="work-caption" class="work-caption">Выберите участок работы на ленте.</p>';
    document.querySelector('.telemetry-dock').before(main);
    function renderWorkLegend(isCleaning){
      const entries=isCleaning?[['Уборка','#26735d'],['Переезд','#467b96'],['Возврат на базу','#7c6990'],['Ожидание','#aa5847'],['Зарядка','#7b6132']]:[[rack()?'Перевозка стеллажа':'Перевозка','#176d73'],[rack()?'Подъезд / заезд под стеллаж':'Подъезд к грузу','#467b96'],[rack()?'Контакт / подъём / опускание / выезд':'Погрузка / выгрузка','#ac7327'],['Ожидание','#aa5847'],['Зарядка','#7b6132']];
      $('work-legend').replaceChildren(...entries.map(([label,tone])=>{const el=node('span','',label);el.style.setProperty('--tone',tone);return el;}));
    }
    let model=null,caseId=null,frame=null,detail=null,selected=null,history=null,abort=null,focusBack=null,zoom=1;
    let requestGeneration=0, scrubbing=false;
    const segmentAccessibility = new Map();
    const cleaning=()=>model?.kind==='cleaning';
    const carrier=()=>Core.carrierSpec(model?.input);
    const rack=()=>!cleaning()&&carrier().kind==='mobile-rack';
    const liftStages={approach:'Подъезд к носителю','dock-under':'Заезд под стеллаж','close-gap':'Подвод платформы до контакта',lift:'Подъём стеллажа',extract:'Извлечение стеллажа из ряда',retreat:'Безопасный отход задним ходом',carry:'Перевозка стеллажа',lower:'Опускание на опоры',retract:'Опускание платформы',exit:'Выезд из-под стеллажа'};
    const phaseLabel=(phase,stage)=>(!['incidentStop','trafficWait','parking'].includes(phase)&&liftStages[stage])||liftStages[phase]||phases[phase]||phase;
    const taskKind=t=>t.operation==='return-pod'?'Возврат носителя':t.operation==='prefetch-pod'?'Подача носителя':t.kind==='internal'?'Хранение → хранение':['inbound','putaway'].includes(t.kind)?'Размещение':'Отбор';
    const taskScope=t=>t.countsTowardDemand===false||t.id<0?'Внутренний рейс':'Заявка';
    const carrierContext=s=>rack()&&s.taskId!=null?`Стеллаж ${s.carrierId||'—'} · ${num(carrier().lengthM,2)} × ${num(carrier().widthM,2)} × ${num(carrier().heightM,2)} м · ${carrier().levels} полки · ${s.carrierContents === 'empty' ? 'пустой' : 'с грузом'}`:'';
    const name=id=>`${cleaning()?'CL':'AMR'}-${String(id+1).padStart(2,'0')}`;
    const rowFor=id=>history?.robots.find(r=>r.robotId===id);
    const point=p=>p?`${num(p.x)} / ${num(p.y)} м`:'—';
    function setPart(part){
      $('rd-construction').open=true;
      $('rd-part-name').textContent=part.name;
      $('rd-part-description').textContent=part.description;
      $('rd-part-source').textContent=typeof part.source==='string'?part.source:part.source?.label||'Визуальная реконструкция по внешнему виду';
      for(const b of $('rd-parts').children)b.setAttribute('aria-pressed',String(b.dataset.part===part.id));
    }
    function passport(){
      $('rd-source').href=cleaning()?'https://www.pudurobotics.com/en/products/puducc1':'https://ronavi-robotics.ru/catalogue/h1500';
      const photos=window.RobotReferencePhotos;
      $('rd-reference-photo').hidden=!photos;
      if(photos)$('rd-reference-photo').src=cleaning()?photos.cleaning:photos.warehouse;
      facts($('rd-passport'),cleaning()?[['Модель','PUDU CC1'],['Габариты старой версии','663 × 568 × 682 мм'],['Режимы','Мытьё, подметание, пылесос, протирка'],['Баки: чистый / грязный','15 / 15 л'],['Скорость, паспорт','До 1,2 м/с'],['Производительность, паспорт','700–1000 м²/ч']]:[['Модель','Ronavi H1500'],['Габариты, актуальный каталог','1044 × 654 × 380 мм'],['Грузоподъёмность','До 1500 кг'],['Масса','250 кг'],['Скорость, паспорт','До 1,5 м/с'],['Навигация','QR-метки и SLAM']]);
      $('rd-reference-note').textContent=cleaning()?'Внешняя реконструкция CC1. Габариты — официальная кампания 2023 года; текущие паспортные данные — страница производителя. Параметры условного робота симуляции заданы отдельно: рабочий след не равен паспортной ширине CC1.':'Внешняя реконструкция H1500 по фото. Швы, крепёж и расположение скрытых узлов условны. Текущий каталог производителя и параметры набора организатора показаны раздельно.';
    }
    function updateRobot(){
      if(!dialog.open||selected===null||!frame)return;
      const r=frame.robots.find(r=>r.id===selected);if(!r)return;
      $('rd-title').textContent=`${name(r.id)} · референс ${cleaning()?'PUDU CC1':'Ronavi H1500'}`;
      $('rd-subtitle').textContent=rack()?'Полный цикл носителя в модели · размеры и контактная механика — допущения':'Отдельная модель · внешняя реконструкция по материалам производителя';
      $('rd-clock').textContent=time(frame.tS);$('rd-state').textContent=r.operationalState==='incidentStop'?`Остановлен · ${r.incident?.label||'инцидент'}`:r.incident?`${phaseLabel(r.phase,r.underlift?.stage)} · ${r.incident.label}`:r.safety?.blocked?'Уступает дорогу':phaseLabel(r.phase,r.underlift?.stage);
      $('rd-soc').textContent=`${num(r.soc*100)}%`;$('rd-speed').textContent=num(r.vMps,2);
      $('rd-done').textContent=cleaning()?num(r.cleanedM2):String(r.customerTasksDone??r.tasksDone??0);$('rd-done-label').textContent=cleaning()?'убрано, м²':'клиентских заявок выполнено';
      const zone=frame.sections?.find(s=>s.id===r.zoneId);
      const safety=r.safety;
      const awaitingAdmission=r.phase==='idle'&&frame.queue>0&&frame.safety?.maxActiveRoutes&&frame.safety.activeRoutes>=frame.safety.maxActiveRoutes;
      facts($('rd-live'),[['Задание',zone?.label||(r.task?`${taskScope(r.task)} #${r.task.id} · ${taskKind(r.task)}${r.task.parentTaskId==null?'':` · для #${r.task.parentTaskId}`}`:'Без задания')],['Положение X / Y',point(r)],['Целевая точка',point(r.target)],['Остаток пути',`${num(r.remainingDistM)} м`],['Ожидание',safety?.reason||r.waitReason||(awaitingAdmission?`Допуск на маршрут · лимит ${frame.safety.maxActiveRoutes}`:'Нет')],...(safety?[['Уступает роботу',safety.blockedBy==null?'—':safety.blockedBy<0?'Стеллаж · препятствие':name(safety.blockedBy)],['До соседнего корпуса',`${num(safety.nearestClearanceM,2)} м`],['Заданный зазор',`${num(safety.requiredClearanceM,2)} м`],['Ожидание трафика',`${num(safety.totalWaitS,0)} с`],['Перестроений маршрута',String(safety.replans)]]:[]),...(cleaning()?[['Инструмент',r.working?'Работает':'Выключен'],['Рабочая ширина в модели',`${num(model.input.robots.brushWidthM,2)} м`],['Манёвр',r.maneuver==='turning'?'Поворот на месте':r.maneuver==='moving'?'Движение':'Стоянка']]:[['Груз',r.loaded?rack()?r.carrierContents==='empty'?'Пустой стеллаж на платформе':'Стеллаж с грузом на платформе':'Паллета на платформе':'Без груза'],['Обработка',r.handlingProgress==null?'—':`${num(r.handlingProgress*100,0)}%`],['Скорость в расчёте',`${num(model.input.robots.speedMps,2)} м/с`]])]);
      if(rack()){const extra=node('dl'),spec=carrier(),lift=r.underlift,id=r.carrierId||r.task?.carrierId||lift?.podId,pod=frame.carriers?.find(c=>c.id===id);facts(extra,[['Идентификатор носителя',id||'Не назначен'],['Содержимое носителя',(r.carrierContents??pod?.contents)==='empty'?'Пустой — груз разгружен':id?'С грузом':'Носитель не назначен'],['Габариты Д × Ш × В',`${num(spec.lengthM,2)} × ${num(spec.widthM,2)} × ${num(spec.heightM,2)} м`],['Ярусы',String(spec.levels)],['Просвет / отрыв опор',`${num(spec.baseClearanceM,2)} / ${num(spec.liftHeightM,2)} м`],...(pod?[['Домашнее место',point(pod.home)],['Назначен роботу',pod.robotId==null?'Не назначен':name(pod.robotId)]]:[]),...(lift?[['Этап механики',liftStages[lift.stage]||lift.stage],['Верх платформы от пола',`${num(lift.platformTopM,3)} м`],['Опоры над полом',`${num(lift.podLiftM,3)} м`],['Зазор до платформы',`${num(lift.contactGapM,3)} м`],['Контакт',lift.contact?'Есть':'Нет']]:[]),['Внутренних рейсов выполнено',String(r.internalTasksDone??0)],['Источник параметров',spec.sourceNote]]);$('rd-live').append(...extra.children);}
      const spans=rowFor(r.id)?.intervals||[];
      if(r.incident){const extra=node('dl');facts(extra,[['Сигнал',`${r.incident.code} · ${r.incident.label}`],['Диагностика',r.incident.status],['Место сигнала',`${num(r.incident.x)} / ${num(r.incident.y)} м${r.incident.code==='LINK_LOST'?' · последняя известная точка':''}`],['Задание при отказе',r.incident.taskHandling||'Сохранено в модели']]);$('rd-live').append(...extra.children);}
      const duration=phase=>spans.filter(s=>phase.includes(s.phase)).reduce((sum,s)=>sum+Math.max(0,Math.min(frame.tS,s.endS)-s.startS),0);
      const durationText=phase=>history?time(duration(phase)):r.timeByPhase?time(phase.reduce((sum,p)=>sum+(r.timeByPhase[p]||0),0)):'Восстанавливаем…';
      facts($('rd-summary'),[['Пробег',`${num(r.distanceM)} м`],['Работа / перевозка',durationText(['working','loading','toDrop','unloading'])],['Простой по инцидентам',durationText(['incidentStop'])],['Ожидание',durationText(['idle','waitPoint','waitCharger','waitingDock','trafficWait'])],['Зарядка',durationText(['charging'])],['Источник кадра',`${time(frame.provenance?.observedAtS??frame.tS)} · имитация`]]);
      $('rd-time').max=history?.endS||model.summary.elapsedS||frame.endS||1;$('rd-time').step=cleaning()?'.1':'1';if(!scrubbing){$('rd-time').value=frame.tS;$('rd-time-value').textContent=time(frame.tS);}
      detail?.setFrame(r);updateCursors();
      const active=spans.find(s=>s.startS<=frame.tS&&s.endS>frame.tS)||spans.at(-1);
      if(active)caption($('rd-history-caption'),active);
    }
    function caption(host,s){host.replaceChildren(node('strong','',`${time(s.startS)} — ${time(s.endS)} · ${s.isTask?s.countsTowardDemand===false?'Внутренний рейс':'Заявка':phaseLabel(s.phase,s.underliftStage)}`),document.createTextNode(` · ${s.label} · ${num(s.endS-s.startS,1)} с${s.loaded&&!s.isTask?rack()?' · носитель поднят':' · с грузом':''}${s.reason&&!s.isTask?' · '+s.reason:''}${carrierContext(s)?' · '+carrierContext(s):''}`));}
    function segment(s,host,status){const b=node('button','work-segment',status?'':s.label);b.type='button';b.style.left=`${100*s.startS/history.endS}%`;b.style.width=`${100*(s.endS-s.startS)/history.endS}%`;b.style.setProperty('--tone',tones[s.phase]||'#697b80');b.dataset.start=s.startS;b.dataset.end=s.endS;b.dataset.phase=s.phase;
      b.title=`${time(s.startS)} — ${time(s.endS)} · ${phaseLabel(s.phase,s.underliftStage)} · ${s.label} · ${num(s.endS-s.startS,1)} с${s.reason?' · '+s.reason:''}${carrierContext(s)?' · '+carrierContext(s):''}`;b.setAttribute('aria-label',b.title);b.addEventListener('pointerenter',()=>caption(host,s));b.addEventListener('focus',()=>caption(host,s));b.addEventListener('click',e=>{e.stopPropagation();caption(host,s);onSeek(s.startS);});return b;}
    function drawRows(target,rows,modal=false){
      target.replaceChildren();segmentAccessibility.delete(target);if(!history)return;
      target.style.width=modal?'100%':`${zoom*100}%`;
      if(!modal){const axis=node('div','work-axis'),ticks=node('div','work-ticks');axis.append(node('span','','Время модели'),ticks);for(let i=0;i<=6;i++){const t=node('span','',time(history.endS*i/6));t.style.left=`${i*100/6}%`;ticks.append(t);}target.append(axis);}
      const captionHost=$(modal?'rd-history-caption':'work-caption');
      for(const row of rows){const line=node('div','work-row'),label=node('button','work-name',name(row.robotId)),tracks=node('div','work-tracks');line.dataset.robot=row.robotId;label.append(node('small','','Задания / состояние'));label.addEventListener('click',()=>onSelectRobot(row.robotId));line.append(label,tracks);
        const tasks=node('div','work-task-lane'),states=node('div','work-state-lane');tracks.append(tasks,states);
        // Coalesce task bars separately: state changes remain visible in the lower lane.
        const grouped=[];for(const s of row.intervals){const last=grouped.at(-1);if(last&&last.taskId===s.taskId&&last.zoneId===s.zoneId&&last.label===s.label)last.endS=s.endS;else grouped.push({...s,isTask:true});}
        for(const s of grouped)if(s.taskId!==null||s.zoneId!==null){const b=segment(s,captionHost,false);b.title=`${time(s.startS)} — ${time(s.endS)} · ${s.label}${carrierContext(s)?' · '+carrierContext(s):''}`;b.setAttribute('aria-label',b.title);tasks.append(b);}
        for(const s of row.intervals)states.append(segment(s,captionHost,true));
        tracks.append(node('div','work-future'),node('div','work-cursor'));tracks.tabIndex=0;tracks.setAttribute('role','slider');tracks.setAttribute('aria-label',`Момент работы ${name(row.robotId)}`);tracks.setAttribute('aria-valuemin','0');tracks.setAttribute('aria-valuemax',String(history.endS));
        let dragging=false,dragTime=0;
        const at=e=>{const rect=tracks.getBoundingClientRect();return Math.max(0,Math.min(history.endS,(e.clientX-rect.left)/rect.width*history.endS));};
        tracks.addEventListener('pointerdown',e=>{if(e.target.closest('button'))return;dragging=true;dragTime=at(e);tracks.setPointerCapture(e.pointerId);});
        tracks.addEventListener('pointermove',e=>{const s=row.intervals.find(s=>s.startS<=at(e)&&s.endS>=at(e));if(s)caption(captionHost,s);if(dragging){dragTime=at(e);captionHost.textContent=`Перейти к ${time(dragTime)}`;}});
        tracks.addEventListener('pointerup',()=>{if(dragging){dragging=false;onSeek(dragTime);}});
        tracks.addEventListener('pointercancel',()=>{dragging=false;});
        tracks.addEventListener('keydown',e=>{let t=frame?.tS||0;if(e.key==='ArrowLeft')t-=e.shiftKey?300:60;else if(e.key==='ArrowRight')t+=e.shiftKey?300:60;else if(e.key==='Home')t=0;else if(e.key==='End')t=history.endS;else return;e.preventDefault();onSeek(t);});
        target.append(line);
      }
      segmentAccessibility.set(target, { observed: null, nextBoundary: -Infinity, entries: [...target.querySelectorAll('.work-segment')].map(button => ({ button, start: Number(button.dataset.start), end: Number(button.dataset.end), description: button.title, kind: null })) });
      updateCursors();
    }
    function updateSegmentNames(){
      const observed=frame.provenance?.observedAtS??frame.tS;
      for(const collection of segmentAccessibility.values()){
        if(observed===collection.observed||(observed>collection.observed&&observed<collection.nextBoundary))continue;
        collection.observed=observed;collection.nextBoundary=Infinity;
        for(const entry of collection.entries){
          const kind=entry.start>=observed?'future':entry.end>observed?'mixed':'model';
          if(entry.kind!==kind){
            entry.kind=kind;
            const prefix=kind==='future'?'Прогноз модели':kind==='mixed'?'Модельный прогон до текущего кадра, далее прогноз':'Модельный прогон';
            entry.button.title=`${prefix} · ${entry.description}`;entry.button.setAttribute('aria-label',entry.button.title);
          }
          if(entry.start>=observed)collection.nextBoundary=Math.min(collection.nextBoundary,entry.start);
          else if(entry.end>observed)collection.nextBoundary=Math.min(collection.nextBoundary,entry.end);
        }
      }
    }
    function updateCursors(){if(!history||!frame)return;const pct=Math.max(0,Math.min(100,frame.tS/history.endS*100));for(const host of [main,dialog]){host.querySelectorAll('.work-cursor').forEach(el=>{el.style.left=`${pct}%`;});host.querySelectorAll('.work-future').forEach(el=>{el.style.width=`${100-pct}%`;});host.querySelectorAll('.work-tracks').forEach(el=>{el.setAttribute('aria-valuenow',String(frame.tS));el.setAttribute('aria-valuetext',time(frame.tS));});}updateSegmentNames();}
    function drawModalHistory(){if(selected!==null&&history){drawRows($('rd-history-track'),[rowFor(selected)].filter(Boolean),true);$('rd-history-status').textContent='Нажмите на задание или состояние';}else{$('rd-history-track').replaceChildren();$('rd-history-caption').textContent='';$('rd-history-status').textContent='Восстанавливаем историю…';}}
    async function setModel(next,id){
      abort?.abort();abort=new AbortController();const generation=++requestGeneration;model=next;caseId=id;history=null;frame=null;segmentAccessibility.clear();
      renderWorkLegend(model.kind==='cleaning');
      if(dialog.open)dialog.close();$('work-lanes').replaceChildren();$('work-status').textContent='Восстанавливаем историю всех роботов…';
      try{const result=await createRobotWorkHistory({Core,input:model.input,caseId,kind:model.kind,robotId:null,signal:abort.signal,onProgress:p=>{if(generation===requestGeneration)$('work-status').textContent=`Восстанавливаем историю всех роботов · ${num(p,0)}%`;}});if(generation!==requestGeneration)return;history=result;$('work-status').textContent=`${history.robots.length} роботов · ${time(history.endS)} · история одного полного прогона`;drawRows($('work-lanes'),history.robots);drawModalHistory();updateRobot();}catch(e){if(e.name!=='AbortError'){$('work-status').textContent=`История недоступна: ${e.message}`;$('rd-history-status').textContent=$('work-status').textContent;}}
    }
    function openRobot(id){
      if(!model||!frame)return;selected=Number(id);scrubbing=false;const r=frame.robots.find(r=>r.id===selected);if(!r)return;
      if(!dialog.open){focusBack=document.activeElement;dialog.showModal();}
      $('rd-part-name').textContent='Устройство робота';$('rd-part-description').textContent='Выберите узел на модели или под ней.';$('rd-part-source').textContent='';
      $('rd-assembled').setAttribute('aria-pressed','true');$('rd-exploded').setAttribute('aria-pressed','false');
      $('rd-construction').open=!matchMedia('(max-width:750px)').matches;
      try{if(!detail)detail=createRobotDetailViewer({container:$('rd-canvas'),onPartSelect:setPart});detail.setRobot({kind:cleaning()?'cleaning':'warehouse',robot:r,carrierSpec:carrier(),product:model.product,name:name(r.id)});detail.setExploded(false);detail.resize?.();$('rd-parts').replaceChildren(...(detail.getParts?.()||[]).map(part=>{const b=node('button','',part.name);b.dataset.part=part.id;b.setAttribute('aria-pressed','false');b.addEventListener('click',()=>{detail.selectPart?.(part.id);setPart(part);});return b;}));}
      catch(e){$('rd-canvas').replaceChildren(node('p','rd-error',`3D-модель недоступна: ${e.message}. Телеметрия и история доступны справа и ниже.`));}
      passport();drawModalHistory();updateRobot();$('rd-close').focus();
    }
    $('rd-close').addEventListener('click',()=>dialog.close());
    dialog.addEventListener('close',()=>{detail?.dispose();detail=null;$('rd-canvas').replaceChildren();focusBack?.focus?.();});
    dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
    for(const [id,explode] of [['rd-assembled',false],['rd-exploded',true]])$(id).addEventListener('click',()=>{detail?.setExploded(explode);$('rd-assembled').setAttribute('aria-pressed',String(!explode));$('rd-exploded').setAttribute('aria-pressed',String(explode));});
    $('rd-reset').addEventListener('click',()=>detail?.resetView());
    $('rd-time').addEventListener('input',()=>{scrubbing=true;$('rd-time-value').textContent=time(Number($('rd-time').value));});
    $('rd-time').addEventListener('change',async()=>{try{await onSeek(Number($('rd-time').value));}finally{scrubbing=false;updateRobot();}});
    $('rd-back').addEventListener('click',()=>onSeek((frame?.tS||0)-60));$('rd-forward').addEventListener('click',()=>onSeek((frame?.tS||0)+60));
    $('work-zoom').addEventListener('change',()=>{zoom=Number($('work-zoom').value);if(history)drawRows($('work-lanes'),history.robots);});
    return {setModel,openRobot,updateFrame(next){frame=next;updateRobot();updateCursors();},getStats:()=>detail?.getStats?.(),getHistory:()=>history,dispose(){abort?.abort();detail?.dispose();dialog.remove();main.remove();}};
  };
})();
