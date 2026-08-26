import { auth, db } from "./firebase.js";
import { onAuthStateChanged, signOut, sendEmailVerification, updateEmail, updatePassword, updateProfile }   from "https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js";
import { arrayUnion, doc, getDoc, onSnapshot, runTransaction, setDoc, updateDoc }  from "https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js";
import { notify } from "./notifications.js";

const WORKOUT_STORAGE_KEY = 'fitness-tracker-today-workout';
const TODAY_CHECKLIST_STORAGE_KEY = 'fitness-tracker-today-checklist';

let resolveAuthReady;
const authReady = new Promise((resolve) => {
    resolveAuthReady = resolve;
});

function escapeHtml(value = '') {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function normalizeChecklist(items = []) {
    return Array.isArray(items)
        ? items.map((item) => ({
            id: item.id || `check-${Date.now()}-${Math.random().toString(16).slice(2)}`,
            label: item.label || 'Checklist item',
            value: item.value || '',
            done: Boolean(item.done)
        }))
        : [];
}

async function getUserChecklist(user = auth.currentUser) {
    if (!user) return [];

    try {
        const userRef = doc(db, 'users', user.uid);
        const userSnap = await getDoc(userRef);
        const data = userSnap.data() || {};
        const savedChecklist = Array.isArray(data.dailyChecklist) ? data.dailyChecklist : [];
        const normalized = normalizeChecklist(savedChecklist);
        localStorage.setItem(TODAY_CHECKLIST_STORAGE_KEY, JSON.stringify(normalized));
        return normalized;
    } catch (error) {
        console.warn('Could not fetch checklist from database:', error);
        try {
            const fallback = JSON.parse(localStorage.getItem(TODAY_CHECKLIST_STORAGE_KEY) || '[]');
            return normalizeChecklist(fallback);
        } catch {
            return [];
        }
    }
}

async function saveUserChecklist(user, items) {
    if (!user) return;

    const normalized = normalizeChecklist(items);
    const userRef = doc(db, 'users', user.uid);
    try {
        await setDoc(userRef, { dailyChecklist: normalized }, { merge: true });
    } catch (error) {
        console.warn('Could not save checklist to database:', error);
    }
    localStorage.setItem(TODAY_CHECKLIST_STORAGE_KEY, JSON.stringify(normalized));
}

async function renderTodayChecklist(user = auth.currentUser) {
    const checklistList = document.getElementById('today-checklist-list');
    if (!checklistList) return;

    if (!user) {
        checklistList.innerHTML = '';
        return;
    }

    const checklist = await getUserChecklist(user);

    if (!checklist.length) {
        checklistList.innerHTML = `
            <li class="empty-checklist-state">
                <p>Your checklist is empty.</p>
                <button type="button" class="create-checklist-btn" id="create-checklist-btn">Create your daily checklist</button>
            </li>
        `;

        const createBtn = document.getElementById('create-checklist-btn');
        if (createBtn) {
            createBtn.addEventListener('click', () => {
                setActiveSidebarSection('workouts');
                const workoutPanel = document.getElementById('checklist-editor-list');
                if (workoutPanel) {
                    workoutPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            });
        }
        return;
    }

    checklistList.innerHTML = checklist.map((item) => `
        <li class="today-checklist-item ${item.done ? 'checked' : ''}">
            <label class="check-toggle">
                <input type="checkbox" data-checklist-id="${escapeHtml(item.id)}" ${item.done ? 'checked' : ''}>
                <span class="check-box" aria-hidden="true">${item.done ? '✓' : ''}</span>
            </label>
            <span class="check-label">${escapeHtml(item.label)}</span>
            <span class="check-value">${escapeHtml(item.value)}</span>
        </li>
    `).join('');

    checklistList.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
        checkbox.addEventListener('change', async (event) => {
            const currentUser = auth.currentUser;
            if (!currentUser) return;

            const checklistItems = await getUserChecklist(currentUser);
            const targetId = event.target.dataset.checklistId;
            const nextChecklist = checklistItems.map((item) => item.id === targetId
                ? { ...item, done: event.target.checked }
                : item);

            await saveUserChecklist(currentUser, nextChecklist);
            await renderTodayChecklist(currentUser);
        });
    });

    const editorList = document.getElementById('checklist-editor-list');
    if (editorList) {
        await renderChecklistEditor();
    }
}

