let currentUserData = null;
let allWctTests = [];
let wctCycles = [];

let chartPhysics = null;
let chartChemistry = null;
let chartBioMath = null;

document.addEventListener("DOMContentLoaded", () => {
    const loginForm = document.getElementById("app-login-form");
    const isLoginScreen = loginForm !== null;

    window.auth.onAuthStateChanged(async (user) => {
        if (user) {
            if (isLoginScreen) {
                window.location.replace("dashboard.html");
            } else {
                await loadUserProfile();
            }
        } else {
            if (!isLoginScreen) {
                window.location.replace("index.html");
            }
        }
    });

    if (loginForm) {
        loginForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            const idInput = document.getElementById("login-id").value.trim().toUpperCase();
            const passInput = document.getElementById("login-password").value.trim();
            const btn = document.getElementById("btn-login");
            const errorDiv = document.getElementById("login-error");

            btn.textContent = "Authenticating...";
            btn.disabled = true;
            errorDiv.style.display = "none";

            try {
                let collection = idInput.startsWith("FAC-") ? "faculty" : "students";
                const userDoc = await window.db.collection(collection).doc(idInput).get();

                if (!userDoc.exists) throw new Error("ID not found in the academy database.");

                const userData = userDoc.data();

                let isValid = false;
                if (collection === "students" && passInput === "Ramblers@student") isValid = true;
                if (collection === "faculty" && passInput === "Ramblers@faculty") isValid = true;

                if (!isValid) throw new Error("Incorrect password provided.");

                const syntheticEmail = `${idInput.toLowerCase()}@ramblers.com`;
                const syntheticPassword = idInput + passInput.replace(/[^a-zA-Z0-9]/g, '');

                try {
                    await window.auth.signInWithEmailAndPassword(syntheticEmail, syntheticPassword);
                } catch (authError) {
                    try {
                        await window.auth.createUserWithEmailAndPassword(syntheticEmail, syntheticPassword);
                    } catch (createError) {
                        if (createError.code === 'auth/email-already-in-use') {
                            throw new Error("Incorrect password provided.");
                        } else {
                            throw createError;
                        }
                    }
                }

                localStorage.setItem('ra_userId', idInput);
                localStorage.setItem('ra_userRole', collection === "students" ? "STUDENT" : "FACULTY");
                localStorage.setItem('ra_userBatch', userData.batch || "ALL");

            } catch (err) {
                errorDiv.textContent = err.message;
                errorDiv.style.display = "block";
                btn.textContent = "Secure Login";
                btn.disabled = false;
            }
        });
    }

    if (!isLoginScreen) {
        setupNavigation();
    }
});

function setupNavigation() {
    const navBtns = document.querySelectorAll('.nav-btn');

    navBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const targetId = btn.id.replace('nav-', 'tab-');
            switchTab(targetId, btn);
        });
    });

    window.addEventListener('popstate', (e) => {
        if (e.state && e.state.view === 'wct-hub') {
            document.getElementById('view-wct-hub').style.display = 'flex';
            document.getElementById('view-profile').style.display = 'none';
        } else if (e.state && e.state.view === 'profile') {
            document.getElementById('view-profile').style.display = 'flex';
            document.getElementById('view-wct-hub').style.display = 'none';
        } else {
            document.getElementById('view-wct-hub').style.display = 'none';
            document.getElementById('view-profile').style.display = 'none';
            if (e.state && e.state.tab) {
                const btn = document.getElementById(e.state.tab.replace('tab-', 'nav-'));
                switchTab(e.state.tab, btn, false);
            }
        }
    });

    history.replaceState({ tab: 'tab-home' }, '', '#tab-home');
}

function switchTab(targetId, activeBtn, pushHistory = true) {
    document.querySelectorAll('.app-content:not(.slide-over)').forEach(tab => tab.style.display = 'none');

    const targetEl = document.getElementById(targetId);
    if (targetEl) targetEl.style.display = 'block';

    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    if (activeBtn) activeBtn.classList.add('active');

    if (pushHistory) {
        history.pushState({ tab: targetId }, '', `#${targetId}`);
    }

    if (targetId === 'tab-orbit') loadOrbitBroadcasts();
    if (targetId === 'tab-timetable') {
        loadDailyTimetable();
        loadTestSchedule();
    }
}

