import { resolveApiURL } from './api-client.js';
import { HORIZONS, normalizeFlight, pointAt, percent, availablePoint, validatePrediction } from './data-helpers.js';
const $ = id => document.getElementById(id);
const state = { result: null, horizon: null, request: 0, controller: null, suggestions: [], timer: null, dateRequest: 0 };
const fmt = (value, options) => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', ...options }).format(new Date(value));
const timeLabel = value => value ? `${fmt(value,{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false})} KST` : '확인 중';
function empty(title, message, retry = false) {
  $('loading').hidden = true; $('flight-result').hidden = true; $('empty-state').hidden = false;
  $('empty-title').textContent = title; $('empty-message').textContent = message; $('retry-search').hidden = !retry;
}
async function api(path, signal) {
  const response = await fetch(resolveApiURL(path, window.JEJU_SITE_CONFIG, document.baseURI), { headers: { Accept:'application/json' }, credentials:'omit', cache:'no-store', signal });
  let data;
  try { data = await response.json(); } catch { throw new Error('조회 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.'); }
  if (!response.ok) throw new Error(data.message || '정보를 불러오지 못했습니다.');
  return data;
}
function suggestions(flights) {
  state.suggestions = flights;
  const box = $('upcoming-flights'); box.replaceChildren();
  for (const f of flights.slice(0,3)) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'example-button';
    const title = document.createElement('b'); title.textContent = `${f.flight} · ${f.destination}`;
    const when = document.createElement('span'); when.textContent = `${f.date.slice(5).replace('-','.')} ${f.departure_time} ↗`;
    button.append(title,when); button.addEventListener('click',()=>searchFlight(f.flight,f.date)); box.append(button);
  }
}
function render() {
  const data = state.result, f = data.flight;
  $('loading').hidden = true; $('empty-state').hidden = true; $('flight-result').hidden = false;
  $('flight-number').value = f.flight; $('departure-date').value = f.date;
  $('flight-date').textContent = fmt(f.scheduled_at,{year:'numeric',month:'long',day:'numeric',weekday:'short'});
  $('result-flight').textContent = f.flight; $('result-airline').textContent = f.airline;
  $('result-destination').textContent = f.destination; $('destination-code').textContent = f.destination_code;
  $('route-time').textContent = f.departure_time; $('operation-status').textContent = f.operation_status;
  const estimated = f.estimated_departure_time && f.estimated_departure_time !== f.departure_time ? ` · 변경 ${f.estimated_departure_time}` : '';
  $('flight-update').textContent = `한국공항공사 · ${timeLabel(f.schedule_fetched_at)}${estimated}`;
  const count = f.points.filter(availablePoint).length;
  $('timeline-count').textContent = `${count}/6개 시점 확인`;
  $('forecast-range').textContent = data.forecast ? `기상청 예보 ${timeLabel(data.forecast.issued_at)} 발표 · ${timeLabel(data.forecast.valid_until)}까지` : '기상청 예보 갱신을 기다리고 있어요.';
  renderSelection();
}
function renderSelection() {
  const point = pointAt(state.result.flight,state.horizon);
  $('selected-horizon').textContent = `출발 ${state.horizon}시간 전`;
  const ready = availablePoint(point);
  $('risk-probability').textContent = ready ? percent(point.probability) : '—';
  $('risk-label').textContent = ready ? (point.source==='forecast' ? (point.scenario_count>1 ? '변화 예보도 함께 확인하세요' : '최신 예보 반영') : '기준시각 관측 반영') : (point.status_label||'기상자료 확인이 필요해요');
  $('risk-label').classList.toggle('low', ready && point.source==='forecast');
  if (!ready) {
    const names={wind_direction_deg:'풍향',wind_speed_kt:'풍속',visibility_m:'시정',present_weather_code:'일기현상',temperature_c:'기온',dewpoint_c:'이슬점',sea_level_pressure_hpa:'해면기압',station_pressure_hpa:'현지기압',rainfall_mm:'강수량'};
    const missing=[...new Set((point.missing_features||[]).map(f=>names[f]||'구름 항목'))];
    $('risk-copy').textContent = (point.reason || '해당 시점의 기상 입력을 확인하고 있습니다.') + (missing.length?' 부족한 항목: '+missing.join('·')+'.':'');
  }
  else {
    const range = point.probability_range;
    $('risk-copy').textContent = range && range[1] - range[0] >= .01 ? `일시적인 기상 변화까지 고려한 모델 추정 범위는 ${percent(range[0])}–${percent(range[1])}%입니다.` : '기상청의 최신 자료를 반영한 AI 추정값입니다. 실제 운항정보도 함께 확인하세요.';
  }
  if (ready && point.imputed_fields?.length) $('risk-copy').textContent += ' 미보고 구름 항목을 보완한 추정값입니다.';
  renderChart(); renderButtons(); renderWeather(point);
}
function renderButtons() {
  const box = $('horizon-selector'); box.replaceChildren();
  for (const h of HORIZONS) {
    const point = pointAt(state.result.flight,h), ready = availablePoint(point);
    const button = document.createElement('button'); button.type = 'button';
    button.className = `horizon-button${h===state.horizon?' active':''}${ready?'':' unavailable'}`;
    button.textContent = `${h}시간 전`; button.setAttribute('aria-pressed',String(h===state.horizon));
    button.setAttribute('aria-label',`출발 ${h}시간 전, ${ready?percent(point.probability)+'퍼센트':(point?.status_label||'기상자료 확인')}`);
    button.addEventListener('click',()=>{state.horizon=h;renderSelection();}); box.append(button);
  }
}
function renderChart() {
  const svg = $('risk-chart');
  const W=Math.max(220,Math.round(svg.getBoundingClientRect().width)), compact=W<480;
  const H=compact?236:250,L=43,R=18,T=18,B=compact?48:34;
  svg.setAttribute('viewBox',`0 0 ${W} ${H}`);
  const x = h => L + ((48-h)/46)*(W-L-R), y = p => T+(1-p)*(H-T-B);
  let markup = '<title id="chart-title">출발 전 시점별 기상 차질 추정</title><desc id="chart-description">지난 시점은 해당 시각의 관측으로 다시 계산하고, 앞으로의 시점은 최신 예보로 추정합니다. 빈 시점과 시점 사이에는 예측값을 만들지 않습니다.</desc>';
  for (const t of [0,.25,.5,.75,1]) markup += `<line x1="${L}" x2="${W-R}" y1="${y(t)}" y2="${y(t)}" stroke="#e9eee3" stroke-dasharray="3 5"/><text x="${L-9}" y="${y(t)+3}" text-anchor="end" fill="#8b9c80" font-size="12">${t*100}${t===1?'%':''}</text>`;
  const points = HORIZONS.map(h=>pointAt(state.result.flight,h));
  for (let i=1;i<points.length;i++) if (availablePoint(points[i-1]) && availablePoint(points[i])) {
    const a=points[i-1],b=points[i];
    markup += `<line x1="${x(a.horizon)}" y1="${y(a.probability)}" x2="${x(b.horizon)}" y2="${y(b.probability)}" stroke="#7b9c5e" stroke-width="2.5"${b.source==='forecast'?' stroke-dasharray="5 4"':''}/>`;
  }
  for (const p of points) {
    const selected = p.horizon===state.horizon, ready=availablePoint(p);
    markup += `<text x="${x(p.horizon)}" y="${H-((compact&&p.horizon===4)?26:9)}" text-anchor="middle" fill="#87997c" font-size="12">${p.horizon}h</text>`;
    if (!ready) {markup += `<text x="${x(p.horizon)}" y="${H-B-10}" text-anchor="middle" fill="#a4af9a" font-size="12">미제공</text>`;continue;}
    if(selected) markup += `<line x1="${x(p.horizon)}" x2="${x(p.horizon)}" y1="${T}" y2="${H-B}" stroke="#bfd0ab" stroke-dasharray="3 4"/><circle cx="${x(p.horizon)}" cy="${y(p.probability)}" r="11" fill="#bace9c" opacity=".35"/>`;
    markup += `<circle class="chart-point" data-horizon="${p.horizon}" cx="${x(p.horizon)}" cy="${y(p.probability)}" r="${selected?5:4}" fill="${p.source==='forecast'?'#537b3c':'#fff'}" stroke="#7b9c5e" stroke-width="2" role="button" tabindex="0" aria-label="출발 ${p.horizon}시간 전 ${percent(p.probability)}퍼센트"/>`;
  }
  svg.innerHTML=markup;
  for (const circle of svg.querySelectorAll('.chart-point')) {
    const select=()=>{state.horizon=Number(circle.dataset.horizon);renderSelection();};
    circle.addEventListener('click',select);circle.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();select();}});
    circle.addEventListener('mouseenter',()=>{const p=pointAt(state.result.flight,Number(circle.dataset.horizon));$('chart-tooltip').textContent=`${p.horizon}시간 전 · ${percent(p.probability)}% · ${p.source_label}`;$('chart-tooltip').hidden=false;});
    circle.addEventListener('mouseleave',()=>{$('chart-tooltip').hidden=true;});
  }
}
function renderWeather(point) {
  const ready = availablePoint(point), box=$('weather-grid');box.replaceChildren();
  $('weather-time').textContent=timeLabel(point.input_at);
  $('weather-source').textContent=ready?point.source_label:(point.status_label||'기상자료 확인');
  const specs=[{field:'wind_speed_kt',label:'풍속',icon:'≋',unit:'kt'}, {field:'visibility_m',label:'시정',icon:'◉',unit:'km',factor:.001}, {field:'temperature_c',label:'기온',icon:'♧',unit:'°C'}, {field:'rainfall_mm',label:'시간 강수량',icon:'☂',unit:'mm'}];
  for(const s of specs){
    const tile=document.createElement('div');tile.className='weather-tile';
    const icon=document.createElement('span');icon.className='weather-icon';icon.textContent=s.icon;icon.setAttribute('aria-hidden','true');
    const label=document.createElement('p');label.textContent=s.label;
    const value=ready?point.weather[s.field]:null;
    const strong=document.createElement('strong');strong.textContent=Number.isFinite(value)?(s.field==='visibility_m'&&value>=10000?'10+':(value*(s.factor??1)).toFixed(1)):'—';
    const unit=document.createElement('small');unit.textContent=s.unit;strong.append(unit);
    const source=document.createElement('span');source.className='weather-value-source';
    if(ready){const fieldSource=point.feature_sources[s.field];source.textContent=fieldSource?.method==='persistence'?'관측 보완':fieldSource?.source.includes('FORECAST')||fieldSource?.source==='KMA_TAF'?'예보':'관측';}
    tile.append(icon,label,strong,source);box.append(tile);
  }
  if(!ready) $('weather-note').textContent=point.reason||'해당 시점의 기상 입력을 확인하고 있습니다.';
  else if(point.source==='forecast') $('weather-note').textContent=`${timeLabel(point.forecast_issued_at)} 발표 예보 기준. 일부 세부 항목은 최근 공항 관측으로 보완했습니다.${point.weather_extras?.wind_gust_kt?' 예상 돌풍 '+point.weather_extras.wind_gust_kt.toFixed(0)+'kt.':''}`;
  else $('weather-note').textContent=`${timeLabel(point.weather_at)}까지의 공항 관측으로 계산한 값입니다.`;
  if(ready && point.imputed_fields?.length) $('weather-note').textContent+=` 미보고 구름 항목 ${point.imputed_fields.length}개는 학습자료의 대표값으로 보완했습니다.`;
}
async function searchFlight(number,date,{background=false}={}) {
  number=normalizeFlight(number);
  const ticket=++state.request;state.controller?.abort();state.controller=new AbortController();
  const controller=state.controller;
  const timeout=setTimeout(()=>controller.abort(),60000);
  $('search-message').textContent='';
  if(!/^[A-Z0-9]{2,3}\d{1,6}$/.test(number)){clearTimeout(timeout);$('search-button').disabled=false;$('refresh-button').disabled=false;$('search-message').textContent='항공사 영문 코드와 숫자로 입력해 주세요.';return;}
  $('search-button').disabled=true;$('refresh-button').disabled=true;
  if(!background){$('flight-result').hidden=true;$('empty-state').hidden=true;$('loading').hidden=false;}
  try {
    const data=validatePrediction(await api(`api/predict?${new URLSearchParams({flight:number,date})}`,controller.signal));
    if(ticket!==state.request)return;
    state.result=data;state.horizon=data.selected_horizon??24;render();
    history.replaceState(null,'',`${location.pathname}?${new URLSearchParams({flight:data.flight.flight,date})}`);
    $('search-message').textContent=`${timeLabel(data.generated_at)} 확인 · 5분마다 자동 갱신`;
  } catch(error) {
    if(ticket!==state.request)return;
    if(background&&state.result){$('search-message').textContent='최신 정보를 갱신하지 못했습니다. 마지막 조회 시각을 확인해 주세요.';}
    else empty('항공편 정보를 확인해 주세요.',error.name==='AbortError'?'응답이 지연되고 있습니다. 잠시 후 다시 조회해 주세요.':error.message,true);
  } finally {clearTimeout(timeout);if(ticket===state.request){$('search-button').disabled=false;$('refresh-button').disabled=false;}}
}
$('search-form').addEventListener('submit',event=>{event.preventDefault();searchFlight($('flight-number').value,$('departure-date').value);});
$('retry-search').addEventListener('click',()=>searchFlight($('flight-number').value,$('departure-date').value));
$('refresh-button').addEventListener('click',()=>searchFlight($('flight-number').value,$('departure-date').value,{background:true}));
$('departure-date').addEventListener('change',async()=>{
  const ticket=++state.dateRequest,date=$('departure-date').value;
  try{const data=await api(`api/flights?${new URLSearchParams({date})}`);if(ticket!==state.dateRequest)return;suggestions(data.flights.filter(f=>new Date(f.scheduled_at)>new Date()&&f.operation_status!=='결항'&&f.operation_status!=='출발'));$('schedule-note').textContent=`한국공항공사 · ${data.flights.length}편 조회`;}catch(error){if(ticket===state.dateRequest){suggestions([]);$('schedule-note').textContent=error.message;}}
});
for(const button of document.querySelectorAll('[data-open="about"]'))button.addEventListener('click',()=>$('about-dialog').showModal());
for(const id of ['close-about','understand-about'])$(id).addEventListener('click',()=>$('about-dialog').close());
$('about-dialog').addEventListener('click',event=>{if(event.target===$('about-dialog')){const r=$('about-dialog').getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)$('about-dialog').close();}});
window.addEventListener('resize',()=>{if(state.result)renderChart();});
async function boot(){
  try{
    const data=await api('api/bootstrap',AbortSignal.timeout(45000));
    $('departure-date').min=data.today_kst;$('departure-date').max=data.last_date;$('departure-date').value=data.today_kst;
    const badge=$('connection-status');badge.querySelector('span').textContent=data.weather_connected?'기상청 연결':'기상정보 확인 중';badge.classList.toggle('pending',!data.weather_connected);
    suggestions(data.suggestions);$('schedule-note').textContent='한국공항공사 운항정보 · 제주 국내선 출발편';
    const q=new URLSearchParams(location.search);
    if(q.has('flight')&&q.has('date'))await searchFlight(q.get('flight'),q.get('date'));
    else if(data.suggestions.length)await searchFlight(data.suggestions[0].flight,data.suggestions[0].date);
    else empty('항공편을 조회해 주세요.',data.errors[0]?.message||'제주 출발 항공편명과 탑승 날짜를 입력해 주세요.');
    state.timer=setInterval(()=>{if(!document.hidden&&state.result&&!$('search-button').disabled&&normalizeFlight($('flight-number').value)===state.result.flight.flight&&$('departure-date').value===state.result.flight.date)searchFlight(state.result.flight.flight,state.result.flight.date,{background:true});},data.refresh_seconds*1000);
  }catch(error){
    const configured=error.code!=='api_not_configured';
    $('connection-status').querySelector('span').textContent=configured?'연결 확인 중':'조회 준비 중';
    $('connection-status').classList.add('pending');
    if(!configured){$('search-button').disabled=true;$('schedule-note').textContent='실시간 조회 연결이 완료되면 이용할 수 있어요.';}
    empty('실시간 정보를 연결하고 있어요.',error.name==='TimeoutError'?'잠시 후 다시 조회해 주세요.':error.message,configured);
  }
}
boot();
