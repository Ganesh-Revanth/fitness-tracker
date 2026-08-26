import { auth, db } from "./firebase.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js";
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js";

const WORKOUT_STORAGE_KEY = 'fitness-tracker-today-workout';
const TODAY_CHECKLIST_STORAGE_KEY = 'fitness-tracker-today-checklist';

const checkboxes = [...document.querySelectorAll('#workout-detail-checklist input[type="checkbox"]')];
const savedWorkout = JSON.parse(localStorage.getItem(WORKOUT_STORAGE_KEY) || '[]');

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

async function getUserChecklist(user) {
    if (!user) return [];

    try {
        const userRef = doc(db, 'users', user.uid);
        const userSnap = await getDoc(userRef);
        const savedChecklist = Array.isArray(userSnap.data()?.dailyChecklist) ? userSnap.data().dailyChecklist : [];
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
    try {
        await setDoc(doc(db, 'users', user.uid), { dailyChecklist: normalized }, { merge: true });
    } catch (error) {
        console.warn('Could not save checklist to database:', error);
    }
    localStorage.setItem(TODAY_CHECKLIST_STORAGE_KEY, JSON.stringify(normalized));
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
}

function updateWorkoutDetail() {
    const completed = checkboxes.filter((checkbox) => checkbox.checked).length;
    const percent = Math.round((completed / checkboxes.length) * 100);
    document.getElementById('detail-progress-percent').textContent = `${percent}%`;
    localStorage.setItem(WORKOUT_STORAGE_KEY, JSON.stringify(checkboxes.map((checkbox) => checkbox.checked)));
}

checkboxes.forEach((checkbox, index) => {
    checkbox.checked = savedWorkout[index] === true;
    checkbox.addEventListener('change', updateWorkoutDetail);
});
updateWorkoutDetail();

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
});

document.getElementById('checklist-editor-list')?.addEventListener('input', async (event) => {
    const itemElement = event.target.closest('.checklist-editor-item');
    if (!itemElement) return;

    const user = auth.currentUser;
    if (!user) return;

    const itemId = itemElement.dataset.id;
    const checklist = await getUserChecklist(user);
    const nextChecklist = checklist.map((item) => {
        if (item.id !== itemId) return item;

        if (event.target.matches('.checklist-label')) {
            return { ...item, label: event.target.value.trim() || 'Protein' };
        }

        if (event.target.matches('.checklist-value')) {
            return { ...item, value: event.target.value.trim() || '' };
        }

        return item;
    });

    await saveUserChecklist(user, nextChecklist);
});

document.getElementById('checklist-editor-list')?.addEventListener('change', async (event) => {
    const itemElement = event.target.closest('.checklist-editor-item');
    if (!itemElement) return;

    const user = auth.currentUser;
    if (!user) return;

    const itemId = itemElement.dataset.id;
    const checklist = await getUserChecklist(user);
    const nextChecklist = checklist
        .map((item) => item.id === itemId ? { ...item, done: event.target.checked } : item)
        .filter((item) => item.label && item.label.trim() && item.value && item.value.trim());

    await saveUserChecklist(user, nextChecklist);
    await renderChecklistEditor();
});

document.getElementById('checklist-editor-list')?.addEventListener('click', async (event) => {
    const deleteButton = event.target.closest('[data-role="delete"]');
    if (!deleteButton) return;

    const user = auth.currentUser;
    if (!user) return;

    const itemElement = deleteButton.closest('.checklist-editor-item');
    if (!itemElement) return;

    const itemId = itemElement.dataset.id;
    const checklist = await getUserChecklist(user);
    const nextChecklist = checklist.filter((item) => item.id !== itemId);
    await saveUserChecklist(user, nextChecklist);
    await renderChecklistEditor();
});

document.getElementById('logout-btn').addEventListener('click', async () => {
    await signOut(auth);
    window.location.href = 'login.html';
});

onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = 'login.html';
        return;
    }

    const name = user.displayName || user.email?.split('@')[0] || 'User';
    document.getElementById('username').textContent = name;
    document.getElementById('profile-name').textContent = name;

    const userRef = doc(db, 'users', user.uid);
    const userSnap = await getDoc(userRef);
    if (!Array.isArray(userSnap.data()?.dailyChecklist)) {
        await setDoc(userRef, { dailyChecklist: [] }, { merge: true });
    }

    await renderChecklistEditor();
});