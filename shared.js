/* مشترک میان بازی و مدیریت؛ بدون fetch و قابل اجرا از file://. */
window.WordLab = (() => {
  'use strict';
  const appVersion = '1.2.0', schemaVersion = 2;
  const historyKey = 'word-workshop-results-v2';
  let memory = [];
  const fa = n => Math.floor(n).toLocaleString('fa-IR', {useGrouping:false});
  function formatDuration(value) {
    const total = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
    const h = Math.floor(total / 3600), m = Math.floor(total % 3600 / 60), s = total % 60;
    const parts = [];
    if (h) parts.push(`${fa(h)} ساعت`);
    if (m) parts.push(`${fa(m)} دقیقه`);
    if (s || !parts.length) parts.push(`${fa(s)} ثانیه`);
    return parts.join(' و ');
  }
  const read = key => { try { return JSON.parse(localStorage.getItem(key)); } catch (_) { return null; } };
  const write = (key,value) => { try { localStorage.setItem(key,JSON.stringify(value)); return true; } catch (_) { return false; } };
  const remove = key => { try { localStorage.removeItem(key); return true; } catch (_) { return false; } };
  const iso = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
  function validSession(r) {
    return !!r && typeof r.sessionId === 'string' && /^[a-z0-9-]+$/i.test(r.sessionId) && typeof r.contentPackId === 'string'
      && (r.startedAt === null || iso(r.startedAt)) && iso(r.completedAt)
      && Number.isSafeInteger(r.durationSeconds) && r.durationSeconds >= 0
      && Number.isSafeInteger(r.score) && r.score >= 0 && r.score <= r.maxScore && r.maxScore === 8
      && Number.isSafeInteger(r.incorrectAttempts) && r.incorrectAttempts >= 0 && typeof r.bonusCorrect === 'boolean'
      && (r.perceivedDifficulty === null || ['easy','suitable','hard'].includes(r.perceivedDifficulty));
  }
  function clean(r) {
    // فقط فیلدهای schema صادر می‌شوند؛ فیلدهای ناشناس از ذخیره وارد خروجی نمی‌شوند.
    return {sessionId:r.sessionId,contentPackId:r.contentPackId,startedAt:r.startedAt,completedAt:r.completedAt,
      durationSeconds:r.durationSeconds,durationFormatted:formatDuration(r.durationSeconds),score:r.score,maxScore:r.maxScore,
      incorrectAttempts:r.incorrectAttempts,bonusCorrect:r.bonusCorrect,perceivedDifficulty:r.perceivedDifficulty,
      durationBasis:r.durationBasis === 'legacy-wall-clock' ? 'legacy-wall-clock' : 'active-monotonic',reasoning:cleanReasoning(r.reasoning)};
  }
  function cleanReasoning(value){
    if(!value||value.completed!==true||value.questionCount!==4)return null;
    for(const key of ['firstAttemptCorrect','questionsWithHints','revealedQuestions','totalAttempts','durationSeconds'])if(!Number.isSafeInteger(value[key])||value[key]<0)return null;
    if(value.firstAttemptCorrect+value.questionsWithHints!==4||value.revealedQuestions>value.questionsWithHints||value.totalAttempts<4+value.questionsWithHints+value.revealedQuestions||value.totalAttempts>4+2*value.questionsWithHints)return null;
    return {completed:true,questionCount:4,firstAttemptCorrect:value.firstAttemptCorrect,totalAttempts:value.totalAttempts,questionsWithHints:value.questionsWithHints,revealedQuestions:value.revealedQuestions,durationSeconds:value.durationSeconds};
  }
  function sessions() {
    let stored = read(historyKey);
    if (stored === null) {
      const old = read('word-workshop-results-v1');
      if (Array.isArray(old)) {
        stored = old.map(r => ({sessionId:r?.id,contentPackId:'gr-fruit',startedAt:null,completedAt:r?.completedAt,
          durationSeconds:r?.seconds,score:r?.score,maxScore:8,incorrectAttempts:r?.mistakes,
          bonusCorrect:r?.score === 8,perceivedDifficulty:r?.rating || null,durationBasis:'legacy-wall-clock'})).filter(validSession).map(clean);
        write(historyKey,stored);
      }
    }
    const rows = new Map();
    for (const r of [...(Array.isArray(stored) ? stored : []),...memory]) if (validSession(r)) rows.set(r.sessionId,clean(r));
    return [...rows.values()].sort((a,b) => Date.parse(a.completedAt)-Date.parse(b.completedAt)).slice(-100);
  }
  function putSession(row) {
    if (!validSession(row)) return false;
    memory = [...sessions().filter(r => r.sessionId !== row.sessionId),clean(row)].slice(-100);
    return write(historyKey,memory);
  }
  function clearSessions() {
    memory = [];
    return [historyKey,'word-workshop-results-v1','word-workshop-session-v1','word-workshop-session-v2'].map(remove).every(Boolean);
  }
  function exportData() {
    const rows = sessions();
    const average = key => rows.length ? Math.round(rows.reduce((sum,r)=>sum+r[key],0)/rows.length*100)/100 : null;
    const difficulty = {easy:0,suitable:0,hard:0,unanswered:0};
    for (const r of rows) difficulty[r.perceivedDifficulty || 'unanswered']++;
    return {schemaVersion,appVersion,exportedAt:new Date().toISOString(),totalSessions:rows.length,
      summary:{averageDurationSeconds:average('durationSeconds'),averageScore:average('score'),perceivedDifficulty:difficulty},sessions:rows};
  }
  function downloadJSON(data) {
    const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json;charset=utf-8'}));
    const a=document.createElement('a');a.href=url;a.download='word-lab-results.json';document.body.append(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  return {appVersion,schemaVersion,formatDuration,fa,read,write,sessions,putSession,clearSessions,exportData,downloadJSON};
})();
