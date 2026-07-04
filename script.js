(function() {
  // ---------- game state ----------
  const state = {
    players: [],
    round: 1,
    history: [],
    roles: { mafia: 1, doctor: 1, cop: 1 },
    order: ['mafia','doctor','cop'],
    phase: 'setup',
    nightSelections: { mafia: null, doctor: null, cop: null },
    discussionSeconds: 150,
    winner: null,
  };

  // DOM shortcuts
  const $ = id => document.getElementById(id);
  const show = id => $(id).classList.remove('hidden');
  const hide = id => $(id).classList.add('hidden');
  const setText = (id, txt) => $(id).textContent = txt;

  // Click sound for setup only
  const clickSound = {
    play: () => {
      if (state.phase === 'setup') {
        try {
          const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
          const oscillator = audioCtx.createOscillator();
          const gainNode = audioCtx.createGain();
          oscillator.connect(gainNode);
          gainNode.connect(audioCtx.destination);
          oscillator.frequency.value = 800;
          gainNode.gain.value = 0.1;
          oscillator.start();
          oscillator.stop(audioCtx.currentTime + 0.05);
        } catch (e) {}
      }
    }
  };

  function addClickSounds() {
    const setupButtons = document.querySelectorAll('#setup .btn');
    setupButtons.forEach(btn => btn.addEventListener('click', () => clickSound.play()));
  }

  // overlays — now driven by a .show class so CSS can transition them
  function showCopOverlay(text) { $('copResult').textContent = text; $('copOverlay').classList.add('show'); }
  function hideCopOverlay() { $('copOverlay').classList.remove('show'); }
  function showVoteOverlay(text) { $('voteOverlayText').textContent = text; $('voteOverlay').classList.add('show'); }
  function hideVoteOverlay() { $('voteOverlay').classList.remove('show'); }
  function blackout(ms=1200) {
    $('blackout').classList.add('show');
    return new Promise(r => setTimeout(() => { $('blackout').classList.remove('show'); r(); }, ms));
  }

  // ---------- speech - ALWAYS THE SAME regardless of alive/dead ----------
  function speak(text) {
    if (!window.speechSynthesis) return Promise.resolve();
    window.speechSynthesis.cancel();
    return new Promise(resolve => {
      const utter = new SpeechSynthesisUtterance(text);
      utter.rate = 0.9;
      utter.volume = 0.8;
      utter.lang = 'en-US';
      utter.onend = resolve;
      utter.onerror = resolve;
      speechSynthesis.speak(utter);
    });
  }

  async function narrate(text, delay = 1000) {
    await speak(text);
    if (delay) await sleep(delay);
  }

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // ---------- setup UI ----------
  const playerCountEl = $('playerCount');
  const nameFieldsEl = $('nameFields');
  const roleMafiaInp = $('roleMafia');
  let playerCount = 4;

  function renderNameFields() {
    nameFieldsEl.innerHTML = '';
    for (let i=0; i<playerCount; i++) {
      const wrap = document.createElement('div');
      const inp = document.createElement('input');
      inp.placeholder = `Player ${i+1}`;
      inp.value = state.players[i]?.name || '';
      inp.addEventListener('input', validateSetup);
      wrap.appendChild(inp);
      nameFieldsEl.appendChild(wrap);
    }
  }

  function validateSetup() {
    const inputs = nameFieldsEl.querySelectorAll('input');
    state.players = Array.from(inputs).map(inp => ({ name: inp.value.trim(), role: null, alive: true, revealed: false }));
    state.roles.mafia = Math.max(1, parseInt(roleMafiaInp.value) || 1);
    state.roles.doctor = $('hasDoctor').checked ? 1 : 0;
    state.roles.cop = $('hasCop').checked ? 1 : 0;

    const totalSpecial = state.roles.mafia + state.roles.doctor + state.roles.cop;
    setText('setupInfo', `special ${totalSpecial} / ${playerCount} (citizens auto)`);
    let warnMsg = '';
    if (totalSpecial > playerCount) warnMsg = '❌ too many special roles';
    else if (state.players.some(p => !p.name)) warnMsg = '✎ enter all names';
    $('roleWarning').textContent = warnMsg;
    $('startGame').disabled = !!warnMsg;
  }

  $('incPlayers').onclick = () => { playerCount = Math.min(20, playerCount+1); playerCountEl.textContent = playerCount; renderNameFields(); validateSetup(); };
  $('decPlayers').onclick = () => { playerCount = Math.max(3, playerCount-1); playerCountEl.textContent = playerCount; renderNameFields(); validateSetup(); };
  roleMafiaInp.addEventListener('input', validateSetup);
  $('hasDoctor').addEventListener('change', validateSetup);
  $('hasCop').addEventListener('change', validateSetup);
  renderNameFields(); validateSetup();
  addClickSounds();

  // ---------- start ----------
  $('startGame').onclick = () => {
    state.players = state.players.slice(0, playerCount);
    let pool = [];
    pool.push(...Array(state.roles.mafia).fill('Mafia'));
    if (state.roles.doctor) pool.push('Doctor');
    if (state.roles.cop) pool.push('Cop');
    while (pool.length < playerCount) pool.push('Citizen');
    shuffle(pool);
    state.players.forEach((p,i) => { p.role = pool[i]; p.alive = true; });
    state.round = 1; state.history = []; state.phase = 'reveal';
    toRevealPhase();
  };
  function shuffle(arr) { for (let i=arr.length-1;i>0;i--) { const j = Math.floor(Math.random()*(i+1)); [arr[i],arr[j]]=[arr[j],arr[i]]; } return arr; }

  // ---------- reveal ----------
  let revealIndex = 0;
  function toRevealPhase() {
    state.phase = 'reveal';
    switchSection('reveal');
    revealIndex = 0;
    setText('revealPlayer', state.players[0].name);
    $('roleText').classList.add('hidden');
    $('roleText').classList.remove('stamp-in');
    hide('btnNextReveal'); hide('btnContinueGame'); show('btnRevealRole');
  }

  $('btnRevealRole').onclick = () => {
    const p = state.players[revealIndex];
    const roleTextEl = $('roleText');
    roleTextEl.textContent = `${p.role.toUpperCase()}`;
    roleTextEl.classList.remove('hidden');
    // restart the stamp-slam animation each time
    roleTextEl.style.animation = 'none';
    void roleTextEl.offsetWidth; // force reflow
    roleTextEl.style.animation = '';
    hide('btnRevealRole'); show('btnNextReveal');
  };
  $('btnNextReveal').onclick = () => {
    revealIndex++;
    if (revealIndex >= state.players.length) {
      hide('btnNextReveal'); show('btnContinueGame');
      setText('revealPlayer', 'ALL ROLES REVEALED');
      $('roleText').classList.add('hidden');
    } else {
      setText('revealPlayer', state.players[revealIndex].name);
      $('roleText').classList.add('hidden');
      show('btnRevealRole'); hide('btnNextReveal');
    }
  };
  $('btnContinueGame').onclick = () => { state.phase = 'night'; state.nightSelections = { mafia: null, doctor: null, cop: null }; toNightRole('mafia'); };

  // ---------- night flow with SAME SPEECH for alive/dead ----------
  let currentNightRole = 'mafia', selectedPlayerIndex = null;

  async function toNightRole(role) {
    currentNightRole = role;

    const roleExists = (role === 'mafia' && state.roles.mafia > 0) ||
                      (role === 'doctor' && state.roles.doctor > 0) ||
                      (role === 'cop' && state.roles.cop > 0);

    if (!roleExists) {
      if (role === 'mafia') return toNightRole('doctor');
      if (role === 'doctor') return toNightRole('cop');
      if (role === 'cop') {
        await blackout(600);
        await nightResolve();
        return;
      }
    }

    const actorAlive = state.players.some(p => p.alive &&
      ((role === 'mafia' && p.role === 'Mafia') ||
       (role === 'doctor' && p.role === 'Doctor') ||
       (role === 'cop' && p.role === 'Cop')));

    selectedPlayerIndex = null;

    $('nightPlayers').innerHTML = '';
    $('nightPlayers').style.visibility = 'visible';

    if (role === 'mafia') {
      setText('wakeTitle', 'NIGHT');
      setText('wakeText', 'CLOSE YOUR EYES…');
      switchSection('wake');
      await narrate('Night falls. Everyone close your eyes.', 1200);
      await narrate('Mafia, wake up and choose.', 900);

      switchSection('night');
      setText('nightTitle', 'MAFIA · EXECUTION');
      setText('nightSub', actorAlive ? 'select target' : 'waiting for mafia...');
      renderNightPlayers(role, actorAlive);
    }
    else if (role === 'doctor') {
      switchSection('night');
      setText('nightTitle', 'DOCTOR · HEAL');
      setText('nightSub', actorAlive ? 'choose a player to heal' : 'waiting for doctor...');
      renderNightPlayers(role, actorAlive);
      await narrate('Doctor, wake up and choose someone to heal.', 900);
    }
    else if (role === 'cop') {
      switchSection('night');
      setText('nightTitle', 'COP · INVESTIGATION');
      setText('nightSub', actorAlive ? 'cannot investigate yourself' : 'waiting for cop...');
      renderNightPlayers(role, actorAlive);
      await narrate('Cop, wake up and investigate.', 900);
    }

    $('btnConfirmNight').disabled = true;

    if (!actorAlive) {
      if (window._nightTimer) clearTimeout(window._nightTimer);
      window._nightTimer = setTimeout(() => {
        $('btnConfirmNight').disabled = false;
        $('btnConfirmNight').click();
      }, 5000);
    }
  }

  function renderNightPlayers(role, actorAlive) {
    const list = $('nightPlayers'); list.innerHTML = '';
    const alive = state.players.filter(p=>p.alive);

    let actorIdx = -1;
    if (role === 'mafia') actorIdx = state.players.findIndex(p => p.alive && p.role === 'Mafia');
    else if (role === 'doctor') actorIdx = state.players.findIndex(p => p.alive && p.role === 'Doctor');
    else if (role === 'cop') actorIdx = state.players.findIndex(p => p.alive && p.role === 'Cop');

    alive.forEach(p => {
      const idx = state.players.indexOf(p);
      const btn = document.createElement('button');
      btn.className = 'player-btn';
      btn.innerHTML = `<strong>${p.name}</strong><br><span class="muted">alive</span>`;

      if (!actorAlive) btn.disabled = true;
      if (role === 'cop' && actorAlive && actorIdx !== -1 && idx === actorIdx) btn.disabled = true;

      btn.addEventListener('click', () => {
        if (!actorAlive) return;
        list.querySelectorAll('.player-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        selectedPlayerIndex = idx;
        $('btnConfirmNight').disabled = false;
      });
      list.appendChild(btn);
    });
  }

  $('btnConfirmNight').onclick = async () => {
    if (window._nightTimer) clearTimeout(window._nightTimer);

    const chosen = selectedPlayerIndex;
    const actorAlive = state.players.some(p => p.alive &&
      ((currentNightRole === 'mafia' && p.role === 'Mafia') ||
       (currentNightRole === 'doctor' && p.role === 'Doctor') ||
       (currentNightRole === 'cop' && p.role === 'Cop')));

    if (chosen != null && actorAlive) {
      if (currentNightRole === 'mafia') state.nightSelections.mafia = chosen;
      if (currentNightRole === 'doctor') state.nightSelections.doctor = chosen;
      if (currentNightRole === 'cop') state.nightSelections.cop = chosen;
    }

    $('nightPlayers').style.visibility = 'hidden';
    $('btnConfirmNight').disabled = true;

    if (currentNightRole === 'mafia') {
      await narrate('Mafia have chosen.', 800);
      await narrate('Mafia, go back to sleep.', 800);
    }
    else if (currentNightRole === 'doctor') {
      await narrate('Doctor has made a choice.', 800);
      await narrate('Doctor, go back to sleep.', 800);
    }

    await blackout(800);

    if (currentNightRole === 'mafia') return toNightRole('doctor');
    else if (currentNightRole === 'doctor') return toNightRole('cop');
    else if (currentNightRole === 'cop') {
      const copSel = state.nightSelections.cop;
      const copAlive = state.players.some(p => p.alive && p.role === 'Cop');

      if (copSel != null && state.players[copSel] && copAlive) {
        await blackout(400);
        const target = state.players[copSel];
        showCopOverlay(`${target.name} is ${target.role==='Mafia' ? 'MAFIA' : 'innocent'}`);
        await sleep(2000); hideCopOverlay();
      }

      await narrate('Cop has received a vision.', 800);
      await narrate('Cop, go back to sleep.', 800);

      await blackout(800);
      await nightResolve();
      return;
    }
  };

  async function nightResolve() {
    const killIdx = state.nightSelections.mafia;
    const healIdx = state.nightSelections.doctor;

    let died = null, saved = null;
    if (killIdx != null) {
      if (healIdx != null && healIdx === killIdx) {
        saved = state.players[healIdx].name;
      } else {
        state.players[killIdx].alive = false;
        died = state.players[killIdx].name;
      }
    }

    if (checkWin()) { switchSection('wake'); await narrate('Game over.', 1500); toGameOver(); return; }

    state.history.push({ round: state.round, nightKill: died, healed: saved, votedOut: null });
    state.phase = 'morning';

    if (checkWin()) { toGameOver(); return; }

    setText('wakeTitle', 'MORNING');
    setText('wakeText', 'EVERYONE WAKE UP');
    switchSection('wake');
    await narrate('Everyone wakes up.', 1800);
    toMorning(died, saved);
  }

  function toMorning(died, saved) {
    switchSection('morning');
    let summary = died ? `${died} was killed.` : 'No one died.';
    if (saved) summary += ` ${saved} was healed.`;
    setText('morningSummary', summary);
  }

  $('btnStartDiscussion').onclick = () => toDiscussion();

  // discussion timer
  let timerId;
  function toDiscussion() {
    state.phase = 'discussion';
    switchSection('discussion');
    let secs = state.discussionSeconds;
    updateTimer(secs);
    clearInterval(timerId);
    timerId = setInterval(() => { secs--; if (secs<=0) { clearInterval(timerId); toVoting(); } else updateTimer(secs); }, 1000);
    $('btnReduce10').onclick = () => { secs = Math.max(0, secs-10); updateTimer(secs); };
    $('btnSkipToVoting').onclick = () => { clearInterval(timerId); toVoting(); };
  }
  function updateTimer(s) {
    let m = Math.floor(s/60).toString().padStart(2,'0'), sec = (s%60).toString().padStart(2,'0');
    $('timer').textContent = `${m}:${sec}`;
    $('timer').classList.toggle('danger', s <= 10);
  }

  // voting
  let voteOrder = [], voteIndex = 0, votes = {}, voteLocked = false;
  function toVoting() {
    state.phase = 'voting';
    switchSection('voting');
    voteLocked = false;
    voteOrder = state.players.map((p,i)=>i).filter(i=>state.players[i].alive);
    voteIndex = 0; votes = {}; renderVotingTurn();
  }
  async function renderVotingTurn() {
    if (voteIndex >= voteOrder.length) {
      if (voteLocked) return; voteLocked = true;
      const tally = Object.entries(votes).map(([idx,c])=>({idx:parseInt(idx),count:c}));
      if (tally.length===0) {
        showVoteOverlay('NO VOTES · nobody eliminated');
        await narrate('No votes.',1200); hideVoteOverlay();
        state.history.push({round:state.round, nightKill:null, healed:null, votedOut:null});
        toNightOrEnd(null); return;
      }
      const max = Math.max(...tally.map(t=>t.count));
      const top = tally.filter(t=>t.count===max);
      if (top.length>1) {
        showVoteOverlay('TIE · NO ELIMINATION');
        await narrate('Tie. No one eliminated.',1500); hideVoteOverlay();
        state.history.push({round:state.round, nightKill:null, healed:null, votedOut:null});
        toNightOrEnd(null); return;
      }
      const elim = state.players[top[0].idx];
      elim.alive = false;
      showVoteOverlay(`${elim.name} ELIMINATED`);
      await narrate(`${elim.name} was eliminated.`,1600); hideVoteOverlay();
      state.history.push({round:state.round, nightKill:null, healed:null, votedOut:elim.name});
      toNightOrEnd(elim);
      return;
    }
    const voterIdx = voteOrder[voteIndex];
    const voter = state.players[voterIdx];
    setText('voterTurn', `${voter.name}, cast your vote`);
    $('voteList').innerHTML = '';
    state.players.forEach((p,idx) => {
      if (!p.alive) return;
      const btn = document.createElement('button');
      btn.className = 'player-btn';
      btn.innerHTML = `<strong>${p.name}</strong>`;
      btn.onclick = async () => {
        if (voteLocked) return; voteLocked = true;
        votes[idx] = (votes[idx]||0)+1;
        voteIndex++;
        await blackout(500);
        voteLocked = false;
        renderVotingTurn();
      };
      $('voteList').appendChild(btn);
    });
  }

  function toNightOrEnd(elim) {
    if (checkWin()) toGameOver();
    else {
      state.round++;
      state.nightSelections = { mafia:null, doctor:null, cop:null };
      toNightRole('mafia');
    }
  }

  // win condition
  function checkWin() {
    const alive = state.players.filter(p=>p.alive);
    const mafiaAlive = alive.filter(p=>p.role==='Mafia').length;
    const town = alive.length - mafiaAlive;
    if (mafiaAlive === 0) { state.winner = 'CITIZENS'; return true; }
    if (mafiaAlive >= town) { state.winner = 'MAFIA'; return true; }
    return false;
  }

  function toGameOver() {
    state.phase = 'gameover';
    switchSection('gameover');
    setText('winner', `${state.winner} WIN`);
    const results = $('results'); results.innerHTML = '';
    state.players.forEach(p => {
      const row = document.createElement('div'); row.className = 'result-row';
      row.innerHTML = `<div>${p.name}</div><div><span class="chip">${p.role}</span></div><div class="${p.alive?'alive':'dead'}">${p.alive?'Alive':'Dead'}</div>`;
      results.appendChild(row);
    });
    const historyDiv = $('history'); historyDiv.innerHTML = '';
    state.history.forEach(h => {
      const line = document.createElement('div'); line.className = 'subtitle';
      line.style.marginBottom = '4px';
      line.innerHTML = `Round ${h.round} · kill: ${h.nightKill||'—'} · heal: ${h.healed||'—'} · vote: ${h.votedOut||'—'}`;
      historyDiv.appendChild(line);
    });
  }

  // play again / home
  $('btnPlayAgain').onclick = () => { playAgain(); };
  function playAgain() {
    const names = state.players.map(p=>p.name);
    state.players = names.map(n=>({ name: n, role: null, alive: true }));
    let pool = []; pool.push(...Array(state.roles.mafia).fill('Mafia')); if(state.roles.doctor) pool.push('Doctor'); if(state.roles.cop) pool.push('Cop');
    while(pool.length < playerCount) pool.push('Citizen'); shuffle(pool);
    state.players.forEach((p,i)=>p.role=pool[i]);
    state.round = 1; state.history = []; state.phase = 'reveal'; toRevealPhase();
  }
  $('btnReturnHome').onclick = () => { window.location.reload(); };

  function switchSection(id) {
    ['setup','reveal','night','wake','morning','discussion','voting','gameover'].forEach(s => { if(s===id) show(s); else hide(s); });
    document.body.dataset.phase = id;
    $('blackout').classList.remove('show');
  }
})();
