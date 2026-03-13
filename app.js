// ========================
// FIREBASE CONFIGURATION
// ========================
const firebaseConfig = {
    apiKey: "AIzaSyAaQykg-W2vxI6gnClCPdusj5NyE_RMpEo",
    authDomain: "slc-election.firebaseapp.com",
    projectId: "slc-election",
    storageBucket: "slc-election.firebasestorage.app",
    messagingSenderId: "536346306810",
    appId: "1:536346306810:web:f0cea5355037f6b073c143",
    measurementId: "G-FW7JMNH087"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// ========================
// APP STATE
// ========================
const ADMIN_PASS = "00110011";
const STORAGE_KEY = "slc_player_id";

let state = {
    role: null,
    currentUser: null,
    players: [],
    matches: [],
    appState: { currentRound: 0, deadline: null },
    selectedRound: null,      // for player fixture filter
    adminSelectedRound: null  // for admin fixture filter
};
let timerInterval = null;
let unsubscribers = [];
let lastScores = { apex: -1, phantom: -1 };

// ========================
// TOAST SYSTEM
// ========================
let toastTimeout = null;

function showToast(msg, icon = 'info') {
    const toast = document.getElementById('toast');
    const toastMsg = document.getElementById('toast-msg');
    const toastIcon = document.getElementById('toast-icon');

    if (!toast || !toastMsg) return;

    toastMsg.innerText = msg;
    if (toastIcon) {
        toastIcon.setAttribute('data-lucide', icon);
        lucide.createIcons({ icons: { [icon]: lucide[icon] || lucide.info } });
    }

    toast.classList.add('show');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => toast.classList.remove('show'), 3000);
}

// ========================
// UTILITIES
// ========================
function copyID(text) {
    if (!text || text === '—') return;
    navigator.clipboard.writeText(text)
        .then(() => showToast(`Copied: ${text}`, 'copy'))
        .catch(() => showToast('Could not copy — try manually', 'alert-circle'));
}

function generateID() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let suffix = '';
    for (let i = 0; i < 4; i++) suffix += chars[Math.floor(Math.random() * chars.length)];
    return 'PRACTICE' + suffix;
}

