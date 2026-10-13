(() => {
  'use strict';
  const localAdminEnabled = !document.querySelector('meta[name="wordlab-public"]');
  if (localAdminEnabled && location.hash === '#admin') { const script=document.createElement('script'); script.src='admin.js'; document.body.replaceChildren(); document.body.append(script); return; }
  const Bank = window.WORD_CONTENT;
  const W = window.WordLab;
  let C = Bank.packs[0];
  const $ = (selector) => document.querySelector(selector);
  const app = $('#app');
  const KEY = 'word-workshop-session-v2';
  const screens = ['WELCOME', 'LEARNING', 'SORTING', 'BONUS', 'RESULT'];
  const maxScore = C.words.length + C.bonus.points;
  const fa = n => Number(n).toLocaleString('fa-IR');
  // متن محتوای قابل ویرایش پیش از ورود به HTML ایمن می‌شود.
  const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let adminMode = false;
  let selected = null, timer = null, drag = null, ignoreClick = false, announcementTimer = null;
  let soundEnabled = W.read('word-workshop-sound') !== false, audio = null, currentTone = null;
  let timeStamp = performance.now(), active = false, lastSnapshot = timeStamp;
  const blank = () => ({ version:Bank.version, screen:'WELCOME', contentPackId:null, id:null, order:[], solved:[], mistakes:0, bonusStatus:'pending', rating:null, startedAt:null, finishedAt:null, elapsedMs:0, learningRemainingMs:Bank.learningSeconds*1000 });
  const read = W.read, write = W.write;
  const ratings = ['easy','suitable','hard'];
  function valid(s) {
    if (!s || s.version !== C.version || !screens.includes(s.screen)) return false;
    if (s.screen === 'WELCOME') return s.startedAt === null && s.solved?.length === 0;
    const pack = Bank.packs.find(p => p.id === s.contentPackId);
    if (!pack) return false;
    const ids = pack.words.map(w => w.id);
    if (typeof s.id !== 'string' || !Array.isArray(s.order) || s.order.length !== ids.length || new Set(s.order).size !== ids.length || !s.order.every(id => ids.includes(id))) return false;
    if (!Array.isArray(s.solved) || new Set(s.solved).size !== s.solved.length || !s.solved.every(id => ids.includes(id))) return false;
    if (!Number.isSafeInteger(s.mistakes) || s.mistakes < 0 || !Number.isFinite(s.startedAt) || s.startedAt <= 0) return false;
    if (!['pending','wrong','correct','skipped'].includes(s.bonusStatus) || !(s.rating === null || ratings.includes(s.rating))) return false;
    if (['BONUS','RESULT'].includes(s.screen) && s.solved.length !== ids.length) return false;
    if (s.screen === 'SORTING' && s.solved.length === ids.length) return false;
    if (s.screen === 'BONUS' && s.bonusStatus === 'skipped') return false;
    if (['WELCOME','LEARNING','SORTING'].includes(s.screen) && s.bonusStatus !== 'pending') return false;
    if (!Number.isFinite(s.elapsedMs) || s.elapsedMs < 0 || s.elapsedMs > Number.MAX_SAFE_INTEGER) return false;
    if (!Number.isFinite(s.learningRemainingMs) || s.learningRemainingMs < 0 || s.learningRemainingMs > Bank.learningSeconds*1000) return false;
    if (s.screen === 'RESULT' && (!['correct','skipped'].includes(s.bonusStatus) || !Number.isFinite(s.finishedAt) || s.finishedAt < s.startedAt)) return false;
    if (s.screen !== 'RESULT' && s.finishedAt !== null) return false;
    return true;
  }
  const restored = read(KEY);
  let state = valid(restored) && restored.screen !== 'WELCOME' ? restored : blank();
  if (state.contentPackId) C = Bank.packs.find(p => p.id === state.contentPackId);
  function syncTime() {
    const now = performance.now(), delta = Math.max(0, now-timeStamp); timeStamp = now;
    if (active && ['LEARNING','SORTING','BONUS'].includes(state.screen)) {
      state.elapsedMs += delta;
      if (state.screen === 'LEARNING') state.learningRemainingMs = Math.max(0,state.learningRemainingMs-delta);
    }
  }
  function save() { if(adminMode) return; syncTime(); write(KEY, state); }
  function setActive(value) { syncTime(); active = value; timeStamp = performance.now(); }
  function startTicker() {
    clearInterval(timer); timer = null;
    setActive(['LEARNING','SORTING','BONUS'].includes(state.screen) && !document.hidden && !$('#help-dialog').open);
    if (!['LEARNING','SORTING','BONUS'].includes(state.screen)) return;
    timer = setInterval(() => {
      syncTime();
      if (state.screen === 'LEARNING') {
        $('#timer-value').textContent = fa(Math.ceil(state.learningRemainingMs/1000));
        if (active && state.learningRemainingMs <= 0) { startSorting(); return; }
      }
      if (performance.now()-lastSnapshot >= 5000) { save(); lastSnapshot = performance.now(); }
    },250);
  }
  let memoryBag = null;
  function choosePack() {
    const ids = Bank.packs.map(p=>p.id), saved = memoryBag || read('word-workshop-pack-bag');
    let remaining = Array.isArray(saved?.remaining) && new Set(saved.remaining).size === saved.remaining.length && saved.remaining.every(id=>ids.includes(id)) ? [...saved.remaining] : [];
    const last = ids.includes(saved?.last) ? saved.last : null;
    if (!remaining.length) remaining = shuffle(ids);
    if (remaining.length>1 && remaining[remaining.length-1] === last) [remaining[0],remaining[remaining.length-1]] = [remaining[remaining.length-1],remaining[0]];
    const id=remaining.pop(); memoryBag={last:id,remaining}; write('word-workshop-pack-bag',memoryBag);
    return Bank.packs.find(p=>p.id===id);
  }
  function score() { return state.solved.length + (state.bonusStatus === 'correct' ? C.bonus.points : 0); }
  function shuffle(ids) {
    const result = [...ids];
    for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; }
    return result;
  }
  function announce(message) { clearTimeout(announcementTimer); $('#announcement').textContent = ''; announcementTimer = setTimeout(() => { $('#announcement').textContent = message; }, 30); }
  function feedback(message, error = false) {
    const el = $('#feedback');
    if (el) { el.textContent = message; el.classList.toggle('error', error); }
    announce(message);
  }
  function tone(correct) {
    if (!soundEnabled) return;
    try {
      audio ||= new (window.AudioContext || window.webkitAudioContext)();
      audio.resume().catch(()=>{});
      if (currentTone) { try { currentTone.stop(); } catch (_) {} }
      const osc = audio.createOscillator(), gain = audio.createGain(); currentTone = osc;
      osc.connect(gain); gain.connect(audio.destination);
      osc.frequency.setValueAtTime(correct ? 660 : 240, audio.currentTime);
      osc.frequency.exponentialRampToValueAtTime(correct ? 880 : 180, audio.currentTime+.16);
      gain.gain.setValueAtTime(.045,audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(.001,audio.currentTime+.2);
      osc.onended=()=>{osc.disconnect();gain.disconnect();if(currentTone===osc)currentTone=null;};
      osc.start();osc.stop(audio.currentTime+.21);
    } catch (_) { /* تنظیم روشن است؛ پخش واقعی تابع تعامل کاربر و پشتیبانی مرورگر است. */ }
  }
  function cleanupDrag() {
    if (drag) {
      cancelAnimationFrame(drag.frame);
      drag.ghost?.remove(); drag.card.classList.remove('drag-source');
      if (drag.card.hasPointerCapture(drag.pointerId)) drag.card.releasePointerCapture(drag.pointerId);
    }
    document.querySelectorAll('.drop-hover').forEach(el => el.classList.remove('drop-hover'));
    drag = null;
  }
  function transition(screen) {
    syncTime(); clearInterval(timer); timer = null; active = false; cleanupDrag(); selected = null;
    clearTimeout(announcementTimer); $('#announcement').textContent = '';
    state.screen = screen; save(); render();
    app.focus(); startTicker();
  }
  function restart() { setActive(false); state = blank(); C = Bank.packs[0]; transition('WELCOME'); }
  function newGame() {
    if (state.screen !== 'WELCOME') return;
    C = choosePack(); state = blank(); state.contentPackId=C.id;
    state.id = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
    state.order=shuffle(C.words.map(w=>w.id));state.startedAt=Date.now();timeStamp=performance.now();
    enterLearning(); tone(true);
  }
  function enterLearning() { state.learningRemainingMs = Bank.learningSeconds*1000; transition('LEARNING'); }
  function startSorting() { transition(state.solved.length === C.words.length ? 'BONUS' : 'SORTING'); }
  function updateSteps() {
    const index = screens.indexOf(state.screen);
    document.querySelectorAll('[data-step]').forEach((el, i) => {
      el.classList.toggle('active', i === index); el.classList.toggle('done', i < index);
      if (i === index) el.setAttribute('aria-current','step'); else el.removeAttribute('aria-current');
    });
  }
  function render() {
    updateSteps();
    if (state.screen === 'WELCOME') renderWelcome();
    else if (state.screen === 'LEARNING') renderLearning();
    else if (state.screen === 'SORTING') renderSorting();
    else if (state.screen === 'BONUS') renderBonus();
    else renderResult();
  }
  function renderWelcome() {
    app.innerHTML = `<section class="welcome" aria-labelledby="welcome-title"><div class="welcome-copy"><div class="eyebrow">یک ماجراجویی با کلمه‌ها · برای ۸ تا ۱۲ سال</div><h1 id="welcome-title">هر کلمه،<br>یک <span class="title-highlight">کشف تازه!</span></h1><p class="muted">آماده‌ای کلمه‌ها رو کشف کنی؟ الگوها رو یاد بگیر و هر کلمه رو توی سبد درست بذار!</p><div class="button-row"><button class="primary" id="start">شروع بازی <span aria-hidden="true">←</span></button><button class="secondary" id="welcome-help">چطور بازی کنم؟</button></div><div class="welcome-meta"><span><b>۶</b> کلمه برای کشف</span><span><b>۱</b> چالش جالب</span><span>بدون عجله و با خیال راحت</span></div></div><div class="scene" aria-hidden="true"><span class="float-word one">بازیگر</span><span class="float-word two">گیلاس</span><span class="spark">✧</span><div class="mascot"><span class="letter">و</span><span class="face"><i class="eye"></i><i class="eye"></i><i class="smile"></i><i class="cheek right"></i><i class="cheek left"></i></span><i class="leg left"></i><i class="leg right"></i></div><span class="scene-badge">من همراهِ کشف‌های تو هستم!</span></div></section>`;
    $('#start').onclick = newGame; $('#welcome-help').onclick = openHelp;
  }
  function renderLearning() {
    app.innerHTML = `<section aria-labelledby="learning-title"><div class="screen-heading"><div><div class="eyebrow">قدم اول · الگوها را کشف کن</div><h2 id="learning-title">خوب نگاه کن، چه شباهتی دارند؟</h2><p>دو راه متفاوت برای دسته‌بندی کلمه‌ها داریم.</p></div><div class="timer"><strong id="timer-value">${fa(Math.ceil(state.learningRemainingMs/1000))}</strong><small>ثانیه برای دیدن نمونه‌ها</small></div></div><div class="groups">${C.groups.map(g => `<article class="learning-group ${esc(g.id)}"><span class="group-kind">${esc(g.kind)}</span><h3>${esc(g.title)}</h3><div class="examples">${g.examples.map(w => `<span class="example">${g.suffix && w.endsWith(g.suffix) ? esc(w.slice(0,-g.suffix.length))+'<em>'+esc(g.suffix)+'</em>' : esc(w)}</span>`).join('')}</div><p>${esc(g.explanation)}</p></article>`).join('')}</div><p class="note">✦ یک گروه از روی ساخت کلمه است؛ گروه دیگر از روی معنی. فقط شبیه بودن حروف کافی نیست!</p><div class="learning-actions"><button class="primary" id="skip-learning">متوجه شدم، بریم بازی! <span aria-hidden="true">←</span></button><p>این زمان فقط برای دیدن نمونه‌هاست؛ هیچ امتیازی کم نمی‌شود.${state.solved.length ? ' پیشرفت قبلی تو محفوظ است.' : ''}</p></div></section>`;
    $('#skip-learning').onclick = startSorting;
  }
  function renderSorting() {
    app.innerHTML = `<section aria-labelledby="sorting-title"><div class="screen-heading sorting-heading"><div><div class="eyebrow">قدم دوم · هر کلمه در سبد خودش</div><h2 id="sorting-title">وقتِ چیدن واژه‌هاست!</h2><p>کارت را بکش، یا کارت و بعد سبد را انتخاب کن.</p></div><div class="scoreboard"><div class="stat">کلمه‌های درست<strong id="correct-count">${fa(state.solved.length)} از ${fa(C.words.length)}</strong></div><div class="stat">امتیاز تو<strong id="score">${fa(score())}</strong></div></div></div><div class="progress-track" role="progressbar" aria-label="کلمه‌های دسته‌بندی‌شده" aria-valuemin="0" aria-valuemax="${C.words.length}" aria-valuenow="${state.solved.length}"><span style="width:${state.solved.length / C.words.length * 100}%"></span></div><div class="word-tray"><div class="tray-label"><span>میز واژه‌ها</span><span>انتخاب کن و در سبد بگذار ↓</span></div><div class="words">${state.order.map(id => {
      const w = C.words.find(w => w.id === id);
      return state.solved.includes(id) ? `<div class="word-slot sorted" data-slot="${esc(id)}">✓ در سبد است</div>` : `<div class="word-slot" data-slot="${esc(id)}"><button class="word-card" data-word="${esc(id)}" aria-pressed="false" aria-label="انتخاب کلمهٔ ${esc(w.text)}">${esc(w.text)}</button></div>`;
    }).join('')}</div></div><div class="groups sorting-groups">${C.groups.map(g => `<div class="basket ${esc(g.id)}" data-group="${esc(g.id)}" role="button" tabindex="0" aria-label="سبد ${esc(g.title)}"><h3>${esc(g.title)}</h3><p>${esc(g.kind)}</p><div class="placed-words">${C.words.filter(w => w.group === g.id && state.solved.includes(w.id)).map(w => `<span class="placed-word">${esc(w.text)} ✓</span>`).join('')}</div></div>`).join('')}</div><p class="feedback" id="feedback">اشتباه کردن هم بخشی از یادگیری است!</p><div class="sort-bottom"><button class="secondary" id="review">نمونه‌ها را دوباره ببین</button><p>هر کلمهٔ درست = ۱ امتیاز<br>با خیال راحت امتحان کن.</p></div></section>`;
    $('#review').onclick = enterLearning;
    document.querySelectorAll('[data-word]').forEach(card => {
      card.onclick = e => { if (ignoreClick && e.detail !== 0) return; selectCard(card.dataset.word); };
      card.onpointerdown = pointerDown;
      card.onlostpointercapture = e => { if (drag?.pointerId === e.pointerId) cleanupDrag(); };
      card.ondragstart = e => e.preventDefault();
    });
    document.querySelectorAll('[data-group]').forEach(basket => {
      basket.onclick = () => { if (selected) place(selected, basket.dataset.group); else feedback('اول یک کلمه را از میز انتخاب کن.'); };
      basket.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); basket.click(); } };
    });
  }
  function selectCard(id) {
    if (state.screen !== 'SORTING' || state.solved.includes(id)) return;
    selected = selected === id ? null : id;
    document.querySelectorAll('[data-word]').forEach(card => {
      const active = card.dataset.word === selected;
      card.classList.toggle('selected', active); card.setAttribute('aria-pressed', String(active));
    });
    document.querySelectorAll('.basket').forEach(el => el.classList.toggle('can-drop', !!selected));
    feedback(selected ? `«${C.words.find(w => w.id === id).text}» انتخاب شد؛ حالا سبد را انتخاب کن.` : 'انتخاب لغو شد. یک کلمه انتخاب کن.');
  }
  function place(id, groupId) {
    if (state.screen !== 'SORTING' || state.solved.includes(id)) return;
    const word = C.words.find(w => w.id === id), group = C.groups.find(g => g.id === groupId);
    if (!word || !group) return;
    if (word.group !== groupId) {
      state.mistakes++; save(); tone(false);
      selected = null;
      document.querySelectorAll('[data-word]').forEach(el => { el.classList.remove('selected'); el.setAttribute('aria-pressed','false'); });
      document.querySelectorAll('.basket').forEach(el => el.classList.remove('can-drop'));
      const card = document.querySelector(`[data-word="${id}"]`);
      card?.classList.remove('shake'); if (card) { void card.offsetWidth; card.classList.add('shake'); }
      feedback(`این سبد جای «${word.text}» نیست. به معنی و ساخت کلمه فکر کن و دوباره امتحان کن.`, true);
      return;
    }
    state.solved.push(id); selected = null; save(); tone(true);
    if (state.solved.length === C.words.length) {
      transition('BONUS'); announce('آفرین! همهٔ کلمه‌ها درست چیده شد. حالا چالش آخر.'); return;
    }
    renderSorting(); feedback(`آفرین! «${word.text}» در سبد درست قرار گرفت. یک امتیاز گرفتی.`);
    document.querySelector(`[data-group="${groupId}"]`)?.classList.add('glow');
    document.querySelector('[data-word]')?.focus({preventScroll:true});
  }
  function pointerDown(e) {
    if (state.screen !== 'SORTING' || e.button !== 0 || !e.isPrimary || drag) return;
    const card = e.currentTarget;
    drag = { id:card.dataset.word, pointerId:e.pointerId, card, x:e.clientX, y:e.clientY, currentX:e.clientX, currentY:e.clientY, moved:false, ghost:null, frame:null };
    card.setPointerCapture(e.pointerId);
  }
  function updateDropHover() {
    const basket = document.elementFromPoint(drag.currentX, drag.currentY)?.closest('[data-group]');
    document.querySelectorAll('[data-group]').forEach(el => el.classList.toggle('drop-hover', el === basket));
  }
  function edgeScroll(now) {
    if (!drag?.moved) return;
    const elapsed = Math.min(32, now - (drag.lastFrame ?? now)); drag.lastFrame = now;
    const y = drag.currentY;
    const velocity = y > window.innerHeight - 65 ? Math.min(1, (y - window.innerHeight + 65) / 65) : y < 65 ? -Math.min(1, (65 - y) / 65) : 0;
    if (velocity) { window.scrollBy(0, velocity * elapsed * .55); updateDropHover(); }
    drag.frame = requestAnimationFrame(edgeScroll);
  }
  document.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 9) return;
    if (!drag.moved) {
      drag.moved = true;
      selected = null;
      document.querySelectorAll('[data-word]').forEach(el => { el.classList.remove('selected'); el.setAttribute('aria-pressed','false'); });
      document.querySelectorAll('.basket').forEach(el => el.classList.remove('can-drop'));
      drag.ghost = drag.card.cloneNode(true); drag.ghost.removeAttribute('data-word');
      drag.ghost.removeAttribute('id'); drag.ghost.setAttribute('aria-hidden','true');
      drag.ghost.className = 'word-card drag-ghost'; drag.ghost.tabIndex = -1;
      document.body.append(drag.ghost); drag.card.classList.add('drag-source');
      drag.frame = requestAnimationFrame(edgeScroll);
    }
    e.preventDefault(); drag.ghost.style.left = `${e.clientX - 70}px`; drag.ghost.style.top = `${e.clientY - 33}px`;
    drag.currentX = e.clientX; drag.currentY = e.clientY; updateDropHover();
  }, {passive:false});
  document.addEventListener('pointerup', e => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const { id, moved } = drag;
    const basket = moved ? document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-group]') : null;
    cleanupDrag();
    if (moved) {
      ignoreClick = true; setTimeout(() => { ignoreClick = false; }, 0);
      if (basket) place(id, basket.dataset.group); else feedback('کارت به میز برگشت. آن را روی یک سبد رها کن.');
    }
  });
  document.addEventListener('pointercancel', cleanupDrag);
  window.addEventListener('blur', cleanupDrag);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && selected) selectCard(selected); });
  function renderBonus() {
    const status = state.bonusStatus;
    app.innerHTML = `<section class="bonus-panel" aria-labelledby="bonus-title"><div class="eyebrow">قدم سوم · یک چالش برای ذهن کنجکاو تو</div><h2 id="bonus-title">یک چالش برای کشف بهتر واژه‌ها!</h2><div class="challenge-word">${esc(C.bonus.word)}</div><h3>${esc(C.bonus.question)}</h3><p>به ساخت و معنی کلمه فکر کن.</p><div class="choices"><button class="secondary choice" id="yes" ${status === 'correct' ? 'disabled' : ''}>بله</button><button class="secondary choice" id="no" ${status === 'correct' ? 'disabled' : ''}>خیر</button></div><p>پاسخ درست این چالش ${fa(C.bonus.points)} امتیاز دارد.</p>${status === 'pending' ? '' : `<div class="bonus-explanation"><strong>${status === 'correct' ? 'آفرین! دقیق فکر کردی. +۲ امتیاز' : 'یک نکتهٔ تازه یاد بگیریم!'}</strong><p>${esc(C.bonus.explanation)}</p>${status === 'wrong' ? '<p>توضیح را بخوان و پاسخ را اصلاح کن، یا بدون امتیاز چالش ادامه بده.</p>' : ''}<div class="button-row"><button class="${status === 'correct' ? 'primary' : 'secondary'}" id="finish">${status === 'correct' ? 'بریم جشن یادگیری!' : 'ادامه بدون امتیاز چالش'}</button></div></div>`}</section>`;
    $(C.bonus.correct === 'yes' ? '#yes' : '#no').classList.toggle('correct-choice', status === 'correct');
    $('#yes').onclick = () => answerBonus('yes'); $('#no').onclick = () => answerBonus('no');
    if ($('#finish')) $('#finish').onclick = finish;
  }
  function answerBonus(answer) {
    if (state.screen !== 'BONUS' || state.bonusStatus === 'correct') return;
    const correct = answer === C.bonus.correct;
    if (!correct) state.mistakes++;
    state.bonusStatus = correct ? 'correct' : 'wrong'; save(); tone(correct); renderBonus();
    announce(correct ? 'درست است! دو امتیاز گرفتی.' : 'هنوز درست نیست. توضیح را بخوان و دوباره امتحان کن.');
    (correct ? $('#finish') : $('#'+C.bonus.correct)).focus({preventScroll:true});
  }
  function finish() {
    if (state.screen !== 'BONUS' || !['correct','wrong'].includes(state.bonusStatus)) return;
    if (state.bonusStatus === 'wrong') state.bonusStatus = 'skipped';
    syncTime(); setActive(false); state.finishedAt = Math.max(state.startedAt,Date.now()); transition('RESULT'); recordResult();
  }
  function duration() { return Math.max(0,Math.floor(state.elapsedMs/1000)); }
  function recordResult() {
    if (state.screen !== 'RESULT') return;
    W.putSession({sessionId:state.id,contentPackId:C.id,startedAt:new Date(state.startedAt).toISOString(),completedAt:new Date(state.finishedAt).toISOString(),
      durationSeconds:duration(),score:score(),maxScore,incorrectAttempts:state.mistakes,bonusCorrect:state.bonusStatus==='correct',perceivedDifficulty:state.rating,durationBasis:'active-monotonic'});
  }
  function renderResult() {
    app.innerHTML = `<section class="result-panel" aria-labelledby="result-title"><div class="confetti" aria-hidden="true">${Array.from({length:22}, (_,i) => `<span style="left:${i*4.5}%;animation-delay:${(i%5)*.15}s"></span>`).join('')}</div><div class="trophy" aria-hidden="true">✦</div><div class="eyebrow">کارگاه امروز با موفقیت تمام شد</div><h2 id="result-title">آفرین، کاشف واژه‌ها!</h2><p class="muted">هر کلمه را به خانهٔ خودش رساندی.</p><div class="final-score">${fa(score())} <small>از ${fa(maxScore)} امتیاز</small></div><div class="result-metrics"><span>کلمه‌های درست<strong>${fa(state.solved.length)} از ${fa(C.words.length)}</strong></span><span>تلاش‌های اشتباه<strong>${fa(state.mistakes)}</strong></span><span>زمان بازی<strong>${esc(W.formatDuration(duration()))}</strong></span></div><div class="button-row"><button class="primary" id="replay">بازی دوباره ↻</button></div><details><summary>چرا این جواب‌ها درست بودن؟</summary><ol>${C.summary.map(s => `<li>${esc(s)}</li>`).join('')}</ol></details><div class="rating"><p>بازی برات چطور بود؟ <span class="muted">(اختیاری)</span></p><div class="rating-options">${[['easy','آسون بود'],['suitable','مناسب بود'],['hard','سخت بود']].map(([value,text]) => `<button data-rating="${value}" aria-pressed="${state.rating === value}">${text}</button>`).join('')}</div><p id="rating-status" class="muted">${state.rating ? 'ممنون! نظرت ثبت شد.' : 'این پاسخ فقط روی همین دستگاه نگهداری می‌شود.'}</p></div></section>`;
    $('#replay').onclick = restart;
    document.querySelectorAll('[data-rating]').forEach(btn => { btn.onclick = () => {
      state.rating = btn.dataset.rating; save(); recordResult();
      document.querySelectorAll('[data-rating]').forEach(el => el.setAttribute('aria-pressed', String(el.dataset.rating === state.rating)));
      $('#rating-status').textContent = 'ممنون! نظرت ثبت شد.'; announce('نظرت ثبت شد. ممنون!');
    }; });
  }
  function resume() { if(adminMode) return; setActive(['LEARNING','SORTING','BONUS'].includes(state.screen) && !document.hidden && !$('#help-dialog').open); }
  function openHelp() { cleanupDrag(); setActive(false); save(); $('#help-dialog').showModal(); }
  $('#help-dialog').addEventListener('close',resume);
  document.addEventListener('visibilitychange',()=>{ cleanupDrag(); if(document.hidden) { setActive(false); save(); } else resume(); });
  window.addEventListener('pagehide',()=>{setActive(false);save();});
  $('#help').onclick = openHelp; $('#brand').onclick = e => { e.preventDefault(); openHelp(); };
  $('#close-help').onclick = () => $('#help-dialog').close();
  $('#sound').onclick = () => {
    soundEnabled = !soundEnabled; write('word-workshop-sound',soundEnabled); $('#sound').setAttribute('aria-pressed',String(soundEnabled));
    if (!soundEnabled && currentTone) { try { currentTone.stop(); } catch (_) {} }
    $('#sound').textContent = soundEnabled ? 'صدا: روشن' : 'صدا: خاموش'; tone(true);
  };
  // نشست ذخیره‌شدهٔ ناسازگار پاک می‌شود؛ نتیجهٔ معتبر دوباره امتیاز نمی‌گیرد.
  $('#sound').setAttribute('aria-pressed',String(soundEnabled)); $('#sound').textContent = soundEnabled ? 'صدا: روشن' : 'صدا: خاموش';
  window.addEventListener('hashchange',()=>{if(localAdminEnabled && location.hash==='#admin'){setActive(false);save();clearInterval(timer);cleanupDrag();clearTimeout(announcementTimer);adminMode=true;document.body.replaceChildren();const script=document.createElement('script');script.src='admin.js';document.body.append(script);}});
  save(); render(); startTicker(); if (state.screen === 'RESULT') recordResult();
})();