// ------------------------------------------
// HELPER: Remove Skeletons Safely
// ------------------------------------------
function removeSkeleton(elementId, newValue) {
    const el = document.getElementById(elementId);
    if (el) {
        el.classList.remove('skeleton', 'skeleton-text', 'skeleton-circle');
        if (newValue !== undefined) el.textContent = newValue;
    }
}

async function loadUserProfile() {
    const userId = localStorage.getItem('ra_userId');
    const role = localStorage.getItem('ra_userRole');
    if (!userId) return;

    try {
        const collection = role === "STUDENT" ? "students" : "faculty";
        const docSnap = await window.db.collection(collection).doc(userId).get();

        if (docSnap.exists) {
            currentUserData = docSnap.data();

            const firstName = role === "STUDENT" ? currentUserData.nameParts.firstname : currentUserData.name.split(' ')[0];
            const batchName = role === "STUDENT" ? currentUserData.batch : "Faculty Mentor";

            removeSkeleton('user-greeting', `Hello, ${firstName}`);
            removeSkeleton('user-batch', batchName);

            if (currentUserData.photoUrl) {
                const avatar = document.getElementById('user-avatar');
                const placeholder = document.getElementById('avatar-placeholder');
                if (avatar && placeholder) {
                    avatar.src = currentUserData.photoUrl;
                    avatar.style.display = "block";
                    placeholder.classList.remove('skeleton', 'skeleton-circle');
                    placeholder.style.display = "none";
                }
            }

            if (role === "FACULTY") {
                const metricsView = document.getElementById('student-metrics-view');
                const recentView = document.getElementById('student-recent-view');
                const healthBar = document.getElementById('health-status-bar');
                const facultyView = document.getElementById('faculty-view');

                if (metricsView) metricsView.style.display = 'none';
                if (recentView) recentView.style.display = 'none';
                if (healthBar) healthBar.style.display = 'none';
                if (facultyView) facultyView.style.display = 'block';
            } else {
                await fetchAndCalculateWCT(currentUserData.batch, userId);
            }
        }
    } catch (err) {
        console.error("Failed to load user profile", err);
    }
}

// ==========================================
// DATA ENGINE (Runs on Home Load)
// ==========================================
async function fetchAndCalculateWCT(batch, enrollNo) {
    try {
        const snap = await window.db.collection('wct_scores').where('batch', '==', batch).get();
        allWctTests = [];

        snap.forEach(doc => {
            const data = doc.data();
            if (data.status === "DRAFT") return;

            if (data.scores && data.scores[enrollNo] !== undefined) {
                allWctTests.push({
                    id: doc.id,
                    subject: data.subject,
                    date: data.date,
                    maxMarks: parseInt(data.maxMarks),
                    score: data.scores[enrollNo],
                    publishedAt: data.publishedAt ? data.publishedAt.toMillis() : 0
                });
            }
        });

        allWctTests.sort((a, b) => a.publishedAt - b.publishedAt);
        processTestCycles();
        updateDashboardMetrics();
    } catch (err) {
        console.error("WCT Analytics Error:", err);
    }
}

function processTestCycles() {
    wctCycles = [];
    let grouped = { 'Physics': [], 'Chemistry': [], 'Mathematics': [], 'Biology': [] };

    allWctTests.forEach(test => {
        if (grouped[test.subject]) grouped[test.subject].push(test);
    });

    let maxTests = Math.max(
        grouped['Physics'].length,
        grouped['Chemistry'].length,
        Math.max(grouped['Mathematics'].length, grouped['Biology'].length)
    );

    let totalCycles = Math.ceil(maxTests / 5);

    for (let i = 0; i < totalCycles; i++) {
        let cycleObj = {
            cycleNumber: i + 1,
            rounds: [],
            physicsData: [],
            chemistryData: [],
            bioMathData: []
        };

        for (let r = 0; r < 5; r++) {
            let globalTestIndex = (i * 5) + r;

            let roundPhys = grouped['Physics'][globalTestIndex] || null;
            let roundChem = grouped['Chemistry'][globalTestIndex] || null;
            let roundMath = grouped['Mathematics'][globalTestIndex] || null;
            let roundBio = grouped['Biology'][globalTestIndex] || null;

            if (!roundPhys && !roundChem && !roundMath && !roundBio) break;

            let roundData = {
                roundNumber: r + 1,
                phys: roundPhys,
                chem: roundChem,
                bioMath: roundBio || roundMath
            };

            cycleObj.rounds.push(roundData);

            if (roundPhys) cycleObj.physicsData.push(roundPhys.score === "AB" ? 0 : (parseInt(roundPhys.score) / roundPhys.maxMarks) * 100);
            if (roundChem) cycleObj.chemistryData.push(roundChem.score === "AB" ? 0 : (parseInt(roundChem.score) / roundChem.maxMarks) * 100);

            let bioMathObj = roundBio || roundMath;
            if (bioMathObj) cycleObj.bioMathData.push(bioMathObj.score === "AB" ? 0 : (parseInt(bioMathObj.score) / bioMathObj.maxMarks) * 100);
        }
        wctCycles.push(cycleObj);
    }
}

