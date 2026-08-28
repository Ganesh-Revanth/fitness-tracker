import { auth, db } from "./firebase.js";
import { EmailAuthProvider, onAuthStateChanged, reauthenticateWithCredential, signOut, sendEmailVerification, updateEmail, updatePassword, updateProfile }   from "https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js";
import { arrayUnion, doc, getDoc, onSnapshot, runTransaction, setDoc, updateDoc }  from "https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js";
import { notify } from "./notifications.js";

const WORKOUT_STORAGE_KEY = 'fitness-tracker-today-workout';
const TODAY_CHECKLIST_STORAGE_KEY = 'fitness-tracker-today-checklist';
const checklistSaveTimers = new Map();

document.body.classList.add('app-status-loading');
document.querySelectorAll('[data-current-year]').forEach((element) => {
    element.textContent = String(new Date().getFullYear());
});

const mobileMenuToggle = document.getElementById('mobile-menu-toggle');
const sidebarOverlay = document.getElementById('sidebar-overlay');
const mobileSidebar = document.getElementById('sidebar');
const offlineIndicator = document.getElementById('offline-indicator');

function setMobileMenu(open) {
    if (!mobileMenuToggle || !mobileSidebar) return;
    mobileSidebar.classList.toggle('sidebar-open', open);
    mobileMenuToggle.setAttribute('aria-expanded', String(open));
    mobileMenuToggle.setAttribute('aria-label', open ? 'Close navigation menu' : 'Open navigation menu');
    if (sidebarOverlay) sidebarOverlay.hidden = !open;
}

function updateNetworkState() {
    if (offlineIndicator) offlineIndicator.hidden = navigator.onLine;
}

mobileMenuToggle?.addEventListener('click', () => {
    setMobileMenu(!mobileSidebar.classList.contains('sidebar-open'));
});
sidebarOverlay?.addEventListener('click', () => setMobileMenu(false));
window.addEventListener('online', updateNetworkState);
window.addEventListener('offline', updateNetworkState);
document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') setMobileMenu(false);
});
updateNetworkState();

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

function getDefaultChecklist(userData = {}) {
    const weight = Number(userData.trackers?.weight?.current ?? userData.weight);
    return [
        {
            id: 'check-protein-default',
            label: 'Protein',
            value: Number.isFinite(weight) && weight > 0 ? `${Math.round(weight * 2)} g` : '2 x body weight (log weight)',
            done: false
        },
        { id: 'check-sleep-default', label: 'Sleep', value: '7-8 hours', done: false }
    ];
}

