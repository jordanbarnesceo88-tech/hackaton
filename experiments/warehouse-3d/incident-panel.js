(function () {
  'use strict';
  const states = { reported:'Сигнал получен', acknowledged:'Принят в работу', diagnosing:'Диагностика', recovering:'Проверка восстановления', resolved:'Работа восстановлена' };
  const labels = { DRIVE_FAULT:'Отказ привода', LOCALIZATION_LOST:'Потеря локализации', LINK_LOST:'Потеря связи', BATTERY_WARNING:'Предупреждение контроллера АКБ' };
  const stageKeys = [['reported','detectedAtS'],['acknowledged','ackAtS'],['diagnosing','diagnosingAtS'],['recovering','recoveryAtS'],['resolved','resolvedAtS']];
  const time = s => [Math.floor(s/3600),Math.floor(s%3600/60),Math.floor(s%60)].map(v=>String(v).padStart(2,'0')).join(':');
  const num = v => Number.isFinite(v)?v.toLocaleString('ru-RU',{maximumFractionDigits:1}):'—';
  const node = (tag,cls,value) => {const el=document.createElement(tag);if(cls)el.className=cls;if(value!=null)el.textContent=value;return el;};
  const setText=(el,value)=>{if(el.textContent!==value)el.textContent=value;};
  function facts(host, rows) {host.replaceChildren(...rows.map(([k,v])=>{const row=node('div');row.append(node('dt','',k),node('dd','',v));return row;}));}
  window.createIncidentPanel = function ({onSeek,onFocus,onRobot,onTab}) {
    const banner=node('section','incident-banner');banner.id='incident-banner';banner.setAttribute('aria-label','Сигналы роботов');banner.setAttribute('role','status');banner.setAttribute('aria-live','polite');
    banner.innerHTML='<div><strong id="incident-banner-title">Инцидентов нет</strong><p id="incident-banner-text">Учебные сигналы воспроизводятся вместе с моделью.</p></div><button id="incident-review">Разобрать кейсы</button>';
    document.querySelector('.live-strip').before(banner);
    const tab=node('button','','Инциденты');tab.id='tab-incidents';tab.dataset.tab='incidents';tab.setAttribute('role','tab');tab.setAttribute('aria-controls','panel-incidents');tab.setAttribute('aria-selected','false');document.querySelector('.dock-tabs').append(tab);
    const panel=node('div','incident-panel');panel.id='panel-incidents';panel.hidden=true;panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby','tab-incidents');
    panel.innerHTML='<div class="incident-panel-heading"><h3>Сигналы и обслуживание</h3><label>Показать <select id="incident-filter"><option value="active">Активные</option><option value="all">Вся история</option><option value="resolved">Завершённые</option></select></label></div><p class="note">Учебная симуляция: сигналы, принятие в работу, диагностика и восстановление происходят по расписанию. Команды реальным роботам не отправляются.</p><div id="incident-list" class="incident-list"></div><section class="incident-examples"><h3>Проиграть сценарий</h3><div id="incident-examples"></div><p class="note">Кнопка переносит к получению сигнала. Далее запустите воспроизведение: ×1 — секунда за секунду; ×5…×500 — ускоренный разбор.</p></section>';
    document.querySelector('.dock-foot').before(panel);
    const card=node('section','incident-card');card.id='incident-card';card.hidden=true;card.setAttribute('aria-labelledby','incident-title');
    card.innerHTML='<div class="incident-card-heading"><strong id="incident-severity"></strong><button id="incident-card-close" aria-label="Закрыть карточку инцидента">×</button></div><h2 id="incident-title"></h2><p id="incident-identity"></p><p id="incident-state" class="incident-state"></p><dl id="incident-facts" class="fact-list"></dl><h3>Что делать</h3><ol id="incident-instructions"></ol><h3>Ход обслуживания</h3><ol id="incident-stages" class="incident-stages"></ol><p id="incident-impact" class="note"></p><p class="note">Этапы выполняются автоматически по сценарию демо. Они не подтверждают реальный ремонт или безопасность перезапуска.</p><div class="incident-card-actions"><button id="incident-focus">Место на плане</button><button id="incident-robot">Модель и работа робота</button><button id="incident-detected">К получению сигнала</button></div>';
    document.querySelector('.evidence').prepend(card);
    const $=id=>document.getElementById(id);
    let model=null,frame=null,selected=null;
    const name=id=>`${model?.kind==='cleaning'?'CL':'AMR'}-${String(id+1).padStart(2,'0')}`;
    const find=id=>frame?.incidents?.find(i=>String(i.id)===String(id));
    const jumpAt=seconds=>onSeek(seconds+(frame?.provenance?.stepS||1));
    function open(id,focus=false){const incident=find(id);if(!incident)return false;selected=String(id);card.hidden=false;renderCard();if(focus)onFocus(id);card.scrollIntoView({block:'nearest',behavior:'instant'});return true;}
    function renderCard(){
      if(selected===null)return;const i=find(selected);
      if(!i){card.hidden=true;return;}card.hidden=false;card.dataset.severity=i.severity;card.dataset.status=i.status;
      setText($('incident-title'),i.label||labels[i.code]||i.code);setText($('incident-identity'),`${name(i.robotId)} · ${i.code} · ${i.id}`);
      setText($('incident-severity'),i.severity==='critical'?'Критический сигнал':'Предупреждение');setText($('incident-state'),states[i.status]||i.status);
      const stopped=i.haltsRobot&&i.active;
      facts($('incident-facts'),[[i.code==='LINK_LOST'?'Обнаружена потеря связи':'Получен сигнал',time(i.detectedAtS)],['Состояние робота',stopped?'Остановлен до завершения проверки':i.active?'Продолжает работу под наблюдением':'Допущен к работе'],[i.code==='LINK_LOST'?'Последняя известная точка':'Место события',`${num(i.x)} / ${num(i.y)} м`],['Прошло с сигнала',`${num(i.ageS)} с`],['Задание',i.taskHandling||'Состояние задания определяется моделью'],['Источник',i.code==='LINK_LOST'?'Контроль доступности канала · симуляция':'Сценарный сигнал робота · симуляция']]);
      const instructionKey=JSON.stringify(i.instructions);
      if($('incident-instructions').dataset.key!==instructionKey){$('incident-instructions').dataset.key=instructionKey;$('incident-instructions').replaceChildren(...(i.instructions||[]).map(v=>node('li','',v)));}
      const stamp=JSON.stringify(stageKeys.map(([status,key])=>[status,i[key]??null,i.planned?.[key]??null]));
      if($('incident-stages').dataset.key!==stamp){$('incident-stages').dataset.key=stamp;$('incident-stages').replaceChildren(...stageKeys.map(([status,key])=>{
        const row=node('li'),observed=Number.isFinite(i[key]),at=observed?i[key]:i.planned?.[key];row.dataset.status=status;row.dataset.observed=String(observed);
        if(Number.isFinite(at)){const b=node('button','',`${time(at)} · ${states[status]}`);b.dataset.time=at;b.title=observed?'Показать этот этап':'Проиграть до запланированного этапа демо';b.addEventListener('click',()=>jumpAt(at));row.append(b);}else row.append(node('span','',states[status]));
        row.append(node('small','',observed?'Произошло в модели':'Запланировано в демо'));return row;
      }));}
      for(const row of $('incident-stages').children)row.setAttribute('aria-current',String(row.dataset.status===i.status));
      setText($('incident-impact'),i.impact||'');
    }
    function renderList(){
      const list=frame?.incidents||[],filter=$('incident-filter').value;
      const shown=list.filter(i=>filter==='all'||(filter==='active'?i.active:!i.active)).sort((a,b)=>Number(b.active)-Number(a.active)||b.detectedAtS-a.detectedAtS);
      const key=JSON.stringify(shown.map(i=>[i.id,i.status]));
      if($('incident-list').dataset.key===key)return;$('incident-list').dataset.key=key;
      $('incident-list').replaceChildren(...shown.map(i=>{const button=node('button','incident-row');button.dataset.incident=i.id;button.dataset.severity=i.severity;button.append(node('strong','',`${name(i.robotId)} · ${i.label||labels[i.code]||i.code}`),node('span','',states[i.status]||i.status),node('small','',`${time(i.detectedAtS)} · ${i.code}`));button.addEventListener('click',()=>open(i.id,true));return button;}));
      if(!shown.length)$('incident-list').append(node('p','note',!model?.input.demoIncidents?.enabled?'Учебные сигналы отключены для этого прогона.':filter==='active'?'В выбранный момент активных сигналов нет. Выберите сценарий ниже или другой момент на ленте.':'В выбранный момент таких событий нет.'));
    }
    function render(){
      if(!frame)return;const active=(frame.incidents||[]).filter(i=>i.active),critical=active.filter(i=>i.severity==='critical');
      banner.dataset.severity=critical.length?'critical':active.length?'warning':'clear';
      setText($('incident-banner-title'),active.length?`Сигналы роботов: ${active.length} · критических: ${critical.length}`:'Активных инцидентов нет');
      setText($('incident-banner-text'),active.length?active.map(i=>`${name(i.robotId)}: ${i.label||labels[i.code]}`).join(' · '):model?.input.demoIncidents?.enabled?'Можно проиграть отказ и разобрать действия по восстановлению.':'Учебные сигналы отключены для этого прогона.');
      if($('panel-incidents').hidden===false)renderList();renderCard();
      const title=active.length?'Открыть инцидент':model?.input.demoIncidents?.enabled?'Разобрать кейсы':'История сигналов';setText($('incident-review'),title);
    }
    $('incident-review').addEventListener('click',()=>{onTab();renderList();const first=frame?.incidents?.find(i=>i.active);if(first)open(first.id,true);else panel.scrollIntoView({block:'nearest',behavior:'instant'});});
    $('incident-filter').addEventListener('change',renderList);tab.addEventListener('click',()=>{renderList();});
    $('incident-card-close').addEventListener('click',()=>{selected=null;card.hidden=true;});
    $('incident-focus').addEventListener('click',()=>{if(selected!==null)onFocus(selected);});
    $('incident-robot').addEventListener('click',()=>{const i=find(selected);if(i)onRobot(i.robotId);});
    $('incident-detected').addEventListener('click',()=>{const i=find(selected);if(i)jumpAt(i.detectedAtS);});
    return {
      setModel(next){model=next;selected=null;frame=null;card.hidden=true;$('incident-list').dataset.key='';document.querySelector('.incident-examples').hidden=!next.input.demoIncidents?.enabled;$('incident-examples').replaceChildren(...(next.input.demoIncidents?.enabled?next.input.demoIncidents.schedule:[]).map(i=>{const b=node('button','',labels[i.code]||i.code);b.dataset.scenario=i.id;b.addEventListener('click',async()=>{onTab();await jumpAt(i.detectedAtS);open(i.id,true);});return b;}));},
      updateFrame(next){frame=next;render();},open,refresh:render,
      dispose(){banner.remove();tab.remove();panel.remove();card.remove();},
    };
  };
})();