async function renderChecklistEditor() {
    const checklistList = document.getElementById('checklist-editor-list');
    if (!checklistList) return;

    const user = auth.currentUser;
    if (!user) return;

    const checklist = await getUserChecklist(user);

    if (!checklist.length) {
        checklistList.innerHTML = `
            <li class="empty-checklist-editor">
                <p>Your daily checklist is empty.</p>
                <span>Add items below to create your checklist.</span>
            </li>
        `;
        return;
    }

    checklistList.innerHTML = checklist.map((item) => `
        <li class="checklist-editor-item" data-id="${item.id}">
            <label class="checklist-toggle">
                <input type="checkbox" data-role="done" ${item.done ? 'checked' : ''}>
                <span class="check-box" aria-hidden="true">${item.done ? '✓' : ''}</span>
            </label>
            <input type="text" class="checklist-field checklist-label" value="${String(item.label).replace(/"/g, '&quot;')}" placeholder="Protein" aria-label="Checklist item name">
            <input type="text" class="checklist-field checklist-value" value="${String(item.value).replace(/"/g, '&quot;')}" placeholder="140g" aria-label="Checklist item value">
            <button type="button" class="checklist-delete-btn" data-role="delete">Delete</button>
        </li>
    `).join('');

    checklistList.querySelectorAll('[data-role="done"]').forEach((checkbox) => {
        checkbox.addEventListener('change', async (event) => {
            const itemElement = event.target.closest('.checklist-editor-item');
            if (!itemElement) return;
            const user = auth.currentUser;
            if (!user) return;
            const checklist = await getUserChecklist(user);
            const itemId = itemElement.dataset.id;
            const nextChecklist = checklist
                .map((item) => item.id === itemId ? { ...item, done: event.target.checked } : item)
                .filter((item) => item.label && item.label.trim() && item.value && item.value.trim());
            await saveUserChecklist(user, nextChecklist);
            await renderTodayChecklist(user);
        });
    });

    checklistList.querySelectorAll('.checklist-label, .checklist-value').forEach((input) => {
        input.addEventListener('input', async (event) => {
            const itemElement = event.target.closest('.checklist-editor-item');
            if (!itemElement) return;
            const user = auth.currentUser;
            if (!user) return;
            const itemId = itemElement.dataset.id;
            const checklist = await getUserChecklist(user);
            const nextChecklist = checklist.map((item) => {
                if (item.id !== itemId) return item;
                if (event.target.matches('.checklist-label')) return { ...item, label: event.target.value.trim() || 'Protein' };
                if (event.target.matches('.checklist-value')) return { ...item, value: event.target.value.trim() || '' };
                return item;
            });
            await saveUserChecklist(user, nextChecklist);
            await renderTodayChecklist(user);
        });
    });

    checklistList.querySelectorAll('[data-role="delete"]').forEach((button) => {
        button.addEventListener('click', async () => {
            const itemElement = button.closest('.checklist-editor-item');
            if (!itemElement) return;
            const user = auth.currentUser;
            if (!user) return;
            const checklist = await getUserChecklist(user);
            const itemId = itemElement.dataset.id;
            const nextChecklist = checklist.filter((item) => item.id !== itemId);
            await saveUserChecklist(user, nextChecklist);
            await renderChecklistEditor();
            await renderTodayChecklist(user);
        });
    });
}