async function getUserChecklist(user = auth.currentUser) {
    if (!user) return [];

    try {
        const userRef = doc(db, 'users', user.uid);
        const userSnap = await getDoc(userRef);
        const data = userSnap.data() || {};
        const savedChecklist = Array.isArray(data.dailyChecklist) ? data.dailyChecklist : [];
        const normalized = savedChecklist.length ? normalizeChecklist(savedChecklist) : getDefaultChecklist(data);
        if (!savedChecklist.length) {
            await setDoc(userRef, { dailyChecklist: normalized }, { merge: true });
        }
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
        input.addEventListener('input', (event) => {
            const itemElement = event.target.closest('.checklist-editor-item');
            if (!itemElement) return;
            const user = auth.currentUser;
            if (!user) return;
            const itemId = itemElement.dataset.id;
            clearTimeout(checklistSaveTimers.get(itemId));
            checklistSaveTimers.set(itemId, setTimeout(async () => {
                if (!itemElement.isConnected) return;
                try {
                    const checklist = await getUserChecklist(user);
                    const label = itemElement.querySelector('.checklist-label')?.value.trim() || 'Checklist item';
                    const value = itemElement.querySelector('.checklist-value')?.value.trim() || '';
                    const nextChecklist = checklist.map((item) => item.id === itemId
                        ? { ...item, label, value }
                        : item);
                    await saveUserChecklist(user, nextChecklist);
                } catch (error) {
                    console.warn('Could not save checklist edit:', error);
                    notify('Checklist changes could not be saved.');
                } finally {
                    checklistSaveTimers.delete(itemId);
                }
            }, 500));
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
let weightHistoryData = WEIGHT_HISTORY;
let renderedWeightHistoryKey = null;

const DEFAULT_NUTRITION_TARGETS = { calories: 2000, protein: 150, carbs: 250, fat: 70, water: 4.5 };
let nutritionData = { targets: { ...DEFAULT_NUTRITION_TARGETS }, days: {} };
let recordsData = { lifts: [], cardio: [], measurements: [], photos: [] };
let progressTrackers = {};
let progressGoal = 'general-fitness';
let progressTargets = { workouts: 3, distance: 10, duration: 120 };
let progressCharts = {};

function recordsDateWithinPeriod(date, days) {
    const timestamp = new Date(`${date}T00:00:00`).getTime();
    return Number.isFinite(timestamp) && timestamp <= Date.now() && Date.now() - timestamp < days * 86400000;
}

function progressRange(days, offset = 0) {
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    end.setDate(end.getDate() - (offset * days));
    const start = new Date(end);
    start.setDate(start.getDate() - days + 1);
    start.setHours(0, 0, 0, 0);
    return { start, end };
}

function progressDateInRange(date, range) {
    const timestamp = new Date(`${date}T00:00:00`).getTime();
    return Number.isFinite(timestamp) && timestamp >= range.start.getTime() && timestamp <= range.end.getTime();
}

function progressEntries(source, range) {
    return source.filter((entry) => progressDateInRange(entry.date, range));
}

function progressNumber(value, suffix = '') {
    return `${nutritionNumber(value)}${suffix}`;
}

function progressDelta(current, previous, suffix = '') {
    if (!previous) return 'New';
    const change = ((current - previous) / Math.abs(previous)) * 100;
    if (!Number.isFinite(change)) return '—';
    return `${change > 0 ? '+' : ''}${Math.round(change)}%${suffix}`;
}

function progressBuckets(days, range) {
    const bucketSize = days > 30 ? 7 : 1;
    const buckets = [];
    for (let cursor = new Date(range.start); cursor <= range.end;) {
        const start = new Date(cursor);
        const end = new Date(cursor);
        end.setDate(end.getDate() + bucketSize - 1);
        if (end > range.end) end.setTime(range.end.getTime());
        buckets.push({ start, end, label: days > 30 ? start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : start.toLocaleDateString(undefined, { weekday: 'short' }), key: getLocalDateKey(start) });
        cursor = new Date(end);
        cursor.setDate(cursor.getDate() + 1);
    }
    return buckets;
}

function progressBucketFor(date, buckets) {
    const timestamp = new Date(`${date}T00:00:00`).getTime();
    return buckets.find((bucket) => timestamp >= bucket.start.getTime() && timestamp <= bucket.end.getTime());
}

function destroyProgressChart(name) {
    if (progressCharts[name]) {
        progressCharts[name].destroy();
        delete progressCharts[name];
    }
}

function renderProgressChart(name, canvasId, labels, datasets, emptyId, emptyMessage, type = 'line') {
    const canvas = document.getElementById(canvasId);
    const empty = document.getElementById(emptyId);
    destroyProgressChart(name);
    const hasData = datasets.some((dataset) => dataset.data.some((value) => value > 0 || value !== null));
    if (!canvas || typeof Chart === 'undefined' || !hasData) {
        if (canvas) canvas.hidden = true;
        if (empty) { empty.hidden = false; empty.textContent = emptyMessage; }
        return;
    }
    canvas.hidden = false;
    if (empty) empty.hidden = true;
    const accent = getComputedStyle(document.body).getPropertyValue('--accent-strong').trim() || '#70ff72';
    progressCharts[name] = new Chart(canvas, {
        type,
        data: { labels, datasets: datasets.map((dataset, index) => ({ borderColor: index ? '#ffbd69' : accent, backgroundColor: index ? 'rgba(255, 189, 105, 0.18)' : 'rgba(112, 255, 114, 0.18)', borderWidth: 2, pointRadius: 3, tension: 0.3, fill: type === 'line', ...dataset })) },
        options: { responsive: true, maintainAspectRatio: false, interaction: { intersect: false, mode: 'index' }, plugins: { legend: { display: datasets.length > 1, labels: { color: '#bdbdbd' } } }, scales: { x: { grid: { display: false }, ticks: { color: '#bdbdbd', maxRotation: 0, autoSkip: true, maxTicksLimit: 10 } }, y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.08)' }, ticks: { color: '#bdbdbd' } } } }
    });
}

async function saveRecordsData(user = auth.currentUser) {
    if (!user) return;
    await setDoc(doc(db, 'users', user.uid), { records: recordsData }, { merge: true });
}

function renderRecords() {
    renderProgress();

    const bestByExercise = {};
    recordsData.lifts.forEach((entry) => {
        const key = entry.exercise.trim().toLowerCase();
        const estimatedOneRepMax = Number(entry.weight) * (1 + Number(entry.reps) / 30);
        if (!bestByExercise[key] || estimatedOneRepMax > bestByExercise[key].estimatedOneRepMax) bestByExercise[key] = { ...entry, estimatedOneRepMax };
    });
    const personalRecords = document.getElementById('personal-records-list');
    if (personalRecords) {
        const entries = Object.values(bestByExercise).sort((a, b) => b.estimatedOneRepMax - a.estimatedOneRepMax);
        personalRecords.innerHTML = entries.length ? entries.map((entry) => `<li><div><strong>${escapeHtml(entry.exercise)}</strong><span>${nutritionNumber(entry.weight)} kg × ${entry.reps} reps</span></div><b>Est. 1RM ${nutritionNumber(entry.estimatedOneRepMax)} kg</b></li>`).join('') : '<li class="empty-state">No lifts recorded yet.</li>';
    }

    const photos = document.getElementById('progress-photo-list');
    if (photos) photos.innerHTML = recordsData.photos.length ? recordsData.photos.map((photo) => `<li><a href="${escapeHtml(photo.url)}" target="_blank" rel="noopener">${escapeHtml(photo.date)} photo</a></li>`).join('') : '<li class="empty-state">No progress photos saved.</li>';
    const photoHistory = document.getElementById('progress-photo-history');
    if (photoHistory) photoHistory.innerHTML = recordsData.photos.length ? [...recordsData.photos].sort((a, b) => b.date.localeCompare(a.date)).map((photo) => `<li><a href="${escapeHtml(photo.url)}" target="_blank" rel="noopener">${escapeHtml(photo.date)} photo</a></li>`).join('') : '<li class="empty-state">Save a photo reference in Records to compare your changes over time.</li>';
}

function renderProgress() {
    const days = Number(document.getElementById('progress-period')?.value || 7);
    const current = progressRange(days);
    const previous = progressRange(days, 1);
    const buckets = progressBuckets(days, current);
    const previousBuckets = progressBuckets(days, previous);
    const currentLifts = progressEntries(recordsData.lifts, current);
    const previousLifts = progressEntries(recordsData.lifts, previous);
    const currentCardio = progressEntries(recordsData.cardio, current);
    const previousCardio = progressEntries(recordsData.cardio, previous);
    const currentMeasurements = progressEntries(recordsData.measurements, current);
    const weightHistory = (progressTrackers.weight?.history || []).map((entry) => ({ date: entry.date || entry.label, value: Number(entry.value ?? entry.weight) })).filter((entry) => Number.isFinite(entry.value) && entry.date);
    const currentWeights = progressEntries(weightHistory, current);
    const workoutDates = Object.keys(workoutLogs).filter((date) => progressDateInRange(date, current));
    const previousWorkoutDates = Object.keys(workoutLogs).filter((date) => progressDateInRange(date, previous));
    const workoutCount = workoutDates.filter((date) => (workoutLogs[date]?.completedExerciseIds || []).length).length;
    const previousWorkoutCount = previousWorkoutDates.filter((date) => (workoutLogs[date]?.completedExerciseIds || []).length).length;
    const completedExercises = workoutDates.reduce((total, date) => total + (workoutLogs[date]?.completedExerciseIds || []).length, 0);
    const plannedExercises = workoutDates.reduce((total, date) => total + Number(workoutLogs[date]?.plannedExerciseCount || 0), 0);
    const previousCompleted = previousWorkoutDates.reduce((total, date) => total + (workoutLogs[date]?.completedExerciseIds || []).length, 0);
    const previousPlanned = previousWorkoutDates.reduce((total, date) => total + Number(workoutLogs[date]?.plannedExerciseCount || 0), 0);
    const completionRate = plannedExercises ? Math.round((completedExercises / plannedExercises) * 100) : null;
    const previousCompletionRate = previousPlanned ? Math.round((previousCompleted / previousPlanned) * 100) : null;
    const volume = currentLifts.reduce((total, entry) => total + Number(entry.weight || 0) * Number(entry.reps || 0), 0);
    const previousVolume = previousLifts.reduce((total, entry) => total + Number(entry.weight || 0) * Number(entry.reps || 0), 0);
    const distance = currentCardio.reduce((total, entry) => total + Number(entry.distance || 0), 0);
    const previousDistance = previousCardio.reduce((total, entry) => total + Number(entry.distance || 0), 0);
    const duration = currentCardio.reduce((total, entry) => total + Number(entry.duration || 0), 0);
    const previousDuration = previousCardio.reduce((total, entry) => total + Number(entry.duration || 0), 0);
    const pace = distance ? duration / distance : null;
    const setText = (id, value) => { const element = document.getElementById(id); if (element) element.textContent = value; };
    setText('progress-workout-count', workoutCount);
    setText('progress-completion-rate', completionRate === null ? '—' : `${completionRate}%`);
    setText('progress-volume-total', progressNumber(volume, ' kg'));
    setText('progress-cardio-total', progressNumber(distance, ' km'));
    setText('progress-cardio-duration', progressNumber(duration, ' min'));
    setText('progress-cardio-pace', pace ? `${pace.toFixed(1)} min` : '—');
    setText('progress-streak', `${Number(progressTrackers.streak?.current) || 0} days`);
    setText('progress-workout-change', progressDelta(workoutCount, previousWorkoutCount));
    setText('progress-completion-change', completionRate === null || previousCompletionRate === null ? 'Needs planned data' : progressDelta(completionRate, previousCompletionRate));
    setText('progress-volume-change', progressDelta(volume, previousVolume));
    setText('progress-cardio-change', progressDelta(distance, previousDistance));
    setText('progress-duration-change', progressDelta(duration, previousDuration));
    setText('progress-streak-best', `Best: ${Number(progressTrackers.streak?.best) || 0} days`);
    const goalLabels = { 'build-muscle': 'Build muscle', 'lose-fat': 'Lose fat', 'improve-endurance': 'Improve endurance', 'general-fitness': 'General fitness' };
    setText('progress-goal-insight', `${goalLabels[progressGoal] || 'General fitness'} focus: use these trends to keep your training consistent.`);
    const activity = buckets.map((bucket) => workoutDates.filter((date) => progressBucketFor(date, [bucket])).length);
    renderProgressChart('activity', 'progress-activity-chart', buckets.map((bucket) => bucket.label), [{ label: 'Workout days', data: activity, type: 'bar', borderRadius: 3 }], 'progress-activity-empty', 'Complete a planned workout to start your activity trend.', 'bar');
    renderProgressChart('weight', 'progress-weight-chart', currentWeights.map((entry) => entry.date), [{ label: 'Weight (kg)', data: currentWeights.map((entry) => entry.value) }], 'progress-weight-empty', 'Log at least two weight entries to see a trend.');
    const strengthValues = buckets.map((bucket) => currentLifts.filter((entry) => progressBucketFor(entry.date, [bucket])).reduce((total, entry) => total + Number(entry.weight || 0) * Number(entry.reps || 0), 0));
    renderProgressChart('strength', 'progress-strength-chart', buckets.map((bucket) => bucket.label), [{ label: 'Volume (kg)', data: strengthValues }], 'progress-strength-empty', 'Log lifts in Records to see strength and volume build over time.');
    const cardioValues = buckets.map((bucket) => currentCardio.filter((entry) => progressBucketFor(entry.date, [bucket])).reduce((total, entry) => total + Number(entry.distance || 0), 0));
    renderProgressChart('cardio', 'progress-cardio-chart', buckets.map((bucket) => bucket.label), [{ label: 'Distance (km)', data: cardioValues }], 'progress-cardio-empty', 'Log cardio distance and duration in Records to see your endurance trend.');
    const comparisons = document.getElementById('progress-comparisons');
    if (comparisons) comparisons.innerHTML = [['Workouts', workoutCount, previousWorkoutCount, ''], ['Lift volume', volume, previousVolume, ' kg'], ['Cardio distance', distance, previousDistance, ' km'], ['Cardio duration', duration, previousDuration, ' min']].map(([label, value, oldValue, suffix]) => `<div><span>${label}</span><strong>${progressNumber(value, suffix)}</strong><small>${progressDelta(value, oldValue)} vs previous</small></div>`).join('');
    const targetForm = document.getElementById('progress-target-form');
    if (targetForm) {
        const targetDays = Math.max(1, Math.ceil(days / 7));
        const targetWorkoutTotal = progressTargets.workouts * targetDays;
        const targetDistanceTotal = progressTargets.distance * targetDays;
        const targetDurationTotal = progressTargets.duration * targetDays;
        setText('progress-target-insight', `Target progress: ${Math.round((workoutCount / Math.max(1, targetWorkoutTotal)) * 100)}% workouts · ${Math.round((distance / Math.max(1, targetDistanceTotal)) * 100)}% distance · ${Math.round((duration / Math.max(1, targetDurationTotal)) * 100)}% duration.`);
        ['workouts', 'distance', 'duration'].forEach((name) => { const input = document.getElementById(`progress-target-${name}`); if (input) input.value = progressTargets[name]; });
    }
    const measurementContainer = document.getElementById('progress-measurements');
    if (measurementContainer) measurementContainer.innerHTML = currentMeasurements.length ? [...currentMeasurements].sort((a, b) => b.date.localeCompare(a.date)).map((entry) => `<div><strong>${escapeHtml(entry.date)}</strong><span>Waist ${entry.waist || '—'} cm · Chest ${entry.chest || '—'} cm · Arms ${entry.arms || '—'} cm · Body fat ${entry.bodyFat || '—'}%</span></div>`).join('') : '<p class="empty-state">Log waist, chest, arms, or body fat measurements in Records to see change over time.</p>';
    const previousBestByExercise = {};
    previousLifts.forEach((entry) => { const key = entry.exercise.trim().toLowerCase(); const value = Number(entry.weight) * (1 + Number(entry.reps) / 30); previousBestByExercise[key] = Math.max(previousBestByExercise[key] || 0, value); });
    const currentBestByExercise = {};
    currentLifts.forEach((entry) => { const key = entry.exercise.trim().toLowerCase(); const value = Number(entry.weight) * (1 + Number(entry.reps) / 30); currentBestByExercise[key] = Math.max(currentBestByExercise[key] || 0, value); });
    const personalBestContainer = document.getElementById('progress-prs');
    if (personalBestContainer) {
        const improvements = Object.keys(currentBestByExercise).map((key) => ({ name: currentLifts.find((entry) => entry.exercise.trim().toLowerCase() === key)?.exercise || key, value: currentBestByExercise[key], previous: previousBestByExercise[key] || 0 })).filter((entry) => !entry.previous || entry.value > entry.previous).sort((a, b) => b.value - a.value);
        personalBestContainer.innerHTML = improvements.length ? improvements.slice(0, 5).map((entry) => `<div><span>${escapeHtml(entry.name)}</span><strong>${nutritionNumber(entry.value)} kg</strong><small>${entry.previous ? `+${nutritionNumber(entry.value - entry.previous)} kg` : 'New best'}</small></div>`).join('') : '<p class="empty-state">Log the same lift in two periods to see personal-best improvements.</p>';
    }
}

document.getElementById('progress-period')?.addEventListener('change', renderProgress);
document.getElementById('progress-target-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const user = auth.currentUser;
    if (!user) return;
    progressTargets = {
        workouts: Number(document.getElementById('progress-target-workouts').value),
        distance: Number(document.getElementById('progress-target-distance').value),
        duration: Number(document.getElementById('progress-target-duration').value)
    };
    try {
        await setDoc(doc(db, 'users', user.uid), { progressTargets }, { merge: true });
        setSettingsStatus('progress-target-status', 'Targets saved.');
        renderProgress();
    } catch (error) {
        setSettingsStatus('progress-target-status', 'Could not save targets.', true);
        console.error(error);
    }
});
document.getElementById('record-entry-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    recordsData.lifts.push({ id: `lift-${Date.now()}`, date: getLocalDateKey(), exercise: document.getElementById('record-exercise').value.trim(), weight: Number(document.getElementById('record-weight').value), reps: Number(document.getElementById('record-reps').value) });
    try { await saveRecordsData(); event.target.reset(); renderRecords(); setSettingsStatus('record-entry-status', 'Lift saved.'); } catch (error) { setSettingsStatus('record-entry-status', 'Could not save lift.', true); console.error(error); }
});
document.getElementById('cardio-entry-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    recordsData.cardio.push({ id: `cardio-${Date.now()}`, date: getLocalDateKey(), activity: document.getElementById('cardio-activity').value.trim(), distance: Number(document.getElementById('cardio-distance').value), duration: Number(document.getElementById('cardio-duration').value) });
    try { await saveRecordsData(); event.target.reset(); renderRecords(); setSettingsStatus('cardio-entry-status', 'Cardio session saved.'); } catch (error) { setSettingsStatus('cardio-entry-status', 'Could not save cardio session.', true); console.error(error); }
});
document.getElementById('measurement-entry-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    recordsData.measurements.push({ id: `measurement-${Date.now()}`, date: getLocalDateKey(), waist: Number(document.getElementById('measurement-waist').value || 0), chest: Number(document.getElementById('measurement-chest').value || 0), arms: Number(document.getElementById('measurement-arms').value || 0), bodyFat: Number(document.getElementById('measurement-body-fat').value || 0) });
    try { await saveRecordsData(); event.target.reset(); renderRecords(); setSettingsStatus('measurement-entry-status', 'Measurements saved.'); } catch (error) { setSettingsStatus('measurement-entry-status', 'Could not save measurements.', true); console.error(error); }
});
document.getElementById('progress-photo-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    recordsData.photos.push({ id: `photo-${Date.now()}`, date: getLocalDateKey(), url: document.getElementById('progress-photo-url').value.trim() });
    try { await saveRecordsData(); event.target.reset(); renderRecords(); setSettingsStatus('progress-photo-status', 'Photo reference saved.'); } catch (error) { setSettingsStatus('progress-photo-status', 'Could not save photo reference.', true); console.error(error); }
});
document.getElementById('export-records')?.addEventListener('click', () => {
    const exportData = { records: recordsData, workoutPlan, workoutLogs, nutrition: nutritionData };
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' }));
    link.download = `fitness-tracker-export-${getLocalDateKey()}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
    setSettingsStatus('records-export-status', 'Data exported.');
});

function nutritionTotals(meals = []) {
    return meals.reduce((totals, meal) => ({
        calories: totals.calories + Number(meal.calories || 0),
        protein: totals.protein + Number(meal.protein || 0),
        carbs: totals.carbs + Number(meal.carbs || 0),
        fat: totals.fat + Number(meal.fat || 0)
    }), { calories: 0, protein: 0, carbs: 0, fat: 0 });
}

function nutritionNumber(value) {
    const number = Number(value) || 0;
    return Number.isInteger(number) ? String(number) : number.toFixed(1);
}

async function loadNutritionData(user = auth.currentUser) {
    if (!user) return nutritionData;
    try {
        const snapshot = await getDoc(doc(db, 'users', user.uid));
        const saved = snapshot.data()?.nutrition || {};
        const hadLegacyWaterGoal = Number(saved.targets?.water) === 3;
        nutritionData = {
            targets: Object.fromEntries(Object.keys(DEFAULT_NUTRITION_TARGETS).map((key) => [key, Number(saved.targets?.[key]) || DEFAULT_NUTRITION_TARGETS[key]])),
            days: saved.days || {}
        };
        if (hadLegacyWaterGoal) {
            nutritionData.targets.water = DEFAULT_NUTRITION_TARGETS.water;
            await saveNutritionData(user);
        }
    } catch (error) {
        console.warn('Could not fetch nutrition data:', error);
    }
    return nutritionData;
}

async function saveNutritionData(user = auth.currentUser) {
    if (!user) return;
    await setDoc(doc(db, 'users', user.uid), { nutrition: nutritionData }, { merge: true });
}

function renderNutrition() {
    const today = getLocalDateKey();
    const day = nutritionData.days[today] || { meals: [] };
    const totals = nutritionTotals(day.meals);
    const targets = nutritionData.targets;
    const waterToday = Number(day.water || 0);
    const setText = (id, value) => { const element = document.getElementById(id); if (element) element.textContent = value; };
    const setBar = (id, value, target) => { const element = document.getElementById(id); if (element) element.style.width = `${Math.min(100, target ? (value / target) * 100 : 0)}%`; };

    setText('nutrition-calorie-total', `${nutritionNumber(totals.calories)} kcal`);
    setText('nutrition-calorie-status', `${nutritionNumber(totals.calories)} of ${nutritionNumber(targets.calories)} kcal`);
    setText('nutrition-protein-total', `${nutritionNumber(totals.protein)} g`);
    setText('nutrition-carbs-total', `${nutritionNumber(totals.carbs)} g`);
    setText('nutrition-fat-total', `${nutritionNumber(totals.fat)} g`);
    setText('nutrition-water-total', `${nutritionNumber(waterToday)} L`);
    setText('nutrition-water-status', `${nutritionNumber(waterToday)} of ${nutritionNumber(targets.water)} L`);
    setText('nutrition-protein-target', `of ${nutritionNumber(targets.protein)} g`);
    setText('nutrition-carbs-target', `of ${nutritionNumber(targets.carbs)} g`);
    setText('nutrition-fat-target', `of ${nutritionNumber(targets.fat)} g`);
    setBar('nutrition-calorie-bar', totals.calories, targets.calories);
    setBar('nutrition-protein-bar', totals.protein, targets.protein);
    setBar('nutrition-carbs-bar', totals.carbs, targets.carbs);
    setBar('nutrition-fat-bar', totals.fat, targets.fat);
    setBar('nutrition-water-bar', waterToday, targets.water);
    document.querySelector('.nutrition-calorie-progress')?.setAttribute('aria-valuenow', Math.min(100, targets.calories ? Math.round((totals.calories / targets.calories) * 100) : 0));
    document.getElementById('nutrition-water-bar')?.parentElement.setAttribute('aria-valuenow', Math.min(100, targets.water ? Math.round((waterToday / targets.water) * 100) : 0));

    setText('calories-value', totals.calories || '—');
    setText('calories-target', targets.calories || '—');
    setBar('calories-progress', totals.calories, targets.calories);
    setText('water-value', waterToday || '—');
    setText('water-target', targets.water || '—');
    const waterDrops = document.getElementById('water-drops');
    if (waterDrops) {
        const filledDrops = Math.round((waterToday / (targets.water || 1)) * 3);
        waterDrops.innerHTML = Array.from({ length: 3 }, (_, index) => `<span class="drop${index < filledDrops ? ' full' : ''}">💧</span>`).join('');
    }

    ['calories', 'protein', 'carbs', 'fat', 'water'].forEach((name) => {
        const input = document.getElementById(`nutrition-target-${name}`);
        if (input) input.value = targets[name];
    });
    const history = document.getElementById('meal-history-list');
    if (history) {
        history.innerHTML = day.meals.length ? day.meals.map((meal) => `<li><div><strong>${escapeHtml(meal.name)}</strong><span>${escapeHtml(meal.food)}</span></div><b>${nutritionNumber(meal.calories)} kcal</b><button type="button" data-meal-id="${escapeHtml(meal.id)}" aria-label="Delete ${escapeHtml(meal.food)}">Delete</button></li>`).join('') : '<li class="nutrition-empty-state">No meals logged today.</li>';
    }

    const chart = document.getElementById('nutrition-week-chart');
    if (chart) {
        const days = Array.from({ length: 7 }, (_, index) => {
            const date = new Date();
            date.setDate(date.getDate() - (6 - index));
            const key = getLocalDateKey(date);
            return { key, label: date.toLocaleDateString(undefined, { weekday: 'short' }), total: nutritionTotals(nutritionData.days[key]?.meals || []).calories };
        });
        chart.innerHTML = days.map((entry) => `<div class="nutrition-chart-day"><span class="nutrition-chart-value">${entry.total ? nutritionNumber(entry.total) : ''}</span><div class="nutrition-chart-track"><span style="height:${Math.min(100, targets.calories ? (entry.total / targets.calories) * 100 : 0)}%"></span></div><small>${entry.label}</small></div>`).join('');
    }
}

document.getElementById('meal-entry-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const currentUser = auth.currentUser;
    if (!currentUser) return;
    const meal = {
        id: `meal-${Date.now()}`,
        name: document.getElementById('meal-name').value.trim(),
        food: document.getElementById('meal-food').value.trim(),
        calories: Number(document.getElementById('meal-calories').value),
        protein: Number(document.getElementById('meal-protein').value || 0),
        carbs: Number(document.getElementById('meal-carbs').value || 0),
        fat: Number(document.getElementById('meal-fat').value || 0)
    };
    nutritionData.days[getLocalDateKey()] ??= { meals: [] };
    nutritionData.days[getLocalDateKey()].meals.push(meal);
    try {
        await saveNutritionData(currentUser);
        event.target.reset();
        renderNutrition();
        setSettingsStatus('meal-entry-status', 'Meal logged.');
    } catch (error) {
        setSettingsStatus('meal-entry-status', 'Could not save meal.', true);
    }
});

document.getElementById('meal-history-list')?.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-meal-id]');
    if (!button || !auth.currentUser) return;
    const today = getLocalDateKey();
    nutritionData.days[today].meals = (nutritionData.days[today].meals || []).filter((meal) => meal.id !== button.dataset.mealId);
    await saveNutritionData();
    renderNutrition();
});

document.getElementById('nutrition-target-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    nutritionData.targets = {
        calories: Number(document.getElementById('nutrition-target-calories').value),
        protein: Number(document.getElementById('nutrition-target-protein').value),
        carbs: Number(document.getElementById('nutrition-target-carbs').value),
        fat: Number(document.getElementById('nutrition-target-fat').value),
        water: Number(document.getElementById('nutrition-target-water').value)
    };
    try { await saveNutritionData(); renderNutrition(); setSettingsStatus('nutrition-target-status', 'Targets saved.'); }
    catch { setSettingsStatus('nutrition-target-status', 'Could not save targets.', true); }
});

document.getElementById('barcode-search-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const code = document.getElementById('food-barcode').value.replace(/\s/g, '');
    const status = document.getElementById('barcode-search-status');
    const result = document.getElementById('barcode-result');
    status.textContent = 'Looking up food...';
    try {
        const response = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json`);
        const data = await response.json();
        if (!data.product) throw new Error('Product not found');
        const product = data.product;
        const nutrients = product.nutriments || {};
        const productName = product.product_name || 'Scanned food';
        const nutritionDefaults = {
            calories: Number(nutrients['energy-kcal_100g']) || 0,
            protein: Number(nutrients.proteins_100g) || 0,
            carbs: Number(nutrients.carbohydrates_100g) || 0,
            fat: Number(nutrients.fat_100g) || 0
        };
        const hour = new Date().getHours();
        const mealName = hour < 11 ? 'Breakfast' : hour < 16 ? 'Lunch' : hour < 21 ? 'Dinner' : 'Snack';
        result.hidden = false;
        result.innerHTML = `<strong>${escapeHtml(productName)}</strong><span>${nutritionNumber(nutritionDefaults.calories)} kcal, ${nutritionNumber(nutritionDefaults.protein)} g protein, ${nutritionNumber(nutritionDefaults.carbs)} g carbs, ${nutritionNumber(nutritionDefaults.fat)} g fat per 100 g</span><button type="button" class="secondary-btn" id="use-barcode-food">Use in meal form</button>`;
        document.getElementById('use-barcode-food').addEventListener('click', () => {
            document.getElementById('meal-name').value = mealName;
            document.getElementById('meal-food').value = productName;
            document.getElementById('meal-calories').value = nutritionDefaults.calories;
            document.getElementById('meal-protein').value = nutritionDefaults.protein;
            document.getElementById('meal-carbs').value = nutritionDefaults.carbs;
            document.getElementById('meal-fat').value = nutritionDefaults.fat;
            document.getElementById('meal-entry-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
        status.textContent = 'Product found.';
    } catch { result.hidden = true; status.textContent = 'No product found for that barcode.'; }
});

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
    const history = event.target.value === 'all' ? weightHistoryData : weightHistoryData.filter((entry) => {
        const timestamp = new Date(`${entry.date}T00:00:00`).getTime();
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);
        return Number.isFinite(timestamp) && timestamp >= startOfMonth.getTime();
    });
    renderWeightChart(history);
});