function updateDashboardMetrics() {
    const healthBar = document.getElementById('health-status-bar');
    const healthIcon = document.getElementById('health-status-icon');
    const healthText = document.getElementById('health-status-text');

    // Strip Skeletons initially
    if (healthBar) healthBar.classList.remove('skeleton');
    if (healthText) healthText.style.opacity = '1';

    if (wctCycles.length === 0) {
        if (healthText) healthText.textContent = "No Tests Taken Yet";
        removeSkeleton('metric-cumulative', 'N/A');
        removeSkeleton('metric-physics', 'N/A');
        removeSkeleton('metric-chemistry', 'N/A');
        removeSkeleton('metric-biomath', 'N/A');
        const rc = document.getElementById('recent-scores-container');
        if (rc) rc.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 20px;">No recent tests.</div>';
        return;
    }

    const latestCycle = wctCycles[wctCycles.length - 1];

    let totalObtained = 0; let totalMax = 0;
    let physObt = 0; let physMax = 0;
    let chemObt = 0; let chemMax = 0;
    let bioObt = 0; let bioMax = 0;

    latestCycle.rounds.forEach(round => {
        if (round.phys) {
            let sc = round.phys.score === "AB" ? 0 : parseInt(round.phys.score);
            physObt += sc; physMax += round.phys.maxMarks;
            totalObtained += sc; totalMax += round.phys.maxMarks;
        }
        if (round.chem) {
            let sc = round.chem.score === "AB" ? 0 : parseInt(round.chem.score);
            chemObt += sc; chemMax += round.chem.maxMarks;
            totalObtained += sc; totalMax += round.chem.maxMarks;
        }
        if (round.bioMath) {
            let sc = round.bioMath.score === "AB" ? 0 : parseInt(round.bioMath.score);
            bioObt += sc; bioMax += round.bioMath.maxMarks;
            totalObtained += sc; totalMax += round.bioMath.maxMarks;
        }
    });

    const setMetric = (valId, barId, obt, max) => {
        const valEl = document.getElementById(valId);
        const barEl = document.getElementById(barId);
        if (valEl) valEl.classList.remove('skeleton', 'skeleton-text');

        if (max > 0) {
            let pct = ((obt / max) * 100).toFixed(1);
            if (valEl) valEl.textContent = pct + "%";
            if (barEl) barEl.style.width = pct + "%";
        } else {
            if (valEl) valEl.textContent = "N/A";
            if (barEl) barEl.style.width = "0%";
        }
    };

    setMetric('metric-cumulative', 'bar-cumulative', totalObtained, totalMax);
    setMetric('metric-physics', 'bar-physics', physObt, physMax);
    setMetric('metric-chemistry', 'bar-chemistry', chemObt, chemMax);
    setMetric('metric-biomath', 'bar-biomath', bioObt, bioMax);

    let cumulativePct = totalMax > 0 ? (totalObtained / totalMax) * 100 : 0;
    window.globalCumulativeScore = cumulativePct.toFixed(1);

    if (healthBar && healthIcon) {
        healthBar.className = "health-status";
        if (cumulativePct >= 75) {
            healthBar.classList.add("green-status"); healthText.textContent = "Performing Well";
            healthIcon.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline><polyline points="17 6 23 6 23 12"></polyline></svg>`;
        } else if (cumulativePct >= 50) {
            healthBar.classList.add("yellow-status"); healthText.textContent = "Average / Needs Push";
            healthIcon.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>`;
        } else {
            healthBar.classList.add("red-status"); healthText.textContent = "Needs Immediate Attention";
            healthIcon.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"></polyline><polyline points="17 18 23 18 23 12"></polyline></svg>`;
        }
    }

    const recentContainer = document.getElementById('recent-scores-container');
    if (recentContainer) {
        recentContainer.innerHTML = '';
        const recentTests = [...allWctTests].slice(-3).reverse();

        recentTests.forEach(test => {
            let isAbsent = test.score === "AB";
            let displayScore = isAbsent ? "0" : test.score;
            let colorClass = isAbsent ? "status-poor" : ((parseInt(test.score) / test.maxMarks) * 100 >= 75 ? "status-good" : ((parseInt(test.score) / test.maxMarks) * 100 >= 50 ? "status-avg" : "status-poor"));

            recentContainer.innerHTML += `
                <div class="glass-card score-row">
                    <div class="score-info">
                        <span class="score-subject">${test.subject}</span>
                        <span class="score-date">${test.date}</span>
                    </div>
                    <div class="score-number ${colorClass}">
                        <strong>${isAbsent ? "AB" : displayScore}</strong> 
                        <span style="font-size: 0.9rem; opacity: 0.7;">/${test.maxMarks}</span>
                    </div>
                </div>
            `;
        });
    }
}