function formatTime(ms) {
    if (ms <= 0) return 'TIME UP';
    const totalSeconds = Math.floor(ms / 1000);
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function saveSession(id) { try { localStorage.setItem(STORAGE_KEY, id); } catch(e) {} }
function clearSession()  { try { localStorage.removeItem(STORAGE_KEY); } catch(e) {} }
function getSavedSession(){ try { return localStorage.getItem(STORAGE_KEY); } catch(e) { return null; } }

// ========================
// AUTH — TAB SWITCHER
// ========================
function switchTab(tab) {
    const forms = ['login', 'register', 'admin'];
    forms.forEach(f => {
        const form = document.getElementById(f + '-form');
        const btn  = document.getElementById('tab-' + (f === 'login' ? 'login' : f === 'register' ? 'reg' : 'admin'));
        if (!form || !btn) return;
        form.classList.toggle('hidden', f !== tab);
        btn.classList.toggle('active', f === tab);
    });
    // Focus the first input in the shown form
    setTimeout(() => {
        const input = document.querySelector(`#${tab}-form input`);
        if (input) input.focus();
    }, 50);
}

// ========================
// AUTH — REGISTER & LOGIN
// ========================
async function registerPlayer() {
    const nameEl = document.getElementById('reg-name');
    const name = nameEl.value.trim();
    if (!name) return showToast('Enter your in-game name!', 'alert-circle');
    if (name.length < 2) return showToast('Name must be at least 2 characters', 'alert-circle');

    showToast('Creating your player ID...', 'loader');

    try {
        const id = generateID();
        await db.collection('players').doc(id).set({
            id,
            name: name.toUpperCase(),
            team: null,
            createdAt: new Date()
        });
        nameEl.value = '';
        showToast(`Welcome ${name.toUpperCase()}! Logging in...`, 'check-circle');
        await loginAs(id);
    } catch (err) {
        console.error('Registration error:', err);
        showToast('Registration failed — try again', 'x-circle');
    }
}

async function loginPlayer() {
    const idEl = document.getElementById('login-id');
    const id = idEl.value.trim().toUpperCase();
    if (!id) return showToast('Enter your Player ID', 'alert-circle');

    showToast('Verifying ID...', 'loader');
    try {
        await loginAs(id);
    } catch (err) {
        console.error('Login error:', err);
        showToast('Connection error — check your internet', 'wifi-off');
    }
}

async function loginAs(id) {
    try {
        const doc = await db.collection('players').doc(id).get();
        if (!doc.exists) {
            showToast('Player ID not found!', 'x-circle');
            return;
        }
        state.role = 'player';
        state.currentUser = doc.data();
        saveSession(id);
        launchApp('player');
    } catch (err) {
        console.error('loginAs error:', err);
        showToast('Login failed — check your connection', 'wifi-off');
    }
}

function loginAdmin() {
    const pass = document.getElementById('admin-pass').value;
    if (pass !== ADMIN_PASS) return showToast('Wrong admin password!', 'x-circle');
    state.role = 'admin';
    document.getElementById('admin-pass').value = '';
    launchApp('admin');
}

function logout() {
    // Unsubscribe all Firestore listeners
    unsubscribers.forEach(fn => { try { fn(); } catch(e) {} });
    unsubscribers = [];
    clearInterval(timerInterval);
    timerInterval = null;

    state.role = null;
    state.currentUser = null;
    state.players = [];
    state.matches = [];
    state.appState = { currentRound: 0, deadline: null };
    state.selectedRound = null;
    state.adminSelectedRound = null;
    lastScores = { apex: -1, phantom: -1 };
    clearSession();

    document.getElementById('app-screen').classList.add('app-screen-hidden');
    document.getElementById('auth-screen').classList.remove('hidden');
    document.getElementById('login-id').value = '';
    switchTab('login');
    lucide.createIcons();
}

// ========================
// APP LAUNCH
// ========================
function launchApp(role) {
    document.getElementById('auth-screen').classList.add('hidden');
    const appScreen = document.getElementById('app-screen');
    appScreen.classList.remove('app-screen-hidden');

    document.getElementById('player-view').classList.toggle('hidden', role !== 'player');
    document.getElementById('admin-view').classList.toggle('hidden', role !== 'admin');

    // Set header user badge
    const badge = document.getElementById('header-user-badge');
    if (badge) {
        if (role === 'player' && state.currentUser) {
            badge.textContent = state.currentUser.name;
            badge.classList.remove('hidden');
        } else if (role === 'admin') {
            badge.textContent = 'ADMIN';
            badge.classList.remove('hidden');
        }
    }

    loadData();
}

// ========================
// AUTO-LOGIN FROM SESSION
// ========================
async function tryAutoLogin() {
    const savedId = getSavedSession();
    if (!savedId) return;

    try {
        const doc = await db.collection('players').doc(savedId).get();
        if (doc.exists) {
            state.role = 'player';
            state.currentUser = doc.data();
            launchApp('player');
        } else {
            clearSession();
        }
    } catch (e) {
        // silently fail auto-login
    }
}

// ========================
// REAL-TIME DATA SUBSCRIPTION
// ========================
function loadData() {
    // Players
    const u1 = db.collection('players').onSnapshot(snap => {
        state.players = snap.docs.map(d => d.data());
        
        // NEW: currentUser এর ডাটা রিয়েলটাইম আপডেট করা হচ্ছে
        if (state.currentUser) {
            const updatedUser = state.players.find(p => p.id === state.currentUser.id);
            if (updatedUser) state.currentUser = updatedUser;
        }
        
        renderUI();
    }, err => { console.error('Players listener error:', err); showToast('Sync error — refreshing...', 'wifi-off'); });

    // Matches
    const u2 = db.collection('matches').onSnapshot(snap => {
        state.matches = snap.docs.map(d => ({ docId: d.id, ...d.data() }));
        renderUI();
    }, err => { console.error('Matches listener error:', err); });

    // System state
    const u3 = db.collection('system').doc('state').onSnapshot(snap => {
        if (snap.exists) {
            const newState = snap.data();
            state.appState = newState;
            startTimer(newState.deadline);
        } else {
            state.appState = { currentRound: 0, deadline: null };
        }
        renderUI();
    }, err => { console.error('System state listener error:', err); });

    unsubscribers = [u1, u2, u3];
}

// ========================
// TIMER
// ========================
function startTimer(deadlineIso) {
    clearInterval(timerInterval);
    const displays = document.querySelectorAll('.timer-display');

    if (!deadlineIso) {
        displays.forEach(el => el.textContent = '--:--:--');
        return;
    }

    const target = new Date(deadlineIso).getTime();

    function tick() {
        const diff = target - Date.now();
        const text = formatTime(diff);
        displays.forEach(el => el.textContent = text);
        if (diff <= 0) clearInterval(timerInterval);
    }

    tick();
    timerInterval = setInterval(tick, 1000);
}

// ========================
// MAIN UI RENDER
// ========================
function renderUI() {
    renderScoreboard();
    if (state.role === 'player') {
        renderPlayerProfile();
        renderPlayerStats();
        renderRoundFilterBtns();
        renderFixtures('player-fixtures', false);
    } else if (state.role === 'admin') {
        renderAdminPlayers();
        renderAdminRoundFilter();
        renderFixtures('admin-fixtures', true);
        updateAdminRoundStatus();
    }
    lucide.createIcons();
}

// ========================
// SCOREBOARD
// ========================
function renderScoreboard() {
    let tPoints = 0, sPoints = 0;
    let completed = 0, pending = 0;
    const cr = state.appState.currentRound;

    state.matches.forEach(m => {
        if (m.status === 'completed') {
            completed++;
            if (m.score1 > m.score2)       tPoints += 3;
            else if (m.score2 > m.score1)  sPoints += 3;
            else { tPoints += 1; sPoints += 1; }
        } else {
            pending++;
        }
    });

    // Animate score if changed
    const newT = tPoints, newS = sPoints;
    document.querySelectorAll('.score-apex').forEach(el => {
        if (lastScores.apex !== -1 && newT !== lastScores.apex) {
            el.classList.remove('score-bump');
            void el.offsetWidth; // reflow
            el.classList.add('score-bump');
        }
        el.textContent = newT;
    });
    document.querySelectorAll('.score-phantom').forEach(el => {
        if (lastScores.phantom !== -1 && newS !== lastScores.phantom) {
            el.classList.remove('score-bump');
            void el.offsetWidth;
            el.classList.add('score-bump');
        }
        el.textContent = newS;
    });
    lastScores = { apex: newT, phantom: newS };

    // Scoreboard stats row
    const statsRow = document.getElementById('scoreboard-stats');
    if (statsRow && (completed > 0 || cr > 0)) {
        statsRow.classList.remove('hidden');
        const statComp    = document.getElementById('stat-completed');
        const statPend    = document.getElementById('stat-pending');
        const statRound   = document.getElementById('stat-round');
        if (statComp)  statComp.textContent  = completed;
        if (statPend)  statPend.textContent  = pending;
        if (statRound) statRound.textContent = cr > 0 ? `R${cr}` : '—';
    }
    // --- NEW CODE: Render Individual Match Results for Current Round ---
const resultsContainer = document.getElementById('scorecard-individual-results');
if (resultsContainer) {
    if (cr > 0) {
        const currentRoundMatches = state.matches.filter(m => m.round === cr);
        if (currentRoundMatches.length > 0) {
            resultsContainer.classList.remove('hidden');
            let resultsHtml = `<div class="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-3 text-center sticky top-0 bg-[#060a13] py-1 z-10">Round ${cr} Results</div>`;
            
            currentRoundMatches.forEach(m => {
                const isCompleted = m.status === 'completed';
                const s1 = isCompleted ? m.score1 : '-';
                const s2 = isCompleted ? m.score2 : '-';
                
                // Determine colors based on win/loss/draw
                let s1Class = 'bg-slate-800 text-slate-400 border border-slate-700';
                let s2Class = 'bg-slate-800 text-slate-400 border border-slate-700';
                
                if (isCompleted) {
                    if (m.score1 > m.score2) { // P1 Wins
                        s1Class = 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30';
                        s2Class = 'bg-rose-500/20 text-rose-400 border border-rose-500/30';
                    } else if (m.score2 > m.score1) { // P2 Wins
                        s1Class = 'bg-rose-500/20 text-rose-400 border border-rose-500/30';
                        s2Class = 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30';
                    } else { // Draw
                        s1Class = 'bg-gold-500/20 text-gold-400 border border-gold-500/30';
                        s2Class = 'bg-gold-500/20 text-gold-400 border border-gold-500/30';
                    }
                }
                
                resultsHtml += `
                        <div class="flex items-center justify-between bg-black/40 rounded-lg p-2 border border-white/5">
                            <div class="flex-1 text-right pr-3 text-[11px] font-bold text-white truncate">${m.p1_name || '?'}</div>
                            
                            <div class="flex items-center gap-1.5 flex-shrink-0">
                                <div class="w-6 h-6 flex items-center justify-center rounded font-black text-[12px] ${s1Class}">${s1}</div>
                                <div class="text-[8px] text-slate-600 font-bold">VS</div>
                                <div class="w-6 h-6 flex items-center justify-center rounded font-black text-[12px] ${s2Class}">${s2}</div>
                            </div>
                            
                            <div class="flex-1 text-left pl-3 text-[11px] font-bold text-white truncate">${m.p2_name || '?'}</div>
                        </div>
                    `;
            });
            resultsContainer.innerHTML = resultsHtml;
        } else {
            resultsContainer.classList.add('hidden');
        }
    } else {
        resultsContainer.classList.add('hidden');
    }
}
}


// PLAYER PROFILE
function renderPlayerProfile() {
    if (!state.currentUser) return;
    const u = state.players.find(p => p.id === state.currentUser.id) || state.currentUser;
    
    const nameEl = document.getElementById('prof-name');
    const idEl = document.getElementById('prof-id');
    const teamEl = document.getElementById('prof-team');
    const avatarEl = document.getElementById('prof-avatar');
    
    if (nameEl) nameEl.textContent = u.name || '—';
    if (idEl) idEl.textContent = u.id || '—';
    
    if (teamEl && avatarEl) {
        avatarEl.className = 'player-avatar-box';
        if (u.team === 'APEX') {
            teamEl.className = 'badge badge-apex';
            teamEl.textContent = '⚔ APEX';
            avatarEl.classList.add('apex');
        } else if (u.team === 'PHANTOM') {
            teamEl.className = 'badge badge-phantom';
            teamEl.textContent = '🛡 PHANTOM';
            avatarEl.classList.add('phantom');
        } else {
            teamEl.className = 'badge badge-gold';
            teamEl.textContent = '⏳ Pending Team';
        }
        if (u.isCaptain) {
            teamEl.innerHTML += ` <span class="ml-1 px-1 bg-gold-500 text-black rounded text-[7px] font-black tracking-widest uppercase">Captain</span>`;
            avatarEl.style.boxShadow = "0 0 15px rgba(245,158,11,0.4)";
            avatarEl.style.borderColor = "var(--gold-bright)";
        } else {
            avatarEl.style.boxShadow = "";
            avatarEl.style.borderColor = "";
        }
    }
}

// ========================
// PLAYER STATS
// ========================
function computePlayerStats(playerId) {
    const myMatches = state.matches.filter(m =>
        (m.p1_id === playerId || m.p2_id === playerId) && m.status === 'completed'
    );
    let wins = 0, draws = 0, losses = 0;
    myMatches.forEach(m => {
        const isP1 = m.p1_id === playerId;
        const myScore  = isP1 ? m.score1 : m.score2;
        const oppScore = isP1 ? m.score2 : m.score1;
        if (myScore >  oppScore) wins++;
        else if (myScore < oppScore) losses++;
        else draws++;
    });
    return { wins, draws, losses, pts: wins * 3 + draws };
}

function renderPlayerStats() {
    if (!state.currentUser) return;
    const stats = computePlayerStats(state.currentUser.id);
    const hasAny = state.matches.some(m =>
        (m.p1_id === state.currentUser.id || m.p2_id === state.currentUser.id) && m.status === 'completed'
    );

    const row = document.getElementById('player-stats-row');
    if (!row) return;

    if (hasAny) {
        row.classList.remove('hidden');
        row.classList.add('grid');
        const winEl  = document.getElementById('stat-wins');
        const drawEl = document.getElementById('stat-draws');
        const lossEl = document.getElementById('stat-losses');
        const ptsEl  = document.getElementById('stat-pts');
        if (winEl)  winEl.textContent  = stats.wins;
        if (drawEl) drawEl.textContent = stats.draws;
        if (lossEl) lossEl.textContent = stats.losses;
        if (ptsEl)  ptsEl.textContent  = stats.pts;
    } else {
        row.classList.add('hidden');
        row.classList.remove('grid');
    }
}

// ========================
// ROUND FILTER (Player)
// ========================
function renderRoundFilterBtns() {
    const container = document.getElementById('round-filter-btns');
    if (!container) return;

    const cr = state.appState.currentRound;
    if (cr === 0) { container.innerHTML = ''; return; }

    const rounds = [];
    for (let r = 1; r <= cr; r++) rounds.push(r);

    // Default to current round if no selection
    if (!state.selectedRound || state.selectedRound > cr) {
        state.selectedRound = cr;
    }

    container.innerHTML = rounds.map(r => `
        <button class="round-tab-btn ${state.selectedRound === r ? 'active' : ''}"
            onclick="setPlayerRound(${r})">R${r}</button>
    `).join('');
}

function setPlayerRound(r) {
    state.selectedRound = r;
    renderRoundFilterBtns();
    renderFixtures('player-fixtures', false);
}

// ========================
// ADMIN ROUND FILTER
// ========================
function renderAdminRoundFilter() {
    const container = document.getElementById('admin-round-filter');
    if (!container) return;

    const cr = state.appState.currentRound;
    if (cr === 0) { container.innerHTML = ''; return; }

    const rounds = [];
    for (let r = 1; r <= cr; r++) rounds.push(r);

    if (!state.adminSelectedRound || state.adminSelectedRound > cr) {
        state.adminSelectedRound = cr;
    }

    container.innerHTML = rounds.map(r => `
        <button class="round-tab-btn ${state.adminSelectedRound === r ? 'active' : ''}"
            onclick="setAdminRound(${r})">R${r}</button>
    `).join('');
}

function setAdminRound(r) {
    state.adminSelectedRound = r;
    renderAdminRoundFilter();
    renderFixtures('admin-fixtures', true);
}

// ========================
// FIXTURES RENDERER
// ========================
// ========================
// FIXTURES RENDERER (PREMIUM UI)
// ========================
function renderFixtures(containerId, isAdmin) {
    const list = document.getElementById(containerId);
    if (!list) return;

    const cr = state.appState.currentRound;
    if (cr === 0) {
        list.innerHTML = `
            <div class="glass-panel rounded-2xl p-8 text-center border border-dashed border-white/10">
                <i data-lucide="calendar-clock" class="w-8 h-8 text-slate-600 mx-auto mb-3"></i>
                <p class="text-[11px] font-black text-slate-500 uppercase tracking-widest">Waiting for admin to generate matches...</p>
            </div>`;
        lucide.createIcons();
        return;
    }

    const viewRound = isAdmin
        ? (state.adminSelectedRound || cr)
        : (state.selectedRound || cr);

    const roundMatches = state.matches
        .filter(m => m.round === viewRound)
        .sort((a, b) => (a.p1_name || '').localeCompare(b.p1_name || ''));

    if (roundMatches.length === 0) {
        list.innerHTML = `<p class="text-center text-slate-500 text-xs py-8 font-bold">No matches in this round</p>`;
        return;
    }

    const userId = state.currentUser?.id;
    let html = '';

    roundMatches.forEach((m, idx) => {
        const isMine = !isAdmin && (userId === m.p1_id || userId === m.p2_id);
        const isCompleted = m.status === 'completed';

        const myTeam = state.currentUser?.team;
        const isMyTeamMatch = myTeam && (m.p1_team === myTeam || m.p2_team === myTeam);
        const isCaptainAuth = !isAdmin && state.currentUser?.isCaptain && isMyTeamMatch;

        // Determine outcome for player view
        let outcomeHtml = '';
        if (isMine && isCompleted) {
            const isP1 = userId === m.p1_id;
            const myScore  = isP1 ? m.score1 : m.score2;
            const oppScore = isP1 ? m.score2 : m.score1;
            if (myScore > oppScore)       outcomeHtml = `<div class="match-result-badge win">VICTORY</div>`;
            else if (myScore < oppScore)  outcomeHtml = `<div class="match-result-badge loss">DEFEAT</div>`;
            else                          outcomeHtml = `<div class="match-result-badge draw">DRAW</div>`;
        }

        // Score or action section
        let centerHtml;
        if (isCompleted) {
            const s1 = m.score1 ?? '?', s2 = m.score2 ?? '?';
            centerHtml = `
                <div class="flex flex-col items-center justify-center w-full">
                    <div class="flex items-center gap-2 mb-1">
                        <div class="score-box score-apex-box">${s1}</div>
                        <div class="text-[9px] font-black text-slate-500 italic">VS</div>
                        <div class="score-box score-phantom-box">${s2}</div>
                    </div>
                    ${outcomeHtml}
                    ${isAdmin ? `
                        <button onclick="openResultModal('${m.docId}','${m.p1_name}','${m.p2_name}',${m.round})" 
                            class="admin-edit-score-btn mt-2">
                            <i data-lucide="edit-3" class="w-3 h-3 inline-block mr-0.5 mb-0.5"></i>Edit Score
                        </button>
                    ` : ''}
                </div>`;
        } else {
            const canSubmit = isMine || isAdmin || isCaptainAuth;
            centerHtml = `
                <div class="flex flex-col items-center justify-center">
                    <div class="vs-shield mb-2">
                        <i data-lucide="swords" class="w-4 h-4 text-slate-400"></i>
                    </div>
                    ${canSubmit
                        ? `<button onclick="openResultModal('${m.docId}','${m.p1_name}','${m.p2_name}',${m.round})"
                              class="action-btn-submit">Submit Score</button>`
                        : `<span class="badge badge-pending">PENDING</span>`
                    }
                </div>`;
        }

        html += `
        <div class="premium-match-card ${isMine ? 'is-my-match' : ''} ${isCompleted ? 'is-completed' : ''} animate-float-in" style="animation-delay: ${idx * 0.05}s;">
            ${isMine ? `<div class="my-match-indicator"><i data-lucide="star" class="w-2.5 h-2.5 inline-block mr-1"></i>YOUR MATCH</div>` : ''}
            
            <div class="premium-match-inner">
                <!-- APEX Side -->
                <div class="player-col">
                    <div class="team-mini-label text-purple-400">APEX</div>
                    <div class="player-name-display">${m.p1_name || '?'}</div>
                </div>
                
                <!-- Center VS / Score -->
                <div class="center-col">
                    ${centerHtml}
                </div>
                
                <!-- PHANTOM Side -->
                <div class="player-col">
                    <div class="team-mini-label text-cyan-400">PHANTOM</div>
                    <div class="player-name-display">${m.p2_name || '?'}</div>
                </div>
            </div>
        </div>`;
    });

    list.innerHTML = html;
    lucide.createIcons();
}

// ========================
// ADMIN — PLAYER LIST
// ========================
function renderAdminPlayers() {
    const list  = document.getElementById('admin-player-list');
    const empty = document.getElementById('admin-player-empty');
    if (!list) return;

    const apexCount   = state.players.filter(p => p.team === 'APEX').length;
    const phantomCount = state.players.filter(p => p.team === 'PHANTOM').length;

    const ctT = document.getElementById('count-apex');
    const ctS = document.getElementById('count-phantom');
    if (ctT) ctT.textContent = apexCount;
    if (ctS) ctS.textContent = phantomCount;

    if (state.players.length === 0) {
        list.innerHTML = '';
        if (empty) empty.classList.remove('hidden');
        return;
    }
    if (empty) empty.classList.add('hidden');

    // Sort: unassigned first, then apex, then phantom
    const sorted = [...state.players].sort((a, b) => {
        const order = { null: 0, undefined: 0, APEX: 1, PHANTOM: 2 };
        return (order[a.team] ?? 0) - (order[b.team] ?? 0);
    });

    list.innerHTML = sorted.map(p => `
        <div class="player-admin-card ${p.team === 'APEX' ? 'is-apex' : p.team === 'PHANTOM' ? 'is-phantom' : ''}">
            <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 mb-0.5">
                    <span class="text-[12px] font-black text-white uppercase truncate">${p.name}</span>
                    <button onclick="copyID('${p.id}')" title="Copy ID"
                        class="text-slate-600 hover:text-slate-300 transition-colors flex-shrink-0">
                        <i data-lucide="copy" class="w-3 h-3"></i>
                    </button>
                </div>
                <div class="text-[9px] text-slate-500 font-black tracking-widest">${p.id}</div>
            </div>
            <div class="flex items-center gap-1 flex-shrink-0">
                <!-- NEW CROWN BUTTON -->
                <button onclick="toggleCaptain('${p.id}', '${p.team}', ${!!p.isCaptain})"
                    class="captain-btn ${p.isCaptain ? 'is-captain' : ''}" 
                    title="${p.isCaptain ? 'Remove Captain' : 'Make Team Captain'}">
                    <i data-lucide="crown" class="w-3 h-3"></i>
                </button>

                <!-- TEAM ASSIGN BUTTONS -->
                <button onclick="assignTeam('${p.id}', 'APEX')"
                    class="team-assign-btn ${p.team === 'APEX' ? 'apex-active' : ''}">A</button>
                <button onclick="assignTeam('${p.id}', 'PHANTOM')"
                    class="team-assign-btn ${p.team === 'PHANTOM' ? 'phantom-active' : ''}">P</button>
                
                <!-- DELETE BUTTON -->
                <button onclick="deletePlayer('${p.id}', '${p.name}')"
                    class="delete-player-btn" title="Remove player">
                    <i data-lucide="trash-2" class="w-3 h-3"></i>
                </button>
            </div> 
            </div>`).join('');

    lucide.createIcons();
}

function updateAdminRoundStatus() {
    const el = document.getElementById('admin-round-status');
    if (!el) return;
    const cr = state.appState.currentRound;
    if (cr === 0) {
        el.innerHTML = `<span class="badge badge-slate">Not Started</span>`;
    } else if (cr >= 3) {
        el.innerHTML = `<span class="badge badge-gold">⚡ Tournament Complete — All Rounds Done</span>`;
    } else {
        const pending = state.matches.filter(m => m.round === cr && m.status !== 'completed').length;
        const comp    = state.matches.filter(m => m.round === cr && m.status === 'completed').length;
        el.innerHTML = `
            <span class="badge badge-emerald">Round ${cr} Active</span>
            <span class="ml-2 text-[8px] text-slate-500 font-bold">${comp} done · ${pending} pending</span>
        `;
    }
}

// ========================
// ADMIN ACTIONS
// ========================
async function toggleCaptain(playerId, team, isCurrentlyCaptain) {
    if (!team) return showToast('Assign player to a team first!', 'alert-circle');
    
    try {
        const batch = db.batch();
        
        if (!isCurrentlyCaptain) {
            // Find if this team already has a captain, and demote them
            const currentCap = state.players.find(p => p.team === team && p.isCaptain);
            if (currentCap) {
                batch.update(db.collection('players').doc(currentCap.id), { isCaptain: false });
            }
            // Promote the new player
            batch.update(db.collection('players').doc(playerId), { isCaptain: true });
            showToast('Team Captain assigned!', 'crown');
        } else {
            // Just demote the current player
            batch.update(db.collection('players').doc(playerId), { isCaptain: false });
            showToast('Captain status removed', 'user-minus');
        }
        
        await batch.commit();
    } catch (err) {
        console.error('Captain toggle error:', err);
        showToast('Failed to update captain', 'x-circle');
    }
}

async function assignTeam(id, teamName) {
    try {
        await db.collection('players').doc(id).update({ team: teamName });
    } catch (err) {
        showToast('Failed to assign team', 'x-circle');
    }
}

async function deletePlayer(id, name) {
    showConfirmModal(
        `Remove "${name}" (${id}) from the tournament? This cannot be undone.`,
        async () => {
            try {
                await db.collection('players').doc(id).delete();
                showToast(`${name} removed`, 'user-minus');
            } catch (err) {
                showToast('Failed to delete player', 'x-circle');
            }
        }
    );
}

async function setAdminDeadline() {
    const dt = document.getElementById('admin-deadline').value;
    if (!dt) return showToast('Select a date and time', 'alert-circle');
    try {
        await db.collection('system').doc('state').set(
            { deadline: new Date(dt).toISOString() },
            { merge: true }
        );
        showToast('Deadline updated!', 'check-circle');
    } catch (err) {
        showToast('Failed to set deadline', 'x-circle');
    }
}

async function generateMatches() {
    const apex   = state.players.filter(p => p.team === 'APEX');
    const phantom = state.players.filter(p => p.team === 'PHANTOM');

    // চেকিং: ১২ জন করে আছে কিনা
    if (apex.length !== 12 || phantom.length !== 12) {
        return showToast(
            `Need 12 per team. APEX: ${apex.length}, PHANTOM: ${phantom.length}`,
            'alert-circle'
        );
    }

    showConfirmModal(
        `Generate fresh matches for ${apex.length} APEX vs ${phantom.length} PHANTOM? This will delete all existing matches.`,
        async () => {
            try {
                showToast('Generating 3 rounds of matches...', 'loader');
                const batch = db.batch();

                // আগের সব ম্যাচ ক্লিয়ার করা
                const oldMatches = await db.collection('matches').get();
                oldMatches.forEach(doc => batch.delete(doc.ref));

                let matchCount = 0;
                // ৩ রাউন্ডের জন্য রাউন্ড-রবিন ম্যাচ তৈরি (৩ * ১২ = ৩৬ ম্যাচ)
                for (let round = 1; round <= 3; round++) {
                    const offset = round - 1;
                    for (let i = 0; i < 12; i++) {
                        const p1 = apex[i];
                        const p2 = phantom[(i + offset) % 12];
                        
                        // ডাটা সেফটি চেক
                        if (!p1 || !p2) continue;

                        const matchRef = db.collection('matches').doc();
                        batch.set(matchRef, {
                            round: round,
                            p1_id: p1.id || 'Unknown', 
                            p1_name: p1.name || 'Unknown', 
                            p1_team: 'APEX',
                            p2_id: p2.id || 'Unknown', 
                            p2_name: p2.name || 'Unknown', 
                            p2_team: 'PHANTOM',
                            score1: null, 
                            score2: null,
                            status: 'pending'
                        });
                        matchCount++;
                    }
                }

                // সিস্টেম স্টেট আপডেট করা
                batch.set(
                    db.collection('system').doc('state'),
                    { currentRound: 1 },
                    { merge: true }
                );

                // ফায়ারবেসে সব একসাথে সেভ করা
                await batch.commit();
                
                state.selectedRound = 1;
                state.adminSelectedRound = 1;
                renderUI(); // UI সাথে সাথে আপডেট করার জন্য
                
                showToast(`${matchCount} matches generated! Round 1 is live.`, 'check-circle');
            } catch (err) {
                console.error('Generate matches error:', err);
                // ফায়ারবেসের কারণে ফেইল হলে এরর মেসেজ দেখাবে
                showToast('Failed to generate: ' + err.message, 'x-circle');
            }
        }
    );
}

async function startNextRound() {
    const cr = state.appState.currentRound;
    if (cr === 0)  return showToast('No active tournament — draw matches first', 'alert-circle');
    if (cr >= 3)   return showToast('All 3 rounds complete!', 'trophy');

    const pending = state.matches.filter(m => m.round === cr && m.status !== 'completed');
    if (pending.length > 0) {
        return showToast(`${pending.length} match${pending.length > 1 ? 'es' : ''} still pending in Round ${cr}`, 'alert-circle');
    }

    try {
        await db.collection('system').doc('state').update({ currentRound: cr + 1 });
        state.adminSelectedRound = cr + 1;
        showToast(`Round ${cr + 1} started!`, 'play-circle');
    } catch (err) {
        showToast('Failed to advance round', 'x-circle');
    }
}

async function clearAllData() {
    try {
        showToast('Clearing all data...', 'loader');
        const batch = db.batch();

        const [matchesSnap, playersSnap] = await Promise.all([
            db.collection('matches').get(),
            db.collection('players').get()
        ]);

        matchesSnap.forEach(doc => batch.delete(doc.ref));
        playersSnap.forEach(doc => batch.delete(doc.ref));

        batch.set(db.collection('system').doc('state'), {
            currentRound: 0,
            deadline: null
        });

        await batch.commit();
        state.selectedRound = null;
        state.adminSelectedRound = null;
        showToast('All data cleared successfully', 'check-circle');
    } catch (err) {
        console.error('Clear data error:', err);
        showToast('Failed to clear data', 'x-circle');
    }
}

function confirmClearData() {
    showConfirmModal(
        'This will permanently delete ALL players, matches, and reset the tournament. This cannot be undone!',
        clearAllData
    );
}

// ========================
// RESULT MODAL
// ========================
let currentMatchId = null;

function openResultModal(id, p1, p2, round) {
    currentMatchId = id;
    const p1El      = document.getElementById('res-p1');
    const p2El      = document.getElementById('res-p2');
    const roundEl   = document.getElementById('res-round-label');
    const s1El      = document.getElementById('input-s1');
    const s2El      = document.getElementById('input-s2');
    const modal     = document.getElementById('modal-result');

    if (p1El)    p1El.textContent    = p1 || '?';
    if (p2El)    p2El.textContent    = p2 || '?';
    if (roundEl) roundEl.textContent = round ? `Round ${round}` : 'Round —';
    if (s1El)    s1El.value          = '';
    if (s2El)    s2El.value          = '';

    if (modal) {
        modal.classList.remove('hidden');
        modal.style.display = 'flex';
        // Focus first input
        setTimeout(() => { if (s1El) s1El.focus(); }, 100);
    }
}

function closeResultModal() {
    const modal = document.getElementById('modal-result');
    if (modal) {
        modal.classList.add('hidden');
        modal.style.display = '';
    }
    currentMatchId = null;
}

async function saveResult() {
    const s1Raw = document.getElementById('input-s1').value;
    const s2Raw = document.getElementById('input-s2').value;
    const s1 = parseInt(s1Raw, 10);
    const s2 = parseInt(s2Raw, 10);

    if (s1Raw === '' || s2Raw === '') return showToast('Enter scores for both players', 'alert-circle');
    if (isNaN(s1) || isNaN(s2))       return showToast('Scores must be valid numbers', 'alert-circle');
    if (s1 < 0 || s2 < 0)             return showToast('Scores cannot be negative', 'alert-circle');
    if (!currentMatchId)               return showToast('No match selected', 'alert-circle');

    try {
        await db.collection('matches').doc(currentMatchId).update({
            score1: s1, score2: s2, status: 'completed'
        });
        closeResultModal();
        showToast('Score saved!', 'check-circle');
    } catch (err) {
        console.error('Save result error:', err);
        showToast('Failed to save score', 'x-circle');
    }
}

// ========================
// CONFIRM MODAL
// ========================
let confirmCallback = null;

function showConfirmModal(message, callback) {
    const modal = document.getElementById('modal-confirm');
    const msgEl = document.getElementById('confirm-msg');
    
    // যদি কোনো কারণে মডাল না থাকে, তবে ডিফল্ট ব্রাউজার অ্যালার্ট দেখাবে
    if (!modal || !msgEl) {
        if (confirm(message)) callback();
        return;
    }
    
    msgEl.textContent = message;
    confirmCallback = callback;
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
}

function closeConfirmModal() {
    const modal = document.getElementById('modal-confirm');
    if (modal) {
        modal.classList.add('hidden');
        modal.style.display = '';
    }
    confirmCallback = null;
}

// 🔥 এখানেই মূল সমস্যাটি ছিল! এটি আপডেট করা হলো:
function confirmOk() {
    // পপ-আপ বন্ধ করার আগেই ফাংশনটি সেভ করে নিচ্ছি
    const actionToRun = confirmCallback;
    
    // পপ-আপ বন্ধ করা হচ্ছে
    closeConfirmModal();
    
    // এবার সেভ করা ফাংশনটি রান করানো হচ্ছে
    if (typeof actionToRun === 'function') {
        actionToRun();
    }
}
// ========================
// CLOSE MODALS ON BACKDROP CLICK
// ========================
document.addEventListener('click', (e) => {
    const resultModal  = document.getElementById('modal-result');
    const confirmModal = document.getElementById('modal-confirm');

    if (resultModal && e.target === resultModal)  closeResultModal();
    if (confirmModal && e.target === confirmModal) closeConfirmModal();
});

// Escape key to close modals
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeResultModal();
        closeConfirmModal();
    }
    if (e.key === 'Enter') {
        const resultModal = document.getElementById('modal-result');
        if (resultModal && !resultModal.classList.contains('hidden')) {
            saveResult();
        }
    }
});

// ========================
// INIT
// ========================
document.addEventListener('DOMContentLoaded', async () => {
    // Initialize Lucide icons
    lucide.createIcons();

    // Set tab-login as active by default
    switchTab('login');

    // Try auto-login from saved session
    await tryAutoLogin();
});