const sidebarItems = [...document.querySelectorAll('#sidebar li[data-section]')];
const workoutPage = document.getElementById('workout-page');
const settingsPage = document.getElementById('settings-page');
const nutritionPage = document.getElementById('nutrition-page');
const progressPage = document.getElementById('progress-page');
const recordsPage = document.getElementById('records-page');
const aboutFt26Page = document.getElementById('about-ft26-page');
const dashboardCards = document.querySelector('.cards-container');

document.getElementById('profile-settings-link')?.addEventListener('click', () => {
    setActiveSidebarSection('settings');
});

function setActiveSidebarSection(section) {
    sidebarItems.forEach((item) => {
        item.classList.toggle('active', item.dataset.section === section);
    });

    const isWorkoutPage = section === 'workouts';
    const isSettingsPage = section === 'settings';
    const isNutritionPage = section === 'nutrition';
    const isProgressPage = section === 'progress';
    const isRecordsPage = section === 'records';
    const isAboutFt26Page = section === 'about-ft26';
    if (workoutPage) workoutPage.hidden = !isWorkoutPage;
    if (settingsPage) settingsPage.hidden = !isSettingsPage;
    if (nutritionPage) nutritionPage.hidden = !isNutritionPage;
    if (progressPage) progressPage.hidden = !isProgressPage;
    if (recordsPage) recordsPage.hidden = !isRecordsPage;
    if (aboutFt26Page) aboutFt26Page.hidden = !isAboutFt26Page;
    if (dashboardCards) dashboardCards.hidden = isWorkoutPage || isSettingsPage || isNutritionPage || isProgressPage || isRecordsPage || isAboutFt26Page;
    setMobileMenu(false);
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

const WORKOUT_PRESETS = {
    'chest-tricep': {
        title: 'Chest & Tricep Day',
        exercises: [
            ['bench-press', 'Chest', 'Bench Press'],
            ['incline-dumbbell-press', 'Chest', 'Incline Dumbbell Press'],
            ['chest-fly', 'Chest', 'Chest Fly'],
            ['dips', 'Triceps', 'Dips'],
            ['triceps-pushdown', 'Triceps', 'Triceps Pushdown'],
            ['overhead-triceps-extension', 'Triceps', 'Overhead Triceps Extension']
        ]
    },
    leg: {
        title: 'Leg Day',
        exercises: [
            ['back-squat', 'Quads', 'Back Squat'],
            ['romanian-deadlift', 'Hamstrings', 'Romanian Deadlift'],
            ['leg-press', 'Quads', 'Leg Press'],
            ['walking-lunges', 'Glutes', 'Walking Lunges'],
            ['leg-curl', 'Hamstrings', 'Leg Curl'],
            ['calf-raise', 'Calves', 'Standing Calf Raise']
        ]
    },
    'back-bicep': {
        title: 'Back & Bicep Day',
        exercises: [
            ['deadlift', 'Back', 'Deadlift'],
            ['lat-pulldown', 'Back', 'Lat Pulldown'],
            ['seated-cable-row', 'Back', 'Seated Cable Row'],
            ['dumbbell-row', 'Back', 'One-arm Dumbbell Row'],
            ['barbell-curl', 'Biceps', 'Barbell Curl'],
            ['hammer-curl', 'Biceps', 'Hammer Curl']
        ]
    },
    shoulder: {
        title: 'Shoulder Day',
        exercises: [
            ['overhead-press', 'Shoulders', 'Overhead Press'],
            ['lateral-raise', 'Shoulders', 'Dumbbell Lateral Raise'],
            ['rear-delt-fly', 'Shoulders', 'Rear Delt Fly'],
            ['arnold-press', 'Shoulders', 'Arnold Press'],
            ['upright-row', 'Shoulders', 'Upright Row'],
            ['face-pull', 'Shoulders', 'Face Pull']
        ]
    }
};

const WORKOUT_DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
let workoutPlan = {};
let workoutLogs = {};
let customExercises = [];
let viewedWorkoutDay = getTodayWorkoutDay();

function exerciseObjects(exercises = []) {
    return exercises.map(([id, muscle, name]) => ({ id, muscle, name }));
}

function getTodayWorkoutDay() {
    return WORKOUT_DAYS[new Date().getDay()];
}

function currentWorkout(day = getTodayWorkoutDay()) {
    const saved = workoutPlan[day];
    if (!saved || saved.type === 'rest') return { title: 'Rest Day', exercises: [] };
    return {
        title: saved.title || WORKOUT_PRESETS[saved.type]?.title || 'Custom Workout',
        exercises: Array.isArray(saved.exercises) ? saved.exercises : []
    };
}

function renderWorkoutLists() {
    const todayWorkout = currentWorkout();
    const viewedWorkout = currentWorkout(viewedWorkoutDay);
    const today = getLocalDateKey();
    const completed = new Set(workoutLogs[today]?.completedExerciseIds || []);
    const renderList = (workout, canLog) => workout.exercises.length
        ? workout.exercises.map((exercise) => `
            <li><label><input type="checkbox" data-workout-exercise="${escapeHtml(exercise.id)}" ${completed.has(exercise.id) && canLog ? 'checked' : ''} ${canLog ? '' : 'disabled'}><span><strong>${escapeHtml(exercise.muscle)}</strong><small>${escapeHtml(exercise.name)}</small></span></label></li>
        `).join('')
        : `<li class="empty-state">No workout is assigned for ${canLog ? 'today' : viewedWorkoutDay}. Choose a plan below.</li>`;

    const dashboardList = document.getElementById('workout-checklist');
    const pageList = document.getElementById('page-workout-checklist');
    if (dashboardList) dashboardList.innerHTML = renderList(todayWorkout, true);
    if (pageList) pageList.innerHTML = renderList(todayWorkout, true);
    const title = document.getElementById('today-workout-title');
    const pageTitle = document.getElementById('workout-page-title');
    const todayPageTitle = document.getElementById('today-page-workout-title');
    const exercisesTitle = document.getElementById('workout-exercises-title');
    const pageDescription = document.getElementById('workout-page-description');
    const viewedDayName = viewedWorkoutDay[0].toUpperCase() + viewedWorkoutDay.slice(1);
    if (title) title.textContent = todayWorkout.title;
    if (pageTitle) pageTitle.textContent = `${todayWorkout.title} · Today`;
    if (todayPageTitle) todayPageTitle.textContent = todayWorkout.title;
    if (exercisesTitle) exercisesTitle.textContent = 'Today\'s Exercises';
    if (pageDescription) {
        pageDescription.textContent = 'Complete each exercise to log today\'s workout.';
    }

    const checkboxes = [...document.querySelectorAll('[data-workout-exercise]')];
    const updateProgress = (listId, workout, prefix) => {
        const listCheckboxes = [...document.querySelectorAll(`#${listId} [data-workout-exercise]`)]
        const count = listCheckboxes.filter((checkbox) => checkbox.checked).length;
        const percent = workout.exercises.length ? Math.round((count / workout.exercises.length) * 100) : 0;
        document.getElementById(`${prefix}-progress-label`).textContent = `${count} / ${workout.exercises.length} exercises`;
        document.getElementById(`${prefix}-progress-percent`).textContent = `${percent}%`;
        const progressBar = document.getElementById(`${prefix}-progress-bar`);
        progressBar.classList.remove('workout-progress-updated');
        progressBar.style.width = '0%';
        requestAnimationFrame(() => {
            progressBar.classList.add('workout-progress-updated');
            progressBar.style.width = `${percent}%`;
        });
    };
    updateProgress('workout-checklist', todayWorkout, 'workout');
    updateProgress('page-workout-checklist', viewedWorkout, 'page-workout');

    checkboxes.forEach((checkbox) => checkbox.addEventListener('change', async () => {
        const list = checkbox.closest('ul');
        const logDay = list?.id === 'page-workout-checklist' ? viewedWorkoutDay : getTodayWorkoutDay();
        if (logDay !== getTodayWorkoutDay()) return;
        const ids = [...document.querySelectorAll(`#${list.id} [data-workout-exercise]`)]
            .filter((item) => item.checked).map((item) => item.dataset.workoutExercise);
        workoutLogs[today] = { completedExerciseIds: ids, plannedExerciseCount: todayWorkout.exercises.length };
        renderWorkoutLists();
        if (ids.length === todayWorkout.exercises.length && todayWorkout.exercises.length) await recordCompletedWorkout();
        if (auth.currentUser) {
            try { await setDoc(doc(db, 'users', auth.currentUser.uid), { workoutLogs }, { merge: true }); }
            catch (error) { notify('Workout progress could not be saved.'); console.error(error); }
        }
    }));
    renderWeeklyWorkoutPlans();
}

function renderWeeklyWorkoutPlans() {
    const container = document.getElementById('weekly-workout-list');
    if (!container) return;
    const today = getTodayWorkoutDay();
    container.innerHTML = WORKOUT_DAYS.slice(1).concat(WORKOUT_DAYS[0]).map((day) => {
        const workout = currentWorkout(day);
        const dayName = day[0].toUpperCase() + day.slice(1);
        const isToday = day === today;
        const exerciseMarkup = workout.exercises.length
            ? `<ul>${workout.exercises.map((exercise) => `<li><strong>${escapeHtml(exercise.muscle)}</strong><span>${escapeHtml(exercise.name)}</span></li>`).join('')}</ul>`
            : '<p class="empty-state">No workout assigned.</p>';
        return `<div class="weekly-workout-day ${isToday ? 'is-today' : ''}">
            <button type="button" class="weekly-workout-toggle" aria-expanded="false">
                <span><strong>${dayName}</strong>${isToday ? '<small>Today</small>' : ''}</span>
                <span class="weekly-workout-name">${escapeHtml(workout.title)}</span><span aria-hidden="true">+</span>
            </button>
            <div class="weekly-workout-exercises" hidden>${exerciseMarkup}</div>
        </div>`;
    }).join('');
    container.querySelectorAll('.weekly-workout-toggle').forEach((button) => {
        button.addEventListener('click', () => {
            const details = button.nextElementSibling;
            const expanded = button.getAttribute('aria-expanded') === 'true';
            button.setAttribute('aria-expanded', String(!expanded));
            details.hidden = expanded;
        });
    });
}

function renderWorkoutPlanEditor(loadSavedType = true) {
    const daySelect = document.getElementById('workout-plan-day');
    const typeSelect = document.getElementById('workout-plan-type');
    const customControls = document.getElementById('custom-exercise-controls');
    const customList = document.getElementById('custom-exercise-list');
    if (!daySelect || !typeSelect || !customControls || !customList) return;
    const saved = workoutPlan[daySelect.value] || { type: 'chest-tricep' };
    if (loadSavedType) typeSelect.value = saved.type || 'custom';
    customControls.hidden = typeSelect.value !== 'custom';
    customList.innerHTML = customExercises.map((exercise, index) => `
        <li>${escapeHtml(exercise.name)}<button type="button" data-remove-custom="${index}" aria-label="Remove ${escapeHtml(exercise.name)}">Remove</button></li>
    `).join('');
}

async function saveWorkoutDay(event) {
    event.preventDefault();
    const day = document.getElementById('workout-plan-day').value;
    const type = document.getElementById('workout-plan-type').value;
    const exercises = type === 'custom'
        ? customExercises
        : type === 'rest' ? [] : exerciseObjects(WORKOUT_PRESETS[type].exercises);
    if (type === 'custom' && !exercises.length) {
        setSettingsStatus('workout-plan-status', 'Add at least one custom exercise.', true);
        return;
    }
    workoutPlan[day] = {
        type,
        title: type === 'custom' ? 'Custom Workout' : type === 'rest' ? 'Rest Day' : WORKOUT_PRESETS[type].title,
        exercises
    };
    try {
        await setDoc(doc(db, 'users', auth.currentUser.uid), { workoutPlan }, { merge: true });
        viewedWorkoutDay = day;
        setSettingsStatus('workout-plan-status', `${day[0].toUpperCase() + day.slice(1)} plan saved.`);
        renderWorkoutLists();
    } catch (error) {
        setSettingsStatus('workout-plan-status', 'Could not save workout plan.', true);
        console.error(error);
    }
}

document.getElementById('workout-plan-day')?.addEventListener('change', () => {
    const selectedDay = document.getElementById('workout-plan-day').value;
    viewedWorkoutDay = selectedDay;
    const saved = workoutPlan[selectedDay];
    customExercises = saved?.type === 'custom' ? [...(saved.exercises || [])] : [];
    renderWorkoutPlanEditor();
    renderWorkoutLists();
});
document.getElementById('workout-plan-type')?.addEventListener('change', () => renderWorkoutPlanEditor(false));
document.getElementById('add-custom-exercise')?.addEventListener('click', () => {
    const input = document.getElementById('custom-exercise-name');
    const name = input.value.trim();
    if (!name) return;
    customExercises.push({ id: `custom-${Date.now()}`, muscle: 'Custom', name });
    input.value = '';
    renderWorkoutPlanEditor(false);
});
document.getElementById('custom-exercise-list')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-remove-custom]');
    if (!button) return;
    customExercises.splice(Number(button.dataset.removeCustom), 1);
    renderWorkoutPlanEditor(false);
});
document.getElementById('workout-plan-form')?.addEventListener('submit', saveWorkoutDay);

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
    document.body.classList.remove('theme-electric', 'theme-amber', 'theme-crimson', 'theme-monochrome', 'theme-simple');
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