// ==========================================
// FULL PAGE WCT HUB & GRAPHING
// ==========================================
window.openWCTHub = function () {
    history.pushState({ view: 'wct-hub' }, '', '#wct-hub');
    const hub = document.getElementById('view-wct-hub');
    if (hub) {
        hub.style.display = 'flex';
        populateCycleDropdown();
    }
}

window.closeWCTHub = function () {
    if (history.state && history.state.view === 'wct-hub') {
        history.back();
    } else {
        const hub = document.getElementById('view-wct-hub');
        if (hub) hub.style.display = 'none';
    }
}

function populateCycleDropdown() {
    const selectEl = document.getElementById('wct-cycle-select');
    if (!selectEl) return;
    selectEl.innerHTML = '';

    if (wctCycles.length === 0) {
        selectEl.innerHTML = '<option>No Data</option>';
        return;
    }

    wctCycles.forEach(cycle => {
        selectEl.innerHTML += `<option value="${cycle.cycleNumber}">Cycle ${cycle.cycleNumber}</option>`;
    });

    selectEl.value = wctCycles[wctCycles.length - 1].cycleNumber;
    renderWCTCycle(selectEl.value);
}

window.renderWCTCycle = function (cycleNumber) {
    const cycle = wctCycles.find(c => c.cycleNumber == cycleNumber);
    if (!cycle) return;

    let labels = Array.from({ length: cycle.rounds.length }, (_, i) => `Test ${i + 1}`);

    drawChart('chart-physics', chartPhysics, { labels: labels, data: cycle.physicsData }, '#60a5fa', 'rgba(96, 165, 250, 0.1)');
    drawChart('chart-chemistry', chartChemistry, { labels: labels, data: cycle.chemistryData }, '#c084fc', 'rgba(192, 132, 252, 0.1)');
    drawChart('chart-biomath', chartBioMath, { labels: labels, data: cycle.bioMathData }, '#34d399', 'rgba(52, 211, 153, 0.1)');

    const container = document.getElementById('wct-history-container');
    container.innerHTML = '';

    let reverseRounds = [...cycle.rounds].reverse();

    reverseRounds.forEach(round => {
        let rObt = 0; let rMax = 0;
        [round.phys, round.chem, round.bioMath].forEach(sub => {
            if (sub) {
                rObt += sub.score === "AB" ? 0 : parseInt(sub.score);
                rMax += sub.maxMarks;
            }
        });
        let roundAvg = rMax > 0 ? ((rObt / rMax) * 100).toFixed(0) + "%" : "--";

        const renderSubRow = (sub, title) => {
            if (!sub) return '';
            let isAb = sub.score === "AB";
            let cClass = isAb ? "status-poor" : ((parseInt(sub.score) / sub.maxMarks) * 100 >= 75 ? "status-good" : ((parseInt(sub.score) / sub.maxMarks) * 100 >= 50 ? "status-avg" : "status-poor"));
            return `
            <div class="round-subject-row">
                <div><strong style="color: #fff;">${title}</strong> <span style="color: var(--text-muted); font-size: 0.8rem; margin-left: 8px;">${sub.date}</span></div>
                <div class="${cClass}" style="font-weight: 700; font-size: 1.1rem;">${isAb ? "AB" : sub.score}<span style="font-size: 0.8rem; opacity: 0.7;">/${sub.maxMarks}</span></div>
            </div>`;
        };

        container.innerHTML += `
            <div class="round-card">
                <div class="round-card-top">
                    <h3 style="color: #fff; font-size: 1.1rem;">Test Round ${round.roundNumber}</h3>
                    <div style="text-align: right;">
                        <span style="font-size: 0.8rem; color: var(--text-muted); display: block;">Round Avg</span>
                        <strong style="color: var(--brand-gold); font-size: 1.2rem;">${roundAvg}</strong>
                    </div>
                </div>
                <div style="display: flex; flex-direction: column; gap: 12px; margin-top: 8px;">
                    ${renderSubRow(round.phys, "Physics")}
                    ${renderSubRow(round.chem, "Chemistry")}
                    ${renderSubRow(round.bioMath, "Math/Bio")}
                </div>
            </div>
        `;
    });
}