document.getElementById('add-checklist-item')?.addEventListener('click', async () => {
    const user = auth.currentUser;
    if (!user) return;
    const checklist = await getUserChecklist(user);
    const nextItem = {
        id: `check-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        label: 'Protein',
        value: '',
        done: false
    };
    await saveUserChecklist(user, [...checklist, nextItem]);
    await renderChecklistEditor();
    await renderTodayChecklist(user);
    setActiveSidebarSection('workouts');
});

function getLocalDateKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

async function recordCompletedWorkout() {
    const currentUser = auth.currentUser || await authReady;
    if (!currentUser) return;

    const today = getLocalDateKey();
    const yesterday = getLocalDateKey(new Date(Date.now() - 86400000));
    const userRef = doc(db, 'users', currentUser.uid);

    try {
        await runTransaction(db, async (transaction) => {
            const snapshot = await transaction.get(userRef);
            const streak = snapshot.data()?.trackers?.streak || {};
            if (streak.lastCompletedDate === today) return;

            const current = streak.lastCompletedDate === yesterday
                ? Number(streak.current) || 0
                : 0;
            const next = current + 1;
            const best = Math.max(Number(streak.best) || 0, next);

            transaction.update(userRef, {
                'trackers.streak.current': next,
                'trackers.streak.best': best,
                'trackers.streak.lastCompletedDate': today
            });
        });
    } catch (error) {
        console.error('Could not update workout streak:', error);
    }
}

const WEIGHT_HISTORY = [
    { date: 'May 5', value: 72.8 },
    { date: 'May 12', value: 72.2 },
    { date: 'May 19', value: 71.8 },
    { date: 'May 26', value: 71.6 },
    { date: 'Jun 2', value: 71.3 }
];

let weightChart;
let currentWeightHistory = WEIGHT_HISTORY;

function renderWeightChart(history = currentWeightHistory) {
    const canvas = document.getElementById('weight-progress-chart');
    if (!canvas || typeof Chart === 'undefined') return;

    if (weightChart) weightChart.destroy();
    currentWeightHistory = history;
    const values = history.map((entry) => entry.value);
    const chartContext = canvas.getContext('2d');
    const accent = getComputedStyle(document.body).getPropertyValue('--accent-strong').trim() || '#70ff72';
    const accentSoft = getComputedStyle(document.body).getPropertyValue('--accent-soft').trim() || 'rgba(112, 255, 114, 0.24)';
    const fill = chartContext.createLinearGradient(0, 0, 0, 220);
    fill.addColorStop(0, accentSoft);
    fill.addColorStop(1, 'transparent');

    weightChart = new Chart(chartContext, {
        type: 'line',
        data: {
            labels: history.map((entry) => entry.date),
            datasets: [{
                data: values,
                borderColor: accent,
                backgroundColor: fill,
                borderWidth: 2,
                pointBackgroundColor: accent,
                pointBorderColor: accent,
                pointRadius: 4,
                pointHoverRadius: 6,
                fill: true,
                tension: 0.35
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { intersect: false, mode: 'index' },
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: (context) => `${context.parsed.y} kg` } }
            },
            scales: {
                x: { grid: { display: false }, ticks: { color: '#bdbdbd' } },
                y: {
                    min: Math.floor(Math.min(...values) - 0.5),
                    max: Math.ceil(Math.max(...values) + 0.5),
                    grid: { color: 'rgba(255, 255, 255, 0.08)' },
                    ticks: { color: '#bdbdbd' }
                }
            }
        }
    });
}

renderWeightChart();
document.getElementById('weight-range').addEventListener('change', (event) => {
    renderWeightChart(event.target.value === 'all' ? WEIGHT_HISTORY : WEIGHT_HISTORY.slice(-5));
});

const sidebarItems = [...document.querySelectorAll('#sidebar li[data-section]')];
const workoutPage = document.getElementById('workout-page');
const settingsPage = document.getElementById('settings-page');
const dashboardCards = document.querySelector('.cards-container');

function setActiveSidebarSection(section) {
    sidebarItems.forEach((item) => {
        item.classList.toggle('active', item.dataset.section === section);
    });

    const isWorkoutPage = section === 'workouts';
    const isSettingsPage = section === 'settings';
    if (workoutPage) workoutPage.hidden = !isWorkoutPage;
    if (settingsPage) settingsPage.hidden = !isSettingsPage;
    if (dashboardCards) dashboardCards.hidden = isWorkoutPage || isSettingsPage;
}

sidebarItems.forEach((item) => {
    const link = item.querySelector('a');
    if (!link) return;

    link.addEventListener('click', (event) => {
        event.preventDefault();
        setActiveSidebarSection(item.dataset.section);
    });
});

document.querySelectorAll('[data-section-link]').forEach((link) => {
    link.addEventListener('click', (event) => {
        event.preventDefault();
        setActiveSidebarSection(link.dataset.sectionLink);
    });
});

setActiveSidebarSection('dashboard');

document.getElementById('back-to-dashboard').addEventListener('click', () => {
    setActiveSidebarSection('dashboard');
});

function setupWorkoutChecklist(listId, progressLabelId, progressPercentId, progressBarId) {
    const list = document.getElementById(listId);
    const checkboxes = [...list.querySelectorAll('input[type="checkbox"]')];
    const savedWorkout = JSON.parse(localStorage.getItem(WORKOUT_STORAGE_KEY) || '[]');

    function updateProgress(shouldRecord = false) {
        const completed = checkboxes.filter((checkbox) => checkbox.checked).length;
        const percent = Math.round((completed / checkboxes.length) * 100);
        document.getElementById(progressLabelId).textContent = `${completed} / ${checkboxes.length} exercises`;
        document.getElementById(progressPercentId).textContent = `${percent}%`;
        document.getElementById(progressBarId).style.width = `${percent}%`;
        document.getElementById(progressBarId).parentElement.setAttribute('aria-valuenow', percent);
        localStorage.setItem(WORKOUT_STORAGE_KEY, JSON.stringify(checkboxes.map((checkbox) => checkbox.checked)));
        if (shouldRecord && completed === checkboxes.length) recordCompletedWorkout();
    }

    checkboxes.forEach((checkbox, index) => {
        checkbox.checked = savedWorkout[index] === true;
        checkbox.addEventListener('change', () => updateProgress(true));
    });
    updateProgress();
}

setupWorkoutChecklist('page-workout-checklist', 'page-workout-progress-label', 'page-workout-progress-percent', 'page-workout-progress-bar');

function updateWorkoutProgress() {
    const checkboxes = [...document.querySelectorAll('#workout-checklist input[type="checkbox"]')];
    if (!checkboxes.length) return;

    const completed = checkboxes.filter((checkbox) => checkbox.checked).length;
    const percent = Math.round((completed / checkboxes.length) * 100);
    document.getElementById('workout-progress-label').textContent = `${completed} / ${checkboxes.length} exercises`;
    document.getElementById('workout-progress-percent').textContent = `${percent}%`;
    document.getElementById('workout-progress-bar').style.width = `${percent}%`;
    document.querySelector('.workout-progress').setAttribute('aria-valuenow', percent);
    localStorage.setItem(WORKOUT_STORAGE_KEY, JSON.stringify(checkboxes.map((checkbox) => checkbox.checked)));
    if (percent === 100) recordCompletedWorkout();
}

const savedWorkout = JSON.parse(localStorage.getItem(WORKOUT_STORAGE_KEY) || '[]');
document.querySelectorAll('#workout-checklist input[type="checkbox"]').forEach((checkbox, index) => {
    checkbox.checked = savedWorkout[index] === true;
    checkbox.addEventListener('change', updateWorkoutProgress);
});
updateWorkoutProgress();

const message = sessionStorage.getItem("notification");
if(message) {
    notify(message);
    sessionStorage.removeItem("notification");
}

const themeButtons = document.querySelectorAll('.theme-btn');
const cardThemeToggle = document.getElementById('card-theme-toggle');
const applyCardTheme = (enabled) => {
    document.body.classList.toggle('card-theme', enabled);
    localStorage.setItem('fitness-tracker-card-theme', String(enabled));
    if (cardThemeToggle) cardThemeToggle.checked = enabled;
};

const applyTheme = (theme) => {
    document.body.classList.remove('theme-electric', 'theme-amber', 'theme-crimson', 'theme-monochrome');
    if (theme !== 'green') {
        document.body.classList.add(`theme-${theme}`);
    }
    localStorage.setItem('fitness-tracker-theme', theme);
    themeButtons.forEach((button) => {
        button.classList.toggle('active', button.dataset.theme === theme);
    });
    if (typeof weightChart !== 'undefined') {
        renderWeightChart();
    }
};

themeButtons.forEach((button) => {
    button.addEventListener('click', () => applyTheme(button.dataset.theme));
});

applyTheme(localStorage.getItem('fitness-tracker-theme') || 'green');
applyCardTheme(localStorage.getItem('fitness-tracker-card-theme') === 'true');

cardThemeToggle?.addEventListener('change', (event) => {
    applyCardTheme(event.target.checked);
});

function setSettingsStatus(elementId, message, isError = false) {
    const status = document.getElementById(elementId);
    if (status) {
        status.textContent = message;
        status.classList.toggle('error', isError);
    }
}

document.getElementById('profile-settings-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const user = auth.currentUser;
    if (!user) return;
    const firstName = document.getElementById('settings-first-name').value.trim();
    const lastName = document.getElementById('settings-last-name').value.trim();
    try {
        await updateProfile(user, { displayName: `${firstName} ${lastName}`.trim() });
        await updateDoc(doc(db, 'users', user.uid), { firstName, lastName });
        document.getElementById('profile-name').textContent = firstName || 'User';
        document.getElementById('username').textContent = firstName || 'User';
        setSettingsStatus('profile-settings-status', 'Name updated.');
    } catch (error) {
        setSettingsStatus('profile-settings-status', error.message, true);
    }
});

document.getElementById('email-settings-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const user = auth.currentUser;
    if (!user) return;
    const email = document.getElementById('settings-email').value.trim();
    try {
        await updateEmail(user, email);
        await updateDoc(doc(db, 'users', user.uid), { email });
        setSettingsStatus('email-settings-status', 'Email updated.');
    } catch (error) {
        const message = error.code === 'auth/requires-recent-login'
            ? 'Please log in again before changing your email.'
            : error.message;
        setSettingsStatus('email-settings-status', message, true);
    }
});

document.getElementById('password-settings-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const user = auth.currentUser;
    if (!user) return;
    const password = document.getElementById('settings-password').value;
    const confirmation = document.getElementById('settings-password-confirm').value;
    if (password !== confirmation) {
        setSettingsStatus('password-settings-status', 'Passwords do not match.', true);
        return;
    }
    try {
        await updatePassword(user, password);
        event.target.reset();
        setSettingsStatus('password-settings-status', 'Password updated.');
    } catch (error) {
        const message = error.code === 'auth/requires-recent-login'
            ? 'Please log in again before changing your password.'
            : error.message;
        setSettingsStatus('password-settings-status', message, true);
    }
});

const logoutBtn = document.getElementById('logout-btn');
if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
        try {
            await signOut(auth);
            sessionStorage.setItem('notification', 'Logged out successfully.');
            window.location.href = 'login.html';
        } catch (error) {
            console.error('Logout failed:', error);
            notify('Failed to log out. Please try again.');
        }
    });
}

const weightEntryForm = document.getElementById('weight-entry-form');
const weightEntryStatus = document.getElementById('weight-entry-status');

weightEntryForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const weight = Number(new FormData(weightEntryForm).get('weight'));
    const currentUser = auth.currentUser;

    if (!Number.isFinite(weight) || weight < 20 || weight > 500 || !currentUser) {
        weightEntryStatus.textContent = 'Enter a valid weight after signing in.';
        return;
    }

    const weightEntry = {
        date: new Date().toISOString().slice(0, 10),
        value: weight
    };

    try {
        const userRef = doc(db, 'users', currentUser.uid);
        await updateDoc(userRef, {
            'trackers.weight.current': weight,
            'trackers.weight.history': arrayUnion(weightEntry)
        });
        weightEntryForm.reset();
        weightEntryStatus.textContent = 'Weight logged.';
    } catch (error) {
        console.error('Weight logging failed:', error);
        weightEntryStatus.textContent = 'Could not save weight. Please try again.';
    }
});

onAuthStateChanged(auth, async (user) => {

    resolveAuthReady(user);

    if (!user) {
        window.location.href = "login.html";
        return;
    }

    // block access for unverified email addresses
    if (!user.emailVerified) {
        try {
            await sendEmailVerification(user);
        } catch (e) {
            console.warn('Failed to send verification email on dashboard access', e);
        }
        await signOut(auth);
        sessionStorage.setItem('notification', 'Please verify your email before accessing the dashboard. A verification link was sent.');
        window.location.href = 'login.html';
        return;
    }

    const userRef = doc(db, "users", user.uid);
    const userSnap = await getDoc(userRef);

    // If trackers data is missing, initialize with safe defaults
    const initialTrackers = {
        weight: { current: null, change: null, history: [] },
        calories: { today: null, target: 2000 },
        water: { today: null, target: 3 },
        streak: { current: 0, best: 0 }
    };
    if (!userSnap.exists()) {
        await setDoc(userRef, { trackers: initialTrackers, dailyChecklist: [] }, { merge: true });
    } else {
        const dataNow = userSnap.data();
        if (!dataNow.trackers) {
            await setDoc(userRef, { trackers: initialTrackers }, { merge: true });
        }
        if (!Array.isArray(dataNow.dailyChecklist)) {
            await setDoc(userRef, { dailyChecklist: [] }, { merge: true });
        }
    }

    await renderTodayChecklist(user);

    // Listen for realtime updates to user document to update trackers live
    onSnapshot(userRef, (snap) => {
        if (!snap.exists()) return;
        const d = snap.data();
        const trackers = d.trackers || d.stats || {};
        const currentWeight = Number(trackers.weight?.current ?? d.weight);
        const height = Number(d.height);
        const bmi = Number.isFinite(currentWeight) && Number.isFinite(height) && height > 0
            ? currentWeight / ((height / 100) ** 2)
            : null;
        const metricWeight = document.getElementById('metric-weight');
        const metricBmi = document.getElementById('metric-bmi');
        const metricBmiStatus = document.getElementById('metric-bmi-status');
        const metricHeight = document.getElementById('metric-height');
        if (metricWeight) metricWeight.textContent = Number.isFinite(currentWeight) ? currentWeight.toFixed(1) : '—';
        if (metricBmi) metricBmi.textContent = bmi ? bmi.toFixed(1) : '—';
        if (metricBmiStatus) {
            metricBmiStatus.textContent = bmi < 18.5 ? 'Underweight' : bmi < 25 ? 'Normal' : bmi < 30 ? 'Overweight' : bmi ? 'High' : '—';
        }
        if (metricHeight) metricHeight.textContent = Number.isFinite(height) ? height : '—';

        // weight
        const weightVal = trackers.weight && trackers.weight.current ? `${trackers.weight.current}` : '—';
        const weightChange = trackers.weight && trackers.weight.change ? trackers.weight.change : '';
        const weightHistory = trackers.weight && Array.isArray(trackers.weight.history)
            ? trackers.weight.history
                .map((entry) => ({
                    date: entry.date || entry.label || '',
                    value: Number(entry.value ?? entry.weight)
                }))
                .filter((entry) => entry.date && Number.isFinite(entry.value))
            : [];
        if (weightHistory.length > 1) renderWeightChart(weightHistory);
        const weightEl = document.getElementById('weight-value');
        const weightChangeEl = document.getElementById('weight-change');
        if (weightEl) weightEl.textContent = weightVal === '—' ? '— kg' : `${weightVal} kg`;
        if (weightChangeEl) weightChangeEl.textContent = weightChange ? `${weightChange}` : '';

        // calories
        const calToday = trackers.calories && trackers.calories.today ? trackers.calories.today : 0;
        const calTarget = trackers.calories && trackers.calories.target ? trackers.calories.target : 2000;
        const calPct = calTarget ? Math.min(100, Math.round((calToday / calTarget) * 100)) : 0;
        const calValEl = document.getElementById('calories-value');
        const calTargetEl = document.getElementById('calories-target');
        const calBar = document.getElementById('calories-progress');
        if (calValEl) calValEl.textContent = calToday || '—';
        if (calTargetEl) calTargetEl.textContent = calTarget || '—';
        if (calBar) calBar.style.width = `${calPct}%`;

        // water
        const waterToday = trackers.water && trackers.water.today ? trackers.water.today : 0;
        const waterTarget = trackers.water && trackers.water.target ? trackers.water.target : 3;
        const waterValEl = document.getElementById('water-value');
        const waterTargetEl = document.getElementById('water-target');
        const waterDropsEl = document.getElementById('water-drops');
        if (waterValEl) waterValEl.textContent = waterToday || '—';
        if (waterTargetEl) waterTargetEl.textContent = waterTarget || '—';
        if (waterDropsEl) {
            waterDropsEl.innerHTML = '';
            const total = 3; // show 3 drops
            const filled = Math.round((waterToday / waterTarget) * total);
            for (let i=0;i<total;i++){
                const span = document.createElement('span');
                span.className = 'drop' + (i < filled ? ' full' : '');
                span.textContent = '💧';
                waterDropsEl.appendChild(span);
            }
        }

        // streak
        const streakData = trackers.streak || {};
        const streakLastDate = streakData.lastCompletedDate;
        const today = getLocalDateKey();
        const yesterday = getLocalDateKey(new Date(Date.now() - 86400000));
        const streakIsActive = streakLastDate === today || streakLastDate === yesterday;
        const streakCur = streakIsActive && typeof streakData.current === 'number' ? streakData.current : 0;
        const streakBest = typeof streakData.best === 'number' ? streakData.best : 0;
        const streakEl = document.getElementById('streak-value');
        const streakBestEl = document.getElementById('streak-best');
        const streakCardEl = document.getElementById('streak-card-value');
        const streakDays = document.querySelectorAll('#streak-days .streak-day');
        if (streakEl) streakEl.textContent = `${streakCur} Days`;
        if (streakBestEl) streakBestEl.textContent = `Best: ${streakBest} Days`;
        if (streakCardEl) streakCardEl.textContent = streakCur;
        streakDays.forEach((day, index) => {
            day.classList.toggle('complete', index < Math.min(streakCur, streakDays.length));
            day.textContent = index < Math.min(streakCur, streakDays.length) ? '✓' : '';
        });
    });

    if(userSnap.exists()) {
        const data = userSnap.data();
        const profileNameEl = document.getElementById('profile-name');
        const userName = data.firstName || data.displayName || (data.email ? data.email.split('@')[0] : 'User');

        document.getElementById("username").textContent = userName;
        if (profileNameEl) profileNameEl.textContent = userName;
        const settingsFirstName = document.getElementById('settings-first-name');
        const settingsLastName = document.getElementById('settings-last-name');
        const settingsEmail = document.getElementById('settings-email');
        if (settingsFirstName) settingsFirstName.value = data.firstName || '';
        if (settingsLastName) settingsLastName.value = data.lastName || '';
        if (settingsEmail) settingsEmail.value = user.email || data.email || '';
        // Populate welcome card fields if present
        try {
            const greetingEl = document.getElementById('greeting');
            const memberSinceEl = document.getElementById('member-since');
            const workoutsCountEl = document.getElementById('workouts-count');
            const caloriesEl = document.getElementById('calories-today');
            const quoteEl = document.getElementById('welcome-quote');

            const name = data.firstName || data.displayName || (data.email ? data.email.split('@')[0] : '');

            // time-based greeting
            function timeGreeting() {
                const h = new Date().getHours();
                if (h >= 5 && h < 12) return 'Good morning';
                if (h >= 12 && h < 17) return 'Good afternoon';
                if (h >= 17 && h < 22) return 'Good evening';
                return 'Hello';
            }

            if (greetingEl) greetingEl.textContent = `${timeGreeting()} ${name ? name : ''}`.trim();

            if (memberSinceEl) {
                const created = data.createdAt;
                let dateStr = '-';
                if (created && typeof created.toDate === 'function') {
                    dateStr = created.toDate().toLocaleDateString();
                } else if (created) {
                    const d = new Date(created);
                    if (!isNaN(d)) dateStr = d.toLocaleDateString();
                }
                memberSinceEl.textContent = dateStr;
            }

            if (workoutsCountEl) {
                const workouts = data.workouts;
                if (Array.isArray(workouts)) workoutsCountEl.textContent = workouts.length;
                else if (typeof data.workoutsCount === 'number') workoutsCountEl.textContent = data.workoutsCount;
                else workoutsCountEl.textContent = '0';
            }

            if (caloriesEl) {
                caloriesEl.textContent = data.caloriesToday || data.todayCalories || (data.stats && data.stats.caloriesToday) || '—';
            }

            // rotating quotes
            const QUOTES = [
                'Small steps every day build lasting habits.',
                'Consistency beats intensity — do a little more each day.',
                'Progress is better than perfection.',
                'Rest is part of growth — recover well.',
                'Keep your head up and your heart strong.'
            ];
            if (quoteEl) {
                let index = Math.floor(Math.random() * QUOTES.length);
                quoteEl.textContent = `"${QUOTES[index]}"`;
                setInterval(() => {
                    index = (index + 1) % QUOTES.length;
                    quoteEl.textContent = `"${QUOTES[index]}"`;
                }, 6000);
            }

        } catch (e) {
            console.warn('Welcome card population error', e);
        }
    }
});