applyTheme(localStorage.getItem('fitness-tracker-theme') || 'simple');
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
    const birthdate = document.getElementById('settings-birthdate').value;
    const gender = document.getElementById('settings-gender').value;
    const units = document.getElementById('settings-units').value;
    const goal = document.getElementById('settings-goal').value;
    try {
        await updateProfile(user, { displayName: `${firstName} ${lastName}`.trim() });
        await updateDoc(doc(db, 'users', user.uid), { firstName, lastName, birthdate, gender, units, goal });
        document.getElementById('profile-name').textContent = firstName || 'User';
        document.getElementById('profile-avatar').textContent = (firstName || 'U').charAt(0).toUpperCase();
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
    const currentPassword = document.getElementById('settings-current-password').value;
    const password = document.getElementById('settings-password').value;
    const confirmation = document.getElementById('settings-password-confirm').value;
    if (password !== confirmation) {
        setSettingsStatus('password-settings-status', 'Passwords do not match.', true);
        return;
    }
    try {
        const credential = EmailAuthProvider.credential(user.email, currentPassword);
        await reauthenticateWithCredential(user, credential);
        await updatePassword(user, password);
        event.target.reset();
        setSettingsStatus('password-settings-status', 'Password updated.');
    } catch (error) {
        const message = error.code === 'auth/invalid-credential' || error.code === 'auth/wrong-password'
            ? 'Current password is incorrect.'
            : error.code === 'auth/requires-recent-login'
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
    let userSnap;
    try {
        userSnap = await getDoc(userRef);
    } catch (error) {
        console.error('Could not load dashboard data:', error);
        document.body.classList.remove('app-status-loading');
        notify('Dashboard data could not be loaded. Please try again.');
        return;
    }

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

    try {
        await renderTodayChecklist(user);
        await loadNutritionData(user);
        renderNutrition();
    } catch (error) {
        console.error('Dashboard data loading failed:', error);
        notify('Some dashboard data could not be loaded. Please try again.');
    }

    // Listen for realtime updates to user document to update trackers live
    onSnapshot(userRef, (snap) => {
        if (!snap.exists()) {
            document.body.classList.remove('app-status-loading');
            return;
        }
        const d = snap.data();
        workoutPlan = d.workoutPlan || {};
        workoutLogs = d.workoutLogs || {};
        recordsData = { lifts: [], cardio: [], measurements: [], photos: [], ...(d.records || {}) };
        progressTrackers = d.trackers || d.stats || {};
        progressGoal = d.goal || 'general-fitness';
        progressTargets = { workouts: 3, distance: 10, duration: 120, ...(d.progressTargets || {}) };
        const todayPlan = workoutPlan[getTodayWorkoutDay()];
        if (todayPlan?.type === 'custom') customExercises = [...(todayPlan.exercises || [])];
        renderWorkoutPlanEditor();
        renderWorkoutLists();
        renderRecords();
        if (d.nutrition) {
            nutritionData = {
                targets: { ...DEFAULT_NUTRITION_TARGETS, ...(d.nutrition.targets || {}) },
                days: d.nutrition.days || {}
            };
            renderNutrition();
        }
        const trackers = progressTrackers;
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
        weightHistoryData = weightHistory;
        if (weightHistory.length > 1) {
            const selectedRange = document.getElementById('weight-range')?.value || 'month';
            const chartHistory = selectedRange === 'all' ? weightHistoryData : weightHistoryData.filter((entry) => {
                const timestamp = new Date(`${entry.date}T00:00:00`).getTime();
                const startOfMonth = new Date();
                startOfMonth.setDate(1);
                startOfMonth.setHours(0, 0, 0, 0);
                return Number.isFinite(timestamp) && timestamp >= startOfMonth.getTime();
            });
            const weightHistoryKey = JSON.stringify([selectedRange, chartHistory]);
            if (weightHistoryKey !== renderedWeightHistoryKey) {
                renderWeightChart(chartHistory);
                renderedWeightHistoryKey = weightHistoryKey;
            }
        }
        const weightEl = document.getElementById('weight-value');
        const weightChangeEl = document.getElementById('weight-change');
        if (weightEl) weightEl.textContent = weightVal === '—' ? '— kg' : `${weightVal} kg`;
        if (weightChangeEl) weightChangeEl.textContent = weightChange ? `${weightChange}` : '';

        // calories
        const nutritionDay = nutritionData.days[getLocalDateKey()] || { meals: [], water: 0 };
        const calToday = nutritionTotals(nutritionDay.meals).calories;
        const calTarget = nutritionData.targets.calories || 2000;
        const calPct = calTarget ? Math.min(100, Math.round((calToday / calTarget) * 100)) : 0;
        const calValEl = document.getElementById('calories-value');
        const calTargetEl = document.getElementById('calories-target');
        const calBar = document.getElementById('calories-progress');
        if (calValEl) calValEl.textContent = calToday || '—';
        if (calTargetEl) calTargetEl.textContent = calTarget || '—';
        if (calBar) calBar.style.width = `${calPct}%`;

        // water
        const waterToday = Number(nutritionDay.water || 0);
        const waterTarget = nutritionData.targets.water || DEFAULT_NUTRITION_TARGETS.water;
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
        document.body.classList.remove('app-status-loading');
    }, (error) => {
        console.error('Realtime dashboard updates failed:', error);
        document.body.classList.remove('app-status-loading');
        notify('Live updates are unavailable. Check your connection.');
    });

    if(userSnap.exists()) {
        const data = userSnap.data();
        workoutPlan = data.workoutPlan || {};
        workoutLogs = data.workoutLogs || {};
        recordsData = { lifts: [], cardio: [], measurements: [], photos: [], ...(data.records || {}) };
        const savedTodayPlan = workoutPlan[getTodayWorkoutDay()];
        customExercises = savedTodayPlan?.type === 'custom' ? [...(savedTodayPlan.exercises || [])] : [];
        renderWorkoutPlanEditor();
        renderWorkoutLists();
        renderRecords();
        const profileNameEl = document.getElementById('profile-name');
        const profileAvatarEl = document.getElementById('profile-avatar');
        const userName = data.firstName || data.displayName || (data.email ? data.email.split('@')[0] : 'User');

        document.getElementById("username").textContent = userName;
        if (profileNameEl) profileNameEl.textContent = userName;
        if (profileAvatarEl) profileAvatarEl.textContent = userName.charAt(0).toUpperCase();
        const settingsFirstName = document.getElementById('settings-first-name');
        const settingsLastName = document.getElementById('settings-last-name');
        const settingsEmail = document.getElementById('settings-email');
        const settingsBirthdate = document.getElementById('settings-birthdate');
        const settingsGender = document.getElementById('settings-gender');
        const settingsUnits = document.getElementById('settings-units');
        const settingsGoal = document.getElementById('settings-goal');
        if (settingsFirstName) settingsFirstName.value = data.firstName || '';
        if (settingsLastName) settingsLastName.value = data.lastName || '';
        if (settingsEmail) settingsEmail.value = user.email || data.email || '';
        if (settingsBirthdate) settingsBirthdate.value = data.birthdate || '';
        if (settingsGender) settingsGender.value = data.gender || 'other';
        if (settingsUnits) settingsUnits.value = data.units || 'metric';
        if (settingsGoal) settingsGoal.value = data.goal || 'general-fitness';
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

document.getElementById('water-entry-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!auth.currentUser) return;
    const amount = Number(document.getElementById('water-entry').value);
    if (!Number.isFinite(amount) || amount <= 0) return;
    const today = getLocalDateKey();
    nutritionData.days[today] ??= { meals: [], water: 0 };
    nutritionData.days[today].water = Number(nutritionData.days[today].water || 0) + amount;
    try {
        await saveNutritionData();
        event.target.reset();
        renderNutrition();
        setSettingsStatus('water-entry-status', 'Water logged.');
    } catch (error) {
        setSettingsStatus('water-entry-status', 'Could not save water.', true);
        console.error('Water save failed:', error);
    }
});