function drawChart(canvasId, globalInstanceVar, chartData, lineColor, bgColor) {
    const canvasEl = document.getElementById(canvasId);
    if (!canvasEl) return;

    let existingChart = Chart.getChart(canvasId);
    if (existingChart) existingChart.destroy();

    const ctx = canvasEl.getContext('2d');
    Chart.defaults.color = '#94a3b8';
    Chart.defaults.font.family = 'Inter';

    new Chart(ctx, {
        type: 'line',
        data: {
            labels: chartData.labels,
            datasets: [{
                data: chartData.data,
                borderColor: lineColor,
                backgroundColor: bgColor,
                borderWidth: 2,
                pointBackgroundColor: '#0f172a',
                pointBorderColor: lineColor,
                pointBorderWidth: 2,
                pointRadius: 4,
                fill: true,
                tension: 0.3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 800, easing: 'easeOutQuart' },
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true, max: 100, grid: { color: 'rgba(255,255,255,0.05)' } },
                x: { grid: { display: false } }
            }
        }
    });
}

// ==========================================
// ORBIT BROADCAST ENGINE
// ==========================================
async function loadOrbitBroadcasts() {
    const container = document.getElementById('orbit-feed-container');
    if (!container) return;

    try {
        const userBatch = localStorage.getItem('ra_userBatch') || 'ALL';
        const userRole = localStorage.getItem('ra_userRole');
        const snap = await window.db.collection('orbit_broadcasts').orderBy('publishedAt', 'desc').get();

        container.innerHTML = '';
        if (snap.empty) {
            container.innerHTML = '<div style="text-align:center; padding: 40px; color: var(--text-muted);">No academy broadcasts at this time.</div>';
            return;
        }

        snap.forEach(doc => {
            const data = doc.data();
            if (data.target === 'BATCH' && data.targetBatch !== userBatch && userRole !== 'FACULTY') return;
            const dateStr = data.publishedAt ? data.publishedAt.toDate().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Recently';

            container.innerHTML += `
                <div class="glass-card orbit-card">
                    <div class="orbit-header">
                        <h3 class="orbit-title">${data.title}</h3>
                        <span class="orbit-date">${dateStr}</span>
                    </div>
                    <div class="orbit-body">${data.bodyHTML}</div>
                </div>`;
        });
    } catch (err) {
        container.innerHTML = `<div style="color: #fca5a5; text-align: center; padding: 40px;">Failed to synchronize Orbit feed.</div>`;
    }
}

// ==========================================
// TIMETABLE & TEST SCHEDULE ENGINE
// ==========================================
window.switchScheduleView = function (viewType) {
    const btnDaily = document.getElementById('btn-daily-schedule');
    const btnTests = document.getElementById('btn-test-schedule');
    const viewDaily = document.getElementById('timetable-container');
    const viewTests = document.getElementById('test-schedule-container');

    if (viewType === 'daily') {
        btnDaily.classList.add('active'); btnTests.classList.remove('active');
        viewDaily.style.display = 'flex'; viewTests.style.display = 'none';
    } else {
        btnTests.classList.add('active'); btnDaily.classList.remove('active');
        viewDaily.style.display = 'none'; viewTests.style.display = 'flex';
    }
};

async function loadDailyTimetable() {
    const imgEl = document.getElementById('timetable-img');
    const emptyEl = document.getElementById('timetable-empty');
    const dateEl = document.getElementById('timetable-date');
    if (!imgEl || !emptyEl || !dateEl) return;

    try {
        const snap = await window.db.collection('timetables').orderBy('sortDate', 'desc').limit(1).get();
        if (snap.empty) {
            imgEl.style.display = 'none'; emptyEl.style.display = 'block'; dateEl.textContent = 'No active schedule'; return;
        }
        const data = snap.docs[0].data();
        imgEl.src = data.imageData;
        imgEl.style.display = 'block'; emptyEl.style.display = 'none'; dateEl.textContent = `For: ${data.date}`;
    } catch (err) {
        emptyEl.style.display = 'block'; document.getElementById('empty-state-text').textContent = "Failed to synchronize schedule.";
    }
}

async function loadTestSchedule() {
    const userBatch = localStorage.getItem('ra_userBatch');
    const wrapper = document.getElementById('test-list-wrapper');
    const emptyEl = document.getElementById('test-empty');
    if (!wrapper || !emptyEl) return;

    if (!userBatch || userBatch === "ALL") { emptyEl.style.display = 'block'; wrapper.innerHTML = ''; return; }

    try {
        const docSnap = await window.db.collection('test_schedules').doc(userBatch).get();
        if (!docSnap.exists || !docSnap.data().schedule || docSnap.data().schedule.length === 0) {
            emptyEl.style.display = 'block'; wrapper.innerHTML = ''; return;
        }

        emptyEl.style.display = 'none';
        let html = '';
        docSnap.data().schedule.forEach(test => {
            html += `
            <div class="test-card">
                <div class="test-card-header">
                    <span class="test-card-date">
                        <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                        ${test.date}
                    </span>
                    <span class="test-card-type">${test.testName}</span>
                </div>
                <div class="test-card-body">
                    <div class="test-card-title-row">
                        <span class="test-card-subject">${test.subject}</span>
                        <span class="test-card-faculty">${test.teacher}</span>
                    </div>
                    <div class="test-card-topic"><strong>Topic:</strong> ${test.syllabus}</div>
                </div>
            </div>`;
        });
        wrapper.innerHTML = html;
    } catch (err) {
        emptyEl.style.display = 'block'; emptyEl.innerHTML = `<p style="color: #fca5a5; margin: 0;">Error syncing test data.</p>`;
    }
}

// ==========================================
// PROFILE SLIDE-OVER LOGIC
// ==========================================
window.openProfile = async function () {
    history.pushState({ view: 'profile' }, '', '#profile');
    const profileView = document.getElementById('view-profile');
    if (profileView) profileView.style.display = 'flex';

    if (!currentUserData) return;

    const isStudent = localStorage.getItem('ra_userRole') === 'STUDENT';

    removeSkeleton('profile-name', isStudent ? currentUserData.fullName : currentUserData.name);
    removeSkeleton('profile-enroll', isStudent ? currentUserData.enrollNo : currentUserData.id);
    removeSkeleton('profile-mobile', isStudent ? currentUserData.parentMobile : currentUserData.mobile);
    removeSkeleton('profile-course', isStudent && currentUserData.course && currentUserData.course !== "-" ? currentUserData.course : 'Not Assigned');

    if (currentUserData.photoUrl) {
        const pImg = document.getElementById('profile-large-avatar');
        const pPlace = document.getElementById('profile-large-placeholder');
        if (pImg && pPlace) {
            pImg.src = currentUserData.photoUrl;
            pImg.style.display = 'block';
            pPlace.style.display = 'none';
        }
    }

    const mentorCards = document.querySelectorAll('.mentor-card');
    if (isStudent && currentUserData.mentorId) {
        try {
            const mentorSnap = await window.db.collection('faculty').doc(currentUserData.mentorId).get();
            if (mentorSnap.exists) {
                const mData = mentorSnap.data();
                removeSkeleton('mentor-name', mData.name);
                removeSkeleton('mentor-contact', mData.mobile);

                const mImg = document.getElementById('mentor-avatar');
                const mPlace = document.getElementById('mentor-placeholder');
                if (mImg && mPlace) {
                    mImg.src = mData.photoUrl || 'images/default-avatar.png';
                    mImg.style.display = 'block';
                    mPlace.style.display = 'none';
                }

                const callBtn = document.getElementById('mentor-call-btn');
                if (callBtn) {
                    callBtn.href = `tel:${mData.mobile}`;
                    callBtn.style.visibility = 'visible';
                }
            }
        } catch (err) { console.error("Failed to load mentor", err); }
        mentorCards.forEach(el => el.style.display = "flex");
    } else {
        mentorCards.forEach(el => el.style.display = "none");
    }
}

window.closeProfile = function () {
    if (history.state && history.state.view === 'profile') {
        history.back();
    } else {
        const profileView = document.getElementById('view-profile');
        if (profileView) profileView.style.display = 'none';
    }
}

window.logoutApp = function () {
    localStorage.clear();
    window.auth.signOut();
}